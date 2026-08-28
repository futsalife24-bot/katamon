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
const cases = [];
let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const clone = (value) => JSON.parse(JSON.stringify(value));

function onlineFixture() {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1,
      gearCapability: capability
    },
    slots: {
      p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null
    },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu',
    localAction: null, remoteAction: null
  };
}

function makeGear(gearId, slotId, setId = 'blast') {
  return domain.createGear({
    gearId,
    generationSeed: `3d4c:${gearId}:generation`,
    enhancementSeed: `3d4c:${gearId}:enhancement`,
    sourceId: 'cpu_battle',
    sourceDetail: { fixture: '3d4c' },
    acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: '3d4c-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: '3d4c-set', setWeights: [{ id: setId, weight: 1 }] },
    slotId
  });
}

function setGears(prefix, setId, slots) {
  return slots.map((slotId) => makeGear(`${prefix}-${slotId}`, slotId, setId));
}

function createReveal(seat, characterId, gears = []) {
  const trustedContext = wiring.trustedContext(seat, characterId);
  const slots = Object.fromEntries(slotIds.map((slotId) => [slotId, null]));
  for (const gear of gears) slots[gear.slotId] = gear;
  const snapshot = battleSnapshot.createBattleGearSnapshot({
    resolvedLoadout: {
      characterId, presetId: 'preset1',
      gearIds: slotIds.map((slotId) => slots[slotId]?.gearId).filter(Boolean), slots
    },
    baseHp: trustedContext.baseHp,
    baseFuel: trustedContext.baseFuel
  });
  return Object.freeze({
    trustedContext,
    revealedCommitment: onlineProtocol.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext })
  });
}

function installBattle({ p1Gears = [], e1Gears = [] } = {}) {
  const current = onlineFixture();
  h.setOnlineForLogTest(current);
  const reveals = [createReveal('p1', 'kyoryu', p1Gears), createReveal('e1', 'iwa', e1Gears)];
  const manifest = lobbyProtocol.createStartGearManifest({
    roundId,
    commitments: reveals.map((entry) => entry.revealedCommitment),
    participantReveals: reveals
  });
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  const state = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
  wiring.applyBattleStartState(state);
  return { current, state };
}

function installAction(ownerId, turn = 0) {
  kt.setTurnCountForTest(turn);
  return wiring.setCritActionForTest(ownerId, ownerId === 'p1' ? 'local' : 'remote');
}

function projectile(ownerId, profile = 'normal_cannonball', directTargetId = null) {
  return { owner: ownerId, gearDamageProfile: profile, directTargetId, radius: 5 };
}

function expectedDamage(baseDamage, damageType, attacker, defender, isCrit, hp = 9999, blastAware = true) {
  const outgoing = gearCombat.conditionalDamageModifiers({ combat: attacker, damageType });
  const incoming = gearCombat.conditionalDamageModifiers({ combat: defender, damageType });
  const blastBase = blastAware && damageType === 'normal_blast'
    ? baseDamage * attacker.blastDamageMultiplier
    : baseDamage;
  return Math.max(1, Math.round(gearCombat.calculateDamagePipeline({
    baseDamage: blastBase,
    attackMultiplier: attacker.attackMultiplier,
    modifierBp: outgoing.outgoingDamageBp,
    isCrit,
    critDamageMultiplier: attacker.critDamageMultiplier,
    defenseMultiplier: defender.defenseMultiplier,
    damageReductionBp: incoming.incomingDamageReductionBp,
    numericShield: 0,
    hp
  }).hpDamage));
}

function critFixture(ownerId, targetId, combat) {
  for (let turn = 0; turn < 50000; turn += 1) {
    const actionIdentity = onlineRng.createOnlineGearActionIdentity({
      version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
      roomId: 'A2BC3DEF', roundId, turnOrdinal: turn, sourceUnitId: ownerId
    });
    const identity = onlineRng.createCritRollIdentity({
      actionIdentity, targetUnitId: targetId, damageType: 'normal_blast', hitOrdinal: 0
    });
    if (onlineRng.rollBasisPoints(identity) < combat.critRateBp) return turn;
  }
  throw new Error('Blast + Crit fixture not found');
}

test('Blast2 and Blast4 canonical multipliers come only from the reconstructed snapshot', () => {
  const blast2 = setGears('blast2', 'blast', ['barrel', 'armor']);
  const blast4 = setGears('blast4', 'blast', ['barrel', 'armor', 'core', 'engine']);
  const two = installBattle({ p1Gears: blast2 }).state.battleGearSnapshotsByUnit.p1.derivedStats;
  const four = installBattle({ p1Gears: blast4 }).state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(two.setCounts.blast, 2);
  assert.equal(four.setCounts.blast, 4);
  assert(two.blastPowerBp >= 800);
  assert.equal(two.blastDamageMultiplier, 1 + (two.blastPowerBp / 10000));
  assert.equal(two.blastRangeMultiplier, 1 + (two.blastPowerBp / 20000));
  assert.equal(four.blastDamageMultiplier, 1 + (four.blastPowerBp / 10000));
  assert.equal(four.blastRangeMultiplier, 1 + (four.blastPowerBp / 20000) + 0.08);
  assert(four.blastRangeMultiplier > two.blastRangeMultiplier);
});

test('Blast-aware pure API applies snapshot Blast Power once before Attack and only to normal blast', () => {
  const { state } = installBattle({ p1Gears: setGears('blast-pure', 'blast', ['barrel', 'armor', 'core', 'engine']) });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  const input = { existingBaseDamage: 37.25, attackerCombat: attacker, defenderCombat: defender, isCrit: false, targetHp: 9999 };
  assert.equal(onlineDamage.calculateOnlineGearCritBlastRequestedDamage({ ...input, damageType: 'normal_blast' }),
    expectedDamage(37.25, 'normal_blast', attacker, defender, false));
  assert.equal(onlineDamage.calculateOnlineGearCritBlastRequestedDamage({ ...input, damageType: 'direct_projectile' }),
    expectedDamage(37.25, 'direct_projectile', attacker, defender, false));
  assert.equal(onlineDamage.calculateOnlineGearCritRequestedDamage({ ...input, damageType: 'normal_blast' }),
    expectedDamage(37.25, 'normal_blast', attacker, defender, false, 9999, false));
});

test('ONLINE normal blast damage uses Blast Power in both directions while direct damage does not', () => {
  const p1Gears = setGears('p1-blast', 'blast', ['barrel', 'armor', 'core', 'engine']);
  const e1Gears = setGears('e1-blast', 'blast', ['barrel', 'armor', 'core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears });
  for (const [ownerId, targetId] of [['p1', 'e1'], ['e1', 'p1']]) {
    const attacker = state.battleGearSnapshotsByUnit[ownerId].derivedStats;
    const defender = state.battleGearSnapshotsByUnit[targetId].derivedStats;
    installAction(ownerId, 3);
    assert.equal(wiring.requestedDamage(ownerId, targetId, 'normal_blast', 41.5, projectile(ownerId)),
      expectedDamage(41.5, 'normal_blast', attacker, defender, false));
    assert.equal(wiring.requestedDamage(ownerId, targetId, 'direct_projectile', 41.5, projectile(ownerId, 'normal_cannonball', targetId)),
      expectedDamage(41.5, 'direct_projectile', attacker, defender, false));
  }
});

test('Blast Power composes with deterministic Crit between Attack and Defense', () => {
  const p1Gears = [
    ...setGears('compose-blast4', 'blast', ['barrel', 'armor', 'core', 'engine']),
    ...setGears('compose-critical2', 'critical', ['sight', 'auxiliary'])
  ];
  const e1Gears = setGears('compose-fortify4', 'fortify', ['barrel', 'armor', 'core', 'engine']);
  const { state } = installBattle({ p1Gears, e1Gears });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  const turn = critFixture('p1', 'e1', attacker);
  installAction('p1', turn);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'normal_blast', 43.5, projectile('p1')),
    expectedDamage(43.5, 'normal_blast', attacker, defender, true));
});

function rangeProbe(ownerId, targetId, ownerGears) {
  installBattle(ownerId === 'p1' ? { p1Gears: ownerGears } : { e1Gears: ownerGears });
  installAction(ownerId, 7);
  const target = kt.unitById(targetId);
  const before = target.hp;
  kt.explodeAtForTest(target.x - 105, target.y, 1, ownerId, true, projectile(ownerId, 'normal_cannonball', 'other'));
  return before - target.hp;
}

test('snapshot Blast Range extends combat reach in both directions while Gearless reach stays historical', () => {
  const blast4 = setGears('range-blast4', 'blast', ['barrel', 'armor', 'core', 'engine']);
  assert.equal(rangeProbe('p1', 'e1', []), 0);
  assert(rangeProbe('p1', 'e1', blast4) > 0);
  assert.equal(rangeProbe('e1', 'p1', []), 0);
  assert(rangeProbe('e1', 'p1', blast4) > 0);
});

function terrainVisualProbe(gears) {
  installBattle({ p1Gears: gears });
  installAction('p1', 9);
  const x = kt.stageW() * 0.5;
  const y = kt.groundYAt(x);
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0.25; };
  try {
    kt.explodeAtForTest(x, y, 1, 'p1', true, projectile('p1', 'normal_cannonball', 'other'));
  } finally { Math.random = originalRandom; }
  return {
    crater: kt.craterHistory().at(-1),
    explosions: kt.impactVisualCountsForTest().explosions,
    randomCalls,
    shakeTimer: kt.shakeTimer()
  };
}

test('Blast Range changes neither crater, particles, shake nor Math.random consumption', () => {
  const plain = terrainVisualProbe([]);
  const boosted = terrainVisualProbe(setGears('visual-blast4', 'blast', ['barrel', 'armor', 'core', 'engine']));
  assert.equal(plain.crater.r, 44);
  assert.deepEqual(boosted, plain);
});

test('self normal blast is non-Crit but still receives Blast Power', () => {
  const { state } = installBattle({ p1Gears: setGears('self-blast4', 'blast', ['barrel', 'armor', 'core', 'engine']) });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(wiring.requestedDamage('p1', 'p1', 'normal_blast', 20, projectile('p1')),
    expectedDamage(20, 'normal_blast', combat, combat, false, 100));
});

test('special and excluded routes remain Blast-inert without needing Crit identity', () => {
  const { state } = installBattle({ p1Gears: setGears('special-blast4', 'blast', ['barrel', 'armor', 'core', 'engine']) });
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 45, projectile('p1', 'excluded')),
    expectedDamage(45, 'direct_projectile', attacker, defender, false));
});

test('Gearless snapshot multipliers are identity values and keep normal blast unchanged', () => {
  const { state } = installBattle();
  const attacker = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const defender = state.battleGearSnapshotsByUnit.e1.derivedStats;
  installAction('p1', 11);
  assert.equal(attacker.blastDamageMultiplier, 1);
  assert.equal(attacker.blastRangeMultiplier, 1);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'normal_blast', 45, projectile('p1')), 45);
  assert.equal(expectedDamage(45, 'normal_blast', attacker, defender, false), 45);
});

test('compatibility APIs remain Blast-inert and Blast-aware input fails closed', () => {
  const base = clone(installBattle().state.battleGearSnapshotsByUnit.p1.derivedStats);
  base.blastDamageMultiplier = 99;
  assert.equal(onlineDamage.calculateOnlineGearStaticRequestedDamage({
    existingBaseDamage: 20, damageType: 'normal_blast', attackerCombat: base, defenderCombat: base, targetHp: 100
  }), 20);
  assert.equal(onlineDamage.calculateOnlineGearCritRequestedDamage({
    existingBaseDamage: 20, damageType: 'normal_blast', attackerCombat: base, defenderCombat: base, isCrit: false, targetHp: 100
  }), 20);
  base.blastDamageMultiplier = 0;
  assert.throws(() => onlineDamage.calculateOnlineGearCritBlastRequestedDamage({
    existingBaseDamage: 20, damageType: 'normal_blast', attackerCombat: base, defenderCombat: base, isCrit: false, targetHp: 100
  }), (error) => error?.code === 'INVALID_ONLINE_GEAR_BLAST_DAMAGE_MULTIPLIER');
});

test('source contract keeps combat reach separate from terrain and visual multipliers', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const explodeStart = index.indexOf('function explodeAt(');
  const explodeEnd = index.indexOf('\n  function explodeProjectile', explodeStart);
  const block = index.slice(explodeStart, explodeEnd);
  assert.match(block, /battleGearNormalCannonCombatForUnit\(unitById\(owner\)\)/);
  assert.match(block, /combatBlastMul = normalCannonCombat \? blastMul \* normalCannonCombat\.blastRangeMultiplier : blastMul/);
  assert.match(block, /computeDamage\(dist, combatBlastMul,/);
  assert.match(block, /carveCrater\(x, y, 44 \* terrainBlastMul\)/);
  assert.match(block, /spawnExplosion\(x, y, blastMul\)/);
  assert.match(block, /playExplosionSound\(blastMul\)/);
  assert.doesNotMatch(block, /terrainBlastMul\s*\*\s*normalCannonCombat\.blastRangeMultiplier/);
  assert.doesNotMatch(block, /spawnExplosion\([^\n]*blastRangeMultiplier|playExplosionSound\([^\n]*blastRangeMultiplier|triggerShake\([^\n]*blastRangeMultiplier/);
});

test('Blast adds no wire field, Rules change, future effect, or RNG change', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const rngSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-rng.js'), 'utf8');
  const blastSource = onlineDamage.calculateOnlineGearCritBlastRequestedDamage.toString();
  assert.doesNotMatch(rules, /blastDamageMultiplier|blastRangeMultiplier|gearBlast/);
  assert.doesNotMatch(index, /netSend\(\{[^}]*blast(?:Power|Range|DamageMultiplier|RangeMultiplier)/);
  assert.doesNotMatch(blastSource, /knockback|status|shield|healing|lastStand|rescue|Math\.random/);
  assert.doesNotMatch(rngSource, /blastDamageMultiplier|blastRangeMultiplier/);
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
  console.log(`gear-online-battle-blast-phase3d4c: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
