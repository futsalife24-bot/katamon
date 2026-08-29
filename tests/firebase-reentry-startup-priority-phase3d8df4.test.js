const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const stage3 = kt.stage3();
const reentry = stage3.firebaseReentryForTest();
const recovery = stage3.firebaseBattleRecoveryForTest();
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${name}`); };

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    value: key => values.get(key) || null
  };
}

function locks() {
  return { request: (_name, _options, callback) => Promise.resolve(callback({ name: 'f4-lock' })) };
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url');
  return `x.${claims}.y`;
}

const roomCode = 'A2BC3DEF';
const guestUid = 'firebase-f4-guest';
const hostUid = 'firebase-f4-host';
function room() {
  const now = Date.now();
  return {
    protocol: 3, hostUid, createdAt: 1800000000000, expiresAt: now + 600000,
    visibility: 'private',
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
    slots: { p1: { uid: hostUid, claimedAt: now - 2 }, e1: { uid: guestUid, claimedAt: now - 1 }, s1: null, s2: null },
    round: { id: '4'.repeat(48), status: 'playing', players: { p1: hostUid, e1: guestUid } }
  };
}

function credential(currentRoom) {
  return reentry.createCredential({
    auth: { uid: guestUid, refreshToken: 'f4-refresh-secret' },
    room: currentRoom, roomCode, seat: 'e1', savedAt: Date.now()
  });
}

async function restoreFailureWithCpuSuspend({ roomStatus, expectedCode }) {
  reentry.reset();
  kt.startBattle('kyoryu');
  const cpuBefore = JSON.stringify(kt.load());
  const currentRoom = room();
  const store = storage();
  reentry.saveCredential(credential(currentRoom), store);
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const requestUrl = String(url);
    if (requestUrl.includes('securetoken.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ user_id: guestUid, id_token: token(), refresh_token: 'f4-rotated', expires_in: '3600' }) };
    }
    if (requestUrl.includes(`/rooms/${roomCode}.json`)) {
      if (roomStatus === 200) return { ok: true, status: 200, json: async () => currentRoom };
      return { ok: false, status: roomStatus, json: async () => ({ error: { message: 'f4 room failure' } }) };
    }
    throw new Error(`unexpected F4 Firebase request: ${requestUrl}`);
  };
  try {
    await assert.rejects(
      () => reentry.restore({ storage: store, lockManager: locks() }),
      error => error?.code === expectedCode
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(JSON.stringify(kt.load()), cpuBefore, 'Firebase failure must not consume or rewrite CPU suspend');
  return { store, credentialPresent: !!reentry.loadCredential(store) };
}

void (async () => {
  await test('fresh-boot replay rollback restores a null ONLINE shell without inventing character authority', () => {
    reentry.setOnline(null);
    const before = recovery.startupStateForTest();
    const rollback = recovery.captureRollbackForTest();

    kt.setCharactersForTest('kyoryu', 'iwa');
    stage3.resetMatchForTest();
    reentry.setOnline({ kind: 'firebase', phase: 'recovering', seat: 'e1' });

    assert.doesNotThrow(() => recovery.restoreRollbackForTest(rollback));
    assert.deepEqual(recovery.startupStateForTest(), before);
  });

  await test('valid local Battle rollback remains exact and does not weaken normal snapshot validation', () => {
    kt.setCharactersForTest('kyoryu', 'iwa');
    stage3.resetMatchForTest();
    const original = structuredClone(kt.snapshot());
    const rollback = recovery.captureRollbackForTest();
    const changed = structuredClone(original);
    changed.units.find(unit => unit.id === 'p1').hp -= 20;
    kt.apply(changed);
    recovery.restoreRollbackForTest(rollback);
    assert.deepEqual(kt.snapshot(), original);

    const invalid = structuredClone(original);
    invalid.units.find(unit => unit.id === 'p1').character = 'not-a-character';
    assert.throws(() => kt.apply(invalid), error => error?.code === 'UNKNOWN_CHARACTER');
  });

  await test('CPU suspend remains explicit-user authority and is not consumed by Firebase rollback', () => {
    reentry.setOnline(null);
    kt.startBattle('kyoryu');
    assert.ok(kt.load(), 'production CPU start must create a current suspend');
    const stored = JSON.stringify(kt.load());
    const rollback = recovery.captureRollbackForTest();
    recovery.restoreRollbackForTest(rollback);
    assert.equal(JSON.stringify(kt.load()), stored, 'rollback must preserve CPU suspend bytes');
    assert.doesNotThrow(() => kt.resumeCpuSuspendForTest(), 'CPU suspend remains available only through explicit resume');
    assert.ok(kt.snapshot().units.every(unit => typeof unit.character === 'string'));
  });

  await test('transient and definitive Firebase failures preserve CPU suspend while credential retention follows B2', async () => {
    let outcome = await restoreFailureWithCpuSuspend({ roomStatus: 503, expectedCode: 'FIREBASE_REENTRY_ROOM_TRANSIENT' });
    assert.equal(outcome.credentialPresent, true, 'transient failure keeps Firebase re-entry retryable');

    outcome = await restoreFailureWithCpuSuspend({ roomStatus: 404, expectedCode: 'FIREBASE_REENTRY_ROOM_UNAVAILABLE' });
    assert.equal(outcome.credentialPresent, false, 'definitive missing room clears only the Firebase credential');
  });

  console.log(`firebase re-entry startup priority phase3d8df4: ${passed}/${passed} passed`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
