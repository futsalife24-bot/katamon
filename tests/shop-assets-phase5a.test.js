const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const assetRoot = path.join(repoRoot, 'assets', 'shop');
const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, 'asset-manifest.json'), 'utf8'));
const foundation = require('../coop-mvp-foundation.js');
const shop = require('../coop-mvp-shop.js');

function inspectMaster(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.readUInt32BE(16), 1254, `${filePath} master width`);
  assert.equal(data.readUInt32BE(20), 1254, `${filePath} master height`);
  assert.equal(data[24], 8, `${filePath} bit depth`);
  assert.equal(data[25], 6, `${filePath} must be RGBA`);
}

function inspectRuntime(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(data.subarray(12, 16).toString('ascii'), 'VP8L', `${filePath} must be lossless WebP`);
  assert.equal(data[20], 0x2f, `${filePath} VP8L signature`);
  const dimensions = data.readUInt32LE(21);
  assert.equal((dimensions & 0x3fff) + 1, 256, `${filePath} runtime width`);
  assert.equal(((dimensions >>> 14) & 0x3fff) + 1, 256, `${filePath} runtime height`);
}

assert.equal(manifest.items.length, 9);
assert.deepEqual(manifest.items.map((item) => item.id), foundation.SHOP_ITEMS.map((item) => item.id));
assert.equal(Object.keys(shop.ITEM_ASSETS).length, 9);

for (const item of manifest.items) {
  const masterPath = path.join(assetRoot, item.master);
  const runtimePath = path.join(assetRoot, item.runtime);
  assert.equal(fs.existsSync(masterPath), true, `${item.id} master missing`);
  assert.equal(fs.existsSync(runtimePath), true, `${item.id} runtime missing`);
  inspectMaster(masterPath);
  inspectRuntime(runtimePath);
  assert.equal(shop.assetPath({ id: item.id }), `assets/shop/${item.runtime}`);
}

const source = fs.readFileSync(path.join(repoRoot, 'coop-mvp-shop.js'), 'utf8');
const game = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert.match(source, /class="mvp-item-art"/);
assert.match(source, /class="mvp-preview mvp-product-preview/, '商品一覧では正式商品画像を表示する');
assert.match(source, /class="mvp-preview mvp-live-battle-preview/, '詳細では実Battle描画のプレビュー面を表示する');
assert.match(source, /data-live-battle-preview=/, '商品ごとの実Battleプレビューを識別する');
assert.match(source, /data-preview-replay/, 'ユーザーが効果を再生し直せる');
assert.doesNotMatch(source, /class="mvp-orb"/);
assert.match(source, /loading="lazy" decoding="async"/);
assert.match(game, /shop\?\.assetPath\?\.\(item\)/);
assert.doesNotMatch(game, /loadoutItemGlyphs/);
assert.match(game, /globalThis\.KatamonWorkshopBattlePreview = Object\.freeze/);
assert.match(game, /launchSubweaponShot\(player/);
assert.match(game, /launchCoopItemShot\(player/);
assert.match(game, /copyWorkshopBattlePreviewTo/);
assert.match(game, /const sourceScale = canvas\.width \/ VW;/, '高DPI端末でも戦場の論理座標を正しく切り抜く');
assert.match(game, /if \(workshopBattlePreview\) return;/);

console.log('Workshop assets Phase 5A: 9 master PNG + 9 lossless WebP PASS');
