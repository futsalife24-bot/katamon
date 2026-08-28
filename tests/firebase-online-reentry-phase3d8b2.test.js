const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reentry = require('../shared/firebase-online-reentry.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const bridge = h.firebaseReentryForTest();
const roomCode = 'A2BC3DEF';
const uid = 'firebase-user-e1';
const hostUid = 'firebase-host-p1';
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = async (code, fn) => await assert.rejects(fn, error => error?.code === code);

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    value: key => values.get(key) || null
  };
}
function token(userId, issuedAtMs = Date.now()) {
  const now = Math.floor(issuedAtMs / 1000);
  const encoded = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url');
  return `x.${encoded}.y`;
}
function room(status = 'playing', overrides = {}) {
  const now = Date.now();
  return {
    protocol: 3,
    hostUid,
    createdAt: 1800000000000,
    expiresAt: now + 10 * 60 * 1000,
    visibility: 'private',
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
    slots: { p1: { uid: hostUid, claimedAt: now - 1 }, e1: { uid, claimedAt: now - 1 }, s1: null, s2: null },
    round: { id: '0'.repeat(48), status, players: { p1: hostUid, e1: uid } },
    ...overrides
  };
}
function credential(currentRoom = room()) {
  return reentry.createCredential({ uid, refreshToken: 'refresh-secret-not-logged', roomCode, seat: 'e1', roomCreatedAt: currentRoom.createdAt, hostUid, lastConfirmedExpiresAt: currentRoom.expiresAt, savedAt: Date.now() });
}
function locks() {
  const held = new Set();
  return {
    request(name, options, callback) {
      if (options.ifAvailable && held.has(name)) return Promise.resolve().then(() => callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    }
  };
}
function mockFirebase(currentRoom, { refreshUserId = uid, refreshStatus = 200, refreshError = 'INVALID_REFRESH_TOKEN', roomStatus = 200, tokenIssuedAtMs = Date.now() } = {}) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    if (String(url).includes('securetoken.googleapis.com')) {
      if (refreshStatus !== 200) return { ok: false, status: refreshStatus, json: async () => ({ error: { message: refreshError } }) };
      return { ok: true, status: 200, json: async () => ({ user_id: refreshUserId, id_token: token(refreshUserId, tokenIssuedAtMs), refresh_token: 'rotated-refresh-token', expires_in: '3600' }) };
    }
    if (String(url).includes(`/rooms/${roomCode}/slots/e1/seenAt.json`)) return { ok: true, status: 200, json: async () => null };
    if (String(url).includes(`/rooms/${roomCode}.json`)) {
      if (roomStatus !== 200) return { ok: false, status: roomStatus, json: async () => ({ error: { message: 'temporary room failure' } }) };
      return { ok: true, status: 200, json: async () => currentRoom };
    }
    throw new Error(`unexpected Firebase request: ${url}`);
  };
  return { calls, restore: () => { global.fetch = originalFetch; } };
}
async function restoreCandidate(currentRoom, options = {}) {
  bridge.reset();
  const store = storage();
  bridge.saveCredential(options.credentialRecord || credential(options.credentialRoom || currentRoom), store);
  const lockManager = options.lockManager || locks();
  const mock = mockFirebase(currentRoom, options);
  try { return { candidate: await bridge.restore({ storage: store, lockManager }), store, lockManager, calls: mock.calls }; }
  finally { mock.restore(); }
}

(async () => {
  await test('credential is exact, excludes idToken/game state, and malformed local data falls back to absent', async () => {
    const current = room(); const value = credential(current);
    assert.deepEqual(Object.keys(value).sort(), ['hostUid', 'lastConfirmedExpiresAt', 'refreshToken', 'roomCode', 'roomCreatedAt', 'savedAt', 'seat', 'uid', 'version']);
    assert.equal(Object.hasOwn(value, 'idToken'), false); assert.equal(Object.hasOwn(value, 'roundId'), false);
    const store = storage(); store.setItem(bridge.storageKey(), '{broken'); assert.equal(bridge.loadCredential(store), null); assert.equal(store.value(bridge.storageKey()), null);
  });

  await test('refreshes the same UID, rotates only refreshToken, validates all legal round statuses, and never claims an empty seat', async () => {
    for (const status of ['lobby', 'revealing', 'playing', 'results']) {
      const current = room(status); const result = await restoreCandidate(current);
      assert.equal(result.candidate.auth.uid, uid); assert.equal(result.candidate.seat, 'e1'); assert.equal(result.candidate.role, 'guest');
      assert.equal(result.candidate.roundStatus, status); assert.equal(bridge.auth().uid, uid);
      assert.equal(result.candidate.room.round.status, status, 'candidate retains only authoritative room identity for B3 handoff');
      assert.equal(bridge.pending().room.round.status, status);
      assert.equal(bridge.loadCredential(result.store).refreshToken, 'rotated-refresh-token');
      assert.equal(result.calls.some(call => call.url.includes('signUp')), false);
      assert.equal(result.calls.some(call => call.url.includes('/slots/e1.json') && call.method === 'PUT'), false);
      bridge.reset();
    }
  });

  await test('stored expiry is only a hint: server-token time keeps a valid room through local clock skew and clears an authoritatively expired room', async () => {
    const realNow = Date.now; const serverNow = realNow();
    const validRoom = room('playing', { expiresAt: serverNow + 10 * 60 * 1000 });
    Date.now = () => serverNow + 24 * 60 * 60 * 1000;
    try {
      const result = await restoreCandidate(validRoom, { tokenIssuedAtMs: serverNow });
      assert.equal(result.candidate.roundStatus, 'playing'); assert.ok(result.store.value(bridge.storageKey())); bridge.reset();
    } finally { Date.now = realNow; }

    const expiredRoom = room('playing', { expiresAt: serverNow - 1000 });
    Date.now = () => serverNow - 24 * 60 * 60 * 1000;
    try {
      bridge.reset(); const store = storage(); bridge.saveCredential(credential(expiredRoom), store); const mock = mockFirebase(expiredRoom, { tokenIssuedAtMs: serverNow });
      try { await fails('FIREBASE_REENTRY_ROOM_EXPIRED', () => bridge.restore({ storage: store, lockManager: locks() })); }
      finally { mock.restore(); }
      assert.equal(store.value(bridge.storageKey()), null);
    } finally { Date.now = realNow; }
  });

  await test('UID, room identity, expiry, and seat mismatches fail closed and clear the credential', async () => {
    const cases = [
      ['FIREBASE_REENTRY_UID_MISMATCH', room(), { refreshUserId: 'other-uid' }],
      ['FIREBASE_REENTRY_ROOM_PROTOCOL_MISMATCH', room('playing', { protocol: 2 }), {}],
      ['FIREBASE_REENTRY_ROOM_IDENTITY_MISMATCH', room('playing', { createdAt: 1800000000001 }), {}],
      ['FIREBASE_REENTRY_ROOM_EXPIRED', room('playing', { expiresAt: Date.now() - 5000 }), {}],
      ['FIREBASE_REENTRY_SEAT_MISMATCH', room('playing', { slots: { p1: { uid: hostUid }, e1: { uid: 'other' }, s1: null, s2: null } }), {}]
    ];
    for (const [code, current, options] of cases) {
      bridge.reset(); const store = storage(); bridge.saveCredential(credential(room()), store); const mock = mockFirebase(current, options);
      try { await fails(code, () => bridge.restore({ storage: store, lockManager: locks() })); }
      finally { mock.restore(); }
      assert.equal(store.value(bridge.storageKey()), null); assert.equal(bridge.auth(), null);
    }
  });

  await test('transient refresh keeps the credential and does not silently create another anonymous UID, while definitive invalid refresh clears it', async () => {
    const current = room(); bridge.reset(); const store = storage(); bridge.saveCredential(credential(current), store);
    let mock = mockFirebase(current, { refreshStatus: 503, refreshError: 'SERVICE_UNAVAILABLE' });
    try { await fails('FIREBASE_REENTRY_REFRESH_TRANSIENT', () => bridge.restore({ storage: store, lockManager: locks() })); }
    finally { mock.restore(); }
    assert.ok(store.value(bridge.storageKey())); assert.equal(bridge.auth(), null);
    mock = mockFirebase(current, { refreshStatus: 400, refreshError: 'INVALID_REFRESH_TOKEN' });
    try { await fails('FIREBASE_REENTRY_REFRESH_INVALID', () => bridge.restore({ storage: store, lockManager: locks() })); }
    finally { mock.restore(); }
    assert.equal(store.value(bridge.storageKey()), null);
  });

  await test('room 408, 429, and 5xx responses are retryable, retain the rotated token, and a retry uses that token', async () => {
    for (const roomStatus of [408, 429, 500, 502, 503, 504]) {
      bridge.reset(); const current = room(); const store = storage(); bridge.saveCredential(credential(current), store); const manager = locks();
      let mock = mockFirebase(current, { roomStatus });
      try { await fails('FIREBASE_REENTRY_ROOM_TRANSIENT', () => bridge.restore({ storage: store, lockManager: manager })); }
      finally { mock.restore(); }
      assert.equal(bridge.auth(), null); assert.equal(bridge.loadCredential(store).refreshToken, 'rotated-refresh-token');
      const retryManager = locks(); mock = mockFirebase(current);
      try {
        const candidate = await bridge.restore({ storage: store, lockManager: retryManager });
        assert.equal(candidate.auth.uid, uid);
        const refreshCall = mock.calls.find(call => call.url.includes('securetoken.googleapis.com'));
        assert.match(refreshCall.body, /refresh_token=rotated-refresh-token/);
      } finally { mock.restore(); }
      bridge.reset();
    }
  });

  await test('definitive missing rooms and non-canonical round identities clear the credential', async () => {
    const missingReference = room();
    bridge.reset();
    const missingStore = storage(); bridge.saveCredential(credential(missingReference), missingStore);
    let mock = mockFirebase(null);
    try { await fails('FIREBASE_REENTRY_ROOM_UNAVAILABLE', () => bridge.restore({ storage: missingStore, lockManager: locks() })); }
    finally { mock.restore(); }
    assert.equal(missingStore.value(bridge.storageKey()), null);

    bridge.reset();
    const invalidStore = storage(); const invalidRoom = room('playing', { round: { id: 'not-a-round-id', status: 'playing' } });
    bridge.saveCredential(credential(invalidRoom), invalidStore); mock = mockFirebase(invalidRoom);
    try { await fails('FIREBASE_REENTRY_ROUND_INVALID', () => bridge.restore({ storage: invalidStore, lockManager: locks() })); }
    finally { mock.restore(); }
    assert.equal(invalidStore.value(bridge.storageKey()), null);
  });

  await test('a validated pending candidate blocks normal create and join without replacing its credential or lease', async () => {
    const current = room('playing'); const result = await restoreCandidate(current);
    const before = result.store.value(bridge.storageKey());
    await fails('FIREBASE_REENTRY_PENDING', () => bridge.createRoom());
    await fails('FIREBASE_REENTRY_PENDING', () => bridge.claimRoom(roomCode));
    assert.equal(result.store.value(bridge.storageKey()), before);
    assert.equal(bridge.pending().seat, 'e1');
    bridge.reset();
  });

  await test('known terminal seat and fatal exits clear the persisted re-entry credential', async () => {
    const key = bridge.storageKey();
    const previous = globalThis.localStorage.getItem(key);
    const value = credential(room());
    try {
      bridge.reset(); bridge.saveCredential(value);
      bridge.setOnline({ kind: 'firebase', seat: 'e1', auth: { uid }, slots: { e1: { uid: 'someone-else' } }, seatLostHandled: false, transport: { close() {} } });
      bridge.noticeSeatLost();
      assert.equal(globalThis.localStorage.getItem(key), null);

      bridge.reset(); bridge.saveCredential(value);
      bridge.setOnline({ kind: 'firebase', role: 'guest', room: roomCode, seat: 'e1', auth: { uid, idToken: token(uid), refreshToken: 'refresh-secret-not-logged' } });
      const originalFetch = global.fetch;
      global.fetch = async () => ({ ok: true, status: 200, json: async () => null });
      try { bridge.releaseFatal(); } finally { global.fetch = originalFetch; }
      assert.equal(globalThis.localStorage.getItem(key), null);
    } finally {
      bridge.reset();
      if (previous === null) globalThis.localStorage.removeItem(key);
      else globalThis.localStorage.setItem(key, previous);
    }
  });

  await test('exclusive lease rejects a second tab and releases for the next activation without exposing refresh credentials', async () => {
    const current = room(); const manager = locks(); const value = credential(current);
    const first = await bridge.acquireLease(value, manager);
    await fails('FIREBASE_REENTRY_ALREADY_ACTIVE', () => bridge.acquireLease(value, manager));
    assert.match(first.name, new RegExp(`:${roomCode}:e1:${uid}$`)); assert.doesNotMatch(first.name, /refresh-secret/);
    assert.equal(first.release(), true); await new Promise(resolve => setImmediate(resolve));
    const next = await bridge.acquireLease(value, manager); next.release();
  });

  await test('guest heartbeat is allowed after validation, p1 performs no slot write, and no Battle resume code is called', async () => {
    const guest = await restoreCandidate(room('playing')); assert.ok(guest.calls.some(call => call.url.includes('/slots/e1/seenAt.json') && call.method === 'PUT'));
    bridge.reset();
    const hostRoom = room('playing'); hostRoom.slots.p1 = { uid, claimedAt: Date.now() }; hostRoom.slots.e1 = { uid: 'other' }; hostRoom.hostUid = uid;
    const store = storage(); const hostCredential = reentry.createCredential({ uid, refreshToken: 'refresh-secret-not-logged', roomCode, seat: 'p1', roomCreatedAt: hostRoom.createdAt, hostUid: uid, lastConfirmedExpiresAt: hostRoom.expiresAt, savedAt: Date.now() }); bridge.saveCredential(hostCredential, store);
    const mock = mockFirebase(hostRoom); try { await bridge.restore({ storage: store, lockManager: locks() }); } finally { mock.restore(); }
    assert.equal(mock.calls.some(call => call.url.includes('/slots/p1/') && call.method === 'PUT'), false); bridge.reset();
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
    assert.match(source, /scheduleFirebaseRoomSeatReentryBootstrap\(\)/); assert.doesNotMatch(source, /restoreFirebaseRoomSeatReentry[\s\S]{0,1300}applySnapshot\(/);
    assert.doesNotMatch(source, /firebaseReentry[^\n]{0,100}(console\.log|onlineLog|location\.href)/i);
    assert.doesNotMatch(source, /isDefinitelyExpired\(credential,\s*Date\.now\(\)\)/);
    assert.match(source, /addEventListener\('pagehide',[\s\S]{0,500}endOnline\(true, true, true\)/);
    assert.match(source, /function leaveFirebaseLobby\(\)[\s\S]{0,700}endOnline\(false, false, false, true\)/);
  });

  console.log(`firebase-online-reentry-phase3d8b2: ${passed}/11 passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
