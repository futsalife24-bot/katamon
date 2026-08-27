const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const gearCombat = require('../shared/gear-combat.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const onlineProtocol = require('../shared/gear-online-protocol.js');
const lobbyProtocol = require('../shared/gear-online-lobby-protocol.js');
const battleStart = require('../shared/gear-online-battle-start.js');
const onlineRng = require('../shared/gear-online-battle-rng.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const roomId = 'A2BC3DEF';
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobbyProtocol.createRoomGearCapability({
  visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1
});
const slotIds = domain.SLOT_IDS;
const cases = [];
let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const clone = (value) => JSON.parse(JSON.stringify(value));

function onlineFixture({ gear = true, format = '1v1' } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: roomId,
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1,
      ...(gear ? { gearCapability: capability } : {})
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

function statusGear(prefix, slotId = 'auxiliary') {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const gear = domain.createGear({
      gearId: `${prefix}-${slotId}-${attempt}`,
      generationSeed: `3d5b:${prefix}:${slotId}:${attempt}:generation`,
      enhancementSeed: `3d5b:${prefix}:${slotId}:${attempt}:enhancement`,
      sourceId: 'cpu_battle', sourceDetail: { fixture: '3d5b' }, acquiredAt: '2026-08-27T00:00:00Z',
      qualityProfile: { id: '3d5b-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: '3d5b-set', setWeights: [{ id: 'assault', weight: 1 }] }, slotId
    });
    if (gear.mainOp.opId === 'status_resistance'
        || gear.subOps.some((sub) => sub.opId === 'status_resistance')) return gear;
  }
  throw new Error(`could not create Status Resistance fixture for ${slotId}`);
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

function prepareUnits() {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
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
  prepareUnits();
  wiring.applyBattleStartState(state);
  return { current, state };
}

function installAction(ownerId, turn, actionId = 'a'.repeat(32)) {
  kt.setTurnCountForTest(turn);
  return wiring.setCritActionForTest(ownerId, ownerId === 'p1' ? 'local' : 'remote', actionId);
}

function roll(ownerId, targetId, statusId, turn) {
  const actionIdentity = onlineRng.createOnlineGearActionIdentity({
    version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
    roomId, roundId, turnOrdinal: turn, sourceUnitId: ownerId
  });
  const identity = onlineRng.createStatusRollIdentity({ actionIdentity, targetUnitId: targetId, statusId, hitOrdinal: 0 });
  return { actionIdentity, identity, rollBp: onlineRng.rollBasisPoints(identity) };
}

function findTurn(ownerId, targetId, statusId, finalChanceBp, applies) {
  for (let turn = 0; turn < 50000; turn += 1) {
    const fixture = roll(ownerId, targetId, statusId, turn);
    if ((fixture.rollBp < finalChanceBp) === applies) return { turn, ...fixture };
  }
  throw new Error('deterministic Status fixture turn not found');
}

function emitAtTarget(ownerId, targetId, effect, turn) {
  installAction(ownerId, turn);
  const target = kt.unitById(targetId);
  const beforeHp = target.hp;
  if (effect === 'turnSkip') kt.emitNyanDisableForTest(target.x, target.y, 20, ownerId);
  else kt.emitEmpForTest(target.x, target.y, 20, ownerId, 2);
  return { damage: beforeHp - target.hp, effect: kt.turnEffectForTest(targetId) };
}

test('Status roll constructor is exact, frozen, canonical, and deterministic across clones', () => {
  const fixture = roll('p1', 'e1', 'move_lock', 7);
  assert.deepEqual(fixture.identity, {
    version: 1, namespace: 'online-gear-status:v1', roomId, roundId,
    turnOrdinal: 7, authoritativeActionOrdinal: 7, sourceUnitId: 'p1', targetUnitId: 'e1',
    effectKind: 'status', statusId: 'move_lock', hitOrdinal: 0
  });
  assert.equal(Object.isFrozen(fixture.identity), true);
  const key = 'fnv1a64-ascii-v1|version=1|namespace=online-gear-status:v1|room=A2BC3DEF|round=0123456789abcdef0123456789abcdef0123456789abcdef|turn=7|action=7|source=p1|target=e1|effect=status|statusId=move_lock|hit=0';
  assert.equal(onlineRng.canonicalOnlineGearRngKey(fixture.identity), key);
  assert.equal(onlineRng.canonicalOnlineGearRngKey(clone(fixture.identity)), key);
  assert.equal(onlineRng.rollBasisPoints(clone(fixture.identity)), fixture.rollBp);
});

test('Status namespace stays independent from the fixed Crit fixture and transport actionId', () => {
  const actionIdentity = onlineRng.createOnlineGearActionIdentity({
    version: 1, roomId, roundId, turnOrdinal: 7, sourceUnitId: 'p1'
  });
  const crit = onlineRng.createCritRollIdentity({
    actionIdentity, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0
  });
  assert.equal(onlineRng.rollBasisPoints(crit), 5220);
  assert.notEqual(onlineRng.canonicalOnlineGearRngKey(crit), onlineRng.canonicalOnlineGearRngKey(
    onlineRng.createStatusRollIdentity({ actionIdentity, targetUnitId: 'e1', statusId: 'move_lock', hitOrdinal: 0 })));
  assert.throws(() => onlineRng.createStatusRollIdentity({
    actionIdentity, targetUnitId: 'e1', statusId: 'move_lock', hitOrdinal: 0, actionId: 'sender-nonce'
  }), (error) => error?.code === 'INVALID_ONLINE_GEAR_STATUS_IDENTITY_INPUT');
  assert.throws(() => onlineRng.createStatusRollIdentity({
    actionIdentity: { ...actionIdentity, actionId: 'sender-nonce' }, targetUnitId: 'e1', statusId: 'move_lock', hitOrdinal: 0
  }), (error) => error?.code === 'INVALID_ONLINE_GEAR_ACTION_IDENTITY_INPUT');
});

test('p1 to e1 hostile EMP uses target Status Resistance once and preserves damage on resist', () => {
  const { state } = installBattle({ e1Gears: [statusGear('e1-resist')] });
  const resistance = state.battleGearSnapshotsByUnit.e1.derivedStats.statusResistanceBp;
  const chance = gearCombat.statusSuccessChance(10000, resistance);
  const fixture = findTurn('p1', 'e1', 'move_lock', chance, false);
  installAction('p1', fixture.turn);
  const outcome = wiring.statusResolution('p1', 'e1', 'move_lock');
  assert.equal(outcome.finalChanceBp, chance);
  assert.equal(outcome.rollBp, fixture.rollBp);
  assert.equal(outcome.applies, false);
  const result = emitAtTarget('p1', 'e1', 'moveLock', fixture.turn);
  assert.equal(result.damage, 20);
  assert.equal(result.effect.moveLockTurns, 0);
});

test('e1 to p1 hostile EMP produces the same deterministic success on both client clones', () => {
  const { current, state } = installBattle({ p1Gears: [statusGear('p1-success')] });
  const chance = gearCombat.statusSuccessChance(10000, state.battleGearSnapshotsByUnit.p1.derivedStats.statusResistanceBp);
  const fixture = findTurn('e1', 'p1', 'move_lock', chance, true);
  const action = installAction('e1', fixture.turn, 'a'.repeat(32));
  const host = wiring.statusResolution('e1', 'p1', 'move_lock');
  current.remoteAction.actionId = 'b'.repeat(32);
  current.remoteAction.gearRngActionIdentity = clone(action);
  const guest = wiring.statusResolution('e1', 'p1', 'move_lock');
  assert.deepEqual(guest, host);
  const result = emitAtTarget('e1', 'p1', 'moveLock', fixture.turn);
  assert.equal(result.damage, 20);
  assert.equal(result.effect.moveLockTurns, 2);
});

test('move_lock and action_skip have separate identities but share the same resistance formula', () => {
  const { state } = installBattle({ e1Gears: [statusGear('skip-resist')] });
  const chance = gearCombat.statusSuccessChance(10000, state.battleGearSnapshotsByUnit.e1.derivedStats.statusResistanceBp);
  const fixture = findTurn('p1', 'e1', 'action_skip', chance, false);
  installAction('p1', fixture.turn);
  const skip = wiring.statusResolution('p1', 'e1', 'action_skip');
  const move = wiring.statusResolution('p1', 'e1', 'move_lock');
  assert.equal(skip.finalChanceBp, chance);
  assert.equal(move.finalChanceBp, chance);
  assert.notEqual(onlineRng.canonicalOnlineGearRngKey(skip.identity), onlineRng.canonicalOnlineGearRngKey(move.identity));
  const result = emitAtTarget('p1', 'e1', 'turnSkip', fixture.turn);
  assert.equal(result.damage, 20);
  assert.equal(result.effect.actionSkipTurns, 0);
});

test('Gearless Gear ON keeps legacy-certain EMP without a random fallback', () => {
  installBattle();
  installAction('p1', 3);
  const outcome = wiring.statusResolution('p1', 'e1', 'move_lock');
  assert.equal(outcome.finalChanceBp, 10000);
  assert.equal(outcome.applies, true);
  const result = emitAtTarget('p1', 'e1', 'moveLock', 3);
  assert.equal(result.effect.moveLockTurns, 2);
});

test('Gear OFF ONLINE preserves legacy EMP and requires no action identity', () => {
  prepareUnits();
  h.setOnlineForLogTest(onlineFixture({ gear: false }));
  const target = kt.unitById('e1');
  kt.emitEmpForTest(target.x, target.y, 20, 'p1', 2);
  assert.equal(kt.turnEffectForTest('e1').moveLockTurns, 2);
});

test('eligible Status fails closed when the current local or remote identity is missing', () => {
  const { current } = installBattle({ e1Gears: [statusGear('missing')] });
  assert.throws(() => wiring.statusResolution('p1', 'e1', 'move_lock'),
    (error) => error?.code === 'ONLINE_GEAR_STATUS_ACTION_IDENTITY_MISSING');
  current.localAction = null;
  current.remoteAction = null;
  assert.throws(() => wiring.statusResolution('e1', 'p1', 'action_skip'),
    (error) => error?.code === 'ONLINE_GEAR_STATUS_ACTION_IDENTITY_MISSING');
});

test('wrong room, round, source, ordinal, and stale Status identities fail closed', () => {
  const { current } = installBattle({ e1Gears: [statusGear('stale')] });
  kt.setTurnCountForTest(9);
  const valid = wiring.setCritActionForTest('p1', 'local');
  const changes = [
    { sourceUnitId: 'e1' }, { roomId: 'B2BC3DEF' }, { roundId: 'f'.repeat(48) },
    { authoritativeActionOrdinal: valid.authoritativeActionOrdinal + 1 },
    { turnOrdinal: valid.turnOrdinal - 1, authoritativeActionOrdinal: valid.authoritativeActionOrdinal - 1 }
  ];
  for (const change of changes) {
    current.localAction = { unitId: 'p1', actionId: 'a'.repeat(32), gearRngActionIdentity: { ...valid, ...change } };
    assert.throws(() => wiring.statusResolution('p1', 'e1', 'move_lock'),
      (error) => error?.code === 'ONLINE_GEAR_STATUS_ACTION_IDENTITY_MISMATCH');
  }
});

test('one logical multi-projectile action reuses hitOrdinal zero and the same Status result', () => {
  installBattle({ e1Gears: [statusGear('multi')] });
  installAction('p1', 13);
  const first = wiring.statusResolution('p1', 'e1', 'move_lock');
  const second = wiring.statusResolution('p1', 'e1', 'move_lock');
  assert.deepEqual(second, first);
  assert.equal(first.identity.hitOrdinal, 0);
  assert.equal(kt.fireEmpForTest('p1'), null);
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(source, /nextOnlineGearStatusOrdinal|onlineGearStatusHitCounter/);
});

test('self and scope-excluded statuses never enter ONLINE Status RNG', () => {
  installBattle({ p1Gears: [statusGear('self')] });
  const self = wiring.statusResolution('p1', 'p1', 'move_lock');
  assert.deepEqual(self, { eligible: false, applies: true, rollBp: null, finalChanceBp: 10000, identity: null });
  const excluded = wiring.statusResolution('p1', 'e1', 'burn');
  assert.deepEqual(excluded, { eligible: false, applies: true, rollBp: null, finalChanceBp: 10000, identity: null });
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal([...index.matchAll(/battleGearHostileStatusOutcome\(/g)].length, 2);
  assert.doesNotMatch(index, /battleGearHostileStatusOutcome\([^\n]*(?:burn|groundFlame|creamCloud)/);
});

test('Status resolution adds no Math.random calls', () => {
  installBattle({ e1Gears: [statusGear('random')] });
  installAction('p1', 21);
  const original = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; return 0.5; };
  try { wiring.statusResolution('p1', 'e1', 'move_lock'); } finally { Math.random = original; }
  assert.equal(calls, 0);
});

test('Gear ON 2v2 remains rejected while Firebase wire and Rules stay unchanged', () => {
  installBattle({ e1Gears: [statusGear('two-v-two')] });
  installAction('p1', 2);
  kt.setMatchFormatForTest('2v2');
  assert.throws(() => wiring.statusResolution('p1', 'e1', 'move_lock'),
    (error) => error?.code === 'ONLINE_GEAR_2V2_BATTLE_UNSUPPORTED');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(rules, /statusRoll|statusResult|statusResistance|gearRngStatusIdentity/);
  assert.doesNotMatch(index, /netSend\(\{[^}]*status(?:Roll|Result)|gearRngStatusIdentity:/);
});

test('source contract keeps CPU Status state separate and gates only EMP status after damage', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rngSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-rng.js'), 'utf8');
  const statusStart = index.indexOf('function firebaseOnlineGearHostileStatusOutcome(');
  const statusEnd = index.indexOf('\n  function ', statusStart + 20);
  const statusBlock = index.slice(statusStart, statusEnd);
  assert.match(statusBlock, /onlineGearStaticCombatForUnit\(unitById\(ownerId\)\)/);
  assert.match(statusBlock, /onlineGearStaticCombatForUnit\(target\)/);
  assert.match(statusBlock, /statusSuccessChance\(10000, defenderCombat\.statusResistanceBp\)/);
  assert.match(statusBlock, /createStatusRollIdentity/);
  assert.match(statusBlock, /hitOrdinal:\s*0/);
  assert.doesNotMatch(statusBlock, /Math\.random|localStorage|participantGearReveals|cpuGearStatusState/);
  assert.doesNotMatch(rngSource, /runId|matchOrdinal|Math\.random/);
  const empStart = index.indexOf('function emitEmp(');
  const empEnd = index.indexOf('\n  function ', empStart + 20);
  const empBlock = index.slice(empStart, empEnd);
  assert(empBlock.indexOf('u.hp = Math.max') < empBlock.indexOf('battleGearHostileStatusOutcome'));
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
      kt.setMatchFormatForTest('1v1');
      localStorage.clear();
    }
  }
  console.log(`gear-online-battle-status-phase3d5b: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
