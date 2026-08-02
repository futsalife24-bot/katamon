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

const selectWheelCards = kt.selectWheelCards();
check('キャラ選択は手前の最大7枚だけを描画する',
  selectWheelCards.rendered === Math.min(7, selectWheelCards.total) && selectWheelCards.focused,
  JSON.stringify(selectWheelCards));

check('死神がキャラ選択に追加されている', kt.chars().includes('shinigami'), kt.chars().join(','));
const deathGate = kt.deathGate();
check('デスゲートはDEAD LINEの下から固定射程',
  deathGate.range === 260 && deathGate.speed === 310 && deathGate.bottomRadius === 26 && deathGate.topRadius === 8 && deathGate.curvePower === 3 && deathGate.stride === 14 && deathGate.startDepth === 34,
  JSON.stringify(deathGate));
const shinigami = kt.character('shinigami');
check('死神は両陣営とも敵の方を向き、戦闘中だけ大きく表示する',
  shinigami.facesLeft === true && shinigami.spriteScale === 1.35,
  JSON.stringify(shinigami));
kt.startBattle('shinigami');
const cratersBeforeDeathGate = kt.craters();
// 地形パターンごとに「誰も立っていない、DEAD LINEより上の地面」を探して印の着弾点にする。
kt.fireDeathGateForTest(kt.deathGateTestX());
const hpBeforeDeathGate = kt.units.map(u => u.hp);
for (let i = 0; i < 900 && kt.projectiles().length; i++) kt.step(1 / 60);
check('デスゲートは一定間隔で縦穴を削る',
  kt.craters() - cratersBeforeDeathGate === Math.ceil(deathGate.range / deathGate.stride),
  `craters=${kt.craters() - cratersBeforeDeathGate}`);
const deathGateCraters = kt.craterHistory().slice(cratersBeforeDeathGate);
check('デスゲートは両端の太さを保ちつつ、丸みのある逆三角形に削る',
  deathGateCraters.length > 1
    && deathGateCraters[0].r === deathGate.bottomRadius
    && deathGateCraters[deathGateCraters.length - 1].r === deathGate.topRadius
    && deathGateCraters[Math.floor(deathGateCraters.length / 2)].r > 23
    && deathGateCraters.every((crater, index) => index === 0 || crater.r < deathGateCraters[index - 1].r),
  JSON.stringify(deathGateCraters.map(crater => crater.r)));
check('デスゲート自体は直接ダメージを与えない',
  JSON.stringify(kt.units.map(u => u.hp)) === JSON.stringify(hpBeforeDeathGate),
  `${hpBeforeDeathGate} -> ${kt.units.map(u => u.hp)}`);

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
check('winner が陣営名または引き分け', ['player', 'cpu', 'draw'].includes(kt.state().winner), String(kt.state().winner));
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
// setTerrain は地形を作り直すだけでユニットの位置を直さない。前の試合がどこで終わったかで
// ユニットが新しい地形にめり込み、「自分の足元」の判定が null になって落ちることがあった
// (2026-07-29に実際にフレークとして発生)。棚の上へ置き直してから見る。
kt.placeOnGround('e1', kt.stageW() * 0.85);
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
// 外壁の絵と弾の判定は同じ範囲でなければならない。ずれると「見えている壁を弾がすり抜ける」か
// 「何も無い所で爆発する」のどちらかになる。絵の側の定数から判定を引き当てて確かめる。
const wallW = kt.stageW() * kt.arenaWallRatio();
const ext = kt.arenaWallExtension();
check('上端より上でも外壁は弾を止める(左)', kt.isSolidAt(wallW / 2, -200) === true);
check('上端より上でも外壁は弾を止める(右)', kt.isSolidAt(kt.stageW() - wallW / 2, -200) === true);
check('壁の内側は上空を素通しにする', kt.isSolidAt(kt.stageW() / 2, -200) === false);
check('壁のすぐ内側は塞がない', kt.isSolidAt(wallW + 4, -200) === false);
check('絵の高さを越えた先は素通し', kt.isSolidAt(wallW / 2, -(ext + 50)) === false);
// 闘技場だけの仕掛け。ここを間違えると全ステージの上空に見えない壁ができる。
kt.setTerrain('rolling');
check('闘技場以外は上空に壁を作らない', kt.isSolidAt(wallW / 2, -200) === false);
kt.setTerrain('tieredBasin');
// 描画は目で見るしかないが、闘技場で例外を投げないことだけは自動で押さえられる。
let arenaDrawThrew = null;
try { kt.render(); } catch (e) { arenaDrawThrew = e; }
check('闘技場を描画しても落ちない', !arenaDrawThrew, arenaDrawThrew && arenaDrawThrew.message);

// ===== Issue #9: 物理を固定刻みで回すので、描画フレーム間隔が違っても結果が一致する =====
// 実機で「片方だけ床が抜けて落下死」「片方だけ上空の壁に当たる」が起き、対戦が中断した。
// 原因は gameLoop が実フレーム間隔をそのまま物理へ渡していたこと。
// ここでは同じ状態から同じ初速で撃ち、刻みだけを変えて結果を突き合わせる。
// 経過させる「シミュレーション時間の合計」は必ず揃える(フレーム数ではなく秒で揃える)。
function runShotWithStep(dt, snap, fire, seconds = 5) {
  kt.apply(JSON.parse(JSON.stringify(snap)));
  kt.resetPhysicsClock();
  fire();
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) kt.step(dt);
  return {
    craters: kt.craterHistory().map(c => `${c.x.toFixed(9)},${c.y.toFixed(9)},${c.r.toFixed(9)}`).join('|'),
    units: kt.units.map(u => `${u.id}:${u.x.toFixed(9)},${u.y.toFixed(9)},${u.hp}`).join('|')
  };
}

check('固定刻みは全端末共通の値', kt.physicsDt() === 1 / 120, String(kt.physicsDt()));

// CPUの照準には乱数が入る。撃つ側を固定し、測定中は誰もCPU行動しないようにしないと、
// 「刻みの違い」ではなく「乱数の違い」を見てしまう。席によって自分の位置も変わるため、
// 発射するユニットも明示する。
kt.disableCpuForTest();
kt.setTerrain('rolling');
kt.placeOnGround('p1', Math.round(kt.stageW() * 0.3));
kt.placeOnGround('e1', Math.round(kt.stageW() * 0.7));
const shotSnap = kt.snapshot();
const plainShot = () => kt.fireForTest(420, -320, { unitId: 'p1' });
const shot60 = runShotWithStep(1 / 60, shotSnap, plainShot);
const shot120 = runShotWithStep(1 / 120, shotSnap, plainShot);
const shot30 = runShotWithStep(1 / 30, shotSnap, plainShot);
check('通常弾が地形を削っている(比較対象として成立している)',
  shot60.craters.length > 0, `craters=${shot60.craters.length}`);
check('60fpsと120fpsでクレーターが完全一致する',
  shot60.craters === shot120.craters, `60=${shot60.craters} / 120=${shot120.craters}`);
check('60fpsと30fpsでクレーターが完全一致する',
  shot60.craters === shot30.craters, `60=${shot60.craters} / 30=${shot30.craters}`);
check('刻みが違ってもキャラの最終状態が一致する',
  shot60.units === shot120.units && shot60.units === shot30.units,
  `60=${shot60.units} / 120=${shot120.units} / 30=${shot30.units}`);

// 闘技場の外壁は画面上端より上まで当たり判定を持つ。跳躍も内部的には砲弾なので
// そこへ当たるが、以前は着地面を取れず y=-16(画面天井)へ貼り付いたまま固まっていた。
kt.setTerrain('tieredBasin');
kt.placeOnGround('p1', Math.round(kt.stageW() * 0.2));
kt.placeOnGround('e1', Math.round(kt.stageW() * 0.8));
const jumpSnap = kt.snapshot();
const wallJump = () => kt.fireForTest(-260, -900, { unitId: 'p1', useJump: true });
const jump60 = runShotWithStep(1 / 60, jumpSnap, wallJump);
const jump120 = runShotWithStep(1 / 120, jumpSnap, wallJump);
check('上空の壁へ跳躍しても刻みによらず同じ結果になる',
  jump60.units === jump120.units, `60=${jump60.units} / 120=${jump120.units}`);
runShotWithStep(1 / 60, jumpSnap, wallJump);
const jumper = kt.unitById('p1');
check('跳躍後に画面天井へ貼り付かない', jumper.y > 0, `y=${jumper.y}`);
// 以前は衝突直前の座標をそのまま使っていたため、壁の境界(x=136.8)のすぐ外側で止まり、
// キャラ半径ぶん外壁へめり込んでいた。境界の内側1pxずれるだけで壁の上へ乗って
// 画面天井に固まるため、半径ぶんの余裕を必ず空ける。
const arenaWallX = kt.stageW() * kt.arenaWallRatio();
check('跳躍後に闘技場の外壁へめり込まない',
  jumper.x - kt.unitRadius() >= arenaWallX && jumper.x + kt.unitRadius() <= kt.stageW() - arenaWallX,
  `x=${jumper.x} wall=${arenaWallX} r=${kt.unitRadius()}`);

// ===== Issue #10: 地形はDEAD LINEより上で完結させる =====
// 以前は地形の底が画面下端(960)まで続いていたため、「あと数pxで死ぬ床」と
// 「まだ安全な床」が見た目で区別できず、実機で生死の食い違いが起きた。
// 底をDEAD LINEで止めると、床が抜けたかどうかが穴として目に見えるようになる。
const deadLine = kt.deadLineY();
check('地形の底はDEAD LINEと一致する', kt.terrainBottomY() === deadLine,
  `bottom=${kt.terrainBottomY()} deadLine=${deadLine}`);

const band = kt.groundBand();
// 通常弾の最大クレーター半径は 44 * 1.35 = 59.4px。最も低い地形でも、これより
// 床が厚くなければ1発で穴が空いて事故死になる。定数を動かした時にここで気づける。
check('最も低い地形でも通常弾の最大クレーターより床が厚い',
  deadLine - band.max > 44 * 1.35,
  `厚み=${deadLine - band.max} 必要=${44 * 1.35}`);
check('高低差の幅を確保している', band.max - band.min >= 200, `幅=${band.max - band.min}`);

for (const pattern of ['plateauLeft', 'plateauRight', 'mountainCenter', 'valley', 'rolling', 'bridge', 'tieredBasin']) {
  kt.setTerrain(pattern);
  const segs = kt.snapshot().segments;
  let lowest = -Infinity;
  for (const col of segs) {
    if (!col) continue;
    for (const seg of col) lowest = Math.max(lowest, seg[1]);
  }
  check(`${pattern}: 地形がDEAD LINEより下へはみ出さない`, lowest <= deadLine, `最下端=${lowest}`);
}

// 最も低い「底まである地面」に、通常弾の最大クレーターを直接開けても床が残ること。
// 弾を撃って確かめると着弾点が風と乱数で動き、薄床ゾーン(意図的に貫通する弱点)へ
// 当たった時に結果がぶれる。ここは地形と掘削だけを見たいので直接掘る。
kt.setTerrain('valley');
const valleySegs = kt.snapshot().segments;
const colW = kt.stageW() / valleySegs.length;
let deepestX = null, deepestTop = -Infinity;
for (let c = 0; c < valleySegs.length; c++) {
  const col = valleySegs[c];
  if (!col || !col.length) continue;
  const ground = col[col.length - 1];
  if (ground[1] < kt.terrainBottomY() - 0.5) continue; // 薄床ゾーンは対象外
  if (ground[0] > deepestTop) { deepestTop = ground[0]; deepestX = (c + 0.5) * colW; }
}
check('底まである通常の地面が生成されている', deepestX !== null, `最深地表=${deepestTop}`);
const maxNormalBlast = 44 * 1.35; // 通常弾の最大クレーター半径
kt.carveForTest(deepestX, deepestTop, maxNormalBlast);
check('最も低い地形でも通常弾1発では床が抜けない',
  kt.isSolidAt(deepestX, deadLine - 6),
  `x=${deepestX && deepestX.toFixed(1)} 地表=${deepestTop} 半径=${maxNormalBlast} deadLine=${deadLine}`);
check('掘った直後の地表はクレーターぶん下がっている',
  kt.groundYAt(deepestX, deepestTop - 40) > deepestTop,
  `掘削後の地表=${kt.groundYAt(deepestX, deepestTop - 40)} 元=${deepestTop}`);

// ===== Issue #13: 元画像が左向きのキャラが相手に背を向けない =====
// facingLeft は「画像を左右反転するか」であって「世界で左を向いているか」ではない。
// v91で向きの再判定を足した際にこの変換が抜け、facesLeftの7体が背を向けて撃っていた。
// 全キャラを左右どちらに置いても相手を向くことを、実際に向きを更新させて確かめる。
// 直前のテストで倒れた状態が残っていると、決着後は向きの再判定が走らない。
// 必ず新しい試合から始める。
kt.startBattle('kyoryu');
kt.disableCpuForTest();
kt.setTerrain('rolling');
let facingNg = [];
let facesLeftChecked = 0;
for (const key of kt.chars()) {
  if (kt.character(key).facesLeft) facesLeftChecked++;
  for (const [p1x, e1x] of [[300, 1100], [1100, 300]]) {
    kt.setCharactersForTest(key, key);
    kt.placeOnGround('p1', p1x);
    kt.placeOnGround('e1', e1x);
    kt.step(1 / 60);
    for (const u of kt.units) {
      const foe = kt.units.find(o => o.id !== u.id);
      const shouldFaceLeft = foe.x < u.x;
      if (kt.facesLeftInWorld(u.id) !== shouldFaceLeft) {
        facingNg.push(`${key}/${u.id}@${Math.round(u.x)}`);
      }
    }
  }
}
check('左向き素材のキャラが検査対象に含まれている', facesLeftChecked > 0, `該当=${facesLeftChecked}体`);
check('全キャラが左右どちらに居ても相手の方を向く', facingNg.length === 0,
  `ズレ=${facingNg.slice(0, 8).join(', ')}${facingNg.length > 8 ? ` ほか${facingNg.length - 8}件` : ''}`);

// 素材の向きが違う組み合わせでも、両方が正しく向くこと。
const rightFacing = kt.chars().find(k => !kt.character(k).facesLeft);
const leftFacing = kt.chars().find(k => kt.character(k).facesLeft);
kt.setCharactersForTest(rightFacing, leftFacing);
kt.placeOnGround('p1', 300);
kt.placeOnGround('e1', 1100);
kt.step(1 / 60);
check('素材の向きが違う組み合わせでも両方が相手を向く',
  kt.facesLeftInWorld('p1') === false && kt.facesLeftInWorld('e1') === true,
  `${rightFacing}(p1)=${kt.facesLeftInWorld('p1')} / ${leftFacing}(e1)=${kt.facesLeftInWorld('e1')}`);

// ===== Issue #3: 花火(スモエルの必殺)は弧の頂点で開く =====
// 以前は飛行中に必殺ボタンを押して起爆していた。合図の通信が届くまでに弾が進むため、
// 端末ごとに違う場所で開き、削れ方もダメージも食い違っていた。
// 炸裂の時刻と位置を発射時に数式で確定させたので、通信も刻みも結果に影響しない。
// 本体の爆発半径は 44*1.15=50.6px、拡散弾は 22/15/9.7px。25pxを境に区別できる。
const MAIN_BLAST_MIN_R = 25;
function craterRadii(craterString) {
  return craterString ? craterString.split('|').map(s => Number(s.split(',')[2])) : [];
}

kt.startBattle('sumoeru');
kt.disableCpuForTest();
kt.setTerrain('rolling');
kt.setCharactersForTest('sumoeru', 'sumoeru');
kt.fillCharges();
kt.placeOnGround('p1', Math.round(kt.stageW() * 0.25));
kt.placeOnGround('e1', Math.round(kt.stageW() * 0.75));
const fireworkSnap = kt.snapshot();

// 上へ大きく撃つ → 頂点で空中炸裂する(本体の爆発は起きず、拡散弾だけ)
const upShot = () => kt.fireForTest(300, -520, { unitId: 'p1', useSpecial: true });
const fw60 = runShotWithStep(1 / 60, fireworkSnap, upShot, 6);
const fw120 = runShotWithStep(1 / 120, fireworkSnap, upShot, 6);
const fw30 = runShotWithStep(1 / 30, fireworkSnap, upShot, 6);
check('花火が炸裂して地形を削っている', craterRadii(fw60.craters).length > 0,
  `craters=${craterRadii(fw60.craters).length}`);
check('上へ撃った花火は空中で開く(本体の爆発が起きない)',
  craterRadii(fw60.craters).every(r => r < MAIN_BLAST_MIN_R),
  `半径=${craterRadii(fw60.craters).join(',')}`);
check('花火の炸裂位置が60fpsと120fpsで完全一致する', fw60.craters === fw120.craters,
  `60=${fw60.craters.slice(0, 90)} / 120=${fw120.craters.slice(0, 90)}`);
check('花火の炸裂位置が60fpsと30fpsで完全一致する', fw60.craters === fw30.craters,
  `60=${fw60.craters.slice(0, 90)} / 30=${fw30.craters.slice(0, 90)}`);

// 下へ撃つ → 頂点が無いので空中では開かず、着弾して開く(本体の爆発あり)
const downShot = () => kt.fireForTest(300, 260, { unitId: 'p1', useSpecial: true });
const fwDown = runShotWithStep(1 / 60, fireworkSnap, downShot, 6);
check('下へ撃った花火は着弾して開く(本体の爆発が起きる)',
  craterRadii(fwDown.craters).some(r => r >= MAIN_BLAST_MIN_R),
  `半径=${craterRadii(fwDown.craters).join(',')}`);

// ほぼ水平 → 頂点が自分の拡散弾の届く範囲(180px)に入るので空中では開かない
const flatShot = () => kt.fireForTest(200, -100, { unitId: 'p1', useSpecial: true });
const fwFlat = runShotWithStep(1 / 60, fireworkSnap, flatShot, 6);
check('頂点が近すぎる水平撃ちは空中で開かない(自爆しない)',
  craterRadii(fwFlat.craters).some(r => r >= MAIN_BLAST_MIN_R),
  `半径=${craterRadii(fwFlat.craters).join(',')}`);

console.log(`\n=== regression seat=${SEAT} ===`);
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
