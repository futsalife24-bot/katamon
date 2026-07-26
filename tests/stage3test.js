// Stage 3 のネットワーク補助関数・ルールをネットワークなしで検証する。
const fs = require('fs');
const path = require('path');
const { kt } = require('./seatharness');

let pass = 0, fail = 0;
function check(name, value) {
  if (value) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}`); }
}

(async () => {
  console.log('=== stage3 ===');
  const app = kt();
  const h = app.stage3();
  const actionId = 'a'.repeat(48);
  check('protocol 2', app.proto() === 2);
  check('room code normalizes separators / ambiguous chars', h.normalizeRoomCode('ab-cd ef2o3') === 'ABCDEF23');
  check('room code accepts exactly 8 allowed chars', h.isRoomCode('A2BC3DEF'));
  check('room code rejects ambiguous/short code', !h.isRoomCode('A2BC3DEO') && !h.isRoomCode('A2BC3DE'));
  check('generated code has allowed alphabet', h.isRoomCode(h.generateRoomCode(() => 0)));
  const pushA = h.firebasePushId(4242, () => 0);
  const pushB = h.firebasePushId(4242, () => 0);
  check('client Firebase push IDs are valid and strictly ordered within one millisecond', /^[-0-9A-Z_a-z]{20}$/.test(pushA) && pushA < pushB);
  check('Firebase compare JSON is key-order independent', h.stableFirebaseJson({ b: 1, a: { d: 4, c: 3 } }) === h.stableFirebaseJson({ a: { c: 3, d: 4 }, b: 1 }));
  const serverClock = 1760000000000;
  const tokenPayload = Buffer.from(JSON.stringify({ iat: serverClock / 1000, exp: serverClock / 1000 + 3600 })).toString('base64url');
  const token = `header.${tokenPayload}.signature`;
  const fastOffset = h.firebaseServerTimeOffsetFromToken(token, serverClock + 5 * 60 * 1000);
  const slowOffset = h.firebaseServerTimeOffsetFromToken(token, serverClock - 5 * 60 * 1000);
  const fastClockSentAt = h.estimateFirebaseServerNow(serverClock + 5 * 60 * 1000, fastOffset);
  const slowClockSentAt = h.estimateFirebaseServerNow(serverClock - 5 * 60 * 1000, slowOffset);
  check('Firebase JWT iat offset keeps +/-5 minute client clocks within the rules timestamp window', Math.abs(fastClockSentAt - serverClock) <= 120000 && Math.abs(slowClockSentAt - serverClock) <= 120000);
  const invalidIatToken = `header.${Buffer.from(JSON.stringify({ exp: serverClock / 1000 + 3600 })).toString('base64url')}.signature`;
  const invalidYearToken = `header.${Buffer.from(JSON.stringify({ iat: 946684800, exp: 946688400 })).toString('base64url')}.signature`;
  check('Firebase rejects invalid token/iat time data without falling back to client time', h.firebaseServerTimeOffsetFromToken('not-a-jwt', serverClock) === null && h.firebaseServerTimeOffsetFromToken(invalidIatToken, serverClock) === null && h.firebaseServerTimeOffsetFromToken(invalidYearToken, serverClock) === null && h.estimateFirebaseServerNow(serverClock, Infinity) === null);

  const initial = h.parseFirebaseSse(JSON.stringify({ path: '/', data: {
    '-a': { v: 2, t: 'commit', from: 'host' }, '-b': { v: 2, t: 'reveal', from: 'guest' }
  }}));
  const patch = h.parseFirebaseSse(JSON.stringify({ path: '/-c', data: { v: 2, t: 'ready', from: 'guest' } }));
  const timestampPatch = h.parseFirebaseSse(JSON.stringify({ path: '/-c/sentAt', data: Date.now() }));
  check('SSE initial snapshot is expanded', initial.length === 2 && initial[0].key === '-a');
  check('SSE push event is parsed', patch.length === 1 && patch[0].key === '-c' && patch[0].msg.t === 'ready');
  check('SSE nested server-timestamp update is not treated as a packet', timestampPatch.length === 0);
  const accept = h.createSseDeduper();
  const manyKeys = Array.from({ length: 600 }, (_, i) => accept(`-key-${i}`)).every(Boolean);
  check('SSE push keys are deduplicated for the whole room lifetime', accept('-a') && !accept('-a') && accept('-b') && manyKeys && !accept('-key-0'));

  const commit = await h.commitPayload('kyoryu', '0123456789abcdef0123456789abcdef');
  check('commit is SHA-256 hex', /^[0-9a-f]{64}$/.test(commit));
  const firstA = await h.fairFirstPlayer('A2BC3DEF', 'a'.repeat(48), 'b'.repeat(48));
  const firstB = await h.fairFirstPlayer('A2BC3DEF', 'a'.repeat(48), 'b'.repeat(48));
  check('fair first player is deterministic', firstA === firstB && (firstA === 'p1' || firstA === 'e1'));
  app.startBattle('kyoryu');
  const safeSnap = app.snapshot();
  check('Firebase state accepts a complete safe snapshot', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: safeSnap }));
  app.setTerrain('tieredBasin');
  const tieredStart = app.snapshot();
  check('Firebase start accepts tieredBasin empty terrain columns', tieredStart.segments.some(column => column.length === 0)
    && h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'start', sentAt: Date.now(), snap: tieredStart }));
  const rtdbRoundTrip = JSON.parse(JSON.stringify(tieredStart));
  delete rtdbRoundTrip.craters;
  rtdbRoundTrip.segments = rtdbRoundTrip.segments.map(column => column.length ? column : null);
  const normalizedRoundTrip = h.normalizeFirebaseSnapshot(rtdbRoundTrip);
  check('Firebase normalizes RTDB-omitted empty arrays only', Array.isArray(normalizedRoundTrip.craters)
    && normalizedRoundTrip.segments.some(column => Array.isArray(column) && column.length === 0)
    && h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'start', sentAt: Date.now(), snap: normalizedRoundTrip }));
  const rtdbObjectSnapshot = JSON.parse(JSON.stringify(safeSnap));
  rtdbObjectSnapshot.craters = { 0: { x: 720, y: 600, r: 30 } };
  rtdbObjectSnapshot.segments = Object.fromEntries(rtdbObjectSnapshot.segments.map((column, columnIndex) => [String(columnIndex),
    Object.fromEntries(column.map((segment, segmentIndex) => [String(segmentIndex), { 0: segment[0], 1: segment[1] }]))
  ]));
  const normalizedObjectSnapshot = h.normalizeFirebaseSnapshot(rtdbObjectSnapshot);
  check('Firebase normalizes dense RTDB numeric-key snapshot arrays', Array.isArray(normalizedObjectSnapshot.craters)
    && Array.isArray(normalizedObjectSnapshot.segments)
    && Array.isArray(normalizedObjectSnapshot.segments[0])
    && Array.isArray(normalizedObjectSnapshot.segments[0][0])
    && h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: normalizedObjectSnapshot }));
  const nullCratersSnapshot = h.normalizeFirebaseSnapshot({ ...safeSnap, craters: null });
  check('Firebase normalizes RTDB null craters to an empty array', Array.isArray(nullCratersSnapshot.craters)
    && h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: nullCratersSnapshot }));
  const outgoingState = { v: 2, t: 'state', from: 'peer', sentAt: 123, actionId, snap: tieredStart };
  const storedState = JSON.parse(JSON.stringify(outgoingState));
  delete storedState.snap.craters;
  storedState.snap.segments = storedState.snap.segments.map(column => column.length ? column : null);
  check('conditional PUT duplicate check accepts RTDB empty-array storage form', h.stableFirebaseJson(h.normalizeFirebaseMessageForCompare(outgoingState)) === h.stableFirebaseJson(h.normalizeFirebaseMessageForCompare(storedState)));
  const edgeImpactSnapshot = { ...safeSnap, craters: [{ x: 1451.1345787704356, y: 485.59510151957943, r: 44 }] };
  check('Firebase state accepts a normal crater just beyond the stage edge', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: edgeImpactSnapshot }));
  const sparseCratersSnapshot = h.normalizeFirebaseSnapshot({ ...safeSnap, craters: { 1: { x: 720, y: 600, r: 30 } } });
  const extraKeyCratersSnapshot = h.normalizeFirebaseSnapshot({ ...safeSnap, craters: { 0: { x: 720, y: 600, r: 30 }, extra: true } });
  check('Firebase rejects sparse or extra-key RTDB arrays', !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), snap: sparseCratersSnapshot })
    && !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), snap: extraKeyCratersSnapshot }));
  check('Firebase state rejects missing snapshot safely', !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now() }));
  const brokenTerrain = { ...safeSnap, segments: safeSnap.segments.slice(1) };
  check('Firebase state rejects malformed terrain before applySnapshot', !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), snap: brokenTerrain }));
  check('Firebase diagnostic identifies the rejected field safely', h.validateFirebaseMessageDetail({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), snap: { ...safeSnap, craters: null } }).reason === 'state.snap.craters');
  const grossState = JSON.parse(JSON.stringify(safeSnap));
  grossState.units[0].hp = Math.max(0, grossState.units[0].hp - 50);
  check('Firebase state rejects gross local-state divergence', !h.stateSnapshotMatchesBaseline(grossState, safeSnap));
  check('Firebase accepts old RTDB history with a finite server timestamp', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'ready', sentAt: Date.now() - 60 * 60 * 1000 }));
  check('Firebase heartbeat is a valid control packet without actionId', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'ping', sentAt: Date.now() }));
  const firstCommit = h.acceptPeerCommit(null, 'a'.repeat(64));
  const repeatCommit = h.acceptPeerCommit(firstCommit.hash, 'a'.repeat(64));
  const swappedCommit = h.acceptPeerCommit(firstCommit.hash, 'b'.repeat(64));
  check('peer commit is fixed after its first value', firstCommit.accept && repeatCommit.duplicate && swappedCommit.error);
  check('peer reveal rejects duplicates', h.acceptPeerReveal(false) && !h.acceptPeerReveal(true));
  check('unsolicited Firebase state/result are rejected before a remote fire', !h.firebaseFlowAllows({ t: 'state', from: 'peer', actionId, sentAt: 2 }, { remoteAction: null }) && !h.firebaseFlowAllows({ t: 'result', from: 'peer', actionId, sentAt: 2 }, { remoteAction: null }));
  const queuedFire = h.firebaseFlowAllows({ t: 'fire', unitId: 'p1', from: 'peer', actionId, sentAt: 1 }, { activeId: 'p1', remoteUnitId: 'p1', remoteAction: null });
  const queuedState = h.firebaseFlowAllows({ t: 'state', from: 'peer', actionId, sentAt: 2 }, { remoteAction: { unitId: 'p1', actionId, from: 'peer', resolved: true } });
  const mismatchSender = h.firebaseFlowAllows({ t: 'state', from: 'other', actionId, sentAt: 2 }, { remoteAction: { unitId: 'p1', actionId, from: 'peer', resolved: true } });
  const mismatchAction = h.firebaseFlowAllows({ t: 'state', from: 'peer', actionId: 'b'.repeat(48), sentAt: 2 }, { remoteAction: { unitId: 'p1', actionId, from: 'peer', resolved: true } });
  check('Firebase state is bound to the preceding remote fire sender and actionId', queuedFire && queuedState && !mismatchSender && !mismatchAction);
  const earlyState = { t: 'state', from: 'peer', actionId, sentAt: 2 };
  const bufferedState = h.bufferFirebaseTerminal(null, earlyState);
  check('Firebase buffers matching state before fire until that action arrives', bufferedState.ok && h.firebaseActionMatches(bufferedState.pending, { from: 'peer', actionId }) && h.firebaseFlowAllows(bufferedState.pending, { remoteAction: { from: 'peer', actionId, resolved: true } }));
  const firstResult = h.bufferFirebaseTerminal(null, { t: 'result', from: 'peer', actionId, sentAt: 2 });
  const duplicateResult = h.bufferFirebaseTerminal(firstResult.pending, { t: 'result', from: 'peer', actionId, sentAt: 3 });
  check('Firebase ignores a duplicate result with the same actionId', duplicateResult.ok && duplicateResult.duplicate);
  const pendingEntry = { visibleMs: 14900, checkedAt: 1000 };
  const pausedWhileHidden = h.advanceFirebasePendingVisibleTime(pendingEntry, 61000, true);
  const expiresWhenVisible = h.advanceFirebasePendingVisibleTime(pendingEntry, 61200, false);
  check('early terminal timeout pauses while hidden and expires after 15s visible', !pausedWhileHidden && pendingEntry.visibleMs === 15100 && expiresWhenVisible);
  const peerLiveness = { peerVisibleMs: 34000, pingVisibleMs: 9000, checkedAt: 1000 };
  const peerPaused = h.advanceFirebasePeerLiveness(peerLiveness, 60000, true);
  h.resetFirebasePeerLiveness(peerLiveness, 60000); // 有効なpeer packetを受信
  const peerReset = h.advanceFirebasePeerLiveness(peerLiveness, 61000, false);
  const peerExpired = h.advanceFirebasePeerLiveness(peerLiveness, 95000, false);
  check('Firebase peer liveness pauses hidden, valid peer traffic resets it, then expires visibly', !peerPaused.timedOut && peerLiveness.peerVisibleMs === 35000 && peerReset.pingDue && !peerReset.timedOut && peerExpired.timedOut);
  const serialWrites = [];
  const healthyQueue = h.createSerialSendQueue(async item => { serialWrites.push(item); }, () => {});
  const serialResults = await Promise.all([healthyQueue.send('fire'), healthyQueue.send('state')]);
  check('Firebase send queue preserves fire then state order', serialResults.every(Boolean) && serialWrites.join(',') === 'fire,state');
  const failedWrites = [];
  let fatalWrites = 0;
  const failedQueue = h.createSerialSendQueue(async item => {
    if (item === 'fire') throw new Error('write failed');
    failedWrites.push(item);
  }, () => { fatalWrites++; });
  const failedResults = await Promise.all([failedQueue.send('fire'), failedQueue.send('state')]);
  check('Firebase send queue poisons after an unrecoverable write failure', failedResults.every(result => result === false) && failedWrites.length === 0 && fatalWrites === 1 && failedQueue.isPoisoned());
  check('Firebase fire rejects NaN, missing fields, and invalid actionId', !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'fire', sentAt: Date.now(), actionId, unitId: 'p1', x: NaN, y: 0, anchor: { x: 0, y: 0 }, vx0: 1, vy0: 1, useSpecial: false }) && !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'fire', sentAt: Date.now(), unitId: 'p1' }) && !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'fire', sentAt: Date.now(), actionId: 'bad', unitId: 'p1', x: 0, y: 0, anchor: { x: 0, y: 0 }, vx0: 1, vy0: 1, useSpecial: false }));

  // 上の否定テストはどれも && の短絡で早期に false になるため、実際の座標判定まで到達しない。
  // 未定義の識別子(STAGE_H)を参照していても素通りし、fire だけが永久に届かないバグを見逃した。
  // 正常な fire を1本通すこと。ここが本番で最初に流れるパケットそのものになる。
  const validFire = { v: 2, from: 'peer', t: 'fire', sentAt: Date.now(), actionId, unitId: 'e1', x: 1224, y: 512, anchor: { x: 1224, y: 512 }, vx0: -320, vy0: -460, useSpecial: false };
  check('Firebase accepts a normal fire packet', h.validateFirebaseMessage(validFire));
  check('Firebase fire diagnostic reports no reason for a normal packet', h.validateFirebaseMessageDetail(validFire).ok === true);
  // 座標の上下限そのものも踏む。片側でも未定義参照が残っていればここで落ちる。
  const edgeFire = { ...validFire, x: -1000, y: -1000, anchor: { x: 1440 + 1000, y: 960 + 1000 } };
  check('Firebase fire accepts the documented coordinate bounds', h.validateFirebaseMessage(edgeFire));
  check('Firebase fire rejects coordinates past the bounds', !h.validateFirebaseMessage({ ...validFire, y: 960 + 1001 })
    && !h.validateFirebaseMessage({ ...validFire, anchor: { x: 1440 + 1001, y: 0 } }));

  let closed = 0, sent = 0;
  app.setTransport(() => ({ send: () => { sent++; }, onMessage: () => {}, close: () => { closed++; } }));
  app.beginOnline('guest');
  app.exitOnlineFromMenu();
  const loopbackExit = !app.onlineState() && app.state().gamePhase === 'title' && !app.hasSave() && sent >= 2 && closed === 1;
  app.beginOnline('guest');
  app.setOnlineKind('firebase');
  app.exitOnlineFromMenu();
  check('menu exit closes loopback and Firebase transports without a suspended save', loopbackExit && !app.onlineState() && app.state().gamePhase === 'title' && !app.hasSave() && sent >= 4 && closed === 2);

  const rulesText = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const htmlText = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rules = JSON.parse(rulesText).rules.rooms.$room;
  check('rules default deny and room code validation', rulesText.includes('".read": false') && rules['.write'].includes('$room.matches'));
  check('rules restrict guest claim and append-only messages', rules.guestUid['.write'].includes('!data.exists()') && rules.messages.$message['.write'].includes('!data.exists()'));
  check('rules reject a host claiming its own guest seat', rules.guestUid['.write'].includes("hostUid').val() !== auth.uid"));
  check('rules validate protocol, sender and bounded client timestamp', rules.messages.$message['.validate'].includes("'sentAt'") && rules.messages.$message['.validate'].includes("'from'"));
  check('rules whitelist actionId and require it for fire/state/result', rules.messages.$message.$other['.validate'] === false && rules.messages.$message.actionId['.validate'].includes('{48}') && rules.messages.$message['.validate'].includes("'fire' && newData.hasChildren(['unitId','x','y','anchor','vx0','vy0','useSpecial','actionId'])") && rules.messages.$message['.validate'].includes("'state' && newData.hasChildren(['snap','actionId'])") && rules.messages.$message['.validate'].includes("'result' && newData.hasChildren(['winner','reason','units','actionId'])"));
  check('rules permit heartbeat without actionId', rules.messages.$message['.validate'].includes("newData.child('t').val() === 'ping'") && rules.messages.$message.t['.validate'].includes("newData.val() === 'ping'"));
  check('refresh failure keeps the existing anonymous identity', htmlText.includes('if (firebaseAuth) {') && htmlText.includes('新規匿名アカウントを作るのは、認証情報がまったく無い最初の接続時だけ'));
  check('host cleanup waits after bye and pagehide leaves TTL cleanup', htmlText.includes('skipDeferredCleanup') && htmlText.includes('), 1000)') && htmlText.includes('endOnline(true, true, true)'));

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
