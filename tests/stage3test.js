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
  check('loopback protocol remains v2', app.proto() === 2);
  check('Firebase lobby protocol is v3 with two player and two spectator seats', h.firebaseProto() === 3
    && JSON.stringify(h.firebaseSeats()) === JSON.stringify(['p1', 'e1', 's1', 's2'])
    && JSON.stringify(h.firebasePlayerSeats()) === JSON.stringify(['p1', 'e1']));
  const roundId = 'r'.repeat(48).replace(/r/g, 'c');
  const nextRoundId = 'd'.repeat(48);
  const firebasePacket = (t, extra = {}) => ({
    v: 3, from: 'peer-p1', seat: 'p1', roundId, t, sentAt: Date.now(), ...extra
  });
  check('Firebase round IDs are fresh 48-hex values', /^[0-9a-f]{48}$/.test(h.firebaseRoundId())
    && h.firebaseRoundId() !== h.firebaseRoundId());
  check('Firebase v3 rejects missing or malformed seat and roundId',
    !h.validateFirebaseMessage(firebasePacket('ready', { seat: 'x1' }))
    && !h.validateFirebaseMessage(firebasePacket('ready', { roundId: 'bad' }))
    && !h.validateFirebaseMessage({ ...firebasePacket('ready'), from: '' }));
  check('Firebase v3 accepts lobby control packets only with a valid seat/from/roundId envelope',
    h.validateFirebaseMessage(firebasePacket('ready'))
    && h.validateFirebaseMessage(firebasePacket('lobbyState', { status: 'lobby', nextRoundId }))
    && h.validateFirebaseMessage(firebasePacket('rematchVote', { vote: true })));
  const normalizedLobby = h.normalizeLobbySettings({ terrain: 'not-a-map', wind: 'not-a-wind', turnsPerPlayer: 999, revision: -1 });
  check('host lobby settings are normalized to the supported terrain/wind/turn values',
    [10, 15, 20].includes(normalizedLobby.turnsPerPlayer) && normalizedLobby.revision >= 0
    && typeof normalizedLobby.terrain === 'string' && typeof normalizedLobby.wind === 'string');
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
  // 実機で「相手の行動と一致しない状態更新です（terrain.bridge）」が橋の無いほぼ全ての
  // ステージで再現した。RTDBはnullの値をキーごと保存しないため、bridge:nullで送った
  // スナップショットは受信側で bridge キー自体が欠落する(undefined)。normalize前は
  // JSON.stringify(undefined) !== JSON.stringify(null) で必ず不一致になっていた。
  // The selected map is random; construct the documented RTDB null shape
  // explicitly instead of assuming this particular battle has no bridge.
  const nullBridgeBaseline = { ...safeSnap, bridge: null };
  const missingBridgeSnapshot = JSON.parse(JSON.stringify(nullBridgeBaseline));
  delete missingBridgeSnapshot.bridge;
  check('Snapshot without a bridge key reproduces the RTDB-omitted-null shape', !('bridge' in missingBridgeSnapshot) && nullBridgeBaseline.bridge === null);
  // 実機:大橋ステージで必ず terrain.bridge で切れた。RTDBを往復するとオブジェクトの
  // キーがアルファベット順に並び替わって返るため、値が同じでも素の JSON.stringify では
  // 文字列が一致しない。生成側は {startX,endX,y,style,seed}、受信側は {endX,seed,...}。
  const bridgeSnap = JSON.parse(JSON.stringify(safeSnap));
  bridgeSnap.bridge = { startX: 600, endX: 780, y: 420, style: 'timber', seed: 123.456 };
  const bridgeReordered = JSON.parse(JSON.stringify(bridgeSnap));
  // RTDBが返す形を再現する(キーをソートして詰め直す)
  bridgeReordered.bridge = Object.fromEntries(Object.keys(bridgeSnap.bridge).sort().map(k => [k, bridgeSnap.bridge[k]]));
  check('the RTDB key reordering is actually reproduced by this test',
    JSON.stringify(bridgeReordered.bridge) !== JSON.stringify(bridgeSnap.bridge));
  check('a bridge that only differs by RTDB key order is treated as identical',
    h.stateSnapshotMismatchReason(bridgeReordered, bridgeSnap) === '');
  check('a bridge whose values really differ is still reported',
    h.stateSnapshotMismatchReason({ ...bridgeSnap, bridge: { ...bridgeSnap.bridge, endX: 900 } }, bridgeSnap) === 'terrain.bridge');
  const normalizedMissingBridge = h.normalizeFirebaseSnapshot(missingBridgeSnapshot);
  check('Firebase normalizes an RTDB-omitted bridge key back to null', normalizedMissingBridge.bridge === null);
  check('A normalized missing bridge now matches a local null-bridge baseline', h.stateSnapshotMismatchReason(normalizedMissingBridge, nullBridgeBaseline) === '');
  check('An un-normalized missing bridge previously mismatched (regression guard)', h.stateSnapshotMismatchReason(missingBridgeSnapshot, safeSnap) === 'terrain.bridge');
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
  // HPは通信の入口(hasSafeUnitSnapshot)で既に 0〜maxHp に検証済みなので、ここでの
  // 一致判定は改ざん対策として機能しない。実機で花火の多段ヒットにより「まだ生きて
  // いるのに0/140と誤表示され通信中断」した(2026-07-27)。stateは受理すれば
  // applySnapshotで正しい値へ上書きされるので、HPだけの相違ではもう拒否しない。
  const grossState = JSON.parse(JSON.stringify(safeSnap));
  grossState.units[0].hp = Math.max(0, grossState.units[0].hp - 50);
  check('A large HP-only divergence no longer disconnects the match (action-side authority)', h.stateSnapshotMatchesBaseline(grossState, safeSnap));
  check('Mismatch reason is empty for HP-only divergence, even when large', h.stateSnapshotMismatchReason(grossState, safeSnap) === '');
  // 実機:相手が撃つ前に移動すると必ず fuel.0 で切断された。移動そのものは通信しておらず、
  // fire は移動後の座標しか運ばないため、受信側は相手の燃料を減らしようがない。
  // 満タンから使い切りまでのどの差でも受理できること。
  const fuelDrift = JSON.parse(JSON.stringify(safeSnap));
  fuelDrift.units[0].fuel = 0;
  check('A fuel-only divergence no longer disconnects the match (movement is not replicated)',
    safeSnap.units[0].fuel > 24 && h.stateSnapshotMismatchReason(fuelDrift, safeSnap) === '');
  // 座標は依然として大きくズレたら拒否する。可変dtで動く要因が薄く、実機での
  // 誤検知報告もまだ無いため、こちらは従来どおりの安全側に倒す。
  const grossPosition = JSON.parse(JSON.stringify(safeSnap));
  grossPosition.units[0].x = grossPosition.units[0].x + 300;
  check('A large position divergence is still reported by name', h.stateSnapshotMismatchReason(grossPosition, safeSnap) === `x.0(${Math.round(safeSnap.units[0].x)}->${Math.round(grossPosition.units[0].x)})`);
  const terrainDrift = JSON.parse(JSON.stringify(safeSnap));
  terrainDrift.segments = terrainDrift.segments.slice();
  terrainDrift.segments[0] = [[0, 4]];
  check('Terrain divergence is reported by name, not folded into hp/x/y', h.stateSnapshotMismatchReason(terrainDrift, safeSnap) === 'terrain.segments');
  check('Firebase accepts old RTDB history with a finite server timestamp', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'ready', sentAt: Date.now() - 60 * 60 * 1000 }));
  check('Firebase heartbeat is a valid control packet without actionId', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'ping', sentAt: Date.now() }));
  const firstCommit = h.acceptPeerCommit(null, 'a'.repeat(64));
  const repeatCommit = h.acceptPeerCommit(firstCommit.hash, 'a'.repeat(64), false);
  // 準備完了を取り消してキャラを選び直せるようにしたので、公開前の差し替えは正当。
  // commit-reveal の意味は「相手の選択を見た後に変えられない」ことなので何も漏れない。
  const swappedBeforeReveal = h.acceptPeerCommit(firstCommit.hash, 'b'.repeat(64), false);
  const swappedAfterReveal = h.acceptPeerCommit(firstCommit.hash, 'b'.repeat(64), true);
  check('peer commit accepts a re-pick before reveal and rejects one after',
    firstCommit.accept && repeatCommit.duplicate && swappedBeforeReveal.accept && swappedAfterReveal.error);
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
  const validV3Fire = { ...validFire, v: 3, seat: 'e1', roundId };
  // 端末が古い版を掴んでいるのか本当に不具合なのかを切り分けるため、タイトルへ build 番号を出している。
  // sw.js のキャッシュ版数とずれると、その表示が当てにならなくなる。
  const readRepoFile = name => require('fs').readFileSync(require('path').join(__dirname, '..', name), 'utf8');
  const swText = readRepoFile('sw.js');
  const buildId = /const BUILD_ID = '([^']+)'/.exec(readRepoFile('index.html'));
  const cacheId = /const CACHE_VERSION = 'katamon-pwa-([^']+)'/.exec(swText);
  check('BUILD_ID matches the service worker cache version', !!buildId && !!cacheId && buildId[1] === cacheId[1],
    `${buildId && buildId[1]} vs ${cacheId && cacheId[1]}`);

  check('Firebase accepts a normal fire packet', h.validateFirebaseMessage(validFire));
  check('Firebase v3 fire keeps the v2 payload checks behind the required round envelope',
    h.validateFirebaseMessage(validV3Fire)
    && !h.validateFirebaseMessage({ ...validV3Fire, roundId: 'bad' })
    && !h.validateFirebaseMessage({ ...validV3Fire, seat: 's1', actionId: 'bad' }));
  const validV3State = { v: 3, from: 'peer', seat: 'e1', roundId, t: 'state', sentAt: Date.now(), actionId, unitId: 'e1', snap: safeSnap };
  const validV3Result = { v: 3, from: 'peer', seat: 'e1', roundId, t: 'result', sentAt: Date.now(), actionId, unitId: 'e1', winner: 'player', reason: '撃破', units: safeSnap.units.map(u => ({ id: u.id, hp: u.hp })) };
  check('Firebase v3 state/result require the action unit to match the sender seat',
    h.validateFirebaseMessage(validV3State) && h.validateFirebaseMessage(validV3Result)
    && h.firebasePacketSeatAllowed(validV3State) && h.firebasePacketSeatAllowed(validV3Result)
    && !h.validateFirebaseMessage({ ...validV3State, unitId: 'p1' })
    && !h.validateFirebaseMessage({ ...validV3Result, unitId: 'p1' })
    && !h.firebasePacketSeatAllowed({ ...validV3State, unitId: 'p1' })
    && !h.firebasePacketSeatAllowed({ ...validV3Result, unitId: 'p1' }));
  check('Firebase v3 accepts presence from every non-host seat and rejects host presence',
    ['e1', 's1', 's2'].every(seat => h.validateFirebaseMessage(firebasePacket('presence', { seat })) && h.firebasePacketSeatAllowed(firebasePacket('presence', { seat })))
    && !h.firebasePacketSeatAllowed(firebasePacket('presence', { seat: 'p1' })));
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
  h.setOnlineForLogTest({
    kind: 'firebase', phase: 'results', participantRole: 'player', role: 'host', seat: 'p1', clientId: 'self',
    slots: {}, settings: { terrain: 'grass', wind: 'calm', turns: 10 }, rematchVotes: {}, log: [], queue: [], transport: { close: () => { closed++; } }
  });
  app.exitOnlineFromMenu();
  check('menu exit closes loopback, while Firebase keeps the results lobby open',
    loopbackExit && !!app.onlineState() && app.onlineState().phase === 'results' && !app.hasSave() && closed === 1);

  const rulesText = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const htmlText = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const staleRoundOnline = {
    kind: 'firebase', clientId: 'self', currentRoundId: roundId, phase: 'lobby', participantRole: 'player',
    transport: { setRoundId: () => true, reconnect: () => true, close: () => {} }, rematchVotes: {}
  };
  h.setOnlineForLogTest(staleRoundOnline);
  h.receiveFirebaseForTest(firebasePacket('lobbyState', { roundId: nextRoundId, status: 'revealing' }));
  const staleRoundIgnored = staleRoundOnline.phase === 'lobby';
  h.receiveFirebaseForTest(firebasePacket('lobbyState', { status: 'revealing' }));
  check('Firebase ignores stale-round lobby packets but applies the current round', staleRoundIgnored && staleRoundOnline.phase === 'revealing');
  h.setOnlineForLogTest({ kind: 'firebase', participantRole: 'spectator', phase: 'playing', transport: { close: () => {} } });
  check('spectator input remains locked even while the current round is playing', app.inputLocked() === true);
  h.setOnlineForLogTest(null);
  check('lobby allocation blind-claims player then spectator seats without a pre-member room read',
    htmlText.includes("for (const candidate of ['e1', 's1', 's2'])")
    && htmlText.includes('firebaseClaimEmptySlot(`rooms/${code}/slots/${candidate}`, auth,')
    && htmlText.includes('// Rulesは非memberのreadを許可しない。e1→s1→s2を条件付きPUTで確保してから読む。'));
  check('Firebase slot claims use an atomic null_etag conditional PUT and release only a failed claimant seat',
    htmlText.includes("'if-match': 'null_etag'")
    && htmlText.includes('async function firebaseClaimEmptySlot')
    && htmlText.includes('if (response.status === 412) return false;')
    && htmlText.includes('rooms/${code}/slots/${seat}`, auth, { method: \'DELETE\' }'));
  // 実機で「合言葉で入室できない(認証が切れました)」が再現した。原因は
  // if-match(条件付きPUT)がETag照合のため、その位置の読み取り権限を要求すること。
  // 着席前のゲストは部屋を読めないので必ず401になっていた。本番RTDBで、
  // 読み取り権を持つホストの if-match PUT は成功し、ゲストのそれだけが401になることを実測済み。
  // 実機:観戦者が入ると対戦が「不正な送信席です」で切れた。観戦者も ping を送るのに
  // 席判定の末尾が「対戦者の ping 以外は全部拒否」になっており、bye も同じ穴に落ちていた。
  // 拒否は対戦を打ち切るので、FIREBASE_MESSAGE_TYPES の全種別が明示的に判定されている必要がある。
  // 改行はチェックアウト設定でCRLFになることがある。行末に依存した判定はしない。
  const seatAllowsSrc = /function firebasePacketSeatAllowed\(msg\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
  check('seat check no longer ends in a ping-only catch-all',
    !!seatAllowsSrc && !/return msg\.t === 'ping' && FIREBASE_PLAYER_SEATS/.test(seatAllowsSrc[0]) && /return false;\s*\}$/.test(seatAllowsSrc[0]));
  check('seat check lets any seat send the side-effect-free ping and bye',
    !!seatAllowsSrc && /msg\.t === 'ping' \|\| msg\.t === 'bye'\) return true;/.test(seatAllowsSrc[0]));
  check('every Firebase message type is decided explicitly by the seat check', (() => {
    const listed = /const FIREBASE_MESSAGE_TYPES = new Set\(\[([^\]]+)\]\)/.exec(htmlText);
    if (!listed || !seatAllowsSrc) return false;
    const types = listed[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
    return types.every(t => seatAllowsSrc[0].includes("'" + t + "'"));
  })());
  // 観戦者のpingで対戦相手の切断を見逃さないこと。
  check('peer liveness is refreshed only by player-seat traffic',
    htmlText.includes('if (FIREBASE_PLAYER_SEATS.includes(msg.seat)) noteFirebasePeerMessage();'));
  // 古いラウンドの正当なパケットで対戦を切らないこと(席判定より先に捨てる)。
  check('stale-round packets are dropped before the seat check',
    htmlText.indexOf('if (msg.roundId !== online.currentRoundId) return;') < htmlText.indexOf('if (!firebasePacketSeatAllowed(msg))'));
  // 拒否理由に種別と席を載せる。実機報告のログだけで原因を名指しできるようにする。
  check('seat rejections name the packet type and seat',
    htmlText.includes('`不正な送信席です（${msg.t}/${msg.seat}）`'));
  check('log copy falls back when navigator.clipboard is unavailable',
    htmlText.includes("document.execCommand('copy')") && htmlText.includes('navigator.share({ title: \'カタモン 通信ログ\''));
  // 実機:自分のターンに移動して落下死すると、撃っていないため localAction が無く、
  // 送信側は自分で接続を切り、相手は35秒後にタイムアウトしていた。移動は通信していないので
  // 相手はこの死を再現できない。「自分の負け」の宣言として必ず伝える必要がある。
  const syncResultSrc = /function netSyncResult\(reason\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
  check('a result with no preceding shot still gets an action id instead of killing the sender',
    !!syncResultSrc
    && syncResultSrc[0].includes('} else if (isFirebasePlayer()) {')
    && syncResultSrc[0].includes('actionId = secureNonce();')
    && syncResultSrc[0].includes('actionUnitId = online.seat;'));
  check('a peer conceding its own defeat is accepted even when the local sim disagrees',
    htmlText.includes('function firebaseResultConcedes(msg)')
    && htmlText.includes('const concedes = firebaseResultConcedes(msg);')
    && htmlText.includes('if (!concedes && (!online.remoteAction'));
  // 降参は通すが、勝利の主張は通さない。判定は「送信者の陣営 !== 勝者」でのみ真になる。
  check('a peer cannot claim its own victory through the concession path', (() => {
    const src = /function firebaseResultConcedes\(msg\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
    return !!src && /msg\.winner !== senderUnit\.team/.test(src[0]) && !/msg\.winner === senderUnit\.team/.test(src[0]);
  })());
  // 実機:降参の result は対応する fire を持たないため保留に積まれ、15秒後に
  // 「相手の行動通知が届かず接続を中断しました。」で切れていた。applyNetMessage の
  // 降参処理まで届く前に握り潰されていたのが原因。
  check('a conceding result bypasses the pending-terminal buffer that waits for a fire',
    htmlText.includes('if (!online.remoteAction && firebaseResultConcedes(msg)) {'));
  // 同じ理由の拒否が毎フレーム走り、リングバッファが同じ行で埋まって履歴が消えた。
  check('rejection is idempotent so the log keeps the first cause',
    htmlText.includes('if (online.protocolError) return;'));
  check('an ended connection is not re-evaluated every frame',
    htmlText.includes("if (online.phase === 'ended' || online.protocolError) return;"));
  check('a conceded result copies the declared HP so the loser is shown as defeated',
    htmlText.includes('if (concedes) {') && htmlText.includes('for (const u of msg.units) {'));
  // 移動の配信(2026-07-27)。移動を送っていなかったことが、燃料不一致・落下死が
  // 伝わらないという切断の共通の根だった。移動は戦略なので相手にも見せる。
  check('Firebase accepts a well-formed move packet',
    h.validateFirebaseMessage(firebasePacket('move', { unitId: 'p1', x: 720, fuel: 40 })));
  check('Firebase rejects a move packet with a bad payload',
    !h.validateFirebaseMessage(firebasePacket('move', { unitId: 'p1', x: NaN, fuel: 40 }))
    && !h.validateFirebaseMessage(firebasePacket('move', { unitId: 'p1', x: 720 }))
    && !h.validateFirebaseMessage(firebasePacket('move', { unitId: 'x9', x: 720, fuel: 40 })));
  check('move is bound to the sender seat like the other board-changing packets',
    !!seatAllowsSrc && /msg\.t === 'move' \|\| msg\.t === 'fire'/.test(seatAllowsSrc[0]));
  check('move is applied immediately instead of waiting behind cut-ins',
    htmlText.includes("'ping', 'move']"));
  check('move send rate is capped and skips sub-pixel jitter',
    htmlText.includes('const MOVE_SYNC_INTERVAL_SEC = 0.12;') && htmlText.includes('const MOVE_SYNC_MIN_DELTA'));
  check('the mover flushes its last position before firing',
    htmlText.includes('if (moveSyncPending) sendMoveUpdate(me);'));
  check('a remote unit walks to the received position instead of teleporting',
    htmlText.includes('function updateRemoteWalk(dt)') && htmlText.includes('u.netWalkTargetX') && htmlText.includes('followGroundOrFall(u)'));
  check('turn start clears stale walk targets and send state',
    htmlText.includes('resetMoveSync();') && htmlText.includes('for (const u of units) u.netWalkTargetX = null;'));
  check('slot claim falls back to a plain PUT when the conditional PUT is denied',
    htmlText.includes('if (response.status !== 401) throw new Error')
    && htmlText.includes('const plain = await fetch(url, { method: \'PUT\'')
    && htmlText.includes('if (plain.status === 401) return false;'));
  check('only the opposing player seat can supply commit/reveal data',
    htmlText.includes("if (msg.seat !== online.peerSeat) break;")
    && htmlText.includes("case 'commit':") && htmlText.includes("case 'reveal':"));
  check('host start waits for both ready players, then enters the reveal gate',
    htmlText.includes("!online.selfReady || !online.peerReady || !online.peerCommitted")
    && htmlText.includes("status: 'revealing'") && htmlText.includes('maybeRevealCharacter()'));
  // 相手が準備完了でもホストは設定を変えられる。変えられた側は準備完了を取り消して
  // モンスターを選び直せるので、一方的に決められた条件で始まることはない。
  check('the host can still change settings after the guest has readied',
    htmlText.includes("const canEdit = isFirebaseHost() && online.phase === 'lobby';")
    && htmlText.includes('[onlineTerrainEl, onlineWindEl, onlineTurnsEl].forEach(el => { if (el) el.disabled = !canEdit; });'));
  check('ready is a toggle that can be taken back while in the lobby',
    htmlText.includes('function setSelfNotReady()')
    && htmlText.includes("netSend({ t: 'ready', value: false });")
    && htmlText.includes("onlineReadyBtn.textContent = online.selfReady ? '準備完了を取り消す' : '準備完了';"));
  check('taking back ready clears the commit so a new character can be picked',
    htmlText.includes('online.selfCommit = null;') && htmlText.includes('online.selfRevealed = false;'));
  check('an un-ready packet is understood, and the old payload-less form still means ready',
    htmlText.includes('online.peerReady = msg.value !== false;')
    && h.validateFirebaseMessage(firebasePacket('ready', { value: false }))
    && h.validateFirebaseMessage(firebasePacket('ready')));
  check('the character picker is hidden until you are actually in a room',
    htmlText.includes('#onlineCharacter { display: none; }')
    && htmlText.includes('#onlineLobby.in-room #onlineCharacter { display: block; }'));
  check('both rematch votes reset a new round with automatic readiness',
    htmlText.includes('online.rematchVotes.p1 && online.rematchVotes.e1')
    && htmlText.includes('await resetFirebaseRound(true)') && htmlText.includes('const nextId = firebaseRoundId()')
    && htmlText.includes('resetLocalFirebaseRoundState(autoReady === true)')
    && htmlText.includes('if (autoReady && isFirebasePlayer()) commitOwnCharacter();'));
  check('either player can return to the lobby and clear readiness for a fresh choice',
    htmlText.includes("online.rematchVotes[online.seat] = false;")
    && htmlText.includes("netSend({ t: 'rematchVote', vote: false })")
    && htmlText.includes('await resetFirebaseRound(false)')
    && htmlText.includes("netSend({ t: 'lobbyState', status: 'lobby', nextRoundId: nextId, autoReady: autoReady === true })")
    && htmlText.includes("online.phase = 'lobby'; online.selfReady = false; online.peerReady = false;")
    && htmlText.includes('online.rematchVotes = {};'));
  check('Firebase result opens the results lobby instead of directly exiting the room',
    htmlText.includes("online.phase = 'results';") && htmlText.includes('openFirebaseResultsLobby()')
    && htmlText.includes('id="onlineRematch"') && htmlText.includes('このまま再戦')
    && htmlText.includes('id="onlineReturnLobby"') && htmlText.includes('ロビーへ戻る')
    && htmlText.includes('#onlineLobby.in-room.results #onlineRematch { display: block; }')
    && htmlText.includes('#onlineLobby.in-room.results #onlineReturnLobby { display: block; }')
    && htmlText.includes("online.phase !== 'lobby') { onlineLobbyStatus('退出はロビーでのみ行えます。')"));
  // v3ルールの実行可能な検証。tests/V3_RULES_SPEC.md のチェックリストをここへ落とし込んだ。
  // クライアントがv3で、デプロイ済みルールがv2のままだと部屋の作成すら通らず、
  // オンライン対戦が全滅する。両者が必ず同じ版であることをここで縛る。
  const rules = JSON.parse(rulesText).rules.rooms.$room;
  // 旧v2ルールが残っていると rounds/slots が無く、この下が軒並み TypeError で落ちる。
  // 「クライアントはv3、デプロイ済みルールはv2」が本番で一番危ない状態なので、
  // スタックトレースではなく理由の分かる失敗にして先へ進めない。
  const hasV3Shape = !!(rules && rules.rounds && rules.rounds.$roundId && rules.rounds.$roundId.messages && rules.slots && rules.slots.$seat);
  check('database.rules.json uses the v3 room shape (rounds/slots)', hasV3Shape);
  if (!hasV3Shape) {
    console.error('  !! database.rules.json is still the v2 schema. Migrate it before shipping the v3 client.');
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exitCode = 1;
    return;
  }
  const msg = rules.rounds.$roundId.messages.$message;
  const seat = rules.slots.$seat;
  const seats = ['p1', 'e1', 's1', 's2'];
  check('rules default deny at the root and constrain the room code',
    rulesText.includes('".read": false') && rulesText.includes('".write": false') && rules['.write'].includes('$room.matches'));
  check('rules accept only protocol 3 rooms',
    rules.protocol['.validate'] === 'newData.val() === 3' && rules['.write'].includes("child('protocol').val() === 3"));
  check('rules require the four named slots and reject unknown room children',
    rules.$other['.validate'] === false && ['settings', 'slots', 'round', 'rounds'].every(k => rules['.validate'].includes("'" + k + "'")));
  check('rules let a room be created only by its own host with p1 pre-claimed and no other seat',
    rules['.write'].includes("child('hostUid').val() === auth.uid")
    && rules['.write'].includes("child('slots').child('p1').child('uid').val() === auth.uid")
    && rules['.write'].includes("!newData.child('slots').child('e1').exists()"));
  check('rules restrict reads to seated members inside the expiry window',
    rules['.read'].includes("child('expiresAt').val() > now")
    && seats.every(x => rules['.read'].includes("child('" + x + "').child('uid').val() === auth.uid")));
  check('rules allow claiming only a vacant e1/s1/s2 seat while the room is in lobby',
    seat['.write'].includes('$seat.matches(/^(e1|s1|s2)$/)')
    && seat['.write'].includes("child('status').val() === 'lobby'")
    && seat['.write'].includes('!data.exists()'));
  check('rules forbid taking a second seat',
    seats.every(x => seat['.write'].includes("child('" + x + "').child('uid').val() !== auth.uid")));
  check('slot nodes are readable so a not-yet-seated guest can run the conditional PUT',
    typeof seat['.read'] === 'string' && seat['.read'].includes('auth != null') && seat['.read'].includes("child('expiresAt').val() > now"));
  check('rules pin a claimed seat to the caller and allow releasing only your own',
    seat.uid['.validate'].includes('newData.val() === auth.uid') && seat['.write'].includes("data.child('uid').val() === auth.uid"));
  check('rules let only p1 change settings, and only while in lobby',
    rules.settings['.write'].includes("child('p1').child('uid').val() === auth.uid")
    && rules.settings['.write'].includes("child('status').val() === 'lobby'"));
  check('rules bound the settings payload to supported values',
    rules.settings.$other['.validate'] === false && rules.settings.turnsPerPlayer['.validate'].includes('10')
    && rules.settings.terrain['.validate'].includes('tieredBasin') && rules.settings.wind['.validate'].includes('calm'));
  check('rules let only p1 change round status or open the next round',
    rules.round['.write'].includes("child('p1').child('uid').val() === auth.uid")
    && rules.rounds.$roundId['.write'].includes("child('p1').child('uid').val() === auth.uid")
    && rules.rounds.$roundId['.write'].includes('!data.exists()'));
  check('rules constrain the round id and status enum',
    rules.round.id['.validate'].includes('{48}')
    && ['lobby', 'revealing', 'playing', 'results'].every(x => rules.round.status['.validate'].includes("'" + x + "'")));
  check('rules keep the per-round message log append-only', msg['.write'].includes('!data.exists()'));
  check('rules bind every packet to its sender, its claimed seat and the current round',
    msg['.write'].includes("child('from').val() === auth.uid")
    && msg['.write'].includes("child(newData.child('seat').val()).child('uid').val() === auth.uid")
    && msg['.write'].includes("child('round').child('id').val() === $roundId"));
  check('rules stop a packet being written into another round',
    msg['.validate'].includes("child('roundId').val() === $roundId") && msg.roundId['.validate'].includes('{48}'));
  check('rules require v3 plus the seat/roundId envelope on every packet',
    msg['.validate'].includes("'v','t','from','seat','roundId','sentAt'")
    && msg.v['.validate'] === 'newData.val() === 3'
    && seats.every(x => msg.seat['.validate'].includes("'" + x + "'")));
  check('rules keep spectators read-only for game-affecting packets',
    msg['.write'].includes("newData.child('seat').val() === 'p1' || newData.child('seat').val() === 'e1' || newData.child('t').val() === 'presence'"));
  check('rules reserve host-only packets for p1',
    msg['.write'].includes("newData.child('t').val() !== 'settings'") && msg['.write'].includes("newData.child('seat').val() === 'p1'"));
  check('rules retain actionId and payload limits for fire/state/result',
    msg.$other['.validate'] === false && msg.actionId['.validate'].includes('{48}')
    && msg['.validate'].includes("'fire' && newData.hasChildren(['unitId','x','y','anchor','vx0','vy0','useSpecial','actionId'])")
    && msg['.validate'].includes("'state' && newData.hasChildren(['snap','actionId','unitId'])")
    && msg['.validate'].includes("'result' && newData.hasChildren(['winner','reason','units','actionId','unitId'])"));
  check('rules force unitId to match the sender seat',
    msg.unitId['.validate'].includes("newData.val() === newData.parent().child('seat').val()"));
  check('rules bound the client timestamp on every packet',
    msg['.validate'].includes('now - 120000') && msg.sentAt['.validate'].includes('now + 120000'));
  check('rules permit heartbeat and presence without actionId',
    msg['.validate'].includes("newData.child('t').val() === 'ping'")
    && msg.t['.validate'].includes("newData.val() === 'ping'") && msg.t['.validate'].includes("newData.val() === 'presence'"));
  check('rules let only the two players publish the spectator snapshot for the current round',
    rules.rounds.$roundId.latestSnapshot['.write'].includes("child('round').child('id').val() === $roundId")
    && rules.rounds.$roundId.latestSnapshot['.write'].includes("child('e1').child('uid').val() === auth.uid")
    && !rules.rounds.$roundId.latestSnapshot['.write'].includes("child('s1')"));
  check('rules let only the host delete the room',
    rules['.write'].includes("data.exists() && !newData.exists() && data.child('hostUid').val() === auth.uid"));
  // クライアントが送る種別をルールが1つでも知らないと、その送信で401になり、
  // 送信キューが停止して対戦が即死する(move を足した時に実際に踏んだ)。
  // 種別の追加漏れをここで落とす。
  check('every client message type is whitelisted by the deployed rules', (() => {
    const listed = /const FIREBASE_MESSAGE_TYPES = new Set\(\[([^\]]+)\]\)/.exec(htmlText);
    if (!listed) return false;
    const types = listed[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
    const missing = types.filter(t => !msg.t['.validate'].includes(`newData.val() === '${t}'`));
    if (missing.length) console.error('    rules are missing: ' + missing.join(', '));
    return missing.length === 0;
  })());
  // クライアントの protocol と、ルールが受け付ける protocol は必ず一致させる。
  // ここがずれると本番で「部屋を作れません」から先へ一切進めなくなる。
  const clientProto = /const FIREBASE_PROTO_VERSION = (\d+);/.exec(htmlText);
  check('deployed rules protocol matches the client FIREBASE_PROTO_VERSION',
    !!clientProto && rules.protocol['.validate'] === 'newData.val() === ' + clientProto[1]);

  check('refresh failure keeps the existing anonymous identity', htmlText.includes('if (firebaseAuth) {') && htmlText.includes('新規匿名アカウントを作るのは、認証情報がまったく無い最初の接続時だけ'));
  check('host cleanup waits after bye and pagehide leaves TTL cleanup', htmlText.includes('skipDeferredCleanup') && htmlText.includes('), 1000)') && htmlText.includes('endOnline(true, true, true)'));

  // 通信ログ(2026-07-27、実機報告を追跡できるようにする要望への対応)。
  // 拒否理由だけでは切り分けきれない事態が続いたため、直前のやり取りを丸ごと
  // localStorageへ残し、エラー画面からコピーできるようにした。
  const fakeOnline = { room: 'A2BC3DEF', role: 'host', seat: 'p1', phase: 'playing', protocolError: '', log: [], transport: { close: () => {} }, };
  h.setOnlineForLogTest(fakeOnline);
  for (let i = 0; i < h.onlineLogMax() + 5; i++) h.logOnlineEvent({ type: 'fire', unitId: 'p1' });
  check('Online event log is capped at the documented ring-buffer size', fakeOnline.log.length === h.onlineLogMax());
  check('Ring buffer drops the oldest entries, not the newest', fakeOnline.log[fakeOnline.log.length - 1].type === 'fire');
  h.persistOnlineLog();
  const persisted = JSON.parse(globalThis.localStorage.getItem(h.onlineLogKey()) || 'null');
  check('Persisted log round-trips room/role and the capped entries', persisted && persisted.room === 'A2BC3DEF' && persisted.role === 'host' && persisted.log.length === h.onlineLogMax());
  h.setOnlineForLogTest(null);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
