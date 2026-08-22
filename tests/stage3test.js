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
  const anchoredHudSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('battle HUD crops transparent asset margins and uses measured content anchors',
    anchoredHudSource.includes('const HUD_ASSET_LAYOUT = Object.freeze({')
    && anchoredHudSource.includes('ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, x, y, w, h);')
    && anchoredHudSource.includes('const PANEL_1V1 = { h: 74, rows: [50] };')
    && anchoredHudSource.includes('const cardH = expanded ? 152 : 54;')
    && !anchoredHudSource.includes("String(text).includes('橋')"));
  check('battle HUD name and HP text use the middle baseline at the measured window center',
    anchoredHudSource.includes("ctx.textBaseline = opts.baseline || 'alphabetic';")
    && anchoredHudSource.includes('centerY: 0.31')
    && anchoredHudSource.includes('centerY: 0.32')
    && anchoredHudSource.includes('const labelY = cardY + h * layout.text.centerY;')
    && (anchoredHudSource.match(/baseline: 'middle'/g) || []).length >= 2);
  check('round wind console uses three compact lines with strength inside its outlined arrow and NEXT direction only',
    anchoredHudSource.includes('function drawWindStrengthArrow(')
    && anchoredHudSource.includes("const nextText = `NEXT ${nextArrow}`;"));
  check('round wind console gives the current strength a high-contrast inner plate and the NEXT direction its own readable badge',
    anchoredHudSource.includes('function drawWindNextBadge(')
    && anchoredHudSource.includes('const strengthPlateW = width * 0.43;'));
  check('round wind console keeps its title and NEXT badge inside the dark center while enlarging the strength arrow',
    anchoredHudSource.includes('const arrowHeight = expanded ? 19 : 15;')
    && anchoredHudSource.includes('const arrowFont = expanded ? 16 : 11;')
    && anchoredHudSource.includes('roundCenterY - inner * 0.70')
    && anchoredHudSource.includes('drawWindStrengthArrow(cx, roundCenterY - inner * 0.03, expanded')
    && anchoredHudSource.includes('roundCenterY + inner * 0.68'));
  check('round wind console uses a calm-only status, filled direction arrows, and compact inner labels',
    anchoredHudSource.includes("if (label === '無風')")
    && anchoredHudSource.includes("ctx.fillStyle = color;")
    && anchoredHudSource.includes('const w = expanded ? 54 : 40;')
    && anchoredHudSource.includes('roundCenterY - inner * 0.70')
    && anchoredHudSource.includes('roundCenterY + inner * 0.68'));
  check('round wind console separates arrow contrast, widens the strength plate, and lifts readable labels',
    anchoredHudSource.includes("const arrowColor = calmWind ? '#72e8ff' : '#38cfff';")
    && anchoredHudSource.includes('const strengthPlateW = width * 0.43;')
    && anchoredHudSource.includes('const strengthPlateH = height * 0.78;')
    && anchoredHudSource.includes('roundCenterY - inner * 0.70')
    && anchoredHudSource.includes("nextArrow === '無風'")
    && anchoredHudSource.includes('const w = expanded ? 54 : 40;'));
  check('round wind console reserves distinct header, arrow, and forecast lanes without an ambiguous calm dash',
    anchoredHudSource.includes('const arrowWidth = expanded ? 60 : 46;')
    && anchoredHudSource.includes('const arrowHeight = expanded ? 19 : 15;')
    && anchoredHudSource.includes("const nextArrow = forecast.calmWind ? '無風'")
    && anchoredHudSource.includes('roundCenterY - inner * 0.70')
    && anchoredHudSource.includes('roundCenterY + inner * 0.68'));
  check('round wind console follows the reference hierarchy with a dominant arrow and a divider above NEXT',
    anchoredHudSource.includes('function drawWindForecastDivider(')
    && anchoredHudSource.includes('const titleFont = expanded ? 9.5 : 6.6;')
    && anchoredHudSource.includes('const arrowWidth = expanded ? 60 : 46;')
    && anchoredHudSource.includes('roundCenterY - inner * 0.70')
    && anchoredHudSource.includes('drawWindForecastDivider(cx, roundCenterY + inner * 0.38'));
  check('round wind console renders NEXT and its forecast as one centered text line',
    anchoredHudSource.includes('drawOutlinedText(nextText, cx, cy, {')
    && !anchoredHudSource.includes("drawOutlinedText('NEXT', cx - w * 0.16"));
  check('battle HUD HP gauges are centered vertically on their measured rail anchors',
    anchoredHudSource.includes('hp: Object.freeze({ left: 0.17, right: 0.91, centerY: 0.68, h: 0.12 })')
    && anchoredHudSource.includes('hp: Object.freeze({ left: 0.10, right: 0.82, centerY: 0.69, h: 0.11 })')
    && anchoredHudSource.includes('const hpBarY = cardY + h * layout.hp.centerY - hpBarH / 2;'));
  check('1vs1と2vs2の風情報は同じ丸形フレーム内へ統一して表示する',
    anchoredHudSource.includes("roundWind: 'wind-console-round.webp'")
    && anchoredHudSource.includes('function drawUnifiedRoundWindConsole(')
    && anchoredHudSource.includes('const roundSize = expanded ? 142 : 104;'));
  check('2vs2も1vs1と同じ丸形コンソールへ現在・方向・予報を集約する',
    anchoredHudSource.includes('const expanded = is2v2();')
    && anchoredHudSource.includes('const roundCardY = expanded ? 42 : 47;')
    && anchoredHudSource.includes('drawUnifiedRoundWindConsole(cx, roundCardY, expanded, windStrengthScale, windTitle, forecast, fixedForecast, forecastText);'));
  check('丸形コンソールは現在風・強さ入り矢印・NEXT方向の3行で表示する',
    anchoredHudSource.includes('function drawWindStrengthArrow(')
    && anchoredHudSource.includes("const nextText = `NEXT ${nextArrow}`;")
    && anchoredHudSource.includes('arrowWidth, arrowHeight, arrowColor, arrowFont);')
    && !anchoredHudSource.includes("const forecastLabel = fixedForecast ? '次の風: 同じ' : '次の風';"));
  const hudSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('battle HUD reserves the centered round wind console and keeps the stage title layer clear',
    hudSource.includes("roundWind: 'wind-console-round.webp'")
    && hudSource.includes('const roundSize = expanded ? 142 : 104;')
    && hudSource.includes('const roundCardY = expanded ? 42 : 47;')
    && !hudSource.includes('VW / 2, 35'));
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
  function terrainDeltaFrom(snap) {
    const delta = JSON.parse(JSON.stringify(snap));
    for (const key of ['segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey', 'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments', 'customStage', 'customStageIdentity']) delete delta[key];
    return delta;
  }
  const terrainDeltaState = terrainDeltaFrom(safeSnap);
  check('Firebase v3 turn state sends craters but omits the immutable terrain base after start',
    !Object.prototype.hasOwnProperty.call(terrainDeltaState, 'segments')
    && !Object.prototype.hasOwnProperty.call(terrainDeltaState, 'bridge')
    && Array.isArray(terrainDeltaState.craters)
    && h.validateFirebaseMessage(firebasePacket('state', { actionId, unitId: 'p1', snap: terrainDeltaState }))
    && h.stateSnapshotMismatchReason(terrainDeltaState, safeSnap) === '');
  check('Firebase state accepts a complete safe snapshot', h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: safeSnap }));
  const missingWindForecast = JSON.parse(JSON.stringify(safeSnap));
  delete missingWindForecast.nextWind;
  const invalidWindForecast = JSON.parse(JSON.stringify(safeSnap));
  invalidWindForecast.nextWind = { dir: 1, strength: 9, calmWind: false };
  check('Firebase rejects a missing or out-of-range next-wind forecast before applying it',
    !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: missingWindForecast })
    && !h.validateFirebaseMessage({ v: 2, from: 'peer', t: 'state', sentAt: Date.now(), actionId, snap: invalidWindForecast }));
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
  const changedCurrentWind = JSON.parse(JSON.stringify(safeSnap));
  changedCurrentWind.wind.strength = changedCurrentWind.wind.strength > 0.5 ? 0.1 : 0.9;
  check('a peer cannot replace the current wind that was already forecast',
    h.stateSnapshotMismatchReason(changedCurrentWind, safeSnap) === 'wind');
  const changedFutureWind = JSON.parse(JSON.stringify(safeSnap));
  changedFutureWind.nextWind = { dir: safeSnap.nextWind.dir * -1, strength: 0.314159, calmWind: false };
  check('the acting side may publish the newly rolled future wind at a turn boundary',
    h.stateSnapshotMismatchReason(changedFutureWind, safeSnap) === '');
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
  check('battle HUD uses the expanded readable layout',
    /const HUD_BASE_BOTTOM = 270;/.test(readRepoFile('index.html'))
      && /const TURN_BAR_BASE_Y = 158;/.test(readRepoFile('index.html'))
      && /const MINIMAP = \{ x: 13, y: 190, w: VW - 26, h: 72 \}/.test(readRepoFile('index.html')),
    'battle HUD is still using the compact top layout');
  check('battle HUD keeps team accents and removes the obsolete bridge label',
    /自軍/.test(readRepoFile('index.html'))
      && /敵軍/.test(readRepoFile('index.html'))
      && !readRepoFile('index.html').includes("drawOutlinedText('司令ブリッジ'"),
    'battle HUD still draws the obsolete bridge label');

  check('battle HUD uses the supplied player frames and unified round wind asset',
    ['player-card-ally.png', 'player-card-enemy.png', 'minimap-frame.png']
      .every(file => require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'ui', 'battle-hud', file)))
      && ['player-card-ally.png', 'player-card-enemy.png', 'wind-console.png', 'turn-ribbon.png']
        .every(file => require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'ui', 'battle-hud', 'v3', file)))
      && require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'ui', 'battle-hud', 'v4-wind-console.png'))
      && require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'ui', 'battle-hud', 'wind-console-round.webp'))
      && readRepoFile('index.html').includes('battleHudImages')
      && readRepoFile('index.html').includes('player-card-ally.png')
      && readRepoFile('index.html').includes('player-card-enemy.png')
      && readRepoFile('index.html').includes('turn-ribbon.png')
      && readRepoFile('index.html').includes('minimap-frame.png')
      && readRepoFile('index.html').includes('wind-console-round.webp')
      && readRepoFile('index.html').includes('drawBattleHudAsset'),
    'supplied battle HUD frame assets are not wired into the renderer');

  check('battle HUD text and gauges use wide HP-first windows',
    /const contentX = barX \+ w \* layout\.text\.left;/.test(readRepoFile('index.html'))
      && /const innerX = barX \+ w \* layout\.hp\.left;/.test(readRepoFile('index.html'))
      && /const fuelX = barX \+ w \* layout\.fuel\.left;/.test(readRepoFile('index.html'))
      && /const hpBarH = Math\.max\(6, h \* layout\.hp\.h\);/.test(readRepoFile('index.html'))
      && /const fuelBarH = Math\.max\(3, h \* layout\.fuel\.h\);/.test(readRepoFile('index.html'))
      && /const centerX = frameX \+ cardW \* layout\.centerX;/.test(readRepoFile('index.html'))
      && /drawOutlinedText\(forecastText, rightX/.test(readRepoFile('index.html')),
    'dynamic HUD text, HP/fuel hierarchy, or three-column wind layout is incomplete');
  check('battle HUD keeps 2vs2 cards reusable and hides minimap in normal 1vs1',
    /const w = HUD_CARD_W;/.test(readRepoFile('index.html'))
      && /function showTacticalStrip\(\) \{[\s\S]{0,100}is2v2\(\) \|\| STAGE_W === 2160/.test(readRepoFile('index.html'))
      && /function drawMinimap\(\) \{\s*if \(!showTacticalStrip\(\)\) return;/.test(readRepoFile('index.html')),
    '2vs2 card reuse or contextual minimap visibility is missing');
  check('battle HUD preserves asset proportions and leaves the wind forecast visible',
    ['const HUD_CARD_W = 184;', 'const PANEL_1V1 = { h: 74, rows: [50] };',
      'const PANEL_2V2 = { h: 74, rows: [50, 128] };', 'const TURN_BAR_BASE_Y = 158;',
      'const MINIMAP = { x: 13, y: 190, w: VW - 26, h: 72 }', 'cardH = expanded ? 152 : 54;',
      'drawOutlinedText(forecastText, rightX'].every(text => readRepoFile('index.html').includes(text)),
    'HUD assets are being squashed, overlapped, or the forecast label is hidden');
  check('battle HUD turn ribbon has separate left, center, and right data zones',
    /v3\/turn-ribbon\.png/.test(readRepoFile('index.html'))
      && /drawOutlinedText\(turnCounter, VW \/ 2, barY \+ 17/.test(readRepoFile('index.html'))
      && /battleHudImages\.turn/.test(readRepoFile('index.html')),
    'turn information remains a cramped single text line');

  check('battle-start logo is preloaded, cached, and drawn from the Drive PNG',
    require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'battle-start-logo.png'))
      && readRepoFile('index.html').includes('assets/battle-start-logo.png')
      && swText.includes("'./assets/battle-start-logo.png'")
      && readRepoFile('index.html').includes('battleStartLogoImage, 608, 1776, 2880, 1608'),
    'BATTLE START logo asset wiring is incomplete');
  check('battle-start logo video is preloaded, cached, and drawn above the old logo position',
    require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'battle-start-logo.mp4'))
      && readRepoFile('index.html').includes("assets/battle-start-logo.mp4")
      && swText.includes("'./assets/battle-start-logo.mp4'")
      && /const BATTLE_START_LOGO_Y = 180;/.test(readRepoFile('index.html'))
      && /battleStartLogoVideoCanvas,\s*\n?\s*VW \/ 2 - logoW \/ 2,\s*BATTLE_START_LOGO_Y/.test(readRepoFile('index.html')),
    'BATTLE START logo video wiring or upward position is incomplete');
  check('battle-start video uses compositing instead of per-pixel background removal',
    /ctx\.globalCompositeOperation = 'screen';[\s\S]{0,300}ctx\.drawImage\(battleStartLogoVideoCanvas/.test(readRepoFile('index.html'))
      && !/battleStartLogoVideoCtx\.getImageData\([\s\S]{0,500}battleStartLogoVideoCtx\.putImageData\(/.test(readRepoFile('index.html')),
    'BATTLE START video still performs expensive per-pixel background removal');
  check('battle-start video is 1.95x and stops after one playback',
    /const BATTLE_START_LOGO_SCALE = 1\.95;/.test(readRepoFile('index.html'))
      && /const logoW = 300 \* BATTLE_START_LOGO_SCALE;/.test(readRepoFile('index.html'))
      && /battleStartLogoVideo\.loop = false;/.test(readRepoFile('index.html'))
      && /battleStartLogoVideo\.addEventListener\('ended',[\s\S]{0,120}battleStartLogoVideo\.pause\(\)/.test(readRepoFile('index.html')),
    'BATTLE START video size or one-shot playback is not configured');
  check('battle-start video playback rate is 1.3x without changing the render path',
    /battleStartLogoVideo\.playbackRate = 1\.3;/.test(readRepoFile('index.html')),
    'BATTLE START video playback rate is not 1.3x');
  check('battle-start video reapplies 1.3x at playback start',
    /battleStartLogoVideo\.defaultPlaybackRate = 1\.3;/.test(readRepoFile('index.html'))
      && /function startBattleStartLogoVideo\(\)[\s\S]{0,180}battleStartLogoVideo\.playbackRate = 1\.3;/.test(readRepoFile('index.html')),
    'BATTLE START video does not lock 1.3x when playback starts');
  check('battle-start video scale is increased by another 1.3x',
    /const BATTLE_START_LOGO_SCALE = 1\.95;/.test(readRepoFile('index.html')),
    'BATTLE START video scale is not 1.95x');
  check('VS plate drawing clips the asset to its rounded shell shape',
    /roundRect\(-pw \/ 2, -ph \/ 2, pw, ph, ph \* 0\.46\)[\s\S]{0,120}ctx\.clip\(\);[\s\S]{0,120}ctx\.drawImage\(img/.test(readRepoFile('index.html')),
    'VS plate image is not clipped before drawing');
  check('VS plate flash does not paint a transient rectangular color block',
    !/if \(flash > 0\) \{[\s\S]{0,500}ctx\.fill\(\);[\s\S]{0,80}ctx\.restore\(\);\s*\}\s*ctx\.restore\(\);/.test(readRepoFile('index.html')),
    'VS plate flash still uses a full-plate fill');

  // 音源を差し替える版では、BUILD_ID/CACHE_VERSIONを上げて新しいAPP_SHELLを
  // 再取得する。個別のクエリ文字列に頼らず、ハッシュと実際の参照先を固定する。
  const crypto = require('crypto');
  // ファイルが無い時に例外で死ぬと、テスト全体の出力ごと消える(実際に消えた)。
  // 「無い」を値として返し、検査の側で不合格として報告させる。
  const fileHash = name => {
    try {
      return crypto.createHash('md5')
        .update(require('fs').readFileSync(require('path').join(__dirname, '..', name)))
        .digest('hex').slice(0, 12);
    } catch (_) {
      return '(ファイルが無い)';
    }
  };
  const htmlForAudio = readRepoFile('index.html');
  check('online entry and every lobby screen use the approved Lobby Remix asset',
    fileHash('assets/room-bgm.mp3') === '77eea099dfc3'
      && htmlForAudio.includes('<audio id="roomBgm" preload="none" loop src="assets/room-bgm.mp3"></audio>'));
  // v145: 通常弾の着弾音は外部URLを直接再生せず、同梱した指定素材をWebAudioで鳴らす。
  // キャッシュ一覧から外すと、ホーム画面追加後のオフライン対戦だけ昔の合成音へ戻ってしまう。
  let thirdPartyAudio = '';
  try { thirdPartyAudio = readRepoFile('assets/SOUND_LICENSES.md'); } catch (_) { /* 下の検査で不合格にする */ }
  check('the pinned Pixabay normal impact sound is present',
    fileHash('assets/normal-impact-explosion.mp3') === 'ffae7663a709');
  check('the normal impact sound is cached for offline play under the build cache',
    htmlForAudio.includes("assets/normal-impact-explosion.mp3")
      && swText.includes("'./assets/normal-impact-explosion.mp3'")
      && htmlForAudio.includes('normalImpactSound: !activateSpecial && !activateJump'));
  const normalImpactGain = Number((/const NORMAL_IMPACT_SOUND_GAIN = ([0-9.]+);/.exec(htmlForAudio) || [])[1]);
  const titleWallImpactGain = Number((/const TITLE_WALL_IMPACT_SOUND_GAIN = ([0-9.]+);/.exec(htmlForAudio) || [])[1]);
  check('the requested explosion sample stays subdued, with the title wall hit quieter than battle impacts',
    normalImpactGain > 0 && normalImpactGain <= 0.4
      && titleWallImpactGain > 0 && titleWallImpactGain <= 0.3
      && titleWallImpactGain < normalImpactGain,
    JSON.stringify({ normalImpactGain, titleWallImpactGain }));
  check('the Pixabay source, creator, license and check date stay recorded with the asset',
    thirdPartyAudio.includes('Cartoon Explosion')
      && thirdPartyAudio.includes('Universfield')
      && thirdPartyAudio.includes('https://pixabay.com/sound-effects/film-special-effects-cartoon-explosion-567193/')
      && thirdPartyAudio.includes('https://pixabay.com/service/license-summary/')
      && thirdPartyAudio.includes('2026-08-09'));
  check('the EDM Zap special cut-in sound is pinned, cached and licensed',
    fileHash('assets/special-cutin-edm-zap.mp3') === 'dc50a111cbea'
      && htmlForAudio.includes("assets/special-cutin-edm-zap.mp3")
      && swText.includes("'./assets/special-cutin-edm-zap.mp3'")
      && thirdPartyAudio.includes('EDM Zap')
      && thirdPartyAudio.includes('https://pixabay.com/sound-effects/edm-zap-246568/')
      && thirdPartyAudio.includes('2026-08-10'));
  check('the Cool Kai special voice is pinned, preloaded and cached',
    fileHash('assets/cool-kai-special-voice.mp3') === '06459291b238'
      && htmlForAudio.includes("assets/cool-kai-special-voice.mp3")
      && swText.includes("'./assets/cool-kai-special-voice.mp3'")
      && htmlForAudio.includes('primeCoolKaiSpecialVoice();')
      && htmlForAudio.includes("def?.key === 'coolKai'"));
  const BONUS_TRACK_PINS = [
    { file: 'assets/bonus-bgm-1.mp3', hash: '49a1b4b1adff', url: 'assets/bonus-bgm-1.mp3' },
    { file: 'assets/bonus-bgm-2.mp3', hash: '1014f338877a', url: 'assets/bonus-bgm-2.mp3' },
    { file: 'assets/bonus-bgm-3.mp3', hash: 'f38aa093c2c7', url: 'assets/bonus-bgm-3.mp3' },
    { file: 'assets/bonus-bgm-4.mp3', hash: 'a59c297a09ee', url: 'assets/bonus-bgm-4.mp3' },
    { file: 'assets/six-eternel-dopagaki-remix.mp3', hash: 'ee5912711914', url: 'assets/six-eternel-dopagaki-remix.mp3' }
  ];
  const pinNg = [];
  for (const pin of BONUS_TRACK_PINS) {
    const actual = fileHash(pin.file);
    if (actual !== pin.hash) pinNg.push(`${pin.file} の中身が変わっている(${actual})。BUILD_ID/CACHE_VERSIONを上げること`);
    if (!htmlForAudio.includes(`'${pin.url}'`)) pinNg.push(`${pin.url} が index.html に無い`);
  }
  check('bonus BGM files and their build-cached URLs stay in sync',
    pinNg.length === 0, pinNg.join(' / '));
  const bonusUrls = [...new Set(htmlForAudio.match(/assets\/bonus-bgm-\d+\.mp3/g) || [])];
  check('every bonus BGM URL is registered once by the sound-test source list', bonusUrls.length === 4,
    bonusUrls.join(', '));

  // キャラ画像を差し替える版ではBUILD_ID/CACHE_VERSIONを上げる。個別のURL版数は使わない。
  const CHARACTER_ASSET_PINS = [
    { key: 'kyoryu', stem: 'dirano', webp: 'c13291632f36', png: 'd7e8126f2075' },
    { key: 'medama', stem: 'eyebolt', webp: '29c0f8b99547', png: 'f1d5608f8625' },
    { key: 'iwa', stem: 'gorocca', webp: 'e5bc1c5714d2', png: '283307e2478f' },
    { key: 'tori', stem: 'fenice', webp: '1396a2448001', png: 'b4f372180210' },
    { key: 'barugerukan', stem: 'barugerukan', webp: '78e854946860', png: 'bb3c27616491' },
    { key: 'nisenmono', stem: 'obelisk', webp: '19933146097d', png: 'ff4991ae8756' },
    { key: 'burumutan', stem: 'bloom-tan', webp: 'd920cdeaa45f', png: '5e739accbd3a' },
    { key: 'sumoeru', stem: 'sumoeru', webp: '9a9104e4bb3a', png: 'ce3bb11b1a64' },
    { key: 'doRednote', stem: 'dread-arrow', webp: 'd620300581dd', png: '8054db6d5daf' },
    { key: 'hamulton', stem: 'hamulton', webp: '8c0204d58c18', png: 'ddc24e4725aa' },
    { key: 'mocchario', stem: 'mocchario', webp: 'edbf47277933', png: '228b1ea240b7' },
    { key: 'mecha', stem: 'chrome-gear', webp: 'ec5ac42f758b', png: '086923d116e6' },
    { key: 'akuma', stem: 'rubidevi', webp: 'b3b20e4be92c', png: 'a70b4d0c56fd' },
    { key: 'jinba', stem: 'astauros', webp: 'b28ee987cb43', png: 'ccefcac9ced5' },
    { key: 'kishi', stem: 'paladier', webp: '52e362107fa5', png: '54142e9e8e56' },
    { key: 'neko', stem: 'nyan-tank', webp: '41c53fa06a1d', png: '1de7bdc6727e' },
    { key: 'shinigami', stem: 'yomigama', webp: 'ea291207269c', png: '806d572ce13d' }
  ];
  const repoRoot = path.join(__dirname, '..');
  const legacyCharacterStems = [
    'kyoryu', 'medama', 'iwa', 'tori', 'barugerukan', 'nisenmono', 'burumutan', 'sumoeru',
    'do-rednote', 'mocchario', 'mecha', 'akuma', 'jinba', 'kishi', 'neko', 'shinigami'
  ];
  check('character assets use display-name based master/runtime directories',
    CHARACTER_ASSET_PINS.every(({ stem }) =>
      fs.existsSync(path.join(repoRoot, 'assets', 'characters', 'master', `${stem}.png`))
      && fs.existsSync(path.join(repoRoot, 'assets', 'characters', 'runtime', `${stem}.webp`)))
    && CHARACTER_ASSET_PINS.every(({ key, stem }) =>
      new RegExp(`\\n    ${key}: \\{[\\s\\S]*?key: '${key}', name: '[^']+', asset: '${stem}'`).test(htmlForAudio))
    && legacyCharacterStems.every((stem) =>
      !fs.existsSync(path.join(repoRoot, 'assets', `${stem}.png`))
      && !fs.existsSync(path.join(repoRoot, 'assets', `${stem}.webp`))));
  const charNg = [];
  for (const pin of CHARACTER_ASSET_PINS) {
    // v130から実際に配るのは .webp。読めない端末が落ちてくる先の .png も一緒に留める。
    // 片方だけ差し替えると、端末によって別の絵が出る。
    const webpPath = `assets/characters/runtime/${pin.stem}.webp`;
    const pngPath = `assets/characters/master/${pin.stem}.png`;
    if (fileHash(webpPath) !== pin.webp) {
      charNg.push(`${webpPath} の中身が変わっている(${fileHash(webpPath)})。BUILD_ID/CACHE_VERSIONを上げること`);
    }
    if (fileHash(pngPath) !== pin.png) {
      charNg.push(`${pngPath} の中身が変わっている(${fileHash(pngPath)})。webp と食い違っていないか確かめること`);
    }
  }
  check('character images stay in sync with the build cache', charNg.length === 0, charNg.join(' / '));
  // v130: webp を先に読み、読めなかった時だけ同じ名前の png へ落とす。
  check('the art loader asks for webp first and falls back to png',
    /img\.src = `\$\{webpBase\}\.webp`;/.test(htmlForAudio)
    && /img\.src = `\$\{pngBase\}\.png`;/.test(htmlForAudio)
    && htmlForAudio.includes('if (!triedPng) {'));
  check('character images rely on the build cache instead of per-asset query versions',
    !htmlForAudio.includes('CHARACTER_ASSET_VERSION') && !htmlForAudio.includes('?v='));
  // 落とし先の png を消すと、古い端末で絵が1枚も出なくなる。
  check('the png fallbacks still exist on disk',
    CHARACTER_ASSET_PINS.every(pin => fs.existsSync(path.join(repoRoot, 'assets', 'characters', 'master', `${pin.stem}.png`))));
  check('the Barucopter uses its dedicated WebP helicopter art instead of the Barugerukan body art',
    fs.existsSync(path.join(repoRoot, 'assets', 'characters', 'master', 'barugerukan-helicopter.webp'))
      && htmlForAudio.includes("const BARUCOPTER_IMAGE_PATH = 'assets/characters/master/barugerukan-helicopter.webp';")
      && /function getBarucopterImage\(\)[\s\S]*?BARUCOPTER_IMAGE_PATH/.test(htmlForAudio)
      && /function drawBarucopters\(\)[\s\S]*?const img = getBarucopterImage\(\);[\s\S]*?const h = 294;/.test(htmlForAudio),
    '透過を直した専用ヘリ画像を遅延読込し、従来の3倍で表示すること');
  // 先読みも webp を指していないと、webp と png を二重に取りに行くことになる。
  check('the preload hints point at webp',
    ['loading-emblem', 'title-logo'].every(n =>
      htmlForAudio.includes(`<link rel="preload" as="image" href="assets/${n}.webp" type="image/webp"`))
    && ['dirano', 'eyebolt', 'gorocca', 'fenice'].every(stem =>
      htmlForAudio.includes(`<link rel="preload" as="image" href="assets/characters/runtime/${stem}.webp" type="image/webp"`))
    && !/rel="preload" as="image" href="assets\/(?:characters\/master\/)?(?:loading-emblem|title-logo|dirano|eyebolt|gorocca|fenice)\.png/.test(htmlForAudio));
  // ロビーのエンブレムはDOMの<img>。JSを通らないので picture で振り分ける。
  check('the lobby emblem falls back through <picture>',
    /<source srcset="assets\/loading-emblem\.webp" type="image\/webp">/.test(htmlForAudio)
    && /<img id="onlineLobbyEmblem" src="assets\/loading-emblem\.png"/.test(htmlForAudio)
    && htmlForAudio.includes('#onlineLobbyBody picture { display: block; }'));
  // 起動時に読む絵の合計。ここが膨らむと読み込み画面が長くなる(v130で3.83MB→0.74MB)。
  const startupArtFiles = ['assets/title-logo.webp', 'assets/loading-emblem.webp']
    .concat(CHARACTER_ASSET_PINS.map(pin => `assets/characters/runtime/${pin.stem}.webp`));
  const startupArtBytes = startupArtFiles
    .reduce((sum, file) => sum + fs.statSync(path.join(repoRoot, file)).size, 0);
  check('the images the loading screen waits for stay under 1MB',
    startupArtBytes < 1024 * 1024, `${(startupArtBytes / 1024).toFixed(0)}KB`);

  check('Firebase accepts a normal fire packet', h.validateFirebaseMessage(validFire));
  check('Firebase v3 fire keeps the v2 payload checks behind the required round envelope',
    h.validateFirebaseMessage(validV3Fire)
    && !h.validateFirebaseMessage({ ...validV3Fire, roundId: 'bad' })
    && !h.validateFirebaseMessage({ ...validV3Fire, seat: 's1', actionId: 'bad' }));
  const validV3State = { v: 3, from: 'peer', seat: 'e1', roundId, t: 'state', sentAt: Date.now(), actionId, unitId: 'e1', snap: terrainDeltaState };
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
    /const titleUpdateBtn = \{ x: \d+, y: \d+, w: \d+, h: 30 \};/.test(htmlText)
    && htmlText.includes('async function forceGameUpdate()')
    && htmlText.includes('await registration.update();')
    && htmlText.includes("key.startsWith('katamon-pwa-')")
    && htmlText.includes("latestUrl.searchParams.set('refresh', Date.now().toString());"));
  check('title shows an available update prominently and does not reload when already current',
    htmlText.includes("updateAvailableBuild ? '更新あり・取得' : '最新版を取得'")
    && htmlText.includes("showTitleNotice('新しいバージョンがあります。「最新版を取得」を押してください')")
    && htmlText.includes("showTitleNotice('最新版です')")
    && htmlText.includes('if (!updateDetected) {')
    && htmlText.includes('updateRequestInFlight = false;'));
  const serviceWorkerText = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
  check('a newly activated worker refreshes a stale page only after it is safely back on the title',
    serviceWorkerText.includes("type: 'KATAMON_UPDATE_READY'")
    && serviceWorkerText.includes("self.clients.matchAll({ type: 'window', includeUncontrolled: true })")
    && serviceWorkerText.includes("fetch(request, { cache: 'no-store' })")
    && htmlText.includes("navigator.serviceWorker.addEventListener('message'")
    && htmlText.includes('function queueGameUpdateReload(build)')
    && htmlText.includes("if (gamePhase !== 'title') return;")
    && htmlText.includes('if (roomScreenOpen()) return;')
    && htmlText.includes('applyPendingGameUpdateIfSafe();'));
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
  // 2vs2では s1/s2 も対戦者なので、対戦者席の判定は対戦方式ごとに変わる(Issue #25)。
  check('peer liveness is refreshed only by player-seat traffic, for whichever seats are players',
    htmlText.includes('if (firebasePlayerSeats().includes(msg.seat)) noteFirebasePeerMessage();')
    && htmlText.includes("function firebasePlayerSeats() { return firebaseLobbyIs2v2() ? FIREBASE_SEATS.slice() : FIREBASE_PLAYER_SEATS.slice(); }"));
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
    // 席名とユニット名は2vs2で一致しない(s1→p2 / s2→e2)。必ず対応表を通して名乗る。
    && syncResultSrc[0].includes('actionUnitId = firebaseSeatUnitId(online.seat);'));
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
  check('move sync sends no faster than four times a second and skips short walk deltas',
    htmlText.includes('const MOVE_SYNC_INTERVAL_SEC = 0.25;')
    && htmlText.includes('const MOVE_SYNC_MIN_DELTA = 8;'));
  // 撃つ側は人でも空席のCPUでも netSendFire を通る。最後の位置はそこで必ず1回送る。
  check('the mover flushes its last position before firing',
    htmlText.includes('if (moveSyncPending) sendMoveUpdate(unit);'));
  check('a remote unit walks to the received position instead of teleporting',
    htmlText.includes('function updateRemoteWalk(dt)') && htmlText.includes('u.netWalkTargetX') && htmlText.includes('followGroundOrFall(u)'));
  check('turn start clears stale walk targets and send state',
    htmlText.includes('resetMoveSync();') && htmlText.includes('for (const u of units) u.netWalkTargetX = null;'));
  check('slot claim falls back to a plain PUT when the conditional PUT is denied',
    htmlText.includes('if (response.status !== 401) throw new Error')
    && htmlText.includes('const plain = await firebaseFetchWithTimeout(url, { method: \'PUT\'')
    && htmlText.includes('if (plain.status === 401) return false;'));
  // 2vs2では相手が3人になる。自分以外の対戦者席から届いたものだけを受け取る。
  check('only the other player seats can supply commit/reveal data',
    (htmlText.match(/if \(msg\.seat === online\.seat \|\| !firebaseSeatIsPlayer\(msg\.seat\)\) break;/g) || []).length === 2
    && htmlText.includes("case 'commit':") && htmlText.includes("case 'reveal':"));
  check('host start waits for every seated player, then enters the reveal gate',
    htmlText.includes('if (!allFirebasePlayersReady() || !firebasePeersCommitted()) return;')
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
  check('the next-wind consumer no longer branches on free mode alone', (() => {
    const src = /function consumeNextWind\(\) \{[\s\S]*?\r?\n  \}/.exec(htmlText);
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
    && htmlText.includes('[onlineWindEl, onlineTurnsEl, onlineFormatEl, onlineStageSizeEl].forEach(el => { if (el) el.disabled = !canEdit; });')
    && htmlText.includes('onlineTerrainEl.disabled = !canEdit || hasCustomStage;'));
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
  // v101までは「すぐ対戦」が KATAMN22 の1部屋だけで、3人目は必ず弾かれていた(Issue #23)。
  check('quick play matchmaking replaced the single shared room, and passcodes stay behind an explicit option',
    !htmlText.includes("const QUICK_MATCH_ROOM = 'KATAMN22';")
    && htmlText.includes("async function joinQuickFirebaseRoom(format = '1v1')")
    && htmlText.includes('id="onlineQuick"')
    && htmlText.includes('id="onlineCodeToggle"')
    && htmlText.includes('#onlineLobby.code-entry:not(.in-room) #onlineRoomInput'));
  check('online entry offers explicit create and browse paths, and public rows show enough match information to choose',
    htmlText.includes('id="onlineCreateMode"')
    && htmlText.includes('id="onlineBrowseMode"')
    && htmlText.includes('id="onlineRoomNameInput"')
    && htmlText.includes('id="onlineRoomList"')
    && htmlText.includes('hostName: entry.hostName')
    && htmlText.includes('roomName: entry.roomName')
    && htmlText.includes('playerCount: entry.playerCount'));
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
    htmlText.includes("sendFirebaseIdentityPacket({ t: 'presence' })")
    && htmlText.includes("sendFirebaseIdentityPacket({ t: 'lobbyState', status: online.phase, slots: online.slots, settings: online.settings })")
    && /async function sendFirebaseIdentityPacket\(packet\)[\s\S]{0,500}name: localPlayerName\(\)/.test(htmlText));
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
    && htmlText.includes('firebaseLobbySeatOrder().forEach(seat => onlineSlotsEl.appendChild(buildFirebaseSeatRow(seat, slots)));'));
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
    htmlText.includes('#onlineCharacterPicker { display: none; }')
    && htmlText.includes('#onlineLobby.in-room #onlineCharacterPicker { display: flex; }'));
  check('the room character picker shows the whole monster without cropping it',
    htmlText.includes('id="onlineCharacterPreview"')
    && /#onlineCharacterPreview\s*\{[^}]*object-fit:\s*contain;[^}]*\}/.test(htmlText)
    && !/#onlineCharacterPreview\s*\{[^}]*object-fit:\s*cover;[^}]*\}/.test(htmlText));
  const sumoeruRoomPreview = h.onlineCharacterPreviewForTest('sumoeru');
  const medamaRoomPreview = h.onlineCharacterPreviewForTest('medama');
  check('changing the room character updates its image, name and all eighteen choices',
    sumoeruRoomPreview && medamaRoomPreview
    && sumoeruRoomPreview.character === 'sumoeru' && /sumoeru\.(?:webp|png)(?:\?|$)/.test(sumoeruRoomPreview.src)
    && sumoeruRoomPreview.alt === 'スモエル'
    && medamaRoomPreview.character === 'medama' && /eyebolt\.(?:webp|png)(?:\?|$)/.test(medamaRoomPreview.src)
    && medamaRoomPreview.alt === 'アイボルト'
    && medamaRoomPreview.options === 18);
  check('both rematch votes reset a new round with automatic readiness',
    htmlText.includes('if (isFirebaseHost() && allFirebaseRematchVotesIn()) await resetFirebaseRound(true);')
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
  // 花火は飛行中に起爆パケットを送らない。両端末が固定刻みで同じ接近判定を行う。
  // ここが破れると、通信の遅れがそのまま炸裂位置のズレとして戻る(Issue #3)。
  check('the firework uses deterministic proximity physics and sends no mid-flight detonation packet',
    !htmlText.includes("netSend({ t: 'boom'")
    && htmlText.includes('function fireworkProximityTarget(p)')
    && htmlText.includes('p.travelDistance < FIREWORK_ARM_DISTANCE')
    && htmlText.includes('fireworkProximityTarget(p)'));
  // 更新前の端末から届く boom は受理して無視する。拒否すると対戦が中断してしまう。
  check('an incoming boom from an older client is accepted and ignored',
    htmlText.includes("if (msg.t === 'boom') return isFirebaseUnitId(msg.unitId)")
    && htmlText.includes("case 'boom':"));
  check('a rematch start bypasses stale physics and waits only for reveal verification',
    htmlText.includes("if (msg.t === 'start') {\n        if (firebaseRevealsReady()) applyNetMessage(msg);")
    && htmlText.includes("online.pendingStart = msg;")
    && htmlText.includes("if (msg.t === 'fire' || msg.t === 'boom')")
    && htmlText.includes("if (online.pendingStart) {\n        const pendingStart = online.pendingStart;"));
  check('the host sends the start packet without persisting a spectator snapshot',
    !htmlText.includes('saveSnapshot')
    && !htmlText.includes('latestSnapshot')
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
    && htmlText.includes('focusCameraOn(activeUnit().x, true, activeUnit().y);')
    && htmlText.includes('activeIndex = firstIndex;\n      focusCameraOn(activeUnit().x, true, activeUnit().y);'));
  // 決着直後に見たいのは勝敗であって、合言葉や部屋の設定ではない(ユーザー指摘)。
  // 対戦者は結果画面のボタンで続行を選び、ロビーのポップアップは開かない。
  check('the battle view-distance slider changes only the local camera and never sends a network message',
    htmlText.includes("const CAMERA_SLIDER = { x: 60, y: CONTROL_PANEL_Y + 31, w: 110 };")
    && htmlText.includes('function setCameraZoomFromSlider(point)')
    && htmlText.includes("if (inputMode === 'cameraSlider') {")
    && htmlText.includes('drawCameraSlider();'));
  check('camera readouts distinguish view distance from the visible field width',
    htmlText.includes('function cameraDistanceLabel()')
    && htmlText.includes('function cameraWidthCoveragePercent()')
    && htmlText.includes('`視点距離 ${cameraDistanceLabel()}`')
    && htmlText.includes('`横 ${cameraWidthCoveragePercent()}%`'));
  const resetMatchSrc = htmlText.match(/function resetMatch\(carrySpecialCharge\) \{[\s\S]*?\n  \}/)?.[0] || '';
  check('the battle view distance is remembered instead of resetting on a new turn or rematch',
    htmlText.includes("const CAMERA_ZOOM_KEY = 'katamon_camera_zoom_v1';")
    && htmlText.includes('function loadCameraZoom()')
    && htmlText.includes('function saveCameraZoom()')
    && htmlText.includes('let cameraZoom = loadCameraZoom();')
    && !resetMatchSrc.includes('cameraZoom = DEFAULT_CAMERA_ZOOM;'));
  const functionSource = name => {
    const start = htmlText.indexOf(`function ${name}`);
    const end = htmlText.indexOf('\n  function ', start + 1);
    return start < 0 ? '' : htmlText.slice(start, end < 0 ? undefined : end);
  };
  const applySnapshotSrc = functionSource('applySnapshot(data, options = {})');
  const returnToTitleSrc = functionSource('returnToTitleFromResult()');
  const fullResetMatchSrc = functionSource('resetMatch(carrySpecialCharge)');
  check('snapshot apply, rematch, and result exit share one complete transient battle-state reset',
    htmlText.includes('function resetTransientBattleState()')
    && applySnapshotSrc.includes('resetTransientBattleState();')
    && fullResetMatchSrc.includes('resetTransientBattleState();')
    && returnToTitleSrc.includes('resetTransientBattleState();'));
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
    // 2vs2は1体倒れても試合は続く。「誰か倒れた」で待つと手番が二度と進まない。
    htmlText.includes("const waitingForPeerResult = isOnline() && !matchOver && (!teamAlive('player') || !teamAlive('cpu'));")
    && htmlText.includes('if (!waitingForPeerResult) endTurn(() => netSyncTurn(acted));'));
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
  // 段Bで s1/s2 は観戦席ではなく対戦者席になった(Issue #25)。送信できる席を4つへ開くが、
  // 「送れるのは席を実際に持っている本人だけ」という縛りは据え置き。
  check('rules let all four seats speak, and only the seat holder can speak as that seat',
    msg['.write'].includes("newData.child('seat').val() === 'p1' || newData.child('seat').val() === 'e1' || newData.child('seat').val() === 's1' || newData.child('seat').val() === 's2'")
    && msg['.write'].includes("root.child('rooms').child($room).child('slots').child(newData.child('seat').val()).child('uid').val() === auth.uid"));
  check('rules reserve host-only packets for p1',
    msg['.write'].includes("newData.child('t').val() !== 'settings'") && msg['.write'].includes("newData.child('seat').val() === 'p1'"));
  check('rules retain actionId and payload limits for fire/state/result',
    msg.$other['.validate'] === false && msg.actionId['.validate'].includes('{48}')
    && msg['.validate'].includes("'fire' && newData.hasChildren(['unitId','x','y','anchor','vx0','vy0','useSpecial','useJump','actionId'])")
    && msg['.validate'].includes("'state' && newData.hasChildren(['snap','actionId','unitId'])")
    && msg['.validate'].includes("'result' && newData.hasChildren(['winner','reason','units','actionId','unitId'])"));
  // 席と動かせるキャラを固定で結ぶ(p1→p1 / e1→e1 / s1→p2 / s2→e2)。
  // チーム分けを「誰がどのキャラか」の設定にすると、この一行でなりすましを封じられなくなる。
  check('rules bind each seat to exactly one unit, so nobody can move someone else',
    msg.unitId['.validate'].includes("newData.parent().child('seat').val() === 'p1' && newData.val() === 'p1'")
    && msg.unitId['.validate'].includes("newData.parent().child('seat').val() === 'e1' && newData.val() === 'e1'")
    && msg.unitId['.validate'].includes("newData.parent().child('seat').val() === 's1' && newData.val() === 'p2'")
    && msg.unitId['.validate'].includes("newData.parent().child('seat').val() === 's2' && newData.val() === 'e2'"));
  // 2vs2で空席をCPUが埋める時、そのCPUを動かす端末が必要になる(決定3)。
  // ホストに限り、誰も座っていない席のキャラを動かせる。座っている席へは手を出せない。
  check('the host may act for a seat nobody is sitting in, so CPU teammates can play',
    ['e1:e1', 'p2:s1', 'e2:s2'].every(pair => {
      const [unit, seat] = pair.split(':');
      return msg.unitId['.validate'].includes(`newData.parent().child('seat').val() === 'p1' && newData.val() === '${unit}' && !root.child('rooms').child($room).child('slots').child('${seat}').exists()`);
    }));
  check('the host still cannot act for a seat somebody is sitting in',
    // 例外はすべて !...exists() 付き。無条件にホストが他人のキャラを動かせる分岐は無い
    msg.unitId['.validate'].split('||')
      .filter(x => x.includes("val() === 'p1' &&") && !x.includes("newData.val() === 'p1'"))
      .every(x => x.includes('.exists()')));
  check('the round roster can name all four seats',
    ['p1', 'e1', 's1', 's2'].every(x => rules.round.players[x] && rules.round.players[x]['.validate'].includes('isString'))
    && rules.round.players.$other['.validate'] === false);
  check('rules bound the client timestamp on every packet',
    msg['.validate'].includes('now - 120000') && msg.sentAt['.validate'].includes('now + 120000'));
  check('rules permit heartbeat and presence without actionId',
    msg['.validate'].includes("newData.child('t').val() === 'ping'")
    && msg.t['.validate'].includes("newData.val() === 'ping'") && msg.t['.validate'].includes("newData.val() === 'presence'"));
  check('rules do not retain a persisted snapshot for mid-match spectators',
    !Object.hasOwn(rules.rounds.$roundId, 'latestSnapshot')
    && !htmlText.includes('latestSnapshot'));
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

  // ===== Issue #7: 退出済み・切断済みの席を安全に空ける =====
  // 従来は「席を消せるのは本人だけ」だったため、ブラウザを強制終了された席は誰にも
  // 消せず、ホストが居る限り部屋の期限も切れないので永久に残った。
  // 生存印(seenAt)を足し、それが途切れた席だけをホストが空けられるようにする。

  // ---- ルール側 ----
  const seatRule = seat['.write'];
  check('rules declare seenAt so the heartbeat is not rejected by the unknown-child guard',
    !!seat.seenAt && seat.seenAt['.validate'].includes('newData.isNumber()'));
  check('rules let the seat holder refresh only seenAt, keeping uid and claimedAt pinned',
    seatRule.includes("data.exists() && newData.exists() && data.child('uid').val() === auth.uid")
    && seatRule.includes("newData.child('uid').val() === data.child('uid').val()")
    && seatRule.includes("newData.child('claimedAt').val() === data.child('claimedAt').val()"));
  check('rules let p1 release a seat only when its heartbeat has gone stale',
    seatRule.includes("child('slots').child('p1').child('uid').val() === auth.uid && data.child('seenAt').isNumber() && data.child('seenAt').val() < now - 90000"));
  // v121(段D)でここを広げた。従来は status==='lobby' の時しか席を空けられず、
  // 試合中に落ちた人の席は誰にも空けられなかったため、CPUへ引き継ぐ道が無かった。
  // 広げたのは「いつ空けられるか」だけで、「誰が・どれだけ古い席を」は一切緩めていない。
  check('rules let the host release a stale seat during a match too, so a CPU can take it over',
    /\(\(root\.child\('rooms'\)\.child\(\$room\)\.child\('round'\)\.child\('status'\)\.val\(\) === 'lobby' \|\| root\.child\('rooms'\)\.child\(\$room\)\.child\('round'\)\.child\('status'\)\.val\(\) === 'playing'\) && data\.exists\(\) && !newData\.exists\(\) && root\.child\('rooms'\)\.child\(\$room\)\.child\('slots'\)\.child\('p1'\)/.test(seatRule));
  check('the widened release is still host-only and still needs a 90-second-old heartbeat',
    /=== 'playing'\) && data\.exists\(\) && !newData\.exists\(\) && root\.child\('rooms'\)\.child\(\$room\)\.child\('slots'\)\.child\('p1'\)\.child\('uid'\)\.val\(\) === auth\.uid && data\.child\('seenAt'\)\.isNumber\(\) && data\.child\('seenAt'\)\.val\(\) < now - 90000/.test(seatRule));
  // 準備・キャラ確認の最中は席を動かさない。ここまで広げると開始データと名簿が食い違う。
  check('a seat can still never be released while characters are being revealed',
    !seatRule.includes("=== 'revealing'"));
  check('rules still let a seat holder release their own seat, and nobody else do it blindly',
    seatRule.includes("data.exists() && !newData.exists() && data.child('uid').val() === auth.uid")
    // uid一致でも生存印が新しくてもない「無条件の削除」は一つも無い
    && !/!newData\.exists\(\)\)(?!.*seenAt)/.test(seatRule.split('||').filter(x => x.includes('!newData.exists()') && !x.includes("data.child('uid').val() === auth.uid") && !x.includes('seenAt')).join('')));
  check('the release window in the rules is far wider than the heartbeat interval',
    h.seatStaleReleaseMs() >= h.seatHeartbeatMs() * 4 && seatRule.includes(String(h.seatStaleReleaseMs())));
  check('the no-response warning fires before the server allows a release',
    h.lobbySeatStaleVisibleMs() < h.seatStaleReleaseMs());
  // 実機では45秒の画面側判定だけでボタンが出た一方、RulesはseenAtが90秒古くなるまで
  // 削除を許さず、「応答なし」なのに押すと「まだ応答あり」になった。
  check('the release button waits for a fresh server-side seenAt check',
    htmlText.includes('seatReleaseReady: {}')
    && /function canReleaseFirebaseSeat\(seat\)[\s\S]{0,420}online\.seatReleaseReady\[seat\]/.test(htmlText));
  check('the seat claim carries a heartbeat from the very first write',
    htmlText.includes("claimedAt: firebaseServerNow(auth), seenAt: { '.sv': 'timestamp' }"));
  check('the heartbeat writes a server timestamp, not a client clock',
    /slots\/\$\{seat\}\/seenAt`[\s\S]{0,220}'\.sv': 'timestamp'/.test(htmlText));
  // 電波不良時に小さな生存印の失敗を、部屋全体の取得で増幅させない。3回続いたら
  // 利用者へ知らせてハートビートを止め、Firebase直通信には共通の10秒上限を設ける。
  check('heartbeat retries only the slots roster, stops after three failures, and Firebase requests time out',
    htmlText.includes('const FIREBASE_REQUEST_TIMEOUT_MS = 10000;')
    && htmlText.includes('const FIREBASE_SEAT_HEARTBEAT_MAX_FAILURES = 3;')
    && /async function checkOwnFirebaseSeatLost\(\)[\s\S]{0,700}firebaseRequest\(`rooms\/\$\{checking\.room\}\/slots`/.test(htmlText)
    && !/async function checkOwnFirebaseSeatLost\(\)[\s\S]{0,700}firebaseRequest\(`rooms\/\$\{checking\.room\}`, checking\.auth\)/.test(htmlText)
    && /function scheduleFirebaseSeatHeartbeat\(\)[\s\S]{0,700}heartbeatStopped/.test(htmlText)
    && /function sendFirebaseSeatHeartbeat\(\)[\s\S]{0,1100}seatHeartbeatFailures[\s\S]{0,500}FIREBASE_SEAT_HEARTBEAT_MAX_FAILURES/.test(htmlText)
    && htmlText.includes("window.addEventListener('online', handleFirebaseNetworkOnline);")
    && htmlText.includes("window.addEventListener('offline', handleFirebaseNetworkOffline);"));
  const lobbyStateStart = htmlText.indexOf('function applyFirebaseLobbyState(msg)');
  const lobbyStateEnd = htmlText.indexOf('function resetLocalFirebaseRoundState(', lobbyStateStart);
  const lobbyStateSrc = lobbyStateStart >= 0 && lobbyStateEnd > lobbyStateStart
    ? htmlText.slice(lobbyStateStart, lobbyStateEnd) : '';
  check('an old lobby roster cannot evict a newly seated guest without checking Firebase slots',
    lobbyStateSrc.includes('const reportedMine = msg.slots[online.seat];')
    && lobbyStateSrc.includes("if (!reportedMine || reportedMine.uid !== online.auth.uid) {")
    && lobbyStateSrc.includes('void checkOwnFirebaseSeatLost();')
    && !/online\.slots = msg\.slots;[\s\S]{0,180}noticeOwnFirebaseSeatLost/.test(lobbyStateSrc));
  const seatLossStart = htmlText.indexOf('async function checkOwnFirebaseSeatLost()');
  const seatLossEnd = htmlText.indexOf('// 相手が座ったら', seatLossStart);
  const seatLossSrc = seatLossStart >= 0 && seatLossEnd > seatLossStart
    ? htmlText.slice(seatLossStart, seatLossEnd) : '';
  check('simultaneous stale lobby rosters share one Firebase seat-loss check',
    seatLossSrc.includes('online.seatLossChecking')
    && seatLossSrc.includes('checking.seatLossChecking = true;')
    && seatLossSrc.includes('checking.seatLossChecking = false;')
    && htmlText.includes('seatReleaseChecking: false, seatLossChecking: false'));
  check('the client uses the same strict 90-second seenAt boundary as the rules',
    !h.firebaseSeatHeartbeatAllowsRelease(200000, 200000 - h.seatStaleReleaseMs())
    && h.firebaseSeatHeartbeatAllowsRelease(200001, 200000 - h.seatStaleReleaseMs()));

  // ---- クライアント側: 誰の席をいつ空けられるか ----
  function fakeLobby({ role = 'host', phase = 'lobby', seat = 'p1', clockMs = 200000, seen = {}, releaseReady = {} } = {}) {
    return {
      kind: 'firebase', role, phase, seat, room: 'A2BC3DEF', auth: { uid: 'uid-p1' },
      slots: { p1: { uid: 'uid-p1' }, e1: { uid: 'uid-e1' }, s1: null, s2: { uid: 'uid-s2' } },
      lobbyLiveness: { clockMs, pingVisibleMs: 0, checkedAt: 0 },
      seatSeen: seen, seatStale: {}, seatReleaseReady: releaseReady, log: []
    };
  }
  const STALE = 200000 - h.lobbySeatStaleVisibleMs() - 1000; // 十分に古い
  const FRESH = 200000 - 1000;                               // ついさっき見えた

  h.setOnlineForLogTest(fakeLobby({ seen: { e1: STALE, s2: FRESH }, releaseReady: { e1: true } }));
  check('the host can release a seat that stopped responding', h.canReleaseFirebaseSeat('e1'));
  check('the host cannot release a seat that is still responding', !h.canReleaseFirebaseSeat('s2'));
  check('the host cannot release an empty seat', !h.canReleaseFirebaseSeat('s1'));
  check('nobody can release the host seat itself', !h.canReleaseFirebaseSeat('p1'));
  h.setOnlineForLogTest(fakeLobby({ seen: { e1: STALE } }));
  check('a no-response warning alone never exposes a button before the server check', !h.canReleaseFirebaseSeat('e1'));

  h.setOnlineForLogTest(fakeLobby({ role: 'guest', seat: 'e1', seen: { s2: STALE } }));
  check('a guest is never offered the release button', !h.canReleaseFirebaseSeat('s2'));

  h.setOnlineForLogTest(fakeLobby({ phase: 'playing', seen: { e1: STALE } }));
  check('no seat can be released while a match is running', !h.canReleaseFirebaseSeat('e1'));

  h.setOnlineForLogTest(fakeLobby({ phase: 'results', seen: { e1: STALE } }));
  check('no seat can be released on the results screen either', !h.canReleaseFirebaseSeat('e1'));

  // 二重タブ・画面ロック・短い回線断は「見えている時間」でしか進まないので、
  // 裏に回っている間に応答なしへ倒れない。既存の可視時間計測をそのまま使う。
  h.setOnlineForLogTest(fakeLobby({ seen: { e1: 200000 - h.lobbySeatStaleVisibleMs() + 1000 } }));
  check('a seat just short of the no-response threshold is left alone', !h.canReleaseFirebaseSeat('e1'));

  // ---- クライアント側: 空けられた本人が気づく ----
  const lost = fakeLobby({ role: 'guest', seat: 'e1' });
  lost.auth = { uid: 'uid-e1' };
  h.setOnlineForLogTest(lost);
  check('holding your own seat is not treated as being evicted', !h.ownFirebaseSeatIsLost());
  lost.slots = { ...lost.slots, e1: null };
  check('a removed seat is detected as an eviction', h.ownFirebaseSeatIsLost());
  lost.slots = { ...lost.slots, e1: { uid: 'someone-else' } };
  check('a seat re-taken by someone else is detected as an eviction', h.ownFirebaseSeatIsLost());
  check('the evicted player is sent back to the title with the reason kept on screen',
    htmlText.includes('showTitleNotice(reason)') && htmlText.includes('returnToTitleFromResult();')
    && htmlText.includes("応答が途切れたため、ホストに席を空けられました。"));
  check('the evicted player does not try to delete a seat that is no longer theirs',
    /noticeOwnFirebaseSeatLost[\s\S]{0,600}endOnline\(false, false\)/.test(htmlText));

  // ---- ハートビートを打つ席 ----
  h.setOnlineForLogTest(fakeLobby({ seat: 'p1' }));
  check('the host does not heartbeat: the rules never let p1 write to its own slot, and a dead host is collected by the room TTL',
    h.firebaseSeatHeartbeatTarget() === null);
  h.setOnlineForLogTest(fakeLobby({ role: 'guest', seat: 's2' }));
  check('spectator seats heartbeat too, so a ghost spectator can also be cleared',
    h.firebaseSeatHeartbeatTarget() === 's2');
  // ---- 席ボードに実際にボタンが出るか ----
  h.setOnlineForLogTest(fakeLobby({ seen: { e1: STALE, s2: FRESH }, releaseReady: { e1: true } }));
  const hostRows = h.renderLobbySeats();
  const rowText = hostRows.map(r => r.parts.join('|')).join('\n');
  check('the no-response seat shows a release button to the host',
    /seatReleaseBtn:この席を空ける/.test(rowText), rowText);
  check('exactly one release button is drawn: only the seat that stopped responding',
    (rowText.match(/seatReleaseBtn/g) || []).length === 1, rowText);
  h.setOnlineForLogTest(fakeLobby({ seen: { e1: STALE } }));
  const checkingRows = h.renderLobbySeats();
  check('the host sees a checking label instead of a button while seenAt is still fresh',
    checkingRows.some(r => r.parts.join('|').includes('切断確認中…'))
    && !checkingRows.some(r => r.parts.join('|').includes('seatReleaseBtn')));
  h.setOnlineForLogTest(fakeLobby({ role: 'guest', seat: 'e1', seen: { s2: STALE } }));
  const guestRows = h.renderLobbySeats();
  check('a guest sees the no-response mark but never a release button',
    guestRows.some(r => r.parts.join('|').includes('応答なし'))
    && !guestRows.some(r => r.parts.join('|').includes('seatReleaseBtn')));

  // ---- タイトルへ持ち越す理由の帯 ----
  h.setOnlineForLogTest(null);
  h.showTitleNotice('応答が途切れたため、ホストに席を空けられました。もう一度入り直してください。');
  check('the eviction reason survives the trip back to the title', h.titleNotice().includes('席を空けられました'));
  // 中断データを持ったままオンラインで席を空けられると、帯と吹き出しが同時に出る。
  const noticeBand = h.titleNoticeBand();
  const bubbleBand = h.saveBubbleBand();
  check('the title notice does not sit on top of the suspended-save bubble',
    noticeBand.bottom <= bubbleBand.top, JSON.stringify({ noticeBand, bubbleBand }));
  check('the title notice stays clear of the battle-mode label below it',
    noticeBand.bottom < h.titleModeLabelY(), JSON.stringify(noticeBand));
  app.setPhase('title');
  let titleThrew = null;
  try { app.render(); } catch (e) { titleThrew = e; }
  check('the title still draws with the notice on screen', !titleThrew, titleThrew && titleThrew.message);
  check('leaving online clears the heartbeat timer', htmlText.includes('if (leaving.seatHeartbeatTimer) clearTimeout(leaving.seatHeartbeatTimer);'));

  // ===== Issue #23: すぐ対戦を複数部屋のマッチメイキングにする =====
  // 部屋は原理的に探せない(ルートは読めず、部屋の中は席を持つ人だけ)。
  // 「空いて待っている部屋の合言葉」だけを open へ出し、そこから探しにいく。

  // ---- ルール側 ----
  const openRule = JSON.parse(rulesText).rules.open;
  check('rules add a readable index of waiting rooms without opening the rooms themselves',
    !!openRule && openRule['.read'] === 'auth != null'
    && rules['.read'].includes("child('uid').val() === auth.uid"));
  // open ごと欠けている場合でも、以降を落とさず個別のFAILとして出す
  // (ルールが古いまま公開されると全部が壊れるので、どれが欠けているか見えたほうがよい)。
  const openSeat = (openRule && openRule.$room) || { '.write': '', '.validate': '', format: {}, $other: {} };
  check('only the player actually sitting in p1 of that room can list it',
    openSeat['.write'].includes("newData.child('hostUid').val() === auth.uid")
    && openSeat['.write'].includes("root.child('rooms').child($room).child('slots').child('p1').child('uid').val() === auth.uid"));
  check('a listing can be withdrawn by its host, or by anyone once it has expired',
    openSeat['.write'].includes("data.exists() && !newData.exists() && (data.child('hostUid').val() === auth.uid || data.child('expiresAt').val() <= now)"));
  check('the index entry is shape-checked and cannot be parked far in the future',
    openSeat['.validate'].includes("hasChildren(['format','hostUid','hostName','roomName','playerCount','createdAt','expiresAt'])")
    && openSeat['.validate'].includes("newData.child('expiresAt').val() > now")
    && openSeat['.validate'].includes('now + 3600000')
    && openSeat.$other['.validate'] === false);
  check('the index only accepts the two match formats',
    openSeat.format['.validate'] === "newData.val() === '1v1' || newData.val() === '2v2'"
    && h.openMatchFormats().join(',') === '1v1,2v2');
  check('the room code shape is enforced on the index too',
    openSeat['.write'].includes('$room.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)'));
  check('listing a room requires that room to still be alive',
    openSeat['.write'].includes("root.child('rooms').child($room).child('expiresAt').val() > now"));
  // 既存の部屋のルールに触っていないこと(触ると入室・対戦が丸ごと壊れる)
  check('the rooms rules are untouched by the matchmaking change',
    rules.slots.$seat['.write'].includes("$seat.matches(/^(e1|s1|s2)$/)")
    && msg['.write'].includes("child('from').val() === auth.uid"));

  // ---- 候補の選び方 ----
  const NOW = 1000000;
  const A = 'AAAA2345', B = 'BBBB2345', C = 'CCCC2345', D = 'DDDD2345';
  const alive = (extra = {}) => ({ format: '1v1', hostUid: 'other', hostName: 'ホスト', roomName: 'だれでも歓迎', playerCount: 1, createdAt: 500, expiresAt: NOW + 1000, ...extra });
  check('a waiting room of the right format is a candidate',
    h.pickOpenCandidates({ [A]: alive() }, 'me', '1v1', NOW).map(r => r.code).join() === A);
  check('public room rows retain the host name, room name, and player count needed to choose a match',
    (() => { const row = h.pickOpenCandidates({ [A]: alive() }, 'me', '1v1', NOW)[0]; return row && row.hostName === 'ホスト' && row.roomName === 'だれでも歓迎' && row.playerCount === 1; })());
  check('an expired listing is never offered',
    h.pickOpenCandidates({ [A]: alive({ expiresAt: NOW - 1 }) }, 'me', '1v1', NOW).length === 0);
  check('a different match format is not offered',
    h.pickOpenCandidates({ [A]: alive({ format: '2v2' }) }, 'me', '1v1', NOW).length === 0);
  check('you are never sent into the room you are hosting yourself',
    h.pickOpenCandidates({ [A]: alive({ hostUid: 'me' }) }, 'me', '1v1', NOW).length === 0);
  check('a malformed room code or entry is ignored rather than throwing',
    h.pickOpenCandidates({ 'not-a-code': alive(), [B]: null, [C]: 'oops', [D]: alive() }, 'me', '1v1', NOW)
      .map(r => r.code).join() === D);
  // 待たせている時間が長い人から拾う。並びが安定しないと、同時に押した2人が同じ順で
  // 同じ部屋を狙い、片方が必ず競り負ける形になる。
  check('the longest-waiting room is offered first',
    h.pickOpenCandidates(
      { [A]: alive({ createdAt: 900 }), [B]: alive({ createdAt: 100 }), [C]: alive({ createdAt: 500 }) },
      'me', '1v1', NOW).map(r => r.code).join() === [B, C, A].join());
  const many = {};
  // 合言葉に使える文字だけで作る(I・O・1・0 は見間違い防止のため使われていない)
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < h.openMaxCandidates() + 8; i++) {
    many['ZZ' + CODE_CHARS[i % 32] + CODE_CHARS[(i * 7) % 32] + '2345'] = alive({ createdAt: i });
  }
  check('the number of rooms tried in one press is capped',
    h.pickOpenCandidates(many, 'me', '1v1', NOW).length === h.openMaxCandidates());
  check('an unknown format falls back to 1v1 rather than matching nothing',
    h.normalizeOpenFormat('3v3') === '1v1' && h.normalizeOpenFormat('2v2') === '2v2');
  check('the listing expiry matches the room lease, so a waiting room is not dropped early',
    h.openIndexTtlMs() === h.roomTtlMs() && h.roomLeaseRenewMs() < h.openIndexTtlMs());

  // ---- 待ち状態の出入り ----
  function quickHost({ phase = 'lobby', slots = { p1: { uid: 'uid-p1' } }, waiting = true, listed = true } = {}) {
    return {
      kind: 'firebase', role: 'host', phase, seat: 'p1', room: A, auth: { uid: 'uid-p1' },
      slots, quickWaiting: waiting, quickListed: listed, quickFormat: '1v1',
      lobbyLiveness: { clockMs: 0, pingVisibleMs: 0, checkedAt: 0 }, seatSeen: {}, seatStale: {}, log: []
    };
  }
  let host = quickHost();
  h.setOnlineForLogTest(host);
  h.syncQuickMatchListing();
  check('an empty room keeps waiting and stays listed', host.quickWaiting && host.quickListed);
  host.slots = { p1: { uid: 'uid-p1' }, e1: { uid: 'uid-e1' } };
  h.syncQuickMatchListing();
  check('the room stops waiting and is withdrawn once someone sits down',
    !host.quickWaiting && !host.quickListed);
  // 観戦席に誰か入っただけでも「相手が来た」扱いにする(4人戦で席が埋まるのは段B)。
  host = quickHost({ slots: { p1: { uid: 'uid-p1' }, s1: { uid: 'uid-s1' } } });
  h.setOnlineForLogTest(host);
  h.syncQuickMatchListing();
  check('a spectator does not hide an otherwise joinable 1vs1 room', host.quickWaiting);
  host = quickHost({ phase: 'playing' });
  h.setOnlineForLogTest(host);
  h.syncQuickMatchListing();
  check('a room that already left the lobby is not advertised as waiting', !host.quickWaiting);
  // ゲストは案内を取り下げられない(ルールがホスト本人か期限切れしか許さない)。
  const guest = quickHost();
  guest.role = 'guest'; guest.seat = 'e1';
  h.setOnlineForLogTest(guest);
  h.syncQuickMatchListing();
  check('a guest never touches the listing', guest.quickWaiting && guest.quickListed);
  h.setOnlineForLogTest(null);

  // ---- 逃げ道と後片付け ----
  // v101までは全員が同じ固定合言葉だったので隠していた。今は部屋ごとに違うので、
  // 待っている間こそ見せる(呼びたい相手へ直接伝えられる)。
  check('the passcode stays visible while waiting, so a friend can be invited straight in',
    !htmlText.includes('#onlineLobby.in-room.quickplay #onlineRoomCodeRow { display: none; }')
    && htmlText.includes('#onlineLobby.in-room #onlineRoomCodeRow { display: flex; }')
    && /onlineQuickButton[\s\S]{0,600}onlineRoomCodeEl\.textContent = code;/.test(htmlText));
  // 決定15を改定(2026-08-04・ユーザー判断)。「CPUで始める」は廃止した。
  // 1vs1でCPUと戦いたいならタイトルの CPU BATTLE がある。2vs2は対戦開始を押せば
  // 空席がそのままCPUになるので、部屋の中に別口の入り口を置くと導線が二重になる。
  // 自動では始めない(人が対戦開始を押す)という決定15の芯は変わっていない。
  check('the room has no second way to start; the host just presses start and empty seats become CPUs',
    !htmlText.includes('onlineQuickCpu')
    && !htmlText.includes('CPUで始める')
    && /onlineStartBtn\.disabled = !isFirebaseHost\(\) \|\| !allFirebasePlayersReady\(\)[\s\S]{0,100}online\.phase !== 'lobby' \|\| !!onlineCustomStageSelectionError\(\)/.test(htmlText));
  check('the listing is withdrawn from the single place every exit path goes through',
    /function endOnline[\s\S]{0,600}if \(leaving\.kind === 'firebase' && leaving\.quickListed\) unpublishOpenRoom\(leaving\.room, leaving\.auth\);/.test(htmlText));
  check('a room still waiting is re-listed alongside the room lease, so it does not expire out of the index',
    /renewFirebaseRoomLease[\s\S]{0,900}leasing\.quickWaiting && leasing\.quickListed[\s\S]{0,120}publishOpenRoom/.test(htmlText));
  check('failing to publish still leaves a usable room rather than aborting the match',
    /catch \(_\) \{[\s\S]{0,220}quickListed: false/.test(htmlText));
  check('the host learns someone arrived through the existing presence path',
    htmlText.includes("if (online && online.kind === 'firebase' && isFirebaseHost() && msg.seat !== 'p1') refreshFirebaseRoster(true);")
    && /refreshFirebaseRoster[\s\S]{0,400}syncQuickMatchListing\(\);/.test(htmlText));

  // ===== Issue #25 段B: 観戦席を対戦者席へ転用する（土台） =====
  h.setOnlineForLogTest(null);
  check('seats map to fixed units, so a seat can never move someone else’s monster',
    ['p1:p1', 'e1:e1', 's1:p2', 's2:e2'].every(pair => {
      const [seat, unit] = pair.split(':');
      return h.firebaseSeatUnitId(seat) === unit;
    }));
  check('the two spectator seats belong to opposite teams, so 2vs2 is 2 against 2',
    h.firebaseSeatTeam('p1') === 'player' && h.firebaseSeatTeam('s1') === 'player'
    && h.firebaseSeatTeam('e1') === 'cpu' && h.firebaseSeatTeam('s2') === 'cpu');
  check('the client mapping matches the mapping the rules enforce',
    ['p1', 'e1', 's1', 's2'].every(seat =>
      msg.unitId['.validate'].includes(`newData.parent().child('seat').val() === '${seat}' && newData.val() === '${h.firebaseSeatUnitId(seat)}'`)));

  function lobbyWith(format, seat = 'p1') {
    return {
      kind: 'firebase', role: seat === 'p1' ? 'host' : 'guest', phase: 'lobby', seat,
      room: 'A2BC3DEF', auth: { uid: 'uid-' + seat },
      settings: h.normalizeLobbySettings({ terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, revision: 1 }),
      slots: {}, participantRole: ['p1', 'e1'].includes(seat) ? 'player' : 'spectator',
      lobbyLiveness: { clockMs: 0, pingVisibleMs: 0, checkedAt: 0 }, seatSeen: {}, seatStale: {}, log: []
    };
  }
  h.setOnlineForLogTest(lobbyWith('1v1'));
  check('a 1vs1 lobby still has exactly two player seats',
    h.firebasePlayerSeats().join() === 'p1,e1' && !h.firebaseLobbyIs2v2());
  check('the 1vs1 seat labels are unchanged',
    [h.firebaseSeatLabel('p1'), h.firebaseSeatLabel('e1'), h.firebaseSeatLabel('s1')].join('/')
      === 'P1 ホスト/P2 対戦者/S1 観戦');
  h.setOnlineForLogTest(lobbyWith('2v2'));
  check('a 2vs2 lobby turns every seat into a player seat',
    h.firebasePlayerSeats().join() === 'p1,e1,s1,s2' && h.firebaseLobbyIs2v2());
  check('the 2vs2 seat labels are relative to the local player',
    [h.firebaseSeatLabel('p1'), h.firebaseSeatLabel('s1'), h.firebaseSeatLabel('e1'), h.firebaseSeatLabel('s2')].join('/')
      === 'P1 自分/P2 味方/E1 敵1/E2 敵2');
  // 対戦方式はホストから後から届く。届いた時点で s1 の人は観戦者から対戦者へ変わる。
  const late = lobbyWith('1v1', 's1');
  h.setOnlineForLogTest(late);
  h.syncFirebaseParticipantRole();
  check('sitting in s1 of a 1vs1 room is still spectating', late.participantRole === 'spectator');
  late.settings = h.normalizeLobbySettings({ ...late.settings, format: '2v2' });
  h.syncFirebaseParticipantRole();
  check('the same seat becomes a player once the host says the room is 2vs2',
    late.participantRole === 'player');
  check('and that player is put in charge of p2, not of the seat name',
    h.localUnitId() === 'p2');
  // e1 の人は1vs1でも2vs2でも「対戦者」のままなので役割が変わらない。ここで席を
  // 貼り直さないと、増えた p2/e2 は宣言時の control='cpu' のまま units へ入り、
  // ホストでない端末までCPUを動かし始める。
  {
    const e1Guest = lobbyWith('1v1', 'e1');
    h.setOnlineForLogTest(e1Guest);
    h.syncFirebaseParticipantRole();
    const before = app.controls();
    e1Guest.settings = h.normalizeLobbySettings({ ...e1Guest.settings, format: '2v2' });
    h.syncFirebaseParticipantRole();
    check('switching a room to 2vs2 re-seats a guest whose role did not change',
      before === 'p1:remote,e1:local' && app.controls() === 'p1:remote,e1:local,p2:remote,e2:remote');
  }
  h.setOnlineForLogTest(null);
  check('the lobby settings carry the match format, defaulting to 1vs1 for older peers',
    h.normalizeLobbySettings({}).format === '1v1'
    && h.normalizeLobbySettings({ format: '2v2' }).format === '2v2'
    && h.normalizeLobbySettings({ format: 'nonsense' }).format === '1v1');
  check('rules accept format and stage size in settings and nothing else new',
    rules.settings.format['.validate'] === "newData.val() === '1v1' || newData.val() === '2v2'"
    && rules.settings.stageSize['.validate'] === "newData.val() === 'standard' || newData.val() === 'large'"
    && rules.settings['.validate'].includes("'stageSize'")
    && rules.settings.$other['.validate'] === false);
  check('only the host can still change the settings, format included',
    rules.settings['.write'].includes("child('p1').child('uid').val() === auth.uid")
    && rules.settings['.write'].includes("child('status').val() === 'lobby'"));

  // ---- 4人ぶんの準備完了と、空席をCPUが埋めること（決定3） ----
  function seated(...seats) {
    const slots = {};
    for (const seat of ['p1', 'e1', 's1', 's2']) slots[seat] = seats.includes(seat) ? { uid: 'uid-' + seat } : null;
    return slots;
  }
  // v162までは全端末が p1,e1,s1,s2 の固定順だったため、ホスト以外では自分の行が
  // 先頭にならず、味方と敵の表示までホスト視点のままだった。実際のDOMを4席それぞれで
  // 組み立て、自分→味方→敵1→敵2の順と、その行に載る人物が一致することを固定する。
  function rendered2v2RowsFor(seat) {
    const o = lobbyWith('2v2', seat);
    o.slots = seated('p1', 'e1', 's1', 's2');
    o.seatNames = { p1: 'NAME-p1', e1: 'NAME-e1', s1: 'NAME-s1', s2: 'NAME-s2' };
    o.selfReady = false;
    o.seatReady = {};
    h.setOnlineForLogTest(o);
    return h.renderLobbySeats();
  }
  function renderedSeatPart(row, className) {
    const part = row.parts.find(text => text.includes(`:${className}:`));
    return part ? part.slice(part.indexOf(`:${className}:`) + className.length + 2) : '';
  }
  const relativeSeatTails = {
    p1: ['NAME-s1', 'NAME-e1', 'NAME-s2'],
    s1: ['NAME-p1', 'NAME-e1', 'NAME-s2'],
    e1: ['NAME-s2', 'NAME-p1', 'NAME-s1'],
    s2: ['NAME-e1', 'NAME-p1', 'NAME-s1']
  };
  for (const seat of ['p1', 's1', 'e1', 's2']) {
    const rows = rendered2v2RowsFor(seat);
    const labels = rows.map(row => renderedSeatPart(row, 'seatLabel'));
    const names = rows.map(row => renderedSeatPart(row, 'seatName'));
    check(`2vs2 ${seat} sees self, ally, enemy 1, enemy 2 in that order`,
      rows[0].cls.includes(' mine')
      && labels.join('/') === 'P1 自分/P2 味方/E1 敵1/E2 敵2'
      && names.slice(1).join('/') === relativeSeatTails[seat].join('/'));
  }
  const seatLabelCss = (htmlText.match(/\.onlineSeatRow \.seatLabel\s*\{([^}]*)\}/) || [])[1] || '';
  check('every occupied name and empty-seat label starts at the same horizontal position',
    /flex:\s*0 0 \d+px/.test(seatLabelCss)
    && /width:\s*\d+px/.test(seatLabelCss)
    && !/min-width:\s*\d+px/.test(seatLabelCss));
  function readyLobby(format, occupied, readySeats) {
    const o = lobbyWith(format, 'p1');
    o.slots = seated(...occupied);
    o.selfReady = readySeats.includes('p1');
    o.seatReady = {};
    for (const seat of readySeats) o.seatReady[seat] = true;
    return o;
  }
  h.setOnlineForLogTest(readyLobby('2v2', ['p1', 'e1', 's1', 's2'], ['p1', 'e1', 's1']));
  check('a 2vs2 room is not startable while one of the four is still choosing',
    !h.allFirebasePlayersReady());
  h.setOnlineForLogTest(readyLobby('2v2', ['p1', 'e1', 's1', 's2'], ['p1', 'e1', 's1', 's2']));
  check('a full 2vs2 room starts once all four are ready', h.allFirebasePlayersReady());
  // 空席は待たない。CPUが埋めるので、来ない人をいつまでも待たされない(決定3)。
  const short = readyLobby('2v2', ['p1', 'e1'], ['p1', 'e1']);
  h.setOnlineForLogTest(short);
  check('an empty seat never blocks the start; it is filled by a CPU',
    h.allFirebasePlayersReady() && h.firebaseCpuSeats().join() === 's1,s2'
    && h.firebaseOccupiedPlayerSeats().join() === 'p1,e1');
  h.setOnlineForLogTest(readyLobby('1v1', ['p1', 'e1'], ['p1']));
  check('1vs1 still waits for the one opponent', !h.allFirebasePlayersReady());
  h.setOnlineForLogTest(readyLobby('1v1', ['p1', 'e1'], ['p1', 'e1']));
  check('1vs1 starts when both are ready', h.allFirebasePlayersReady());
  // 1vs1で観戦者が座っていても、対戦者の準備完了には関係しない。
  h.setOnlineForLogTest(readyLobby('1v1', ['p1', 'e1', 's1'], ['p1', 'e1']));
  check('a spectator in a 1vs1 room is not counted as a player who must ready up',
    h.allFirebasePlayersReady() && h.firebaseOccupiedPlayerSeats().join() === 'p1,e1');
  h.setOnlineForLogTest(null);
  check('the empty seats are labelled as CPU in the lobby, not left looking vacant',
    htmlText.includes("state.textContent = 'CPUが担当';"));
  check('the start button follows the same all-ready rule the host code uses',
    /onlineStartBtn\.disabled = !isFirebaseHost\(\) \|\| !allFirebasePlayersReady\(\)[\s\S]{0,100}online\.phase !== 'lobby' \|\| !!onlineCustomStageSelectionError\(\)/.test(htmlText)
    && htmlText.includes("if (!isFirebaseHost() || online.phase !== 'lobby' || !allFirebasePlayersReady()) return;"));
  check('a rematch clears every seat’s ready state, not just the two 1vs1 ones',
    htmlText.includes("online.selfReady = false; online.peerReady = false; online.seatReady = {};"));
  check('the host announces the roster for whichever seats are actually taken',
    /const players = \{ p1: online\.clientId \};[\s\S]{0,260}firebasePlayerSeats\(\)[\s\S]{0,200}players\[seat\] = online\.slots\[seat\]\.uid;/.test(htmlText));

  // ===== Issue #26 段C: 4人ぶんの通信データ =====
  // 人数と並びは対戦方式で1通りに決まる。ここを緩めて好きな並びを送れるようにすると、
  // 「席とユニットの対応」というなりすまし防止の要を、通信データ側から崩せてしまう。
  function snapshotFor2v2(base) {
    const snap = JSON.parse(JSON.stringify(base));
    snap.matchFormat = '2v2';
    snap.units = ['p1', 'e1', 'p2', 'e2'].map((id, i) => ({ ...JSON.parse(JSON.stringify(base.units[i % 2])), id }));
    snap.turnOrder = ['p1', 'e1', 'p2', 'e2'];
    return snap;
  }
  const snap2v2 = snapshotFor2v2(safeSnap);
  const startOf = snap => ({ v: 2, from: 'peer', t: 'start', sentAt: Date.now(), snap });
  check('a four-unit snapshot is accepted when it names the 2vs2 format',
    h.validateFirebaseMessage(startOf(snap2v2)));
  check('the same four units are rejected while the snapshot still calls itself 1vs1',
    h.validateFirebaseMessageDetail(startOf({ ...snap2v2, matchFormat: '1v1' })).reason === 'start.snap.units'
    && h.validateFirebaseMessageDetail(startOf({ ...snap2v2, matchFormat: undefined })).reason === 'start.snap.units');
  check('an unknown match format is rejected instead of being guessed at',
    h.validateFirebaseMessageDetail(startOf({ ...snap2v2, matchFormat: '3v3' })).reason === 'start.snap.matchFormat');
  check('2vs2 fixes the turn order to p1 e1 p2 e2, so seats cannot be shuffled',
    h.validateFirebaseMessageDetail(startOf({ ...snap2v2, turnOrder: ['p1', 'p2', 'e1', 'e2'] })).reason === 'start.snap.turn'
    && h.validateFirebaseMessageDetail(startOf({ ...snap2v2, units: [snap2v2.units[0], snap2v2.units[2], snap2v2.units[1], snap2v2.units[3]] })).reason === 'start.snap.units');
  check('all four units are compared, not just the first two',
    h.stateSnapshotMismatchReason(snap2v2, snap2v2) === ''
    && h.stateSnapshotMismatchReason(snap2v2, safeSnap) === 'shape'
    && (() => {
      const drift = snapshotFor2v2(safeSnap);
      drift.units[3].x += 400;
      return h.stateSnapshotMismatchReason(drift, snap2v2) === `x.3(${Math.round(snap2v2.units[3].x)}->${Math.round(drift.units[3].x)})`;
    })());
  // 盤面を動かすパケットは p2 / e2 も名乗れる。知らないIDは従来どおり捨てる。
  const roundId2 = roundId;
  const packetFor = (seat, unitId, extra) => ({ v: 3, from: 'peer', seat, roundId: roundId2, sentAt: Date.now(), actionId, unitId, ...extra });
  const fireBody = { x: 720, y: 512, anchor: { x: 720, y: 512 }, vx0: 100, vy0: -200, useSpecial: false, useJump: false };
  check('fire, move and boom accept the two 2vs2 units and still reject unknown ids',
    h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'fire', ...fireBody }))
    && h.validateFirebaseMessage(packetFor('s2', 'e2', { t: 'move', x: 720, fuel: 40 }))
    && h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'boom' }))
    && !h.validateFirebaseMessage(packetFor('s1', 'p3', { t: 'fire', ...fireBody }))
    && !h.validateFirebaseMessage(packetFor('s1', 'p3', { t: 'boom' })));
  const roster2v2 = snap2v2.units.map(u => ({ id: u.id, hp: u.hp }));
  check('a result carries all four units in 2vs2 and keeps the fixed order',
    h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'state', snap: terrainDeltaFrom(snap2v2) }))
    && h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'result', winner: 'player', reason: '撃破', units: roster2v2 }))
    && !h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'result', winner: 'player', reason: '撃破', units: [roster2v2[0], roster2v2[2], roster2v2[1], roster2v2[3]] }))
    && !h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'result', winner: 'player', reason: '撃破', units: roster2v2.slice(0, 3) })));
  // 席とユニットの対応は、通信データの検証と席の門の両方で同じ表を使う。
  h.setOnlineForLogTest(lobbyWith('2v2'));
  check('s1 may only ever act as p2, in both the payload check and the seat gate',
    h.validateFirebaseMessage(packetFor('s1', 'p2', { t: 'state', snap: terrainDeltaFrom(snap2v2) }))
    && h.firebasePacketSeatAllowed(packetFor('s1', 'p2', { t: 'state', snap: terrainDeltaFrom(snap2v2) }))
    && !h.validateFirebaseMessage(packetFor('s1', 'e2', { t: 'state', snap: terrainDeltaFrom(snap2v2) }))
    && !h.firebasePacketSeatAllowed(packetFor('s1', 'e2', { t: 'state', snap: terrainDeltaFrom(snap2v2) })));
  // ホストは空席のキャラだけを動かせる。人が座っている席へは手を出せない。
  // ルール側の例外(!slots.$seat.exists())とまったく同じ条件をクライアントでも見る。
  {
    const hostLobby = lobbyWith('2v2');
    hostLobby.slots = seated('p1', 'e1');
    h.setOnlineForLogTest(hostLobby);
    const hostActs = unitId => packetFor('p1', unitId, { t: 'state', snap: terrainDeltaFrom(snap2v2) });
    check('the host may act for the empty seats and for nobody else’s',
      h.validateFirebaseMessage(hostActs('p2')) && h.firebasePacketSeatAllowed(hostActs('p2'))
      && h.validateFirebaseMessage(hostActs('e2')) && h.firebasePacketSeatAllowed(hostActs('e2'))
      && !h.validateFirebaseMessage(hostActs('e1')) && !h.firebasePacketSeatAllowed(hostActs('e1')));
    hostLobby.slots = seated('p1', 'e1', 's1', 's2');
    check('once someone sits down, the host loses the right to move that unit',
      !h.validateFirebaseMessage(hostActs('p2')) && !h.firebasePacketSeatAllowed(hostActs('p2'))
      && !h.firebasePacketSeatAllowed(hostActs('e2')));
    // 1vs1の部屋では例外そのものが無い。ホストは自分のキャラしか動かせない。
    const hostSolo = lobbyWith('1v1');
    hostSolo.slots = seated('p1');
    h.setOnlineForLogTest(hostSolo);
    check('a 1vs1 host never gains the empty-seat exception',
      !h.firebasePacketSeatAllowed({ ...packetFor('p1', 'e1', { t: 'state', snap: safeSnap }) })
      && h.firebasePacketSeatAllowed({ ...packetFor('p1', 'p1', { t: 'state', snap: safeSnap }) }));
  }
  h.setOnlineForLogTest(null);

  // ---- 手番の受け渡し(Issue #26 段C) ----
  // 空席のCPUは、ホストの端末だけが動かして結果を配る。ほかの端末は受け取る側なので
  // remote のまま置く。両方が動かすと、乱数の混ざった照準が端末ごとに別の結果になる。
  function seatedLobby(format, seat, occupied) {
    const o = lobbyWith(format, seat);
    o.slots = seated(...occupied);
    return o;
  }
  h.setMatchFormat('2v2');
  h.setOnlineForLogTest(seatedLobby('2v2', 'p1', ['p1', 'e1']));
  h.setOnlineSeat('p1');
  check('the host takes charge of the empty seats as CPUs, and of nobody else’s',
    app.controls() === 'p1:local,e1:remote,p2:cpu,e2:cpu');
  h.setOnlineForLogTest(seatedLobby('2v2', 's1', ['p1', 'e1', 's1']));
  h.setOnlineSeat('s1');
  check('a guest sits in its own unit and waits for every other one, CPU seats included',
    app.controls() === 'p1:remote,e1:remote,p2:local,e2:remote');
  check('only the device that drives a unit announces its moves and shots',
    h.netControlsUnit('p2') && !h.netControlsUnit('e2') && !h.netControlsUnit('p1'));
  h.setOnlineForLogTest(seatedLobby('2v2', 'p1', ['p1', 'e1', 's1', 's2']));
  h.setOnlineSeat('p1');
  check('a full room leaves the host in charge of one unit only',
    app.controls() === 'p1:local,e1:remote,p2:remote,e2:remote');
  // 呼び名は全員に同じものを出す。ホスト以外では control が remote に見えるため、
  // control だけで判断すると同じキャラが「CPU」と「相手」に分かれて表示される。
  h.setOnlineForLogTest(seatedLobby('2v2', 's1', ['p1', 's1']));
  h.setOnlineSeat('s1');
  check('an empty seat is called a CPU on every device, not just on the host',
    h.unitSeatIsCpu('e1') && h.unitSeatIsCpu('e2') && !h.unitSeatIsCpu('p1')
    && h.turnCutInLines('e1').sub === '相手のターン（CPU）'
    && h.turnCutInLines('p2').sub === 'あなたのターン');
  // v122まで、味方であるホストの手番が「相手のターン」と出ていた。呼び名が陣営を
  // 見ておらず「自分か・CPUか・それ以外」でしか分けていなかったため。
  check('your team-mate is called a team-mate, not an opponent',
    h.turnCutInLines('p1').sub === '味方のターン'
    && h.turnCutInLines('p1').color === h.turnCutInLines('p2').color
    && h.turnCutInLines('e1').color !== h.turnCutInLines('p2').color);
  h.setOnlineForLogTest(null);
  h.setMatchFormat('1v1');
  h.setOnlineSeat('e1');
  check('1vs1 seating is unchanged: one local unit and one remote unit',
    app.controls() === 'p1:remote,e1:local');
  h.setMatchFormat('1v1');
  // 発射の配信は1か所に集約する。人とCPUで別々に組み立てると、片方だけ
  // 直したときに「同じ弾道なのに片側だけ届かない」という壊れ方をする。
  check('the human shot and the CPU shot are announced through the same one place',
    (htmlText.match(/netSendFire\(/g) || []).length === 3
    && htmlText.includes('netSendFire(me, aimState.anchor, vx0, vy0, activateSpecial, activateJump, activateSubweapon);')
    && htmlText.includes('netSendFire(self, anchor, vx, vy, useSpecial, false);')
    && /function netSendFire\([\s\S]{0,600}if \(!isOnline\(\) \|\| !netControlsUnit\(unit\)\) return;/.test(htmlText));
  check('the turn-end authority and the result declaration follow the same rule',
    htmlText.includes('if (!netControlsUnit(actedUnit)) return;')
    && htmlText.includes('return !isOnline() || netControlsUnit(activeUnit());'));
  check('a CPU turn no longer flushes the local unit’s position as if it had moved',
    htmlText.includes('} else if (moveSyncPending && isLocalTurn()) {')
    && htmlText.includes('if (moveSyncPending && netControlsUnit(cpuActor)) {'));

  // ===== 段D: 切断・CPU引き継ぎ(Issue #8 / v121) =====
  // 試合中に落ちた席をCPUが引き継ぎ、残った人が最後まで遊べるようにする。
  // 席を空けてしまえば、あとは段Cの「空席はホストがCPUで動かして結果を配る」がそのまま働く。
  // 新しい通信の種類もスナップショットの追加項目も無い、というのがこの版の要。
  const SUSPECT = h.matchSeatSuspectMs();
  function matchLobby(format, seat, occupied, silent = {}) {
    const o = seatedLobby(format, seat, occupied);
    o.phase = 'playing';
    o.participantRole = 'player';
    o.matchSeatSilentMs = { ...silent };
    o.matchSeatCheckedAt = 0;
    o.matchSeatVerifyWaitMs = 0;
    o.matchSeatChecking = false;
    // 相手の無音がすでに打ち切りの線を越えている状態から始める。
    // 実時間を待たずに「まさに切ろうとしている瞬間」を作るため。
    o.peerLiveness = { peerVisibleMs: h.peerVisibleTimeoutMs(), pingVisibleMs: 0, checkedAt: 0 };
    o.pendingRemoteTerminals = new Map();
    o.completedRemoteActions = new Map();
    o.remoteAction = null;
    return o;
  }
  h.setMatchFormat('2v2');

  // ---- 誰の席を見張るか ----
  h.setOnlineForLogTest(matchLobby('2v2', 'p1', ['p1', 'e1', 's1']));
  check('the host watches every seated player except itself, and never an empty seat',
    h.firebaseMatchTakeoverSeats().join() === 'e1,s1');
  h.setOnlineForLogTest(matchLobby('2v2', 's1', ['p1', 'e1', 's1']));
  check('a guest watches the other guests but not its own seat',
    h.firebaseMatchTakeoverSeats().join() === 'e1');
  // ホスト席は生存印(seenAt)を持たない。90秒の確認ができないので引き継ぎの対象にできない。
  // ここを緩めると「確認できていない席を空ける」ことになるので、必ず除外し続けること。
  check('the host seat itself is never a takeover candidate, because it has no seenAt to verify',
    !h.firebaseMatchTakeoverSeats().includes('p1'));
  h.setOnlineForLogTest(matchLobby('1v1', 'p1', ['p1', 'e1']));
  check('1vs1 never hands a seat to a CPU: losing the only opponent ends the match as before',
    h.firebaseMatchTakeoverSeats().length === 0);
  const stillLobby = matchLobby('2v2', 'p1', ['p1', 'e1']);
  stillLobby.phase = 'lobby';
  h.setOnlineForLogTest(stillLobby);
  check('the lobby keeps its own manual release and never uses the match takeover',
    h.firebaseMatchTakeoverSeats().length === 0);

  // ---- 疑いの立て方 ----
  h.setOnlineForLogTest(matchLobby('2v2', 'p1', ['p1', 'e1', 's1'], { e1: SUSPECT - 1, s1: SUSPECT }));
  check('a seat one millisecond short of the silence threshold is not suspected yet',
    !h.firebaseMatchSeatSuspect('e1') && h.firebaseMatchSeatSuspect('s1'));
  check('one suspected seat is enough to say a takeover is being worked out',
    h.firebaseSeatTakeoverPending());
  h.noteFirebaseMatchSeatMessage('s1');
  check('a single packet from the seat cancels the suspicion immediately',
    !h.firebaseMatchSeatSuspect('s1') && !h.firebaseSeatTakeoverPending());
  // 45秒の警告が90秒の確認より先に来るのと同じ関係。疑いは必ず確認より早く立つ。
  check('the silence threshold is well inside the server window, so a takeover is always verified first',
    h.matchSeatSuspectMs() < h.seatStaleReleaseMs());

  // ---- 巻き添えで試合を切らない(この版の本題) ----
  // 従来は誰か1人が35秒無音になると、残った人まで含めて試合ごと打ち切っていた。
  const doomed = matchLobby('2v2', 'p1', ['p1', 'e1', 's1']);
  h.setOnlineForLogTest(doomed);
  h.updateFirebasePeerLiveness();
  check('with nobody suspected, a silent room still ends the match exactly as before',
    doomed.protocolError === '相手との通信が途切れました。' && doomed.phase === 'ended');
  const saved = matchLobby('2v2', 'p1', ['p1', 'e1', 's1'], { e1: SUSPECT });
  h.setOnlineForLogTest(saved);
  h.updateFirebasePeerLiveness();
  check('while a seat is being handed to a CPU, the other three players are not cut off with it',
    !saved.protocolError && saved.phase === 'playing');
  // 行動通知待ちの15秒も同じ扱いにする。片方だけ残すと、待っている間に別の理由で切れる。
  check('the action-notice timeout also waits for a takeover instead of ending the match',
    h.firebaseMatchSeatAwaitingTakeover('e1', 15000) && !h.firebaseMatchSeatAwaitingTakeover('p1', 15000));
  check('a seat that has only just gone quiet does not excuse a missing action notice',
    !h.firebaseMatchSeatAwaitingTakeover('s1', 15000));

  // ---- 引き継いだ後 ----
  // 席が消えた後の姿は段Cの空席とまったく同じ。だからこそ新しい仕組みが要らない。
  const afterHost = matchLobby('2v2', 'p1', ['p1', 'e1', 's1']);
  delete afterHost.slots.e1;
  h.setOnlineForLogTest(afterHost);
  h.setOnlineSeat('p1');
  check('once the seat is gone the host drives that character as a CPU, like any empty seat',
    app.controls() === 'p1:local,e1:cpu,p2:remote,e2:cpu' && h.netControlsUnit('e1'));
  check('the rules already let the host act for a freed seat: no rule change is needed for this part',
    h.firebaseHostActsForEmptySeat('p1', 'e1'));
  const afterGuest = matchLobby('2v2', 's1', ['p1', 'e1', 's1']);
  delete afterGuest.slots.e1;
  h.setOnlineForLogTest(afterGuest);
  h.setOnlineSeat('s1');
  check('the other devices call the taken-over character a CPU and keep waiting for the host',
    h.unitSeatIsCpu('e1') && h.turnCutInLines('e1').sub === '相手のターン（CPU）'
    && h.unitControl('e1') === 'remote' && !h.netControlsUnit('e1'));

  // ---- 手番の途中で引き継いだ場合 ----
  // 行動計画は startTurn でしか作られない。引き継ぎは手番の途中で起きるので、
  // 立て直さないとその手番だけ誰も動かず、試合がそこで止まってしまう。
  const midTurn = matchLobby('2v2', 'p1', ['p1', 'e1', 's1']);
  delete midTurn.slots.e1;
  midTurn.remoteAction = { unitId: 'e1', actionId: 'b'.repeat(48), from: 'peer-e1', resolved: false };
  h.setOnlineForLogTest(midTurn);
  h.setOnlineSeat('p1');
  h.clearCpuPlan();
  h.setActiveUnitForTest('e1');
  h.applyFirebaseSeatTakeover('e1');
  check('taking over mid-turn re-plans the CPU turn, so the match does not stall there',
    ['move', 'aim'].includes(h.cpuPlan().phase) && h.cpuPlan().think > 0);
  check('the dropped player’s unfinished action is dropped, or the next shot is refused as out of order',
    midTurn.remoteAction === null);
  check('everyone is told what happened instead of the turn silently changing hands',
    app.hasCutIn());

  // ---- 引き継げない時はきちんと諦める ----
  // FirebaseのRulesがまだ古い(Consoleへ反映する前)と、席の削除は必ず断られる。
  // 諦めないと打ち切りを抑えたまま待ち続け、残った人が試合から出られなくなる。
  const refused = matchLobby('2v2', 'p1', ['p1', 'e1', 's1'], { e1: SUSPECT });
  refused.matchSeatTakeoverFails = { e1: 3 };
  h.setOnlineForLogTest(refused);
  check('a seat that keeps refusing to be freed is given up on, not waited for forever',
    !h.firebaseMatchTakeoverSeats().includes('e1') && !h.firebaseSeatTakeoverPending());
  h.updateFirebasePeerLiveness();
  check('after giving up, the match ends the old way instead of hanging',
    refused.protocolError === '相手との通信が途切れました。');
  const recovered = matchLobby('2v2', 'p1', ['p1', 'e1', 's1'], { e1: SUSPECT });
  recovered.matchSeatTakeoverFails = { e1: 3 };
  h.setOnlineForLogTest(recovered);
  h.noteFirebaseMatchSeatMessage('e1');
  check('a seat that starts answering again is no longer written off for the rest of the match',
    h.firebaseMatchTakeoverSeats().includes('e1'));

  // ---- 引き継ぎを決めるのは常にサーバー時刻 ----
  check('the takeover reuses the same 90-second seenAt check as the lobby release',
    /async function verifyFirebaseMatchSeats\(\)[\s\S]{0,1400}firebaseSeatHeartbeatAllowsRelease\(serverNow, Number\(slot\.seenAt\)\)/.test(htmlText));
  check('the takeover only ever runs on the host',
    /async function verifyFirebaseMatchSeats\(\)\s*\{\s*if \(!isFirebaseHost\(\)/.test(htmlText));
  check('a room that cannot be read leaves everyone seated: no takeover on stale information',
    /async function verifyFirebaseMatchSeats\([\s\S]{0,1600}\} catch \(_\) \{[\s\S]{0,200}\}/.test(htmlText));
  check('a refused delete means the player is alive, so the silence count starts over',
    /async function takeOverFirebaseSeatWithCpu\([\s\S]{0,700}acting\.matchSeatSilentMs\[seat\] = 0;/.test(htmlText));
  check('the new roster is handed to everyone before the CPU picks up the seat',
    /async function takeOverFirebaseSeatWithCpu\([\s\S]{0,1200}refreshFirebaseRoster\(true\);[\s\S]{0,120}applyFirebaseSeatTakeover\(seat\);/.test(htmlText));
  check('a rematch starts from silence zero, so the last match cannot trigger a takeover',
    /online\.matchSeatSilentMs = \{\};\s*online\.matchSeatCheckedAt/.test(htmlText));
  // 画面ロック中の人を無音とみなさない。ロビー・対戦の既存2系統と同じ扱いに揃える。
  check('time spent with the tab hidden is not counted as silence',
    /function updateFirebaseMatchSeatTakeover\(\)[\s\S]{0,1200}if \(!hidden\) online\.matchSeatSilentMs\[seat\] \+= elapsed;/.test(htmlText));
  check('the players can see that a disconnect is being checked instead of a frozen screen',
    htmlText.includes('の切断を確認中…'));

  h.setOnlineForLogTest(null);
  h.setMatchFormat('1v1');

  // ---- 部屋の見た目(実機で「どれを押すのか毎回探す」と指摘) ----
  // ここは見た目なので最終判断は実機。テストは「一度直した区別が黙って消えないこと」を守る。
  //
  // いちばん効いたのは詳細度。一括指定が `#onlineLobbyButtons button`(id+要素)なので、
  // `#onlineStart` 単体で書くと負ける。実際に負けていて、実測では全ボタンが
  // 376x48px・15px の完全に同じ見た目のままだった。必ず #onlineLobbyButtons から書く。
  const lobbyButtonCss = /#onlineLobbyButtons #onlineStart,\s*\n\s*#onlineLobbyButtons #onlineRematch,\s*\n\s*#onlineLobbyButtons #onlineQuick \{([^}]*)\}/.exec(htmlText);
  const readyCss = /#onlineLobbyButtons #onlineReady \{([^}]*)\}/.exec(htmlText);
  const returnCss = /#onlineLobbyButtons #onlineReturnLobby \{([^}]*)\}/.exec(htmlText);
  check('the primary, secondary and quiet buttons are each written so they win over the shared rule',
    !!lobbyButtonCss && !!readyCss && !!returnCss);
  check('the three ranks really differ in height, not only in colour',
    !!lobbyButtonCss && lobbyButtonCss[1].includes('min-height: 64px')
    && !!readyCss && readyCss[1].includes('min-height: 52px')
    && !!returnCss && returnCss[1].includes('min-height: 40px'));
  check('only the main action is filled in; the rest stay outlines',
    !!lobbyButtonCss && lobbyButtonCss[1].includes('background: linear-gradient(180deg, #ffdf95')
    && !!readyCss && !readyCss[1].includes('background:')
    && !!returnCss && !returnCss[1].includes('background:'));
  check('the quiet button is also narrower, so it never lines up with the main one',
    !!returnCss && returnCss[1].includes('width: 74%'));
  check('a button that cannot be pressed no longer looks the same as one that can',
    htmlText.includes('#onlineLobbyButtons button:disabled { opacity: .32;'));
  // 「準備完了」と「準備完了を取り消す」は文字だけの違いだった。色でも分かるようにする。
  check('the ready toggle shows its state in the styling, not only in the label',
    htmlText.includes("onlineReadyBtn.classList.toggle('is-ready', !!online.selfReady);")
    && htmlText.includes('#onlineLobbyButtons #onlineReady.is-ready'));
  check('ready comes before start so the primary launch action stays at the bottom',
    htmlText.indexOf('<button id="onlineReady" type="button">準備完了</button>')
      < htmlText.indexOf('<button id="onlineStart" type="button">対戦開始</button>'));
  // 英数字の羅列だけでは何なのか分からない、という指摘。見出しを1つ添える。
  check('the room code says what it is',
    htmlText.includes('<span id="onlineRoomCodeLabel">部屋ID</span>')
    && htmlText.includes('#onlineRoomCodeLabel {')
    && htmlText.includes('placeholder="相手の部屋ID 8文字"')
    && !htmlText.includes('>合言葉を使う</button>'));
  // v168では主対戦を同じ盾意匠で一段に並べ、CPU／ONLINEを位置と文字で見分ける。
  check('the title presents CPU and ONLINE as separate side-by-side shield controls',
    htmlText.includes("shield: loadArtImage('title-shield-button'")
    && htmlText.includes("drawTitleWoodButtonText(titleVsCpuBtn, 'CPU BATTLE'")
    && htmlText.includes("drawTitleWoodButtonText(titleOnlineBtn, 'ONLINE BATTLE'"));

  // ---- 4人ぶんの伏せ合い(Issue #26 段C) ----
  // 実際の受信経路(netReceiveInner)へ commit / reveal を流し、席ごとに覚えられるか見る。
  // 自分は s1 のゲストにしておく。ホストにすると検証の成功がそのまま試合開始へ進んでしまう。
  function revealingLobby(occupied) {
    const o = seatedLobby('2v2', 's1', occupied);
    o.role = 'guest'; o.peerSeat = 'p1'; o.clientId = 'uid-s1'; o.currentRoundId = roundId;
    o.phase = 'lobby'; o.participantRole = 'player';
    o.selfCharacter = 'kyoryu'; o.selfNonce = 'a'.repeat(48); o.selfCommit = null; o.selfRevealed = false;
    o.seatCommit = {}; o.seatCommitAt = {}; o.seatRevealSeen = {}; o.seatCharacter = {}; o.seatNonce = {}; o.seatVerified = {};
    o.peerCommit = null; o.peerCommitAt = null; o.peerCommitted = false; o.peerRevealSeen = false; o.revealVerified = false;
    o.rematchVotes = {}; o.seatReady = {}; o.queue = []; o.pendingRemoteTerminals = new Map(); o.completedRemoteActions = new Map();
    o.peerLiveness = { peerVisibleMs: 0, pingVisibleMs: 0, checkedAt: 0 };
    o.unitCharacters = null; o.autoStartNextRound = false;
    return o;
  }
  const revealChars = { p1: 'kyoryu', e1: 'medama', s2: 'iwa' };
  const revealNonces = { p1: 'b'.repeat(48), e1: 'c'.repeat(48), s2: 'd'.repeat(48) };
  async function feedCommitsAndReveals(o, seats) {
    for (const seat of seats) {
      const hash = await h.commitPayload(revealChars[seat], revealNonces[seat]);
      h.receiveFirebaseForTest({ v: 3, from: 'uid-' + seat, seat, roundId, t: 'commit', sentAt: Date.now(), hash });
    }
    const committed = seats.map(seat => o.seatCommit[seat]);
    for (const seat of seats) {
      h.receiveFirebaseForTest({ v: 3, from: 'uid-' + seat, seat, roundId, t: 'reveal', sentAt: Date.now(), character: revealChars[seat], nonce: revealNonces[seat] });
    }
    // 公開の検証はSHA-256を待つ非同期処理。決着まで数回まわして落ち着かせる。
    for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
    return committed;
  }
  {
    const o = revealingLobby(['p1', 'e1', 's1', 's2']);
    h.setOnlineForLogTest(o);
    o.selfCommit = await h.commitPayload('kyoryu', o.selfNonce);
    o.selfRevealed = true;
    const committed = await feedCommitsAndReveals(o, ['p1', 'e1', 's2']);
    check('all three other players are remembered separately, not overwritten by the last one',
      committed.every(Boolean) && new Set(committed).size === 3
      && o.seatCharacter.p1 === 'kyoryu' && o.seatCharacter.e1 === 'medama' && o.seatCharacter.s2 === 'iwa'
      && !o.error);
    check('a 2vs2 room is ready to start only once every seated player has revealed',
      h.allFirebasePlayersCommitted() && h.allFirebaseRevealsVerified() && h.firebaseRevealsReady());
  }
  {
    // 途中まで。まだ公開していない人が残っている間は開始へ進まない。
    const o = revealingLobby(['p1', 'e1', 's1', 's2']);
    h.setOnlineForLogTest(o);
    o.selfCommit = await h.commitPayload('kyoryu', o.selfNonce);
    o.selfRevealed = true;
    await feedCommitsAndReveals(o, ['p1', 'e1']);
    check('one silent player still holds the room, even though the other two are done',
      !h.allFirebasePlayersCommitted() && !h.firebaseRevealsReady()
      && h.firebaseSeatRevealVerified('p1') && !h.firebaseSeatRevealVerified('s2'));
  }
  {
    // 空席のCPUはコミットも公開もしない。人が座っている席だけがそろえばよい(決定3)。
    const o = revealingLobby(['p1', 's1']);
    h.setOnlineForLogTest(o);
    o.selfCommit = await h.commitPayload('kyoryu', o.selfNonce);
    o.selfRevealed = true;
    await feedCommitsAndReveals(o, ['p1']);
    check('empty seats never have to commit, so two people can start a 2vs2 against CPUs',
      h.allFirebasePlayersCommitted() && h.firebaseRevealsReady() && h.firebaseCpuSeats().join() === 'e1,s2');
    // 開始データは、人が座っている席のキャラだけを伏せ合いと突き合わせる。
    // 空席のCPUのキャラはホストが決めるので、知らないキャラでないことだけ見る。
    const startSnap = snapshotFor2v2(safeSnap);
    const charOf = { p1: 'kyoryu', e1: 'medama', p2: 'kyoryu', e2: 'iwa' };
    for (const u of startSnap.units) u.character = charOf[u.id];
    check('the host may pick the CPU monsters, but never someone else’s',
      h.firebaseStartCharactersMatch(startSnap)
      && !h.firebaseStartCharactersMatch({ ...startSnap, units: startSnap.units.map(u => u.id === 'p1' ? { ...u, character: 'iwa' } : u) })
      && h.firebaseStartCharactersMatch({ ...startSnap, units: startSnap.units.map(u => u.id === 'e1' ? { ...u, character: 'tori' } : u) })
      && !h.firebaseStartCharactersMatch({ ...startSnap, units: startSnap.units.map(u => u.id === 'e1' ? { ...u, character: 'nonsense' } : u) }));
    // 再戦は全員が押す(決定11)。空席のCPUは数えない。
    o.rematchVotes = { p1: true };
    check('a rematch needs every seated player, and does not wait for the CPU seats',
      !h.allFirebaseRematchVotesIn() && (() => { o.rematchVotes.s1 = true; return h.allFirebaseRematchVotesIn(); })());
  }
  // ---- 決着と再戦(Issue #26 段C) ----
  // ホストは全員が開始データを受け取るまで撃てない。1人でも取りこぼしたまま撃つと、
  // その人だけ違う盤面から始まってしまう。
  {
    const o = revealingLobby(['p1', 'e1', 's1']);
    o.role = 'host'; o.seat = 'p1'; o.peerSeat = 'e1'; o.clientId = 'uid-p1';
    o.phase = 'starting'; o.startAcks = {}; o.matchStarted = true;
    h.setOnlineForLogTest(o);
    h.receiveFirebaseForTest({ v: 3, from: 'uid-e1', seat: 'e1', roundId, t: 'ready', sentAt: Date.now() });
    const afterOne = o.phase;
    h.receiveFirebaseForTest({ v: 3, from: 'uid-s1', seat: 's1', roundId, t: 'ready', sentAt: Date.now() });
    check('the host stays locked until every seated player has the start data',
      afterOne === 'starting' && o.phase === 'playing');
  }
  check('a host with nobody else seated unlocks itself, instead of waiting for an ack that never comes',
    htmlText.includes('if (firebaseOccupiedPlayerSeats().every(seat => seat === online.seat)) online.phase = \'playing\';'));

  // ---- v104の実機で見つかった3件 ----
  // 対戦方式のドロップダウンだけ change が繋がっておらず、2vs2を選んでも一切送られて
  // いなかった。次の描画で `1 vs 1` へ戻るだけで、席の名前も1vs1のままだった。
  check('the match-format dropdown actually sends the change, like the other settings',
    htmlText.includes('[onlineTerrainEl, onlineWindEl, onlineTurnsEl, onlineFormatEl, onlineStageSizeEl].forEach(el => { if (el) el.addEventListener(\'change\''));
  // ほかに人が座っていない2vs2(1人＋CPU3体)では、検証する相手の公開が届かない。
  // 開始の合図が verifyPeerReveal からしか出ていなかったため、試合が始まらなかった。
  check('a lone host still starts the match, without waiting for a reveal that never arrives',
    /function maybeRevealCharacter\(\)[\s\S]{0,700}maybeStartFirebaseMatch\(\);/.test(htmlText));
  // 実機で「再戦できない」。認証の更新に一度失敗すると、以降の書き込みが全部401で
  // 落ち続け、再戦の準備すら作れなくなっていた。401は「鍵の期限切れ」と「ルール拒否」の
  // 両方で返るので、鍵を取り直して本当に新しくなった時だけ送り直す。
  check('an expired key is renewed and the write is sent once more, instead of failing for good',
    /async function firebaseRequest\([\s\S]{0,900}if \(response\.status === 401\) \{[\s\S]{0,400}const renewed = await ensureFirebaseAuth\(\)\.catch\(\(\) => null\);[\s\S]{0,200}renewed\.idToken !== before[\s\S]{0,200}response = await firebaseFetchWithTimeout\(firebaseRequestUrl\(path, auth, query\), fetchOptions\);/.test(htmlText));
  check('a rules rejection is not mistaken for an expired key, so it never loops on the token endpoint',
    // force しない = 期限内なら同じ鍵が返る = 送り直さずそのまま失敗する
    /async function firebaseRequest\([\s\S]{0,900}ensureFirebaseAuth\(\)\.catch/.test(htmlText)
    && !/async function firebaseRequest\([\s\S]{0,900}ensureFirebaseAuth\(true\)/.test(htmlText));
  // 実機で「再戦に時間がかかる」。再戦の自動開始が「誰かのready/commitを受け取った時」
  // しか走らず、相手がCPUだけの部屋では誰も送ってこないので毎回手で押す必要があった。
  // v105の「1人だと試合が始まらない」と同じ、受信経路にしか合図が無かった取りこぼし。
  check('a lone host’s rematch starts on its own, without an incoming packet to trigger it',
    /async function commitOwnCharacter\(\)[\s\S]{0,900}maybeAutoStartFirebaseRound\(\);/.test(htmlText)
    && (htmlText.match(/maybeAutoStartFirebaseRound\(\);/g) || []).length === 3);
  // 実機で「4手番ぶん遊べたのに35秒で中断」。生存確認は「相手のパケットが届かなければ
  // 切る」作りだが、相手がCPUだけの部屋では永久に何も届かない。待つ相手が居るかを先に見る。
  {
    function playingLobby(occupied) {
      const o = revealingLobby(occupied);
      o.role = 'host'; o.seat = 'p1'; o.peerSeat = 'e1'; o.clientId = 'uid-p1';
      o.phase = 'playing'; o.protocolError = '';
      // すでに時間切れの手前まで積んだ状態から始める。1フレーム進めば必ず判定に届く。
      o.peerLiveness = { peerVisibleMs: 10 * 60 * 1000, pingVisibleMs: 0, checkedAt: 0 };
      o.transport = { close: () => {} };
      return o;
    }
    const alone = playingLobby(['p1']);
    h.setOnlineForLogTest(alone);
    h.updateFirebasePeerLiveness();
    check('a room where every opponent is a CPU is never cut off for silence',
      !h.firebaseHasSeatedOpponent() && alone.protocolError === '' && alone.phase === 'playing');
    const withPeer = playingLobby(['p1', 'e1']);
    h.setOnlineForLogTest(withPeer);
    h.updateFirebasePeerLiveness();
    check('a real opponent going silent still cuts the match off',
      h.firebaseHasSeatedOpponent() && withPeer.protocolError === '相手との通信が途切れました。');
  }
  // 1vs1の空席はCPUが埋めない(相手が来ないと開始できない)。出すと誤解させる。
  {
    const cpuBadgeLobby = seatedLobby('2v2', 'p1', ['p1']);
    h.setOnlineForLogTest(cpuBadgeLobby);
    const twoVsTwo = h.renderLobbySeats().map(r => r.parts.join('|')).join('\n');
    cpuBadgeLobby.settings = h.normalizeLobbySettings({ ...cpuBadgeLobby.settings, format: '1v1' });
    const oneVsOne = h.renderLobbySeats().map(r => r.parts.join('|')).join('\n');
    check('the CPU badge appears only where a CPU really takes over',
      (twoVsTwo.match(/CPUが担当/g) || []).length === 3
      && !oneVsOne.includes('CPUが担当'));
  }

  // ---- 端末内の相手別戦績(Issue #5 / v162) ----
  // まずこの入口だけを追加した状態で現行版を走らせ、機能が無いので実際にFAILすることを確認する。
  // 以降は実装が存在する時だけ進め、古い版でもハーネスの例外で出力全体が消えないようにする。
  const battle = h.battleRecordFeature();
  check('the device-local rival record feature exists', !!battle);
  if (battle) {
    battle.reset();
    const rawDeviceId = 'local-device-id-1234';
    const rivalId = await battle.deriveRivalId(rawDeviceId);
    const expectedRivalId = require('crypto').createHash('sha256').update(`katamon-rival-v1:${rawDeviceId}`).digest('hex');
    const identity = await battle.identityFields(rawDeviceId, 'メロニキ');
    check('rivalId is a purpose-separated SHA-256 value, never the raw device ID',
      rivalId === expectedRivalId && /^[0-9a-f]{64}$/.test(rivalId)
      && identity.rivalId === rivalId && identity.name === 'メロニキ'
      && !JSON.stringify(identity).includes(rawDeviceId));
    check('only presence and lobbyState accept a well-formed rivalId',
      h.validateFirebaseMessage(firebasePacket('presence', { rivalId, seat: 'e1' }))
      && h.validateFirebaseMessage(firebasePacket('lobbyState', { rivalId, status: 'lobby' }))
      && !h.validateFirebaseMessage(firebasePacket('presence', { rivalId: 'bad', seat: 'e1' }))
      && !h.validateFirebaseMessage(firebasePacket('ready', { rivalId })));

    const rivalA = 'a'.repeat(64);
    const rivalB = 'b'.repeat(64);
    const winRound = '1'.repeat(48);
    check('a win is recorded once and an identical result resend is ignored',
      battle.record({ matchId: winRound, outcome: 'win', character: 'kyoryu', rivals: [{ id: rivalA, name: 'ライバルA' }], reason: '撃破', playedAt: 1000 })
      && !battle.record({ matchId: winRound, outcome: 'win', character: 'kyoryu', rivals: [{ id: rivalA, name: 'ライバルA' }], reason: '撃破', playedAt: 1001 }));
    check('a rematch with a new round ID is counted, including a timeout loss',
      battle.record({ matchId: '2'.repeat(48), outcome: 'loss', character: 'medama', rivals: [{ id: rivalA, name: 'ライバルA' }], reason: '時間切れ', playedAt: 2000 }));
    check('a draw against another opponent is kept separately',
      battle.record({ matchId: '3'.repeat(48), outcome: 'draw', character: 'kyoryu', rivals: [{ id: rivalB, name: 'ライバルB' }], reason: '相討ち', playedAt: 3000 }));
    const recorded = battle.snapshot();
    check('lifetime, character and opponent totals all use the local player perspective',
      recorded.total.wins === 1 && recorded.total.losses === 1 && recorded.total.draws === 1
      && recorded.characters.kyoryu.wins === 1 && recorded.characters.kyoryu.draws === 1
      && recorded.characters.medama.losses === 1
      && recorded.rivals[rivalA].wins === 1 && recorded.rivals[rivalA].losses === 1
      && recorded.rivals[rivalB].draws === 1);
    battle.reload();
    const afterReload = battle.snapshot();
    check('the same browser profile keeps its records after a reload',
      afterReload.total.wins === 1 && afterReload.total.losses === 1 && afterReload.total.draws === 1
      && afterReload.rivals[rivalA].name === 'ライバルA');
    check('host and guest read the same team result from opposite perspectives',
      battle.outcomeForSeat('player', 'p1') === 'win'
      && battle.outcomeForSeat('player', 's1') === 'win'
      && battle.outcomeForSeat('player', 'e1') === 'loss'
      && battle.outcomeForSeat('player', 's2') === 'loss'
      && battle.outcomeForSeat('draw', 'e1') === 'draw');
    const beforeCpuOnly = JSON.stringify(battle.snapshot());
    check('an all-CPU opponent team creates no pretend human record',
      !battle.record({ matchId: '4'.repeat(48), outcome: 'win', character: 'kyoryu', rivals: [], reason: '撃破', playedAt: 4000 })
      && JSON.stringify(battle.snapshot()) === beforeCpuOnly);

    const lobby = seatedLobby('1v1', 'p1', ['p1', 'e1']);
    lobby.seatNames = { e1: 'ライバルA' };
    lobby.seatRivalIds = { e1: rivalA };
    lobby.selfCharacter = 'kyoryu';
    lobby.roundRivals = null;
    lobby.roundOpponentSeats = null;
    h.setOnlineForLogTest(lobby);
    const roomRecordText = battle.renderLobbyText();
    check('the room shows lifetime, selected-monster and opponent records without sending their values',
      roomRecordText.includes('この端末の対人戦績')
      && roomRecordText.includes('通算')
      && roomRecordText.includes('ディラノ')
      && roomRecordText.includes('ライバルA')
      && roomRecordText.includes('1勝') && roomRecordText.includes('1敗'));
    battle.freezeRoundRivals();
    lobby.phase = 'results';
    const resultRows = battle.resultRows();
    check('the result screen has both the lifetime and current-opponent records',
      resultRows.some(row => row.includes('通算'))
      && resultRows.some(row => row.includes('ライバルA')));

    localStorage.setItem(battle.key(), '{broken json');
    battle.reload();
    const recovered = battle.snapshot();
    check('a corrupted local record recovers to an empty safe shape',
      recovered.total.wins === 0 && recovered.total.losses === 0 && recovered.total.draws === 0
      && Object.keys(recovered.rivals).length === 0 && recovered.processedRoundIds.length === 0);
    const lateIdentityLobby = seatedLobby('1v1', 'p1', ['p1', 'e1']);
    lateIdentityLobby.phase = 'results';
    lateIdentityLobby.currentRoundId = '5'.repeat(48);
    lateIdentityLobby.roundOpponentSeats = ['e1'];
    lateIdentityLobby.roundRivals = [];
    lateIdentityLobby.unitCharacters = { p1: 'kyoryu', e1: 'medama' };
    h.setOnlineForLogTest(lateIdentityLobby);
    battle.setResultState('player', '撃破');
    battle.rememberIdentity({ seat: 'e1', rivalId: rivalA, name: '遅れて届いた相手' });
    const lateRecorded = battle.snapshot();
    check('an identity packet arriving after the result still records that round once',
      lateRecorded.total.wins === 1 && lateRecorded.rivals[rivalA]?.wins === 1);
    battle.setResultState(null, '', false);
    check('Firebase Rules accept only a 64-character lowercase rivalId on identity packets',
      rulesText.includes('"rivalId": { ".validate": "(newData.parent().child(\'t\').val() === \'presence\' || newData.parent().child(\'t\').val() === \'lobbyState\')')
      && rulesText.includes('newData.val().matches(/^[0-9a-f]{64}$/)'));
    check('record values never appear in any Firebase packet path',
      !/netSend\(\{[^}]*\b(?:wins|losses|draws|battleRecord)\b/.test(htmlText)
      && !rulesText.includes('"wins"') && !rulesText.includes('"losses"') && !rulesText.includes('"draws"'));
    check('the Canvas result banner actually draws the record rows',
      /function drawResultBanner\(\)[\s\S]{0,4200}firebaseBattleRecordResultRows\(\)/.test(htmlText));
  }
  // v119: 開始データを受け取る側にもVSカットインを出す。
  // resetMatch を通るのはホストだけなので、ここを落とすとタブ2つのQAで
  // 「配る側には出るが、受け取る側には出ない」という左右差になる。
  check('the Firebase host starts the VS cut-in only after the lobby closes',
    /async function maybeStartFirebaseMatch\(\)[\s\S]{0,2600}closeOnlineLobby\(\);[\s\S]{0,300}showBattleStartCutIn\(\);/.test(htmlText));
  check('a Firebase guest shows the VS cut-in after accepting the verified start snapshot',
    /async function applyFirebaseStart\(msg\)[\s\S]{0,1700}applySnapshot\(msg\.snap\);[\s\S]{0,450}showBattleStartCutIn\(\);/.test(htmlText));
  check('the loopback guest also shows the VS cut-in after applying the start snapshot',
    /case 'start':[\s\S]{0,900}applySnapshot\(msg\.snap\);[\s\S]{0,300}showBattleStartCutIn\(\);/.test(htmlText));
  check('a spectator sees the same VS cut-in when the match starts',
    /function applyFirebaseSpectatorSnapshot\(msg\)[\s\S]{0,500}showBattleStartCutIn\(\);/.test(htmlText));

  // 起動前・タイトル・ロビーで端末の戻る操作を押しても、確認なしでアプリを抜けない。
  check('the device back trap stays armed outside battle too',
    /function backTrapWanted\(\) \{\s*return exitBackSteps === 0;\s*\}/.test(htmlText));
  check('the unused canvas yes/no confirmation path is fully removed while device back confirmation remains',
    !htmlText.includes('function openConfirmDialog(')
    && !htmlText.includes('function drawConfirmDialog(')
    && !htmlText.includes('let confirmDialog = null')
    && htmlText.includes('function openDeviceBackConfirm()'));
  check('non-battle screens and an open online room use the global exit confirmation',
    /if \(gamePhase !== 'battle' \|\| roomScreenOpen\(\)\) \{\s*openDeviceBackConfirm\(\);/.test(htmlText));
  check('the global exit confirmation is above every game overlay and has two explicit choices',
    htmlText.includes('#deviceBackConfirm {')
    && htmlText.includes('z-index: 200')
    && htmlText.includes('id="deviceBackStay"')
    && htmlText.includes('id="deviceBackExit"'));
  check('CloseWatcher cancels the close request before showing the in-game confirmation',
    /new window\.CloseWatcher\(\)[\s\S]{0,500}addEventListener\('cancel',[\s\S]{0,240}event\.preventDefault\(\);[\s\S]{0,160}handleDeviceBackRequest\(\);/.test(htmlText));
  check('explicit exit counts legacy same-app entries and requests only one history traversal',
    /function confirmedDeviceExitHistoryDelta\(\)[\s\S]{0,1400}normalizedDeviceBackAppLocation\(entries\[index\]\.url\)/.test(htmlText)
    && /function continueConfirmedDeviceExit\(historyDelta = 1\)[\s\S]{0,260}history\.go\(-Math\.max\(1, historyDelta\)\)/.test(htmlText)
    && /function confirmDeviceExit\(\)[\s\S]{0,300}exitBackSteps = 1;[\s\S]{0,120}destroyDeviceBackCloseWatcher\(\);[\s\S]{0,300}continueConfirmedDeviceExit\(historyDelta\);/.test(htmlText));
  check('standalone launch attempts window close instead of relying on a missing back entry',
    /function closeStandaloneDeviceBackWindow\(\)[\s\S]{0,500}window\.close\(\);[\s\S]{0,450}if \(closeStandaloneDeviceBackWindow\(\)\)/.test(htmlText));
  check('fallback reload reuses an existing Katamon guard instead of stacking another one',
    /function armBackTrap\(\)[\s\S]{0,220}history\.state && history\.state\.katamonGuard === true[\s\S]{0,100}backTrapDepth = 1;/.test(htmlText));
  const deadLineSource = htmlText.match(/function drawDeadLine\(\)[\s\S]*?\n  \}/)?.[0] || '';
  check('DEAD LINE uses layered strokes instead of an expensive shadow blur across the screen',
    deadLineSource.includes('const glowLayers = [')
    && deadLineSource.includes('lineWidth: 11')
    && deadLineSource.includes('lineWidth: 6')
    && deadLineSource.includes('lineWidth: 2.5')
    && !deadLineSource.includes('shadowBlur'));
  const pointFromEventSource = htmlText.match(/function canvasPointFromEvent\(e\)[\s\S]*?\n  \}/)?.[0] || '';
  check('pointer coordinates reuse bounds refreshed by resize instead of measuring layout for every move',
    htmlText.includes('let cachedCanvasBounds = null;')
    && /function resize\(\)[\s\S]{0,1800}cachedCanvasBounds = canvas\.getBoundingClientRect\(\);/.test(htmlText)
    && pointFromEventSource.includes('const rect = cachedCanvasBounds;')
    && !pointFromEventSource.includes('getBoundingClientRect'));
  const controlPanelSource = htmlText.match(/function drawControlPanel\(\)[\s\S]*?\n  \}/)?.[0] || '';
  check('the static control panel is built once offscreen and battle frames only blit it',
    htmlText.includes('const controlPanelCanvas = document.createElement(\'canvas\');')
    && htmlText.includes('function rebuildControlPanelArt()')
    && controlPanelSource.includes('rebuildControlPanelArt();')
    && controlPanelSource.includes('ctx.drawImage(controlPanelCanvas, 0, CONTROL_PANEL_Y);')
    && /rebuildControlPanelArt\(\);[\s\S]{0,100}ctx\.drawImage\(controlPanelCanvas, 0, CONTROL_PANEL_Y\);[\s\S]{0,100}return;/.test(controlPanelSource));
  const parallaxSource = htmlText.match(/function drawParallax\(\)[\s\S]*?\n  \}/)?.[0] || '';
  check('static parallax hills are built once offscreen while clouds stay live',
    htmlText.includes("const farHillCanvas = document.createElement('canvas');")
    && htmlText.includes("const nearHillCanvas = document.createElement('canvas');")
    && htmlText.includes('function rebuildHillArt()')
    && parallaxSource.includes('rebuildHillArt();')
    && parallaxSource.includes('ctx.drawImage(farHillCanvas, -200, 0);')
    && parallaxSource.includes('ctx.drawImage(nearHillCanvas, -200, 0);')
    && parallaxSource.includes('drawClouds();'));
  const updateSource = htmlText.match(/function update\(dt\)[\s\S]*?\n  \}/)?.[0] || '';
  const physicsSource = htmlText.match(/function stepWorldPhysics\(dt\)[\s\S]*?\n  \}/)?.[0] || '';
  const barucopterImpactSource = htmlText.match(/function resolveBarucopterBulletSurfaceImpact\([\s\S]*?\n  \}/)?.[0] || '';
  check('terrain rim redraws are queued across physics substeps and flushed once per frame',
    htmlText.includes('function queueTerrainRimRebuild()')
    && htmlText.includes('function flushTerrainRimRebuild()')
    && updateSource.includes('flushTerrainRimRebuild();')
    && physicsSource.includes('queueTerrainRimRebuild();')
    && !physicsSource.includes('rebuildTerrainRim();')
    && barucopterImpactSource.includes('queueTerrainRimRebuild();')
    && !barucopterImpactSource.includes('rebuildTerrainRim();'));
  const gameLoopSource = htmlText.match(/function gameLoop\(ts\)[\s\S]*?\n  \}/)?.[0] || '';
  check('quiet battle waiting draws at 30fps but active battle remains at full rate',
    htmlText.includes('const IDLE_BATTLE_FRAME_MS = 1000 / 30;')
    && htmlText.includes('function canUseIdleBattleFrameRate()')
    && gameLoopSource.includes('canUseIdleBattleFrameRate()')
    && gameLoopSource.includes('IDLE_BATTLE_FRAME_MS'));
  const terrainCanvasSource = htmlText.match(/const terrainCanvas = document\.createElement\('canvas'\);[\s\S]*?function stageDimensionsFor/)?.[0] || '';
  check('terrain-only offscreen canvases stop at the terrain bottom instead of reserving the control-panel area',
    (terrainCanvasSource.match(/\.height = TERRAIN_BOTTOM_Y;/g) || []).length === 7
    && !terrainCanvasSource.includes('.height = VH;'));
  const snapshotSource = htmlText.match(/function buildSnapshot\(options = \{\}\)[\s\S]*?\n  \}/)?.[0] || '';
  const netSyncTurnSource = htmlText.match(/function netSyncTurn\(actedUnit\)[\s\S]*?\n  \}/)?.[0] || '';
  check('turn-boundary state omits immutable terrain while match start keeps the complete base terrain',
    snapshotSource.includes('const includeTerrain = options.includeTerrain !== false;')
    && snapshotSource.includes('if (includeTerrain) {')
    && netSyncTurnSource.includes('buildSnapshot({ includeTerrain: false })')
    && htmlText.includes('applySnapshot(msg.snap, { preserveTerrain: true });'));
  check('30fps idle battle frames preserve a full 1/30-second fixed-step budget',
    gameLoopSource.includes('const dt = Math.min(0.034, (ts - lastTime) / 1000);'));
  check('the battle wind console puts its 0-to-10 number directly inside the current-wind arrow',
    htmlText.includes('const windStrengthScale = Math.round(wind.strength * 10);')
    && htmlText.includes("const windTitle = calmWind ? '無風' : '現在の風';")
    && htmlText.includes("calmWind ? '無風' : windStrengthScale")
    && htmlText.includes("drawOutlinedText(windTitle, cx, roundCenterY - inner * 0.70"));
  h.setOnlineForLogTest(null);
  h.setMatchFormat('1v1');

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exitCode = fail ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
