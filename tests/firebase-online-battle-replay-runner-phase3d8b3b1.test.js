const assert = require('node:assert/strict');
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

function installRecoveryOnline({ role = 'guest' } = {}) {
  const settings = { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, gearCapability: false };
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

async function recoveryPlan({ role = 'guest', mutateStart = null, tail = [], roundStatus = 'playing' } = {}) {
  installRecoveryOnline({ role });
  kt.startBattle('kyoryu');
  const snap = kt.snapshot();
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
      await fails('FIREBASE_RECOVERY_REPLAY_TIMEOUT', () => bridge.replay(first, { timeoutMs: 0 }));
      assert.deepEqual(kt.snapshot(), beforeReplay, 'timeout replay must restore the pre-replay Battle state');
      assert.equal(bridge.onlinePhase(), beforeTimeoutPhase, 'timeout must restore the prior ONLINE phase');
      assert.equal(bridge.replayActive(), false, 'timeout must release the replay context');
    }
  });

  await test('a historical concede result is validated without result delivery, records, or visible transition', async () => {
    installRecoveryOnline();
    kt.startBattle('kyoryu');
    const units = kt.snapshot().units.map(unit => ({ id: unit.id, hp: unit.hp }));
    const concede = { ...packet('result', { actionId: 'c'.repeat(48), unitId: 'p1', winner: 'cpu', reason: 'concede', concede: true, units }) };
    const plan = await recoveryPlan({ roundStatus: 'results', tail: [concede] });
    const actual = await bridge.replay(plan);
    assert.equal(actual.result.conceded, true);
    assert.equal(actual.sideEffects.outboundCount, 0);
    assert.equal(actual.sideEffects.randomCalls, 0);
  });

  console.log(`Firebase Battle Replay Runner Phase 3D-8B3B1 tests: ${passed}/6 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
