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

test('presentationはdurable unclaimed rewardIdを再読し、表示だけではstorageを変更しない', () => {
  assert.match(html, /storage\.loadGearState\(localStorage\)/);
  assert.match(html, /state\.unclaimedRewards\.find\(\(reward\) => reward\.rewardId === rewardId\)/);
  const presentation = html.match(/function presentGearRewardId\(rewardId, allowSeen = false\)[\s\S]*?\r?\n  }\r?\n  function presentFirstPendingGearReward/)[0];
  assert.doesNotMatch(presentation, /createGear|persistClaimReward|claimUnclaimedReward|persistQueueReward/);
});

test('明示claimだけが既存persistClaimRewardを通りcanonical read-backを検証する', () => {
  assert.match(html, /async function claimPresentedGearReward\(\)/);
  assert.match(html, /await rewards\.persistClaimReward\(gearDropUi\.reward\.rewardId, Date\.now\(\), localStorage\)/);
  assert.match(html, /state\.unclaimedRewards\.some\(\(entry\) => entry\.rewardId === reward\.rewardId\)/);
  assert.match(html, /state\.rewardLedger\?\.\[reward\.rewardId\] !== true/);
  assert.doesNotMatch(html, /function claimPresentedGearReward[\s\S]*?saveGearState\(/);
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
  assert.match(html, /gearDropUi\.index < gearDropUi\.reward\.gears\.length - 1/);
  assert.match(html, /gearDropWorkbenchBtn\.hidden = !gearDropUi\.claimed/);
});

test('未受取報酬はWorkbenchから明示的に再表示でき、実routingだけを案内する', () => {
  assert.match(html, /id="gearPendingRewards"/);
  assert.match(html, /presentGearRewardId\(reward\.rewardId, true\)/);
  assert.match(html, /gearDropSeenRewardIds\.has\(rewardId\)/);
  assert.match(html, /インベントリへ保存/);
  assert.match(html, /TEMP BOXへ保管/);
  assert.match(html, /inventoryGear \? 'GEARを見る' : '同じ部位を見る'/);
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
