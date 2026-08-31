const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('Workbenchだけが円形socket版フレームと五角形artを使う', () => {
  assert.match(html, /function gearSlotFrameSvg\(slotId, variant = ''\)/);
  assert.match(html, /gearSocketRing/);
  assert.match(html, /gearSocketWell/);
  assert.match(html, /gearSlotFrameArt/);
  assert.equal((html.match(/gearSlotFrameSvg\(slot\.id, 'socket'\)/g) || []).length, 1);
  assert.equal((html.match(/gearSlotFrameSvg\(slot\.id\)/g) || []).length, 1);
  assert.match(html, /gearAssetVisualHtml\(slot\.id, gear\?\.setId \|\| '', 'gearSlotEmblem'\)/);
  assert.match(html, /translateX\(calc\(-1 \* var\(--socket-r\)\)\)/);
  assert.match(html, /rotate\(calc\(-1 \* var\(--frame-angle\)\)\)/);
});

test('旧horizontal asset/content規則を残さず幾何insetを正本にする', () => {
  assert.doesNotMatch(html, /\.gearSlot\[data-frame-position\^="right"\] \.gearSlotAsset\{right:auto;left:1px\}/);
  assert.doesNotMatch(html, /padding:2px 5px 2px (31|46)px/);
  assert.doesNotMatch(html, /\.gearSlotAsset\{/);
  for (const token of [
    'inset:30px 27px 30px 35px',
    'inset:30px 35px 30px 27px',
    'inset:23px 25px 23px 32px',
    'inset:23px 32px 23px 25px',
    'inset:19px 24px 19px 30px',
    'inset:19px 30px 19px 24px',
  ]) assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('セットは色相、レアリティは金属で分離する', () => {
  for (const [setId, ring, well] of [
    ['assault', '#e03c3c', '#4a2426'], ['life', '#3fb05f', '#1d4430'],
    ['fortify', '#2f7fd0', '#19364f'], ['critical', '#16b5ab', '#124545'],
    ['blast', '#f06a12', '#4f301a'], ['impact', '#9b52e0', '#372a54'],
    ['rescue', '#f0509a', '#4f2940'], ['last_stand', '#3d4fd8', '#1d2951'],
  ]) assert.match(html, new RegExp(`data-set="${setId}"[^}]*--set-ring:${ring}[^}]*--set-well:${well}`));
  for (const rarity of ['normal', 'rare', 'epic', 'legend', 'mythic']) {
    assert.match(html, new RegExp(`data-rarity="${rarity}"[^}]*gearSlotFrameOuter:not\\(\\.gearSocketRing\\)`));
    assert.doesNotMatch(html, new RegExp(`data-rarity="${rarity}"[^}]*gearSlotFrameInner`));
  }
  assert.doesNotMatch(html, /color-mix\(/);
});

test('2行表示・補機前提・authority境界を維持する', () => {
  assert.match(html, /class="gearSlotPart"/);
  assert.match(html, /class="gearSlotName"/);
  assert.match(html, /<em>\+\$\{gear\.enhancementLevel\}<\/em>/);
  assert.match(html, /<i>★\$\{gear\.star\}<\/i>/);
  assert.match(html, /\.gearSlotPart,\.gearSlotName \{[^}]*font-family:"RocknRoll One",sans-serif; font-weight:400; font-synthesis:none;/);
  assert.equal((html.match(/\.gearSlotPart,\.gearSlotName\{letter-spacing:-\.05em\}/g) || []).length, 1);
  assert.doesNotMatch(html, /補助機構/);
  assert.equal((html.match(/globalThis\.KatamonGearStorageUi = Object\.freeze/g) || []).length, 1);
  assert.equal((html.match(/globalThis\.KatamonGearDropReveal = Object\.freeze/g) || []).length, 1);
});

console.log(`gear-workbench-slot-phase4h: ${passed}/4 passed`);
