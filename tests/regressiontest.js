// Stage 2a のリグレッション。席の切り離しで既存のCPU戦・中断再開・フリーモードが
// 壊れていないかを、実際に1試合まるごと回して確かめる。
// 使い方: node regressiontest.js p1  /  node regressiontest.js e1
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

// 自席の手番が来たら適当に撃つ、を繰り返して試合を終わりまで進める。
// 描画も毎フレーム呼んで、HUD側で例外が出ないことも同時に見る。
function playMatch(maxFrames) {
  let frames = 0, myShots = 0;
  while (!kt.state().matchOver && frames++ < maxFrames) {
    const hud = kt.hud();
    if (hud.fireActive) {
      const fb = kt.fireBtn();
      const id = down(fb.x, fb.y);
      // 相手のいる向きへ引く(引っ張りの逆へ飛ぶ)
      const toRight = kt.foeUnit().x > kt.localUnit().x;
      move(id, fb.x + (toRight ? -70 : 70), fb.y + 55);
      up(id, fb.x + (toRight ? -70 : 70), fb.y + 55);
      myShots++;
    }
    kt.step(1 / 60);
    kt.render();
  }
  return { frames, myShots };
}

// ---- 1. CPU戦を1試合通す ----
kt.startBattle();
const startWind = kt.wind();
let threw = null;
let played;
try { played = playMatch(60000); } catch (e) { threw = e; }
check('1試合を通して例外が出ない', !threw, threw && (threw.message + '\n' + threw.stack.split('\n')[1]));
check('試合が決着する', kt.state().matchOver === true, JSON.stringify(kt.state()));
check('winner が陣営名', ['player', 'cpu'].includes(kt.state().winner), String(kt.state().winner));
check('自分も撃っている', played && played.myShots > 0, played && String(played.myShots));
// 連勝は「席」ではなく「プレイヤー陣営」の記録。席を e1 に移しても team 基準のままなのが正。
// (オンライン対人戦は連勝・ランキングに含めない方針なので、Stage 3 では別途この経路を通さない)
check('連勝カウントはプレイヤー陣営基準',
  kt.state().winner === 'player' ? kt.streak() > 0 : kt.streak() === 0,
  `winner=${kt.state().winner} streak=${kt.streak()}`);
check('風は決着後も有効値', Number.isFinite(kt.wind().strength) && Math.abs(kt.wind().dir) <= 1,
  JSON.stringify(kt.wind()));

// ---- 2. 中断→再開のラウンドトリップ ----
kt.startBattle();
// 地形を削ってから保存しないと、破壊状態の復元を確かめられない
for (let i = 0; i < 900 && !kt.state().matchOver; i++) {
  const hud = kt.hud();
  if (hud.fireActive) {
    const fb = kt.fireBtn();
    const id = down(fb.x, fb.y);
    const toRight = kt.foeUnit().x > kt.localUnit().x;
    move(id, fb.x + (toRight ? -70 : 70), fb.y + 55);
    up(id, fb.x + (toRight ? -70 : 70), fb.y + 55);
  }
  kt.step(1 / 60);
}
const before = {
  units: kt.units.map(u => ({ id: u.id, hp: u.hp, fuel: u.fuel, x: u.x, ch: u.character, sc: u.specialCharge })),
  wind: kt.wind(), craters: kt.craters(), state: kt.state(), seat: kt.seat()
};
check('保存前にクレーターができている', before.craters > 0, String(before.craters));

kt.save();
const loaded = kt.load();
check('中断セーブが読める', !!loaded, 'null');
check('セーブ形式が v4', loaded && loaded.v === 4, loaded && String(loaded.v));
check('セーブが units 形式', !!(loaded && Array.isArray(loaded.units) && loaded.units.length === 2));

// 別の試合を挟んで状態を汚してから復元する
kt.startBattle();
kt.apply(loaded);
const after = {
  units: kt.units.map(u => ({ id: u.id, hp: u.hp, fuel: u.fuel, x: u.x, ch: u.character, sc: u.specialCharge })),
  wind: kt.wind(), craters: kt.craters(), state: kt.state(), seat: kt.seat()
};
check('復元後もHP・燃料・キャラが一致',
  JSON.stringify(before.units.map(u => [u.id, u.hp, u.fuel, u.ch, u.sc])) ===
  JSON.stringify(after.units.map(u => [u.id, u.hp, u.fuel, u.ch, u.sc])),
  JSON.stringify(after.units));
check('復元後もX座標が一致',
  before.units.every((u, i) => Math.abs(u.x - after.units[i].x) < 0.001),
  JSON.stringify(after.units.map(u => u.x)));
check('復元後も風が一致', JSON.stringify(before.wind) === JSON.stringify(after.wind),
  JSON.stringify(after.wind));
check('復元後も地形の破壊履歴が一致', before.craters === after.craters, `${before.craters}→${after.craters}`);
check('復元後も手番が一致',
  before.state.activeIndex === after.state.activeIndex && before.state.turnCount === after.state.turnCount,
  JSON.stringify(after.state));
check('復元しても席は動かない', after.seat === SEAT, after.seat);

// ---- 3. フリーモード ----
kt.startFree();
check('フリーモードに入る', kt.mode() === 'free', kt.mode());
const fc = kt.freeConfig();
check('フリーモードのキャラ設定が反映される',
  kt.unitById('p1').character === kt.chars()[fc.playerIndex] &&
  kt.unitById('e1').character === kt.chars()[fc.cpuIndex],
  `${kt.unitById('p1').character}/${kt.unitById('e1').character}`);
let freeThrew = null;
try { playMatch(60000); } catch (e) { freeThrew = e; }
check('フリーモードも例外なく決着', !freeThrew && kt.state().matchOver === true,
  freeThrew ? freeThrew.message : JSON.stringify(kt.state()));
check('フリーモードは連勝を積まない', kt.streak() === 0, String(kt.streak()));

// ---- 闘技場でCPUが自分から奈落へ歩き込まないこと(2026-07-28の指摘) ----
// limitMoveByClimb が止めるのは急な上りだけで、下りと足場の切れ目は素通りしていた。
kt.setTerrain('tieredBasin');
const cpuUnit = kt.units.find(u => u.id === 'e1');
const midX = kt.stageW() / 2;
const abyssGround = kt.groundYAt(midX, cpuUnit.y + 18);
// 中央が本当に奈落(着地点が死線に届く)であることを先に確かめる。前提が崩れたら検査の意味が無い。
check('闘技場の中央は死線に届く奈落', abyssGround !== null && abyssGround >= kt.deadLineY(),
  `ground=${abyssGround} deadLine=${kt.deadLineY()}`);
check('CPUは奈落へ踏み込まない', kt.cpuStepIsSafe(cpuUnit, midX) === false);
check('CPUは自分の足元へは動ける', kt.cpuStepIsSafe(cpuUnit, cpuUnit.x) === true);

// ---- 闘技場の外壁が、一番引いた視点でも上端まで届くこと ----
// 地形は y=0 からしか描けないので、視点を引くと y<0 の領域が画面に入り、そこで壁が
// 途切れて空が覗いていた。延長の高さが足りているかを式で固定しておく。
const zoom = kt.minCameraZoom();
const panelY = kt.controlPanelY();
const needed = (panelY + (0 - panelY) * zoom) / zoom; // 画面上端に見える世界座標の空白
check('外壁の延長は一番引いた視点でも足りる', kt.arenaWallExtension() >= needed,
  `延長=${kt.arenaWallExtension()} 必要=${Math.ceil(needed)}`);
// 描画は目で見るしかないが、闘技場で例外を投げないことだけは自動で押さえられる。
let arenaDrawThrew = null;
try { kt.render(); } catch (e) { arenaDrawThrew = e; }
check('闘技場を描画しても落ちない', !arenaDrawThrew, arenaDrawThrew && arenaDrawThrew.message);

console.log(`\n=== regression seat=${SEAT} ===`);
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
