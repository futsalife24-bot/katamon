// Stage 2b: ループバック対戦の検証。
// ゲーム本体を2つの子プロセス(host / guest)で動かし、親が通信を中継する。
// 中継のときに遅延とパケットロスを注入して、対戦ロジックが耐えるかを見る。
// 使い方: node tests/loopbacktest.js
const path = require('path');
const { fork } = require('child_process');

const FRAMES_PER_ROUND = 10; // 1ラウンド ≒ 166ms
const MAX_ROUNDS = 900;

let pass = 0, fail = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) { pass++; log.push(`  ok   ${name}`); }
  else { fail++; log.push(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(name) { log.push(`\n[${name}]`); }

// ---- 2プロセスを立てて中継する土台 ----
function makePeer(role) {
  const child = fork(path.join(__dirname, 'peer.js'), ['--role', role], { silent: false });
  const peer = { role, child, outbox: [], waiters: new Map() };
  child.on('message', (m) => {
    if (m.kind === 'net') { peer.outbox.push(m.msg); return; }
    const w = peer.waiters.get(m.kind);
    if (w) { peer.waiters.delete(m.kind); w(m); }
  });
  peer.ask = (msg, replyKind) => new Promise((res) => {
    peer.waiters.set(replyKind, res);
    child.send(msg);
  });
  return peer;
}

// delayRounds ぶん配達を遅らせ、dropEvery 個に1つ落とす。
async function runSession({ delayRounds = 0, dropEvery = 0, autoSpecial = false, label }) {
  section(label);
  const host = makePeer('host');
  const guest = makePeer('guest');
  const inflight = []; // { to, msg, dueRound }
  let sent = 0, dropped = 0;
  let round = 0;

  const relay = (from, to) => {
    for (const msg of from.outbox) {
      sent++;
      if (dropEvery > 0 && sent % dropEvery === 0) { dropped++; continue; }
      inflight.push({ to, msg, dueRound: round + delayRounds });
    }
    from.outbox.length = 0;
  };
  const deliver = () => {
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].dueRound > round) continue;
      const { to, msg } = inflight.splice(i, 1)[0];
      to.child.send({ kind: 'net', msg });
    }
  };

  await Promise.all([host.ask({ kind: 'boot' }, 'ready'), guest.ask({ kind: 'boot' }, 'ready')]);

  let hostState = null, guestState = null;
  let connectedAtRound = -1;
  let sawGuestFire = false, sawHostFire = false;
  let guardHits = 0;

  for (round = 0; round < MAX_ROUNDS; round++) {
    relay(host, guest);
    relay(guest, host);
    deliver();
    const [h, g] = await Promise.all([
      host.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: true, autoSpecial }, 'stepped'),
      guest.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: true, autoSpecial }, 'stepped')
    ]);
    hostState = h.state; guestState = g.state;
    if (h.fired) sawHostFire = true;
    if (g.fired) sawGuestFire = true;
    guardHits = h.guardHits + g.guardHits;
    if (connectedAtRound < 0 && hostState.online && guestState.online
        && hostState.online.phase !== 'waiting' && guestState.online.phase !== 'waiting') {
      connectedAtRound = round;
      // ---- 接続直後の状態 ----
      check('ホストは p1 の席', hostState.seat === 'p1', hostState.seat);
      check('ゲストは e1 の席', guestState.seat === 'e1', guestState.seat);
      // controls は units の並び順(p1, e1)で出る。席が変わるのは local/remote の側。
      check('ホスト側の相手は remote', hostState.controls === 'p1:local,e1:remote', hostState.controls);
      check('ゲスト側の相手は remote', guestState.controls === 'p1:remote,e1:local', guestState.controls);
      check('両方が戦闘画面に入る',
        hostState.phase === 'battle' && guestState.phase === 'battle',
        `${hostState.phase}/${guestState.phase}`);
      check('地形の破壊履歴が一致して始まる', hostState.craters === guestState.craters,
        `${hostState.craters}/${guestState.craters}`);
      check('キャラが一致して始まる',
        JSON.stringify(hostState.units.map(u => u.ch)) === JSON.stringify(guestState.units.map(u => u.ch)),
        `${hostState.units.map(u => u.ch)} / ${guestState.units.map(u => u.ch)}`);
      check('風が一致して始まる', JSON.stringify(hostState.wind) === JSON.stringify(guestState.wind),
        `${JSON.stringify(hostState.wind)}/${JSON.stringify(guestState.wind)}`);
    }
    if (hostState.matchOver && guestState.matchOver) break;
  }

  check('相手待ちから接続まで進む', connectedAtRound >= 0, 'つながらなかった');
  check('両方が撃っている', sawHostFire && sawGuestFire, `host=${sawHostFire} guest=${sawGuestFire}`);
  check('試合が決着する', hostState.matchOver && guestState.matchOver,
    `host=${hostState.matchOver} guest=${guestState.matchOver} round=${round}`);
  check('勝敗が食い違わない', hostState.winner === guestState.winner,
    `host=${hostState.winner} guest=${guestState.winner}`);
  check('決着時のHPが一致する',
    JSON.stringify(hostState.units.map(u => u.hp)) === JSON.stringify(guestState.units.map(u => u.hp)),
    `${JSON.stringify(hostState.units.map(u => u.hp))} / ${JSON.stringify(guestState.units.map(u => u.hp))}`);

  // 対人戦は連勝にもランキングにも中断セーブにも触らない
  check('連勝を積まない', hostState.streak === 0 && guestState.streak === 0,
    `host=${hostState.streak} guest=${guestState.streak}`);
  check('中断セーブを作らない', hostState.hasSave === false && guestState.hasSave === false,
    `host=${hostState.hasSave} guest=${guestState.hasSave}`);

  // 退出すると相手に伝わる
  await host.ask({ kind: 'leave' }, 'left');
  relay(host, guest);
  round += delayRounds; deliver();
  const g2 = await guest.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: false }, 'stepped');
  check('退出が相手に伝わる', g2.state.online === null || g2.state.online.peerLeft === true,
    JSON.stringify(g2.state.online));

  if (dropEvery > 0) check('パケットを実際に落としている', dropped > 0, String(dropped));
  if (autoSpecial) {
    check('必殺を実際に撃っている',
      hostState.usedSpecial + guestState.usedSpecial > 0,
      `host=${hostState.usedSpecial} guest=${guestState.usedSpecial}`);
  }

  host.child.send({ kind: 'quit' });
  guest.child.send({ kind: 'quit' });
  return { rounds: round, sent, dropped };
}

// 必殺の保留中にリモート状態が届くケースは、偶然のタイミング待ちだと安定して踏めない。
// 接続だけ済ませてから、狙ってその瞬間を作る。
async function runGuardProbe() {
  section('必殺の保留中にリモート状態が届く');
  const host = makePeer('host');
  const guest = makePeer('guest');
  let round = 0;
  const relayBoth = () => {
    for (const [from, to] of [[host, guest], [guest, host]]) {
      for (const msg of from.outbox) to.child.send({ kind: 'net', msg });
      from.outbox.length = 0;
    }
  };
  await Promise.all([host.ask({ kind: 'boot' }, 'ready'), guest.ask({ kind: 'boot' }, 'ready')]);
  let connected = false;
  for (round = 0; round < 60 && !connected; round++) {
    relayBoth();
    const [h, g] = await Promise.all([
      host.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: false }, 'stepped'),
      guest.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: false }, 'stepped')
    ]);
    connected = h.state.online && g.state.online
      && h.state.online.phase === 'playing' && g.state.online.phase === 'playing';
  }
  check('プローブ用の接続ができる', connected);

  const r = await host.ask({ kind: 'probe' }, 'probed');
  check('必殺を構えて撃てている', r.armed === true);
  check('必殺が保留(pendingShot)になる', r.pendingAfterFire === true);
  check('保留中に届いた状態はキューに積まれる', r.queuedAfterInject === 1, String(r.queuedAfterInject));
  check('保留中は状態を適用しない(二重発射しない)', r.appliedWhilePending === false);
  check('保留が明けたあとにキューが流れる', r.drainedAfter === 0, String(r.drainedAfter));
  check('保留していた弾はきちんと解決する', r.state.pending === false && r.state.projectiles === 0,
    `pending=${r.state.pending} projectiles=${r.state.projectiles}`);

  host.child.send({ kind: 'quit' });
  guest.child.send({ kind: 'quit' });
}

// 新旧クライアントが混ざったとき。相手が知らないバージョンを送ってきたら、
// 黙って壊れた解釈をせずに「アプリを更新してください」へ倒す。
async function runVersionProbe() {
  section('プロトコル不一致');
  const host = makePeer('host');
  const guest = makePeer('guest');
  const relayBoth = () => {
    for (const [from, to] of [[host, guest], [guest, host]]) {
      for (const msg of from.outbox) to.child.send({ kind: 'net', msg });
      from.outbox.length = 0;
    }
  };
  await Promise.all([host.ask({ kind: 'boot' }, 'ready'), guest.ask({ kind: 'boot' }, 'ready')]);
  let connected = false;
  for (let r = 0; r < 60 && !connected; r++) {
    relayBoth();
    const [h, g] = await Promise.all([
      host.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: false }, 'stepped'),
      guest.ask({ kind: 'step', frames: FRAMES_PER_ROUND, autoFire: false }, 'stepped')
    ]);
    connected = h.state.online && g.state.online
      && h.state.online.phase === 'playing' && g.state.online.phase === 'playing';
  }
  check('プローブ用の接続ができる', connected);

  const inj = await guest.ask(
    { kind: 'inject', msg: { v: 999, from: 'future-client', t: 'state', snap: null } },
    'injected'
  );
  check('未知のバージョンを検出する', inj.state.online && inj.state.online.versionMismatch === true,
    JSON.stringify(inj.state.online));
  check('未知のバージョンのメッセージは適用しない', inj.state.online && inj.state.online.queued === 0,
    JSON.stringify(inj.state.online));

  const tapped = await guest.ask({ kind: 'tap' }, 'tapped');
  check('タップでタイトルへ抜けられる',
    tapped.state.online === null && tapped.state.phase === 'title',
    `online=${JSON.stringify(tapped.state.online)} phase=${tapped.state.phase}`);

  host.child.send({ kind: 'quit' });
  guest.child.send({ kind: 'quit' });
}

(async () => {
  const a = await runSession({ label: '遅延なし・ロスなし' });
  const b = await runSession({ delayRounds: 3, label: '遅延 約500ms' });
  const c = await runSession({ delayRounds: 12, label: '遅延 約2秒' });
  const d = await runSession({ delayRounds: 3, dropEvery: 7, label: '遅延500ms + 7通に1通ロス' });
  const e = await runSession({ delayRounds: 3, autoSpecial: true, label: '遅延500ms + 必殺あり' });
  await runGuardProbe();
  await runVersionProbe();

  console.log('\n=== loopback ===');
  console.log(log.join('\n'));
  console.log(`\n中継したメッセージ数: ${[a, b, c, d, e].map(r => r.sent).join(' / ')}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
