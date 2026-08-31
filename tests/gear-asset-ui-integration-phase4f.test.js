const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'gear', 'asset-manifest.json'), 'utf8'));
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('6部位と8セットを完成画像にせず、runtime素材として合成する', () => {
  assert.match(html, /function gearAssetVisualHtml\(slotId, setId = '', variant = ''\)/);
  assert.equal(manifest.completedCombinationImages, 0);
  for (const slot of manifest.slots) assert.match(html, new RegExp(`gear_silhouette_${slot.id}_01\\.webp`));
  for (const set of manifest.sets) {
    const runtimePath = `assets/gear/${set.runtime}`;
    assert.ok(fs.existsSync(path.join(root, 'assets', 'gear', set.runtime)), `${set.id} emblem runtime exists`);
    assert.match(html, new RegExp(`${set.id}: '${runtimePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `${set.id} UI mapping matches manifest`);
  }
  assert.match(html, /last_stand: 'assets\/gear\/runtime\/emblems\/gear_emblem_laststand_01\.webp'/);
  assert.doesNotMatch(html, /gear_emblem_\$\{setId\}_01\.webp/);
});

test('Workbench、Storage、Drop Revealは同じ部位/セット合成ヘルパーを使う', () => {
  assert.match(html, /gearAssetVisualHtml\(slot\.id, gear\?\.setId \|\| '', 'gearSlotEmblem'\)/);
  assert.match(html, /gearAssetVisualHtml\(gear\.slotId, gear\.setId, 'gearStorageAsset'\)/);
  assert.match(html, /gearAssetVisualHtml\(slot\.id, activeGear\?\.setId \|\| '', 'gearDropAsset'\)/);
  assert.equal(manifest.sharedFrameAuthority, 'index.html#gearSlotFrameSvg');
});

test('既存フレーム、レアリティ、Gear authorityを置き換えない', () => {
  assert.match(html, /function gearSlotFrameSvg\(slotId, variant = ''\)/);
  assert.match(html, /data-rarity="\$\{gearHtml\(gear\.rarityId\)\}"/);
  assert.doesNotMatch(html, /persistClaimReward\([^)]*gearAsset/);
  assert.doesNotMatch(html, /enhanceStoredGearAtomic\([^)]*gearAsset/);
});

test('セット未指定時は空srcの紋章imgを生成しない', () => {
  assert.match(html, /\$\{emblem \? `<img class="gearAssetEmblem"[^`]+` : ''\}/);
  assert.doesNotMatch(html, /<img class="gearAssetEmblem" src="\$\{gearHtml\(emblem\)\}" alt=""><\/span>/);
});

console.log(`gear-asset-ui-integration-phase4f: ${passed}/4 passed`);
