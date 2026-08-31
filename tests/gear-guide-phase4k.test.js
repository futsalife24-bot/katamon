const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('Gear Quick Guideは§22準拠の3ページを持つ', () => {
  assert.match(html, /GEAR QUICK GUIDE/);
  assert.match(html, /装備とプリセット/);
  assert.match(html, /セットと品質/);
  assert.match(html, /強化と保管/);
  assert.match(html, /\[3, 6, 9, 12\]/);
  assert.match(html, /2 SET/);
  assert.match(html, /4 SET/);
  assert.match(html, /Coin|COIN/);
  assert.match(html, /Powder|POWDER/);
  assert.match(html, /分解保護/);
  assert.match(html, /TEMP BOXは期限を過ぎると自動分解/);
  assert.match(html, /効率低下/);
});

test('6部位と既存visual helperを再利用し新しいGear正本を作らない', () => {
  assert.match(html, /domain\.SLOTS\.map\(\(slot\) => `<div class="gearGuideSlot"/);
  assert.match(html, /gearAssetVisualHtml\(slot\.id, '', 'gearGuideAsset'\)/);
  assert.match(html, /gearSlotFramePositions\[slot\.id\]/);
  assert.doesNotMatch(html, /const gearGuideSlots\s*=/);
});

test('Workbench・Storage・Enhanceから常設ガイドを開ける', () => {
  assert.match(html, /id="gearWorkshopGuide"/);
  assert.match(html, /id="gearStorageGuide"/);
  assert.match(html, /data-gear-enhance-guide/);
  assert.match(html, /gearWorkshopGuide'\)\?\.addEventListener/);
  assert.match(html, /gearStorageGuide'\)\?\.addEventListener/);
});

test('初回案内はclaim前physical Gear 0を読み、成功後のGEARを見るからだけ発火する', () => {
  assert.match(html, /beforeClaim\.inventory\.length \+ beforeClaim\.tempBox\.length === 0/);
  assert.match(html, /offerFirstGuide = wasFirstPhysicalGear/);
  assert.match(html, /if \(offerGuide\) openGearGuide\(\{ onComplete: openDestination \}\)/);
  assert.match(html, /if \(slotId\) openGearWorkshopForSlot\(slotId\)/);
});

test('案内はruntime-localでStorage・Preset・Reward schemaへ永続化しない', () => {
  const block = html.slice(html.indexOf('const gearGuideUi'), html.indexOf('function gearHighlightSlot'));
  assert.doesNotMatch(block, /localStorage|saveGearState|persist|setItem|rewardLedger/);
  assert.match(block, /globalThis\.KatamonGearGuide/);
});

test('skip・戻る・次へとreduced-motionを備える', () => {
  assert.match(html, /data-gear-guide-skip/);
  assert.match(html, /id="gearGuidePrev"/);
  assert.match(html, /id="gearGuideNext"/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

console.log(`gear-guide-phase4k: ${passed}/6 passed`);
