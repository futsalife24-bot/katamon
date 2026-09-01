const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.join(__dirname, '..');
const gearRoot = path.join(repoRoot, 'assets', 'gear');
const manifest = JSON.parse(fs.readFileSync(path.join(gearRoot, 'asset-manifest.json'), 'utf8'));

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function inspectRgbaPng(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  assert.equal(width, height, `${filePath} must be square`);
  assert.equal(width, manifest.masterSizePx, `${filePath} unexpected size`);
  assert.equal(bitDepth, 8, `${filePath} must use 8-bit channels`);
  assert.equal(colorType, 6, `${filePath} must be RGBA`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows = [];
  let cursor = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    const source = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const row = Buffer.alloc(stride);
    const previous = rows[y - 1] || Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upLeft)
                : assert.fail(`${filePath} unknown PNG filter ${filter}`);
      row[x] = (source[x] + predictor) & 0xff;
    }
    for (let x = 3; x < stride; x += 4) {
      minAlpha = Math.min(minAlpha, row[x]);
      maxAlpha = Math.max(maxAlpha, row[x]);
    }
    rows.push(row);
  }
  assert.equal(minAlpha, 0, `${filePath} must contain transparent pixels`);
  assert.equal(maxAlpha, 255, `${filePath} must contain opaque pixels`);
}

function inspectLosslessWebp(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF', `${filePath} must be RIFF`);
  assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP', `${filePath} must be WebP`);
  assert.equal(data.subarray(12, 16).toString('ascii'), 'VP8L', `${filePath} must be lossless WebP`);
  assert.equal(data[20], 0x2f, `${filePath} must have a valid VP8L signature`);
  const dimensions = data.readUInt32LE(21);
  const width = (dimensions & 0x3fff) + 1;
  const height = ((dimensions >>> 14) & 0x3fff) + 1;
  assert.equal(width, manifest.runtimeSizePx, `${filePath} unexpected width`);
  assert.equal(height, manifest.runtimeSizePx, `${filePath} unexpected height`);
}

assert.equal(manifest.composition, 'shared_frame_plus_slot_silhouette_plus_set_emblem');
assert.equal(manifest.completedCombinationImages, 0);
assert.equal(manifest.slots.length, 6);
assert.equal(manifest.sets.length, 8);
assert.deepEqual(manifest.slots.map((slot) => slot.id), [
  'auxiliary', 'sight', 'engine', 'barrel', 'armor', 'core',
]);
assert.deepEqual(manifest.sets.map((set) => set.id), [
  'assault', 'life', 'fortify', 'critical', 'blast', 'impact', 'rescue', 'last_stand',
]);

for (const entry of [...manifest.slots, ...manifest.sets]) {
  const masterPath = path.join(gearRoot, entry.master);
  const runtimePath = path.join(gearRoot, entry.runtime);
  assert.equal(fs.existsSync(masterPath), true, `${entry.id} master missing`);
  assert.equal(fs.existsSync(runtimePath), true, `${entry.id} runtime missing`);
  inspectRgbaPng(masterPath);
  assert.equal(path.extname(runtimePath).toLowerCase(), '.webp', `${entry.id} runtime must be WebP`);
  inspectLosslessWebp(runtimePath);
}

for (const slot of manifest.slots) {
  assert.ok(slot.socket.centerXPct >= 30 && slot.socket.centerXPct <= 70);
  assert.ok(slot.socket.centerYPct >= 60 && slot.socket.centerYPct <= 80);
  assert.ok(slot.socket.widthPct >= 20 && slot.socket.widthPct <= 35);
}

const completedImages = fs.readdirSync(gearRoot, { recursive: true })
  .filter((name) => /gearcard_|gear_(?:auxiliary|sight|engine|barrel|armor|core)_(?:assault|life|fortify|critical|blast|impact|rescue|laststand)/.test(String(name)));
assert.deepEqual(completedImages, [], 'precomposed slot x set Gear images are forbidden');

console.log('Gear assets: 6 silhouettes + 8 emblems PASS');
