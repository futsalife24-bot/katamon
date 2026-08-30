const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coop = fs.readFileSync(path.join(__dirname, '..', 'coop-mvp-battle.js'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('DropとWorkbenchはcanonical 6部位と同じ固定position正本を共有する', () => {
  assert.deepEqual(domain.SLOT_IDS, ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  assert.match(html, /gearDropMapHtml\(domain, activeSlotId\)/);
  assert.match(html, /gearSlotFramePositions\[slot\.id\]/);
  assert.match(html, /gearSlotFrameSvg\(slot\.id\)/);
  assert.match(html, /gearSlotMiniHtml\(checked\.slotId\)/);
});

test('presentationはdurable unclaimed rewardIdを再読しGearを生成・claimしない', () => {
  assert.match(html, /storage\.loadGearState\(localStorage\)/);
  assert.match(html, /state\.unclaimedRewards\.find\(\(reward\) => reward\.rewardId === rewardId\)/);
  assert.doesNotMatch(html, /function presentGearRewardId[\s\S]{0,1500}(createGear|persistClaimReward|claimUnclaimedReward|persistQueueReward)/);
});

test('CPUはdurable settlement完了後だけrewardIdをpresentationへ渡す', () => {
  assert.match(html, /task\.then\(\(settlement\) => \{[\s\S]*returnToTitleFromResult\(\);[\s\S]*presentGearRewardId\(settlement\.reward\.rewardId\)/);
});

test('協力ボスはrecovered settlementだけ共通presentationへ渡す', () => {
  assert.match(coop, /effectiveRecovery\?\.status === 'recovered'/);
  assert.match(coop, /KatamonGearDropReveal\?\.presentRewardId\(effectiveRecovery\.pending\.reward\.rewardId\)/);
});

test('複数Gear・rarity・set・main OP・Workbench highlightを表示する', () => {
  assert.match(html, /gearDropUi\.index \+ 1/);
  assert.match(html, /reward\.gears\.map/);
  assert.match(html, /data-rarity=/);
  assert.match(html, /gearSetCrests\[checked\.setId\]/);
  assert.match(html, /gearOpLabel\(domain, checked\.mainOp\.opId\)/);
  assert.match(html, /openGearWorkshopForSlot\(slotId\)/);
  assert.match(html, /gearHighlightSlot\(slotId, 1200\)/);
});

test('visual dedupeはruntime-localでstorage ledgerの意味を変えない', () => {
  assert.match(html, /const gearDropSeenRewardIds = new Set\(\)/);
  assert.match(html, /gearDropSeenRewardIds\.has\(rewardId\)/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*gearDrop/);
});

test('reduced motion・fallback・mobile safe-area契約を持つ', () => {
  assert.match(html, /@media\(prefers-reduced-motion:no-preference\)/);
  assert.match(html, /gearDropFallback/);
  assert.match(html, /env\(safe-area-inset-top\)/);
  assert.match(html, /@media\(max-width:340px\)/);
});

console.log(`gear-drop-reveal-phase4c: ${passed}/${passed} passed`);
