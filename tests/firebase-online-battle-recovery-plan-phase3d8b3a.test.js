const assert = require('node:assert/strict');
const recovery = require('../shared/firebase-online-battle-recovery.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const bridge = h.firebaseBattleRecoveryForTest();
const roundId = 'a'.repeat(48);
const hostUid = 'host-p1';
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);
const failsAsync = (code, fn) => assert.rejects(fn, error => error?.code === code);
const key = number => `-${String(number).padStart(19, '0')}`;
const packet = (t, extra = {}) => ({ v: 3, from: hostUid, seat: 'p1', roundId, sentAt: 1800000000000, t, ...extra });
const fire = (extra = {}) => packet('fire', { actionId: 'f'.repeat(48), unitId: 'p1', ...extra });
const state = (extra = {}) => packet('state', { actionId: 'f'.repeat(48), unitId: 'p1', snap: { craters: [] }, ...extra });
const result = (extra = {}) => packet('result', { actionId: 'f'.repeat(48), unitId: 'p1', winner: 'player', reason: 'done', units: [], ...extra });
function plan(roundStatus, messages, extra = {}) {
  return recovery.buildRecoveryPlan({
    roundId,
    roundStatus,
    messages,
    hostUid,
    isPushKey: value => /^[-0-9A-Z_a-z]{20}$/.test(value),
    validatePacket: value => value && value.v === 3 && typeof value.t === 'string' ? { ok: true } : { ok: false },
    actionMatches: (message, action) => message.actionId === action.actionId && message.from === action.from && (!message.unitId || !action.unitId || message.unitId === action.unitId),
    isConcededResult: value => value.t === 'result' && value.concede === true,
    ...extra
  });
}

(async () => {
await test('lobby and revealing logs are pure plans without a Battle start', () => {
  for (const status of ['lobby', 'revealing']) {
    const actual = plan(status, { [key(2)]: packet('ready') });
    assert.equal(actual.kind, status); assert.equal(actual.start, null); assert.deepEqual(actual.historicalMessageKeys, [key(2)]);
  }
});

await test('Firebase push IDs use binary canonical order across 9/A/Z/_/a/z, never locale collation', () => {
  const suffixes = ['z', 'a', '_', 'Z', 'A', '9'];
  const messages = Object.fromEntries(suffixes.map(suffix => [`-${'0'.repeat(18)}${suffix}`, packet('ready')]));
  // Put the canonical start at the 9 boundary so input insertion order cannot become authority.
  messages[`-${'0'.repeat(18)}9`] = packet('start');
  messages[`-${'0'.repeat(18)}z`] = packet('ready');
  const actual = plan('playing', messages);
  assert.deepEqual(actual.historicalMessageKeys.map(value => value.at(-1)), ['9', 'A', 'Z', '_', 'a', 'z']);
});

await test('start authority and battle-start candidate semantics are enforced', () => {
  const actual = plan('playing', {
    [key(9)]: packet('ready'),
    [key(3)]: packet('start', { snap: { terrain: 'full' } })
  });
  assert.equal(actual.kind, 'battle_start_candidate'); assert.equal(actual.requiresBattleReplayValidation, true);
  assert.deepEqual(actual.historicalMessageKeys, [key(3), key(9)]);
  assert.equal(actual.orderedEntriesThroughStart.length, 1);
  const waiting = plan('playing', { [key(1)]: packet('ready'), [key(2)]: packet('reveal') });
  assert.equal(waiting.kind, 'wait_for_start'); assert.equal(waiting.requiresBattleReplayValidation, false);
  fails('FIREBASE_RECOVERY_START_CONFLICT', () => plan('playing', { [key(1)]: packet('start'), [key(2)]: packet('start') }));
  fails('FIREBASE_RECOVERY_START_AUTHORITY_INVALID', () => plan('playing', { [key(1)]: packet('start', { seat: 'e1' }) }));
  fails('FIREBASE_RECOVERY_ROUND_MISMATCH', () => plan('playing', { [key(1)]: packet('start', { roundId: 'b'.repeat(48) }) }));
});

await test('matching fire/state makes only a replay-required candidate chain; persisted early terminals reject', () => {
  const normal = plan('playing', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: state() });
  assert.equal(normal.kind, 'candidate_turn_boundary'); assert.equal(normal.requiresBattleReplayValidation, true); assert.equal(normal.lastCandidateBoundary.fire.key, key(2)); assert.equal(normal.lastCandidateBoundary.terminal.key, key(3));
  fails('FIREBASE_RECOVERY_TERMINAL_BEFORE_ACTION', () => plan('playing', { [key(1)]: packet('start'), [key(2)]: state(), [key(3)]: fire() }));
  fails('FIREBASE_RECOVERY_TERMINAL_MISMATCH', () => plan('playing', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: state({ actionId: 'e'.repeat(48) }) }));
});

await test('completed action chains remain ordered and an active tail is only a wait candidate', () => {
  const secondFire = fire({ actionId: 'c'.repeat(48) }); const secondState = state({ actionId: 'c'.repeat(48) });
  const actual = plan('playing', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: state(), [key(4)]: secondFire, [key(5)]: secondState, [key(6)]: fire({ actionId: 'b'.repeat(48) }) });
  assert.equal(actual.kind, 'wait_for_turn_boundary'); assert.equal(actual.pendingAction.actionId, 'b'.repeat(48)); assert.equal(actual.lastCandidateBoundary.terminal.key, key(5)); assert.equal(actual.completedActionChain.length, 2);
  assert.equal(Object.hasOwn(actual, 'activeAttackRuntime'), false);
});

await test('normal and concede result double-send keep the first result while conflicting duplicates reject', () => {
  const ordinary = plan('results', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: result({ reason: 'first' }), [key(4)]: result({ reason: 'second' }) });
  assert.equal(ordinary.kind, 'results_candidate'); assert.equal(ordinary.result.conceded, false); assert.equal(ordinary.result.terminal.packet.reason, 'first');
  const conceded = plan('results', { [key(1)]: packet('start'), [key(2)]: result({ concede: true, reason: 'first' }), [key(3)]: result({ concede: true, reason: 'second' }) });
  assert.equal(conceded.result.conceded, true);
  fails('FIREBASE_RECOVERY_RESULT_CONFLICT', () => plan('results', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: result(), [key(4)]: result({ actionId: 'e'.repeat(48) }) }));
  fails('FIREBASE_RECOVERY_RESULT_CONFLICT', () => plan('results', { [key(1)]: packet('start'), [key(2)]: fire(), [key(3)]: result(), [key(4)]: result({ from: 'other' }) }));
  fails('FIREBASE_RECOVERY_RESULT_MISSING', () => plan('results', { [key(1)]: packet('start') }));
  fails('FIREBASE_RECOVERY_RESULT_MISSING', () => plan('results', { [key(1)]: packet('start'), [key(2)]: fire() }));
});

await test('Gear/runtime payloads are retained as opaque packets and an SSE deduper can pre-seed history', () => {
  const runtime = { version: 3, matchFormat: '1v1', shieldByUnit: { p1: { currentShield: 0 }, e1: { currentShield: 0 } }, runtimeEffectsByUnit: { p1: { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 1500 }, e1: { rescueNextAttackDamageBp: 1000, lastStandNextAttackDamageBp: 0 } } };
  const actual = plan('playing', { [key(1)]: packet('start', { gearManifestJson: '{}' }), [key(2)]: fire(), [key(3)]: state({ snap: { craters: [], gearRuntimeState: runtime } }) });
  assert.equal(actual.lastCandidateBoundary.terminal.packet.snap.gearRuntimeState.version, 3);
  const accept = bridge.deduper(); assert.equal(accept.seed(actual.historicalMessageKeys), true); assert.equal(accept(key(1)), false); assert.equal(accept(key(99)), true);
});

await test('2v2 Gear evidence remains ordered through start and p2/e2 action identities stay unit-generic', () => {
  const p2Fire = { ...fire(), from: 'ally-s1', seat: 's1', unitId: 'p2', actionId: 'd'.repeat(48) };
  const e2State = { ...state(), from: 'ally-s1', seat: 's1', unitId: 'p2', actionId: 'd'.repeat(48), snap: { craters: [], gearRuntimeState: { version: 3 } } };
  const actual = plan('playing', {
    [key(1)]: packet('commit', { from: 'ally-s1', seat: 's1' }),
    [key(2)]: packet('reveal', { from: 'ally-s1', seat: 's1' }),
    [key(3)]: packet('start', { gearManifestJson: '{}', snap: { terrain: 'full', matchFormat: '2v2' } }),
    [key(4)]: p2Fire,
    [key(5)]: e2State
  });
  assert.equal(actual.kind, 'candidate_turn_boundary'); assert.equal(actual.orderedEntriesThroughStart.length, 3); assert.equal(actual.lastCandidateBoundary.fire.packet.unitId, 'p2');
});

await test('production validator boundary accepts a real Gear-OFF start snapshot without mutating Battle state', () => {
  kt.startBattle('kyoryu');
  const before = kt.snapshot();
  const candidate = { auth: { idToken: 'test' }, room: { hostUid, settings: { gearCapability: false } }, roomCode: 'A2BC3DEF', seat: 'e1', roundId, roundStatus: 'playing' };
  const actual = bridge.build(candidate, { [key(1)]: packet('start', { snap: before }) });
  assert.equal(actual.kind, 'battle_start_candidate');
  assert.deepEqual(kt.snapshot(), before, 'B3A must not apply the recovery snapshot');
});

await test('invalid packet, invalid push key, orphan terminal, and old-round logs fail closed', () => {
  fails('FIREBASE_RECOVERY_PACKET_INVALID', () => plan('playing', { [key(1)]: { v: 2, t: 'start', roundId } }));
  fails('FIREBASE_RECOVERY_LOG_INVALID', () => plan('playing', { invalid: packet('start') }));
  fails('FIREBASE_RECOVERY_TERMINAL_BEFORE_ACTION', () => plan('playing', { [key(1)]: packet('start'), [key(2)]: state() }));
  fails('FIREBASE_RECOVERY_COMBAT_BEFORE_START', () => plan('playing', { [key(1)]: fire(), [key(2)]: packet('start') }));
  fails('FIREBASE_RECOVERY_ROUND_MISMATCH', () => plan('playing', { [key(1)]: packet('start'), [key(2)]: fire({ roundId: 'c'.repeat(48) }) }));
});

await test('a B2 pending candidate reads the current log through REST only and leaves Battle, transport, outbound messages, and its lease untouched', async () => {
  const reentryBridge = h.firebaseReentryForTest();
  const storageValues = new Map();
  const storage = { getItem: name => storageValues.has(name) ? storageValues.get(name) : null, setItem: (name, value) => storageValues.set(name, String(value)), removeItem: name => storageValues.delete(name) };
  const uid = 'guest-e1'; const code = 'A2BC3DEF'; const now = Date.now();
  const room = {
    protocol: 3, hostUid, createdAt: 1800000000000, expiresAt: now + 600000, visibility: 'private',
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
    slots: { p1: { uid: hostUid }, e1: { uid }, s1: null, s2: null }, round: { id: roundId, status: 'playing', players: { p1: hostUid, e1: uid } }
  };
  const credential = reentryBridge.api().createCredential({ uid, refreshToken: 'old-refresh', roomCode: code, seat: 'e1', roomCreatedAt: room.createdAt, hostUid, lastConfirmedExpiresAt: room.expiresAt, savedAt: now });
  reentryBridge.reset(); reentryBridge.saveCredential(credential, storage);
  const tokenPayload = Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 })).toString('base64url');
  const before = kt.snapshot(); const messages = { [key(1)]: packet('start', { snap: before }) };
  const originalFetch = global.fetch; const calls = []; let roundPointers = [room.round, room.round];
  global.fetch = async (url, options = {}) => {
    const text = String(url); calls.push({ url: text, method: options.method || 'GET' });
    if (text.includes('securetoken.googleapis.com')) return { ok: true, status: 200, json: async () => ({ user_id: uid, id_token: `x.${tokenPayload}.y`, refresh_token: 'rotated-refresh', expires_in: '3600' }) };
    if (text.includes(`/rooms/${code}/slots/e1/seenAt.json`)) return { ok: true, status: 200, json: async () => null };
    if (text.includes(`/rooms/${code}/round.json`)) return { ok: true, status: 200, json: async () => roundPointers.shift() || room.round };
    if (text.includes(`/rooms/${code}/rounds/${roundId}/messages.json`)) return { ok: true, status: 200, json: async () => messages };
    if (text.includes(`/rooms/${code}.json`)) return { ok: true, status: 200, json: async () => room };
    throw new Error(`unexpected request ${text}`);
  };
  const lockManager = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
  try {
    const candidate = await reentryBridge.restore({ storage, lockManager });
    const planFromRead = await bridge.readPending();
    assert.equal(planFromRead.kind, 'battle_start_candidate'); assert.deepEqual(kt.snapshot(), before);
    assert.equal(calls.filter(call => call.method !== 'GET' && !call.url.includes('securetoken')).length, 1, 'only existing guest seenAt heartbeat may write');
    assert.equal(calls.some(call => call.url.includes('/messages/') && call.method !== 'GET'), false);
    roundPointers = [{ ...room.round, id: 'b'.repeat(48) }];
    await failsAsync('FIREBASE_RECOVERY_ROUND_ADVANCED', () => bridge.readPending());
    roundPointers = [room.round, { ...room.round, status: 'results' }];
    await failsAsync('FIREBASE_RECOVERY_ROUND_ADVANCED', () => bridge.readPending());
    assert.equal(candidate.reentryLease.release(), true, 'the plan itself did not release B2 lease');
  } finally { global.fetch = originalFetch; reentryBridge.reset(); }
});
console.log(`Firebase Battle Recovery Plan Phase 3D-8B3A tests: ${passed}/11 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
