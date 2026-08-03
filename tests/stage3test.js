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
  // --- ロビーの心拍(Stage 4-1)。対戦中の判定とは別系統で、切断は一切しない ---
  const lobbyLiveness = { clockMs: 0, pingVisibleMs: 0, checkedAt: 1000 };
  const lobbyHidden = h.advanceFirebaseLobbyLiveness(lobbyLiveness, 31000, true);
  check('lobby heartbeat clock does not advance while hidden', !lobbyHidden.pingDue && lobbyLiveness.clockMs === 0);
  const lobbyBeforePing = h.advanceFirebaseLobbyLiveness(lobbyLiveness, 45900, false);
  const lobbyPing = h.advanceFirebaseLobbyLiveness(lobbyLiveness, 46100, false);
  check('lobby heartbeat pings after 15s of visible time', !lobbyBeforePing.pingDue && lobbyPing.pingDue && lobbyLiveness.clockMs === 15100);
  check('a seat heard from recently is not stale', !h.firebaseSeatStale(44000, 1000));
  check('a seat silent for 45s of visible time is stale', h.firebaseSeatStale(46000, 1000));
  // 未記録の席を stale 扱いすると、入室直後や後から来た人がいきなり応答なしに見える
  check('a seat with no recorded sighting is never stale', !h.firebaseSeatStale(999999, undefined));
  const lobbyThresholds = [h.advanceFirebaseLobbyLiveness({ clockMs: 0, pingVisibleMs: 0, checkedAt: 0 }, 1, false)];
  check('lobby heartbeat never reports a timeout (display only)', lobbyThresholds.every(r => !('timedOut' in r)));
  // 実機で2ターン目まで進んだ試合が切れた時に「開始できません」と出ていた
  check('a disconnect after the match started does not say it failed to start', h.onlineErrorTitle(true) === '対戦を中断しました');
  check('a failure before the match started still says it could not start', h.onlineErrorTitle(false) === 'オンライン対戦を開始できません');
  // 部屋のリース(Stage 4-2)。更新間隔が期限に近づくと、通信が一度ぐらついただけで
  // 対戦中の部屋が期限切れになり、試合が死ぬ。4回ぶんの猶予をここで固定しておく。
  check('the room lease is renewed far more often than it expires', h.roomLeaseRenewMs() * 4 <= h.roomTtlMs());
  // 期限を延ばしすぎると、放置された簡単対戦がまたその間ずっと詰む
  check('the room lease stays short enough to free an abandoned room', h.roomTtlMs() <= 15 * 60 * 1000);
  check('the room lease still fits the ceiling the rules enforce', h.roomTtlMs() <= 7200000);
  // ダメージは距離に対してなだらかであること。v63で帯ごとの固定値にしたところ、
  // 足元撃ち(中心から16〜25px)がちょうど直撃境界の20pxをまたぎ、立ち位置次第で
  // 毎回45と毎回35に分かれて対戦が不公平になった(2026-07-28に実測)。
  const dmg = d => h.computeDamage(d, 1, 1);
  let worstStep = 0;
  for (let d = 1; d <= 100; d++) worstStep = Math.max(worstStep, Math.abs(dmg(d) - dmg(d - 1)));
  check('damage never jumps by a cliff between neighbouring distances', worstStep <= 3, `worst=${worstStep}`);
  // 足元撃ちが起きる帯。ここが割れると同じ状況の撃ち合いで差がつく
  check('a shot at your own feet does not swing wildly', Math.abs(dmg(16) - dmg(25)) <= 4,
    `${dmg(16)} vs ${dmg(25)}`);
  check('a direct hit is still the maximum', dmg(0) === 45 && dmg(0) >= dmg(21));
  check('damage still falls off with distance', dmg(1) > dmg(30) && dmg(30) > dmg(60));
  check('damage is zero outside the blast radius', dmg(101) === 0);
  // 相手の弾の被弾は、こちらの見積もりではなく届いた権威ある値を出す。
  // 見積もりを先に出していたため、実機で数字が後から10動いていた(2026-07-28)。
  h.setOnlineForLogTest({ kind: 'firebase', log: [], pendingRemoteDamage: null });
  h.clearDamageTexts();
  h.setHp('p1', 100);
  h.noteRemoteDamageBaseline();   // 炸裂の直前(相手の弾)
  h.setHp('p1', 65);              // こちらの見積もりで35減らした
  h.setHp('p1', 55);              // 権威ある値が届いて45まで減った
  h.flushRemoteDamageText();
  check('the popup shows the authoritative damage, not the local guess',
    h.damageTexts().join(',') === '-45', h.damageTexts().join(','));
  // 二重に出さないこと。state の後に result が続いても数字は1回だけ
  h.clearDamageTexts();
  h.flushRemoteDamageText();
  check('the popup is not emitted twice for one action', h.damageTexts().length === 0);
  // 権威ある値が「減っていない」なら何も出さない(0ダメージのポップを出さない)
  h.noteRemoteDamageBaseline();
  h.flushRemoteDamageText();
  check('no popup when the authoritative value took nothing off', h.damageTexts().length === 0);
  h.setOnlineForLogTest(null);
  h.clearDamageTexts();
  // 行き止まりを作らない。キャラ確認の検証で止まると phase は 'revealing' のままで、
  // 以前はそこから退出も再戦もできず完全に詰んでいた(2026-07-28に実機で発生)。
  check('you can leave while the character check is still verifying', h.canLeaveFirebaseLobby('revealing', false));
  check('you can leave once something has gone wrong', h.canLeaveFirebaseLobby('revealing', true));
  check('you can still leave from the lobby and the result screen',
    h.canLeaveFirebaseLobby('lobby', false) && h.canLeaveFirebaseLobby('results', false));
  check('leaving mid-match is left to the menu', !h.canLeaveFirebaseLobby('playing', false));
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
  const validFire = { v: 2, from: 'peer', t: 'fire', sentAt: Date.now(), actionId, unitId: 'e1', x: 1224, y: 512, anchor: { x: 1224, y: 512 }, vx0: -320, vy0: -460, useSpecial: false, useJump: false };
  const validV3Fire = { ...validFire, v: 3, seat: 'e1', roundId };
  // 端末が古い版を掴んでいるのか本当に不具合なのかを切り分けるため、タイトルへ build 番号を出している。
  // sw.js のキャッシュ版数とずれると、その表示が当てにならなくなる。
  const readRepoFile = name => require('fs').readFileSync(require('path').join(__dirname, '..', name), 'utf8');
  const swText = readRepoFile('sw.js');
  const buildId = /const BUILD_ID = '([^']+)'/.exec(readRepoFile('index.html'));
  const cacheId = /const CACHE_VERSION = 'katamon-pwa-([^']+)'/.exec(swText);
  check('BUILD_ID matches the service worker cache version', !!buildId && !!cacheId && buildId[1] === cacheId[1],
    `${buildId && buildId[1]} vs ${cacheId && cacheId[1]}`);

  // 音源はURL末尾の ?v=N がキャッシュの鍵になる。同じURLのまま中身を差し替えると、
  // ブラウザは保存済みの古い曲を鳴らし続ける。v98で bonus-bgm-2 をCeltic版へ替えた際に
  // ?v=1 のままだったため、2曲目に旧Hard Rock版が鳴る不具合が実機で出た。
  // 中身のハッシュとURLを一緒に固定し、片方だけ変えたらここで気づけるようにする。
  // 音源を差し替える時は、このハッシュと index.html の ?v=N を必ず両方更新すること。
  const crypto = require('crypto');
  const fileHash = name => crypto.createHash('md5')
    .update(require('fs').readFileSync(require('path').join(__dirname, '..', name)))
    .digest('hex').slice(0, 12);
  const htmlForAudio = readRepoFile('index.html');
  const BONUS_TRACK_PINS = [
    { file: 'assets/bonus-bgm-1.mp3', hash: '49a1b4b1adff', url: 'assets/bonus-bgm-1.mp3?v=1' },
    { file: 'assets/bonus-bgm-2.mp3', hash: '1014f338877a', url: 'assets/bonus-bgm-2.mp3?v=2' },
    { file: 'assets/bonus-bgm-3.mp3', hash: 'f38aa093c2c7', url: 'assets/bonus-bgm-3.mp3?v=1' },
    { file: 'assets/bonus-bgm-4.mp3', hash: 'a59c297a09ee', url: 'assets/bonus-bgm-4.mp3?v=1' }
  ];
  const pinNg = [];
  for (const pin of BONUS_TRACK_PINS) {
    const actual = fileHash(pin.file);
    if (actual !== pin.hash) pinNg.push(`${pin.file} の中身が変わっている(${actual})のに ?v= が据え置き`);
    if (!htmlForAudio.includes(`'${pin.url}'`)) pinNg.push(`${pin.url} が index.html に無い`);
  }
  check('bonus BGM files and their cache-busting URLs stay in sync',
    pinNg.length === 0, pinNg.join(' / '));
  const bonusUrls = (htmlForAudio.match(/assets\/bonus-bgm-\d+\.mp3\?v=\d+/g) || []);
  check('every bonus BGM URL is unique', new Set(bonusUrls).size === bonusUrls.length, bonusUrls.join(', '));

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
    kind: 'firebase', phase: 'starting', participantRole: 'player', role: 'host', seat: 'p1', clientId: 'self', room: 'A2BC3DEF', auth: { idToken: 'test' }, currentRoundId: roundId,
    slots: {}, settings: { terrain: 'grass', wind: 'calm', turns: 10 }, rematchVotes: {}, log: [], queue: [], transport: { send: () => Promise.resolve(true), close: () => { closed++; } }
  });
  app.exitOnlineFromMenu();
  check('the title button exits both loopback and a stuck Firebase match',
    loopbackExit && !app.onlineState() && app.state().gamePhase === 'title' && !app.hasSave() && closed === 2);
  const rulesText = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  // Windowsのcore.autocrlf=trueで取り出すと作業ツリーがCRLFになる。
  // 以降の includes() は改行を含む文字列を直に比べるので、ここでLFへ揃えておく。
  // (揃えないと、コードは正しいのにチェックアウトの仕方だけで落ちる)
  const htmlText = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  check('title offers an in-game force-update action that refreshes the worker and clears old app caches',
    htmlText.includes("const titleUpdateBtn = { x: VW / 2, y: 906, w: 250, h: 30 };")
    && htmlText.includes('async function forceGameUpdate()')
    && htmlText.includes('await registration.update();')
    && htmlText.includes("key.startsWith('katamon-pwa-')")
    && htmlText.includes("latestUrl.searchParams.set('refresh', Date.now().toString());"));
  const firebaseLeaveStart = htmlText.indexOf('function leaveFirebaseLobby()');
  const firebaseLeaveEnd = htmlText.indexOf('function beginOnline(', firebaseLeaveStart);
  const firebaseLeaveSrc = firebaseLeaveStart >= 0 && firebaseLeaveEnd > firebaseLeaveStart
    ? htmlText.slice(firebaseLeaveStart, firebaseLeaveEnd) : '';
  // v56: BGMはディレクター(syncBgm)に一元化された。leaveFirebaseLobbyはgamePhaseをtitleへ
  // 戻してからsyncBgm()を呼ぶだけになり、stopStageBgm/startTitleBgmを直接は呼ばない。
  // 「ロビー退出でステージ曲が止まりタイトル曲へ戻る」という検査の意図はsyncBgm呼び出しの
  // 有無と、直接呼び出しが残っていないことの両方で保つ。
  check('leaving an online lobby routes back to the title BGM through the syncBgm director',
    firebaseLeaveSrc.includes("gamePhase = 'title'; syncBgm();")
    && !firebaseLeaveSrc.includes('stopStageBgm(') && !firebaseLeaveSrc.includes('startTitleBgm('));
  // R4(2026-07-27):通信不調でも必ず退出できるよう、ローカル遷移(endOnline/gamePhase/syncBgm)を
  // 先に済ませてからFirebaseの削除を投げ捨てで送る(要件6)。await不通で退出できない旧実装の再発防止。
  check('leaving a Firebase lobby runs the local transition before firing the (fire-and-forget) delete',
    firebaseLeaveSrc.includes('endOnline(false, false);')
    && firebaseLeaveSrc.indexOf('endOnline(false, false);') < firebaseLeaveSrc.indexOf('firebaseRequest(')
    && firebaseLeaveSrc.includes('cleanup.catch(() => {});')
    && !/await firebaseRequest/.test(firebaseLeaveSrc));
  // ネイティブconfirm()はロビー退出を通信不調でなくても止めてしまう(ダイアログが出た端末依存の挙動)。
  // 画面内の2択(「退出する」/「やめる」)に置き換え、5秒操作が無ければ自動で戻すことを固定する。
  check('the native confirm() dialog is replaced by an in-screen two-choice confirm with an auto-revert timer',
    !htmlText.includes("confirm('このロビーを退出しますか？')")
    && htmlText.includes('function beginLeaveFirebaseLobbyConfirm()')
    && htmlText.includes('function cancelLeaveFirebaseLobbyConfirm()')
    && htmlText.includes("onlineLeaveConfirmTimer = setTimeout(cancelLeaveFirebaseLobbyConfirm, 5000);")
    && htmlText.includes("onlineLobbyEl.classList.add('leave-confirm');")
    && htmlText.includes("onlineLobbyEl.classList.remove('leave-confirm');"));
  // BGM再生/停止の一元化そのものを固定する。playStageBgm/stopStageBgm/startTitleBgm/stopTitleBgm/
  // playRoomBgm/stopRoomBgmは「関数定義」と「syncBgm内部からの呼び出し」だけに出現するはずで、
  // 遷移箇所が増えて誰かが直接呼び出しを書き足すとこの出現回数が変わってテストが落ちる
  // (v47の二重BGM再発防止。room曲もv57で同じ方式に乗せた)。
  const countOccurrences = (text, needle) => text.split(needle).length - 1;
  check('BGM play/stop calls stay centralized in syncBgm (definition + internal use only, no stray direct calls)',
    countOccurrences(htmlText, 'playStageBgm(') === 3   // 定義 + syncBgm内2箇所(同曲継続時の頭出し/曲切替時)
    && countOccurrences(htmlText, 'stopStageBgm(') === 2   // 定義 + syncBgm内1箇所
    && countOccurrences(htmlText, 'startTitleBgm(') === 2   // 定義 + syncBgm内1箇所
    && countOccurrences(htmlText, 'stopTitleBgm(') === 2   // 定義 + syncBgm内1箇所
    && countOccurrences(htmlText, 'playRoomBgm(') === 2   // 定義 + syncBgm内1箇所
    && countOccurrences(htmlText, 'stopRoomBgm(') === 2   // 定義 + syncBgm内1箇所
    && !htmlText.includes('refreshBgmPlayback')   // 旧関数は syncBgm に統合され消えている
    && htmlText.includes('function syncBgm(opts)'));
  // ルーム曲の判定はbattle判定より先に評価されなければならない(決着後「ロビーへ戻る」で開く
  // ロビーはgamePhaseがbattleのままのため。DESIGN_2026-07-27_ROOM_SCENE.md §3)。
  // 加えて、双方「このまま再戦」の自動進行中(online.autoStartNextRound)はルーム曲を挟まない
  // 除外条件が入っていることも固定する(入っていないとreveal中の数秒だけルーム曲が挟まる)。
  const desiredBgmStart = htmlText.indexOf('function desiredBgm()');
  const desiredBgmEnd = htmlText.indexOf('function currentBgmKind()', desiredBgmStart);
  const desiredBgmSrc = desiredBgmStart >= 0 && desiredBgmEnd > desiredBgmStart
    ? htmlText.slice(desiredBgmStart, desiredBgmEnd) : '';
  const roomReturnIdx = desiredBgmSrc.indexOf("return 'room'");
  const battleReturnIdx = desiredBgmSrc.indexOf("return 'stage'");
  check("desiredBgm evaluates the room screen before the battle phase, and skips room BGM during autoStartNextRound",
    roomReturnIdx >= 0 && battleReturnIdx >= 0 && roomReturnIdx < battleReturnIdx
    && desiredBgmSrc.includes('online.autoStartNextRound'));
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
  check('lobby allocation blind-claims the requested seats without a pre-member room read',
    htmlText.includes("async function claimFirebaseRoom(code, seatOrder = ['e1', 's1', 's2'])")
    && htmlText.includes('for (const candidate of seatOrder)')
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
  // 降参の決着が届くまでに関門が3つある。1つでも塞がっていると対戦が詰む。
  // 実際、receiveFirebaseTerminal と case 'result' を直しても firebaseFlowAllows を
  // 見落としており、実機で「不正な通信順序です（result.flow）」で切れた。
  // 3箇所すべてが同じ判定関数を通ることを縛る。
  check('all three gates for a conceding result consult the same helper', (() => {
    const decl = (htmlText.match(/function firebaseResultConcedes\(msg\)/g) || []).length;
    const uses = (htmlText.match(/firebaseResultConcedes\(msg\)/g) || []).length;
    // 定義1 + 参照3(flow / terminal buffer / result 適用)
    return decl === 1 && uses >= 4;
  })());
  check('the flow gate lets a conceding result through without a matching fire',
    htmlText.includes('if (firebaseResultConcedes(msg)) return true;'));
  // 関門を素通しにしたせいで「自分の勝ち」まで通るようになっていないこと。
  check('the flow gate still demands an action match for a non-conceding terminal', (() => {
    const src = /function firebaseFlowAllows\(msg, flow\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
    return !!src && src[0].includes("if (msg.t === 'state' || msg.t === 'result') return !!flow && firebaseActionMatches(msg, flow.remoteAction);");
  })());
  check('a conceding result bypasses the pending-terminal buffer that waits for a fire',
    htmlText.includes('if (!online.remoteAction && firebaseResultConcedes(msg)) {'));
  // 同じ理由の拒否が毎フレーム走り、リングバッファが同じ行で埋まって履歴が消えた。
  check('rejection is idempotent so the log keeps the first cause',
    htmlText.includes('if (online.protocolError) return;'));
  check('an ended connection is not re-evaluated every frame',
    htmlText.includes("if (online.phase === 'ended' || online.protocolError) return;"));
  // R4(2026-07-27):protocolErrorが立っている間、ルーム画面のステータス行を赤系にしてCanvas側の
  // エラー表示と一貫させる。クラスの付け外しは既存のonlineLobbyStatus呼び出し経路に乗せ、
  // 新しい呼び出し網は作らない(rejectFirebaseMessage等、既存の呼び出しがそのままトリガーになる)。
  check('the room status line turns red while a protocol error is active, without adding a new call site',
    htmlText.includes('#onlineLobby.error #onlineLobbyStatus { color: #f06060; }')
    && htmlText.includes("onlineLobbyEl.classList.toggle('error', !!(online && online.protocolError));"));
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
    htmlText.includes("'ping', 'move']")
    && htmlText.includes("|| msg.t === 'ping' || msg.t === 'move') {\n        applyNetMessage(msg);"));
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
  // canEdit(選択肢の有効/無効)だけ直して送信側のガードを直し忘れると、
  // 「選べるのに送られない」状態になる。実機で地形も風も反映されなかった原因がこれ。
  check('the settings sender uses the same gate as the enabled state',
    htmlText.includes("if (!isFirebaseHost() || online.phase !== 'lobby') return;")
    && !htmlText.includes("online.phase !== 'lobby' || online.selfReady || online.peerReady) return;"));
  // rollWind がフリーモードしか見ておらず、ロビーで風を選んでもランダム風のままだった。
  check('a fixed wind is resolved in one place for both free mode and the online lobby',
    htmlText.includes('function activeFixedWind()')
    && htmlText.includes("if (online && online.kind === 'firebase' && online.settings) {")
    && htmlText.includes('const selected = activeFixedWind();')
    && htmlText.includes('const freeWind = activeFixedWind();'));
  check('rollWind no longer branches on free mode alone', (() => {
    const src = /function rollWind\(\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
    return !!src && !src[0].includes("battleMode === 'free'") && src[0].includes('activeFixedWind()');
  })());
  // 決着後の画面に準備フェーズの文言が残っていた。
  // 決着した瞬間にロビーを開くと勝敗の演出が全部隠れ、実機で「双方とも勝敗が
  // 表示されない」状態になった。演出が終わってから開き、勝敗もロビーに出す。
  check('the results lobby waits for the match-end presentation to finish',
    htmlText.includes('function scheduleFirebaseResultsLobby()')
    && htmlText.includes('online.resultsLobbyPending = true;')
    && htmlText.includes('if (matchOver && matchEndPause > 0) return;')
    && htmlText.includes('updateFirebaseResultsLobby();'));
  check('victory and defeat sounds wait for the result screen instead of the finishing-move banner',
    htmlText.includes('if (before > 0 && matchEndPause === 0) {')
    && !htmlText.includes('if (before > MATCH_END_BANNER && matchEndPause <= MATCH_END_BANNER) {'));
  check('nothing opens the results lobby immediately on the decisive packet',
    !/beginMatchEnd\(msg\.reason\); openFirebaseResultsLobby\(\);/.test(htmlText)
    && (htmlText.match(/scheduleFirebaseResultsLobby\(\);/g) || []).length >= 4);
  check('the results lobby states the outcome and the finishing move',
    htmlText.includes('localWon() ? `勝利! （${matchEndReason')
    && htmlText.includes('敗北… （${matchEndReason')
    && htmlText.includes("online.participantRole === 'spectator' ? `決着:${matchEndReason"));
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
  // 合言葉が大きい文字と入力欄の2箇所に出て場所を取っていた。入室後は1行だけにし、
  // コピーは文字の真横の小さなアイコンにする。
  check('quick play uses one shared room while passcodes stay behind an explicit option',
    htmlText.includes("const QUICK_MATCH_ROOM = 'KATAMN22';")
    && htmlText.includes('async function joinQuickFirebaseRoom()')
    && htmlText.includes('id="onlineQuick"')
    && htmlText.includes('id="onlineCodeToggle"')
    && htmlText.includes('#onlineLobby.code-entry:not(.in-room) #onlineRoomInput'));
  check('the room code is shown once, with a small copy icon beside it',
    htmlText.includes('<div id="onlineRoomCodeRow">')
    && htmlText.includes('#onlineLobby.in-room #onlineRoomInput, #onlineLobby.in-room #onlineRoomHint { display: none; }')
    && htmlText.includes('#onlineLobby.in-room #onlineCopy { display: flex; }'));
  check('the copy button no longer occupies a full row in the button grid',
    !htmlText.includes('#onlineCopy { grid-column: span 2; display: none; }')
    && !htmlText.includes(">合言葉をコピー / 共有</button>"));
  check('copy visibility is left to CSS instead of inline styles that would fight it',
    !htmlText.includes("onlineCopyBtn.style.display"));
  // ルームにいるのが誰なのか分かるよう、ランキングと同じ表示名を出す。
  check('the ranking name is broadcast with presence and lobbyState',
    htmlText.includes("netSend({ t: 'presence', name: localPlayerName() })")
    && htmlText.includes("settings: online.settings, name: localPlayerName() }"));
  check('received names are remembered per seat and shown in the roster',
    htmlText.includes('function rememberFirebaseName(msg)')
    && htmlText.includes('function firebaseSeatName(seat)')
    && htmlText.includes("const who = occupied ? (name || '参加中') : '空席';"));
  // R4(2026-07-27):席ボードを1行=1テキストから行カード(DOM)へ組み直した。名前は相手端末の
  // ユーザー入力なので、innerHTMLへの文字列連結は禁止し、createElement + textContent だけで組む。
  const seatRowStart = htmlText.indexOf('function buildFirebaseSeatRow(seat, slots)');
  const seatRowEnd = htmlText.indexOf('function renderFirebaseLobby()', seatRowStart);
  const seatRowSrc = seatRowStart >= 0 && seatRowEnd > seatRowStart
    ? htmlText.slice(seatRowStart, seatRowEnd) : '';
  check('the seat board is assembled with createElement/textContent only, never innerHTML',
    seatRowSrc.length > 0
    && !seatRowSrc.includes('innerHTML')
    && (seatRowSrc.match(/document\.createElement\('span'\)/g) || []).length >= 3
    && (seatRowSrc.match(/\.textContent = /g) || []).length >= 3);
  check('the seat board renders four seat rows by clearing and re-appending, not string concatenation',
    htmlText.includes('while (onlineSlotsEl.firstChild) onlineSlotsEl.removeChild(onlineSlotsEl.firstChild);')
    && htmlText.includes('FIREBASE_SEATS.forEach(seat => onlineSlotsEl.appendChild(buildFirebaseSeatRow(seat, slots)));'));
  check('each seat row marks occupied/empty with a filled/hollow dot and colors it by seat kind (brass for players, gray for spectators)',
    seatRowSrc.includes("mark.textContent = occupied ? '●' : '○';")
    && htmlText.includes('.onlineSeatRow.occupied.player .seatMark { color: #ffd24a; }')
    && htmlText.includes('.onlineSeatRow.occupied.spectator .seatMark { color: #9fb0bd; }'));
  check("the local player's own row gets a badge and a highlighted background",
    seatRowSrc.includes("badge.textContent = 'あなた';")
    && htmlText.includes('.onlineSeatRow.mine { background: rgba(255,210,74,.14); }'));
  check('ready state is shown only for occupied player seats during the lobby phase',
    seatRowSrc.includes("if (isPlayerSeat && occupied && online.phase === 'lobby') {")
    && seatRowSrc.includes("state.textContent = ready ? '準備完了 ✓' : '選択中…';"));
  // Stage 4境界の確認:ロビー中はupdateFirebasePeerLiveness()がphase!=='playing'で早期returnするため
  // peerLivenessは対戦中しか進まない。ロビー中の心拍送信は無いので、応答なしバッジは作らない(R4は
  // 在席/空席の●/○表示までに留める)。この境界を壊さず維持できていることを固定する。
  check('peer liveness only advances during battle, so the lobby has no periodic heartbeat to base a stale badge on',
    htmlText.includes("function updateFirebasePeerLiveness() {\n    if (!online || online.kind !== 'firebase' || online.phase !== 'playing' || !online.peerLiveness) return;"));
  check('a name is accepted when present and rejected when over the limit',
    h.validateFirebaseMessage(firebasePacket('presence', { name: 'ふつサ' }))
    && h.validateFirebaseMessage(firebasePacket('presence'))
    && !h.validateFirebaseMessage(firebasePacket('presence', { name: 'あ'.repeat(13) })));
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
  check('the host waits until the old-round handoff is stored before switching rounds',
    htmlText.includes("const announced = await netSend({ t: 'lobbyState', status: 'lobby', nextRoundId: nextId, autoReady: autoReady === true })")
    && htmlText.includes("if (announced !== true) throw new Error('Next round handoff could not be sent.');")
    && htmlText.includes('return sendQueue.send({ path: `rooms/${encodeURIComponent(room)}/rounds/${encodeURIComponent(roundId)}/messages/${key}`, body });'));
  // 花火は飛行中に起爆パケットを送らない。炸裂の時刻と位置は発射時に数式で確定する。
  // ここが破れると、通信の遅れがそのまま炸裂位置のズレとして戻る(Issue #3)。
  check('the firework bursts from launch data and sends no mid-flight detonation packet',
    !htmlText.includes("netSend({ t: 'boom'")
    && htmlText.includes('function fireworkApexBurst(')
    && htmlText.includes('p.apexBurst && p.fireworkTimer >= p.apexBurst.t')
    && htmlText.includes('p.x = p.apexBurst.x;'));
  // 更新前の端末から届く boom は受理して無視する。拒否すると対戦が中断してしまう。
  check('an incoming boom from an older client is accepted and ignored',
    htmlText.includes("if (msg.t === 'boom') return msg.unitId === 'p1' || msg.unitId === 'e1'")
    && htmlText.includes("case 'boom':"));
  check('a rematch start bypasses stale physics and waits only for reveal verification',
    htmlText.includes("if (msg.t === 'start') {\n        if (online.revealVerified) applyNetMessage(msg);")
    && htmlText.includes("online.pendingStart = msg;")
    && htmlText.includes("if (msg.t === 'fire' || msg.t === 'boom')")
    && htmlText.includes("if (online.pendingStart) {\n        const pendingStart = online.pendingStart;"));
  check('the host stores the start snapshot and start packet before leaving the lobby',
    htmlText.includes('if (online.transport.saveSnapshot) await online.transport.saveSnapshot(snap);')
    && htmlText.includes("const startSent = await netSend({ t: 'start', snap });")
    && htmlText.includes("if (startSent !== true) throw new Error('Match start could not be sent.');"));
  check('a rematch clears the guest start-verification latch before accepting the next start',
    htmlText.includes('pendingStart: null, startVerifying: false,')
    && htmlText.includes('online.pendingStart = null; online.startVerifying = false;')
    && htmlText.includes("online.phase = 'playing';\n      online.startVerifying = false;"));
  const firebaseBeginStart = htmlText.indexOf('function beginFirebaseOnline(');
  const firebaseBeginEnd = htmlText.indexOf('// 準備完了は取り消せる。', firebaseBeginStart);
  const firebaseBeginSrc = firebaseBeginStart >= 0 && firebaseBeginEnd > firebaseBeginStart
    ? htmlText.slice(firebaseBeginStart, firebaseBeginEnd) : '';
  check('entering an online room keeps an existing CPU suspended match',
    firebaseBeginSrc.includes('hasSuspendedSave = !!loadSuspendedMatch();')
    && !firebaseBeginSrc.includes('clearSuspendedMatch();'));
  check('online snapshots keep each camera local and focus the acting unit',
    htmlText.includes("if (isOnline()) {\n      // カメラは端末ごとの見やすさであり、相手のスナップショットで上書きしない。")
    && htmlText.includes('focusCameraOn(activeUnit().x, true);')
    && htmlText.includes("activeIndex = first === 'p1' ? 0 : 1;\n      focusCameraOn(activeUnit().x, true);"));
  // 決着直後に見たいのは勝敗であって、合言葉や部屋の設定ではない(ユーザー指摘)。
  // 対戦者は結果画面のボタンで続行を選び、ロビーのポップアップは開かない。
  check('the battle view-distance slider changes only the local camera and never sends a network message',
    htmlText.includes("const CAMERA_SLIDER = { x: 60, y: CONTROL_PANEL_Y + 31, w: 110 };")
    && htmlText.includes('function setCameraZoomFromSlider(point)')
    && htmlText.includes("if (inputMode === 'cameraSlider') {")
    && htmlText.includes('drawCameraSlider();'));
  const resetMatchSrc = htmlText.match(/function resetMatch\(carrySpecialCharge\) \{[\s\S]*?\n  \}/)?.[0] || '';
  check('the battle view distance is remembered instead of resetting on a new turn or rematch',
    htmlText.includes("const CAMERA_ZOOM_KEY = 'katamon_camera_zoom_v1';")
    && htmlText.includes('function loadCameraZoom()')
    && htmlText.includes('function saveCameraZoom()')
    && htmlText.includes('let cameraZoom = loadCameraZoom();')
    && !resetMatchSrc.includes('cameraZoom = DEFAULT_CAMERA_ZOOM;'));
  check('players choose on the result screen, not in a popup that hides the outcome',
    htmlText.includes('function firebaseResultChoiceVisible()')
    && htmlText.includes("drawResultButton(continueBtn, 'このまま再戦'")
    && htmlText.includes("drawResultButton(resultTitleBtn, 'ロビーへ戻る', false)"));
  check('the results popup is skipped for players and kept for spectators',
    htmlText.includes('if (isFirebasePlayer()) { renderFirebaseLobby(); return; }')
    && htmlText.includes('openFirebaseResultsLobby();'));
  // 描画とタップが別々の条件で分岐すると、押せないボタンや押せる透明領域ができる。
  check('the result buttons are drawn and hit-tested through the same predicate',
    (htmlText.match(/firebaseResultChoiceVisible\(\)/g) || []).length >= 3);
  check('a player who already voted cannot vote again and is told to wait',
    htmlText.includes('if (firebaseHasResultVote()) return;')
    && htmlText.includes('相手の返事を待っています…'));
  check('the result buttons trigger the rematch and return-to-lobby requests',
    htmlText.includes('requestFirebaseRematch(); return;')
    && htmlText.includes('requestFirebaseReturnLobby();'));
  check('the lobby still offers the same two choices for spectators',
    htmlText.includes('id="onlineRematch"') && htmlText.includes('id="onlineReturnLobby"'));
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
  check('rules allow the shinigami character reveal',
    msg['.validate'].includes("newData.child('t').val() === 'reveal'")
    && msg.character['.validate'].includes("newData.val() === 'shinigami'"));
  // 実機:再戦を押すとゲストが固まり、ホストに「認証の更新に失敗しました」が出た。
  // 再戦は「新roundを作る → roomのポインタを新roundへ → 旧roundの購読者へ通知」の順で、
  // 通知の時点でポインタは既に新roundを指しているため旧roundへの書き込みが401になっていた。
  // 順番を逆にすると今度はゲストが新roundへ ready を書く時にポインタが古く401になる。
  // ポインタを先に動かしたまま、ホストの lobbyState だけを例外として許すのが競合の無い形。
  check('the host can announce the next round into the round it is leaving',
    msg['.write'].includes("|| (newData.child('t').val() === 'lobbyState' && newData.child('seat').val() === 'p1')"));
  check('every other packet is still confined to the current round',
    msg['.write'].includes("root.child('rooms').child($room).child('round').child('id').val() === $roundId")
    && msg['.validate'].includes("newData.child('roundId').val() === $roundId"));
  // 相手が落ちたのに自分の手番表示が先に出ると、自分が落ちたように見える。
  check('the turn does not advance while waiting for the peer to declare the result',
    htmlText.includes('const waitingForPeerResult = isOnline() && !matchOver && units.some(u => u.hp <= 0);')
    && htmlText.includes('if (!waitingForPeerResult) endTurn();'));
  check('the remote action is still marked resolved while waiting, so the result correlates',
    /waitingForPeerResult[\s\S]{0,400}online\.remoteAction\.resolved = true;/.test(htmlText));
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
    && msg['.validate'].includes("'fire' && newData.hasChildren(['unitId','x','y','anchor','vx0','vy0','useSpecial','useJump','actionId'])")
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
  // 削除はホスト本人か、部屋が期限切れの時だけ(固定コードの簡単対戦部屋が
  // 放置で永久に詰む欠陥の修正。2026-07-27にConsoleへ反映済み)。
  // 「有効な部屋を他人が消せない」ことmust含めて固定する。
  check('rules let the host, or anyone after expiry, delete the room — never a stranger while it lives',
    rules['.write'].includes("data.exists() && !newData.exists() && (data.child('hostUid').val() === auth.uid || data.child('expiresAt').val() <= now)")
    && rules['.write'].includes("(!data.exists() || data.child('expiresAt').val() <= now) && newData.exists()"));
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
  // 実機で「相手に決着が届かない」時、ログが受信だけを記録していたため、
  // 送っていないのか送って弾かれたのかが分からず原因を追えなかった。送信側も残す。
  check('the log records what we send, not only what we receive',
    htmlText.includes("logOnlineEvent({ type: 'sendResult', ok: true")
    && htmlText.includes("logOnlineEvent({ type: 'sendFire'"));
  check('a result that is never sent leaves its reason in the log',
    htmlText.includes("logOnlineEvent({ type: 'sendResult', ok: false, why: 'alreadySent' })")
    && htmlText.includes("logOnlineEvent({ type: 'sendResult', ok: false, why: 'noActionId' })"));
  check('declining to declare the match end is recorded too',
    htmlText.includes("logOnlineEvent({ type: 'matchEnd', declared: false")
    && htmlText.includes("logOnlineEvent({ type: 'matchEnd', declared: true"));
  check('Online event log is capped at the documented ring-buffer size', fakeOnline.log.length === h.onlineLogMax());
  check('Ring buffer drops the oldest entries, not the newest', fakeOnline.log[fakeOnline.log.length - 1].type === 'fire');
  h.persistOnlineLog();
  const persisted = JSON.parse(globalThis.localStorage.getItem(h.onlineLogKey()) || 'null');
  check('Persisted log round-trips room/role and the capped entries', persisted && persisted.room === 'A2BC3DEF' && persisted.role === 'host' && persisted.log.length === h.onlineLogMax());
  h.setOnlineForLogTest(null);

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
