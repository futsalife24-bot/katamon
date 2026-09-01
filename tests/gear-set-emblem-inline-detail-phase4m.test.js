const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('Gear画像の下へ実セット紋章の説明ボタンを配置する', () => {
  const source = html.slice(html.indexOf('function gearInlineDetailHtml'), html.indexOf('function gearCurrentGear'));
  assert.match(source, /gearInlineDetailVisual/);
  assert.match(source, /gearSetEmblemAssets\[gear\.setId\]/);
  assert.match(source, /data-gear-inline-set=/);
  assert.match(source, /aria-expanded="\$\{gearUi\.setDetailOpen\}"/);
  assert.match(source, /gearInlineSetEffectsHtml\(state, set\)/);
  assert.doesNotMatch(source, /saveGearState|setPresetSlot|enhanceStoredGearAtomic|persistDismantle/);
});

test('セット説明はDomainの2/4効果と装備数を表示正本にする', () => {
  const source = html.slice(html.indexOf('const gearSetStatLabels'), html.indexOf('function gearInlineDetailHtml'));
  assert.match(source, /state\.aggregate\.setCounts\[set\.id\]/);
  assert.match(source, /set\.effects\[threshold\]/);
  assert.match(source, /\[2, 4\]\.map/);
  assert.match(source, /gearSetPercent\(effect\.valueBp\)/);
  assert.match(source, /data-gear-inline-set-threshold/);
});

test('枠内2行は部位・強化とセット・星を別要素にして重要値を縮めない', () => {
  assert.match(html, /class="gearSlotPartLabel"/);
  assert.match(html, /class="gearSlotSetLabel"/);
  assert.match(html, /\.gearSlotPart em \{ flex:0 0 auto/);
  assert.match(html, /\.gearSlotName i \{ flex:0 0 auto/);
  assert.match(html, /\.gearSlotPart \{ color:#d3e2df; font-size:10px/);
  assert.match(html, /\.gearSlotName \{ color:#fff5dc; font-size:11\.6px/);
});

test('Presetプレートは名前と装備数を分離し小型画面でも装備数を隠さない', () => {
  assert.match(html, /class="gearCharacterPlateName"/);
  assert.match(html, /class="gearCharacterPlateCount"/);
  assert.match(html, /class="gearCharacterPlateEquipped"/);
  assert.match(html, /\.gearCharacterPlateCount \{ flex:0 0 auto/);
  assert.match(html, /\.gearCharacterPlate\{width:38%;max-width:112px/);
  assert.match(html, /\.gearCharacterPlateEquipped\{display:none\}/);
});

test('セット説明の開閉はruntime表示状態だけを変更する', () => {
  const listener = html.slice(html.indexOf("gearSummaryEl.addEventListener('click'"), html.indexOf("gearCandidatesEl.addEventListener('click'"));
  assert.match(listener, /gearUi\.setDetailOpen\s*=\s*!gearUi\.setDetailOpen/);
  assert.doesNotMatch(listener, /localStorage|save|persist|mutate|transaction/i);
});

console.log(`Gear set emblem inline detail Phase 4M: ${passed}/5 passed`);
