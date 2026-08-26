const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const domain = globalThis.KatamonGearDomain;
const combat = globalThis.KatamonGearCombat;
const gearStorage = globalThis.KatamonGearStorage;
const presets = globalThis.KatamonGearPresets;
const presetStorage = globalThis.KatamonGearPresetStorage;

let passed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`  ok ${name}`); } catch (error) { console.error(`  NG ${name}`); throw error; } }

function reset() {
  storage.clear();
  storage.gearMutationLockManager = globalThis.navigator.locks;
  kt.setHasSave(false); kt.setPhase('title');
}

function makeGear(id, slotId, setId = 'assault', requiredMainOp = null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const gear = domain.createGear({
    gearId: id,
    generationSeed: `phase3c2a:${id}:generation:${attempt}`, enhancementSeed: `phase3c2a:${id}:enhancement`,
    sourceId: 'cpu_battle', sourceDetail: { fixture: 'phase3c2a' }, acquiredAt: '2026-08-26T00:00:00Z',
    qualityProfile: { id: 'phase3c2a', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: 'phase3c2a', setWeights: [{ id: setId, weight: 1 }] }, slotId,
  });
    if (requiredMainOp === null || gear.mainOp.opId === requiredMainOp) return gear;
  }
  throw new Error(`could not make ${slotId}/${requiredMainOp} fixture`);
}

function installPreset(gears) {
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = gears.map((gear) => ({ gear, locked: false, favorite: false }));
  gearStorage.saveGearState(state, storage);
  let statePresets = presetStorage.load(storage, { characterIds: kt.chars() });
  for (const gear of gears) {
    statePresets = presets.setPresetSlot(statePresets, {
      characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: kt.chars()
    });
  }
  presetStorage.save(statePresets, storage, { characterIds: kt.chars() });
}

function normalDamage({ gears = [], ownerId = 'p1', targetId = 'e1', direct = true }) {
  reset(); if (gears.length) installPreset(gears); assert.equal(kt.startBattle('kyoryu'), true);
  const target = kt.unitById(targetId); const before = target.hp;
  kt.explodeAtForTest(target.x, target.y, 1, ownerId, true, { gearDamageProfile: 'normal_cannonball', directTargetId: direct ? targetId : 'other', radius: 5 });
  return { damage: before - target.hp, snapshot: kt.cpuBattleGearSnapshotForTest(), targetMaxHp: target.maxHp };
}

function expected(baseDamage, attackerCombat, defenderCombat, damageType) {
  const outgoing = attackerCombat ? combat.conditionalDamageModifiers({ combat: attackerCombat, damageType }) : { outgoingDamageBp: 0 };
  const incoming = defenderCombat ? combat.conditionalDamageModifiers({ combat: defenderCombat, damageType }) : { incomingDamageReductionBp: 0 };
  return Math.max(1, Math.round(combat.calculateDamagePipeline({
    baseDamage,
    attackMultiplier: attackerCombat ? attackerCombat.attackMultiplier : 1,
    modifierBp: outgoing.outgoingDamageBp,
    isCrit: false,
    defenseMultiplier: defenderCombat ? defenderCombat.defenseMultiplier : 1,
    damageReductionBp: incoming.incomingDamageReductionBp,
    numericShield: 0,
    hp: 999,
  }).hpDamage));
}

test('Gearless direct and normal-blast damage retain the 3C-1 CPU baseline in both directions', () => {
  const humanDirect = normalDamage({ ownerId: 'p1', targetId: 'e1', direct: true });
  const humanBlast = normalDamage({ ownerId: 'p1', targetId: 'e1', direct: false });
  const cpuDirect = normalDamage({ ownerId: 'e1', targetId: 'p1', direct: true });
  const cpuBlast = normalDamage({ ownerId: 'e1', targetId: 'p1', direct: false });
  assert.equal(humanDirect.damage, 45); assert.equal(humanBlast.damage, 45);
  assert.equal(cpuDirect.damage, 45); assert.equal(cpuBlast.damage, 45);
});

test('human Attack is applied exactly once to direct and normal-blast damage', () => {
  const baseline = normalDamage({ ownerId: 'p1', direct: true }).damage;
  const barrel = makeGear('phase3c2a-attack-barrel', 'barrel');
  const direct = normalDamage({ gears: [barrel], ownerId: 'p1', direct: true });
  const blast = normalDamage({ gears: [barrel], ownerId: 'p1', direct: false });
  assert.equal(direct.damage, expected(baseline, direct.snapshot.derivedStats, null, 'direct_projectile'));
  assert.equal(blast.damage, expected(baseline, blast.snapshot.derivedStats, null, 'normal_blast'));
  assert.equal(direct.damage, Math.round(baseline * direct.snapshot.derivedStats.attackMultiplier));
});

test('human Defense is applied exactly once to incoming direct and normal-blast damage', () => {
  const baseline = normalDamage({ ownerId: 'e1', targetId: 'p1', direct: true }).damage;
  const core = makeGear('phase3c2a-defense-core', 'core', 'fortify');
  const direct = normalDamage({ gears: [core], ownerId: 'e1', targetId: 'p1', direct: true });
  const blast = normalDamage({ gears: [core], ownerId: 'e1', targetId: 'p1', direct: false });
  assert.equal(direct.damage, expected(baseline, null, direct.snapshot.derivedStats, 'direct_projectile'));
  assert.equal(blast.damage, expected(baseline, null, blast.snapshot.derivedStats, 'normal_blast'));
});

test('assault 4pc adds its direct-only bucket after static Attack, without double-counting assault 2pc', () => {
  const gears = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => makeGear(`phase3c2a-assault-${slot}`, slot, 'assault'));
  const direct = normalDamage({ gears, ownerId: 'p1', direct: true });
  const blast = normalDamage({ gears, ownerId: 'p1', direct: false });
  const base = normalDamage({ ownerId: 'p1', direct: true }).damage;
  assert.equal(direct.damage, expected(base, direct.snapshot.derivedStats, null, 'direct_projectile'));
  assert.equal(blast.damage, expected(base, blast.snapshot.derivedStats, null, 'normal_blast'));
  assert.equal(direct.snapshot.derivedStats.conditional.directHitDamageBp, 1200);
  assert.equal(blast.snapshot.derivedStats.conditional.directHitDamageBp, 1200);
  assert(direct.damage > blast.damage, 'assault4 must not apply to normal blast');
});

test('fortify 4pc reduces only direct incoming damage after static Defense and remains inside the 40% bucket', () => {
  const gears = ['barrel', 'armor', 'core', 'engine'].map((slot) => makeGear(`phase3c2a-fortify-${slot}`, slot, 'fortify'));
  const direct = normalDamage({ gears, ownerId: 'e1', targetId: 'p1', direct: true });
  const blast = normalDamage({ gears, ownerId: 'e1', targetId: 'p1', direct: false });
  const base = normalDamage({ ownerId: 'e1', targetId: 'p1', direct: true }).damage;
  assert.equal(direct.damage, expected(base, null, direct.snapshot.derivedStats, 'direct_projectile'));
  assert.equal(blast.damage, expected(base, null, blast.snapshot.derivedStats, 'normal_blast'));
  assert.equal(direct.snapshot.derivedStats.conditional.directHitTakenReductionBp, 1200);
  assert(direct.damage < blast.damage, 'fortify4 must not apply to normal blast');
});

test('Attack and Defense compose once through the shared Phase 3B pipeline', () => {
  const resolved = combat.calculateDamagePipeline({
    baseDamage: 100, attackMultiplier: 1.2, modifierBp: 0, isCrit: false,
    defenseMultiplier: 0.9, damageReductionBp: 0, numericShield: 0, hp: 999,
  });
  assert.equal(resolved.hpDamage, 108, '100 x 1.2 x 0.9 must not duplicate either multiplier');
});

test('Damage Reduction keeps the shared 40% cap before the existing HP boundary', () => {
  const resolved = combat.calculateDamagePipeline({
    baseDamage: 100, attackMultiplier: 1, modifierBp: 0, isCrit: false,
    defenseMultiplier: 1, damageReductionBp: 5000, numericShield: 0, hp: 999,
  });
  assert.equal(resolved.hpDamage, 60);
});

test('Crit, Blast, KB, rescue and last-stand runtime remain inert in 3C-2A', () => {
  const critical = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => makeGear(`phase3c2a-critical-${slot}`, slot, 'critical'));
  const blast = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => makeGear(`phase3c2a-blast-${slot}`, slot, 'blast'));
  const lastStand = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => makeGear(`phase3c2a-last-${slot}`, slot, 'last_stand'));
  const baseline = normalDamage({ ownerId: 'p1', direct: true }).damage;
  const criticalHit = normalDamage({ gears: critical, ownerId: 'p1', direct: true });
  const blastHit = normalDamage({ gears: blast, ownerId: 'p1', direct: false });
  const lastStandHit = normalDamage({ gears: lastStand, ownerId: 'p1', direct: true });
  assert.equal(criticalHit.damage, expected(baseline, criticalHit.snapshot.derivedStats, null, 'direct_projectile'));
  assert.equal(blastHit.damage, expected(baseline, blastHit.snapshot.derivedStats, null, 'normal_blast'));
  assert.equal(lastStandHit.damage, expected(baseline, lastStandHit.snapshot.derivedStats, null, 'direct_projectile'));
  assert.equal(criticalHit.snapshot.derivedStats.critRateBp > 0, true);
  assert.equal(blastHit.snapshot.derivedStats.blastPowerBp > 0, true);
  assert.equal(lastStandHit.snapshot.initialRuntimeState.lastStandNextAttackDamageBp, 0);
});

test('CPU attack stays Gearless and the 3C-1 HP/Fuel snapshot remains applied', () => {
  const gears = [makeGear('phase3c2a-hp-armor', 'armor', 'life'), makeGear('phase3c2a-fuel-engine', 'engine', 'life', 'max_fuel')];
  const incoming = normalDamage({ gears, ownerId: 'e1', targetId: 'p1', direct: true });
  const baseline = normalDamage({ ownerId: 'e1', targetId: 'p1', direct: true }).damage;
  assert.equal(incoming.damage, baseline, 'CPU has no Attack Gear');
  assert.equal(incoming.targetMaxHp, incoming.snapshot.derivedStats.maxHp);
  assert.equal(incoming.snapshot.derivedStats.maxFuel > kt.cpuBattleBaseStatsForTest('kyoryu').baseFuel, true);
});

test('Attack/Defense are match-fixed, resume from the saved snapshot, and fresh-capture only on the next CPU match', () => {
  reset();
  const barrel = makeGear('phase3c2a-fixed-barrel', 'barrel', 'assault');
  installPreset([barrel]); assert.equal(kt.startBattle('kyoryu'), true);
  const first = kt.cpuBattleGearSnapshotForTest();
  const upgradedLoadout = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => slot === 'barrel' ? barrel : makeGear(`phase3c2a-fixed-${slot}`, slot, 'assault'));
  installPreset(upgradedLoadout);
  const target = kt.unitById('e1'); const hpBefore = target.hp;
  kt.explodeAtForTest(target.x, target.y, 1, 'p1', true, { gearDamageProfile: 'normal_cannonball', directTargetId: 'e1', radius: 5 });
  assert.equal(hpBefore - target.hp, expected(45, first.derivedStats, null, 'direct_projectile'));
  assert.deepEqual(kt.cpuBattleGearSnapshotForTest(), first, 'storage changes cannot alter this match');
  assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true);
  gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), storage);
  kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true);
  assert.equal(kt.cpuBattleGearSnapshotForTest().derivedStats.attackMultiplier, first.derivedStats.attackMultiplier);
  installPreset(upgradedLoadout);
  assert.equal(kt.continueCpuGearRunAfterWinForTest(), true);
  const next = kt.cpuBattleGearSnapshotForTest();
  assert(next.derivedStats.attackMultiplier > first.derivedStats.attackMultiplier, 'next CPU match captures the updated assault4 preset');
});

test('high Crit and Blast capability add no random stream or terrain/range behavior in 3C-2A', () => {
  const run = (gears) => {
    reset(); if (gears.length) installPreset(gears); assert.equal(kt.startBattle('kyoryu'), true);
    const target = kt.unitById('e1'); const oldRandom = Math.random; let calls = 0;
    Math.random = () => { calls += 1; return 0.25; };
    try {
      kt.explodeAtForTest(target.x, target.y, 1, 'p1', true, { gearDamageProfile: 'normal_cannonball', directTargetId: 'other', radius: 5 });
      return { calls, ground: kt.groundYAt(target.x), snapshot: kt.cpuBattleGearSnapshotForTest() };
    } finally { Math.random = oldRandom; }
  };
  const none = run([]);
  const highCritBlast = ['barrel', 'armor', 'sight', 'auxiliary'].map((slot) => makeGear(`phase3c2a-inert-${slot}`, slot, slot === 'sight' ? 'critical' : 'blast'));
  const equipped = run(highCritBlast);
  assert.equal(equipped.calls, none.calls, 'Crit adds no random calls before 3C-2B');
  assert.equal(equipped.ground, none.ground, 'Blast capability does not change terrain range before 3C-2B');
  assert(equipped.snapshot.derivedStats.critRateBp > 0 || equipped.snapshot.derivedStats.blastPowerBp > 0);
});

console.log(`gear-battle-damage-phase3c2a: ${passed}/11 passed`);
