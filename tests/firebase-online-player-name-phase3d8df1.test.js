const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const reentry = h.firebaseReentryForTest();
let passed = 0;
let firebaseWrites = 0;

globalThis.fetch = async () => {
  firebaseWrites += 1;
  throw new Error('player-name gate must run before Firebase');
};

const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
};

function resetTitle(name = '') {
  h.setOnlineForLogTest(null);
  kt.setGamePhaseForTest('title');
  kt.setPlayerNameForTest(name);
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url');
  return `x.${claims}.y`;
}

function mockRoomCreation() {
  const calls = [];
  const rooms = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    calls.push({ url: href, method, body: options.body || '' });
    if (href.includes('accounts:signUp')) {
      return { ok: true, status: 200, json: async () => ({ localId: 'uid-host', idToken: token(), refreshToken: 'refresh', expiresIn: '3600' }) };
    }
    const roomMatch = href.match(/\/rooms\/([A-Z0-9]{8})\.json/);
    if (roomMatch && method === 'PUT') {
      const value = JSON.parse(options.body);
      value.createdAt = Date.now();
      rooms.set(roomMatch[1], value);
      return { ok: true, status: 200, json: async () => value };
    }
    if (roomMatch && method === 'GET') {
      return { ok: true, status: 200, json: async () => rooms.get(roomMatch[1]) };
    }
    if (/\/open\/[A-Z0-9]{8}\.json/.test(href) && method === 'PUT') {
      return { ok: true, status: 200, json: async () => JSON.parse(options.body) };
    }
    throw new Error(`unexpected request: ${method} ${href}`);
  };
  return { calls };
}

(async () => {
  await test('fresh profile cannot enter ONLINE or write Firebase before setting a name', () => {
    resetTitle('');
    kt.activateTitleOnlineForTest();
    const gate = kt.playerNameGateForTest();
    assert.equal(gate.nameOpen, true);
    assert.equal(gate.lobbyOpen, false);
    assert.equal(gate.phase, 'title');
    assert.match(gate.note, /プレイヤー名.*必要/);
    assert.equal(firebaseWrites, 0);
  });

  await test('blank normalized name remains blocked and valid name resumes ONLINE exactly once', () => {
    assert.equal(kt.submitPlayerNameForTest(' \t\r\n '), '');
    let gate = kt.playerNameGateForTest();
    assert.equal(gate.nameOpen, true);
    assert.equal(gate.lobbyOpen, false);
    assert.match(gate.note, /1文字以上/);
    assert.equal(firebaseWrites, 0);

    assert.equal(kt.submitPlayerNameForTest('  ホスト\t '), 'ホスト');
    gate = kt.playerNameGateForTest();
    assert.equal(gate.nameOpen, false);
    assert.equal(gate.lobbyOpen, true);
    assert.equal(firebaseWrites, 0);
  });

  await test('fresh profile cannot enter CPU Battle before setting a name', () => {
    resetTitle('');
    kt.activateTitleCpuForTest();
    const gate = kt.playerNameGateForTest();
    assert.equal(gate.nameOpen, true);
    assert.equal(gate.phase, 'title');
    assert.equal(firebaseWrites, 0);
  });

  await test('public listing uses the same canonical non-empty player name', () => {
    kt.setPlayerNameForTest('  ホスト\t ');
    const payload = kt.firebaseOpenRoomPayloadForTest(
      { uid: 'uid-host', serverTimeOffset: 0 }, '1v1', 'だれでも歓迎', 1
    );
    assert.equal(kt.playerNameForTest(), 'ホスト');
    assert.equal(payload.hostName, 'ホスト');
    assert.ok(payload.hostName.length > 0 && payload.hostName.length <= 12);
    assert.deepEqual(Object.keys(payload).sort(), [
      'createdAt', 'expiresAt', 'format', 'hostName', 'hostUid', 'playerCount', 'roomName'
    ]);
  });

  await test('public listing payload fails closed if the entry gate is bypassed without a name', () => {
    kt.setPlayerNameForTest(' \t ');
    assert.throws(
      () => kt.firebaseOpenRoomPayloadForTest({ uid: 'uid-host', serverTimeOffset: 0 }, '1v1', '公開部屋', 1),
      /プレイヤー名が必要/
    );
  });

  await test('canonical player name is capped at the Rules maximum', () => {
    kt.setPlayerNameForTest('123456789012345');
    const payload = kt.firebaseOpenRoomPayloadForTest(
      { uid: 'uid-host', serverTimeOffset: 0 }, '2v2', '公開部屋', 1
    );
    assert.equal(kt.playerNameForTest(), '123456789012');
    assert.equal(payload.hostName, '123456789012');
  });

  await test('valid-name private room creates the room without publishing an open listing', async () => {
    reentry.reset();
    reentry.clearCredential();
    kt.setPlayerNameForTest('ホスト');
    const mock = mockRoomCreation();
    const made = await reentry.createRoom('A2BC3DEF', null, { visibility: 'private', gearMode: 'off' });
    assert.equal(made.room.visibility, 'private');
    assert.equal(mock.calls.filter(call => call.method === 'PUT' && call.url.includes('/rooms/')).length, 1);
    assert.equal(mock.calls.some(call => call.url.includes('/open/')), false);
    reentry.releaseLease(made.reentryLease);
    reentry.clearCredential();
    reentry.reset();
  });

  await test('valid-name public room publishes its canonical host identity after room creation', async () => {
    reentry.reset();
    reentry.clearCredential();
    kt.setPlayerNameForTest('  ホスト\t ');
    const mock = mockRoomCreation();
    const made = await reentry.createRoom('B2CD3EFG', null, { visibility: 'public', gearMode: 'off' });
    await kt.publishOpenRoomForTest(made.code, made.auth, '1v1', 'だれでも歓迎', 1, made.room.visibility);
    const listing = mock.calls.find(call => call.method === 'PUT' && call.url.includes('/open/'));
    assert.ok(listing);
    assert.equal(JSON.parse(listing.body).hostName, 'ホスト');
    assert.equal(made.room.visibility, 'public');
    reentry.releaseLease(made.reentryLease);
    reentry.clearCredential();
    reentry.reset();
  });

  console.log(`Firebase ONLINE player-name Phase 3D-8D-F1: ${passed}/${passed}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
