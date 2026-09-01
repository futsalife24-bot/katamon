const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('中央CATAMONを能力表示へ戻る操作対象として公開する', () => {
  assert.match(html, /data-gear-summary-return/);
  assert.match(html, /CATAMONの能力表示に戻る/);
  assert.match(html, /gearUi\.slotId\s*=\s*null;\s*gearUi\.comparisonGearId\s*=\s*null/);
});

test('能力と選択Gear詳細を同じsummary領域で切り替える', () => {
  assert.match(html, /dataset\.gearSummaryMode\s*=\s*detailMode\s*\?\s*'detail'\s*:\s*'stats'/);
  assert.match(html, /dataset\.gearSummarySlot\s*=\s*gearUi\.slotId\s*\|\|\s*''/);
  assert.match(html, /detailMode\s*\?\s*gearInlineDetailHtml\(state,\s*gearUi\.slotId\)/);
  assert.match(html, /gearSetPanelEl\.hidden\s*=\s*detailMode/);
});

test('inline詳細は既存表示helperからGear identityとOPを構成する', () => {
  const source = html.slice(html.indexOf('function gearInlineDetailHtml'), html.indexOf('function gearCurrentGear'));
  assert.match(source, /gearAssetVisualHtml/);
  assert.match(source, /gearSet\(state\.domain/);
  assert.match(source, /gearRarity\(state\.domain/);
  assert.match(source, /gearOpLabel\(state\.domain/);
  assert.match(source, /gearValue\(gear\.mainOp\.value/);
  assert.match(source, /gearInlineDetailEmpty/);
  assert.match(source, /強化 \+\$\{gear\.enhancementLevel\}/);
  assert.match(source, /サブOPなし/);
  assert.doesNotMatch(source, /saveGearState|setPresetSlot|enhanceStoredGearAtomic|persistDismantle/);
});

test('slot選択は候補導線を維持し自動scrollを追加しない', () => {
  const listener = html.slice(html.indexOf("gearBuildStageEl.addEventListener('click'"), html.indexOf("gearCandidatesEl.addEventListener('click'"));
  assert.match(listener, /button\.dataset\.gearSlot/);
  assert.doesNotMatch(listener, /scrollIntoView/);
});

console.log(`Gear Workbench inline detail Phase 4L: ${passed} checks passed.`);
