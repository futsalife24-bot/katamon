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
const roomCode = 'A2BC3DEF';
let roundId = 'a'.repeat(48);
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
function hostCandidate(status, lease) {
  const current = room(status);
  return Object.freeze({ auth: { uid: hostUid, idToken: 'test', refreshToken: 'refresh-host', expiresAt: Date.now() + 3600000, serverTimeOffset: 0 }, room: current,
    roomCode, seat: 'p1', role: 'host', roundId, roundStatus: status,
    credential: { version: 1, uid: hostUid, refreshToken: 'refresh-host', roomCode, seat: 'p1', roomCreatedAt: current.createdAt, hostUid, lastConfirmedExpiresAt: current.expiresAt, savedAt: current.createdAt }, reentryLease: lease });
}
function recoveryGear(prefix, setId, slotId) {
  return domain.createGear({ gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`, sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z', qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: setId, setWeights: [{ id: setId, weight: 1 }] }, slotId });
}
function recoverySet(prefix, setId) { return domain.SLOT_IDS.map(slotId => recoveryGear(prefix, setId, slotId)); }
function gear2v2Room(status = 'playing') {
  const current = room(status);
  const capability = gearLobby.createRoomGearCapability({ visibility: 'private', gearMode: gearProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  current.settings = { ...current.settings, format: '2v2', gearCapability: capability };
  current.slots = {
    p1: { uid: hostUid, claimedAt: current.createdAt }, e1: { uid: guestUid, claimedAt: current.createdAt },
    s1: { uid: 'ally-s1', claimedAt: current.createdAt }, s2: { uid: 'ally-s2', claimedAt: current.createdAt }
  };
  current.round.players = { p1: hostUid, e1: guestUid, s1: 'ally-s1', s2: 'ally-s2' };
  return current;
}
function gear2v2Candidate(seat, lease) {
  const current = gear2v2Room('playing');
  const uidBySeat = { p1: hostUid, e1: guestUid, s1: 'ally-s1', s2: 'ally-s2' };
  const uid = uidBySeat[seat];
  return Object.freeze({ auth: { uid, idToken: 'test', refreshToken: `refresh-${seat}`, expiresAt: Date.now() + 3600000, serverTimeOffset: 0 }, room: current,
    roomCode, seat, role: seat === 'p1' ? 'host' : 'guest', roundId, roundStatus: 'playing',
    credential: { version: 1, uid, refreshToken: `refresh-${seat}`, roomCode, seat, roomCreatedAt: current.createdAt, hostUid, lastConfirmedExpiresAt: current.expiresAt, savedAt: current.createdAt }, reentryLease: lease });
}
async function gear2v2StartPlan(seat, lease, tail = [], startSnapshot = null, { p2Set = 'rescue' } = {}) {
  const current = gear2v2Candidate(seat, lease);
  const seats = [
    ['p1', 'p1', hostUid, 'kyoryu', recoverySet('p1-life', 'life')],
    ['e1', 'e1', guestUid, 'iwa', recoverySet('e1-last', 'last_stand')],
    ['s1', 'p2', 'ally-s1', 'kyoryu', recoverySet(`p2-${p2Set}`, p2Set)],
    ['s2', 'e2', 'ally-s2', 'iwa', recoverySet('e2-life', 'life')]
  ];
  const own = seats.find(entry => entry[0] === seat);
  h.setOnlineForLogTest({
    kind: 'firebase', role: own[0] === 'p1' ? 'host' : 'guest', room: roomCode, roomHostUid: hostUid, auth: current.auth, clientId: current.auth.uid, seat, peerSeat: 'e1', phase: 'lobby', currentRoundId: roundId,
    settings: current.room.settings, slots: current.room.slots, queue: [], seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {}, participantGearReveals: {}, verifiedStartGearManifest: null,
    battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    selfCharacter: own[3], selfNonce: '', selfCommit: null, selfRevealed: false, peerCharacter: null, peerNonce: null, revealVerified: false,
    unitCharacters: Object.fromEntries(seats.map(([_seat, unit, _uid, character]) => [unit, character])), visibility: 'private', acceptedSettingsRevision: 1, acceptedSettingsIdentity: '', persistedRosterIdentity: '', transport: { send: async () => true }
  });
  const wiring = h.firebaseGearLobbyForTest();
  const reveals = seats.map(([seatId, _unit, _uid, characterId, gears]) => {
    const trustedContext = wiring.trustedContext(seatId, characterId);
    const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
    for (const item of gears) slots[item.slotId] = item;
    const battleGearSnapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
    return Object.freeze({ trustedContext, revealedCommitment: gearProtocol.createLoadoutCommitment({ battleGearSnapshot, roundId, trustedContext }) });
  });
  const manifest = gearLobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  const state = gearBattleStart.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest, participantReveals: reveals });
  kt.setMatchFormatForTest('2v2'); kt.setCharactersForTest('kyoryu', 'iwa'); kt.setCharacterForUnitForTest('p2', 'kyoryu'); kt.setCharacterForUnitForTest('e2', 'iwa');
  h.resetMatchForTest();
  for (const [_seat, unit, _uid, character] of seats) kt.setCharacterForUnitForTest(unit, character);
  wiring.applyBattleStartState(state);
  const snap = structuredClone(startSnapshot || kt.snapshot());
  const nonces = Object.fromEntries(seats.map(([seatId], index) => [seatId, String.fromCharCode(97 + index).repeat(48)]));
  const digest = crypto.createHash('sha256').update(`${roomCode}:${seats.map(([seatId]) => nonces[seatId]).join(':')}`).digest('hex');
  snap.activeIndex = parseInt(digest.slice(-1), 16) & 1;
  const messages = {};
  for (const entry of reveals) {
    const seatId = entry.revealedCommitment.seatId; const actor = seats.find(row => row[0] === seatId); const nonce = nonces[seatId]; const character = entry.trustedContext.expectedCharacterId;
    const binding = gearLobby.createReadyGearBinding({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext });
    messages[key(Object.keys(messages).length + 1)] = { ...packet('commit', { hash: await h.commitPayload(character, nonce, gearLobby.stableSerializeReadyGearBinding(binding)) }), from: actor[2], seat: seatId };
    messages[key(Object.keys(messages).length + 1)] = { ...packet('reveal', { character, nonce, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearCommitmentJson: gearWire.encodeRevealGearCommitment({ loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext }) }), from: actor[2], seat: seatId };
  }
  messages[key(9)] = packet('start', { snap, gearWireVersion: gearWire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearManifestJson: gearWire.encodeStartGearManifest({ manifest, participantReveals: reveals }) });
  for (const [index, entry] of tail.entries()) messages[key(10 + index)] = entry;
  return bridge.build(current, messages);
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
async function concedeResultPlan(lease) {
  const value = candidate('results', lease);
  const start = await battleStartPlan(lease);
  const messages = Object.fromEntries(start.orderedEntries.map(entry => [entry.key, structuredClone(entry.packet)]));
  messages[key(0)] = packet('presence', { rivalId: 'c'.repeat(64), name: 'Host' });
  messages[key(6)] = packet('result', { actionId: 'f'.repeat(48), unitId: 'p1', winner: 'cpu', reason: '投了', units: start.start.packet.snap.units.map(unit => ({ id: unit.id, hp: unit.hp })) });
  return { value, plan: bridge.build(value, messages) };
}
async function normalResultPlan(lease) {
  const initial = await battleStartPlan(lease);
  const start = structuredClone(initial.start.packet.snap);
  const actorId = start.turnOrder[start.activeIndex];
  const targetId = actorId === 'p1' ? 'e1' : 'p1';
  const actor = start.units.find(unit => unit.id === actorId);
  const target = start.units.find(unit => unit.id === targetId);
  // This is only a deterministic production setup; the terminal itself is
  // produced by the ordinary physics loop below, never edited by the test.
  actor.x = actorId === 'p1' ? 480 : 720; actor.y = 360;
  target.x = actorId === 'p1' ? 620 : 580; target.y = 360; target.hp = 1;
  const from = actorId === 'p1' ? hostUid : guestUid;
  const seat = actorId === 'p1' ? 'p1' : 'e1';
  const fire = { ...packet('fire', { actionId: 'e'.repeat(48), unitId: actorId, x: actor.x, y: actor.y, anchor: { x: actor.x, y: actor.y }, vx0: actorId === 'p1' ? 1000 : -1000, vy0: 0, useSpecial: false, useJump: false }), from, seat };
  const setup = await bridge.build(candidate('playing', lease), Object.fromEntries([
    ...initial.orderedEntries.filter(entry => entry.packet.t !== 'start').map(entry => [entry.key, structuredClone(entry.packet)]),
    [key(5), { ...initial.start.packet, snap: start }]
  ]));
  const frame = callback => setImmediate(() => { kt.step(0.05); callback(); });
  const generated = await bridge.generateTerminal(setup, fire, { frame, timeoutMs: 15000 });
  const final = generated.fullSnap.units.map(unit => ({ id: unit.id, hp: unit.hp }));
  const winner = actorId === 'p1' ? 'player' : 'cpu';
  assert.equal(final.find(unit => unit.id === targetId).hp, 0, 'production fixture must resolve the lethal action');
  const value = candidate('results', lease);
  const messages = Object.fromEntries(setup.orderedEntries.map(entry => [entry.key, structuredClone(entry.packet)]));
  messages[key(6)] = fire;
  messages[key(7)] = { ...packet('result', { actionId: fire.actionId, unitId: actorId, winner, reason: '撃破', units: final }), from, seat };
  messages[key(0)] = packet('presence', { rivalId: 'c'.repeat(64), name: 'Host' });
  return { value, plan: bridge.build(value, messages), frame };
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

  await test('Gear ON 2v2 directly activates every occupied Firebase seat with its canonical Battle unit and control boundary', async () => {
    const source = fakeEventSource();
    const expectedUnits = { p1: 'p1', e1: 'e1', s1: 'p2', s2: 'e2' };
    try {
      for (const seat of Object.keys(expectedUnits)) {
        const sourcesBefore = source.instances.length;
        let released = 0;
        const lease = { release: () => { released += 1; } };
        const value = gear2v2Candidate(seat, lease);
        const plan = await gear2v2StartPlan(seat, lease);
        const expected = structuredClone(plan.start.packet.snap);
        bridge.setPending(value);
        const activated = await bridge.activatePending({ plan });
        const active = bridge.activeOnline();
        const own = expectedUnits[seat];
        assert.equal(activated.kind, 'battle_start_candidate');
        assert.equal(activated.activated, true);
        assert.equal(active.phase, 'playing');
        assert.equal(active.seat, seat);
        assert.equal(kt.unitById(own).control, 'local');
        assert.equal(kt.snapshot().activeIndex, expected.activeIndex);
        assert.equal(kt.snapshot().turnCount, expected.turnCount);
        assert.equal(active.localAction, null);
        assert.equal(active.remoteAction, null);
        assert.equal(active.pendingRemoteTerminals.size, 0);
        assert.equal(active.reentryLease, lease);
        assert.equal(released, 0);
        assert.equal(activated.replay.sideEffects.randomCalls, 0);
        assert.equal(source.instances.length, sourcesBefore + 1);
        bridge.endActive();
        assert.equal(released, 1);
      }
    } finally {
      bridge.setPending(null);
      source.restore();
    }
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

  await test('a fresh SSE push key carrying an already verified remote action remains a completed-action no-op', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const generated = await battleBoundaryPlan(lease);
    const fire = generated.lastCandidateBoundary.fire.packet;
    const value = fire.from === guestUid ? hostCandidate('playing', lease) : candidate('playing', lease);
    const messages = Object.fromEntries(generated.orderedEntries.map(entry => [entry.key, structuredClone(entry.packet)]));
    const plan = bridge.build(value, messages);
    bridge.setPending(value);
    try {
      await bridge.activatePending({ plan, frame: callback => setImmediate(() => { kt.step(0.05); callback(); }), timeoutMs: 15000 });
      const stream = source.instances[0];
      const before = structuredClone(kt.snapshot());
      const beforeProjectiles = kt.projectiles().length;
      source.put(stream, { path: '/', data: { [key(99)]: fire } });
      assert.deepEqual(kt.snapshot(), before, 'fresh key must not replay completed action damage or turn state');
      assert.equal(kt.projectiles().length, beforeProjectiles, 'fresh key must not create a projectile');
      assert.equal(bridge.activeOnline().remoteAction, null);
      assert.equal(bridge.activeOnline().pendingRemoteTerminals.size, 0);
    } finally {
      bridge.endActive();
      source.restore();
    }
  });

  await test('a conceded results candidate activates once from the verified start rather than its arbitrary result board', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const { value, plan } = await concedeResultPlan(lease);
    const records = h.battleRecordFeature();
    records.reset();
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan });
      assert.equal(activated.kind, 'results_candidate');
      assert.equal(activated.activated, true);
      assert.equal(bridge.activeOnline().phase, 'results');
      assert.equal(bridge.activeOnline().resultSent, true);
      assert.equal(kt.state().matchOver, true);
      assert.equal(kt.state().winner, 'cpu');
      assert.equal(source.instances.length, 1);
      assert.deepEqual(records.snapshot().processedRoundIds, [roundId], 'verified results record once through the existing round ledger');
      bridge.endActive();
      bridge.setPending(value);
      await bridge.activatePending({ plan });
      assert.deepEqual(records.snapshot().processedRoundIds, [roundId], 'same-round re-entry cannot record twice');
    } finally {
      bridge.endActive();
      records.reset();
      source.restore();
    }
  });

  await test('a production-generated normal result is replayed and recorded exactly once without recovery result outbound', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const { value, plan, frame } = await normalResultPlan(lease);
    const records = h.battleRecordFeature();
    records.reset();
    bridge.setPending(value);
    try {
      const activated = await bridge.activatePending({ plan, frame, timeoutMs: 15000 });
      assert.equal(activated.kind, 'results_candidate');
      assert.equal(bridge.activeOnline().phase, 'results');
      assert.equal(kt.state().matchOver, true);
      assert.equal(kt.state().winner, plan.result.terminal.packet.winner);
      assert.deepEqual(records.snapshot().processedRoundIds, [roundId]);
      bridge.endActive();
      bridge.setPending(value);
      await bridge.activatePending({ plan, frame, timeoutMs: 15000 });
      assert.deepEqual(records.snapshot().processedRoundIds, [roundId], 'same normal round cannot record twice');
    } finally {
      bridge.endActive();
      records.reset();
      source.restore();
    }
  });

  await test('the existing round ledger records a verified recovery in a new round independently', async () => {
    const source = fakeEventSource();
    const records = h.battleRecordFeature();
    const oldRoundId = roundId;
    records.reset();
    try {
      const first = await normalResultPlan({ release: () => {} });
      bridge.setPending(first.value);
      await bridge.activatePending({ plan: first.plan, frame: first.frame, timeoutMs: 15000 });
      bridge.endActive();
      roundId = 'b'.repeat(48);
      const second = await normalResultPlan({ release: () => {} });
      bridge.setPending(second.value);
      await bridge.activatePending({ plan: second.plan, frame: second.frame, timeoutMs: 15000 });
      assert.deepEqual(records.snapshot().processedRoundIds, [oldRoundId, roundId]);
    } finally {
      bridge.endActive(); bridge.setPending(null); records.reset(); roundId = oldRoundId; source.restore();
    }
  });

  await test('a Gear ON 2v2 verified boundary commits its non-zero Shield runtime rather than the candidate runtime', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const provisional = await gear2v2StartPlan('p1', lease);
    const start = structuredClone(provisional.start.packet.snap);
    const unitId = start.turnOrder[start.activeIndex];
    const actor = unitId === 'p1' ? { from: hostUid, seat: 'p1', x: 240, vx0: -5000 } : { from: guestUid, seat: 'e1', x: 1200, vx0: 5000 };
    const fire = { ...packet('fire', { actionId: 'd'.repeat(48), unitId, x: actor.x, y: 360, anchor: { x: actor.x, y: 360 }, vx0: actor.vx0, vy0: -140, useSpecial: false, useJump: false }), from: actor.from, seat: actor.seat };
    const frame = callback => setImmediate(() => { kt.step(0.05); callback(); });
    const generated = await bridge.generateTerminal(provisional, fire, { frame, timeoutMs: 15000 });
    assert.ok(generated.snap.gearRuntimeState.shieldByUnit.p1.currentShield > 0);
    const terminal = { ...packet('state', { actionId: fire.actionId, unitId, snap: turnStateFrom(generated.snap) }), from: actor.from, seat: actor.seat };
    const plan = await gear2v2StartPlan('p1', lease, [fire, terminal], start);
    bridge.setPending(gear2v2Candidate('p1', lease));
    try {
      const activated = await bridge.activatePending({ plan, frame, timeoutMs: 15000 });
      const verified = activated.replay.lastBoundary.runtime;
      assert.equal(activated.kind, 'candidate_turn_boundary');
      assert.equal(bridge.activeOnline().battleGearShieldStateByUnit.p1.currentShield, verified.shieldStateByUnit.p1.currentShield);
      assert.equal(bridge.activeOnline().localAction, null); assert.equal(bridge.activeOnline().remoteAction, null);
      assert.equal(bridge.activeOnline().pendingRemoteTerminals.size, 0);
      assert.equal(activated.replay.sideEffects.randomCalls, 0);
    } finally { bridge.endActive(); source.restore(); }
  });

  await test('a canonical 2v2 enemy fire creates and commits a non-zero Last Stand pending runtime for p2', async () => {
    const source = fakeEventSource();
    const lease = { release: () => {} };
    const opts = { p2Set: 'last_stand' };
    const provisional = await gear2v2StartPlan('p1', lease, [], null, opts);
    const start = structuredClone(provisional.start.packet.snap);
    const p2 = start.units.find(unit => unit.id === 'p2');
    p2.x = 650; p2.y = 360;
    const order = start.turnOrder.slice();
    const actors = { p1: [hostUid, 'p1', 240, -5000], e1: [guestUid, 'e1', 1200, 5000], p2: ['ally-s1', 's1', 240, -5000], e2: ['ally-s2', 's2', 1200, 5000] };
    const makeFire = (unitId, hit, actionId) => {
      const [from, seat, outwardX, outwardVx] = actors[unitId];
      const x = hit ? 790 : outwardX; const vx0 = hit ? -1000 : outwardVx;
      return { ...packet('fire', { actionId, unitId, x, y: 360, anchor: { x, y: 360 }, vx0, vy0: hit ? 0 : -140, useSpecial: false, useJump: false }), from, seat };
    };
    const fires = [];
    for (let offset = 0; offset < order.length; offset++) {
      const unitId = order[(start.activeIndex + offset) % order.length];
      fires.push(makeFire(unitId, unitId === 'e1', String.fromCharCode(97 + offset).repeat(48)));
      if (unitId === 'e1') break;
    }
    const frame = callback => setImmediate(() => { kt.step(0.05); callback(); });
    const seed = await gear2v2StartPlan('p1', lease, [], start, opts);
    const generated = await bridge.generateTerminals(seed, fires, { frame, timeoutMs: 15000 });
    const last = generated.terminals.at(-1);
    assert.ok(last.snap.gearRuntimeState.runtimeEffectsByUnit.p2.lastStandNextAttackDamageBp > 0, 'actual enemy fire must grant p2 Last Stand');
    const tail = fires.flatMap((fire, index) => [fire, { ...packet('state', { actionId: fire.actionId, unitId: fire.unitId, snap: turnStateFrom(generated.terminals[index].snap) }), from: fire.from, seat: fire.seat }]);
    const plan = await gear2v2StartPlan('p1', lease, tail, start, opts);
    bridge.setPending(gear2v2Candidate('p1', lease));
    try {
      const activated = await bridge.activatePending({ plan, frame, timeoutMs: 15000 });
      const verified = activated.replay.lastBoundary.runtime.runtimeEffectsStateByUnit.p2.lastStandNextAttackDamageBp;
      assert.ok(verified > 0);
      assert.equal(bridge.activeOnline().battleGearRuntimeEffectsStateByUnit.p2.lastStandNextAttackDamageBp, verified);
      assert.equal(bridge.activeOnline().battleGearActiveAttackRuntime, null);
      assert.equal(activated.replay.sideEffects.randomCalls, 0);
    } finally { bridge.endActive(); source.restore(); }
  });

  console.log(`Firebase Battle Re-entry Activation Phase 3D-8B3B2 tests: ${passed}/18 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
