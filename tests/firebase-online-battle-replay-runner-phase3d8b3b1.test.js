const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const gearProtocol = require('../shared/gear-online-protocol.js');
const gearLobby = require('../shared/gear-online-lobby-protocol.js');
const gearWire = require('../shared/gear-online-firebase-wire.js');
const gearBattleStart = require('../shared/gear-online-battle-start.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const bridge = h.firebaseBattleRecoveryForTest();
const roundId = 'a'.repeat(48);
const hostUid = 'host-p1';
const guestUid = 'guest-e1';
const roomCode = 'A2BC3DEF';
const key = number => `-${String(number).padStart(19, '0')}`;
const packet = (t, extra = {}) => ({ v: 3, t, from: hostUid, seat: 'p1', roundId, sentAt: 1800000000000, ...extra });
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.rejects(fn, error => error?.code === code || String(error?.code || '').startsWith(`${code}:`));
function turnStateFrom(snapshot) {
  const state = structuredClone(snapshot);
  for (const keyName of ['segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey', 'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments', 'customStage', 'customStageIdentity']) delete state[keyName];
  return state;
}

function installRecoveryOnline({ role = 'guest', wind = 'calm' } = {}) {
  const settings = { terrain: 'rolling', wind, turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, gearCapability: false };
  const slots = { p1: { uid: hostUid }, e1: { uid: guestUid }, s1: null, s2: null };
  h.setOnlineForLogTest({
    kind: 'firebase', role, room: roomCode, roomHostUid: hostUid, auth: { uid: role === 'host' ? hostUid : guestUid }, clientId: role === 'host' ? hostUid : guestUid,
    seat: role === 'host' ? 'p1' : 'e1', peerSeat: role === 'host' ? 'e1' : 'p1', phase: 'lobby', currentRoundId: roundId,
    settings, slots, queue: [], seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {},
    participantGearReveals: {}, pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), battleGearSnapshotsByUnit: null,
    battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    selfCharacter: 'kyoryu', selfNonce: '', selfCommit: null, selfRevealed: false, peerCharacter: null, peerNonce: null, revealVerified: false,
    unitCharacters: { p1: 'kyoryu', e1: 'iwa' }, visibility: 'private', acceptedSettingsRevision: 1, acceptedSettingsIdentity: '', persistedRosterIdentity: '', transport: { send: async () => true }
  });
  return { settings, slots };
}

async function recoveryPlan({ role = 'guest', mutateStart = null, tail = [], roundStatus = 'playing', startSnapshot = null } = {}) {
  installRecoveryOnline({ role });
  if (!startSnapshot) kt.startBattle('kyoryu');
  const snap = structuredClone(startSnapshot || kt.snapshot());
  const hostCharacter = 'kyoryu'; const guestCharacter = 'iwa';
  const hostNonce = 'a'.repeat(48); const guestNonce = 'b'.repeat(48);
  const hostHash = await h.commitPayload(hostCharacter, hostNonce);
  const guestHash = await h.commitPayload(guestCharacter, guestNonce);
  const start = packet('start', { snap: structuredClone(snap) });
  start.snap.units.find(unit => unit.id === 'p1').character = hostCharacter;
  start.snap.units.find(unit => unit.id === 'e1').character = guestCharacter;
  start.snap.activeIndex = (await h.fairFirstPlayer(roomCode, hostNonce, guestNonce)) === 'p1' ? 0 : 1;
  if (mutateStart) mutateStart(start);
  const candidate = { auth: { idToken: 'test' }, room: { hostUid, settings: { gearCapability: false } }, roomCode, seat: role === 'host' ? 'p1' : 'e1', roundId, roundStatus };
  return bridge.build(candidate, {
    [key(1)]: packet('commit', { hash: hostHash }),
    [key(2)]: { ...packet('commit', { hash: guestHash }), from: guestUid, seat: 'e1' },
    [key(3)]: packet('reveal', { character: hostCharacter, nonce: hostNonce }),
    [key(4)]: { ...packet('reveal', { character: guestCharacter, nonce: guestNonce }), from: guestUid, seat: 'e1' },
    [key(5)]: start,
    ...Object.fromEntries(tail.map((entry, index) => [key(6 + index), entry]))
  });
}

function recoveryGear(prefix, setId, slotId) {
  return domain.createGear({ gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`, sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z', qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: setId, setWeights: [{ id: setId, weight: 1 }] }, slotId });
}
function recoverySet(prefix, setId) { return domain.SLOT_IDS.map(slotId => recoveryGear(prefix, setId, slotId)); }
async function gearRecoveryPlan({ role = 'guest', p1 = recoverySet('p1-life', 'life'), e1 = recoverySet('e1-last', 'last_stand') } = {}) {
  const capability = gearLobby.createRoomGearCapability({ visibility: 'private', gearMode: gearProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  installRecoveryOnline({ role });
  // Install the same production-shaped Firebase record used by recoveryPlan,
  // with the private trusted Gear capability as its only semantic difference.
  h.setOnlineForLogTest({
    kind: 'firebase', role, room: roomCode, roomHostUid: hostUid, auth: { uid: role === 'host' ? hostUid : guestUid }, clientId: role === 'host' ? hostUid : guestUid,
    seat: role === 'host' ? 'p1' : 'e1', peerSeat: role === 'host' ? 'e1' : 'p1', phase: 'lobby', currentRoundId: roundId,
    settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, gearCapability: capability },
    slots: { p1: { uid: hostUid }, e1: { uid: guestUid }, s1: null, s2: null }, queue: [], seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {}, participantGearReveals: {}, verifiedStartGearManifest: null,
    battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    selfCharacter: 'kyoryu', selfNonce: '', selfCommit: null, selfRevealed: false, peerCharacter: null, peerNonce: null, revealVerified: false,
    unitCharacters: { p1: 'kyoryu', e1: 'iwa' }, visibility: 'private', acceptedSettingsRevision: 1, acceptedSettingsIdentity: '', persistedRosterIdentity: '', transport: { send: async () => true }
  });
  const wiring = h.firebaseGearLobbyForTest();
  const reveal = (seat, characterId, gears) => {
    const trustedContext = wiring.trustedContext(seat, characterId);
    const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
    for (const item of gears) slots[item.slotId] = item;
    const battleGearSnapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
    return Object.freeze({ trustedContext, revealedCommitment: gearProtocol.createLoadoutCommitment({ battleGearSnapshot, roundId, trustedContext }) });
  };
  const reveals = [reveal('p1', 'kyoryu', p1), reveal('e1', 'iwa', e1)];
  const manifest = gearLobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  const startState = gearBattleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  kt.setCharactersForTest('kyoryu', 'iwa'); h.resetMatchForTest(); kt.setCharactersForTest('kyoryu', 'iwa');
  wiring.applyBattleStartState(startState);
  const snap = kt.snapshot();
  const nonces = { p1: 'a'.repeat(48), e1: 'b'.repeat(48) };
  snap.activeIndex = (await h.fairFirstPlayer(roomCode, nonces.p1, nonces.e1)) === 'p1' ? 0 : 1;
  const messages = {};
  for (const entry of reveals) {
    const seat = entry.revealedCommitment.seatId; const character = entry.trustedContext.expectedCharacterId; const nonce = nonces[seat];
    const binding = gearLobby.createReadyGearBinding({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext });
    messages[key(Object.keys(messages).length + 1)] = { ...packet('commit', { hash: await h.commitPayload(character, nonce, gearLobby.stableSerializeReadyGearBinding(binding)) }), from: seat === 'p1' ? hostUid : guestUid, seat };
    messages[key(Object.keys(messages).length + 1)] = { ...packet('reveal', { character, nonce, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearCommitmentJson: gearWire.encodeRevealGearCommitment({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext }) }), from: seat === 'p1' ? hostUid : guestUid, seat };
  }
  messages[key(5)] = packet('start', { snap, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearManifestJson: gearWire.encodeStartGearManifest({ manifest, participantReveals: reveals }) });
  return bridge.build({ auth: { idToken: 'test' }, room: { hostUid, settings: { gearCapability: capability } }, roomCode, seat: role === 'host' ? 'p1' : 'e1', roundId, roundStatus: 'playing' }, messages);
}
async function gearRecoveryPlan2v2({ role = 'host' } = {}) {
  const capability = gearLobby.createRoomGearCapability({ visibility: 'private', gearMode: gearProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  const seats = [
    ['p1', 'p1', hostUid, 'kyoryu', recoverySet('p1-life', 'life')],
    ['e1', 'e1', guestUid, 'iwa', recoverySet('e1-last', 'last_stand')],
    ['s1', 'p2', 'ally-s1', 'kyoryu', recoverySet('p2-rescue', 'rescue')],
    ['s2', 'e2', 'ally-s2', 'iwa', recoverySet('e2-life', 'life')]
  ];
  const selected = seats.find(entry => entry[0] === (role === 's1' ? 's1' : 'p1'));
  h.setOnlineForLogTest({
    kind: 'firebase', role: selected[0] === 'p1' ? 'host' : 'guest', room: roomCode, roomHostUid: hostUid, auth: { uid: selected[2] }, clientId: selected[2], seat: selected[0], peerSeat: 'e1', phase: 'lobby', currentRoundId: roundId,
    settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '2v2', stageSize: 'standard', revision: 1, gearCapability: capability },
    slots: Object.fromEntries(seats.map(([seat, _unit, uid]) => [seat, { uid }])), queue: [], seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {}, participantGearReveals: {}, verifiedStartGearManifest: null,
    battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    selfCharacter: selected[3], selfNonce: '', selfCommit: null, selfRevealed: false, peerCharacter: null, peerNonce: null, revealVerified: false,
    unitCharacters: Object.fromEntries(seats.map(([_seat, unit, _uid, character]) => [unit, character])), visibility: 'private', acceptedSettingsRevision: 1, acceptedSettingsIdentity: '', persistedRosterIdentity: '', transport: { send: async () => true }
  });
  const wiring = h.firebaseGearLobbyForTest();
  const reveals = seats.map(([seat, _unit, _uid, characterId, gears]) => {
    const trustedContext = wiring.trustedContext(seat, characterId); const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
    for (const item of gears) slots[item.slotId] = item;
    const battleGearSnapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
    return Object.freeze({ trustedContext, revealedCommitment: gearProtocol.createLoadoutCommitment({ battleGearSnapshot, roundId, trustedContext }) });
  });
  const manifest = gearLobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  const state = gearBattleStart.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest, participantReveals: reveals });
  kt.setMatchFormatForTest('2v2');
  kt.setCharactersForTest('kyoryu', 'iwa');
  kt.setCharacterForUnitForTest('p2', 'kyoryu'); kt.setCharacterForUnitForTest('e2', 'iwa');
  h.resetMatchForTest();
  for (const [_seat, unit, _uid, character] of seats) kt.setCharacterForUnitForTest(unit, character);
  wiring.applyBattleStartState(state);
  const snap = kt.snapshot(); const nonces = Object.fromEntries(seats.map(([seat], index) => [seat, String.fromCharCode(97 + index).repeat(48)]));
  const digest = crypto.createHash('sha256').update(`${roomCode}:${seats.map(([seat]) => nonces[seat]).join(':')}`).digest('hex'); snap.activeIndex = parseInt(digest.slice(-1), 16) & 1;
  const messages = {};
  for (const entry of reveals) {
    const seat = entry.revealedCommitment.seatId; const actor = seats.find(row => row[0] === seat); const nonce = nonces[seat]; const character = entry.trustedContext.expectedCharacterId;
    const binding = gearLobby.createReadyGearBinding({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext });
    messages[key(Object.keys(messages).length + 1)] = { ...packet('commit', { hash: await h.commitPayload(character, nonce, gearLobby.stableSerializeReadyGearBinding(binding)) }), from: actor[2], seat };
    messages[key(Object.keys(messages).length + 1)] = { ...packet('reveal', { character, nonce, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearCommitmentJson: gearWire.encodeRevealGearCommitment({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext }) }), from: actor[2], seat };
  }
  messages[key(9)] = packet('start', { snap, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearManifestJson: gearWire.encodeStartGearManifest({ manifest, participantReveals: reveals }) });
  return bridge.build({ auth: { idToken: 'test' }, room: { hostUid, settings: { gearCapability: capability } }, roomCode, seat: selected[0], roundId, roundStatus: 'playing' }, messages);
}

(async () => {
  await test('historical start validates through the production snapshot path without outbound, visual, or Math.random side effects', async () => {
    const plan = await recoveryPlan();
    const nativeRandom = Math.random;
    const beforeReplay = kt.snapshot();
    const beforePhase = bridge.onlinePhase();
    const result = await bridge.replay(plan);
    assert.equal(result.kind, 'battle_start_candidate');
    assert.equal(result.validatedBoundaries.length, 0);
    assert.equal(result.sideEffects.outboundCount, 0);
    assert.equal(result.sideEffects.randomCalls, 0);
    assert.equal(Math.random, nativeRandom, 'replay context must restore Math.random identity');
    assert.equal(bridge.replayActive(), false, 'replay context must be released after success');
    assert.deepEqual(kt.snapshot(), beforeReplay, 'verified replay must restore the pre-replay Battle state');
    assert.equal(bridge.onlinePhase(), beforePhase, 'verified replay must restore the prior ONLINE phase');
  });

  await test('historical start rejects a character mismatch instead of adopting its candidate snapshot', async () => {
    const plan = await recoveryPlan({ mutateStart: start => { start.snap.units.find(unit => unit.id === 'e1').character = 'hamulton'; } });
    await fails('FIREBASE_RECOVERY_START_MISMATCH', () => bridge.replay(plan));
    assert.equal(bridge.replayActive(), false, 'replay context must be released after failure');
  });

  await test('candidate HP, fuel, and crater changes are stricter replay mismatches', async () => {
    const baseline = kt.snapshot(); const candidate = structuredClone(baseline);
    candidate.units[0].hp -= 1;
    assert.match(bridge.recoverySnapshotMismatch(candidate, baseline), /^hp\./);
    candidate.units[0].hp = baseline.units[0].hp; candidate.units[0].fuel -= 1;
    assert.match(bridge.recoverySnapshotMismatch(candidate, baseline), /^fuel\./);
    candidate.units[0].fuel = baseline.units[0].fuel; candidate.craters = [{ x: 1, y: 2, r: 3 }];
    assert.equal(bridge.recoverySnapshotMismatch(candidate, baseline), 'craters');
  });

  await test('a forbidden replay Math.random call fails before the captured native RNG can advance', async () => {
    const nativeRandom = Math.random;
    let nativeCalls = 0;
    const guardedNative = () => { nativeCalls += 1; return nativeRandom(); };
    Math.random = guardedNative;
    try {
      await fails('FIREBASE_RECOVERY_REPLAY_RANDOM_CONSUMED', () => bridge.replayRandomProbe());
      assert.equal(nativeCalls, 0, 'the replay guard must not call its captured native RNG');
      assert.equal(Math.random, guardedNative, 'Math.random identity must restore after the rejected probe');
      assert.equal(bridge.replayActive(), false);
    } finally {
      Math.random = nativeRandom;
    }
  });

  await test('historical local/remote move and fire settle through the production game loop before terminal acceptance', async () => {
    const firstUnit = (await h.fairFirstPlayer(roomCode, 'a'.repeat(48), 'b'.repeat(48))) === 'p1' ? 'p1' : 'e1';
    // Fire outward at high speed so this fixture validates replay sequencing
    // and turn settlement without making a terrain-impact fixture depend on
    // an unrelated collision location.
    const actor = firstUnit === 'e1' ? { from: guestUid, seat: 'e1', x: 1200, vx: 5000 } : { from: hostUid, seat: 'p1', x: 240, vx: -5000 };
    const frame = callback => setImmediate(() => { kt.step(0.05); callback(); });
    for (const [role, includeMove] of [['guest', true], ['host', false]]) {
      const actionId = `${role === 'guest' ? 'f' : 'e'}${'a'.repeat(47)}`;
      const fire = { ...packet('fire', {
        actionId, unitId: firstUnit, x: actor.x, y: 360, anchor: { x: actor.x, y: 360 }, vx0: actor.vx, vy0: -140, useSpecial: false, useJump: false, sentAt: 1800000000001
      }), from: actor.from, seat: actor.seat };
      const move = { ...packet('move', { unitId: firstUnit, x: actor.x, fuel: 77, sentAt: 1800000000000 }), from: actor.from, seat: actor.seat };
      // First pass deliberately supplies an old terminal.  The runner must
      // settle the real projectile before it can reject that candidate.
      const staleState = { ...packet('state', { actionId, unitId: firstUnit, snap: turnStateFrom(kt.snapshot()), sentAt: 1800000000002 }), from: actor.from, seat: actor.seat };
      const first = await recoveryPlan({ role, tail: includeMove ? [move, fire, staleState] : [fire, staleState] });
      const startSnapshot = structuredClone(first.start.packet.snap);
      // Produce the independently expected terminal through the ordinary
      // Battle engine, then restore the start before exercising the verifier.
      // A failed verifier must never be the source of its own "valid" state.
      kt.applySnapshotForTest(startSnapshot);
      kt.setGamePhaseForTest('battle');
      h.setActiveUnitForTest(firstUnit);
      const historicalUnit = kt.unitById(firstUnit);
      if (includeMove) historicalUnit.fuel = 77;
      kt.setUnitPositionForTest(firstUnit, actor.x, actor.y);
      kt.fireForTest(actor.vx, -140, { unitId: firstUnit });
      kt.setAwaitingResolveForTest(true);
      for (let tick = 0; tick < 1200 && kt.snapshot().activeIndex === startSnapshot.activeIndex; tick++) kt.step(0.05);
      const resolved = kt.snapshot();
      assert.notEqual(resolved.activeIndex, startSnapshot.activeIndex, 'independent production simulation must reach the next turn');
      kt.applySnapshotForTest(startSnapshot);
      const beforeReplay = kt.snapshot();
      await assert.rejects(() => bridge.replay(first, { frame, timeoutMs: 15000 }), error => String(error?.code || '').startsWith('FIREBASE_RECOVERY_'));
      assert.deepEqual(kt.snapshot(), beforeReplay, 'mismatched replay must restore the pre-replay Battle state');
      const beforeTimeoutPhase = bridge.onlinePhase();
      kt.setAwaitingResolveForTest(false);
      await fails('FIREBASE_RECOVERY_REPLAY_TIMEOUT', () => bridge.replay(first, { timeoutMs: 0 }));
      assert.deepEqual(kt.snapshot(), beforeReplay, 'timeout replay must restore the pre-replay Battle state');
      assert.equal(bridge.onlinePhase(), beforeTimeoutPhase, 'timeout must restore the prior ONLINE phase');
      assert.equal(kt.awaitingResolveForTest(), false, 'timeout must restore the transient awaitingResolve latch');
      assert.equal(bridge.replayActive(), false, 'timeout must release the replay context');
    }
  });

  await test('a historical concede result is validated without result delivery, records, or visible transition', async () => {
    installRecoveryOnline({ wind: 'random' });
    kt.startBattle('kyoryu');
    const units = kt.snapshot().units.map(unit => ({ id: unit.id, hp: unit.hp }));
    const concede = { ...packet('result', { actionId: 'c'.repeat(48), unitId: 'p1', winner: 'cpu', reason: 'concede', concede: true, units }) };
    const plan = await recoveryPlan({ roundStatus: 'results', tail: [concede] });
    const actual = await bridge.replay(plan);
    assert.equal(actual.result.conceded, true);
    assert.equal(actual.sideEffects.outboundCount, 0);
    assert.equal(actual.sideEffects.randomCalls, 0);
  });

  await test('a replay wind boundary consumes only the persisted forecast and never native Math.random', async () => {
    installRecoveryOnline({ wind: 'random' });
    kt.startBattle('kyoryu');
    kt.setTurnCountForTest(kt.state().turnOrder.length * 2); // two full rounds is the wind boundary.
    kt.setWindCycleForTest({ dir: -1, strength: .2, calmWind: false }, { dir: 1, strength: .73, calmWind: false });
    const nativeRandom = Math.random;
    let calls = 0;
    Math.random = () => { calls += 1; return .5; };
    const before = kt.snapshot();
    try {
      const replayed = await bridge.replayStartTurn();
      assert.equal(replayed.wind.dir, 1); assert.equal(replayed.wind.strength, .73); assert.equal(replayed.wind.calmWind, false);
      assert.equal(calls, 0, 'replay must use the previously persisted forecast, never native RNG');
      assert.equal(kt.windForecast(), null, 'the next forecast remains pending until an accepted action-side terminal provides it');
    } finally {
      Math.random = nativeRandom;
      kt.applySnapshotForTest(before);
    }
  });

  await test('Gear ON historical evidence validates for both host and guest without adopting the candidate board', async () => {
    for (const role of ['host', 'guest']) {
      const plan = await gearRecoveryPlan({ role });
      const before = kt.snapshot();
      const result = await bridge.replay(plan);
      assert.equal(result.kind, 'battle_start_candidate');
      assert.equal(result.sideEffects.outboundCount, 0);
      assert.equal(result.sideEffects.randomCalls, 0);
      assert.deepEqual(kt.snapshot(), before, `Gear ON ${role} replay must roll back its verifier board`);
    }
  });

  await test('Gear ON 2v2 validates all four occupied seats for host and s1 re-entry without board adoption', async () => {
    for (const role of ['host', 's1']) {
      const plan = await gearRecoveryPlan2v2({ role });
      const before = kt.snapshot(); const actual = await bridge.replay(plan);
      assert.equal(actual.kind, 'battle_start_candidate');
      assert.equal(actual.sideEffects.outboundCount, 0);
      assert.equal(actual.sideEffects.randomCalls, 0);
      assert.deepEqual(kt.snapshot(), before, `2v2 ${role} verifier must roll back`);
    }
  });

  console.log(`Firebase Battle Replay Runner Phase 3D-8B3B1 tests: ${passed}/9 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
