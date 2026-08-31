const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('Workbenchは左右3段の向きと合成素材を、socket版フレームへ引き継ぐ', () => {
  assert.match(html, /gearSlotFrameSvg\(slot\.id, 'socket'\)/);
  assert.match(html, /gearAssetVisualHtml\(slot\.id, gear\?\.setId \|\| '', 'gearSlotEmblem'\)/);
  assert.doesNotMatch(html, /\.gearSlot\[data-frame-position\^="right"\] \.gearSlotAsset/);
  assert.match(html, /\.gearSlot\[data-frame-position="right-top"\] \.gearSlotContent[^}]*text-align:right/);
  assert.match(html, /gearAssetVisualHtml\(gear\.slotId, gear\.setId, 'gearCandidateAsset'\)/);
  for (const className of ['gearSlotPart', 'gearSlotName', 'gearSlotEmblem']) assert.match(html, new RegExp(className));
  assert.doesNotMatch(html, /gearSlotSetName/);
  assert.doesNotMatch(html, /gearSlotRarity/);
});

test('Storageは部位・rarity/star・set・強化・main OPを別階層で表示する', () => {
  for (const className of ['gearStorageAsset', 'gearStorageSlotName', 'gearStorageQuality', 'gearStorageMeta', 'gearDetailAsset']) {
    assert.match(html, new RegExp(className));
  }
  assert.match(html, /gearAssetVisualHtml\(gear\.slotId, gear\.setId, 'gearDetailAsset'\)/);
  assert.match(html, /gearStorageQuality[^`]+gearRarity\(view\.domain, gear\.rarityId\)[^`]+gear\.star/);
});

test('Storage詳細はGear identity・状態・操作を独立した階層で表示する', () => {
  for (const className of [
    'gearStorageDetailHero',
    'gearStorageDetailIdentity',
    'gearStorageDetailBadges',
    'gearStorageDetailStat',
    'gearStorageDetailStatus',
    'gearStorageDetailBlockReason',
  ]) assert.match(html, new RegExp(className));
  assert.match(html, /装備・比較へ/);
  assert.match(html, /強化する/);
  assert.match(html, /分解する/);
  assert.match(html, /お気に入り未登録/);
  assert.match(html, /分解保護なし/);
  assert.doesNotMatch(html, /authority側/);
  assert.match(html, /\.gearStorageDetail\{position:relative/);
  assert.match(html, /\.gearStorageDetailActionButtons>\.gearButton--danger\{grid-column:1\/-1\}/);
});

test('Drop・Enhance・Dismantleは同じ合成素材で対象Gearのidentityを保つ', () => {
  assert.match(html, /gearAssetVisualHtml\(checked\.slotId, checked\.setId, 'gearDropCardAsset'\)/);
  assert.match(html, /gearDropSlot\.active \.gearDropAsset\{width:59px;height:59px/);
  assert.equal((html.match(/gearAssetVisualHtml\(gear\.slotId, gear\.setId, 'gearActionAsset'\)/g) || []).length, 2);
  assert.match(html, /\.gearActionGear\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/);
});

test('visual-only変更は既存authority writerを追加・置換しない', () => {
  assert.equal((html.match(/globalThis\.KatamonGearStorageUi = Object\.freeze/g) || []).length, 1);
  assert.equal((html.match(/globalThis\.KatamonGearDropReveal = Object\.freeze/g) || []).length, 1);
  assert.doesNotMatch(html, /48[^\n]*(gear|Gear)[^\n]*(image|画像)/);
});

console.log(`gear-visual-polish-phase4g: ${passed}/5 passed`);
