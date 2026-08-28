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
const onlineRng = require('../shared/gear-online-battle-rng.js');
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
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu',
    localAction: null, remoteAction: null
  };
}

function makeGear(gearId, slotId, setId = 'critical') {
  return domain.createGear({
    gearId,
    generationSeed: `3d4b:${gearId}:generation`,
    enhancementSeed: `3d4b:${gearId}:enhancement`,
    sourceId: 'cpu_battle',
    sourceDetail: { fixture: '3d4b' },
    acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: '3d4b-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: '3d4b-set', setWeights: [{ id: setId, weight: 1 }] },
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
  return Object.freeze({
    trustedContext,
    revealedCommitment: onlineProtocol.createLoadoutCommitment({
      battleGearSnapshot: snapshot, roundId, trustedContext
    })
  });
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
  return { current, state };
}

function critRoll(ownerId, targetId, damageType, turn) {
  const actionIdentity = onlineRng.createOnlineGearActionIdentity({
    version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
    roomId: 'A2BC3DEF', roundId, turnOrdinal: turn, sourceUnitId: ownerId
  });
  const identity = onlineRng.createCritRollIdentity({
    actionIdentity, targetUnitId: targetId, damageType, hitOrdinal: 0
  });
  return { actionIdentity, identity, rollBp: onlineRng.rollBasisPoints(identity) };
}

function findTurn(ownerId, targetId, damageType, predicate) {
  for (let turn = 0; turn < 50000; turn += 1) {
    const rolled = critRoll(ownerId, targetId, damageType, turn);
    if (predicate(rolled.rollBp)) return { turn, ...rolled };
  }
  throw new Error('deterministic Crit fixture turn not found');
}

function installAction(ownerId, turn, location = ownerId === 'p1' ? 'local' : 'remote', actionId = 'a'.repeat(32)) {
  kt.setTurnCountForTest(turn);
  return wiring.setCritActionForTest(ownerId, location, actionId);
}

function projectile(ownerId, profile = 'normal_cannonball') {
  return { owner: ownerId, gearDamageProfile: profile, directTargetId: null, radius: 5 };
}

function expectedDamage(baseDamage, damageType, attackerCombat, defenderCombat, isCrit, hp = 9999) {
  const outgoing = gearCombat.conditionalDamageModifiers({ combat: attackerCombat, damageType });
  const incoming = gearCombat.conditionalDamageModifiers({ combat: defenderCombat, damageType });
  return Math.max(1, Math.round(gearCombat.calculateDamagePipeline({
    baseDamage,
    attackMultiplier: attackerCombat.attackMultiplier,
    modifierBp: outgoing.outgoingDamageBp,
    isCrit,
    critDamageMultiplier: attackerCombat.critDamageMultiplier,
    defenseMultiplier: defenderCombat.defenseMultiplier,
    damageReductionBp: incoming.incomingDamageReductionBp,
    numericShield: 0,
    hp
  }).hpDamage));
}

test('Crit threshold is integer basis points with zero and equality remaining non-Crit', () => {
  assert.equal(onlineDamage.isOnlineGearCriticalHit({ rollBp: 0, critRateBp: 0 }), false);
  assert.equal(onlineDamage.isOnlineGearCriticalHit({ rollBp: 799, critRateBp: 800 }), true);
  assert.equal(onlineDamage.isOnlineGearCriticalHit({ rollBp: 800, critRateBp: 800 }), false);
  assert.throws(() => onlineDamage.isOnlineGearCriticalHit({ rollBp: 0, critRateBp: 800, actionId: 'forbidden' }),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_CRIT_ROLL_INPUT');
});

test('host/guest clones and different transport actionIds produce the same deterministic Crit result', () => {
  const p1Gears = setGears('p1-critical2', 'critical', ['barrel', 'sight']);
  const { current, state } = installBattle({ p1Gears });
  const rate = state.battleGearSnapshotsByUnit.p1.derivedStats.critRateBp;
  const fixture = findTurn('p1', 'e1', 'direct_projectile', (roll) => roll < rate);
  const localIdentity = installAction('p1', fixture.turn, 'local', 'a'.repeat(32));
  const local = wiring.critResolution('p1', 'e1', 'direct_projectile', projectile('p1'));
  current.localAction = null;
  current.remoteAction = { unitId: 'p1', actionId: 'b'.repeat(32), gearRngActionIdentity: clone(localIdentity) };
  const remote = wiring.critResolution('p1', 'e1', 'direct_projectile', projectile('p1'));
  assert.deepEqual(remote, local);
  assert.equal(local.isCrit, true);
  assert.equal(local.identity.hitOrdinal, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(local.identity, 'actionId'), false);
});

test('p1 and e1 direct projectile Crit use immutable snapshot stats exactly once', () => {
  const p1Gears = setGears('p1-critical-direct', 'critical', ['barrel', 'sight']);
  const e1Gears = setGears('e1-critical-direct', 'critical', ['barrel', 'sight']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    const fixture = findTurn(ownerId, targetId, 'direct_projectile', (roll) => roll < attacker.critRateBp);
    installAction(ownerId, fixture.turn);
    const actual = wiring.requestedDamage(ownerId, targetId, 'direct_projectile', 37.25, projectile(ownerId));
    assert.equal(actual, expectedDamage(37.25, 'direct_projectile', attacker, defender, true));
  }
});

test('normal blast may Crit in both directions while the Phase 3D-4B compatibility API remains Blast-inert', () => {
  const p1Gears = setGears('p1-critical-blast', 'critical', ['barrel', 'sight']);
  const e1Gears = setGears('e1-critical-blast', 'critical', ['barrel', 'sight']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    const fixture = findTurn(ownerId, targetId, 'normal_blast', (roll) => roll < attacker.critRateBp);
    installAction(ownerId, fixture.turn);
    assert.equal(wiring.requestedDamage(ownerId, targetId, 'normal_blast', 45, projectile(ownerId)),
      expectedDamage(45, 'normal_blast', attacker, defender, true));
  }
  const source = onlineDamage.calculateOnlineGearCritRequestedDamage.toString();
  assert.doesNotMatch(source, /blastDamageMultiplier|blastRangeMultiplier/);
});

test('Critical 2 rate and Critical 4 damage come from the snapshot without runtime soft-cap or double count', () => {
  const critical2 = setGears('p1-critical2-stats', 'critical', ['barrel', 'sight']);
  const critical4 = setGears('p1-critical4-stats', 'critical', ['barrel', 'armor', 'core', 'engine']);
  const two = installBattle({ p1Gears: critical2 }).state.battleGearSnapshotsByUnit.p1.derivedStats;
  const four = installBattle({ p1Gears: critical4 }).state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert(two.critRateBp >= 800);
  assert(four.critDamageMultiplier > two.critDamageMultiplier);
  const fixture = findTurn('p1', 'e1', 'direct_projectile', (roll) => roll < four.critRateBp);
  installAction('p1', fixture.turn);
  const defender = wiring.onlineCombat('e1');
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 40, projectile('p1')),
    expectedDamage(40, 'direct_projectile', four, defender, true));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /applySoftCap\([^\n]+crit/i);
});

test('Attack, Assault4, Crit, Defense and Fortify4 compose in canonical shared-pipeline order', () => {
  const p1Gears = [
    ...setGears('p1-assault4', 'assault', ['barrel', 'armor', 'sight', 'auxiliary']),
    ...setGears('p1-critical2-compose', 'critical', ['core', 'engine'])
  ];
  const e1Gears = setGears('e1-fortify4', 'fortify', ['barrel', 'armor', 'core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  const fixture = findTurn('p1', 'e1', 'direct_projectile', (roll) => roll < attacker.critRateBp);
  installAction('p1', fixture.turn);
  assert.equal(attacker.conditional.directHitDamageBp, 1200);
  assert.equal(defender.conditional.directHitTakenReductionBp, 1200);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 43.5, projectile('p1')),
    expectedDamage(43.5, 'direct_projectile', attacker, defender, true));
});

test('Gear ON Gearless participant has zero Crit and retains Phase 3D-3B damage', () => {
  const { state } = installBattle();
  installAction('p1', 3);
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  const resolution = wiring.critResolution('p1', 'e1', 'direct_projectile', projectile('p1'));
  assert.equal(attacker.critRateBp, 0);
  assert.equal(resolution.isCrit, false);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1')),
    onlineDamage.calculateOnlineGearStaticRequestedDamage({
      existingBaseDamage: 45, damageType: 'direct_projectile', attackerCombat: attacker, defenderCombat: defender, targetHp: 100
    }));
});

test('special direct projectiles and self blast remain non-Crit without consuming an action identity', () => {
  const p1Gears = setGears('p1-critical-excluded', 'critical', ['barrel', 'sight']);
  const { state } = installBattle({ p1Gears, p1Character: 'coolKai' });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1', 'excluded')),
    expectedDamage(45, 'direct_projectile', attacker, defender, false));
  kt.clearProjectilesForTest();
  kt.fireSpecialImmediateForUnitForTest('p1', 'coolKai', 220, -100);
  const target = kt.unitById('e1');
  const before = target.hp;
  assert.equal(kt.resolveProjectileUnitImpactForTest(0, 'e1'), true);
  assert.equal(before - target.hp, Math.min(
    expectedDamage(6, 'direct_projectile', attacker, defender, false, before), before));
  const self = state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(wiring.requestedDamage('p1', 'p1', 'normal_blast', 20, projectile('p1')),
    expectedDamage(20 * self.blastDamageMultiplier, 'normal_blast', self, self, false, 100));

  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const name of ['resolveProjectileUnitImpact', 'resolvePrismBeamUnitImpact', 'resolveCoolKaiOnigiriUnitImpact', 'resolveBarucopterBulletUnitImpact']) {
    const start = index.indexOf(`function ${name}`);
    const end = index.indexOf('\n  function ', start + 12);
    const block = index.slice(start, end);
    assert.match(block, /battleGearRequestedDamage\(/, name);
    assert.doesNotMatch(block, /gearDamageProfile:\s*'normal_cannonball'/, name);
  }
});

test('eligible normal cannon Crit fails closed on missing local or remote identity', () => {
  const p1Gears = setGears('p1-critical-missing', 'critical', ['barrel', 'sight']);
  const e1Gears = setGears('e1-critical-missing', 'critical', ['barrel', 'sight']);
  const { current } = installBattle({ p1Gears, e1Gears });
  assert.throws(() => wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1')),
    (error) => error?.code === 'ONLINE_GEAR_CRIT_ACTION_IDENTITY_MISSING');
  current.localAction = null;
  current.remoteAction = null;
  assert.throws(() => wiring.requestedDamage('e1', 'p1', 'normal_blast', 45, projectile('e1')),
    (error) => error?.code === 'ONLINE_GEAR_CRIT_ACTION_IDENTITY_MISSING');
});

test('wrong source, room, round, ordinal and stale action identities fail closed', () => {
  const p1Gears = setGears('p1-critical-invalid', 'critical', ['barrel', 'sight']);
  const { current } = installBattle({ p1Gears });
  kt.setTurnCountForTest(9);
  const valid = wiring.setCritActionForTest('p1', 'local');
  const changes = [
    { sourceUnitId: 'e1' },
    { roomId: 'B2BC3DEF' },
    { roundId: 'f'.repeat(48) },
    { authoritativeActionOrdinal: valid.authoritativeActionOrdinal + 1 },
    { turnOrdinal: valid.turnOrdinal - 1, authoritativeActionOrdinal: valid.authoritativeActionOrdinal - 1 }
  ];
  for (const change of changes) {
    current.localAction = { unitId: 'p1', actionId: 'a'.repeat(32), gearRngActionIdentity: { ...valid, ...change } };
    assert.throws(() => wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1')),
      (error) => error?.code === 'ONLINE_GEAR_CRIT_ACTION_IDENTITY_MISMATCH');
  }
});

test('normal cannon uses immutable hitOrdinal zero with duplicate action correlation remaining stable', () => {
  const p1Gears = setGears('p1-critical-hit', 'critical', ['barrel', 'sight']);
  const { current } = installBattle({ p1Gears });
  installAction('p1', 17, 'local', 'a'.repeat(32));
  const first = wiring.critResolution('p1', 'e1', 'normal_blast', projectile('p1'));
  current.localAction.actionId = 'b'.repeat(32);
  const duplicate = wiring.critResolution('p1', 'e1', 'normal_blast', projectile('p1'));
  assert.deepEqual(duplicate, first);
  assert.equal(first.identity.hitOrdinal, 0);
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(index, /createCritRollIdentity\(\{[\s\S]{0,180}hitOrdinal:\s*0/);
  assert.doesNotMatch(index, /nextHitOrdinal|gearCritHitCounter/);
});

test('later Gear effects and Math.random remain inert in the ONLINE Crit damage adapter', () => {
  const base = gearCombat.calculateBattleGearCombat({ battleGears: [], baseHp: 100, baseFuel: 100 });
  const attacker = clone(base);
  Object.assign(attacker, {
    blastDamageMultiplier: 99, blastRangeMultiplier: 99, knockbackPowerBp: 999999,
    statusResistanceBp: 999999, healingMultiplier: 99, shieldMultiplier: 99
  });
  Object.assign(attacker.conditional, {
    lastStandLowHpAttackBp: 9999, lastStandNextAttackDamageBp: 9999, rescueNextAttackDamageBp: 9999,
    lifeInitialShieldBp: 9999
  });
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0; };
  try {
    const expected = expectedDamage(45, 'normal_blast', attacker, base, true, 100);
    assert.equal(onlineDamage.calculateOnlineGearCritRequestedDamage({
      existingBaseDamage: 45, damageType: 'normal_blast', attackerCombat: attacker,
      defenderCombat: base, isCrit: true, targetHp: 100
    }), expected);
  } finally { Math.random = originalRandom; }
  assert.equal(randomCalls, 0);
  const source = onlineDamage.calculateOnlineGearCritRequestedDamage.toString();
  assert.doesNotMatch(source, /Math\.random|blastDamageMultiplier|blastRangeMultiplier|resolveRuntimeEffects|beginAttackAction/);
});

test('Gear OFF damage remains unchanged', () => {
  h.setOnlineForLogTest(onlineFixture({ gear: false }));
  prepareUnits();
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1')), 45);
});

test('Crit adds no Firebase field, Rules change, CPU RNG reuse, or Blast behavior to its compatibility API', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const rngSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-rng.js'), 'utf8');
  assert.doesNotMatch(rules, /critRoll|critResult|gearRngIdentity|authoritativeActionOrdinal/);
  assert.doesNotMatch(index, /netSend\(\{[^}]*crit(?:Roll|Result)|gearRngIdentity:/);
  assert.doesNotMatch(rngSource, /gear-battle-rng\.js|runId|matchOrdinal|Math\.random/);
  assert.doesNotMatch(onlineDamage.calculateOnlineGearCritRequestedDamage.toString(), /blastDamageMultiplier|blastRangeMultiplier/);
  assert.match(index, /firebaseOnlineGearBattleUnitIds/);
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
  console.log(`gear-online-battle-crit-phase3d4b: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
