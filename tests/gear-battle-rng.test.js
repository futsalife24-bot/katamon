const assert = require('node:assert/strict');
const rng = require('../shared/gear-battle-rng.js');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }
function input(overrides = {}) { return { namespace: rng.GEAR_CRIT_RNG_NAMESPACE, version: rng.GEAR_BATTLE_RNG_VERSION, runId: 'cpu-run:11111111-1111-4111-8111-111111111111', matchOrdinal: 2, actionOrdinal: 3, targetUnitId: 'e1', damageType: 'normal_blast', hitOrdinal: 0, ...overrides }; }
test('same canonical label has the same bounded roll without Math.random', () => { const random = Math.random; Math.random = () => { throw new Error('must not use Math.random'); }; try { const a = rng.rollBasisPoints(input()); const b = rng.rollBasisPoints(input()); assert.equal(a, b); assert(a >= 0 && a < 10000); } finally { Math.random = random; } });
test('target and action labels are order-independent and change their roll', () => { const a = rng.rollBasisPoints(input()); const b = rng.rollBasisPoints(input({ targetUnitId: 'p1' })); const c = rng.rollBasisPoints(input({ actionOrdinal: 4 })); assert.equal(a, rng.rollBasisPoints(input())); assert.notEqual(a, b); assert.notEqual(a, c); });
test('a new match ordinal forms a distinct durable label', () => { assert.notEqual(rng.rollBasisPoints(input({ matchOrdinal: 0 })), rng.rollBasisPoints(input({ matchOrdinal: 1 }))); });
test('version and malformed inputs fail closed', () => { assert.throws(() => rng.rollBasisPoints(input({ version: 2 })), /UNSUPPORTED_GEAR_BATTLE_RNG_VERSION/); assert.throws(() => rng.rollBasisPoints({ ...input(), extra: true }), /INVALID_GEAR_BATTLE_RNG_INPUT/); });
test('Status labels are bounded, target-independent, and leave Crit fixtures unchanged', () => {
  const critFixture = rng.rollBasisPoints(input()); assert.equal(critFixture, 974, 'the pre-Status Crit fixture is byte-for-byte stable');
  const status = { namespace: rng.GEAR_STATUS_RNG_NAMESPACE, version: rng.GEAR_BATTLE_RNG_VERSION, runId: input().runId, matchOrdinal: 2, actionOrdinal: 3, sourceUnitId: 'e1', targetUnitId: 'p1', statusId: 'move_lock', hitOrdinal: 0 };
  const a = rng.rollStatusBasisPoints(status); const b = rng.rollStatusBasisPoints({ ...status, targetUnitId: 'e1' });
  assert(a >= 0 && a < 10000); assert.equal(a, rng.rollStatusBasisPoints(status)); assert.notEqual(a, b); assert.equal(critFixture, rng.rollBasisPoints(input()));
});
test('Status labels fail closed on malformed input and unsupported versions', () => {
  const status = { namespace: rng.GEAR_STATUS_RNG_NAMESPACE, version: rng.GEAR_BATTLE_RNG_VERSION, runId: input().runId, matchOrdinal: 2, actionOrdinal: 3, sourceUnitId: 'e1', targetUnitId: 'p1', statusId: 'move_lock', hitOrdinal: 0 };
  assert.throws(() => rng.rollStatusBasisPoints({ ...status, version: 2 }), /UNSUPPORTED_GEAR_BATTLE_RNG_VERSION/);
  assert.throws(() => rng.rollStatusBasisPoints({ ...status, namespace: 'gear-crit:v1' }), /INVALID_GEAR_STATUS_RNG_NAMESPACE/);
  assert.throws(() => rng.rollStatusBasisPoints({ ...status, extra: true }), /INVALID_GEAR_STATUS_RNG_INPUT/);
});
console.log(`gear-battle-rng: ${passed}/${passed} passed`);
