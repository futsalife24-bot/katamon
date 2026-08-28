const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const bridge = h.firebaseBattleRecoveryForTest();
const roomCode = 'A2BC3DEF';
const roundId = 'a'.repeat(48);
const hostUid = 'host-p1';
const guestUid = 'guest-e1';
const key = number => `-${String(number).padStart(19, '0')}`;
const packet = (t, extra = {}) => ({ v: 3, t, from: hostUid, seat: 'p1', roundId, sentAt: 1800000000000, ...extra });
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };
function turnStateFrom(snapshot) {
  const state = structuredClone(snapshot);
  for (const field of ['segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey', 'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments', 'customStage', 'customStageIdentity', 'terrainDelta']) delete state[field];
  return state;
}

function room(status) {
  const now = Date.now();
  return {
    protocol: 3, hostUid, createdAt: 1800000000000, expiresAt: now + 600000,
    visibility: 'private', settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
    slots: { p1: { uid: hostUid, claimedAt: now - 1 }, e1: { uid: guestUid, claimedAt: now - 1 }, s1: null, s2: null },
    round: { id: roundId, status, players: { p1: hostUid, e1: guestUid } }
  };
}
function candidate(status, lease) {
  const current = room(status);
  return Object.freeze({ auth: { uid: guestUid, idToken: 'test', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, serverTimeOffset: 0 }, room: current,
    roomCode, seat: 'e1', role: 'guest', roundId, roundStatus: status,
    credential: { version: 1, uid: guestUid, refreshToken: 'refresh', roomCode, seat: 'e1', roomCreatedAt: current.createdAt, hostUid, lastConfirmedExpiresAt: current.expiresAt, savedAt: current.createdAt }, reentryLease: lease });
}
function fakeEventSource({ failConnect = false } = {}) {
  const original = global.EventSource;
  const instances = [];
  global.EventSource = class {
    constructor(url) { if (failConnect) throw new Error('connect failed'); this.url = url; this.listeners = new Map(); this.closed = false; instances.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    close() { this.closed = true; }
  };
  const put = (instance, payload) => instance.listeners.get('put')?.({ data: JSON.stringify(payload) });
  return { instances, put, restore: () => { global.EventSource = original; } };
}
function fakeFetchRoom(roomValue) {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(roomValue) });
  return () => { global.fetch = original; };
}
async function battleStartPlan(lease) {
  const current = candidate('playing', lease);
  h.setOnlineForLogTest({
    kind: 'firebase', role: 'guest', room: roomCode, roomHostUid: hostUid, auth: current.auth, clientId: guestUid, seat: 'e1', peerSeat: 'p1', phase: 'lobby', currentRoundId: roundId,
    settings: current.room.settings, slots: current.room.slots, queue: [], seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {}, participantGearReveals: {}, pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), battleGearSnapshotsByUnit: null,
    battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    selfCharacter: 'iwa', selfNonce: '', selfCommit: null, selfRevealed: false, peerCharacter: null, peerNonce: null, revealVerified: false,
    unitCharacters: { p1: 'kyoryu', e1: 'iwa' }, visibility: 'private', acceptedSettingsRevision: 1, acceptedSettingsIdentity: '', persistedRosterIdentity: '', transport: { send: async () => true }
  });
  kt.startBattle('kyoryu');
  const snap = structuredClone(kt.snapshot());
  const hostNonce = 'a'.repeat(48); const guestNonce = 'b'.repeat(48);
  snap.activeIndex = (await h.fairFirstPlayer(roomCode, hostNonce, guestNonce)) === 'p1' ? 0 : 1;
  snap.units.find(unit => unit.id === 'p1').character = 'kyoryu';
  snap.units.find(unit => unit.id === 'e1').character = 'iwa';
  return bridge.build(current, {
    [key(1)]: packet('commit', { hash: await h.commitPayload('kyoryu', hostNonce) }),
    [key(2)]: { ...packet('commit', { hash: await h.commitPayload('iwa', guestNonce) }), from: guestUid, seat: 'e1' },
    [key(3)]: packet('reveal', { character: 'kyoryu', nonce: hostNonce }),
    [key(4)]: { ...packet('reveal', { character: 'iwa', nonce: guestNonce }), from: guestUid, seat: 'e1' },
    [key(5)]: packet('start', { snap })
  });
}
async function revealingPlan(lease) {
  const current = candidate('revealing', lease);
  const hostNonce = 'a'.repeat(48); const guestNonce = 'b'.repeat(48);
  return bridge.build(current, {
    [key(1)]: packet('commit', { hash: await h.commitPayload('kyoryu', hostNonce) }),
    [key(2)]: { ...packet('commit', { hash: await h.commitPayload('iwa', guestNonce) }), from: guestUid, seat: 'e1' },
    [key(3)]: packet('ready', { value: true }),
    [key(4)]: { ...packet('ready', { value: true }), from: guestUid, seat: 'e1' },
    [key(5)]: packet('reveal', { character: 'kyoryu', nonce: hostNonce }),
    [key(6)]: { ...packet('reveal', { character: 'iwa', nonce: guestNonce }), from: guestUid, seat: 'e1' }
  });
}
async function battleBoundaryPlan(lease) {
  const current = candidate('playing', lease);
  const startPlan = await battleStartPlan(lease);
  const start = startPlan.start.packet.snap;
  const unitId = start.turnOrder[start.activeIndex];
  const actor = unitId === 'p1'
    ? { from: hostUid, seat: 'p1', x: 240, vx0: -5000 }
    : { from: guestUid, seat: 'e1', x: 1200, vx0: 5000 };
  const actionId = `${unitId === 'p1' ? 'c' : 'd'}${'a'.repeat(47)}`;
  const fire = { ...packet('fire', {
    actionId, unitId, x: actor.x, y: 360, anchor: { x: actor.x, y: 360 }, vx0: actor.vx0, vy0: -140,
    useSpecial: false, useJump: false, sentAt: 1800000000001
  }), from: actor.from, seat: actor.seat };
  const frame = callback => setImmediate(() => { kt.step(0.05); callback(); });
  const generated = await bridge.generateTerminal(startPlan, fire, { frame, timeoutMs: 15000 });
  const messages = Object.fromEntries(startPlan.orderedEntries.map(entry => [entry.key, structuredClone(entry.packet)]));
  messages[key(6)] = fire;
  messages[key(7)] = { ...packet('state', {
    actionId, unitId, snap: turnStateFrom(generated.snap), sentAt: 1800000000002
  }), from: actor.from, seat: actor.seat };
  return bridge.build(current, messages);
}

(async () => {
  await test('lobby re-entry transfers the existing lease only after a deferred, pre-seeded SSE shell activates', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('lobby', lease);
    const plan = bridge.build(value, {});
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan });
      assert.equal(activated.kind, 'lobby'); assert.equal(activated.activated, true);
      assert.equal(bridge.pending(), null, 'activation transfers rather than clears the lease');
      assert.equal(bridge.activeOnline().reentryLease, lease);
      assert.equal(released, 0, 'the transfer must not create an unlocked tab window');
      assert.equal(source.instances.length, 1, 'SSE connects only after activation');
      assert.match(source.instances[0].url, /messages\.json/);
    } finally {
      bridge.endActive();
      source.restore();
    }
    assert.equal(released, 1, 'normal terminal cleanup releases the transferred lease exactly once');
  });

  await test('wait plans keep the pending candidate and lease without opening Battle or SSE', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('playing', lease);
    const plan = Object.freeze({ kind: 'wait_for_turn_boundary', pendingAction: Object.freeze({ actionId: 'b'.repeat(48) }) });
    bridge.setPending(value);
    try {
      const waiting = await bridge.activatePending({ plan, noRetry: true });
      assert.equal(waiting.activated, false);
      assert.equal(bridge.pending(), value);
      assert.equal(released, 0);
      assert.equal(source.instances.length, 0);
    } finally {
      bridge.setPending(null);
      source.restore();
    }
  });

  await test('hiding a queued wait retry cancels it, and repeated visible resumes schedule exactly one retry', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const value = candidate('playing', lease);
    const plan = Object.freeze({ kind: 'wait_for_start', pendingAction: null });
    bridge.setRecoveryDocumentHidden(false);
    bridge.setPending(value);
    try {
      await bridge.activatePending({ plan });
      assert.equal(bridge.retryScheduled(), true);
      bridge.setRecoveryDocumentHidden(true);
      assert.equal(bridge.retryScheduled(), false, 'hidden transition cancels a previously queued retry');
      assert.equal(bridge.activeOnline(), null);
      assert.equal(source.instances.length, 0);
      bridge.setRecoveryDocumentHidden(false);
      assert.equal(bridge.retryScheduled(), true, 'visible resume schedules one retry');
      bridge.setRecoveryDocumentHidden(false);
      assert.equal(bridge.retryScheduled(), true, 'repeated visible events do not multiply retries');
      bridge.setRecoveryDocumentHidden(true);
    } finally {
      bridge.setPending(null);
      bridge.setRecoveryDocumentHidden(false);
      source.restore();
    }
  });

  await test('revealing re-entry rebuilds persisted own commit, ready, and reveal evidence before seeded SSE starts', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const value = candidate('revealing', lease);
    const plan = await revealingPlan(lease);
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan });
      const active = bridge.activeOnline();
      assert.equal(activated.kind, 'revealing');
      assert.equal(active.phase, 'revealing');
      assert.equal(active.seatReady.e1, true);
      assert.equal(active.selfRevealed, true);
      assert.equal(active.seatVerified.e1, true);
      assert.equal(source.instances.length, 1);
    } finally {
      bridge.endActive();
      source.restore();
    }
  });

  await test('historical rematch votes are rebuilt before their seeded history can be ignored by SSE', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const value = candidate('revealing', lease);
    const plan = await revealingPlan(lease);
    const messages = Object.fromEntries(plan.orderedEntries.map(entry => [entry.key, structuredClone(entry.packet)]));
    messages[key(7)] = packet('rematchVote', { vote: true });
    messages[key(8)] = { ...packet('rematchVote', { vote: false }), from: guestUid, seat: 'e1' };
    const voted = bridge.build(value, messages);
    bridge.setPending(value);
    try {
      await bridge.activatePending({ plan: voted });
      assert.deepEqual(bridge.activeOnline().rematchVotes, { p1: true, e1: false });
    } finally {
      bridge.endActive();
      source.restore();
    }
  });

  await test('an old-round nextRoundId handoff waits without activating stale results or seeding its history', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('results', lease);
    const nextRoundId = 'b'.repeat(48);
    const plan = Object.freeze({ kind: 'results_candidate', roundId, orderedEntries: Object.freeze([
      Object.freeze({ key: key(1), packet: packet('lobbyState', { status: 'lobby', nextRoundId }) })
    ]) });
    const beforeOnline = bridge.activeOnline();
    bridge.setPending(value);
    try {
      const waiting = await bridge.activatePending({ plan, noRetry: true });
      assert.equal(waiting.kind, 'wait_for_round_handoff');
      assert.equal(waiting.nextRoundId, nextRoundId);
      assert.equal(bridge.activeOnline(), beforeOnline, 'handoff wait must not create an online shell');
      assert.equal(bridge.pending(), value);
      assert.equal(released, 0);
      assert.equal(source.instances.length, 0);
    } finally {
      bridge.setPending(null);
      source.restore();
    }
  });

  await test('transport connection failure occurs before Battle commit and preserves the same pending lease', async () => {
    const source = fakeEventSource({ failConnect: true });
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('playing', lease);
    const plan = await battleStartPlan(lease);
    const before = structuredClone(kt.snapshot());
    const beforeOnline = bridge.activeOnline();
    bridge.setPending(value);
    try {
      await assert.rejects(() => bridge.activatePending({ plan }), error => error?.code === 'FIREBASE_RECOVERY_TRANSPORT_CONNECT_FAILED');
      assert.equal(bridge.activeOnline(), beforeOnline);
      assert.equal(bridge.pending(), value);
      assert.equal(released, 0);
      assert.deepEqual(kt.snapshot(), before);
    } finally {
      bridge.setPending(null);
      source.restore();
    }
  });

  await test('a verified Gear-OFF start bundle commits only after B3B1 verification, then hands off to seeded SSE', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('playing', lease);
    const plan = await battleStartPlan(lease);
    const expectedStart = structuredClone(plan.start.packet.snap);
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan });
      assert.equal(activated.kind, 'battle_start_candidate');
      assert.equal(activated.activated, true);
      assert.equal(bridge.activeOnline().phase, 'playing');
      assert.equal(bridge.activeOnline().localAction, null);
      assert.equal(bridge.activeOnline().remoteAction, null);
      assert.equal(bridge.activeOnline().reentryLease, lease);
      assert.equal(released, 0);
      assert.deepEqual(kt.snapshot().units.map(unit => ({ id: unit.id, hp: unit.hp, fuel: unit.fuel })), expectedStart.units.map(unit => ({ id: unit.id, hp: unit.hp, fuel: unit.fuel })));
      assert.equal(source.instances.length, 1);
    } finally {
      bridge.endActive();
      source.restore();
    }
    assert.equal(released, 1);
  });

  await test('seeded historical SSE packets stay inert while a REST-to-SSE gap packet drains exactly once after activation', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const value = candidate('playing', lease);
    const plan = await battleStartPlan(lease);
    bridge.setPending(value);
    try {
      await bridge.activatePending({ plan });
      const active = bridge.activeOnline();
      const stream = source.instances[0];
      const freshReady = packet('ready', { value: true, sentAt: 1800000000003 });
      source.put(stream, { path: '/', data: { [key(5)]: plan.start.packet, [key(6)]: freshReady } });
      assert.equal(active.seatReady.p1, true, 'unseeded gap key reaches the ordinary receiver');
      assert.equal(active.phase, 'playing', 'seeded historical start must not reset the committed battle');
      source.put(stream, { path: '/', data: { [key(6)]: freshReady } });
      assert.equal(active.seatReady.p1, true, 'the same gap push key remains a no-op');
    } finally {
      bridge.endActive();
      source.restore();
    }
  });

  await test('a final round fence race after replay rejects before commit, transfer, or live receiver handoff', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('playing', lease);
    const plan = await battleStartPlan(lease);
    const advanced = room('playing');
    advanced.round.id = 'b'.repeat(48);
    const restoreFetch = fakeFetchRoom(advanced);
    const before = structuredClone(kt.snapshot());
    const beforeOnline = bridge.activeOnline();
    bridge.setPending(value);
    try {
      await assert.rejects(() => bridge.activatePending({ plan, enforceFinalRoundFence: true, finalRoundRefreshed: true }), error => error?.code === 'FIREBASE_RECOVERY_ROUND_ADVANCED');
      assert.deepEqual(kt.snapshot(), before);
      assert.equal(bridge.activeOnline(), beforeOnline);
      assert.equal(bridge.pending(), value);
      assert.equal(released, 0);
      assert.equal(source.instances[0].closed, true, 'quarantine transport is closed on final-fence failure');
    } finally {
      bridge.setPending(null);
      restoreFetch();
      source.restore();
    }
  });

  await test('a replay-verified turn boundary commits the local baseline, never the candidate board, before SSE handoff', async () => {
    const source = fakeEventSource();
    let released = 0;
    const lease = { release: () => { released += 1; } };
    const value = candidate('playing', lease);
    const plan = await battleBoundaryPlan(lease);
    const expected = structuredClone(plan.lastCandidateBoundary.terminal.packet.snap);
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan, frame: callback => setImmediate(() => { kt.step(0.05); callback(); }), timeoutMs: 15000 });
      assert.equal(activated.kind, 'candidate_turn_boundary');
      assert.equal(activated.activated, true);
      assert.equal(activated.replay.lastBoundary.fire.packet.actionId, plan.lastCandidateBoundary.fire.packet.actionId);
      assert.equal(bridge.activeOnline().phase, 'playing');
      assert.equal(bridge.activeOnline().localAction, null);
      assert.equal(bridge.activeOnline().remoteAction, null);
      assert.equal(bridge.activeOnline().reentryLease, lease);
      assert.deepEqual(kt.snapshot().units.map(unit => ({ id: unit.id, hp: unit.hp, fuel: unit.fuel })), expected.units.map(unit => ({ id: unit.id, hp: unit.hp, fuel: unit.fuel })));
      assert.equal(source.instances.length, 1);
    } finally {
      bridge.endActive();
      source.restore();
    }
    assert.equal(released, 1);
  });

  console.log(`Firebase Battle Re-entry Activation Phase 3D-8B3B2 tests: ${passed}/11 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
