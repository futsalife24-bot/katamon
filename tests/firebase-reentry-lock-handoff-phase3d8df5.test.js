const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./seatharness.js');

const kt = harness.kt();
const stage3 = kt.stage3();
const reentry = stage3.firebaseReentryForTest();
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };

const roomCode = 'A2BC3DEF';
const roundId = '5'.repeat(48);
const hostUid = 'firebase-f5-host';
const guestUid = 'firebase-f5-guest';

function token() {
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url');
  return `x.${claims}.y`;
}

function room() {
  const now = Date.now();
  return {
    protocol: 3,
    hostUid,
    createdAt: 1800000000000,
    expiresAt: now + 600000,
    visibility: 'private',
    settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
    slots: { p1: { uid: hostUid, claimedAt: now - 2 }, e1: { uid: guestUid, claimedAt: now - 1 }, s1: null, s2: null },
    round: { id: roundId, status: 'playing', players: { p1: hostUid, e1: guestUid } }
  };
}

function credential(currentRoom) {
  return reentry.createCredential({
    auth: { uid: guestUid, refreshToken: 'f5-refresh-secret' },
    room: currentRoom,
    roomCode,
    seat: 'e1',
    savedAt: Date.now()
  });
}

async function waitFor(predicate, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('F5 lifecycle wait timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

void (async () => {
  await test('startup retries exclusive Web Lock contention and preserves both credentials', async () => {
    reentry.reset();
    reentry.resetBootstrapForTest();
    kt.startBattle('kyoryu');
    const cpuRaw = globalThis.localStorage.getItem('katamon_suspend_v1');
    assert.ok(cpuRaw, 'current CPU suspend must exist before Firebase bootstrap');

    const currentRoom = room();
    reentry.saveCredential(credential(currentRoom));
    let lockAttempts = 0;
    const originalLocks = globalThis.navigator.locks;
    const originalFetch = globalThis.fetch;
    globalThis.navigator.locks = {
      request(_name, _options, callback) {
        lockAttempts += 1;
        if (lockAttempts <= 2) return Promise.resolve(callback(null));
        return Promise.resolve(callback({ name: 'f5-acquired' }));
      }
    };
    const fetchCalls = [];
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      fetchCalls.push({ url: requestUrl, method: options.method || 'GET' });
      if (requestUrl.includes('securetoken.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ user_id: guestUid, id_token: token(), refresh_token: 'f5-rotated', expires_in: '3600' }) };
      }
      if (requestUrl.includes(`/rooms/${roomCode}/slots/e1/seenAt.json`)) return { ok: true, status: 200, json: async () => null };
      if (requestUrl.includes(`/rooms/${roomCode}/rounds/${roundId}/messages.json`)) return { ok: true, status: 200, json: async () => null };
      if (requestUrl.includes(`/rooms/${roomCode}/round.json`)) return { ok: true, status: 200, json: async () => currentRoom.round };
      if (requestUrl.includes(`/rooms/${roomCode}.json`)) return { ok: true, status: 200, json: async () => currentRoom };
      throw new Error(`unexpected F5 request: ${requestUrl}`);
    };

    try {
      reentry.scheduleBootstrap();
      await waitFor(() => reentry.bootstrapState() === 'completed');
      assert.equal(lockAttempts, 3, 'two contentions must be retried before the lease is acquired');
      assert.ok(reentry.pending(), 'the same Firebase room/seat candidate must survive contention');
      assert.equal(reentry.loadCredential()?.uid, guestUid, 'the existing Firebase identity must be retained');
      assert.equal(globalThis.localStorage.getItem('katamon_suspend_v1'), cpuRaw, 'CPU suspend bytes must remain untouched');
      assert.equal(fetchCalls.some(call => call.url.includes('signUp')), false, 'contention must not create a new anonymous UID');
      assert.equal(reentry.bootstrapRetryScheduled(), false, 'the retry timer must be consumed after successful acquisition');
    } finally {
      stage3.firebaseBattleRecoveryForTest().endActive();
      reentry.resetBootstrapForTest();
      reentry.reset();
      globalThis.navigator.locks = originalLocks;
      globalThis.fetch = originalFetch;
    }
  });

  await test('bootstrap and replay retries are limited to transient failures while exclusivity stays unchanged', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const bootstrapStart = source.indexOf('function scheduleFirebaseRoomSeatReentryBootstrap()');
    const bootstrapEnd = source.indexOf('async function ensureFirebaseAuth', bootstrapStart);
    const bootstrap = bootstrapStart >= 0 && bootstrapEnd > bootstrapStart
      ? source.slice(bootstrapStart, bootstrapEnd) : '';
    const retryHelpersStart = source.indexOf('function firebaseReentryErrorCode(error)');
    const retryHelpersEnd = source.indexOf('function recordFirebaseReentryTerminalFailure(error)', retryHelpersStart);
    const retryHelpers = retryHelpersStart >= 0 && retryHelpersEnd > retryHelpersStart
      ? source.slice(retryHelpersStart, retryHelpersEnd) : '';
    assert.match(retryHelpers, /FIREBASE_REENTRY_ALREADY_ACTIVE/);
    assert.match(retryHelpers, /FIREBASE_REENTRY_REFRESH_TRANSIENT/);
    assert.match(retryHelpers, /FIREBASE_REENTRY_ROOM_TRANSIENT/);
    assert.match(retryHelpers, /FIREBASE_REQUEST_TRANSIENT/);
    assert.match(retryHelpers, /FIREBASE_RECOVERY_TRANSPORT_CONNECT_FAILED/);
    assert.doesNotMatch(retryHelpers, /FIREBASE_REQUEST_UNAUTHORIZED|FIREBASE_REQUEST_FAILED|FIREBASE_REENTRY_UID_MISMATCH/,
      'identity, permission and protocol failures must remain terminal');
    assert.match(bootstrap, /firebaseReentryBootstrapState = 'retry_wait'/);
    assert.match(bootstrap, /firebaseReentryBootstrapRetryTimer = setTimeout/);
    assert.match(bootstrap, /scheduleFirebaseBattleRecoveryReplan\(error\)/,
      'a verified candidate must retry canonical recovery rather than restarting identity bootstrap');
    assert.match(source, /\{ mode: 'exclusive', ifAvailable: true \}/, 'same-seat exclusivity must not be weakened');
    assert.doesNotMatch(bootstrap, /clearFirebaseReentryCredential|ensureFirebaseAuth|signUp/, 'contention retry must not replace identity authority');
  });

  await test('non-bfcache guest document handoff closes transport and releases only its existing lease', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const handoffStart = source.indexOf('function releaseFirebaseGuestLeaseForDocumentHandoff(event)');
    const handoffEnd = source.indexOf("window.addEventListener('pagehide'", handoffStart);
    const handoff = handoffStart >= 0 && handoffEnd > handoffStart
      ? source.slice(handoffStart, handoffEnd) : '';
    assert.match(handoff, /online\.kind !== 'firebase'/);
    assert.match(handoff, /online\.role === 'host'/, 'host keeps its existing pagehide/endOnline contract');
    assert.match(handoff, /event\?\.persisted === true/, 'bfcache-capable documents retain the exclusive seat lease');
    assert.match(handoff, /online\.transport\?\.close\(\)/);
    assert.match(handoff, /releaseFirebaseReentryLease\(online\.reentryLease\)/);
    assert.match(handoff, /online\.reentryLease = null/);
    assert.match(source, /else releaseFirebaseGuestLeaseForDocumentHandoff\(event\)/);
    assert.doesNotMatch(handoff, /clearFirebaseReentryCredential|removeItem|resumeSuspendedMatch|ensureFirebaseAuth/,
      'document handoff must not rewrite identity or CPU authority');
  });

  console.log(`firebase re-entry lock handoff phase3d8df5: ${passed}/${passed} passed`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
