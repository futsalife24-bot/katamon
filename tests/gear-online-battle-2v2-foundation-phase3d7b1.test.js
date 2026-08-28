const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const start = require('../shared/gear-online-battle-start.js');
const runtime = require('../shared/gear-online-battle-runtime-state.js');
const rng = require('../shared/gear-online-battle-rng.js');
const harness = require('./seatharness.js');

const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);
const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();

function context(seatId, unitId, ownerUid = `uid-${seatId}`) {
  return { expectedOwnerUid: ownerUid, expectedSeatId: seatId, expectedUnitId: unitId,
    expectedCharacterId: 'kyoryu', expectedRoundId: roundId, baseHp: 100, baseFuel: 50 };
}
function reveal(seatId, unitId, ownerUid) {
  const trustedContext = context(seatId, unitId, ownerUid);
  const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
  const snapshot = snapshots.createBattleGearSnapshot({
    resolvedLoadout: { characterId: 'kyoryu', presetId: 'preset1', gearIds: [], slots },
    baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel
  });
  return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
}
function fourReveals(ownerBySeat = {}) {
  return [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]
    .map(([seatId, unitId]) => reveal(seatId, unitId, ownerBySeat[seatId]));
}
function stateFor(reveals) {
  const manifest = lobby.createStartGearManifest({
    roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals
  });
  return start.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest, participantReveals: reveals });
}
function makeLifeGear(prefix, slotId) {
  return domain.createGear({
    gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`,
    sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z',
    qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: 'life', setWeights: [{ id: 'life', weight: 1 }] }, slotId
  });
}
function onlineFixture2v2({ gear = true } = {}) {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: online.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'playing', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId,
    visibility: 'private', settingsAuthorityBlocked: false,
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '2v2', stageSize: 'standard', revision: 1, ...(gear ? { gearCapability: capability } : {}) },
    slots: { p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: { uid: 'uid-s1', claimedAt: 1 }, s2: { uid: 'uid-s2', claimedAt: 1 } },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null,
    battleGearRuntimeEffectsStateByUnit: null, queue: [], pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: {}, seatVerified: {}, selfCharacter: 'kyoryu', localAction: null, remoteAction: null
  };
}
function production2v2() {
  kt.setMatchFormatForTest('2v2');
  for (const [unitId, characterId] of [['p1', 'kyoryu'], ['e1', 'iwa'], ['p2', 'medama'], ['e2', 'kyoryu']]) {
    assert.equal(kt.setCharacterForUnitForTest(unitId, characterId), characterId);
  }
  assert.deepEqual(h.setTurnOrderForTest(['p1', 'e1', 'p2', 'e2']), ['p1', 'e1', 'p2', 'e2']);
  const current = onlineFixture2v2(); h.setOnlineForLogTest(current);
  const unitCharacters = Object.fromEntries(kt.snapshot().units.map(unit => [unit.id, unit.character]));
  const gearBySeat = { p1: [], e1: [], s1: [], s2: ['barrel', 'armor', 'core', 'engine'].map(slotId => makeLifeGear('e2-life', slotId)) };
  const reveals = [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']].map(([seatId, unitId]) => {
    const characterId = unitCharacters[unitId];
    current.seatCharacter[seatId] = characterId; current.seatVerified[seatId] = true;
    const trustedContext = wiring.trustedContext(seatId, characterId);
    const gears = gearBySeat[seatId]; const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
    for (const item of gears) slots[item.slotId] = item;
    const snapshot = snapshots.createBattleGearSnapshot({
      resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots },
      baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel
    });
    return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
  });
  const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  current.participantGearReveals = Object.fromEntries(reveals.map(entry => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  const state = wiring.createBattleStartState(manifest);
  assert.equal(wiring.applyBattleStartState(state), true);
  return { current, state, unitCharacters };
}

test('2v2 Battle Start reconstructs exactly p1/e1/p2/e2 from the canonical seat map', () => {
  const state = stateFor(fourReveals());
  assert.equal(state.matchFormat, '2v2');
  assert.deepEqual(Object.keys(state.battleGearSnapshotsByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.deepEqual(Object.keys(state.hpFuelByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.equal(Object.isFrozen(state), true);
  for (const unitId of ['p1', 'e1', 'p2', 'e2']) {
    assert.equal(state.hpFuelByUnit[unitId].hp, 100);
    assert.equal(state.hpFuelByUnit[unitId].fuel, 50);
    assert.equal(Object.isFrozen(state.battleGearSnapshotsByUnit[unitId]), true);
  }
});

test('2v2 Start rejects incomplete and non-canonical participant sets', () => {
  const complete = fourReveals();
  const manifest = lobby.createStartGearManifest({ roundId, commitments: complete.map(entry => entry.revealedCommitment), participantReveals: complete });
  const incomplete = complete.slice(0, 3);
  const incompleteManifest = lobby.createStartGearManifest({ roundId, commitments: incomplete.map(entry => entry.revealedCommitment), participantReveals: incomplete });
  fails('MISSING_ONLINE_GEAR_BATTLE_REVEAL', () => start.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest: incompleteManifest, participantReveals: incomplete }));
});

test('runtime checkpoint v3 is exact per match format and rejects v1 or a p2/e2 key mismatch', () => {
  const state = stateFor(fourReveals());
  const shieldState = Object.fromEntries(['p1', 'e1', 'p2', 'e2'].map(unitId => [unitId, { currentShield: 0 }]));
  const runtimeEffectsStateByUnit = Object.fromEntries(['p1', 'e1', 'p2', 'e2'].map(unitId => [unitId, { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 }]));
  const valid = runtime.createRuntimeState({ shieldStateByUnit: shieldState, runtimeEffectsStateByUnit, snapshots: state.battleGearSnapshotsByUnit, matchFormat: '2v2' });
  assert.equal(valid.version, 3); assert.deepEqual(valid.shieldByUnit, shieldState); assert.deepEqual(valid.runtimeEffectsByUnit, runtimeEffectsStateByUnit);
  assert.equal(Object.isFrozen(valid), true);
  const old = structuredClone(valid); old.version = 1;
  fails('UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(old, { snapshots: state.battleGearSnapshotsByUnit }));
  const mismatched = structuredClone(valid); delete mismatched.shieldByUnit.e2;
  fails('INVALID_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(mismatched, { snapshots: state.battleGearSnapshotsByUnit }));
  const oneVsOneSnapshots = Object.freeze({ p1: state.battleGearSnapshotsByUnit.p1, e1: state.battleGearSnapshotsByUnit.e1 });
  const oneVsOne = runtime.createRuntimeState({ shieldStateByUnit: { p1: { currentShield: 0 }, e1: { currentShield: 0 } }, runtimeEffectsStateByUnit: { p1: { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 }, e1: { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 } }, snapshots: oneVsOneSnapshots, matchFormat: '1v1' });
  fails('ONLINE_GEAR_RUNTIME_STATE_FORMAT_MISMATCH', () => runtime.validateRuntimeState(oneVsOne, { snapshots: state.battleGearSnapshotsByUnit, expectedMatchFormat: '2v2' }));
});

test('p2/e2 use the established deterministic RNG identity without changing the 1v1 Crit fixture', () => {
  const action = rng.createOnlineGearActionIdentity({ version: 1, roomId: 'A2BC3DEF', roundId, turnOrdinal: 7, sourceUnitId: 'p2' });
  const crit = rng.createCritRollIdentity({ actionIdentity: action, targetUnitId: 'e2', damageType: 'direct_projectile', hitOrdinal: 0 });
  assert.equal(rng.rollBasisPoints(crit), rng.rollBasisPoints(structuredClone(crit)));
  const legacyAction = rng.createOnlineGearActionIdentity({ version: 1, roomId: 'A2BC3DEF', roundId, turnOrdinal: 7, sourceUnitId: 'p1' });
  assert.equal(rng.rollBasisPoints(rng.createCritRollIdentity({ actionIdentity: legacyAction, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0 })), 5220);
});

test('2v2 source boundaries are format-aware while legacy wire versions stay unchanged', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const stateModule = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-runtime-state.js'), 'utf8');
  assert.match(index, /function firebaseOnlineGearBattleUnitIds\(/);
  assert.match(index, /function recordFirebaseOnlineGearSupportEvent\(/);
  assert.match(stateModule, /ONLINE_GEAR_RUNTIME_STATE_VERSION = 3/);
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 6);
  assert.equal(online.ONLINE_GEAR_PROTOCOL_VERSION, 1);
  assert.equal(snapshots.GEAR_BATTLE_SNAPSHOT_VERSION, 1);
  assert.equal(require('../shared/gear-online-firebase-wire.js').ONLINE_GEAR_FIREBASE_WIRE_VERSION, 1);
});

test('production Firebase 2v2 start applies all four snapshots and initializes isolated four-unit runtime state', () => {
  const { state, unitCharacters } = production2v2();
  const snap = kt.snapshot();
  for (const unitId of ['p1', 'e1', 'p2', 'e2']) {
    const unit = snap.units.find(entry => entry.id === unitId);
    assert.deepEqual({ character: unit.character, maxHp: unit.maxHp, hp: unit.hp, fuelMax: unit.fuelMax, fuel: unit.fuel }, state.hpFuelByUnit[unitId]);
    assert.equal(unit.character, unitCharacters[unitId]);
  }
  assert.deepEqual(Object.keys(wiring.battleSnapshotsForRuntimeTest()).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.deepEqual(Object.keys(wiring.shieldState()).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.deepEqual(Object.keys(wiring.runtimeEffectsState()).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.equal(Object.isFrozen(wiring.battleSnapshotsForRuntimeTest()), true);
});

test('production 2v2 applies p2/e2 damage, Shield, Healing, Last Stand, and action identity through existing boundaries', () => {
  production2v2();
  const e2Before = wiring.shieldState().e2.currentShield;
  assert.ok(e2Before > 0, 'Life4 target must have initial Shield');
  h.setActiveUnitForTest('p2'); wiring.setCritActionForTest('p2');
  const damage = wiring.requestedDamage('p2', 'e2', 'direct_projectile', 20, { gearDamageProfile: 'normal_cannonball', directTargetId: 'e2' });
  assert.equal(typeof damage, 'number');
  wiring.applyResolvedDamage('p2', 'e2', 5);
  assert.ok(wiring.shieldState().e2.currentShield < e2Before, 'p2 -> e2 production damage consumes e2 Shield first');
  kt.setUnitHpForTest('p2', Math.max(1, kt.snapshot().units.find(unit => unit.id === 'p2').hp - 20));
  assert.ok(wiring.applyHealing('p2', 'p2', 10).actualHealing > 0, 'p2 uses the existing self-heal boundary only');
  wiring.recordLastStandDamage({ ownerId: 'e2', target: kt.unitById('p2'), actualDamage: 1, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  assert.equal(wiring.beginLastStandAttack('p2'), true); assert.equal(wiring.completeLastStandAttack('p2'), true);
  assert.equal(wiring.rngActionIdentity('p2').sourceUnitId, 'p2');
  assert.equal(wiring.runtimeEffectsState().p2.rescueNextAttackDamageBp, 0,
    '2v2 foundation starts Rescue runtime at zero; Phase 3D-7B2 owns grants');
});

test('production 2v2 serializes and restores all Shield entries, while a 1v1 recovery payload fails atomically', () => {
  production2v2();
  wiring.setShieldForTest('p2', 0); const snap = wiring.turnSnapshotForTest();
  assert.deepEqual(Object.keys(snap.gearRuntimeState.shieldByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)).gearRuntimeState, snap.gearRuntimeState);
  wiring.setShieldStateRawForTest(null);
  assert.deepEqual(Object.keys(wiring.prepareRuntimeState(snap).shieldStateByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  const before = kt.snapshot(); const invalid = structuredClone(snap);
  invalid.gearRuntimeState.matchFormat = '1v1'; invalid.gearRuntimeState.shieldByUnit = { p1: invalid.gearRuntimeState.shieldByUnit.p1, e1: invalid.gearRuntimeState.shieldByUnit.e1 };
  assert.throws(() => wiring.prepareRuntimeState(invalid), error => error?.code === 'ONLINE_GEAR_RUNTIME_STATE_FORMAT_MISMATCH');
  assert.deepEqual(kt.snapshot(), before, 'format rejection occurs before Battle mutation');
});

test('Gear OFF 2v2 keeps the legacy no-Gear runtime shape', () => {
  kt.setMatchFormatForTest('2v2'); h.setOnlineForLogTest(onlineFixture2v2({ gear: false }));
  assert.equal(wiring.createBattleStartState(null), null);
  assert.equal(wiring.runtimeState(), null);
});

console.log(`gear-online-battle-2v2-foundation-phase3d7b1: ${passed}/9 passed`);
