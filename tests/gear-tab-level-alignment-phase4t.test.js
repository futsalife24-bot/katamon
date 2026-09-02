const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('装備と所持品は同じCATAMON LABヘッダーを使う', () => {
  assert.match(html, /id="gearWorkshopTitle">CATAMON LAB/);
  assert.match(html, /id="gearStorageTitle">CATAMON LAB/);
  assert.equal((html.match(/<span class="loadoutLabKicker">LOADOUT FACILITY<\/span>/g) || []).length, 2);
});

test('所持品にも同じ4カテゴリ段を置きGEARを現在地として示す', () => {
  const storage = html.slice(html.indexOf('<div id="gearStorage"'), html.indexOf('<div id="gearEnhanceOverlay"'));
  assert.match(storage, /id="gearStorageLoadoutNav" class="loadoutLabNav"/);
  for (const page of ['gear', 'weapon', 'style', 'profile']) assert.match(storage, new RegExp(`data-gear-storage-loadout-page="${page}"`));
  assert.match(storage, /class="loadoutLabTab active" data-gear-storage-loadout-page="gear"[^>]+aria-current="page"/);
});

test('ヘッダー・カテゴリ・Gearタブの縦余白は両画面で共通', () => {
  assert.match(html, /#gearWorkshop \.loadoutLabNav,#gearStorage \.loadoutLabNav\{gap:4px;margin:7px 0 6px/);
  assert.match(html, /#gearStorage \.gearHeader\{[^}]+margin:0 -2px 5px/);
  assert.match(html, /#gearWorkshop \.gearButton,#gearStorage \.gearHeader \.gearButton,#gearStorage \.gearSectionNav \.gearButton\{padding:5px 10px\}/);
  assert.match(html, /#gearStorage \.gearSectionNav\{gap:6px;margin:7px 0 6px/);
  assert.match(html, /#gearStorage \.loadoutLabTab\{min-height:46px/);
  assert.match(html, /#gearWorkshop \.gearHeader h2,#gearStorage \.gearHeader h2\{font-size:15px/);
  assert.match(html, /#gearWorkshop \.gearHeader,#gearStorage \.gearHeader\{margin-bottom:2px/);
});

test('Storageカテゴリ段は対応するLABページへ戻れる', () => {
  assert.match(html, /function gearStorageOpenLoadoutPage\(page\)/);
  const source = html.slice(html.indexOf('function gearStorageOpenLoadoutPage'), html.indexOf('if (gearStorageEl && gearStorageRackEl'));
  assert.match(source, /openGearWorkshop\(\)/);
  assert.match(source, /setLoadoutLabPage\(page\)/);
  assert.match(html, /gearStorageLoadoutNav'\)\.addEventListener/);
});

test('Gear authorityへ保存処理を追加しない', () => {
  const source = html.slice(html.indexOf('function gearStorageOpenLoadoutPage'), html.indexOf('globalThis.KatamonGearStorageUi'));
  assert.doesNotMatch(source, /localStorage|saveGearState|setPresetSlot|persistClaimReward|enhanceStoredGearAtomic|persistDismantle/);
});

console.log(`Gear tab level alignment Phase 4T: ${passed} checks passed.`);
