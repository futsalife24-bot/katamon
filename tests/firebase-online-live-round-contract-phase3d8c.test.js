const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const live = h.firebaseLiveRoundContractForTest();
const roomCode = 'A2BC3DEF';
const hostUid = 'uid-p1';
const guestUid = 'uid-e1';
const roundA = 'a'.repeat(48);
const roundB = 'b'.repeat(48);
let passed = 0;

const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
};

function turnStateFrom(snapshot) {
  const state = structuredClone(snapshot);
  for (const field of ['segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey', 'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments', 'customStage', 'customStageIdentity', 'terrainDelta']) delete state[field];
  return state;
}

function slots(occupied = ['p1', 'e1']) {
  const uid = { p1: hostUid, e1: guestUid, s1: 'uid-s1', s2: 'uid-s2' };
  return Object.fromEntries(['p1', 'e1', 's1', 's2'].map(seat => [seat,
    occupied.includes(seat) ? { uid: uid[seat], claimedAt: 1800000000000 } : null]));
}

function liveOnline({ format = '1v1', occupied = ['p1', 'e1'], send = async () => true } = {}) {
  return {
    kind: 'firebase', role: 'guest', participantRole: 'player', phase: 'playing', room: roomCode,
    roomHostUid: hostUid, auth: { uid: guestUid, idToken: 'test', serverTimeOffset: 0 }, clientId: guestUid,
    seat: 'e1', peerSeat: 'p1', currentRoundId: roundA, visibility: 'private',
    settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1 },
    slots: slots(occupied), queue: [], transport: { send, setRoundId() {}, reconnect() {}, close() {} },
    seatReady: {}, seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {},
    selfCharacter: 'iwa', peerCharacter: 'kyoryu', unitCharacters: { p1: 'kyoryu', e1: 'iwa', p2: 'kyoryu', e2: 'iwa' },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null,
    battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null,
    localAction: null, remoteAction: null, pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    rematchVotes: {}, startAcks: {}, resultSent: false, matchStarted: true, roundResetting: false,
    matchSeatSilentMs: {}, matchSeatTakeoverFails: {}, peerLiveness: { peerVisibleMs: 0, pingVisibleMs: 0, checkedAt: 0 },
    log: [], names: {}, roundOpponentSeats: null, roundRivals: null
  };
}

function packet(t, extra = {}) {
  return { v: 3, t, from: hostUid, seat: 'p1', roundId: roundA, sentAt: 1800000000000, ...extra };
}

function setupRemoteTurn(options = {}) {
  kt.setMatchFormatForTest(options.format || '1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  if (options.format === '2v2') {
    kt.setCharacterForUnitForTest('p2', 'kyoryu');
    kt.setCharacterForUnitForTest('e2', 'iwa');
  }
  h.resetMatchForTest();
  kt.setGamePhaseForTest('battle');
  h.setActiveUnitForTest('p1');
  const online = liveOnline(options);
  h.setOnlineForLogTest(online);
  h.setOnlineSeat('e1');
  const actor = kt.unitById('p1');
  actor.x = 230;
  actor.y = 360;
  actor.grounded = true;
  const start = structuredClone(kt.snapshot());
  const actionId = 'c'.repeat(48);
  const anchor = live.unitAnchor('p1');
  const move = packet('move', { actionId: 'm'.repeat(48), unitId: 'p1', x: actor.x, fuel: actor.fuel });
  const fire = packet('fire', {
    actionId, unitId: 'p1', x: actor.x, y: actor.y, anchor,
    vx0: -5000, vy0: -140, useSpecial: false, useJump: false
  });
  return { online, start, move, fire, actionId };
}

function settleRemoteFire(limit = 1600) {
  for (let i = 0; i < limit; i += 1) {
    kt.step(0.05);
    if (!kt.state().awaitingResolve && live.state().remoteAction?.resolved) return i + 1;
  }
  throw new Error('remote production fire did not settle');
}

function completeCanonicalAction(fixture) {
  h.receiveFirebaseForTest(fixture.move);
  assert.equal(kt.unitById('p1').netWalkTargetX, fixture.move.x);
  h.receiveFirebaseForTest(fixture.fire);
  assert.equal(fixture.online.queue.length, 1);
  h.drainOneNetworkMessageForTest();
  assert.equal(kt.projectiles().length, 1);
  settleRemoteFire();
  const terminal = packet('state', {
    actionId: fixture.actionId, unitId: 'p1', snap: turnStateFrom(kt.snapshot()), sentAt: 1800000000001
  });
  h.receiveFirebaseForTest(terminal);
  h.drainOneNetworkMessageForTest();
  assert.equal(fixture.online.protocolError, undefined);
  assert.equal(live.state().remoteAction, null);
  assert.deepEqual(live.state().pendingRemoteTerminals, []);
  assert.deepEqual(live.state().completedRemoteActions, [[fixture.actionId, { from: hostUid, unitId: 'p1', t: 'state' }]]);
  return terminal;
}

function fakeEventSource() {
  const original = global.EventSource;
  const instances = [];
  global.EventSource = class {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; instances.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    close() { this.closed = true; }
  };
  return {
    instances,
    put(instance, key, msg) { instance.listeners.get('put')({ data: JSON.stringify({ path: `/${key}`, data: msg }) }); },
    restore() { global.EventSource = original; }
  };
}

function installTransport(online) {
  const transport = live.createTransport(roomCode, online.auth, roundA, () => {}, () => {}, () => {});
  assert.ok(transport);
  transport.onMessage(msg => h.receiveFirebaseForTest(msg));
  online.transport = transport;
  return transport;
}

async function flushAsync() {
  for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve));
}

async function main() {
await test('ordinary live receiver completes move -> fire -> state exactly once', () => {
  const fixture = setupRemoteTurn();
  const beforeTurn = kt.state().turnCount;
  completeCanonicalAction(fixture);
  assert.equal(kt.state().turnCount, beforeTurn + 1);
  assert.equal(kt.projectiles().length, 0);
});

await test('terminal-before-fire is buffered and applied only after the production action settles', () => {
  const source = setupRemoteTurn();
  const terminal = completeCanonicalAction(source);
  const terminalSnap = structuredClone(terminal.snap);
  const fixture = setupRemoteTurn();
  kt.applySnapshotForTest(source.start);
  h.setOnlineSeat('e1');
  fixture.start = structuredClone(source.start);
  const early = { ...terminal, snap: terminalSnap };
  const beforeEarly = structuredClone(kt.snapshot());
  h.receiveFirebaseForTest(early);
  assert.equal(live.state().pendingRemoteTerminals.length, 1);
  assert.deepEqual(kt.snapshot(), beforeEarly, 'an early terminal must not pre-apply its board');
  h.receiveFirebaseForTest(fixture.fire);
  h.drainOneNetworkMessageForTest();
  assert.equal(kt.projectiles().length, 1);
  settleRemoteFire();
  h.drainOneNetworkMessageForTest();
  assert.equal(fixture.online.protocolError, undefined);
  assert.deepEqual(live.state().pendingRemoteTerminals, []);
  assert.equal(live.state().remoteAction, null);
});

await test('same SSE push key is a room-lifetime no-op on second delivery', () => {
  const source = fakeEventSource();
  try {
    const fixture = setupRemoteTurn();
    installTransport(fixture.online);
    const es = source.instances[0];
    source.put(es, '-same-key', fixture.fire);
    source.put(es, '-same-key', fixture.fire);
    assert.equal(fixture.online.queue.length, 1);
    h.drainOneNetworkMessageForTest();
    assert.equal(kt.projectiles().length, 1);
  } finally { source.restore(); }
});

await test('fresh push key carrying the same completed action remains a no-op', () => {
  const source = fakeEventSource();
  try {
    const fixture = setupRemoteTurn();
    const terminal = completeCanonicalAction(fixture);
    installTransport(fixture.online);
    const before = structuredClone(kt.snapshot());
    const es = source.instances[0];
    source.put(es, '-fresh-fire-key', fixture.fire);
    assert.equal(fixture.online.queue.length, 1);
    h.drainOneNetworkMessageForTest();
    assert.equal(fixture.online.protocolError, undefined);
    assert.equal(kt.projectiles().length, 0);
    assert.deepEqual(kt.snapshot(), before);
    source.put(es, '-fresh-state-key', terminal);
    assert.equal(fixture.online.queue.length, 0);
    assert.deepEqual(live.state().completedRemoteActions, [[fixture.actionId, { from: hostUid, unitId: 'p1', t: 'state' }]]);
  } finally { source.restore(); }
});

await test('a completed actionId reused by another valid seat fails closed', () => {
  const fixture = setupRemoteTurn({ format: '2v2', occupied: ['p1', 'e1', 's1', 's2'] });
  completeCanonicalAction(fixture);
  const forged = { ...fixture.fire, from: 'uid-s1', seat: 's1', unitId: 'p2' };
  h.receiveFirebaseForTest(forged);
  h.drainOneNetworkMessageForTest();
  assert.match(fixture.online.protocolError || '', /通信順序|手番/);
  assert.deepEqual(live.state().completedRemoteActions, [[fixture.actionId, { from: hostUid, unitId: 'p1', t: 'state' }]]);
});

await test('a completed actionId reused by the same sender for another unit fails closed', () => {
  const fixture = setupRemoteTurn({ format: '2v2', occupied: ['p1', 'e1'] });
  completeCanonicalAction(fixture);
  const before = structuredClone(kt.snapshot());
  const beforeTurn = kt.state().turnCount;
  const forged = { ...fixture.fire, unitId: 'p2' };
  h.receiveFirebaseForTest(forged);
  h.drainOneNetworkMessageForTest();
  assert.match(fixture.online.protocolError || '', /通信順序|手番/);
  assert.equal(kt.projectiles().length, 0);
  assert.equal(kt.state().turnCount, beforeTurn);
  assert.deepEqual(kt.snapshot(), before);
  assert.deepEqual(live.state().completedRemoteActions, [[fixture.actionId, { from: hostUid, unitId: 'p1', t: 'state' }]]);
});

await test('1v1 rematch advances only after every seated human votes and switches transport once', async () => {
  const requests = [];
  const sent = [];
  const switched = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => { requests.push({ url: String(url), method: options.method, body: options.body }); return { ok: true, status: 200, json: async () => ({}) }; };
  try {
    const online = liveOnline({ send: async msg => { sent.push(structuredClone(msg)); return true; } });
    online.role = 'host'; online.seat = 'p1'; online.clientId = hostUid; online.auth.uid = hostUid; online.phase = 'results';
    online.transport.setRoundId = id => switched.push(['set', id]);
    online.transport.reconnect = () => switched.push(['reconnect']);
    online.rematchVotes = { p1: true };
    h.setOnlineForLogTest(online);
    assert.equal(h.allFirebaseRematchVotesIn(), false);
    h.receiveFirebaseForTest({ ...packet('rematchVote', { vote: true }), from: guestUid, seat: 'e1' });
    await flushAsync();
    assert.equal(sent.filter(msg => msg.t === 'lobbyState').length, 1);
    assert.equal(switched.filter(item => item[0] === 'set').length, 1);
    assert.equal(switched.filter(item => item[0] === 'reconnect').length, 1);
    assert.notEqual(online.currentRoundId, roundA);
    assert.equal(online.phase, 'lobby');
    assert.ok(requests.some(entry => /\/rounds\//.test(entry.url)));
    assert.ok(requests.some(entry => /\/round\.json/.test(entry.url)));
  } finally { global.fetch = originalFetch; }
});

await test('failed old-round handoff leaves local round and round-local state untouched', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try {
    const switched = [];
    const online = liveOnline({ send: async () => false });
    online.role = 'host'; online.seat = 'p1'; online.clientId = hostUid; online.auth.uid = hostUid; online.phase = 'results';
    online.resultSent = true; online.completedRemoteActions.set('old-action', { from: guestUid, t: 'state' });
    online.transport.setRoundId = id => switched.push(id);
    h.setOnlineForLogTest(online);
    await live.resetRound(false);
    assert.equal(online.currentRoundId, roundA);
    assert.equal(online.phase, 'results');
    assert.equal(online.resultSent, true);
    assert.equal(online.completedRemoteActions.has('old-action'), true);
    assert.deepEqual(switched, []);
  } finally { global.fetch = originalFetch; }
});

await test('new-round reset clears Battle-round state but preserves room authority', () => {
  const online = liveOnline({ format: '2v2', occupied: ['p1', 'e1', 's1'] });
  online.role = 'host'; online.seat = 'p1'; online.clientId = hostUid; online.auth.uid = hostUid;
  online.phase = 'results'; online.selfReady = true; online.selfCommit = 'commit'; online.selfRevealed = true;
  online.seatReady = { p1: true, e1: true, s1: true }; online.seatCommit = { e1: 'x' };
  online.participantGearReveals = { p1: { value: 1 } }; online.verifiedStartGearManifest = { roundId: roundA };
  online.battleGearSnapshotsByUnit = { p1: { value: 1 } }; online.battleGearShieldStateByUnit = { p1: { currentShield: 10 } };
  online.battleGearRuntimeEffectsStateByUnit = { p1: { lastStandNextAttackDamageBp: 1000 } };
  online.battleGearActiveAttackRuntime = { ownerId: 'p1' }; online.resultSent = true;
  online.localAction = { actionId: 'local' }; online.remoteAction = { actionId: 'remote' };
  online.pendingRemoteTerminals.set('pending', { msg: {} }); online.completedRemoteActions.set('done', { from: hostUid, t: 'state' });
  const roomAuthority = { room: online.room, uid: online.auth.uid, seat: online.seat, settings: structuredClone(online.settings), slots: structuredClone(online.slots) };
  h.setOnlineForLogTest(online);
  h.battleRecordFeature().setResultState('player', '撃破', true);
  live.resetLocalRound(false);
  const state = live.state();
  assert.equal(state.phase, 'lobby');
  assert.equal(state.resultSent, false);
  assert.equal(state.localAction, null); assert.equal(state.remoteAction, null);
  assert.deepEqual(state.pendingRemoteTerminals, []); assert.deepEqual(state.completedRemoteActions, []);
  assert.equal(state.verifiedStartGearManifest, null); assert.equal(state.battleGearSnapshotsByUnit, null);
  assert.equal(state.battleGearShieldStateByUnit, null); assert.equal(state.battleGearRuntimeEffectsStateByUnit, null);
  assert.equal(state.battleGearActiveAttackRuntime, null);
  assert.equal(kt.state().matchOver, false);
  assert.equal(kt.state().winner, null);
  assert.deepEqual({ room: online.room, uid: online.auth.uid, seat: online.seat, settings: online.settings, slots: online.slots }, roomAuthority);
});

await test('2v2 live rematch waits for four humans but advances without empty CPU support votes', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const uidBySeat = { e1: guestUid, s1: 'uid-s1', s2: 'uid-s2' };
  try {
    const fourSwitches = [];
    const four = liveOnline({ format: '2v2', occupied: ['p1', 'e1', 's1', 's2'], send: async () => true });
    four.role = 'host'; four.seat = 'p1'; four.clientId = hostUid; four.auth.uid = hostUid; four.phase = 'results';
    four.rematchVotes = { p1: true };
    four.transport.setRoundId = id => fourSwitches.push(id);
    four.transport.reconnect = () => {};
    h.setOnlineForLogTest(four);
    for (const seat of ['e1', 's1']) {
      h.receiveFirebaseForTest({ ...packet('rematchVote', { vote: true }), from: uidBySeat[seat], seat });
    }
    await flushAsync();
    assert.deepEqual(fourSwitches, [], 'three humans cannot advance a four-human rematch');
    h.receiveFirebaseForTest({ ...packet('rematchVote', { vote: true }), from: uidBySeat.s2, seat: 's2' });
    await flushAsync();
    assert.equal(fourSwitches.length, 1);
    assert.equal(four.phase, 'lobby');
    assert.deepEqual(['p1', 'e1', 's1', 's2'].map(seat => [seat, h.firebaseSeatUnitId(seat)]),
      [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);

    const cpuSwitches = [];
    const cpu = liveOnline({ format: '2v2', occupied: ['p1', 'e1'], send: async () => true });
    cpu.role = 'host'; cpu.seat = 'p1'; cpu.clientId = hostUid; cpu.auth.uid = hostUid; cpu.phase = 'results';
    cpu.rematchVotes = { p1: true };
    cpu.transport.setRoundId = id => cpuSwitches.push(id);
    cpu.transport.reconnect = () => {};
    h.setOnlineForLogTest(cpu);
    h.receiveFirebaseForTest({ ...packet('rematchVote', { vote: true }), from: guestUid, seat: 'e1' });
    await flushAsync();
    assert.equal(cpuSwitches.length, 1, 'empty s1/s2 CPU seats must not be required to vote');
    assert.equal(cpu.phase, 'lobby');
    assert.deepEqual(h.firebaseCpuSeats(), ['s1', 's2']);
  } finally { global.fetch = originalFetch; }
});

await test('SSE deduper survives round switching while Battle completed-action cache resets', () => {
  const source = fakeEventSource();
  try {
    const online = liveOnline();
    const transport = installTransport(online);
    let received = 0;
    transport.onMessage(() => { received += 1; });
    source.put(source.instances[0], '-room-key', packet('ready', { value: true }));
    assert.equal(received, 1);
    transport.setRoundId(roundB);
    transport.reconnect();
    source.put(source.instances[1], '-room-key', { ...packet('ready', { value: true }), roundId: roundB });
    assert.equal(received, 1, 'the room-lifetime push-key deduper must survive reconnect');
    online.completedRemoteActions.set('same-action', { from: hostUid, t: 'state' });
    live.resetLocalRound(false);
    assert.deepEqual(live.state().completedRemoteActions, []);
  } finally { source.restore(); }
});

await test('result ledger keeps the old round idempotent and accepts the new round as another match', () => {
  const records = h.battleRecordFeature();
  records.reset();
  const detail = matchId => ({
    matchId, outcome: 'win', character: 'kyoryu',
    rivals: [{ id: 'e'.repeat(64), name: 'ライバル' }], reason: '撃破', playedAt: 1800000000000
  });
  try {
    assert.equal(records.record(detail(roundA)), true);
    assert.equal(records.record(detail(roundA)), false);
    const online = liveOnline();
    h.setOnlineForLogTest(online);
    live.resetLocalRound(false);
    assert.equal(records.record(detail(roundA)), false, 'round reset must not erase the old match ledger');
    assert.equal(records.record(detail(roundB)), true, 'a new round id is a new match identity');
    assert.deepEqual(records.snapshot().processedRoundIds, [roundA, roundB]);
  } finally { records.reset(); }
});

console.log(`firebase live ordering / rematch Phase 3D-8C: ${passed}/${passed} passed`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
