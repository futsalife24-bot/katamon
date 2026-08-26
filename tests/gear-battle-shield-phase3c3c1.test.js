const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const domain = globalThis.KatamonGearDomain;
const gearStorage = globalThis.KatamonGearStorage;
const presets = globalThis.KatamonGearPresets;
const presetStorage = globalThis.KatamonGearPresetStorage;
const combat = globalThis.KatamonGearCombat;
const rng = globalThis.KatamonGearBattleRng;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }
function close(actual, expected) { assert(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`); }
function reset() { storage.clear(); storage.gearMutationLockManager = globalThis.navigator.locks; kt.setHasSave(false); kt.setPhase('title'); }
function lifeGear(id, slotId) {
  return domain.createGear({
    gearId: id, generationSeed: `${id}:generation`, enhancementSeed: `${id}:enhancement`, sourceId: 'cpu_battle',
    sourceDetail: { fixture: 'phase3c3c1' }, acquiredAt: '2026-08-26T00:00:00Z',
    qualityProfile: { id: 'phase3c3c1', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: 'phase3c3c1', setWeights: [{ id: 'life', weight: 1 }] }, slotId,
  });
}
function installLife(count) {
  const gears = ['barrel', 'armor', 'core', 'engine'].slice(0, count).map((slot) => lifeGear(`life-${slot}`, slot));
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = gears.map((gear) => ({ gear, locked: false, favorite: false }));
  gearStorage.saveGearState(state, storage);
  let preset = presetStorage.load(storage, { characterIds: kt.chars() });
  for (const gear of gears) preset = presets.setPresetSlot(preset, { characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: kt.chars() });
  presetStorage.save(preset, storage, { characterIds: kt.chars() });
}
function start(lifePieces = 0) { reset(); if (lifePieces) installLife(lifePieces); assert.equal(kt.startBattle('kyoryu'), true); return kt.cpuBattleGearSnapshotForTest(); }
function shield() { return kt.cpuGearShieldStateForTest(); }
function hit(owner = 'e1', directTargetId = 'p1') { const p1 = kt.unitById('p1'); const hp = p1.hp; kt.explodeAtForTest(p1.x, p1.y, 1, owner, true, { gearDamageProfile: 'normal_cannonball', directTargetId, radius: 5 }); return hp - p1.hp; }

test('Gearless and Life 2pc start with no Numeric Shield while Life 4pc uses the Phase 3B initial-shield contract', () => {
  start(0); assert.equal(shield().currentShield, 0);
  const life2 = start(2); assert.equal(shield().currentShield, 0); assert(life2.derivedStats.maxHp > kt.cpuBattleBaseStatsForTest('kyoryu').baseHp);
  const life4 = start(4); const expected = combat.initialShieldFromSets(life4.derivedStats);
  close(shield().currentShield, expected.shieldAfter); assert(expected.shieldAfter > 0);
});

test('Life 4pc applies source and received Shield multipliers once and cap remains 35% max HP', () => {
  const snapshot = start(4); const initial = combat.initialShieldFromSets(snapshot.derivedStats);
  close(shield().currentShield, initial.shieldAfter); assert(initial.shieldAfter <= snapshot.derivedStats.maxHp * 0.35);
  const capped = combat.applyNumericShield({ currentShield: snapshot.derivedStats.maxHp * .34, baseShield: snapshot.derivedStats.maxHp, maxHp: snapshot.derivedStats.maxHp, sourceMultiplier: snapshot.derivedStats.shieldMultiplier, targetMultiplier: snapshot.derivedStats.receivedShieldMultiplier });
  close(capped.shieldAfter, snapshot.derivedStats.maxHp * .35);
});

test('normal direct and blast consume Numeric Shield before HP', () => {
  start(4); const beforeDirect = shield().currentShield; const hp = kt.unitById('p1').hp;
  const directDamage = hit('e1', 'p1'); assert(directDamage >= 0); assert(shield().currentShield < beforeDirect); assert(kt.unitById('p1').hp <= hp);
  start(4); const beforeBlast = shield().currentShield; const blastDamage = hit('e1', 'other'); assert(blastDamage >= 0); assert(shield().currentShield < beforeBlast);
});

test('full absorption preserves existing Barrier, while a later residual is the only damage Barrier receives', () => {
  start(4); const p1 = kt.unitById('p1'); kt.setCpuGearShieldForTest(100); kt.setSubweaponBarrierForTest('p1', true);
  assert.equal(hit(), 0); assert.equal(p1.subweaponBarrierActive, true);
  while (shield().currentShield >= 45) hit();
  const damage = hit(); assert(damage > 0); assert.equal(p1.subweaponBarrierActive, false);
});

test('fractional Shield residual reaches Barrier before the single integer boundary', () => {
  start(4); const p1 = kt.unitById('p1'); kt.setCpuGearShieldForTest(.5); kt.setSubweaponBarrierForTest('p1', true);
  assert.equal(hit(), 22, 'round((45 - 0.5) * 0.5) must retain the fractional Shield absorption');
  assert.equal(shield().currentShield, 0); assert.equal(p1.subweaponBarrierActive, false);
});

test('EMP damage, hostile ground flame, and hostile firework shards consume shield without changing EMP status semantics', () => {
  const snapshot = start(4); const p1 = kt.unitById('p1'); let before = shield().currentShield;
  const status = kt.cpuGearStatusStateForTest(); const roll = rng.rollStatusBasisPoints({ namespace: rng.GEAR_STATUS_RNG_NAMESPACE, version: rng.GEAR_BATTLE_RNG_VERSION, runId: status.runId, matchOrdinal: status.matchOrdinal, actionOrdinal: 0, sourceUnitId: 'e1', targetUnitId: 'p1', statusId: 'move_lock', hitOrdinal: 0 });
  const applies = roll < combat.statusSuccessChance(10000, snapshot.derivedStats.statusResistanceBp);
  kt.emitEmpForTest(p1.x, p1.y, 100, 'e1', 2, 0); assert(shield().currentShield < before); assert.equal(kt.turnEffectForTest('p1').moveLockTurns, applies ? 2 : 0);
  start(4); before = shield().currentShield; const flameTarget = kt.unitById('p1'); kt.damageGroundFlameForTest(flameTarget.x, flameTarget.y, 'e1'); assert(shield().currentShield < before);
  start(4); before = shield().currentShield; const shardTarget = kt.unitById('p1'); kt.fireworkShardExplodeForTest(shardTarget.x, shardTarget.y, 'e1'); assert(shield().currentShield < before);
});

test('self and unknown environmental owners never consume Numeric Shield, and shield damage is not HP actual damage', () => {
  start(4); const initial = shield().currentShield; const hp = kt.unitById('p1').hp;
  hit('p1'); assert.equal(shield().currentShield, initial);
  kt.damageGroundFlameForTest(kt.unitById('p1').x, kt.unitById('p1').y, null); assert.equal(shield().currentShield, initial);
  assert(kt.unitById('p1').hp < hp, 'excluded damage remains ordinary HP damage');
});

test('shield state is match-fixed, persists exact remaining value, and never re-fires Life 4pc on resume', () => {
  const snapshot = start(4); hit(); const remaining = shield().currentShield; gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), storage);
  close(shield().currentShield, remaining);
  assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true, kt.cpuGearPersistenceForTest().status);
  close(shield().currentShield, remaining); assert.equal(kt.cpuBattleGearSnapshotForTest().derivedStats.maxHp, snapshot.derivedStats.maxHp);
});

test('legacy suspend restores zero shield, current malformed shield state fails closed, and next match starts fresh', () => {
  start(4); assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); const legacy = JSON.parse(storage.getItem('katamon_suspend_v1'));
  delete legacy.cpuGearShieldState; delete legacy.cpuGearShieldStateVersion; storage.setItem('katamon_suspend_v1', JSON.stringify(legacy)); kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true); assert.equal(shield().currentShield, 0);
  start(4); assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); const malformed = JSON.parse(storage.getItem('katamon_suspend_v1')); malformed.cpuGearShieldState.currentShield = Infinity; storage.setItem('katamon_suspend_v1', JSON.stringify(malformed)); kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), false);
  const first = start(4); hit(); kt.setWinStreakForTest(1); assert.equal(kt.continueCpuGearRunAfterWinForTest(), true); close(shield().currentShield, combat.initialShieldFromSets(kt.cpuBattleGearSnapshotForTest().derivedStats).shieldAfter); assert.notEqual(shield().currentShield, 0); assert.equal(first.version, 1);
});

test('current Shield suspend state strictly fences version, ownership, match, cap, and shape', () => {
  const reject = (mutate) => {
    start(4); assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); const raw = JSON.parse(storage.getItem('katamon_suspend_v1')); mutate(raw); storage.setItem('katamon_suspend_v1', JSON.stringify(raw)); kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), false);
  };
  reject((raw) => { raw.cpuGearShieldState.runId = 'other-run'; });
  reject((raw) => { raw.cpuGearShieldState.matchOrdinal += 1; });
  reject((raw) => { raw.cpuGearShieldState.version = 2; });
  reject((raw) => { raw.cpuGearShieldState.currentShield = raw.cpuBattleGearSnapshot.derivedStats.maxHp * .35 + 1; });
  reject((raw) => { raw.cpuGearShieldState.extra = true; });
  reject((raw) => { delete raw.cpuGearShieldStateVersion; });
  reject((raw) => { delete raw.cpuBattleGearSnapshot; delete raw.cpuBattleGearSnapshotVersion; });
});

test('ONLINE and Coop never consume the CPU-only Numeric Shield, and Shield adds no random calls', () => {
  start(4); const initial = shield().currentShield; kt.setOnlineForCpuGearEligibilityForTest({ kind: 'firebase' }); hit(); assert.equal(shield().currentShield, initial);
  kt.setOnlineForCpuGearEligibilityForTest(null); kt.setBattleModeForTest('coop'); hit(); assert.equal(shield().currentShield, initial);
  const count = (life) => { start(life ? 4 : 0); const old = Math.random; let calls = 0; Math.random = () => { calls += 1; return .5; }; try { hit(); return calls; } finally { Math.random = old; } };
  assert.equal(count(true), count(false));
});

console.log(`gear-battle-shield-phase3c3c1: ${passed}/${passed} passed`);
