const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const domain = globalThis.KatamonGearDomain;
const gearStorage = globalThis.KatamonGearStorage;
const presets = globalThis.KatamonGearPresets;
const presetStorage = globalThis.KatamonGearPresetStorage;
const combat = globalThis.KatamonGearCombat;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }
function reset() { storage.clear(); storage.gearMutationLockManager = globalThis.navigator.locks; kt.setHasSave(false); kt.setPhase('title'); }
function makeGear(id, slotId, mainOpId = null, requiredSubId = null, forbiddenSubId = null) {
  for (let index = 0; index < 600; index += 1) {
    const gear = domain.createGear({
      gearId: `${id}:${index}`, generationSeed: `${id}:generation:${index}`, enhancementSeed: `${id}:enhancement:${index}`,
      sourceId: 'cpu_battle', sourceDetail: { fixture: 'phase3c3c2' }, acquiredAt: '2026-08-26T00:00:00Z',
      qualityProfile: { id: 'phase3c3c2', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: 'phase3c3c2', setWeights: [{ id: 'rescue', weight: 1 }] }, slotId,
    });
    if ((!mainOpId || gear.mainOp.opId === mainOpId)
      && (!requiredSubId || gear.subOps.some((sub) => sub.opId === requiredSubId))
      && (!forbiddenSubId || !gear.subOps.some((sub) => sub.opId === forbiddenSubId))) return gear;
  }
  throw new Error(`could not create ${mainOpId || requiredSubId} fixture`);
}
function install(gears) {
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = gears.map((gear) => ({ gear, locked: false, favorite: false }));
  gearStorage.saveGearState(state, storage);
  let preset = presetStorage.load(storage, { characterIds: kt.chars() });
  for (const gear of gears) preset = presets.setPresetSlot(preset, { characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: kt.chars() });
  presetStorage.save(preset, storage, { characterIds: kt.chars() });
}
function start(gears = []) { reset(); if (gears.length) install(gears); assert.equal(kt.startBattle('kyoryu'), true); return kt.cpuBattleGearSnapshotForTest(); }
function self(base) { return kt.applyCpuGearHealingForTest('p1', 'p1', base); }

test('Gearless self-healing preserves the legacy final integer boundary', () => {
  start(); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', p1.maxHp - 30);
  assert.deepEqual(self(20), { requestedHealing: 20, actualHealing: 20 });
  assert.equal(p1.hp, p1.maxHp - 10);
});

test('Healing Effect and Received Healing Effect independently multiply self-heal once', () => {
  const healGear = makeGear('heal-only', 'auxiliary', 'heal_power', null, 'received_heal');
  let snapshot = start([healGear]); let p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1);
  assert.equal(snapshot.derivedStats.receivedHealingMultiplier, 1);
  assert.equal(self(20).actualHealing, Math.round(combat.finalHealing(20, snapshot.derivedStats.healingMultiplier, 1)));
  const receivedGear = makeGear('received-only', 'barrel', null, 'received_heal', 'heal_power');
  snapshot = start([receivedGear]); p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1);
  assert.equal(snapshot.derivedStats.healingMultiplier, 1);
  assert.equal(self(20).actualHealing, Math.round(combat.finalHealing(20, 1, snapshot.derivedStats.receivedHealingMultiplier)));
});

test('Healing Effect and Received Healing Effect each apply once, then multiply together without an intermediate round', () => {
  const healGear = makeGear('heal-aux', 'auxiliary', 'heal_power');
  const receivedGear = makeGear('received-barrel', 'barrel', null, 'received_heal');
  const snapshot = start([healGear, receivedGear]); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1);
  const derived = snapshot.derivedStats;
  assert(derived.healingMultiplier > 1); assert(derived.receivedHealingMultiplier > 1);
  const expectedRaw = combat.finalHealing(20, derived.healingMultiplier, derived.receivedHealingMultiplier);
  const result = self(20);
  assert.equal(result.requestedHealing, Math.round(expectedRaw));
  assert.equal(result.actualHealing, Math.round(expectedRaw));
});

test('Rescue 2pc static Healing is already contained in the snapshot and is not re-added by Battle', () => {
  const gears = ['barrel', 'armor'].map((slot) => makeGear(`rescue-${slot}`, slot));
  const snapshot = start(gears); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1);
  assert.equal(snapshot.derivedStats.activeSets.some((set) => set.setId === 'rescue' && set.threshold === 2), true);
  const expected = Math.round(combat.finalHealing(20, snapshot.derivedStats.healingMultiplier, snapshot.derivedStats.receivedHealingMultiplier));
  assert.equal(self(20).actualHealing, expected);
});

test('max HP cap, overheal, and full HP keep requested and actual healing distinct', () => {
  start(); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', p1.maxHp - 3);
  assert.deepEqual(self(20), { requestedHealing: 20, actualHealing: 3 });
  assert.deepEqual(self(20), { requestedHealing: 20, actualHealing: 0 });
});

test('generated self-heal uses the common adapter for p1 while CPU self-heal remains legacy', () => {
  const healGear = makeGear('generated-heal', 'auxiliary', 'heal_power');
  const snapshot = start([healGear]); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1);
  const expected = Math.round(combat.finalHealing(20, snapshot.derivedStats.healingMultiplier, snapshot.derivedStats.receivedHealingMultiplier));
  assert.equal(kt.launchGeneratedSelfHealForTest('p1', 20).actualHealing, expected);
  const enemy = kt.unitById('e1'); kt.setUnitHpForTest('e1', enemy.maxHp - 30);
  assert.equal(kt.launchGeneratedSelfHealForTest('e1', 20).actualHealing, 20);
});

test('Bloomtan drain uses aggregated actual HP damage only and never turns zero HP damage into healing', () => {
  const healGear = makeGear('drain-heal', 'auxiliary', 'heal_power');
  const snapshot = start([healGear]); const p1 = kt.unitById('p1'); const e1 = kt.unitById('e1');
  kt.setUnitHpForTest('p1', 1); const enemyBefore = e1.hp;
  assert.equal(kt.drainExplosionForTest('p1', 'e1'), true);
  const actualDamage = enemyBefore - e1.hp;
  assert.equal(p1.hp - 1, Math.round(combat.finalHealing(actualDamage, snapshot.derivedStats.healingMultiplier, snapshot.derivedStats.receivedHealingMultiplier)));
  kt.setUnitHpForTest('p1', 1); kt.setUnitHpForTest('e1', 0);
  assert.equal(kt.drainExplosionForTest('p1', 'e1'), true); assert.equal(p1.hp, 1);
});

test('Healing does not mutate Numeric Shield, Barrier, rescue runtime, Crit/Status state, or damage credit state', () => {
  start(); const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', p1.maxHp - 30); kt.setCpuGearShieldForTest(7); kt.setSubweaponBarrierForTest('p1', true);
  const shieldBefore = kt.cpuGearShieldStateForTest(); const critBefore = kt.cpuGearCritStateForTest(); const statusBefore = kt.cpuGearStatusStateForTest();
  self(20);
  assert.deepEqual(kt.cpuGearShieldStateForTest(), shieldBefore); assert.equal(p1.subweaponBarrierActive, true);
  assert.deepEqual(kt.cpuGearCritStateForTest(), critBefore); assert.deepEqual(kt.cpuGearStatusStateForTest(), statusBefore);
});

test('resume keeps match-fixed Healing multipliers; ONLINE and Coop stay Gearless', () => {
  const healGear = makeGear('resume-heal', 'auxiliary', 'heal_power'); const snapshot = start([healGear]);
  assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), storage); kt.setPhase('title');
  assert.equal(kt.resumeCpuSuspendForTest(), true); assert.equal(kt.cpuBattleGearSnapshotForTest().derivedStats.healingMultiplier, snapshot.derivedStats.healingMultiplier);
  const p1 = kt.unitById('p1'); kt.setUnitHpForTest('p1', 1); const expected = Math.round(combat.finalHealing(20, snapshot.derivedStats.healingMultiplier, snapshot.derivedStats.receivedHealingMultiplier));
  assert.equal(self(20).actualHealing, expected);
  kt.setOnlineForCpuGearEligibilityForTest({ kind: 'firebase' }); kt.setUnitHpForTest('p1', 1); assert.equal(self(20).actualHealing, 20);
  kt.setOnlineForCpuGearEligibilityForTest(null); kt.setBattleModeForTest('coop'); kt.setUnitHpForTest('p1', 1); assert.equal(self(20).actualHealing, 20);
});

console.log(`gear-battle-healing-phase3c3c2: ${passed}/${passed} passed`);
