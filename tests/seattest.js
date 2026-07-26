// Stage 2a「視点の切り離し」の自動検証。
// 席を p1(通常) と e1(オンライン対戦のゲスト想定) に切り替えて、
// 入力・HUD・結果画面がすべて席側を向いているかを確かめる。
// 使い方: node seattest.js p1  /  node seattest.js e1
const h = require('./seatharness.js');
const kt = h.kt();
const canvas = h.canvas;
const win = globalThis.window;
const SEAT = h.SEAT;

let pass = 0, fail = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) { pass++; log.push(`  ok   ${name}`); }
  else { fail++; log.push(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// 指の上げ下げ(座標は仮想座標=クライアント座標と1:1)
// カットイン中は進行が止まるので、明けるまで時間を進める。
function settle(maxFrames = 600) {
  let n = 0;
  while (kt.hasCutIn() && n++ < maxFrames) kt.step(1 / 60);
  return n;
}

let pid = 1;
function down(x, y) { const id = pid++; canvas.__fire('pointerdown', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: Date.now(), button: 0 }); return id; }
function move(id, x, y) { canvas.__fire('pointermove', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: Date.now() }); }
function up(id, x, y) { win.__fire('pointerup', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: Date.now() }); }

// ---- 1. 席とユニットの対応 ----
const foeSeat = SEAT === 'p1' ? 'e1' : 'p1';
check('席が URL のとおり', kt.seat() === SEAT, `seat=${kt.seat()}`);
check('localUnit() が自席', kt.localUnit().id === SEAT, kt.localUnit().id);
check('foeUnit() が相手', kt.foeUnit().id === foeSeat, kt.foeUnit().id);
check('control は席にだけ local', kt.units.filter(u => u.control === 'local').map(u => u.id).join() === SEAT,
  kt.units.map(u => `${u.id}:${u.control}`).join(','));

// ---- 2. 試合を開始 ----
kt.startBattle();
settle(); // 開幕カットインが明けるまで待つ
const st0 = kt.state();
check('試合が始まっている', st0.gamePhase === 'battle', st0.gamePhase);

// ---- 3. HUD の左右 ----
kt.resetPanels();
kt.render();
const panels = kt.panels();
check('左パネルが自席', panels.some(p => p.align === 'left' && p.id === SEAT), JSON.stringify(panels));
check('右パネルが相手', panels.some(p => p.align === 'right' && p.id === foeSeat), JSON.stringify(panels));

// ---- 4. 手番と入力の可否 ----
// 先攻は turnOrder[0]=p1。席が e1 のときは「相手(CPU)の手番」から始まる。
const myTurnFirst = kt.activeUnit().id === SEAT;
check('isLocalTurn() が席と一致', kt.isLocalTurn() === myTurnFirst, `active=${kt.activeUnit().id}`);
check('ターン表示が席から見た呼び名',
  kt.hud().turnLabel === (myTurnFirst ? 'あなたのターン' : 'CPUのターン'), kt.hud().turnLabel);
check('発射ボタンの活性が手番と一致', kt.hud().fireActive === myTurnFirst, String(kt.hud().fireActive));

// 自席の手番になるまで進める(CPUの手番なら物理を回して交代を待つ)
let guard = 0;
while (!kt.isLocalTurn() && guard++ < 4000) {
  kt.step(1 / 60);
  if (kt.state().matchOver) break;
}
settle(); // 手番交代のカットインが明けるまでは入力を受け付けない
check('自席の手番までたどり着く', kt.isLocalTurn() && !kt.hasCutIn(), `guard=${guard} active=${kt.activeUnit().id}`);

// ---- 5. 移動入力が自席のユニットを動かす ----
const me = kt.localUnit();
const foe = kt.foeUnit();
const beforeX = me.x, foeBeforeX = foe.x, beforeFuel = me.fuel;
const mb = kt.moveBtns();
const mid = down(mb.right.x, mb.right.y);
for (let i = 0; i < 30; i++) kt.step(1 / 60);
up(mid, mb.right.x, mb.right.y);
check('移動ボタンで自席が動く', Math.abs(me.x - beforeX) > 0.5, `dx=${(me.x - beforeX).toFixed(2)}`);
check('移動で自席の燃料が減る', me.fuel < beforeFuel, `${beforeFuel}→${me.fuel}`);
check('相手は動かない', Math.abs(foe.x - foeBeforeX) < 0.001, `dx=${(foe.x - foeBeforeX).toFixed(3)}`);

// ---- 6. 発射入力が自席の弾を撃つ ----
const fb = kt.fireBtn();
const aid = down(fb.x, fb.y);
move(aid, fb.x - 60, fb.y + 60); // 左下へ引く=右上へ飛ぶ
kt.render();                      // 弾道ガイドが自席のキャラ性能で描けるか(例外が出ないこと)
up(aid, fb.x - 60, fb.y + 60);
const shots = kt.projectiles();
check('弾が発射された', shots.length > 0, `n=${shots.length}`);
check('弾の owner が自席', shots.length > 0 && shots.every(p => p.owner === SEAT),
  shots.map(p => p.owner).join(','));

// ---- 7. 結果画面が席から見た勝敗になる ----
const myTeam = kt.localUnit().team;
const foeTeam = kt.foeUnit().team;
kt.forceWinner(myTeam);
check('自陣営が勝ったら localWon()=true', kt.localWon() === true);
kt.forceWinner(foeTeam);
check('相手陣営が勝ったら localWon()=false', kt.localWon() === false);

console.log(`\n=== seat=${SEAT} ===`);
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
