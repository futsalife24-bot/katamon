// ループバック対戦テストの「1タブぶん」。loopbacktest.js から fork される。
// ゲーム本体をこのプロセスで1つだけ動かし、通信は親経由で相手プロセスへ中継する。
// (harness は globalThis にゲームを展開するので、1プロセスに2インスタンスは置けない)
const h = require('./seatharness.js');
const kt = h.kt();
const canvas = h.canvas;
const win = globalThis.window;

const role = process.argv[3] === 'guest' ? 'guest' : 'host';

// 通信層の差し替え。BroadcastChannel の代わりに親プロセスへ投げる。
let inbound = null;
kt.setTransport(() => ({
  send: (msg) => process.send({ kind: 'net', msg }),
  onMessage: (fn) => { inbound = fn; },
  close: () => { inbound = null; }
}));

let pid = 1;
let usedSpecial = 0;
let guardHits = 0;
// 必殺を構えてから撃つ。必殺はカットインを挟んで pendingShot に保留されるので、
// この経路を通しておかないと「保留中にリモート状態が届く」状況を再現できない。
function armSpecial() {
  if (!kt.specialReady()) return false;
  const sb = kt.specialBtn();
  const id = pid++;
  canvas.__fire('pointerdown', { pointerId: id, clientX: sb.x, clientY: sb.y, pointerType: 'mouse', timeStamp: Date.now(), button: 0 });
  win.__fire('pointerup', { pointerId: id, clientX: sb.x, clientY: sb.y, pointerType: 'mouse', timeStamp: Date.now() });
  usedSpecial++;
  return true;
}
function fire() {
  const fb = kt.fireBtn();
  const toRight = kt.foeUnit().x > kt.localUnit().x;
  const ex = fb.x + (toRight ? -70 : 70);
  const ey = fb.y + 55;
  const id = pid++;
  canvas.__fire('pointerdown', { pointerId: id, clientX: fb.x, clientY: fb.y, pointerType: 'mouse', timeStamp: Date.now(), button: 0 });
  canvas.__fire('pointermove', { pointerId: id, clientX: ex, clientY: ey, pointerType: 'mouse', timeStamp: Date.now() });
  win.__fire('pointerup', { pointerId: id, clientX: ex, clientY: ey, pointerType: 'mouse', timeStamp: Date.now() });
}

function snapshotForCompare() {
  return {
    phase: kt.state().gamePhase,
    matchOver: kt.state().matchOver,
    winner: kt.state().winner,
    turnCount: kt.state().turnCount,
    activeIndex: kt.state().activeIndex,
    active: kt.activeUnit().id,
    seat: kt.seat(),
    controls: kt.controls(),
    units: kt.unitState(),
    craters: kt.craters(),
    wind: kt.wind(),
    online: kt.onlineState(),
    inputLocked: kt.inputLocked(),
    pending: kt.pending(),
    charges: kt.charges(),
    usedSpecial,
    mode: kt.mode(),
    streak: kt.streak(),
    hasSave: kt.hasSave(),
    projectiles: kt.projectiles().length,
    cutIn: kt.hasCutIn()
  };
}

process.on('message', (cmd) => {
  switch (cmd.kind) {
    case 'boot':
      kt.setPhase('title');   // 開発用の入口はタイトルに着いてから開く仕様
      kt.beginOnline(role);
      process.send({ kind: 'ready' });
      break;
    case 'net':
      if (inbound) inbound(cmd.msg);
      break;
    case 'step': {
      // 自分の手番が回ってきていたら1回だけ撃つ。あとは時間を進めるだけ。
      let fired = false;
      for (let i = 0; i < cmd.frames; i++) {
        if (cmd.autoFire && kt.hud().fireActive && !fired) {
          if (cmd.autoSpecial) armSpecial();
          fire();
          fired = true;
        }
        // 保留中にキューが溜まっている瞬間を数える(二重発射のガードが効いている証拠)
        if (kt.pending() && kt.onlineState() && kt.onlineState().queued > 0) guardHits++;
        kt.step(1 / 60);
        kt.render();
      }
      process.send({ kind: 'stepped', fired, guardHits, state: snapshotForCompare() });
      break;
    }
    // 「必殺の保留(pendingShot)中に相手のターン境界スナップショットが届く」状況を
    // 偶然のタイミングに頼らず狙って作る。ここで状態を適用してしまうと、
    // 保留していた弾があとから別のターンへ撃ち込まれる(二重発射)。
    case 'probe': {
      kt.fillCharges(); // 1手番目から必殺を撃てるようにする
      let guard = 0;
      while (!kt.hud().fireActive && guard++ < 6000) { kt.step(1 / 60); kt.render(); }
      const armed = armSpecial();
      fire();
      const pendingAfterFire = kt.pending();
      inbound({ v: kt.proto(), from: 'probe-peer', t: 'state', snap: kt.snapshot() });
      const queuedAfterInject = kt.onlineState().queued;
      let sawPending = false;
      let appliedWhilePending = false;
      for (let i = 0; i < 240; i++) {
        if (kt.pending()) {
          sawPending = true;
          if (kt.onlineState().queued === 0) appliedWhilePending = true;
        }
        kt.step(1 / 60);
        kt.render();
      }
      process.send({
        kind: 'probed', armed, pendingAfterFire, queuedAfterInject,
        sawPending, appliedWhilePending,
        drainedAfter: kt.onlineState() ? kt.onlineState().queued : null,
        state: snapshotForCompare()
      });
      break;
    }
    // 相手から壊れたメッセージが届いた体で流し込む(プロトコル不一致の検証用)
    case 'inject':
      if (inbound) inbound(cmd.msg);
      kt.step(1 / 60);
      process.send({ kind: 'injected', state: snapshotForCompare() });
      break;
    // 画面のどこかを1回叩く(相手退出・バージョン不一致の抜け道の検証用)
    case 'tap': {
      const id = pid++;
      canvas.__fire('pointerdown', { pointerId: id, clientX: 270, clientY: 300, pointerType: 'mouse', timeStamp: Date.now(), button: 0 });
      win.__fire('pointerup', { pointerId: id, clientX: 270, clientY: 300, pointerType: 'mouse', timeStamp: Date.now() });
      kt.step(1 / 60);
      process.send({ kind: 'tapped', state: snapshotForCompare() });
      break;
    }
    case 'state':
      process.send({ kind: 'state', state: snapshotForCompare() });
      break;
    case 'leave':
      kt.endOnline(true);
      process.send({ kind: 'left', state: snapshotForCompare() });
      break;
    case 'quit':
      process.exit(0);
      break;
  }
});
