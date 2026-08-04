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
// facesLeft は「元画像がどちら向きか」であって「敵を向くか」ではない。敵の方を向くことは
// 後段の向き検査(全キャラ・左右両配置)で確認している。ここは画像を差し替えた時に
// 設定の追随漏れへ気づくための固定。2026-08-03に右向きの絵へ差し替えたため false。
// spriteScale は「みんなを揃えたうえで、この子だけ大きい」という設計の意図だけを持つ。
// 絵が縦長か横長かの差は unitSpriteScale が別に打ち消す(v117)。1.35→1.21 はその分離で、
// 画面に出る大きさは変えていない。
// 見かけの大きさを揃える補正(v117)。高さ基準で描くので縦長の絵ほど小さく見えていた。
// 絵の比率だけで決まるので表を持たない=絵を差し替えても勝手に追随する。
{
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  check('見かけの大きさを絵の比率から揃えている',
    html.includes('const SPRITE_REFERENCE_ASPECT')
    && html.includes('return design * Math.sqrt(SPRITE_REFERENCE_ASPECT / (img.naturalWidth / img.naturalHeight));')
    && (html.match(/SPRITE_SIZE \* unitSpriteScale\(u\.character\)/g) || []).length === 2);
  // 判定は全キャラ共通の円。絵の大きさを揃えても、どこに当たるかは絵からは読めない。
  check('当たり判定を円で可視化している',
    html.includes('function drawUnitHitCircle(u)')
    && html.includes('ctx.arc(a.x, a.y, UNIT_HIT_RADIUS, 0, Math.PI * 2);')
    && html.includes('drawUnitHitCircle(u);'));
  check('判定の輪はキャラ画像より先に描く',
    /drawUnitHitCircle\(u\);[\s\S]{0,1200}ctx\.drawImage\(img, -w \/ 2, UNIT_RADIUS - h, w, h\);/.test(html));
  // 直撃の円はキャラの体に乗せる。u.y は足元から16pxしか上にないので、そのまま
  // 中心にすると見えている上半分に当たらない(実機で指摘)。
  check('直撃の円をキャラの体へ上げている',
    html.includes('const UNIT_HIT_RISE = 23;')
    && html.includes('return { x: u.x, y: u.y - UNIT_HIT_RISE };'));
  // 見えている輪と実際の判定が同じ中心を使うこと。別々だと嘘の表示になる。
  check('見えている輪と実際の判定が同じ中心を使う',
    // 呼び出しは2か所(可視化と直撃判定)。定義側は数えない。
    (html.match(/const a = unitHitCenter\(u\);/g) || []).length === 2);
  // 上げるのは直撃の円だけ。発射基点と爆風の基準を動かすと、足元へ撃った時の距離が
  // 変わってダメージが全キャラぶん変わる。
  check('発射基点と爆風の基準は動かしていない',
    html.includes('function unitAnchor(u) {')
    && /function unitAnchor\(u\) \{[\s\S]{0,200}return \{ x: u\.x, y: u\.y \};/.test(html));
}
check('死神は右向きの元画像で、戦闘中だけ2割大きく表示する',
  !shinigami.facesLeft && shinigami.spriteScale === 1.21,
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
// 地形を削ってから保存しないと、破壊状態の復元を確かめられない。
// 弾が画面外へ飛ぶとクレーターができないので、フレーム数を固定にすると、まれに
// 1つも削れないまま抜けて次の検査が落ちる(30回に1回程度で再現)。
// 従来どおり900フレームは回したうえで、まだ削れていなければ削れるまで撃ち続ける。
for (let i = 0; i < 5000 && !kt.state().matchOver && (i < 900 || kt.craters() === 0); i++) {
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

// 「どのキャラの元画像が左向きか」を固定しておく。ここが絵と食い違うとそのキャラだけ
// 相手に背を向ける。絵と設定が合っているかは自動では判定できない(人の目でしか分からない)
// ので、せめて設定が意図せず変わったことに気づけるようにする。
// 画像を差し替えた時は、実機で向きを確認したうえでこの一覧も更新すること。
const EXPECTED_LEFT_FACING = ['sumoeru', 'doRednote', 'akuma', 'kishi', 'neko'];
const actualLeftFacing = kt.chars().filter(k => kt.character(k).facesLeft);
check('左向き素材として登録されているキャラの一覧が変わっていない',
  actualLeftFacing.join(',') === EXPECTED_LEFT_FACING.join(','),
  `実際=[${actualLeftFacing.join(',')}] 期待=[${EXPECTED_LEFT_FACING.join(',')}]`);
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

// 上へ大きく撃つ → 頂点で空中炸裂する(本体の爆発は起きず、拡散弾だけ)
const upShot = () => kt.fireForTest(300, -520, { unitId: 'p1', useSpecial: true });
// 地形はランダムで、上空に浮島が生成されると頂点へ届く前に着弾してしまう。
// 空が開けている地形を引くまで作り直す。空中炸裂しない実装では何度作り直しても
// 条件を満たせないので、この用意が失敗すること自体で退行を検知できる。
let fireworkSnap = null;
for (let attempt = 0; attempt < 20 && !fireworkSnap; attempt++) {
  kt.setTerrain('rolling');
  kt.setCharactersForTest('sumoeru', 'sumoeru');
  kt.fillCharges();
  kt.placeOnGround('p1', Math.round(kt.stageW() * 0.25));
  kt.placeOnGround('e1', Math.round(kt.stageW() * 0.75));
  const probe = kt.snapshot();
  const radii = craterRadii(runShotWithStep(1 / 60, probe, upShot, 6).craters);
  if (radii.length > 0 && radii.every(r => r < MAIN_BLAST_MIN_R)) fireworkSnap = probe;
}
check('上へ撃った花火は空中で開く(本体の爆発が起きない)', fireworkSnap !== null,
  '20回地形を作り直しても空中炸裂しなかった');
if (!fireworkSnap) fireworkSnap = kt.snapshot();
const fw60 = runShotWithStep(1 / 60, fireworkSnap, upShot, 6);
const fw120 = runShotWithStep(1 / 120, fireworkSnap, upShot, 6);
const fw30 = runShotWithStep(1 / 30, fireworkSnap, upShot, 6);
check('花火が炸裂して地形を削っている', craterRadii(fw60.craters).length > 0,
  `craters=${craterRadii(fw60.craters).length}`);
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

// ===== タイトルの「おまけ」ボタン =====
// 押すたび 1曲目 → 2曲目 → 停止 を繰り返す。BGMの切り替えは syncBgm へ一本化して
// あるので、ここでも「いま鳴るべき曲(desired)」が正しく変わることで確認する。
const btns = kt.titleBtnRects();
function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}
const otherTitleBtns = [btns.cpu, btns.online, btns.free, btns.ranking, btns.update];
check('おまけボタンが他のタイトルボタンと重ならない',
  otherTitleBtns.every(b => !rectsOverlap(btns.bonus, b)),
  JSON.stringify(btns.bonus));
check('おまけボタンが画面内に収まっている',
  btns.bonus.y - btns.bonus.h / 2 > 0 && btns.bonus.y + btns.bonus.h / 2 < kt.viewH(),
  JSON.stringify(btns.bonus));

kt.setPhase('title');
const bonusBtn = kt.bonusBtn();
function tapBonus() { const id = down(bonusBtn.x, bonusBtn.y); up(id, bonusBtn.x, bonusBtn.y); }

const bonusTrackCount = kt.bonusTrackCount();
check('おまけ曲が4曲登録されている', bonusTrackCount === 4, String(bonusTrackCount));
check('最初はおまけ曲を選んでいない', kt.bgm().bonusTrack === 0, String(kt.bgm().bonusTrack));
// 曲数ぶん押すと1曲ずつ進み、最後にもう一度押すと停止してタイトル曲へ戻る。
let cycleNg = [];
for (let n = 1; n <= bonusTrackCount; n++) {
  tapBonus();
  if (kt.bgm().bonusTrack !== n) cycleNg.push(`${n}回目=${kt.bgm().bonusTrack}`);
  if (kt.bgm().desired !== 'bonus') cycleNg.push(`${n}回目のdesired=${kt.bgm().desired}`);
}
check('押すたびに1曲ずつ進み、どの曲でもおまけ曲が鳴るべき曲になる',
  cycleNg.length === 0, cycleNg.join(', '));
tapBonus();
check('最後まで進めてもう一度押すと停止してタイトル曲へ戻る',
  kt.bgm().bonusTrack === 0 && kt.bgm().desired === 'title',
  `track=${kt.bgm().bonusTrack} desired=${kt.bgm().desired}`);
// 曲ごとに録音レベルが違うので、体感音量を揃えるための基準音量を個別に持つ。
const trackVolumes = kt.bonusTrackVolumes();
check('全曲に基準音量が設定されている',
  trackVolumes.length === bonusTrackCount && trackVolumes.every(v => v > 0 && v <= 1),
  JSON.stringify(trackVolumes));
check('おまけ曲はタイトル曲より大きい音量に設定されている',
  trackVolumes.every(v => v > kt.titleBgmBaseVolume()),
  `おまけ=${JSON.stringify(trackVolumes)} タイトル=${kt.titleBgmBaseVolume()}`);

// 対戦へ移ったら選択ごと解除する。次にタイトルへ戻った時に勝手に鳴り出さないため。
tapBonus();
check('対戦前はおまけ曲を選んでいる', kt.bgm().bonusTrack === 1, String(kt.bgm().bonusTrack));
kt.setPhase('battle');
kt.syncBgm();
check('対戦へ移るとおまけ曲の選択が解除される', kt.bgm().bonusTrack === 0, String(kt.bgm().bonusTrack));
check('対戦中はステージ曲が鳴るべき曲になる', kt.bgm().desired === 'stage', kt.bgm().desired);
kt.setPhase('title');
kt.syncBgm();
check('タイトルへ戻ってもおまけ曲は鳴り出さない',
  kt.bgm().bonusTrack === 0 && kt.bgm().desired === 'title',
  `track=${kt.bgm().bonusTrack} desired=${kt.bgm().desired}`);

// ===== Issue #20: 2vs2(CPU4体) =====
// 「1vs1を壊さないこと」が最優先なので、まず1vs1側の不変を押さえてから2vs2を見る。
kt.setPhase('title');
// 前段の決定性テストが disableCpuForTest() で全員を local にしているので座り直す。
// 演習(オフライン)は常にp1の席なので、これが本来の状態。
kt.setLocalSeat('p1');
kt.setFreeFormat('1v1');
kt.startFreeMatch();
check('演習の既定は1vs1で、参加は2体のまま',
  kt.matchFormat() === '1v1' && kt.units.length === 2 && !kt.is2v2(),
  `${kt.matchFormat()} 人数=${kt.units.length}`);
const panels1v1 = (() => { kt.resetPanels(); kt.render(); return kt.panels(); })();
check('1vs1の名前カードは従来どおり2枚・高さ40・上端46',
  panels1v1.length === 2 && panels1v1.every(p => p.h === 40 && p.cardY === 46),
  JSON.stringify(panels1v1));
check('1vs1のターン帯・ミニマップ・HUD下端は従来の位置のまま',
  kt.turnBarTop() === 94 && kt.minimapTop() === 120 && kt.hudBottom() === 116,
  `帯=${kt.turnBarTop()} 地図=${kt.minimapTop()} HUD=${kt.hudBottom()}`);
const spawn1v1 = kt.units.map(u => Math.round((u.x / kt.stageW()) * 1000) / 1000);

kt.setFreeFormat('2v2');
kt.startFreeMatch();
check('2vs2を選ぶと4体で試合が始まる',
  kt.matchFormat() === '2v2' && kt.units.length === 4 && kt.is2v2(),
  `${kt.matchFormat()} 人数=${kt.units.length}`);
check('4体の陣営と操作者が正しい(自分だけが操作、残り3体はCPU)',
  kt.units.map(u => `${u.id}:${u.team}:${u.control}`).join(',')
    === 'p1:player:local,e1:cpu:cpu,p2:player:cpu,e2:cpu:cpu',
  kt.units.map(u => `${u.id}:${u.team}:${u.control}`).join(','));
// 手番は「自分→敵→味方→敵」の交互。同じ陣営が2連続で撃たないことがこの並びの意味。
check('手番は陣営が交互に回る', kt.state().turnOrder.join(',') === 'p1,e1,p2,e2',
  kt.state().turnOrder.join(','));

// 開幕即死の再発防止。実装中に闘技場マップで内側2体が0秒で落ちて死んだ。
let spawnDeaths = 0;
const spawnSeen = [];
for (let r = 0; r < 40; r++) {
  kt.startFreeMatch();
  for (const u of kt.units) {
    if (u.y + kt.unitRadius() >= kt.deadLineY()) spawnDeaths++;
    if (u.hp <= 0) spawnDeaths++;
  }
  spawnSeen.push(kt.units.map(u => Math.round(u.x)).join('/'));
}
check('2vs2の開始位置は4体とも足場の上(死線より下に湧かない)',
  spawnDeaths === 0, `${spawnDeaths}件 例=${spawnSeen[0]}`);
check('2vs2でも味方同士は重ならない',
  kt.units.every(a => kt.units.every(b => a.id === b.id || Math.abs(a.x - b.x) >= 44)),
  kt.units.map(u => Math.round(u.x)).join('/'));
// 陣営ごとに左右へ分かれていること(左=自陣営、右=敵陣営)。
check('2vs2は自陣営が左半分、敵陣営が右半分に並ぶ',
  kt.units.filter(u => u.team === 'player').every(u => u.x < kt.stageW() / 2)
  && kt.units.filter(u => u.team === 'cpu').every(u => u.x > kt.stageW() / 2),
  kt.units.map(u => `${u.id}@${Math.round(u.x)}`).join(' '));

// HUD。4枚が上下2段に収まり、ミニマップやHUD背景の下端を割らないこと。
kt.resetPanels();
kt.render();
const panels2v2 = kt.panels();
check('2vs2の名前カードは4枚', panels2v2.length === 4, JSON.stringify(panels2v2));
check('自陣営2枚は左列、敵陣営2枚は右列に積まれる',
  panels2v2.filter(p => p.align === 'left').map(p => p.id).join(',') === 'p1,p2'
  && panels2v2.filter(p => p.align === 'right').map(p => p.id).join(',') === 'e1,e2',
  JSON.stringify(panels2v2.map(p => `${p.id}:${p.align}`)));
check('4枚とも上下段のどちらかに置かれ、同じ段に重ならない',
  new Set(panels2v2.filter(p => p.align === 'left').map(p => p.cardY)).size === 2
  && new Set(panels2v2.filter(p => p.align === 'right').map(p => p.cardY)).size === 2,
  JSON.stringify(panels2v2.map(p => p.cardY)));
const lowestPanelBottom = Math.max(...panels2v2.map(p => p.cardY + p.h));
check('名前カードはHUD背景の下端より内側に収まる',
  lowestPanelBottom <= kt.hudBottom(), `最下端=${lowestPanelBottom} HUD下端=${kt.hudBottom()}`);
// 実機で2段目のカードがターン帯に潜り込み、燃料ゲージが読めなくなっていた。
check('名前カードはターン帯に重ならない',
  lowestPanelBottom <= kt.turnBarTop(), `最下端=${lowestPanelBottom} ターン帯上端=${kt.turnBarTop()}`);
check('名前カードはミニマップに重ならない',
  lowestPanelBottom <= kt.minimapTop(), `最下端=${lowestPanelBottom} ミニマップ上端=${kt.minimapTop()}`);
check('2vs2はターン帯とミニマップがカード2段ぶん下がる',
  kt.turnBarTop() === 128 && kt.minimapTop() === 154 && kt.hudBottom() === 150,
  `帯=${kt.turnBarTop()} 地図=${kt.minimapTop()} HUD=${kt.hudBottom()}`);

// 4体ぶんのHPが実際に読み取れること(パネルに出る値がユニットのHPと一致する)。
kt.units[2].hp = 33;
kt.units[3].hp = 7;
check('4体それぞれのHPがカードに割り当てられている',
  kt.unitPanelLayout().map(s => s.id).sort().join(',') === 'e1,e2,p1,p2',
  JSON.stringify(kt.unitPanelLayout()));

// 味方誤爆の統一。電磁波だけが敵専用だったのをやめ、当たった者は陣営に関係なく食らう。
kt.startFreeMatch();
const empAlly = kt.unitById('p2');
const empHpBefore = empAlly.hp;
kt.emitEmpForTest(empAlly.x, empAlly.y, 120, 'p1', 1);
check('電磁波は味方にも当たる(誤爆の扱いを通常の爆発と統一)',
  empAlly.hp < empHpBefore && empAlly.moveLockTurns > 0,
  `hp ${empHpBefore}→${empAlly.hp} lock=${empAlly.moveLockTurns}`);

// CPUの標的選び。味方の近くに居る敵は狙わない。
kt.startFreeMatch();
const cpuSelf = kt.unitById('e1');
const cpuAlly = kt.unitById('e2');
const target1 = kt.unitById('p1');
const target2 = kt.unitById('p2');
cpuSelf.x = 1200; cpuAlly.x = 300; target1.x = 320; target2.x = 700;
check('味方のすぐ隣に居る敵は狙わず、離れている敵を狙う',
  kt.cpuPickTarget('e1') === 'p2', String(kt.cpuPickTarget('e1')));
cpuAlly.x = 1150; // 味方を自陣へ引き上げると、素直に一番近い敵を狙う
check('味方が離れていれば一番近い敵を狙う',
  kt.cpuPickTarget('e1') === 'p2', String(kt.cpuPickTarget('e1')));
target2.x = 1300; target1.x = 320; cpuAlly.x = 300;
check('倒れた敵は狙わない', (() => { target2.hp = 0; return kt.cpuPickTarget('e1') === 'p1'; })(),
  String(kt.cpuPickTarget('e1')));

// 1vs1では味方が居ないので、標的選びは従来の「一番近い敵」と完全に一致する。
kt.setFreeFormat('1v1');
kt.startFreeMatch();
check('1vs1の標的選びは従来どおり唯一の敵', kt.cpuPickTarget('p1') === 'e1', String(kt.cpuPickTarget('p1')));
check('1vs1の開始位置は2vs2導入後も変わらない',
  kt.units.map(u => Math.round((u.x / kt.stageW()) * 1000) / 1000).join(',') === spawn1v1.join(','),
  `${kt.units.map(u => Math.round((u.x / kt.stageW()) * 1000) / 1000).join(',')} / 期待=${spawn1v1.join(',')}`);

// 全員CPUなら無人で決着まで進む。死体に手番が渡って止まらないことの確認でもある。
kt.setFreeFormat('2v2');
let finished = 0;
let stuckAt = '';
for (let r = 0; r < 5; r++) {
  kt.startFreeMatch();
  for (const u of kt.units) u.control = 'cpu';
  let i = 0;
  for (; i < 300000 && !kt.state().matchOver; i++) kt.step(1 / 60);
  if (kt.state().matchOver) finished++;
  else stuckAt = `turn=${kt.state().turnCount} active=${kt.state().turnOrder[kt.state().activeIndex]}`;
}
check('2vs2は5戦とも決着まで進む(倒れたユニットで手番が止まらない)',
  finished === 5, `${finished}/5 ${stuckAt}`);

// 中断セーブ。人数の食い違うセーブを捨てる一方で、2vs2の中断は復元できること。
kt.setFreeFormat('2v2');
kt.startFreeMatch();
const snap2v2 = kt.buildSnapshotForTest();
check('中断データは対戦形式と4体ぶんのユニットを持つ',
  snap2v2.matchFormat === '2v2' && snap2v2.units.length === 4,
  `${snap2v2.matchFormat} 人数=${snap2v2.units.length}`);
kt.setFreeFormat('1v1');
kt.startFreeMatch(); // 人数を2に戻してから2vs2のセーブを流し込む
kt.applySnapshotForTest(snap2v2);
check('2vs2の中断データを読み込むと4体へ戻る',
  kt.units.length === 4 && kt.matchFormat() === '2v2',
  `${kt.matchFormat()} 人数=${kt.units.length}`);
// 形式を名乗らない旧セーブ(v99以前・オンラインの相手)は1vs1として扱う。
kt.applySnapshotForTest({ ...snap2v2, matchFormat: undefined, units: snap2v2.units.slice(0, 2) });
check('形式を持たない旧データは1vs1として読む',
  kt.units.length === 2 && kt.matchFormat() === '1v1',
  `${kt.matchFormat()} 人数=${kt.units.length}`);

// 連勝・ランキングは2vs2を数えない(味方CPUの働きで勝敗が変わるため)。
kt.setFreeFormat('2v2');
check('演習に対戦方式の行が増えている',
  !!kt.freeRows().format && kt.formatOptions().join(',') === '1v1,2v2',
  JSON.stringify(kt.freeRows().format) + ' ' + kt.formatOptions().join(','));
const fr = kt.freeRows();
check('対戦方式の行は開始ボタンと重ならない',
  fr.format.y + fr.format.h / 2 < 716 - 64 / 2 && fr.format.y - fr.format.h / 2 > fr.wind.y + fr.wind.h / 2,
  JSON.stringify(fr));
// 行ごとの当たり判定(中心 row.y+7、高さ row.h)が上下の行と食い合わないこと。
const rowBands = Object.entries(fr)
  .map(([k, r]) => ({ k, top: r.y + 7 - r.h / 2, bottom: r.y + 7 + r.h / 2 }))
  .sort((a, b) => a.top - b.top);
check('演習の各行の当たり判定が重なっていない',
  rowBands.every((b, i) => i === 0 || rowBands[i - 1].bottom <= b.top),
  JSON.stringify(rowBands));

// 実際に左右の矢印を押して対戦方式が切り替わること。
kt.setPhase('freeSetup');
kt.setFreeFormat('1v1');
const arrowY = fr.format.y + 7;
up(down(500, arrowY), 500, arrowY); // 右矢印
check('演習画面の右矢印で1vs1→2vs2へ切り替わる',
  kt.formatOptions()[kt.freeConfig().formatIndex] === '2v2',
  kt.formatOptions()[kt.freeConfig().formatIndex]);
up(down(40, arrowY), 40, arrowY);  // 左矢印
check('演習画面の左矢印で2vs2→1vs1へ戻る',
  kt.formatOptions()[kt.freeConfig().formatIndex] === '1v1',
  kt.formatOptions()[kt.freeConfig().formatIndex]);
kt.setPhase('title');

// 名前カードは「キャラが実際に立っている側」に置く決まり(e1陣営は画面右に湧く)。
// 席がe1なら自陣営のカードも右列へ移る。オンライン2vs2(段C)へ進む前の土台の確認。
kt.setFreeFormat('2v2');
kt.startFreeMatch();
kt.setLocalSeat('e1');
const panelsE1 = kt.unitPanelLayout();
check('席がe1なら自陣営(e1/e2)が右列、相手陣営(p1/p2)が左列になる',
  panelsE1.filter(p => p.align === 'right').map(p => p.id).join(',') === 'e1,e2'
  && panelsE1.filter(p => p.align === 'left').map(p => p.id).join(',') === 'p1,p2',
  JSON.stringify(panelsE1));
check('席がe1でも4枚とも上下2段に収まる',
  panelsE1.length === 4 && Math.max(...panelsE1.map(p => p.cardY + p.h)) <= kt.hudBottom(),
  JSON.stringify(panelsE1));
kt.setLocalSeat('p1');

console.log(`\n=== regression seat=${SEAT} ===`);
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
