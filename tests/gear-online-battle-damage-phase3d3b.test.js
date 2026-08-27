const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const gearCombat = require('../shared/gear-combat.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const onlineProtocol = require('../shared/gear-online-protocol.js');
const lobbyProtocol = require('../shared/gear-online-lobby-protocol.js');
const battleStart = require('../shared/gear-online-battle-start.js');
const onlineDamage = require('../shared/gear-online-battle-damage.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobbyProtocol.createRoomGearCapability({
  visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1
});
const slotIds = domain.SLOT_IDS;
let passed = 0;
const cases = [];
const test = (name, fn) => { cases.push([name, fn]); };
const clone = (value) => JSON.parse(JSON.stringify(value));

function onlineFixture({ gear = true, format = '1v1' } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1,
      ...(gear ? { gearCapability: capability } : {})
    },
    slots: {
      p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 },
      s1: null, s2: null
    },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu'
  };
}

function makeGear(gearId, slotId, setId = 'life') {
  return domain.createGear({
    gearId,
    generationSeed: `3d3b:${gearId}:generation`,
    enhancementSeed: `3d3b:${gearId}:enhancement`,
    sourceId: 'cpu_battle',
    sourceDetail: { fixture: '3d3b' },
    acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: '3d3b-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: '3d3b-set', setWeights: [{ id: setId, weight: 1 }] },
    slotId
  });
}

function setGears(prefix, setId, slots) {
  return slots.map((slotId) => makeGear(`${prefix}-${slotId}`, slotId, setId));
}

function createReveal(seat, characterId, gears = [], presetId = 'preset1') {
  const trustedContext = wiring.trustedContext(seat, characterId);
  const slots = Object.fromEntries(slotIds.map((slotId) => [slotId, null]));
  for (const gear of gears) slots[gear.slotId] = gear;
  const snapshot = battleSnapshot.createBattleGearSnapshot({
    resolvedLoadout: {
      characterId,
      presetId,
      gearIds: slotIds.map((slotId) => slots[slotId]?.gearId).filter(Boolean),
      slots
    },
    baseHp: trustedContext.baseHp,
    baseFuel: trustedContext.baseFuel
  });
  const revealedCommitment = onlineProtocol.createLoadoutCommitment({
    battleGearSnapshot: snapshot, roundId, trustedContext
  });
  return Object.freeze({ trustedContext, revealedCommitment });
}

function prepareUnits(p1Character = 'kyoryu', e1Character = 'iwa') {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest(p1Character, e1Character);
  h.resetMatchForTest();
  kt.setCharactersForTest(p1Character, e1Character);
}

function installBattle({ p1Gears = [], e1Gears = [], p1Character = 'kyoryu', e1Character = 'iwa' } = {}) {
  const current = onlineFixture();
  h.setOnlineForLogTest(current);
  const reveals = [
    createReveal('p1', p1Character, p1Gears),
    createReveal('e1', e1Character, e1Gears)
  ];
  const manifest = lobbyProtocol.createStartGearManifest({
    roundId,
    commitments: reveals.map((entry) => entry.revealedCommitment),
    participantReveals: reveals
  });
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  const state = battleStart.createOnlineGearBattleStartState({
    matchFormat: '1v1', manifest, participantReveals: reveals
  });
  prepareUnits(p1Character, e1Character);
  wiring.applyBattleStartState(state);
  return { current, reveals, manifest, state };
}

function expectedDamage(baseDamage, damageType, attackerCombat, defenderCombat, hp = 9999) {
  const outgoing = attackerCombat
    ? gearCombat.conditionalDamageModifiers({ combat: attackerCombat, damageType })
    : { outgoingDamageBp: 0 };
  const incoming = defenderCombat
    ? gearCombat.conditionalDamageModifiers({ combat: defenderCombat, damageType })
    : { incomingDamageReductionBp: 0 };
  return Math.max(1, Math.round(gearCombat.calculateDamagePipeline({
    baseDamage,
    attackMultiplier: attackerCombat ? attackerCombat.attackMultiplier : 1,
    modifierBp: outgoing.outgoingDamageBp,
    isCrit: false,
    defenseMultiplier: defenderCombat ? defenderCombat.defenseMultiplier : 1,
    damageReductionBp: incoming.incomingDamageReductionBp,
    numericShield: 0,
    hp
  }).hpDamage));
}

function runtimeNormalHit({ direct, ownerId = 'p1', targetId = 'e1' }) {
  const target = kt.unitById(targetId);
  const before = target.hp;
  kt.explodeAtForTest(target.x, target.y, 1, ownerId, true, {
    gearDamageProfile: 'normal_cannonball',
    directTargetId: direct ? targetId : 'other',
    radius: 5
  });
  return before - target.hp;
}

test('Gearless ONLINE and Gear OFF keep direct/blast historical damage and RNG-free dispatcher behavior', () => {
  installBattle();
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45), 45);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'normal_blast', 45), 45);
  assert.equal(runtimeNormalHit({ direct: true }), 45);
  installBattle();
  assert.equal(runtimeNormalHit({ direct: false }), 45);

  h.setOnlineForLogTest(onlineFixture({ gear: false }));
  prepareUnits();
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45), 45);
  assert.equal(runtimeNormalHit({ direct: true }), 45);

  installBattle();
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0.5; };
  try { wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45); } finally { Math.random = originalRandom; }
  assert.equal(randomCalls, 0);
});

test('p1 and e1 static Attack apply exactly once to direct and normal blast', () => {
  const p1Gears = setGears('p1-assault2', 'assault', ['barrel', 'sight']);
  const e1Gears = setGears('e1-assault2', 'assault', ['barrel', 'sight']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    assert(attacker.flatAttack > 0 && attacker.staticAttackPctBp > 0);
    for (const damageType of ['direct_projectile', 'normal_blast']) {
      assert.equal(wiring.requestedDamage(ownerId, targetId, damageType, 45),
        expectedDamage(45, damageType, attacker, defender));
    }
  }
});

test('p1 and e1 static Defense apply exactly once to direct and normal blast', () => {
  const p1Gears = setGears('p1-fortify2', 'fortify', ['core', 'engine']);
  const e1Gears = setGears('e1-fortify2', 'fortify', ['core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    assert(defender.effectiveDefense > gearCombat.BASE_DEFENSE && defender.defenseMultiplier < 1);
    for (const damageType of ['direct_projectile', 'normal_blast']) {
      assert.equal(wiring.requestedDamage(ownerId, targetId, damageType, 45),
        expectedDamage(45, damageType, attacker, defender));
    }
  }
});

test('Attack and Defense compose through the shared pipeline in both directions', () => {
  const p1Gears = [
    ...setGears('p1-assault', 'assault', ['barrel', 'sight']),
    ...setGears('p1-fortify', 'fortify', ['core', 'engine'])
  ];
  const e1Gears = [
    ...setGears('e1-assault', 'assault', ['barrel', 'sight']),
    ...setGears('e1-fortify', 'fortify', ['core', 'engine'])
  ];
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    assert.equal(wiring.requestedDamage(ownerId, targetId, 'direct_projectile', 45),
      expectedDamage(45, 'direct_projectile', attacker, defender));
  }
});

test('Assault 4 applies direct +12% only and never double-counts Assault 2 static Attack', () => {
  const p1Gears = setGears('p1-assault4', 'assault', ['barrel', 'armor', 'sight', 'auxiliary']);
  const { state } = installBattle({ p1Gears });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  assert.equal(attacker.conditional.directHitDamageBp, 1200);
  const direct = wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45);
  const blast = wiring.requestedDamage('p1', 'e1', 'normal_blast', 45);
  assert.equal(direct, expectedDamage(45, 'direct_projectile', attacker, defender));
  assert.equal(blast, expectedDamage(45, 'normal_blast', attacker, defender));
  assert(direct > blast);
});

test('Fortify 4 reduces direct by 12% only, without double-counting Fortify 2 Defense', () => {
  const e1Gears = setGears('e1-fortify4', 'fortify', ['barrel', 'armor', 'core', 'engine']);
  const { state } = installBattle({ e1Gears });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  assert.equal(defender.conditional.directHitTakenReductionBp, 1200);
  const direct = wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45);
  const blast = wiring.requestedDamage('p1', 'e1', 'normal_blast', 45);
  assert.equal(direct, expectedDamage(45, 'direct_projectile', attacker, defender));
  assert.equal(blast, expectedDamage(45, 'normal_blast', attacker, defender));
  assert(direct < blast);
});

test('ONLINE resolver preserves the shared 40% Damage Reduction cap', () => {
  const { state } = installBattle();
  const defender = clone(state.battleGearSnapshotsByUnit.e1.derivedStats);
  defender.defenseMultiplier = 1;
  defender.conditional.directHitTakenReductionBp = 9999;
  assert.equal(onlineDamage.calculateOnlineGearStaticRequestedDamage({
    existingBaseDamage: 100,
    damageType: 'direct_projectile',
    attackerCombat: null,
    defenderCombat: defender,
    targetHp: 100
  }), 60);
});

test('Crit, Blast and every later Gear field stay inert and consume no RNG', () => {
  const { state } = installBattle();
  const baseAttacker = clone(state.battleGearSnapshotsByUnit.p1.derivedStats);
  const baseDefender = clone(state.battleGearSnapshotsByUnit.e1.derivedStats);
  const expected = onlineDamage.calculateOnlineGearStaticRequestedDamage({
    existingBaseDamage: 45, damageType: 'normal_blast', attackerCombat: baseAttacker, defenderCombat: baseDefender, targetHp: 1
  });
  const attacker = clone(baseAttacker);
  Object.assign(attacker, {
    critRateBp: 10000, critDamageMultiplier: 99, blastDamageMultiplier: 99, blastRangeMultiplier: 99,
    knockbackPowerBp: 999999, statusResistanceBp: 999999, healingMultiplier: 99, shieldMultiplier: 99
  });
  Object.assign(attacker.conditional, {
    lastStandLowHpAttackBp: 9999, lastStandNextAttackDamageBp: 9999,
    rescueNextAttackDamageBp: 9999, lifeInitialShieldBp: 9999
  });
  const defender = clone(baseDefender);
  Object.assign(defender, {
    knockbackResistanceBp: 999999, statusResistanceBp: 999999,
    receivedHealingMultiplier: 99, receivedShieldMultiplier: 99
  });
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0; };
  let actual;
  try {
    actual = onlineDamage.calculateOnlineGearStaticRequestedDamage({
      existingBaseDamage: 45, damageType: 'normal_blast', attackerCombat: attacker, defenderCombat: defender, targetHp: 1
    });
  } finally { Math.random = originalRandom; }
  assert.equal(actual, expected);
  assert.equal(randomCalls, 0);
  const source = onlineDamage.calculateOnlineGearStaticRequestedDamage.toString();
  assert.match(source, /isCrit:\s*false/);
  assert.doesNotMatch(source, /blastDamageMultiplier|blastRangeMultiplier|Math\.random|resolveRuntimeEffects|beginAttackAction/);
});

test('same immutable snapshots produce identical host/guest requested damage in both directions', () => {
  const p1Gears = setGears('p1-host-guest', 'assault', ['barrel', 'armor', 'sight', 'auxiliary']);
  const e1Gears = setGears('e1-host-guest', 'fortify', ['barrel', 'armor', 'core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    for (const damageType of ['direct_projectile', 'normal_blast']) {
      const host = onlineDamage.calculateOnlineGearStaticRequestedDamage({
        existingBaseDamage: 37.25,
        damageType,
        attackerCombat: state.battleGearSnapshotsByUnit[ownerId].derivedStats,
        defenderCombat: state.battleGearSnapshotsByUnit[targetId].derivedStats,
        targetHp: 100
      });
      const guestSnapshots = clone(state.battleGearSnapshotsByUnit);
      const guest = onlineDamage.calculateOnlineGearStaticRequestedDamage({
        existingBaseDamage: 37.25,
        damageType,
        attackerCombat: guestSnapshots[ownerId].derivedStats,
        defenderCombat: guestSnapshots[targetId].derivedStats,
        targetHp: 100
      });
      assert.equal(guest, host);
    }
  }
});

test('normal direct and normal blast runtime routes use ONLINE static Attack/Defense exactly once', () => {
  const p1Gears = setGears('p1-runtime', 'assault', ['barrel', 'sight']);
  const e1Gears = setGears('e1-runtime', 'fortify', ['core', 'engine']);
  let setup = installBattle({ p1Gears, e1Gears });
  const directExpected = expectedDamage(45, 'direct_projectile',
    setup.state.battleGearSnapshotsByUnit.p1.derivedStats, setup.state.battleGearSnapshotsByUnit.e1.derivedStats);
  assert.equal(runtimeNormalHit({ direct: true }), Math.min(directExpected, setup.state.hpFuelByUnit.e1.hp));
  setup = installBattle({ p1Gears, e1Gears });
  const blastExpected = expectedDamage(45, 'normal_blast',
    setup.state.battleGearSnapshotsByUnit.p1.derivedStats, setup.state.battleGearSnapshotsByUnit.e1.derivedStats);
  assert.equal(runtimeNormalHit({ direct: false }), Math.min(blastExpected, setup.state.hpFuelByUnit.e1.hp));
});

test('existing Cool Kai direct-projectile handler uses the same mode-aware boundary at runtime', () => {
  const p1Gears = setGears('p1-onigiri', 'assault', ['barrel', 'sight']);
  const e1Gears = setGears('e1-onigiri', 'fortify', ['core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears, p1Character: 'coolKai' });
  kt.clearProjectilesForTest();
  kt.fireSpecialImmediateForUnitForTest('p1', 'coolKai', 220, -100);
  assert.equal(kt.projectileProfilesForTest().length, 47);
  const target = kt.unitById('e1');
  const before = target.hp;
  const expected = expectedDamage(6, 'direct_projectile',
    state.battleGearSnapshotsByUnit.p1.derivedStats, state.battleGearSnapshotsByUnit.e1.derivedStats);
  assert.equal(kt.resolveProjectileUnitImpactForTest(0, 'e1'), true);
  assert.equal(before - target.hp, Math.min(expected, before));
});

test('all five production damage callsites use the dispatcher while CPU keeps its complete helper', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal((index.match(/\bbattleGearRequestedDamage\(/g) || []).length, 6, 'definition + five production calls');
  assert.equal((index.match(/\bcpuGearRequestedDamage\(/g) || []).length, 2, 'definition + dispatcher fallback only');
  for (const name of [
    'resolveProjectileUnitImpact', 'resolvePrismBeamUnitImpact',
    'resolveCoolKaiOnigiriUnitImpact', 'resolveBarucopterBulletUnitImpact', 'explodeAt'
  ]) {
    const at = index.indexOf(`function ${name}`);
    const next = index.indexOf('\n  function ', at + 12);
    const block = index.slice(at, next < 0 ? undefined : next);
    assert.match(block, /battleGearRequestedDamage\(/, name);
  }
  assert.match(index, /const normalCannonCombat = techniqueProjectile\?\.gearDamageProfile === 'normal_cannonball'[\s\S]{0,120}cpuGearCombatForUnit/,
    'ONLINE Blast range must remain disconnected in Phase 3D-3B');
});

test('Gear ON 2v2 remains fail closed and the resolver accepts only approved static damage types', () => {
  const setup = installBattle();
  kt.setMatchFormatForTest('2v2');
  assert.throws(() => wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45),
    (error) => error?.code === 'ONLINE_GEAR_2V2_BATTLE_UNSUPPORTED');
  assert.throws(() => onlineDamage.calculateOnlineGearStaticRequestedDamage({
    existingBaseDamage: 45,
    damageType: 'status',
    attackerCombat: setup.state.battleGearSnapshotsByUnit.p1.derivedStats,
    defenderCombat: setup.state.battleGearSnapshotsByUnit.e1.derivedStats,
    targetHp: 100
  }), (error) => error?.code === 'INVALID_ONLINE_GEAR_STATIC_DAMAGE_TYPE');
});

test('browser and APP_SHELL load the ONLINE damage module after all dependencies', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert(index.indexOf('shared/gear-online-battle-start.js') < index.indexOf('shared/gear-online-battle-damage.js'));
  assert.equal(worker.includes("'./shared/gear-online-battle-damage.js'"), true);
});

async function main() {
  for (const [name, fn] of cases) {
    h.setOnlineForLogTest(null);
    try {
      await fn();
      passed += 1;
      console.log(`  ok ${name}`);
    } finally {
      h.setOnlineForLogTest(null);
      localStorage.clear();
    }
  }
  console.log(`gear-online-battle-damage-phase3d3b: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
