const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test('seatharness rejects missing CanvasGradient colors instead of hiding browser failures', () => {
  const source = fs.readFileSync(path.join(__dirname, 'seatharness.js'), 'utf8');
  assert.match(source, /typeof color !== 'string' \|\| !color\.trim\(\)/);
  assert.doesNotMatch(source, /addColorStop:\s*noop/);
});

test('official Firebase start snapshot restores theme colors separately from terrain material metadata', () => {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  const start = structuredClone(kt.snapshot());
  assert.equal(typeof start.themeKey, 'string');
  assert.equal(start.customStage, null);
  assert.equal(start.customStageIdentity, null);
  assert.doesNotThrow(() => kt.applySnapshotForTest(start));
  assert.deepEqual(kt.snapshot().themeKey, start.themeKey);
  assert.deepEqual(kt.snapshot().terrainMaterial, start.terrainMaterial);
  assert.deepEqual(kt.snapshot().terrainMaterialSegments, start.terrainMaterialSegments);
});

console.log(`\nPhase 3D-8D-F3 guest Battle render: ${passed}/${passed} passed`);
