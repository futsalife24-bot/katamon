const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('Workbenchは左右矢印を廃止し中央上のキャラ名から選択画面を開く', () => {
  assert.doesNotMatch(html, /id="gearCharacter(?:Prev|Next)"|class="gearCharacterBar"/);
  assert.match(html, /class="gearCharacterPicker" data-gear-character-picker/);
  assert.match(html, /openGearCharacterSelection\(\)/);
  assert.match(html, /selectGearWorkbenchMode \? '決定' : '出撃'/);
  assert.match(html, /selectGearWorkbenchCharacter\(tappedCard\.key\)/);
});

test('型ラベルは正本データを変えずゲーム表示からだけ外す', () => {
  assert.match(html, /role: 'バランス型', roleEn: 'BALANCE'/);
  assert.doesNotMatch(html, /gearCharacterRole|gearHtml\(def\?\.role/);
  const free = html.slice(html.indexOf('function drawFreeSetupScreen'), html.indexOf('function updateTitleMenuSlide'));
  assert.doesNotMatch(free, /CHARACTERS\[[^\]]+\]\.role/);
  const vs = html.slice(html.indexOf('function drawVsPlateInfo'), html.indexOf('function matchupActorEntries'));
  assert.doesNotMatch(vs, /def\.role|roleFont/);
});

test('能力サマリーはラベル→値の1行構成で高さを圧縮する', () => {
  assert.match(html, /<div class="gearStat \$\{gearCapClass\(cap\)\}"><small>\$\{label\}<\/small><b>\$\{gearHtml\(value\)\}<\/b>/);
  assert.match(html, /#gearWorkshop \.gearStat\{display:grid;grid-template-columns:auto minmax\(0,1fr\);align-items:baseline/);
  assert.match(html, /min-height:34px/);
});

test('StorageのボタンとselectはLAB共通フレームを使う', () => {
  assert.match(html, /#gearStorage \.gearButton,#gearStorage \.gearSelect,#gearStorage \.loadoutLabTab\{border:8px solid transparent/);
  assert.match(html, /#gearStorage \.gearButton--gold,#gearStorage \.gearButton\.active/);
  assert.match(html, /#gearStorageBox\{position:relative;background-image:[^}]+gear_workbench_lab_background_01\.webp/);
});

test('Gear authorityへ新しい保存処理を追加しない', () => {
  const source = html.slice(html.indexOf('function openGearCharacterSelection'), html.indexOf('function wrapSelectWheelPosition'));
  assert.doesNotMatch(source, /localStorage|saveGearState|setPresetSlot|enhanceStoredGearAtomic|persistDismantle/);
});

console.log(`Gear Workbench cleanup Phase 4R: ${passed} checks passed.`);
