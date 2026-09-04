const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.join(__dirname, '..');
const assetRoot = path.join(repoRoot, 'assets', 'battle-items');
const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, 'asset-manifest.json'), 'utf8'));

const expectedItems = [
  {
    id: 'healing',
    label: '回復アイテム',
    purpose: 'restore battle HP',
    master: 'master/items/battle_item_healing_01.png',
    runtime: 'runtime/items/battle_item_healing_01.webp',
  },
  {
    id: 'special_charge',
    label: '必殺チャージ',
    purpose: 'increase special charge',
    master: 'master/items/battle_item_special_charge_01.png',
    runtime: 'runtime/items/battle_item_special_charge_01.webp',
  },
  {
    id: 'gear_resource',
    label: 'Gear素材',
    purpose: 'grant Gear powder and design fragments',
    master: 'master/items/battle_item_gear_resource_box_01.png',
    runtime: 'runtime/items/battle_item_gear_resource_box_01.webp',
  },
];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function inspectRgbaPng(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} PNG signature`);
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
  assert.equal(width, manifest.masterSizePx, `${filePath} master width`);
  assert.equal(height, manifest.masterSizePx, `${filePath} master height`);
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
  assert.equal(data[20], 0x2f, `${filePath} VP8L signature`);
  const dimensions = data.readUInt32LE(21);
  assert.equal((dimensions & 0x3fff) + 1, manifest.runtimeSizePx, `${filePath} runtime width`);
  assert.equal(((dimensions >>> 14) & 0x3fff) + 1, manifest.runtimeSizePx, `${filePath} runtime height`);
}

assert.deepEqual(manifest, {
  schemaVersion: 1,
  library: 'catamon-battle-items',
  masterSizePx: 1254,
  masterFormat: 'png-rgba8',
  runtimeSizePx: 256,
  runtimeFormat: 'lossless-webp',
  items: expectedItems,
}, 'manifest format and item order must remain deterministic');

assert.equal(new Set(manifest.items.map((item) => item.id)).size, 3, 'battle item IDs must be unique');
assert.deepEqual(manifest.items.map((item) => item.id), ['healing', 'special_charge', 'gear_resource']);

for (const item of manifest.items) {
  const masterPath = path.join(assetRoot, item.master);
  const runtimePath = path.join(assetRoot, item.runtime);
  assert.equal(fs.existsSync(masterPath), true, `${item.id} master missing`);
  assert.equal(fs.existsSync(runtimePath), true, `${item.id} runtime missing`);
  inspectRgbaPng(masterPath);
  inspectLosslessWebp(runtimePath);
}

function relativeFiles(directory) {
  const files = [];
  function walk(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile()) files.push(path.relative(assetRoot, entryPath).split(path.sep).join('/'));
    }
  }
  walk(path.join(assetRoot, directory));
  return files.sort();
}

assert.deepEqual(
  relativeFiles('master'),
  manifest.items.map((item) => item.master).sort(),
  'master/items must not contain orphan files',
);
assert.deepEqual(
  relativeFiles('runtime'),
  manifest.items.map((item) => item.runtime).sort(),
  'runtime/items must not contain orphan files',
);

const worker = fs.readFileSync(path.join(repoRoot, 'sw.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const appShell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
const tier1 = /const TIER1_ASSETS = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
const tier2 = /const TIER2_ASSETS = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
const firstPaint = /const FIRST_PAINT_CACHE_ASSETS = \[([\s\S]*?)\];/.exec(indexHtml)?.[1] || '';

assert.match(indexHtml, /webpBase: `assets\/battle-items\/runtime\/items\/\$\{stem\}`,[\s\S]*?pngFallback: false/,
  'runtime WebP failure must fall through to Canvas primitives');
assert.doesNotMatch(indexHtml, /assets\/battle-items\/master\/items/,
  'large battle-item master PNGs must never be runtime fallbacks');

for (const item of manifest.items) {
  const runtimeUrl = `./assets/battle-items/${item.runtime}`;
  const escaped = runtimeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(tier2, new RegExp(escaped), `${item.id} runtime must be in TIER2_ASSETS`);
  assert.equal((worker.match(new RegExp(escaped, 'g')) || []).length, 1, `${item.id} runtime must appear once in sw.js`);
  assert.doesNotMatch(appShell, new RegExp(escaped), `${item.id} runtime must not be in APP_SHELL`);
  assert.doesNotMatch(tier1, new RegExp(escaped), `${item.id} runtime must not be in TIER1_ASSETS`);
  assert.doesNotMatch(firstPaint, new RegExp(escaped), `${item.id} runtime must not be a first-paint asset`);
  assert.doesNotMatch(worker, new RegExp(item.master.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${item.id} master must not be cached by sw.js`);
}

console.log('Battle item assets: 3 master PNG + 3 lossless WebP + T2 PWA integration PASS');
