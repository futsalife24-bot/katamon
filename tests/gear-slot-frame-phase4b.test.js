const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gear = require('../shared/gear-domain.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('canonical 6部位を時計回りの固定positionへ割り当てる', () => {
  assert.deepEqual(gear.SLOT_IDS, ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  assert.match(html, /gearSlotFramePositions\s*=\s*Object\.freeze\(\{ barrel: 'north', armor: 'north-east', core: 'south-east', engine: 'south', sight: 'south-west', auxiliary: 'north-west' \}\)/);
  assert.match(html, /data-frame-position=\"\$\{gearSlotFramePositions\[slot\.id\]\}\"/);
});

test('分離した楔形装甲plateは外板・内板・seam・rivetを持つ', () => {
  assert.match(html, /class=\"gearSlotFrame\"/);
  assert.match(html, /gearSlotFrameOuter/);
  assert.match(html, /gearSlotFrameInner/);
  assert.match(html, /gearSlotFrameSeam/);
  assert.match(html, /gearSlotFrameRivet/);
  assert.match(html, /M5 17 L80 5 L125 51 L80 97 L5 85 L18 51 Z/);
});

test('empty・equipped・selected・updatedを同じslot rendererで表現する', () => {
  assert.match(html, /gear \? 'equipped' : 'empty'/);
  assert.match(html, /gearUi\.slotId === slot\.id \? 'selected'/);
  assert.match(html, /gearUi\.highlightSlotId === slot\.id \? 'updated'/);
  assert.match(html, /function gearHighlightSlot\(slotId, durationMs = 900\)/);
});

test('装備成功時だけ再利用可能highlight helperを呼ぶ', () => {
  assert.match(html, /gearUi\.status = gearId \? '装備を更新しました。' : '装備を外しました。'; gearHighlightSlot\(slotId\)/);
  assert.doesNotMatch(html, /KatamonGearDomain\.[A-Za-z]+\s*=/);
});

test('inventoryとcomparisonは同じslot mini記号を再利用する', () => {
  assert.match(html, /function gearSlotMiniHtml\(slotId\)/);
  assert.match(html, /gearInventoryTitleEl\.innerHTML = `\$\{gearSlotMiniHtml\(gearUi\.slotId\)\}/);
  assert.match(html, /gearCandidateMarks/);
  assert.match(html, /gearCompareTitle\">\$\{gearSlotMiniHtml\(gearUi\.slotId\)\}/);
});

test('小型Androidとreduced motionの表示契約を持つ', () => {
  assert.match(html, /@media \(max-width:400px\)/);
  assert.match(html, /@media \(max-width:340px\)/);
  assert.match(html, /\.gearBuildStage\{min-height:326px\}/);
  assert.match(html, /@media \(prefers-reduced-motion:no-preference\)/);
  assert.match(html, /@keyframes gearSlotUpdatePulse/);
});

console.log(`gear-slot-frame-phase4b: ${passed}/${passed} passed`);
