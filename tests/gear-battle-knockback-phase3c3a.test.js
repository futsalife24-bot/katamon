const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const domain = globalThis.KatamonGearDomain;
const gearStorage = globalThis.KatamonGearStorage;
const presets = globalThis.KatamonGearPresets;
const presetStorage = globalThis.KatamonGearPresetStorage;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }
function assertClose(actual, expected) { assert(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`); }
function reset() { storage.clear(); storage.gearMutationLockManager = globalThis.navigator.locks; kt.setHasSave(false); kt.setPhase('title'); }
function gear(id, slotId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = domain.createGear({
      gearId: id, generationSeed: `${id}:generation:${attempt}`, enhancementSeed: `${id}:enhancement`,
      sourceId: 'cpu_battle', sourceDetail: { fixture: 'phase3c3a' }, acquiredAt: '2026-08-26T00:00:00Z',
      qualityProfile: { id: 'phase3c3a', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: 'phase3c3a', setWeights: [{ id: 'impact', weight: 1 }] }, slotId,
    });
    if (value.mainOp.opId !== 'knockback_power' && value.mainOp.opId !== 'knockback_resistance'
      && value.subOps.every((sub) => sub.opId !== 'knockback_power' && sub.opId !== 'knockback_resistance')) return value;
  }
  throw new Error(`could not create an impact fixture without KB subops: ${slotId}`);
}
function installImpact4() {
  const gears = ['barrel', 'armor', 'core', 'engine'].map((slot) => gear(`impact-${slot}`, slot));
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = gears.map((entry) => ({ gear: entry, locked: false, favorite: false }));
  gearStorage.saveGearState(state, storage);
  let presetState = presetStorage.load(storage, { characterIds: kt.chars() });
  for (const entry of gears) presetState = presets.setPresetSlot(presetState, {
    characterId: 'kyoryu', presetId: 'preset1', slotId: entry.slotId, gearId: entry.gearId, characterIds: kt.chars(),
  });
  presetStorage.save(presetState, storage, { characterIds: kt.chars() });
}
function start(impact = false) { reset(); if (impact) installImpact4(); assert.equal(kt.startBattle('kyoryu'), true); return kt.cpuBattleGearSnapshotForTest(); }
function projectile({ directTargetId = 'e1', knockbackSpeed = 0, profile = 'normal_cannonball' } = {}) {
  return { gearDamageProfile: profile, directTargetId, radius: 5, knockbackSpeed, originX: 0, originY: 0 };
}
function clearVelocity(id) { const unit = kt.unitById(id); unit.knockbackVx = 0; unit.vy = 0; unit.grounded = true; }
function impactAt(ownerId, targetId, options) {
  const target = kt.unitById(targetId); clearVelocity(targetId);
  const before = target.hp;
  kt.explodeAtForTest(target.x, target.y, 1, ownerId, true, projectile(options));
  return { damage: before - target.hp, velocity: { vx: target.knockbackVx, vy: target.vy, grounded: target.grounded } };
}

test('calibrates normal Gear KB below existing Impact and generated-special speeds', () => {
  assert.equal(kt.normalGearKnockbackBaseForTest(), 60);
  assert(60 < 80 && 60 < 160 && 60 < 500);
});

test('Gearless normal direct and blast retain zero additional Knockback', () => {
  start(false);
  const direct = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assert.equal(direct.damage, 45); assert.equal(direct.velocity.vx, 0); assert.equal(direct.velocity.vy, 0);
  start(false);
  const blast = impactAt('p1', 'e1', { directTargetId: 'other' });
  assert.equal(blast.damage, 45); assert.equal(blast.velocity.vx, 0); assert.equal(blast.velocity.vy, 0);
});

test('Impact 4set applies normal direct Gear KB as crater-safe 25% horizontal and 100% popup', () => {
  const snapshot = start(true);
  assert.equal(snapshot.derivedStats.knockbackPowerBp, 2000, 'Impact 2pc+4pc must apply exactly once');
  const result = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assertClose(Math.abs(result.velocity.vx), 3);
  assertClose(result.velocity.vy, -12);
});

test('Impact 4set applies normal blast-only Gear KB as full radial speed', () => {
  const snapshot = start(true);
  const result = impactAt('p1', 'e1', { directTargetId: 'other' });
  assertClose(Math.abs(result.velocity.vx), 12);
  assertClose(result.velocity.vy, -13.2);
});

test('centered blast-only Gear KB uses the owner side for its radial direction', () => {
  start(true);
  const target = kt.unitById('e1');
  kt.setUnitPositionForTest('p1', target.x + 100, kt.unitById('p1').y);
  const result = impactAt('p1', 'e1', { directTargetId: 'other' });
  assert(result.velocity.vx < 0, 'target at the blast center moves away from a right-side owner');
});

test('a normal direct target receives popup once, never a second blast-radial Gear KB', () => {
  const snapshot = start(true);
  const result = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assertClose(Math.abs(result.velocity.vx), 3);
  assertClose(result.velocity.vy, -12);
});

test('existing special Knockback is unchanged at zero Gear stats and scales with human Power', () => {
  start(false);
  const legacy = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 80 });
  assert.equal(Math.abs(legacy.velocity.vx), 80); assert.equal(legacy.velocity.vy, -88);
  const snapshot = start(true);
  const boosted = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 80 });
  assertClose(Math.abs(boosted.velocity.vx), 96); assertClose(boosted.velocity.vy, -105.60000000000001);
});

test('human Knockback Resistance scales incoming existing special KB exactly once', () => {
  const snapshot = start(true);
  assert.equal(snapshot.derivedStats.knockbackResistanceBp, 1000, 'Impact 4pc resistance must apply exactly once');
  const result = impactAt('e1', 'p1', { profile: 'excluded', knockbackSpeed: 80 });
  assertClose(Math.abs(result.velocity.vx), 80 / 1.1);
  assertClose(result.velocity.vy, -80);
});

test('a living target outside damage reach receives no Gear Knockback, and terrain stays outside the Gear KB contract', () => {
  start(true);
  const target = kt.unitById('e1'); clearVelocity('e1'); const hpBefore = target.hp;
  const groundBefore = kt.groundYAt(target.x);
  kt.explodeAtForTest(target.x + 500, target.y, 1, 'p1', true, projectile({ directTargetId: 'other' }));
  assert.equal(target.hp, hpBefore); assert.equal(target.knockbackVx, 0); assert.equal(target.vy, 0); assert.equal(kt.groundYAt(target.x), groundBefore);
});

test('ONLINE and Coop gates never read the CPU Gear Knockback snapshot', () => {
  start(true);
  kt.setOnlineForCpuGearEligibilityForTest({ kind: 'firebase' });
  const online = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assert.equal(online.velocity.vx, 0); assert.equal(online.velocity.vy, 0);
  kt.setOnlineForCpuGearEligibilityForTest(null); kt.setBattleModeForTest('coop');
  const coop = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assert.equal(coop.velocity.vx, 0); assert.equal(coop.velocity.vy, 0);
});

test('Gear Knockback adds no random stream consumption', () => {
  const countExplosionRandomCalls = (impact) => {
    start(impact);
    const oldRandom = Math.random; let calls = 0;
    Math.random = () => { calls += 1; return 0.25; };
    try { impactAt('p1', 'e1', { directTargetId: 'e1' }); return calls; }
    finally { Math.random = oldRandom; }
  };
  assert.equal(countExplosionRandomCalls(true), countExplosionRandomCalls(false));
});

test('Knockback uses the match-fixed snapshot across resume', () => {
  start(true);
  const first = kt.cpuBattleGearSnapshotForTest();
  assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true);
  kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true, kt.cpuGearPersistenceForTest().status);
  const resumed = impactAt('p1', 'e1', { directTargetId: 'e1' });
  assertClose(Math.abs(resumed.velocity.vx), kt.normalGearKnockbackBaseForTest() * first.derivedStats.knockbackPowerBp / 10000 * 0.25);
  assert.equal(kt.cpuBattleGearSnapshotForTest().derivedStats.knockbackPowerBp, first.derivedStats.knockbackPowerBp);
});

console.log(`gear-battle-knockback-phase3c3a: ${passed}/${passed} passed`);
