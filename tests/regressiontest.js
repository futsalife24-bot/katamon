// Stage 2a のリグレッション。席の切り離しで既存のCPU戦・中断再開・フリーモードが
// 壊れていないかを、実際に1試合まるごと回して確かめる。
// 使い方: node regressiontest.js p1  /  node regressiontest.js e1
const h = require('./seatharness.js');
const kt = h.kt();
// This file intentionally runs many unrelated CPU scenarios in one process.
// Keep the production `startBattle` contract covered by Phase 2C integration;
// here each legacy scenario starts with an explicit test-only fresh CPU run.
kt.startBattle = (...args) => kt.startFreshBattleForLegacyRegression(...args);
const canvas = h.canvas;
const win = globalThis.window;
const SEAT = h.SEAT;
const indexHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

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
function touchDown(x, y) { const id = pid++; canvas.__fire('pointerdown', { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, timeStamp: Date.now(), button: 0 }); return id; }
function touchMoveWindow(id, x, y) { win.__fire('pointermove', { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, timeStamp: Date.now() }); }
function touchUp(id, x, y) { win.__fire('pointerup', { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, timeStamp: Date.now() }); }

const selectWheelCards = kt.selectWheelCards();
check('キャラ選択は手前の最大7枚だけを描画する',
  selectWheelCards.rendered === Math.min(7, selectWheelCards.total) && selectWheelCards.focused,
  JSON.stringify(selectWheelCards));
const unlockState = typeof kt.characterUnlockForTest === 'function' ? kt.characterUnlockForTest('coolKai') : null;
check('キャラ解放の進捗を端末内へ保存し、既存キャラは移行直後も全開放する',
  !!unlockState
    && unlockState.unlocked === true
    && unlockState.progress
    && typeof unlockState.progress.totalWins === 'number'
    && indexHtml.includes("const CHARACTER_UNLOCK_KEY = 'katamon_character_unlock_v1'")
    && indexHtml.includes('recordUnlockLogin()'),
  JSON.stringify(unlockState));
check('Studioの解放条件をゲームカタログへ受け渡し、選択画面で未解放表示する',
  indexHtml.includes('function normalizeCharacterUnlock(value)')
    && indexHtml.includes('function isCharacterUnlocked(key)')
    && indexHtml.includes("if (!isCharacterUnlocked(card.key))")
    && indexHtml.includes('未解放'),
  'character unlock bridge missing');
check('キャラ選択画面に解放進捗を表示し、基本実績を自動記録する',
  indexHtml.includes('function characterUnlockProgressSummary()')
    && indexHtml.includes('characterUnlockProgressSummary()')
    && indexHtml.includes("grantUnlockAchievement('login-7-days')")
    && indexHtml.includes("grantUnlockAchievement('streak-3')"),
  'unlock progress summary or achievements missing');
check('CPU戦の勝利をステージクリア・ボス撃破実績へ接続する',
  indexHtml.includes("grantUnlockAchievement('stage-clear')")
    && indexHtml.includes('stage-clear-${currentPattern}')
    && indexHtml.includes("grantUnlockAchievement('boss-defeated')"),
  'stage clear achievement hooks missing');
check('ロード中の石壁に更新時の読み込み案内を表示する',
  indexHtml.includes('更新時は読み込みに時間がかかる場合があります')
    && indexHtml.includes("ctx.fillText('更新時は読み込みに時間がかかる場合があります'")
    && indexHtml.includes("gamePhase === 'loading'"),
  'loading notice missing');
check('ロード中は項目数ではなく0〜100%ゲージとランダムキャラを表示する',
  indexHtml.includes('getCoreImageProgressRatio()')
    && indexHtml.includes('const progressPercent = Math.round(progress * 100)')
    && indexHtml.includes('const loadingCharacterKey = pickLoadingCharacter()')
    && indexHtml.includes('const loadingCharacterImage = loadCharacterArt')
    && indexHtml.includes('const fallbackLoadingKey = primaryLoadingImgReady')
    && indexHtml.includes('統一済みの右向き原画をそのまま使う')
    && !indexHtml.includes('CHARACTERS[loadingKey]?.facesLeft')
    && indexHtml.includes('ctx.rotate(markerAngle)')
    && indexHtml.includes('const spinnerY = VH / 2 - 155')
    && indexHtml.includes('const emblemSize = 58')
    && indexHtml.includes('const progressBarY = VH / 2 + 170'),
  'progress character loader missing');
check('対戦開始前に必要な1曲だけとロゴ動画を準備する',
  indexHtml.includes('rel="preload" as="video"')
    && indexHtml.includes('battleStartLogoVideo.load()')
    && indexHtml.includes('function primeFirstBattleMedia()')
    && indexHtml.includes('primeFirstBattleMedia();')
    && indexHtml.includes('function primeStageBgm(themeKey)')
    && indexHtml.includes('primeStageBgm(currentThemeKey);')
    && !indexHtml.includes("stageBgm.src = STAGE_BGM_SOURCES.coolKai;"),
  'first battle media preparation missing');
check('BATTLE画面に全ユニットのデバフ名と残りターンを表示する',
  indexHtml.includes('function debuffStatusEntries(u)')
    && indexHtml.includes('function drawDebuffStatusStrip()')
    && indexHtml.includes('行動不能 ${u.actionSkipTurns}手')
    && indexHtml.includes('移動封印 ${u.moveLockTurns}手')
    && indexHtml.includes('drawDebuffStatusStrip();'),
  'debuff status strip missing');

// v209: CPU BATTLEの「つぎのバトルへ」は、同じ相手・ステージに張り付かない。
// 乱数を固定しても直前の候補を外すため、旧実装なら実際に失敗する。
{
  const rematch = kt.cpuBattleRematchForTest();
  check('CPU BATTLE連戦は相手とステージ種別を直前から引き直す',
    !!rematch && rematch.cpu !== 'kyoryu' && rematch.pattern !== 'plateauLeft',
    JSON.stringify(rematch));
}

// ボス戦は見た目だけではなく、CPUの耐久と必殺チャージが強化される。
{
  const boss = kt.cpuBossRoundForTest();
  check('10連勝ごとのボスCPUはHP+30%・必殺チャージMAXで開始する',
    boss?.isBoss === true && boss.pattern === 'tieredBasin'
      && boss.cpu.maxHp === Math.round(kt.character('iwa').maxHp * 1.3)
      && boss.cpu.hp === boss.cpu.maxHp
      && boss.cpu.specialCharge === 4,
    JSON.stringify(boss));
}

// v171: 上端にあった横長の中断再開ボタンを出撃ギアの下へ移し、
// 空いた場所では「カタモンを選択」を主役として見せる。
{
  const info = kt.selectScreenInfo();
  const drawnWithSave = kt.drawSelectForTest(true);
  check('キャラ選択の見出しは「カタモンを選択」を大きく描く',
    info.heading === 'カタモンを選択'
      && info.headingFontSize >= 30
      && drawnWithSave.includes('カタモンを選択')
      && !drawnWithSave.includes('モンスターを選択'),
    JSON.stringify({ info, drawnWithSave }));
  check('中断再開は出撃より小さい下側ギアとして噛み合わせる',
    Number.isFinite(info.sortie.outerRadius)
      && Number.isFinite(info.resume.outerRadius)
      && info.resume.y > info.sortie.y
      && info.resume.outerRadius < info.sortie.outerRadius
      && info.resume.y - info.sortie.y < info.resume.outerRadius + info.sortie.outerRadius,
    JSON.stringify(info));
  check('中断再開ギアは丸い見た目と同じ範囲だけ押せる',
    kt.selectResumeHitForTest(info.resume.x, info.resume.y)
      && !kt.selectResumeHitForTest(info.resume.x + info.resume.w / 2 - 1, info.resume.y + info.resume.h / 2 - 1),
    JSON.stringify(info.resume));
  check('中断データがある時は小型ギアに再開と表示する',
    drawnWithSave.includes('再開')
      && drawnWithSave.includes('中断対戦')
      && !drawnWithSave.includes('▶ 中断した対戦を再開'),
    drawnWithSave.join('/'));
  const drawnWithoutSave = kt.drawSelectForTest(false);
  check('中断データが無い時は再開ギアを表示しない',
    !drawnWithoutSave.includes('再開') && !drawnWithoutSave.includes('中断対戦'),
    drawnWithoutSave.join('/'));
  check('中断再開のタッチ操作はpointerupで一度だけ確定する',
    indexHtml.includes("inputMode = 'newMatchConfirm';")
      && indexHtml.includes("inputMode = 'selectResume';")
      && /inputMode === 'newMatchConfirm'[\s\S]*?resolveNewMatchConfirm\('resume'\)/.test(indexHtml)
      && /inputMode === 'selectResume'[\s\S]*?resumeSuspendedMatch\(\)/.test(indexHtml),
    'resume actions must be committed from pointerup');
  kt.setPhase('battle');
  // Normal CPU 1v1 now has an owner-fenced asynchronous Gear resume path.
  // Keep this historic synchronous pointer regression on the non-Gear legacy
  // suspend contract; Phase 2C covers the normal-CPU async path separately.
  kt.setBattleModeForTest('free');
  kt.save();
  kt.setHasSave(true);
  kt.setPhase('select');
  const resumePointerId = down(info.resume.x, info.resume.y);
  up(resumePointerId, info.resume.x, info.resume.y);
  check('非Gear中断の再開ギアを押して離すと中断データからバトルへ戻る',
    kt.phase() === 'battle' && kt.load() === null,
    JSON.stringify({ phase: kt.phase(), hasSave: kt.load() !== null }));
  kt.setBattleModeForTest('normal');
}

// v135: 通常弾は、キャラを替えても同じ引っぱり・同じ風なら同じ結果にする。
// 必殺技と跳躍は通常弾ではないため、従来のキャラ固有値を残す。
{
  const normalProfiles = kt.chars().map(key => ({ key, ...kt.shotPhysicsProfileForTest(key, false, false) }));
  const commonNormal = normalProfiles.every(p =>
    p.blastMul === 1 && p.windMul === 1 && p.gravityMul === 1
      && p.velScaleMul === 1 && p.guideMul === 1 && p.tBias === 1);
  check('全16キャラの通常弾は弾速・風・重力・爆風・狙い線・CPU弾道が共通',
    commonNormal, JSON.stringify(normalProfiles));

  const normalVelocities = kt.chars().map(key => ({ key, ...kt.launchVelocityForTest(key, 80, -60, false, false) }));
  check('同じ引っぱりなら全16キャラの通常弾の初速が一致する',
    normalVelocities.every(v => v.vx0 === normalVelocities[0].vx0 && v.vy0 === normalVelocities[0].vy0),
    JSON.stringify(normalVelocities));

  const firedProfiles = [];
  for (const key of kt.chars()) {
    kt.setCharactersForTest(key, key);
    kt.clearProjectilesForTest();
    kt.fireForTest(100, -200);
    firedProfiles.push({ key, ...kt.projectileProfilesForTest()[0] });
  }
  kt.clearProjectilesForTest();
  kt.setCharactersForTest('kyoryu', 'kyoryu');
  check('実際に生成される通常弾も爆風・風・重力が共通',
    firedProfiles.every(p => p.blastMul === 1 && p.windMul === 1 && p.gravityMul === 1),
    JSON.stringify(firedProfiles));

  // v203: Bインパクトは爆風の威力を残しつつ、地形だけ通常弾の1.5倍に抑える。
  // 命中者は大きく位置を飛ばさず、短い浮き上がりと横移動で「少し吹き飛ぶ」。
  kt.setCharactersForTest('iwa', 'iwa');
  const bImpactTarget = kt.unitById('e1');
  let bImpactGroundX = kt.stageW() * 0.5;
  for (let x = kt.stageW() * 0.2; x <= kt.stageW() * 0.8; x += 12) {
    if (kt.groundYAt(x) < kt.deadLineY() - 80) { bImpactGroundX = x; break; }
  }
  kt.placeOnGround(bImpactTarget.id, bImpactGroundX);
  // 地形生成によっては足場がデッドライン間際になるため、吹き飛び検証だけは安全な高さへ固定する。
  kt.setUnitPositionForTest(bImpactTarget.id, bImpactTarget.x, Math.min(bImpactTarget.y, kt.deadLineY() - 150));
  kt.setUnitHpForTest(bImpactTarget.id, bImpactTarget.maxHp);
  kt.clearProjectilesForTest();
  const bImpactIndex = kt.fireSpecialImmediateForUnitForTest('p1', 'iwa', 260, -180);
  const bImpactProfile = kt.projectileProfilesForTest()[bImpactIndex];
  const bImpactCratersBefore = kt.craters();
  const bImpactTargetBefore = { x: bImpactTarget.x, y: bImpactTarget.y };
  // 最大HPでも先に倒れず、地形穴にも巻き込まれない距離で「生存中の命中者が少し飛ぶ」を測る。
  kt.detonateProjectileForTest(bImpactIndex, bImpactTarget.x - 180, bImpactTarget.y);
  const bImpactCrater = kt.craterHistory()[bImpactCratersBefore];
  check('Bインパクトの地形破壊半径は通常弾44pxの1.5倍',
    bImpactProfile?.terrainBlastMul === 1.5 && Math.abs((bImpactCrater?.r || 0) - 66) < 0.0001,
    JSON.stringify({ profile: bImpactProfile, crater: bImpactCrater }));
  const bImpactHitUnit = kt.unitById(bImpactTarget.id);
  const bImpactAfterHit = {
    grounded: bImpactHitUnit.grounded,
    vy: bImpactHitUnit.vy,
    knockbackVx: bImpactHitUnit.knockbackVx,
    hp: bImpactHitUnit.hp
  };
  const bImpactAfterStep = kt.updateFallingForTest(bImpactTarget.id, 0.1);
  check('Bインパクト命中者は少しだけ上方かつ爆心から外側へ吹き飛ぶ',
    bImpactAfterHit.grounded === false && bImpactAfterHit.vy < 0
      && bImpactAfterStep.x > bImpactTargetBefore.x
      && bImpactAfterStep.x - bImpactTargetBefore.x <= 20,
    JSON.stringify({ before: bImpactTargetBefore, hit: bImpactAfterHit, step: bImpactAfterStep }));
  kt.placeOnGround(bImpactTarget.id, bImpactTargetBefore.x);
  kt.setCharactersForTest('kyoryu', 'kyoryu');
  kt.clearProjectilesForTest();

  const normalTrajectorySpecials = ['tori', 'mecha'];
  const characterProfilesStay = kt.chars().every(key => {
    const def = kt.character(key);
    const special = kt.shotPhysicsProfileForTest(key, true, false);
    const jump = kt.shotPhysicsProfileForTest(key, false, true);
    const specialStays = normalTrajectorySpecials.includes(key)
      ? special.blastMul === 1 && special.windMul === 1 && special.gravityMul === 1
        && special.velScaleMul === 1 && special.guideMul === 1 && special.tBias === 1
      : (special.blastMul === (def.blastMul || 1)
      && special.windMul === (def.windMul || 1)
      && special.gravityMul === (def.gravityMul || 1)
      && special.velScaleMul === (def.velScaleMul || 1)
      && special.guideMul === (def.guideMul || 1)
      && special.tBias === (def.tBias || 1));
    return specialStays
      && jump.blastMul === (def.blastMul || 1)
      && jump.windMul === (def.windMul || 1)
      && jump.gravityMul === (def.gravityMul || 1)
      && jump.velScaleMul === (def.velScaleMul || 1)
      && jump.guideMul === (def.guideMul || 1)
      && jump.tBias === (def.tBias || 1);
  });
  check('フェニーチェとクロムギアの必殺は通常弾と同じ物理で、全キャラの跳躍は固有の弾道値を残す', characterProfilesStay);

  const specialFlight = {};
  for (const key of normalTrajectorySpecials) {
    kt.clearProjectilesForTest();
    kt.fireSpecialImmediateForTest(key, 120, -80);
    specialFlight[key] = kt.projectileProfilesForTest();
  }
  kt.clearProjectilesForTest();
  check('フェニーチェ必殺とクロムギア中央弾は通常弾と同じ初速・風・重力で飛ぶ',
    specialFlight.tori.length === 1
      && specialFlight.tori[0].vx === 120 && specialFlight.tori[0].vy === -80
      && specialFlight.tori[0].windMul === 1 && specialFlight.tori[0].gravityMul === 1
      && specialFlight.mecha.length === 3
      && specialFlight.mecha[1].vx === 120 && specialFlight.mecha[1].vy === -80
      && specialFlight.mecha.every(p => p.windMul === 1 && p.gravityMul === 1),
    JSON.stringify(specialFlight));
}

// v146: 通常弾そのものはv135で共通化したが、岩と騎士だけ被ダメージ軽減が残り、
// 同じ通常弾を同じ位置へ当てても最終ダメージが揃っていなかった。HPと移動力は維持し、
// 防御補正と、実際に生成された通常弾の命中結果が全16キャラで同じことを確認する。
{
  const defenseProfiles = kt.chars().map(key => ({ key, multiplier: kt.defenseMultiplierForTest(key) }));
  check('全16キャラの防御補正は等倍で共通',
    defenseProfiles.every(p => p.multiplier === 1), JSON.stringify(defenseProfiles));

  const originalPositions = ['p1', 'e1'].map(id => {
    const u = kt.unitById(id);
    return { id, x: u.x, y: u.y };
  });
  const normalImpacts = [];
  for (const key of kt.chars()) {
    kt.setCharactersForTest('kyoryu', key);
    const shooter = kt.unitById('p1');
    const target = kt.unitById('e1');
    // 地形を削った結果が後続の検査へ漏れないよう、画面外で同じ命中計算だけを通す。
    shooter.x = 100; shooter.y = -300;
    target.x = 700; target.y = -300;
    kt.clearProjectilesForTest();
    kt.fireForTest(100, -200, { unitId: 'p1' });
    const projectile = kt.projectileProfilesForTest()[0];
    const before = target.hp;
    const detonated = kt.detonateProjectileForTest(0, target.x, target.y);
    normalImpacts.push({ key, detonated, blastMul: projectile?.blastMul, damage: before - target.hp });
  }
  kt.clearProjectilesForTest();
  kt.setCharactersForTest('kyoryu', 'kyoryu');
  for (const pos of originalPositions) {
    const u = kt.unitById(pos.id);
    u.x = pos.x; u.y = pos.y;
  }
  check('同じ位置へ直撃した通常弾は全16キャラに同じ爆風と45ダメージ',
    normalImpacts.every(hit => hit.detonated && hit.blastMul === 1 && hit.damage === 45),
    JSON.stringify(normalImpacts));
}

// v138: Pixabayの爆発音は通常弾の着弾だけに使う。
// 必殺技や跳躍まで同じ印を持たせると、それぞれ固有の着弾音まで通常弾の音に置き換わってしまう。
{
  kt.setPhase('battle');
  kt.setCharactersForTest('kyoryu', 'medama');
  kt.clearProjectilesForTest();
  kt.fireForTest(100, -200, { unitId: 'p1' });
  const normal = kt.projectileProfilesForTest()[0];
  kt.clearProjectilesForTest();
  kt.fireForTest(100, -200, { unitId: 'p1', useJump: true });
  const jump = kt.projectileProfilesForTest()[0];
  check('通常弾だけがPixabay着弾音の印を持ち、跳躍弾には付かない',
    !!normal && normal.normalImpactSound === true
      && !!jump && jump.normalImpactSound === false,
    JSON.stringify({ normal, jump }));

  let soundRoute = null;
  try {
    kt.setNormalImpactBufferForTest();
    const before = kt.decodedAudioStartsForTest();
    kt.explodeAtForTest(-500, -500, 1, 'p1', true);
    const afterNormal = kt.decodedAudioStartsForTest();
    kt.explodeAtForTest(-500, -500, 1, 'p1', false);
    soundRoute = { before, afterNormal, afterSpecial: kt.decodedAudioStartsForTest() };
  } catch (err) {
    soundRoute = { error: String(err && err.message || err) };
  }
  check('通常弾の炸裂だけが読み込んだ爆発音を1回鳴らし、従来の炸裂は鳴らさない',
    soundRoute && soundRoute.afterNormal === soundRoute.before + 1
      && soundRoute.afterSpecial === soundRoute.afterNormal,
    JSON.stringify(soundRoute));

  let titleImpactRoute = null;
  try {
    kt.setNormalImpactBufferForTest();
    const before = kt.decodedAudioStartsForTest();
    kt.triggerTitleWallImpactForTest();
    titleImpactRoute = { before, after: kt.decodedAudioStartsForTest() };
  } catch (err) {
    titleImpactRoute = { error: String(err && err.message || err) };
  }
  check('the TAP TO START cannonball uses the same decoded explosion sample at wall impact',
    titleImpactRoute && titleImpactRoute.after === titleImpactRoute.before + 1,
    JSON.stringify(titleImpactRoute));
  kt.clearProjectilesForTest();
}

// v137: 必殺は「キャラからオーラが沸き立つ → カットイン → 発射」の順に見せる。
// 描画だけを足して発射待ちが従来のままだと、オーラとカットインが同時に出てしまうため、
// 実際の保留状態と弾の有無を時間順に確かめる。
{
  const hasSequenceApi = typeof kt.specialSequenceForTest === 'function';
  let phases = null;
  if (hasSequenceApi) {
    kt.setPhase('battle');
    kt.setCharactersForTest('kyoryu', 'medama');
    kt.fillCharges();
    kt.clearProjectilesForTest();
    kt.fireForTest(180, -260, { unitId: 'p1', useSpecial: true });
    const aura = kt.specialSequenceForTest();
    kt.step(aura ? aura.auraDuration + 0.01 : 1);
    const cutin = kt.specialSequenceForTest();
    kt.step(cutin ? cutin.flashDuration + 0.01 : 1);
    const fired = kt.specialSequenceForTest();
    phases = { aura, cutin, fired, projectileCount: kt.projectiles().length };
  }
  check('必殺はオーラだけを先に見せ、その後カットインへ移る',
    !!phases
      && phases.aura.phase === 'aura' && phases.aura.auraVisible && !phases.aura.flashVisible
      && phases.cutin.phase === 'cutin' && !phases.cutin.auraVisible && phases.cutin.flashVisible,
    JSON.stringify(phases));
  check('必殺弾はオーラとカットインを見せ切るまで発射されない',
    !!phases
      && phases.aura.projectileCount === 0 && phases.cutin.projectileCount === 0
      && phases.fired.phase === null && phases.projectileCount > 0,
    JSON.stringify(phases));
  check('オーラはキャラ画像の背後から上向きに描く',
    indexHtml.includes('function drawSpecialAura(u, a)')
      && /function drawUnit\(u\) \{[\s\S]{0,500}drawSpecialAura\(u, a\);[\s\S]{0,1800}ctx\.drawImage\(img, imageRect\.sx, imageRect\.sy, imageRect\.sw, imageRect\.sh, -w \/ 2, UNIT_RADIUS - h \+ groundOffsetY, w, h\);/.test(indexHtml),
    'drawSpecialAuraの描画順が見つかりません');
  const specialCutInSound = typeof kt.specialCutInSoundProfile === 'function'
    ? kt.specialCutInSoundProfile()
    : null;
  const specialCutInSoundAsset = typeof kt.specialCutInSoundAsset === 'function'
    ? kt.specialCutInSoundAsset()
    : null;
  check('必殺カットイン音は提供された新SEを効果音設定の経路で鳴らす',
    !!specialCutInSound
      && specialCutInSound.duckMs >= 350
      && specialCutInSound.duckMs <= 600
      && specialCutInSound.sampleGain === 0.28
      && specialCutInSoundAsset
      && specialCutInSoundAsset.url === 'assets/special-cutin-finisher.mp3'
      && /function playSpecialCutinSample\(\) \{[\s\S]{0,1000}specialCutinBuffer/.test(indexHtml)
      && /function playSpecialSound\(def\) \{[\s\S]{0,300}playSpecialCutinSample\(\)/.test(indexHtml),
    JSON.stringify({ specialCutInSound, specialCutInSoundAsset }));
  const coolKaiSpecialVoiceAsset = typeof kt.coolKaiSpecialVoiceAsset === 'function'
    ? kt.coolKaiSpecialVoiceAsset()
    : null;
  check('クール=カイの必殺技は専用の握り飯ボイスを鳴らす',
    coolKaiSpecialVoiceAsset
      && coolKaiSpecialVoiceAsset.url === 'assets/cool-kai-special-voice.mp3'
      && coolKaiSpecialVoiceAsset.gain === 0.72
      && indexHtml.includes("if (def?.key === 'coolKai')")
      && indexHtml.includes('COOL_KAI_SPECIAL_VOICE_URL')
      && indexHtml.includes('playSpecialSound(pendingShot.def);'),
    JSON.stringify(coolKaiSpecialVoiceAsset));
  kt.clearProjectilesForTest();
}

// v134: キャラ選択の紹介文・型・性能目盛りはゲーム内容と合っていないため出さない。
// v147: 最大HPと、今後内容を決める必殺技の仮説明欄だけを加える。
{
  kt.setPhase('select');
  kt.resetDrawnText();
  kt.render();
  const drawn = kt.drawnText();
  const focused = kt.character(selectWheelCards.focusedKey);
  check('キャラ選択にはキャラ名と必殺技名を描く',
    drawn.includes(focused.name) && drawn.includes('必殺技') && drawn.includes(focused.special),
    drawn.join('/'));
  check('キャラ選択には選んだキャラの最大HPを描く',
    drawn.includes(`HP ${focused.maxHp}`),
    drawn.join('/'));
  check('キャラ選択には選んだキャラらしい必殺技紹介を描く',
    typeof focused.selectFlavor === 'string' && focused.selectFlavor.length > 0
      && drawn.includes(focused.selectFlavor)
      && !drawn.includes('(仮)雰囲気解説')
      && kt.chars().every(key => {
        const character = kt.character(key);
        return typeof character.selectFlavor === 'string' && character.selectFlavor.length > 0;
      }),
    drawn.join('/'));
  const presentation = kt.selectCardPresentation();
  check('キャラ選択カードは木板と紙札の意匠にする',
    !!presentation
      && presentation.cardMaterial === 'wood'
      && presentation.descriptionMaterial === 'parchment'
      && presentation.neonAccent === false,
    JSON.stringify(presentation));
  check('キャラ選択には型と性能目盛りを描かない',
    !drawn.includes('耐久') && !drawn.includes('火力') && !drawn.includes('機動')
      && !kt.chars().map(key => kt.character(key)).some(d => drawn.includes(d.role) || drawn.includes(d.roleEn)),
    drawn.join('/'));
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const selectCard = /function drawWheelSelectCard\(card, def\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  function drawFixedSelectSortieButton/.exec(html);
  check('キャラ選択には古い紹介文と古い必殺技説明を描かない',
    !!selectCard && !/def\.(?:desc|specialDesc|selectStats|role|roleEn)\b/.test(selectCard[1]),
    selectCard ? '古い情報の参照が残っています' : 'カード描画関数が見つかりません');
}

// v180: キャラクターの表示名を、種族名から固有名へ更新する。
const EXPECTED_CHARACTER_NAMES = {
  kyoryu: 'ディラノ', medama: 'アイボルト', iwa: 'ゴーロッカ', tori: 'フェニーチェ',
  barugerukan: 'バルゲルカン', nisenmono: 'オベリスク', burumutan: 'ブルームタン', sumoeru: 'スモエル',
  doRednote: 'ドレッドアロー', mocchario: 'モッチャリオ', mecha: 'クロムギア', akuma: 'ルビデビ',
  jinba: 'アスタウロス', kishi: 'パラディエ', neko: 'にゃんタンク', shinigami: 'ヨミガマ'
};
check('全キャラクターの表示名が確定した名前になっている',
  Object.entries(EXPECTED_CHARACTER_NAMES).every(([key, name]) => kt.character(key).name === name),
  JSON.stringify(Object.fromEntries(Object.keys(EXPECTED_CHARACTER_NAMES).map(key => [key, kt.character(key).name]))));

// v191: 必殺技の性能は変えず、キャラクター性が伝わる固有名へ統一する。
const EXPECTED_SPECIAL_NAMES = {
  barugerukan: 'バルコプター',
  burumutan: 'ドレインシード',
  tori: 'フレイムウェーブ',
  sumoeru: '職人カエル玉',
  iwa: 'Bインパクト',
  medama: 'バインドスピット',
  nisenmono: 'プリズムビーム'
};
for (const [key, specialName] of Object.entries(EXPECTED_SPECIAL_NAMES)) {
  check(`${kt.character(key).name}の必殺技名は「${specialName}」`,
    kt.character(key).special === specialName,
    kt.character(key).special);
}

// v208: キャラ選択の必殺技説明は雰囲気文ではなく、実際の性能を短く示す。
const EXPECTED_SPECIAL_FLAVORS = {
  kyoryu: '高威力・大爆風の砲弾を放つ',
  medama: '命中相手を2手番、行動不能にする',
  iwa: '通常弾の1.5倍で破壊し、相手を吹き飛ばす',
  tori: '着弾から左右へ炎が広がり、6×3回ダメージ',
  barugerukan: 'マーキング弾を放ち、着弾地点へ機銃掃射',
  nisenmono: '反射する貫通レーザーで敵を射抜く',
  burumutan: '与えたダメージ分、自分のHPを回復',
  sumoeru: '敵の近くで炸裂し、8方向へ中小弾を放つ',
  doRednote: '着弾後、相手に向かって地雷針が追尾する',
  mocchario: '大爆風のレーザー砲を発射',
  mecha: '3発の高速弾を狭い扇状に連射',
  akuma: '風と重力を無視して直進し、直接ダメージ',
  jinba: '地面着弾後、中・小・小の連続爆発で掘進',
  kishi: 'HPを15払って、超高威力の一撃',
  neko: '大爆風で吹き飛ばし、次の手番をスキップ',
  shinigami: '着弾地点の真下へ、縦穴を掘る'
};
for (const [key, flavor] of Object.entries(EXPECTED_SPECIAL_FLAVORS)) {
  check(`${kt.character(key).name}の必殺技説明は性能を示す`,
    kt.character(key).selectFlavor === flavor,
    kt.character(key).selectFlavor);
}

// v119: 対戦開始時のVSカットイン。通常のターン交代カットインとは
// 別の種類として持たせないと、4体の顔ぶれを描き分けられない。
check('VSカットインの状態を検査できる', typeof kt.matchupCutIn === 'function');

check('死神がキャラ選択に追加されている', kt.chars().includes('shinigami'), kt.chars().join(','));
const deathGate = kt.deathGate();
check('デスゲートはDEAD LINEの下から固定射程',
  deathGate.range === 260 && deathGate.speed === 310 && deathGate.bottomRadius === 26 && deathGate.topRadius === 8 && deathGate.curvePower === 3 && deathGate.stride === 14 && deathGate.startDepth === 34,
  JSON.stringify(deathGate));
const shinigami = kt.character('shinigami');
const dreadArrow = kt.character('doRednote');
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
  // 必殺技の大きい丸窓とVSの小さい丸窓では、同じ切り出しでも顔の見え方が違う。
  // VS側に16体ぶんの専用値が無いと、岩男やトリ戦車の顔ではなく車体が中央へ来る。
  const matchupFaceBlock = /const MATCHUP_FACES = \{([\s\S]*?)\n  \};/.exec(html);
  check('VSカットインは全キャラ専用の顔位置を持つ',
    !!matchupFaceBlock
    && kt.chars().every(key => new RegExp(`(?:^|[,\\s])${key}:\\s*\\[`).test(matchupFaceBlock[1]))
    && html.includes('MATCHUP_FACES[entry.character] || CHARACTER_FACES[entry.character] || DEFAULT_FACE'),
    matchupFaceBlock ? matchupFaceBlock[1] : 'MATCHUP_FACESなし');
  // 判定は全キャラ共通の円。絵の大きさを揃えても、どこに当たるかは絵からは読めない。
  check('当たり判定を円で可視化している',
    html.includes('function drawUnitHitCircle(u)')
    && html.includes('ctx.arc(a.x, a.y, UNIT_HIT_RADIUS, 0, Math.PI * 2);')
    && html.includes('drawUnitHitCircle(u);'));
  check('判定の輪はキャラ画像より先に描く',
    // 両者の間には描画理由のコメントもある。文字数ではなく同じ drawUnit 内の順序を見る。
    /function drawUnit\(u\) \{[\s\S]{0,500}drawUnitHitCircle\(u\);[\s\S]{0,1800}ctx\.drawImage\(img, imageRect\.sx, imageRect\.sy, imageRect\.sw, imageRect\.sh, -w \/ 2, UNIT_RADIUS - h \+ groundOffsetY, w, h\);/.test(html));
  // 直撃の円はキャラの体に乗せる。u.y は足元から16pxしか上にないので、そのまま
  // 中心にすると見えている上半分に当たらない(実機で指摘)。
  check('直撃の円をキャラの体へ上げている',
    html.includes('const UNIT_HIT_RISE = 23;')
    && html.includes('return { x: u.x, y: u.y - UNIT_HIT_RISE };'));
  // 見えている輪と実際の判定が同じ中心を使うこと。別々だと嘘の表示になる。
  check('見えている輪と実際の判定が同じ中心を使う',
    // 可視化・直撃判定・花火の接近信管が同じ中心を使う。定義側は数えない。
    (html.match(/const a = unitHitCenter\(u\);/g) || []).length === 3);
  // 上げるのは直撃の円だけ。発射基点と爆風の基準を動かすと、足元へ撃った時の距離が
  // 変わってダメージが全キャラぶん変わる。
  check('発射基点と爆風の基準は動かしていない',
    html.includes('function unitAnchor(u) {')
    && /function unitAnchor\(u\) \{[\s\S]{0,200}return \{ x: u\.x, y: u\.y \};/.test(html));
  check('透明余白の接地補正は描画専用で、物理足元を動かしていない',
    html.includes('function characterGroundOffsetY(key)')
      && kt.character('medama').groundOffsetY === 2
      && kt.character('iwa').groundOffsetY === 2
      && kt.character('doRednote').groundOffsetY === 25
      && kt.character('hamulton').groundOffsetY === 9
      && kt.character('coolKai').groundOffsetY === 37
      && /function drawJumpProjectile\(p\) \{[\s\S]{0,1300}const groundOffsetY = characterGroundOffsetY\(u\.character\);[\s\S]{0,900}UNIT_RADIUS - h \+ groundOffsetY/.test(html),
    JSON.stringify({
      medama: kt.character('medama').groundOffsetY,
      iwa: kt.character('iwa').groundOffsetY,
      dread: kt.character('doRednote').groundOffsetY,
      hamulton: kt.character('hamulton').groundOffsetY,
      coolKai: kt.character('coolKai').groundOffsetY
    }));
}
// ===== v123: 対戦開始カットインを砲弾ネームプレートにした =====
// 素材はユーザー提供の1枚のシートから切り出した5点。左右から砲弾が飛んできて
// 中央でぶつかり、そこにVSの紋章が出る。
{
  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'index.html'), 'utf8');
  const vs = kt.vsPlate();
  const matchupStart = html.indexOf('function drawMatchupCutIn() {');
  const matchupEnd = html.indexOf('function drawCutIn()', matchupStart);
  const matchupBody = matchupStart >= 0 && matchupEnd > matchupStart
    ? html.slice(matchupStart, matchupEnd)
    : '';
  check('砲弾の素材5点をassetsから読み込んでいる',
    ['ally1', 'foe1', 'ally2', 'foe2', 'badge'].every(k => /^vs-(plate-(ally|foe)-[12]|badge)\.png$/.test(vs.srcs[k] || '')),
    JSON.stringify(vs.srcs));
  check('その5点が実際にリポジトリへ入っている',
    ['vs-plate-ally-1', 'vs-plate-foe-1', 'vs-plate-ally-2', 'vs-plate-foe-2', 'vs-badge']
      .every(n => fs2.existsSync(path2.join(__dirname, '..', 'assets', n + '.png'))));
  // 窓の数は対戦人数と一致していないと、2vs2で味方が出ない/1vs1で空欄が出る。
  check('1vs1の砲弾は窓が1つ、2vs2の砲弾は窓が2つ',
    vs.slots.ally1.length === 1 && vs.slots.foe1.length === 1
    && vs.slots.ally2.length === 2 && vs.slots.foe2.length === 2,
    JSON.stringify(Object.entries(vs.slots).map(([k, v]) => k + ':' + v.length)));
  check('VS紋章は前面、上下の砲弾カードは中央から離れて4人を読める',
    matchupBody.indexOf('const badge = vsPlateImages.badge;') > matchupBody.indexOf('drawVsPlate(cutIn.right, true, foeSlide, flash);')
    && matchupBody.indexOf('const badge = vsPlateImages.badge;') > matchupBody.indexOf('drawVsPlate(cutIn.left, false, allySlide, flash);')
    && html.includes('const VS_ALLY_OFFSET = { x: -48, y: -84 };')
    && html.includes('const VS_FOE_OFFSET = { x: 40, y: 70 };')
    && html.includes('const VS_BADGE_W = 104;')
    && html.includes('const VS_BADGE_OFFSET_Y = -6;')
    && matchupBody.includes('ctx.translate(VW / 2, VS_CENTER_Y + VS_BADGE_OFFSET_Y);'),
    matchupBody.slice(matchupBody.indexOf('drawVsPlate(cutIn.right'), matchupBody.indexOf('drawVsPlate(cutIn.right') + 540));
  // 窓は絵に対する比率で持つ。0〜1を外れると、顔が砲弾からはみ出す。
  check('窓の位置は絵に対する比率で、必ず絵の内側に収まる',
    Object.values(vs.slots).every(list => list.every(([x0, y0, x1, y1]) =>
      x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x1 > x0 && y1 > y0)),
    JSON.stringify(vs.slots));
  check('2vs2の2つの窓は重ならない',
    [vs.slots.ally2, vs.slots.foe2].every(([a, b]) => a[2] <= b[0]),
    JSON.stringify([vs.slots.ally2, vs.slots.foe2]));
  // 素材の砲弾はどちらも右向き。相手陣営を反転しないと、先端が中央で向き合わない。
  check('相手陣営の砲弾は左右反転して描く',
    /if \(mirror\) ctx\.scale\(-1, 1\);/.test(html));
  check('反転した砲弾では窓の左右も入れ替える',
    html.includes('const x0 = mirror ? 1 - raw[2] : raw[0];')
    && html.includes('const x1 = mirror ? 1 - raw[0] : raw[2];'));
  // 画像の読み込みは端末や回線で失敗しうる。失敗しても対戦カードは必ず読めること。
  check('砲弾の絵が届かない端末のために、枠を自前で描く道がある',
    /if \(vsPlateReady\(img\)\) \{[\s\S]{0,400}\} else \{[\s\S]{0,400}roundRect/.test(html));
  check('顔の切り出しはVS専用の値をそのまま使っている',
    html.includes('MATCHUP_FACES[entry.character] || CHARACTER_FACES[entry.character] || DEFAULT_FACE'));
  // ぶつかる瞬間はカットインの中に収まっていること。飛び終わる前に消えたら演出にならない。
  check('砲弾がぶつかるのはカットインが終わるより前',
    vs.flySec > 0 && vs.flySec < vs.duration * 0.5,
    `fly=${vs.flySec} duration=${vs.duration}`);
  // v126で表示時間を2倍にした(1.8→3.6秒)。名前と能力を読む時間を取るため。
  // 飛来と撃ち抜けの速さは変えていないので、伸びた分はまん中の「見せる時間」に入る。
  check('VSカットの表示時間は3.6秒で、動きの速さは変えていない',
    vs.duration === 3.6 && vs.flySec === 0.42 && vs.exitSec === 0.52,
    `duration=${vs.duration} fly=${vs.flySec} exit=${vs.exitSec}`);
  check('止まって見せている時間が、動いている時間より長い',
    vs.duration - vs.flySec - vs.exitSec > vs.flySec + vs.exitSec,
    `見せる=${(vs.duration - vs.flySec - vs.exitSec).toFixed(2)}秒`);
  check('砲弾は画面の外から飛んでくる',
    html.includes('const allySlide = -(1 - eased) * (VW + VS_PLATE_W)')
    && html.includes('const foeSlide = (1 - eased) * (VW + VS_PLATE_W)'));
  // 傾いたまま真横へ滑ると「飛んでいる」ように見えない。回転のあとに動かして、
  // 先端の向いている方向へ進ませる(実機で指摘)。
  check('砲弾は自分が向いている方向へ進む',
    /ctx\.rotate\(VS_TILT\);[\s\S]{0,300}ctx\.translate\(slideX, 0\);/.test(html)
    && !html.includes('VW / 2 + off.x + slideX'));
  // 最後はお互いを撃ち抜けて画面の外へ出る(実機で要望)。
  check('最後はお互いを撃ち抜けて画面の外へ出る',
    html.includes('const allySlide = -(1 - eased) * (VW + VS_PLATE_W) + recoil * -1 + exitSlide;')
    && html.includes('const foeSlide = (1 - eased) * (VW + VS_PLATE_W) + recoil - exitSlide;'));
  check('撃ち抜けが始まるのはぶつかった後で、カットインの中で終わる',
    vs.flySec + vs.exitSec < vs.duration && vs.exitSec > 0,
    `fly=${vs.flySec} exit=${vs.exitSec} duration=${vs.duration}`);
  // 顔の切り出しは16体ぶん揃っていること。抜けると DEFAULT_FACE に落ちて顔から外れる。
  check('顔の切り出しは全16体ぶん揃っている',
    kt.chars().every(key => Array.isArray(vs.faces[key]) && vs.faces[key].length === 3),
    kt.chars().filter(key => !vs.faces[key]).join(','));
  check('切り出しの値は画像の内側を指している',
    kt.chars().every(key => {
      const face = vs.faces[key];
      if (!Array.isArray(face)) return false; // 抜けは前の検査が名指しする
      const [fx, fy, fw] = face;
      return fx > 0 && fx < 1 && fy > 0 && fy < 1 && fw > 0.1 && fw <= 0.6;
    }), JSON.stringify(vs.faces));
  // 名前の帯があごを隠していたので、帯の上の範囲で顔を中央に置く。
  check('顔は名前の帯を避けた範囲の中央に置く',
    html.includes('const cy = rect.y + (rect.h - band) / 2;'));
  // v124: 1vs1は窓が広く、顔を外側へ寄せた残りが大きく空く(実機で指摘)。
  // そこへ入れるのは「キャラだけで決まる値」に限る。名前や戦績のような
  // 端末ごとに変わる値を入れると、同じ試合なのに画面が食い違う。
  {
    const infoFn = /function drawVsPlateInfo\(([\s\S]*?)\r?\n  \}\r?\n/.exec(html);
    const body = infoFn ? infoFn[1] : '';
    check('空きに出す情報は端末ごとに変わる値を使わない',
      !!body && !/\bonline\b|winStreak|localPlayerName|firebaseSeatName|Date\./.test(body), body.slice(0, 200));
  }
}



check('死神は右向き原画で、戦闘中だけ2割大きく表示する',
  !shinigami.facesLeft && shinigami.spriteScale === 1.21,
  JSON.stringify(shinigami));
check('ドレッドアローの原画は右向きで個別反転を持たない',
  !dreadArrow.facesLeft,
  JSON.stringify(dreadArrow));
check('ドレッドアローとクール=カイは透明余白を除いて大きく表示する',
  dreadArrow.imageCrop?.sw <= 0.72 && dreadArrow.imageCrop?.sh <= 0.65
    && kt.character('coolKai').imageCrop?.sx >= 0.12
    && kt.character('coolKai').previewImageCrop?.sw <= 0.72,
  JSON.stringify({ dreadArrow: dreadArrow.imageCrop, coolKai: kt.character('coolKai').imageCrop }));
check('キャラ選択の必殺技詳細はVSカットインなしの通信不要デモを開く',
  indexHtml.includes("function startSpecialDemo(key)")
    && indexHtml.includes("battleMode = 'demo';")
    && indexHtml.includes("if (battleMode !== 'demo' && !(isOnline() && online.kind === 'firebase')) showBattleStartCutIn();")
    && indexHtml.includes("if (battleMode !== 'demo') primeStageBgm(currentThemeKey);")
    && indexHtml.includes("if (specialDemo) return;")
    && indexHtml.includes("ctx.fillText('詳細 ▶'")
    && indexHtml.includes("drawOutlinedText('必殺技デモ'"),
  '必殺技デモの独立した開始・演出省略・入力停止がありません');
kt.startBattle('shinigami');
const vs1v1 = kt.matchupCutIn();
check('1vs1の開始時は両陣営1体ずつのVSカットイン',
  vs1v1 && vs1v1.kind === 'matchup'
    && vs1v1.left.map(entry => entry.id).join(',') === 'p1'
    && vs1v1.right.map(entry => entry.id).join(',') === 'e1',
  JSON.stringify(vs1v1));
const turnBeforeVs = kt.state().turnCount;
kt.step(0.5);
check('VSカットイン中は対戦を進めない',
  kt.state().turnCount === turnBeforeVs && !kt.hud().fireActive && !kt.hud().moveActive,
  JSON.stringify({ before: turnBeforeVs, after: kt.state().turnCount, hud: kt.hud() }));
settle();
check('VSカットインは自動で終了する', !kt.hasCutIn());
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

// v207: CPU BATTLEは、弾や演出の途中ではなく安全なターン開始状態を自動保存する。
// これによりアプリを終了しても、最大でその手番の最初から再開できる。
kt.clearSuspendedForTest();
kt.startTurnForTest();
const turnStartAutoSave = kt.loadSuspendedForTest();
check('CPU BATTLEはターン開始時に中断データを自動保存する',
  !!turnStartAutoSave
    && turnStartAutoSave.battleMode === 'normal'
    && turnStartAutoSave.turnCount === kt.state().turnCount
    && turnStartAutoSave.activeIndex === kt.state().activeIndex,
  JSON.stringify(turnStartAutoSave && {
    battleMode: turnStartAutoSave.battleMode,
    turnCount: turnStartAutoSave.turnCount,
    activeIndex: turnStartAutoSave.activeIndex
  }));
kt.clearSuspendedForTest();

// ---- 3. フリーモード ----
kt.startFree();
check('フリーモードに入る', kt.mode() === 'free', kt.mode());
const fc = kt.freeConfig();
check('フリーモードのキャラ設定が反映される',
  kt.unitById('p1').character === kt.chars()[fc.playerIndex] &&
  kt.unitById('e1').character === kt.chars()[fc.cpuIndex],
  `${kt.unitById('p1').character}/${kt.unitById('e1').character}`);
const freeTrainingOptions = kt.freeTrainingOptions();
let trainingRules = null;
let practiceWind = null;
let practiceSpecialReady = false;
let practiceJumpReady = null;
let normalSpecialUnaffected = false;
let practicePlayerOnlySpecial = false;
let practiceWindPowerScale = null;
if (freeTrainingOptions) {
  kt.setFreeTrainingForTest({
    special: 'always', jump: 'standard', cpuAi: 'off', windDirection: 'right', windStrength: '10'
  });
  kt.startFreeMatch();
  kt.unitById('p1').specialCharge = 0;
  trainingRules = kt.practiceRulesForTest();
  practiceWind = kt.wind();
  practiceSpecialReady = kt.specialReady();
  practiceJumpReady = kt.refreshPracticeJumpForTest('p1');
  kt.setBattleModeForTest('normal');
  normalSpecialUnaffected = !kt.specialReady();
  kt.setBattleModeForTest('free');
  kt.setFreeTrainingForTest({ special: 'player' });
  kt.startFreeMatch();
  kt.unitById('p1').specialCharge = 0;
  kt.unitById('e1').specialCharge = 0;
  practicePlayerOnlySpecial = kt.specialReady()
    && !kt.specialReadyForTest(SEAT === 'p1' ? 'e1' : 'p1');
  kt.setFreeTrainingForTest({
    special: 'normal', jump: 'standard', cpuAi: 'mid', windDirection: 'random', windStrength: '6'
  });
  kt.startFreeMatch();
  kt.setFreeTrainingForTest({ windDirection: 'right', windStrength: '7' });
  kt.startFreeMatch();
  practiceWindPowerScale = kt.wind();
}
check('演習で必殺・CPU・風を切替でき、跳躍は全モード共通の毎手番ルールを表示する',
  !!freeTrainingOptions
    && Object.keys(freeTrainingOptions).join(',') === 'special,jump,cpuAi,windDirection,windStrength'
    && trainingRules?.specialAlwaysFull === true
    && trainingRules?.jumpEachTurn === true
    && freeTrainingOptions.jump?.length === 1
    && freeTrainingOptions.jump[0]?.key === 'standard'
    && trainingRules?.cpuEnabled === false
    && practiceWind?.dir === 1 && practiceWind?.strength === 1
    && practiceSpecialReady === true && practiceJumpReady === true
    && normalSpecialUnaffected === true
    && practicePlayerOnlySpecial === true,
  JSON.stringify({ freeTrainingOptions, trainingRules, practiceWind, practiceSpecialReady, practiceJumpReady, normalSpecialUnaffected, practicePlayerOnlySpecial }));
kt.setBattleModeForTest('normal');
const jumpReadyWithoutLock = kt.jumpTurnRefreshForTest('p1', 0);
const jumpBlockedByMoveLock = kt.jumpTurnRefreshForTest('p1', 1);
check('跳躍は通常戦でも各手番に戻るが、着地後の移動不能中だけ使用できない',
  jumpReadyWithoutLock?.refreshed === true
    && jumpReadyWithoutLock?.canUse === true
    && jumpBlockedByMoveLock?.refreshed === true
    && jumpBlockedByMoveLock?.canUse === false
    && jumpBlockedByMoveLock?.moveLockTurns === 1,
  JSON.stringify({ jumpReadyWithoutLock, jumpBlockedByMoveLock }));
kt.setBattleModeForTest('free');
check('practice WIND POWER uses the same 0-to-10 scale as the battle wind arrow',
  Array.isArray(freeTrainingOptions?.windStrength)
    && freeTrainingOptions.windStrength.map(option => option.key).join(',') === '0,1,2,3,4,5,6,7,8,9,10'
    && practiceWindPowerScale?.dir === 1
    && practiceWindPowerScale?.strength === 0.7,
  JSON.stringify({ windStrength: freeTrainingOptions?.windStrength, practiceWindPowerScale }));
const setupRowsBeforeBattle = kt.freeRows();
const freeStageGroupBeforeBattle = kt.freeStageGroup();
const trainingMenuRows = kt.freeTrainingMenuRows();
check('演習前はキャラ・地形・ステージサイズ・人数だけを選び、練習条件は戦闘メニューにまとめる',
  Object.keys(setupRowsBeforeBattle).join(',') === 'player,cpu,terrain,customStage,stageSize,format'
    && !!trainingMenuRows
    && Object.keys(trainingMenuRows).join(',') === 'special,jump,cpuAi,windDirection,windStrength',
  JSON.stringify({ setupRowsBeforeBattle, trainingMenuRows }));
check('カスタムステージはSTAGEの直下にあり、ほかの演習条件と重ならない',
  setupRowsBeforeBattle.customStage.y - setupRowsBeforeBattle.terrain.y === 56
    && setupRowsBeforeBattle.stageSize.y - setupRowsBeforeBattle.customStage.y === 56,
  JSON.stringify({ terrain: setupRowsBeforeBattle.terrain, customStage: setupRowsBeforeBattle.customStage, stageSize: setupRowsBeforeBattle.stageSize }));
check('STAGEは左の共通欄から通常・カスタムの上下2択へ分かれる',
  !!freeStageGroupBeforeBattle
    && freeStageGroupBeforeBattle.label.h === freeStageGroupBeforeBattle.outer.h
    && freeStageGroupBeforeBattle.normal.y === setupRowsBeforeBattle.terrain.y
    && freeStageGroupBeforeBattle.custom.y === setupRowsBeforeBattle.customStage.y
    && freeStageGroupBeforeBattle.normal.x === freeStageGroupBeforeBattle.custom.x
    && freeStageGroupBeforeBattle.normal.w === freeStageGroupBeforeBattle.custom.w
    && freeStageGroupBeforeBattle.normal.x > freeStageGroupBeforeBattle.label.x,
  JSON.stringify({ stageGroup: freeStageGroupBeforeBattle, rows: setupRowsBeforeBattle }));
const customStageLauncherCss = require('fs').readFileSync(require('path').join(__dirname, '..', 'game-custom-stages.css'), 'utf8');
const customStageLauncherJs = require('fs').readFileSync(require('path').join(__dirname, '..', 'game-custom-stages.js'), 'utf8');
check('カスタムステージはSTAGEの下段へ収まる色付きの選択ボタンである',
  /#customStageLauncher\s*\{[^}]*border:\s*1px solid rgba\(102, 190, 184, \.82\)[^}]*background:\s*linear-gradient\(180deg, rgba\(37, 83, 88, \.96\), rgba\(12, 38, 43, \.98\)\)/s.test(customStageLauncherCss),
  customStageLauncherCss.match(/#customStageLauncher\s*\{[^}]*\}/s)?.[0]);
const freeRowStart = indexHtml.indexOf('function drawFreeRow(');
const freeRowEnd = indexHtml.indexOf('function drawFreeStageGroup(', freeRowStart);
const freeRowSource = freeRowStart >= 0 && freeRowEnd > freeRowStart
  ? indexHtml.slice(freeRowStart, freeRowEnd)
  : '';
check('演習設定のキャラ画像は敵欄も右向き原画をそのまま使い、個別反転しない',
  !indexHtml.includes('function freePreviewShouldMirror(')
    && !/scale\s*\(\s*-1\s*,\s*1\s*\)/.test(freeRowSource),
  JSON.stringify({
    hasLegacyMirrorHelper: indexHtml.includes('function freePreviewShouldMirror('),
    hasFreeRowFlip: /scale\s*\(\s*-1\s*,\s*1\s*\)/.test(freeRowSource)
  }));
check('演習設定のキャラ画像は戦闘と同じ面積補正を使い、カードの足元へ接地する',
  /const imageH = \(row\.h - 26\) \* unitSpriteScale\(imageKey\);/.test(freeRowSource)
    && /const previewGroundY = row\.y \+ row\.h \/ 2 - 6;/.test(freeRowSource)
    && /ctx\.translate\(126, previewGroundY\);/.test(freeRowSource)
    && /-imageW \/ 2, -imageH, imageW, imageH/.test(freeRowSource),
  freeRowSource);
check('演習設定の余白が大きい3キャラは可視車体だけをプレビューへ収める',
  /doRednote:[\s\S]{0,1300}previewImageCrop: \{ sx: 0\.14, sy: 0\.235, sw: 0\.72, sh: 0\.53 \}/.test(indexHtml)
    && /hamulton:[\s\S]{0,1000}previewImageCrop: \{ sx: 0\.155, sy: 0\.265, sw: 0\.723, sh: 0\.435 \}/.test(indexHtml)
    && /coolKai:[\s\S]{0,1500}previewImageCrop: \{ sx: 0\.14, sy: 0\.315, sw: 0\.72, sh: 0\.37 \}/.test(indexHtml),
  'ドレッドアロー／ハムルトン／クール=カイの演習プレビュー切り出しが不足しています');
check('サウンド設定を開いている間はカスタムステージのボタンを前面へ出さない',
  /soundPanelOpen,/.test(indexHtml)
    && /\|\| state\.soundPanelOpen\s*\|\|/.test(customStageLauncherJs),
  JSON.stringify({ stateHasSoundPanel: /soundPanelOpen,/.test(indexHtml), launcherHidesForSoundPanel: /\|\| state\.soundPanelOpen\s*\|\|/.test(customStageLauncherJs) }));
kt.clearSuspendedForTest();
kt.startFreeMatch();
kt.endFreeTrainingForTest();
check('演習を終了すると中断セーブを作らずタイトルへ戻る',
  kt.gamePhaseForTest() === 'title' && !kt.suspendedSavePresentForTest(),
  JSON.stringify({ phase: kt.gamePhaseForTest(), hasSave: kt.suspendedSavePresentForTest() }));
// 「最遠」はステージの横幅を端から端まで見渡せる全景であること。
// v159はHUD下から操作盤までへステージ全高を収める倍率を「最遠」としたため、
// 標準でも横幅の約51%しか見えず、スライダーを端まで動かしても全景にできなかった。
kt.setCameraZoomForTest(0.38);
kt.startFreeMatch();
const standardFreeCamera = kt.cameraForTest();
const oneOnOneBattleTop = 176;
const standardWidthCoverage = standardFreeCamera.visibleWidth / 1440;
check('標準の最遠視点はマップ横幅100%を見渡せる',
  Math.abs(standardWidthCoverage - 1) <= 0.001
    && Math.abs(standardFreeCamera.stageBottomY - kt.controlPanelY()) <= 1
    && standardFreeCamera.stageTopY >= oneOnOneBattleTop
    && Math.abs(standardFreeCamera.zoom - 540 / 1440) <= 0.001,
  JSON.stringify({ standardFreeCamera, standardWidthCoverage }));

// 大型を選んだ時だけ、実戦の地形・保存データまで大型寸法へ切り替わること。
// 旧実装では stageSize を受け取らず、ここは常に標準 (1440 / 660 / 480列) のままになる。
kt.changeFreeOption('stageSize', 1);
// 大型でも同じ「最遠」の意味を守り、横幅を全部表示すること。
// 標準の「最遠」から切り替えた時も、生の倍率ではなくスライダー上の距離を引き継ぐ。
kt.startFreeMatch();
const largeFreeSnapshot = kt.buildSnapshotForTest();
const largeFreeCamera = kt.cameraForTest();
const largeWidthCoverage = largeFreeCamera.visibleWidth / 2160;
check('演習で大型を選ぶと2160×960・720列の戦場になる',
  largeFreeSnapshot.stageW === 2160
    && largeFreeSnapshot.stageH === 960
    && largeFreeSnapshot.segments.length === 720
    && largeFreeSnapshot.units.length === 2,
  JSON.stringify({
    stageW: largeFreeSnapshot.stageW,
    stageH: largeFreeSnapshot.stageH,
    columns: largeFreeSnapshot.segments.length,
    units: largeFreeSnapshot.units.length
  }));
check('大型の最遠視点もマップ横幅100%を見渡せる',
  Math.abs(largeWidthCoverage - 1) <= 0.001
    && Math.abs(largeFreeCamera.stageBottomY - kt.controlPanelY()) <= 1
    && largeFreeCamera.stageTopY >= oneOnOneBattleTop
    && Math.abs(largeFreeCamera.zoom - 540 / 2160) <= 0.001
    && Math.abs(largeFreeCamera.sliderValue - standardFreeCamera.sliderValue) <= 0.01
    && Math.abs(largeWidthCoverage - standardWidthCoverage) <= 0.001,
  JSON.stringify({ standardFreeCamera, largeFreeCamera, standardWidthCoverage, largeWidthCoverage }));

// 大型闘技場は横幅だけ2160へ広がっても、三段棚・外壁・吊り障害物が標準用のY座標に
// 残っていた。そのため全景にすると上側へ固まり、下半分がほぼ空になっていた。
// 標準(660高)の構図を大型(960高)へ同比率で広げ、縦の空間も使うことを固定する。
kt.setTerrain('tieredBasin');
const largeArenaLayout = kt.arenaLayoutForTest();
const largeArenaScale = 960 / 660;
const expectedLargeShelves = [
  { y: 365 * largeArenaScale, bottom: 387 * largeArenaScale, reach: 0.205 },
  { y: 445 * largeArenaScale, bottom: 468 * largeArenaScale, reach: 0.235 },
  { y: 525 * largeArenaScale, bottom: 549 * largeArenaScale, reach: 0.265 }
];
const sameNumber = (actual, expected) => Math.abs(actual - expected) <= 1e-9;
check('大型闘技場は外壁と三段足場を高さ960へ広げる',
  sameNumber(largeArenaLayout.wallBottom, 625 * largeArenaScale)
    && largeArenaLayout.shelves.length === expectedLargeShelves.length
    && largeArenaLayout.shelves.every((shelf, index) => (
      sameNumber(shelf.y, expectedLargeShelves[index].y)
        && sameNumber(shelf.bottom, expectedLargeShelves[index].bottom)
        && shelf.reach === expectedLargeShelves[index].reach
    )),
  JSON.stringify(largeArenaLayout));
check('大型闘技場の吊り障害物も高さ960の範囲へ広げる',
  largeArenaLayout.obstacles.length >= 2
    && largeArenaLayout.obstacles.every(obstacle => (
      obstacle.anchorY >= 92 * largeArenaScale
        && obstacle.anchorY < 126 * largeArenaScale
        && obstacle.y >= 238 * largeArenaScale
        && obstacle.y < 426 * largeArenaScale
    )),
  JSON.stringify(largeArenaLayout.obstacles));
const largeArenaLeftSpawn = kt.placeOnGround('p1', kt.stageW() * 0.18);
const largeArenaRightSpawn = kt.placeOnGround('e1', kt.stageW() * 0.82);
check('大型闘技場の出撃位置は広げた上段足場に乗る',
  largeArenaLeftSpawn.y > 480 && largeArenaRightSpawn.y > 480,
  JSON.stringify({ largeArenaLeftSpawn, largeArenaRightSpawn }));
const coopSteelStage = kt.coopSteelStageForTest();
check('協力ボス専用ステージは初期台座だけ鋼鉄で、高所を含む移動用足場は壊れる',
  coopSteelStage.stageW === 2160
    && coopSteelStage.stageH === 960
    && coopSteelStage.terrainCols === 720
    && coopSteelStage.groundY === 848
    && coopSteelStage.platformCenters.length === 7
    && new Set(coopSteelStage.platformCenters.map(platform => Math.round(platform.y / 20))).size >= 6
    && coopSteelStage.platformColumnCount > 200
    && coopSteelStage.steelEveryGround === true
    && coopSteelStage.platformSteel.slice(0, 3).every(Boolean)
    && coopSteelStage.platformSteel.slice(3).every(value => value === false)
    && coopSteelStage.spawnPlatformIntact === true
    && coopSteelStage.destructiblePlatformOpened === true,
  JSON.stringify(coopSteelStage));
// v157/v158は大型の遠い保存値を自動で660/960（表示69%）へ補正していた。
// 新しい距離設定がまだ無い端末でこの値を生倍率として読むと、修正版でも大型だけ
// 途中の距離から始まるため、旧版が作った69%は「最遠」として一度だけ移行する。
kt.setCameraZoomForTest(660 / 960);
kt.startFreeMatch();
const migratedLegacyLargeCamera = kt.cameraForTest();
check('旧版が大型へ保存した69%は、新しい最遠視点へ移行する',
  migratedLegacyLargeCamera.sliderValue <= 0.01
    && Math.abs(migratedLegacyLargeCamera.zoom - largeFreeCamera.zoom) <= 0.01,
  JSON.stringify({ largeFreeCamera, migratedLegacyLargeCamera }));
// 最遠からスライダーで拡大した時は、地図中央ではなく手番キャラへ縦横とも寄ること。
// 全景は中央しか基準にできないため、その中心を保つと両端のキャラが画面外へ消えてしまう。
// 大型の上段にいるキャラは地面固定のままだと縦にも消えるため、地面の接地は全景中だけ。
const largeCameraCenterBeforeZoom = kt.cameraForTest();
const largeActingXBeforeZoom = kt.activeUnit().x;
const largeActingYBeforeZoom = kt.activeUnit().y;
kt.setCameraSliderValueForTest(1);
const largeCameraCenterAfterZoom = kt.cameraForTest();
check('全景から拡大すると手番キャラへ縦横とも寄る',
  largeActingXBeforeZoom >= largeCameraCenterAfterZoom.x
    && largeActingXBeforeZoom <= largeCameraCenterAfterZoom.x + largeCameraCenterAfterZoom.visibleWidth
    && largeActingYBeforeZoom >= largeCameraCenterAfterZoom.y
    && largeActingYBeforeZoom <= largeCameraCenterAfterZoom.y + largeCameraCenterAfterZoom.visibleHeight,
  JSON.stringify({ actingX: largeActingXBeforeZoom, actingY: largeActingYBeforeZoom, before: largeCameraCenterBeforeZoom, after: largeCameraCenterAfterZoom }));
// 以降の既存ケースは標準サイズ前提なので、ここで元へ戻す。
kt.changeFreeOption('stageSize', -1);
kt.startFreeMatch();
kt.setTerrain('tieredBasin');
const standardArenaLayout = kt.arenaLayoutForTest();
check('標準闘技場の従来配置は変えない',
  standardArenaLayout.wallBottom === 625
    && JSON.stringify(standardArenaLayout.shelves) === JSON.stringify([
      { y: 365, bottom: 387, reach: 0.205 },
      { y: 445, bottom: 468, reach: 0.235 },
      { y: 525, bottom: 549, reach: 0.265 }
    ])
    && standardArenaLayout.obstacles.every(obstacle => (
      obstacle.anchorY >= 92 && obstacle.anchorY < 126
        && obstacle.y >= 238 && obstacle.y < 426
    )),
  JSON.stringify(standardArenaLayout));

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
// 共通化した通常弾のクレーター半径は44px。最も低い地形でも、これより
// 床が厚くなければ1発で穴が空いて事故死になる。定数を動かした時にここで気づける。
check('最も低い地形でも共通の通常弾クレーターより床が厚い',
  deadLine - band.max > 44,
  `厚み=${deadLine - band.max} 必要=44`);
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

// 最も低い「底まである地面」に、共通の通常弾クレーターを直接開けても床が残ること。
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
const maxNormalBlast = 44; // 共通化した通常弾のクレーター半径
kt.carveForTest(deepestX, deepestTop, maxNormalBlast);
check('最も低い地形でも通常弾1発では床が抜けない',
  kt.isSolidAt(deepestX, deadLine - 6),
  `x=${deepestX && deepestX.toFixed(1)} 地表=${deepestTop} 半径=${maxNormalBlast} deadLine=${deadLine}`);
// walkableGroundYAt は同じ列に浮島があると、指定位置より下の最初の足場を返す。
// segmentsはクレーター履歴と別管理なので、掘った中心から下を実グリッド上で走査する。
let carvedBottomTop = null;
for (let y = Math.floor(deepestTop); y <= deadLine; y++) {
  if (kt.isSolidAt(deepestX, y)) { carvedBottomTop = y; break; }
}
check('掘った直後の地表はクレーターぶん下がっている',
  Number.isFinite(carvedBottomTop) && carvedBottomTop > deepestTop,
  `掘削後の最下層=${carvedBottomTop} 元=${deepestTop}`);

// ===== 右向き原画統一: 全キャラが左右どちらでも相手を向く =====
// 原画はすべて右向き。facingLeft はワールドで左を向くかだけを示す。
// 全キャラを左右どちらに置いても相手を向くことを、実際に向きを更新させて確かめる。
// 直前のテストで倒れた状態が残っていると、決着後は向きの再判定が走らない。
// 必ず新しい試合から始める。
kt.startBattle('kyoryu');
settle();
kt.disableCpuForTest();
kt.setTerrain('rolling');
let facingNg = [];
for (const key of kt.chars()) {
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
const leftFacingMasterKeys = kt.chars().filter(k => kt.character(k).facesLeft);
check('全キャラのマスター原画は右向きで個別補正を持たない',
  leftFacingMasterKeys.length === 0,
  '左向き登録=[' + leftFacingMasterKeys.join(',') + ']');
check('全キャラが左右どちらに居ても相手の方を向く', facingNg.length === 0,
  `ズレ=${facingNg.slice(0, 8).join(', ')}${facingNg.length > 8 ? ` ほか${facingNg.length - 8}件` : ''}`);

// 異なる右向き原画の組み合わせでも、両方が正しく向くこと。
const firstRightFacing = kt.chars()[0];
const secondRightFacing = kt.chars()[1];
kt.setCharactersForTest(firstRightFacing, secondRightFacing);
kt.placeOnGround('p1', 300);
kt.placeOnGround('e1', 1100);
kt.step(1 / 60);
check('右向き原画だけの組み合わせでも両方が相手を向く',
  kt.facesLeftInWorld('p1') === false && kt.facesLeftInWorld('e1') === true,
  `${firstRightFacing}(p1)=${kt.facesLeftInWorld('p1')} / ${secondRightFacing}(e1)=${kt.facesLeftInWorld('e1')}`);

// ===== v183: 花火(スモエルの必殺)は接近信管でゆっくり開く =====
const fireworkConfig = kt.fireworkConfigForTest();
check('花火の接近信管は敵の90px手前で反応し、120px飛ぶまで起動しない',
  fireworkConfig.proximityRadius === 90 && fireworkConfig.armDistance === 120,
  JSON.stringify(fireworkConfig));
check('花火の8方向弾は従来の半速180px毎秒でゆっくり開く',
  fireworkConfig.shardSpeed === 180,
  JSON.stringify(fireworkConfig));
check('花火の各方向は根元2発が中弾、先端1発が小弾になる',
  fireworkConfig.shardBlasts.join(',') === '0.72,0.56,0.24',
  JSON.stringify(fireworkConfig));

check('花火の接近信管は起動距離前には敵が範囲内でも反応しない',
  kt.fireworkProximityProbeForTest('p1', 'e1', 80, 119) === null);
check('花火の接近信管は起動後、90px以内の敵に反応する',
  kt.fireworkProximityProbeForTest('p1', 'e1', 90, 120) === 'e1');
check('花火の接近信管は90pxを越えた敵には反応しない',
  kt.fireworkProximityProbeForTest('p1', 'e1', 91, 120) === null);
check('花火の接近信管は発射者と同じ陣営には反応しない',
  kt.fireworkProximityProbeForTest('e1', 'e1', 0, 120) === null);

// ===== v221: オベリスクの必殺を反射するプリズムビームへ更新 =====
check('オベリスクの必殺技名は「プリズムビーム」',
  kt.character('nisenmono').special === 'プリズムビーム', kt.character('nisenmono').special);
check('プリズムビームは地形を壊さず敵を貫通する反射レーザー',
  kt.character('nisenmono').specialDesc.includes('地形を壊さず')
    && kt.character('nisenmono').specialDesc.includes('反射')
    && kt.character('nisenmono').specialDesc.includes('貫通'),
  kt.character('nisenmono').specialDesc);
kt.startBattle('nisenmono');
kt.disableCpuForTest();
settle();
const prismShot = kt.fireSpecialImmediateForTest('nisenmono', 300, 0);
const prismProfile = kt.projectileProfilesForTest()[prismShot];
check('プリズムビームは無風・無重力、地形破壊なし、反射上限と射程上限を持つ',
  prismProfile?.prismBeam === true
    && prismProfile?.pierce === true
    && prismProfile?.noTerrain === true
    && prismProfile?.windMul === 0
    && prismProfile?.gravityMul === 0
    && prismProfile?.prismMaxBounces === 4
    && prismProfile?.prismMaxDistance === 1320,
  JSON.stringify(prismProfile));
kt.clearProjectilesForTest();

// ===== v188: ルビデビの必殺は爆発しない直撃電撃 =====
check('ルビデビの必殺説明は障害物無視や爆発ではなく直撃電撃を示す',
  kt.character('akuma').specialDesc.includes('直接ダメージ')
    && !kt.character('akuma').specialDesc.includes('障害物を無視'),
  kt.character('akuma').specialDesc);
kt.startBattle('akuma');
kt.disableCpuForTest();
settle();
const rubideviShot = kt.fireSpecialImmediateForTest('akuma', 300, 0);
const rubideviProfile = kt.projectileProfilesForTest()[rubideviShot];
check('ルビデビの電撃は風・重力だけを無視し、空中障害物には遮られる',
  rubideviProfile?.windMul === 0
    && rubideviProfile?.gravityMul === 0
    && rubideviProfile?.ignoreObstacles === false
    && rubideviProfile?.lightning === true,
  JSON.stringify(rubideviProfile));
check('ルビデビの電撃は爆風と地形破壊を使わない直撃専用弾である',
  rubideviProfile?.directHitOnly === true && rubideviProfile?.noTerrain === true,
  JSON.stringify(rubideviProfile));
const rubideviTarget = kt.unitById('e1');
const rubideviHpBefore = rubideviTarget.hp;
const rubideviCratersBefore = kt.craters();
const rubideviVisualsBefore = kt.impactVisualCountsForTest();
kt.resolveProjectileUnitImpactForTest(rubideviShot, 'e1');
const rubideviVisualsAfter = kt.impactVisualCountsForTest();
check('ルビデビの直撃は相手だけへダメージを与え、爆発も地形破壊も起こさない',
  rubideviTarget.hp < rubideviHpBefore
    && kt.craters() === rubideviCratersBefore
    && rubideviVisualsAfter.explosions === rubideviVisualsBefore.explosions
    && rubideviVisualsAfter.lightningRemnants === rubideviVisualsBefore.lightningRemnants + 1,
  JSON.stringify({
    hp: [rubideviHpBefore, rubideviTarget.hp],
    craters: [rubideviCratersBefore, kt.craters()],
    visuals: [rubideviVisualsBefore, rubideviVisualsAfter]
  }));
kt.clearProjectilesForTest();
const rubideviGroundShot = kt.fireSpecialImmediateForTest('akuma', 0, 300);
const rubideviGroundCraters = kt.craters();
const rubideviGroundVisuals = kt.impactVisualCountsForTest();
kt.resolveProjectileSurfaceImpactForTest(rubideviGroundShot, rubideviTarget.x, rubideviTarget.y + 30);
const rubideviGroundAfter = kt.impactVisualCountsForTest();
check('ルビデビの電撃は地面や空中障害物で止まっても爆発・地形破壊しない',
  kt.craters() === rubideviGroundCraters
    && rubideviGroundAfter.explosions === rubideviGroundVisuals.explosions
    && rubideviGroundAfter.lightningRemnants === rubideviGroundVisuals.lightningRemnants + 1,
  JSON.stringify({
    craters: [rubideviGroundCraters, kt.craters()],
    visuals: [rubideviGroundVisuals, rubideviGroundAfter]
  }));

// ===== v189: フェニーチェの必殺は通常弾と同じ弾道から左右へ地走り炎 =====
check('フェニーチェの必殺説明は旧・超高速弾ではなく左右へ広がる炎を示す',
  kt.character('tori').specialDesc.includes('左右')
    && kt.character('tori').specialDesc.includes('炎')
    && !kt.character('tori').specialDesc.includes('超高速'),
  kt.character('tori').specialDesc);
const feniceNormalVelocity = kt.launchVelocityForTest('tori', 70, -45, false, false);
const feniceSpecialVelocity = kt.launchVelocityForTest('tori', 70, -45, true, false);
check('フェニーチェの必殺弾は同じ引っぱりなら通常弾と同じ初速になる',
  feniceSpecialVelocity.vx0 === feniceNormalVelocity.vx0
    && feniceSpecialVelocity.vy0 === feniceNormalVelocity.vy0,
  JSON.stringify({ normal: feniceNormalVelocity, special: feniceSpecialVelocity }));
kt.startBattle('tori');
kt.disableCpuForTest();
settle();
kt.setFlatTerrainForTest();
const feniceShooter = kt.localUnit();
const feniceTarget = kt.foeUnit();
kt.placeOnGround(feniceShooter.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(feniceTarget.id, Math.round(kt.stageW() * 0.55));
const feniceShot = kt.fireSpecialImmediateForTest('tori', 300, -180);
const feniceProfile = kt.projectileProfilesForTest()[feniceShot];
check('フェニーチェの必殺弾は通常弾と同じ風・重力を受け、フレイムウェーブの印だけを持つ',
  feniceProfile?.windMul === 1
    && feniceProfile?.gravityMul === 1
    && feniceProfile?.groundFlame === true,
  JSON.stringify(feniceProfile));
const feniceHpBefore = feniceTarget.hp;
const feniceCratersBefore = kt.craters();
const feniceVisualsBefore = kt.impactVisualCountsForTest();
const feniceFlamePoints = kt.resolveGroundFlameImpactForTest(feniceShot, feniceTarget.x, feniceTarget.y);
const feniceVisualsAfter = kt.impactVisualCountsForTest();
const feniceTickConfig = kt.groundFlameConfigForTest();
check('フェニーチェの炎は着弾点から地面に沿って左右3か所ずつへ広がる',
  Array.isArray(feniceFlamePoints)
    && feniceFlamePoints.length === 7
    && feniceFlamePoints.filter(point => point.direction < 0).length === 3
    && feniceFlamePoints.filter(point => point.direction > 0).length === 3
    && feniceFlamePoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)),
  JSON.stringify(feniceFlamePoints));
const feniceNewCraters = kt.craterHistory().slice(feniceCratersBefore);
check('フレイムウェーブの各炎は6ダメージを0.5秒間隔で3回与える設定',
  feniceTickConfig?.damage === 6
    && feniceTickConfig?.ticks === 3
    && feniceTickConfig?.interval === 0.5,
  JSON.stringify(feniceTickConfig));
check('フレイムウェーブは着火時の1回目だけ6ダメージを与える',
  feniceTarget.hp === feniceHpBefore - 6,
  JSON.stringify({ hp: [feniceHpBefore, feniceTarget.hp], flames: kt.groundFlamesForTest() }));
const feniceHpAfterFirstTick = feniceTarget.hp;
for (let i = 0; i < 29; i++) kt.step(1 / 60);
check('フレイムウェーブは0.5秒に達する前には追撃しない',
  feniceHpAfterFirstTick === feniceHpBefore - 6
    && feniceTarget.hp === feniceHpAfterFirstTick,
  JSON.stringify({ hp: feniceTarget.hp, flames: kt.groundFlamesForTest() }));
for (let i = 0; i < 2; i++) kt.step(1 / 60);
check('フレイムウェーブは約0.5秒後に2回目の6ダメージを与える',
  feniceTarget.hp === feniceHpBefore - 12,
  JSON.stringify({ hp: feniceTarget.hp, flames: kt.groundFlamesForTest() }));
for (let i = 0; i < 31; i++) kt.step(1 / 60);
const feniceHpAfterThirdTick = feniceTarget.hp;
for (let i = 0; i < 31; i++) kt.step(1 / 60);
check('フレイムウェーブは3回目で止まり、4回目のダメージを出さない',
  feniceHpAfterThirdTick === feniceHpBefore - 18
    && feniceTarget.hp === feniceHpAfterThirdTick,
  JSON.stringify({ hp: [feniceHpBefore, feniceHpAfterThirdTick, feniceTarget.hp], flames: kt.groundFlamesForTest() }));
check('フェニーチェのフレイムウェーブは持続ダメージと小削りだけを起こし、大爆発には戻らない',
  feniceNewCraters.length === 7
    && feniceNewCraters.every(crater => crater.r <= 12)
    && feniceVisualsAfter.groundFlames === feniceVisualsBefore.groundFlames + 7
    && feniceVisualsAfter.explosions === feniceVisualsBefore.explosions,
  JSON.stringify({
    hp: [feniceHpBefore, feniceTarget.hp],
    craters: feniceNewCraters,
    visuals: [feniceVisualsBefore, feniceVisualsAfter]
  }));

// ===== v190: ブルームタンの必殺は固定回復ではなく、敵へ実際に与えたダメージを吸収 =====
check('ブルームタンの必殺説明は固定30回復ではなく与えたダメージ分の回復を示す',
  kt.character('burumutan').specialDesc.includes('与えたダメージ')
    && !kt.character('burumutan').specialDesc.includes('30回復'),
  kt.character('burumutan').specialDesc);
kt.startBattle('burumutan');
kt.disableCpuForTest();
settle();
const bloomOwner = kt.localUnit();
const bloomMissTarget = kt.foeUnit();
kt.setFlatTerrainForTest();
kt.placeOnGround(bloomOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(bloomMissTarget.id, Math.round(kt.stageW() * 0.8));
const bloomMissShot = kt.fireSpecialWithHpForTest('burumutan', 40, 260, -180);
const bloomMissProfile = kt.projectileProfilesForTest()[bloomMissShot];
check('ブルームタンは必殺弾を発射しただけでは回復せず、吸収弾の印を持つ',
  bloomOwner.hp === 40 && bloomMissProfile?.drainHeal === true,
  JSON.stringify({ hp: bloomOwner.hp, profile: bloomMissProfile }));
kt.detonateProjectileForTest(bloomMissShot, kt.stageW() / 2, 80);
check('ブルームタンの必殺弾が相手へ当たらなければ回復しない',
  bloomOwner.hp === 40,
  `hp=${bloomOwner.hp}`);

kt.startBattle('burumutan');
kt.disableCpuForTest();
settle();
const bloomDrainOwner = kt.localUnit();
const bloomDrainTarget = kt.foeUnit();
kt.setFlatTerrainForTest();
kt.placeOnGround(bloomDrainOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(bloomDrainTarget.id, Math.round(kt.stageW() * 0.8));
bloomDrainTarget.hp = 20;
const bloomDrainShot = kt.fireSpecialWithHpForTest('burumutan', 40, 260, -180);
kt.detonateProjectileForTest(bloomDrainShot, bloomDrainTarget.x, bloomDrainTarget.y);
check('ブルームタンは過剰ダメージで水増しせず、敵から実際に奪ったHPだけ回復する',
  bloomDrainTarget.hp === 0
    && bloomDrainOwner.hp === 60
    && kt.damageTexts().includes('+20'),
  JSON.stringify({ ownerHp: bloomDrainOwner.hp, targetHp: bloomDrainTarget.hp, texts: kt.damageTexts() }));

kt.startBattle('burumutan');
kt.disableCpuForTest();
settle();
const bloomCapOwner = kt.localUnit();
const bloomCapTarget = kt.foeUnit();
kt.setFlatTerrainForTest();
kt.placeOnGround(bloomCapOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(bloomCapTarget.id, Math.round(kt.stageW() * 0.8));
bloomCapTarget.hp = 20;
const bloomCapShot = kt.fireSpecialWithHpForTest('burumutan', 105, 260, -180);
const bloomCapProfile = kt.projectileProfilesForTest()[bloomCapShot];
kt.detonateProjectileForTest(bloomCapShot, bloomCapTarget.x, bloomCapTarget.y);
check('ブルームタンの吸収回復は最大HPを超えない',
  bloomCapOwner.hp === bloomCapOwner.maxHp
    && bloomCapTarget.hp === 0
    && bloomCapProfile?.drainHeal === true,
  JSON.stringify({ ownerHp: bloomCapOwner.hp, maxHp: bloomCapOwner.maxHp, targetHp: bloomCapTarget.hp, profile: bloomCapProfile }));

// ===== v204: バルゲルカンはマーカー地点へ仮ヘリから10発の機銃掃射 =====
kt.startBattle('barugerukan');
kt.disableCpuForTest();
settle();
kt.setFlatTerrainForTest();
const barucopterOwner = kt.localUnit();
const barucopterTarget = kt.foeUnit();
kt.placeOnGround(barucopterOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(barucopterTarget.id, Math.round(kt.stageW() * 0.8));
kt.clearProjectilesForTest();
const barucopterMarkerIndex = kt.fireSpecialImmediateForTest('barugerukan', 260, -180);
const barucopterMarkerProfiles = kt.projectileProfilesForTest();
check('バルゲルカンの必殺は「バルコプター」のマーキング弾1発で始まる',
  kt.character('barugerukan').special === 'バルコプター'
    && kt.character('barugerukan').specialDesc.includes('10発')
    && barucopterMarkerProfiles.length === 1
    && barucopterMarkerProfiles[barucopterMarkerIndex]?.barucopterMarker === true,
  JSON.stringify({ def: kt.character('barugerukan'), projectiles: barucopterMarkerProfiles }));
const barucopterMark = { x: barucopterTarget.x, y: barucopterTarget.y };
const barucopterStarted = kt.startBarucopterForTest(barucopterMarkerIndex, barucopterMark.x, barucopterMark.y);
check('マーキング後は上端固定ではなく自キャラ座標の真上450pxへバルコプターが現れる',
  barucopterStarted?.owner === barucopterOwner.id
    && Math.abs(barucopterStarted?.x - barucopterOwner.x) < 0.001
    && barucopterStarted?.y === barucopterOwner.y - 450
    && barucopterStarted?.targetX === barucopterMark.x
    && barucopterStarted?.targetY === barucopterMark.y,
  JSON.stringify({ owner: { x: barucopterOwner.x, y: barucopterOwner.y }, barrage: barucopterStarted }));
kt.stepBarucoptersForTest(2);
const barucopterBullets = kt.projectileProfilesForTest();
const barucopterAngles = barucopterBullets.map(p => Math.atan2(p.vy, p.vx));
const uniqueBarucopterAngles = new Set(barucopterAngles.map(angle => angle.toFixed(4)));
const barucopterAimAngle = barucopterStarted
  ? Math.atan2(barucopterStarted.targetY - barucopterStarted.y, barucopterStarted.targetX - barucopterStarted.x)
  : 0;
const averageBarucopterAngle = barucopterAngles.length
  ? Math.atan2(
      barucopterAngles.reduce((sum, angle) => sum + Math.sin(angle), 0),
      barucopterAngles.reduce((sum, angle) => sum + Math.cos(angle), 0)
    )
  : Infinity;
const barucopterAngleDelta = Math.atan2(
  Math.sin(averageBarucopterAngle - barucopterAimAngle),
  Math.cos(averageBarucopterAngle - barucopterAimAngle)
);
check('バルコプターはマーカーへ無風・無重力の機銃を10発だけ連射する',
  barucopterBullets.length === 10
    && barucopterBullets.every(p => p.barucopterBullet && p.windMul === 0 && p.gravityMul === 0),
  JSON.stringify(barucopterBullets));
check('10発の機銃はマーカー方向を中心にほんの僅かだけ固定でブレる',
  uniqueBarucopterAngles.size >= 5
    && Math.abs(barucopterAngleDelta) < 0.03,
  JSON.stringify({ aim: barucopterAimAngle, average: averageBarucopterAngle, delta: barucopterAngleDelta, angles: barucopterAngles }));
let barucopterDamageResult = null;
if (barucopterBullets.length > 0) {
  const hpBefore = barucopterTarget.hp;
  const cratersBefore = kt.craters();
  kt.resolveProjectileUnitImpactForTest(0, barucopterTarget.id);
  barucopterDamageResult = {
    damage: hpBefore - barucopterTarget.hp,
    craterDelta: kt.craters() - cratersBefore
  };
}
const barucopterSurfaceCratersBefore = kt.craters();
const barucopterSurfaceHit = kt.resolveBarucopterBulletSurfaceImpactForTest(1, barucopterTarget.x, barucopterTarget.y);
const barucopterSurfaceCraterDelta = kt.craters() - barucopterSurfaceCratersBefore;
check('バルコプターの機銃1発は3ダメージで、着弾地点を小さく削る',
  barucopterDamageResult?.damage === 3
    && barucopterDamageResult?.craterDelta === 0
    && barucopterSurfaceHit === true
    && barucopterSurfaceCraterDelta === 1,
  JSON.stringify({ unit: barucopterDamageResult, surfaceCraterDelta: barucopterSurfaceCraterDelta }));
kt.clearProjectilesForTest();

// ===== v2.0.63: クールカイはランダム角度へ47発を順番に連射 =====
const coolKaiNormalVelocity = kt.launchVelocityForTest('coolKai', 180, -96, false, false);
const coolKaiSpecialIndex = kt.fireSpecialImmediateForTest('coolKai', coolKaiNormalVelocity.vx0, coolKaiNormalVelocity.vy0);
const coolKaiProjectiles = kt.projectileProfilesForTest();
const coolKaiMoveLock = kt.turnEffectForTest(kt.seat());
const coolKaiRotations = coolKaiProjectiles.map(p => p.coolKaiRotation);
const coolKaiAngles = coolKaiProjectiles.map(p => Math.atan2(p.vy, p.vx));
const coolKaiUniqueAngles = new Set(coolKaiAngles.map(angle => angle.toFixed(4)));
check('クールカイの必殺は小さいおにぎりを47発生成する',
  kt.character('coolKai').name === 'クール=カイ'
    && kt.character('coolKai').special === 'Amour 握り飯'
    && kt.character('coolKai').specialDesc === '手燭の油で作った47個の握り飯を配ってやる。'
    && kt.character('coolKai').maxHp === 66
    && coolKaiProjectiles.length === 47
    && coolKaiSpecialIndex === 46
    && coolKaiProjectiles.every(p => p.coolKaiOnigiri && !p.directHitOnly && p.radius === 3),
  JSON.stringify({ def: kt.character('coolKai'), count: coolKaiProjectiles.length, projectiles: coolKaiProjectiles.slice(0, 2) }));
check('クールカイは必殺技後に6ターン移動不能になる',
  coolKaiMoveLock?.moveLockTurns === 6,
  JSON.stringify(coolKaiMoveLock));
check('クールカイのおにぎり47発は大きめの固定バラツキで飛ぶ',
  coolKaiUniqueAngles.size >= 40
    && Math.max(...coolKaiAngles) - Math.min(...coolKaiAngles) > 0.30
    && Math.max(...coolKaiAngles) - Math.min(...coolKaiAngles) < 0.5
    && coolKaiAngles.length === 47,
  JSON.stringify({ unique: coolKaiUniqueAngles.size, angles: coolKaiAngles }));
const coolKaiDelays = coolKaiProjectiles.map(p => p.coolKaiDelay);
check('クールカイのおにぎり47発は一定間隔の連射になっている',
  coolKaiDelays.length === 47
    && coolKaiDelays[0] === 0
    && coolKaiDelays.every((delay, i) => Math.abs(delay - i * 0.075) < 1e-9),
  JSON.stringify({ delays: coolKaiDelays }));
check('クールカイのおにぎりは見た目だけ3倍で判定値を変えない',
  indexHtml.includes('ctx.moveTo(15, 0); ctx.lineTo(-12, -12); ctx.lineTo(-12, 12);')
    && indexHtml.includes('const COOL_KAI_ONIGIRI_DAMAGE = 6;')
    && indexHtml.includes("cpuGearRequestedDamage(p.owner, target, 'direct_projectile', COOL_KAI_ONIGIRI_DAMAGE * takenMul)")
    && coolKaiProjectiles.every(p => p.radius === 3),
  JSON.stringify({ radius: coolKaiProjectiles[0]?.radius }));
check('クール=カイの握り飯47発は見た目の回転だけ個別にランダム化する',
  coolKaiRotations.length === 47
    && new Set(coolKaiRotations.map(rotation => rotation.toFixed(6))).size >= 40
    && coolKaiRotations.every(rotation => rotation >= 0 && rotation < Math.PI * 2),
  JSON.stringify({ unique: new Set(coolKaiRotations.map(rotation => rotation.toFixed(6))).size, rotations: coolKaiRotations }));
check('演習のクールカイ表示も透明余白を切り出す',
  indexHtml.includes('function characterPreviewImageRect(key, img)')
    && indexHtml.includes('previewImageCrop: { sx: 0.14, sy: 0.315, sw: 0.72, sh: 0.37 }')
    && /characterPreviewImageRect\(imageKey, img\)[\s\S]*ctx\.drawImage\(img, imageRect\.sx/.test(freeRowSource),
  'drawFreeRowにキャラ画像の切り出しがありません');
kt.clearProjectilesForTest();

// ===== v198: ドレッドアローは照準通りに刺さり、地表を這うスコーピオンレール =====
const dreadNormalVelocity = kt.launchVelocityForTest('doRednote', 180, -96, false, false);
const dreadSpecialShot = kt.fireSpecialImmediateForTest('doRednote', dreadNormalVelocity.vx0, dreadNormalVelocity.vy0);
const dreadRailProfile = kt.projectileProfilesForTest()[dreadSpecialShot];
check('ドレッドアローの必殺は高速貫通ではなく、照準どおりのスコーピオンレールである',
  kt.character('doRednote').special === 'スコーピオンレール'
    && kt.character('doRednote').specialDesc.includes('地表')
    && !kt.character('doRednote').specialDesc.includes('高速')
    && !kt.character('doRednote').specialDesc.includes('貫通')
    && dreadRailProfile?.scorpionRail === true
    && dreadRailProfile?.pierce === false
    && dreadRailProfile?.vx === dreadNormalVelocity.vx0
    && dreadRailProfile?.vy === dreadNormalVelocity.vy0,
  JSON.stringify({ def: kt.character('doRednote'), profile: dreadRailProfile, normal: dreadNormalVelocity }));
const dreadRailStart = kt.startScorpionRailForTest(dreadSpecialShot, 360, 420);
const dreadRailConfig = kt.scorpionRailConfigForTest();
check('スコーピオンレールは地面へ刺さった後に地表を這う状態へ切り替わる',
  dreadRailStart?.active === true
    && dreadRailStart?.pierce === true
    && dreadRailStart?.vy === 0
    && Math.abs(dreadRailStart?.vx || 0) === dreadRailConfig?.speed
    && dreadRailConfig?.range >= 180
    && dreadRailConfig?.carveRadius > 0
    && dreadRailConfig?.damage >= 20,
  JSON.stringify({ start: dreadRailStart, config: dreadRailConfig }));
const dreadStepTerrain = kt.setScorpionRailStepTerrainForTest(620, 420, 320);
const dreadTargetedShot = kt.fireSpecialImmediateForTest('doRednote', dreadNormalVelocity.vx0, dreadNormalVelocity.vy0);
kt.setUnitPositionForTest(kt.foeUnit().id, 580, 410);
kt.setUnitHpForTest(kt.foeUnit().id, kt.foeUnit().maxHp);
const dreadTargetedStart = kt.startScorpionRailForTest(dreadTargetedShot, 620, 350);
check('スコーピオンレールは壁面でも最も近い相手がいる向きへ走り出す',
  dreadTargetedStart?.active === true && dreadTargetedStart?.vx === 0 && dreadTargetedStart?.vy > 0,
  JSON.stringify({ target: kt.foeUnit(), start: dreadTargetedStart }));
const dreadClimbShot = kt.fireSpecialImmediateForTest('doRednote', dreadNormalVelocity.vx0, dreadNormalVelocity.vy0);
kt.startScorpionRailForTest(dreadClimbShot, 560, dreadStepTerrain.floorY, 1);
const dreadClimb = kt.advanceScorpionRailForTest(dreadClimbShot, 230);
const dreadClimbedVertically = dreadClimb?.points.some(point => point.x >= 610 && point.y < 390);
check('スコーピオンレールは地形から離れず、壁を登って上面へ回り込む',
  dreadClimb?.moved >= 225
    && dreadClimbedVertically
    && dreadClimb?.x > dreadStepTerrain.wallX
    && dreadClimb?.y < dreadStepTerrain.topY
    && dreadClimb?.attached === true,
  JSON.stringify({ terrain: dreadStepTerrain, climb: dreadClimb }));
check('スコーピオンレールは太い残光と長い軌跡でショックウェーブを描く',
  dreadRailConfig?.waveWidth >= 14 && dreadRailConfig?.trailLength >= 80,
  JSON.stringify(dreadRailConfig));
// v205: 地表を走るショックウェーブが敵へ触れた時だけ、足元から毒針を突き上げる。
kt.startBattle('doRednote');
kt.disableCpuForTest();
settle();
kt.setFlatTerrainForTest();
const dreadSpikeOwner = kt.localUnit();
const dreadSpikeTarget = kt.foeUnit();
kt.placeOnGround(dreadSpikeOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(dreadSpikeTarget.id, Math.round(kt.stageW() * 0.55));
kt.setUnitHpForTest(dreadSpikeTarget.id, dreadSpikeTarget.maxHp);
const dreadSpikeShot = kt.fireSpecialImmediateForTest('doRednote', 240, -120);
kt.startScorpionRailForTest(dreadSpikeShot, Math.round(kt.stageW() * 0.42), 420);
const dreadSpikeHpBefore = dreadSpikeTarget.hp;
const dreadSpikeCratersBefore = kt.craters();
const dreadSpikeVisualsBefore = kt.impactVisualCountsForTest();
kt.resolveProjectileUnitImpactForTest(dreadSpikeShot, dreadSpikeTarget.id);
const dreadSpikeVisualsAfter = kt.impactVisualCountsForTest();
const dreadSpikeConfig = kt.scorpionRailSpikeConfigForTest();
check('スコーピオンレールのショックウェーブ命中時は下から3本の毒針演出だけを出す',
  dreadSpikeConfig?.count === 3
    && dreadSpikeConfig?.life >= 0.4
    && dreadSpikeConfig?.height >= 40
    && dreadSpikeTarget.hp === dreadSpikeHpBefore - dreadRailConfig.damage
    && kt.craters() === dreadSpikeCratersBefore
    && dreadSpikeVisualsAfter.scorpionRailSpikes === dreadSpikeVisualsBefore.scorpionRailSpikes + dreadSpikeConfig.count,
  JSON.stringify({ config: dreadSpikeConfig, hp: [dreadSpikeHpBefore, dreadSpikeTarget.hp], craters: [dreadSpikeCratersBefore, kt.craters()], visuals: [dreadSpikeVisualsBefore, dreadSpikeVisualsAfter] }));
// v206: 実画面の描画まで通し、命中直後に例外でゲーム全体を止めない。
let dreadSpikeDrawn = false;
let dreadSpikeDrawError = '';
try {
  dreadSpikeDrawn = kt.drawScorpionRailImpactSpikesForTest();
} catch (error) {
  dreadSpikeDrawError = error?.message || String(error);
}
check('スコーピオンレールの毒針演出は描画時にも例外を出さない',
  dreadSpikeDrawn && !dreadSpikeDrawError,
  dreadSpikeDrawError || '描画できませんでした');
const dreadVsSpecial = kt.vsSpecialTextForTest('doRednote');
check('長い必殺技名も開始カットインで省略せず全文を表示する',
  dreadVsSpecial?.text === 'スコーピオンレール' && dreadVsSpecial?.fontSize >= 7,
  JSON.stringify(dreadVsSpecial));

// ===== v194: Dスマッシュは地面への着弾後に中→小→小の連続爆発で掘り進む =====
check('Dスマッシュの説明は地面へ着弾後に中小小の爆発で掘り進む性能を示す',
  kt.character('jinba').specialDesc.includes('着弾')
    && kt.character('jinba').specialDesc.includes('中・小・小')
    && kt.character('jinba').specialDesc.includes('掘り進む'),
  kt.character('jinba').specialDesc);
kt.startBattle('jinba');
kt.disableCpuForTest();
settle();
kt.setFlatTerrainForTest(420);
const dSmashOwner = kt.localUnit();
const dSmashTarget = kt.foeUnit();
kt.placeOnGround(dSmashOwner.id, Math.round(kt.stageW() * 0.2));
kt.placeOnGround(dSmashTarget.id, Math.round(kt.stageW() * 0.8));
const dSmashShot = kt.fireSpecialImmediateForTest('jinba', 60, 220);
const dSmashInitialProfile = kt.projectileProfilesForTest()[dSmashShot];
check('Dスマッシュは地面へ当たる前から地形を無視せず、専用の着弾判定を持つ',
  dSmashInitialProfile?.dSmash === true && dSmashInitialProfile?.pierce === false,
  JSON.stringify(dSmashInitialProfile));
const dSmashConfig = kt.dSmashConfigForTest();
const dSmashCratersBefore = kt.craters();
for (let i = 0; i < 600 && kt.projectiles().length; i++) kt.step(1 / 60);
const dSmashCraters = kt.craterHistory().slice(dSmashCratersBefore);
check('Dスマッシュは地面への着弾後に爆発を3回だけ起こす',
  dSmashCraters.length === 3 && kt.projectiles().length === 0,
  JSON.stringify({ config: dSmashConfig, craters: dSmashCraters, projectiles: kt.projectiles().length }));
const dSmashPairsOverlap = dSmashCraters.slice(1).every((crater, index) => {
  const previous = dSmashCraters[index];
  return Math.hypot(crater.x - previous.x, crater.y - previous.y) <= crater.r + previous.r;
});
const dSmashDrillCenterDistance = dSmashCraters.length === 3
  ? Math.hypot(dSmashCraters[2].x - dSmashCraters[0].x, dSmashCraters[2].y - dSmashCraters[0].y)
  : 0;
check('Dスマッシュの爆発は中→小→小で隙間なく、従来の掘削距離を保つ',
  dSmashCraters.length === 3
    && dSmashCraters[0].r > dSmashCraters[1].r
    && dSmashCraters[1].r === dSmashCraters[2].r
    && dSmashPairsOverlap
    && dSmashDrillCenterDistance >= dSmashConfig.stride * 2 - 0.1,
  JSON.stringify({ config: dSmashConfig, centerDistance: dSmashDrillCenterDistance, craters: dSmashCraters }));
check('Dスマッシュは着弾時の進行方向へ爆発しながら地中を掘り進む',
  dSmashCraters.length === 3
    && dSmashCraters[1].x > dSmashCraters[0].x
    && dSmashCraters[2].x > dSmashCraters[1].x
    && dSmashCraters[1].y > dSmashCraters[0].y
    && dSmashCraters[2].y > dSmashCraters[1].y,
  JSON.stringify(dSmashCraters));

// ===== タイトルの「おまけ」ボタン =====
// 曲が終わるたび 1曲目 → 2曲目 → 3曲目 → 4曲目 → 1曲目… と自動で送り、
// 手動タップの次曲／停止も残す。BGMの切り替えは syncBgm へ一本化しているので、
// ここでも「いま鳴るべき曲(desired)」が正しく変わることで確認する。
const btns = kt.titleBtnRects();
function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}
const updateHistoryInfo = kt.titleUpdateHistoryInfo();
check('タイトル最下部の更新履歴はBUILD_IDと同じv番号を表示する',
  !!updateHistoryInfo.history
    && updateHistoryInfo.build.startsWith(updateHistoryInfo.history.version + '-'),
  JSON.stringify(updateHistoryInfo));
check('タイトル最下部の更新履歴は日付と変更内容を持つ',
  !!updateHistoryInfo.history
    && /^\d{4}\/\d{2}\/\d{2}$/.test(updateHistoryInfo.history.date)
    && updateHistoryInfo.history.summary.length > 0,
  JSON.stringify(updateHistoryInfo.history));
const titleHistoryPanelDraw = indexHtml.slice(
  indexHtml.indexOf('titleUpdateHistoryPanel.x - 8'),
  indexHtml.indexOf('function updateHistoryContentViewport')
);
check('タイトル最下部の更新履歴パネルは内容を表示しない',
  !/LATEST_UPDATE_HISTORY\.summary/.test(titleHistoryPanelDraw),
  titleHistoryPanelDraw);
check('title update history text is vertically centered in its panel',
  /titleUpdateHistoryPanel\.y \+ 4/.test(titleHistoryPanelDraw)
    && !/titleUpdateHistoryPanel\.y - 2/.test(titleHistoryPanelDraw),
  titleHistoryPanelDraw);
check('更新履歴は最新版ボタンの横に収まり、操作領域と重ならない',
  !!updateHistoryInfo.panel
    && !rectsOverlap(updateHistoryInfo.update, updateHistoryInfo.panel)
    && updateHistoryInfo.panel.x > updateHistoryInfo.update.x
    && updateHistoryInfo.panel.y === updateHistoryInfo.update.y
    && updateHistoryInfo.update.x - updateHistoryInfo.update.w / 2 >= 0
    && updateHistoryInfo.panel.x + updateHistoryInfo.panel.w / 2 <= kt.viewW(),
  JSON.stringify(updateHistoryInfo));
check('更新履歴一覧の枠は縦に広い',
  !!updateHistoryInfo.modal && updateHistoryInfo.modal.h >= 640,
  JSON.stringify(updateHistoryInfo.modal));
check('update history modal leaves room for its heading above the viewport',
  !!updateHistoryInfo.modal
    && updateHistoryInfo.modal.h >= 740
    && updateHistoryInfo.modal.contentViewport.top >= updateHistoryInfo.modal.y - 195,
  JSON.stringify(updateHistoryInfo.modal));
const updateHistoryModalDraw = indexHtml.slice(
  indexHtml.indexOf('function drawUpdateHistoryModal'),
  indexHtml.indexOf('function drawFreeArrow')
);
check('update history heading and subtitle sit higher above the cards',
  /VW \/ 2, VH \/ 2 - 260/.test(updateHistoryModalDraw)
    && /VW \/ 2, VH \/ 2 - 230/.test(updateHistoryModalDraw),
  updateHistoryModalDraw);
check('the first update-history card is not styled as a tappable highlight',
  !/index === 0 \? UI\.gold/.test(updateHistoryModalDraw),
  updateHistoryModalDraw);
check('title update history label uses the larger fitting font',
  /font: `900 10px \$\{UI_FONT_HEAVY\}`/.test(titleHistoryPanelDraw),
  titleHistoryPanelDraw);
check('更新履歴は最新から過去版まで日付と内容を一覧データに持つ',
  updateHistoryInfo.entries.length >= 4
    && updateHistoryInfo.entries[0]?.version === updateHistoryInfo.history?.version
    && updateHistoryInfo.entries.every(entry => /^v\d+(?:\.\d+){0,2}$/.test(entry.version)
      && /^\d{4}\/\d{2}\/\d{2}$/.test(entry.date) && entry.summary.length > 0)
    && updateHistoryInfo.entries.some(entry => entry.version === 'v200')
    && updateHistoryInfo.entries.some(entry => entry.version === 'v199'),
  JSON.stringify(updateHistoryInfo.entries));
kt.setPhase('title');
down(updateHistoryInfo.panel.x, updateHistoryInfo.panel.y);
const openedUpdateHistory = kt.titleUpdateHistoryInfo();
check('タイトルの更新履歴をタップすると過去版一覧が開く',
  openedUpdateHistory.open === true
    && !!openedUpdateHistory.modal
    && !!openedUpdateHistory.close,
  JSON.stringify(openedUpdateHistory));
check('更新履歴の内容はモーダル内にクリップされ、閉じるボタンの外へ出ない',
  !!openedUpdateHistory.modal
    && openedUpdateHistory.modal.contentViewport
    && openedUpdateHistory.modal.contentViewport.bottom < openedUpdateHistory.close.y
    && openedUpdateHistory.modal.contentViewport.top > openedUpdateHistory.modal.y - openedUpdateHistory.modal.h / 2
    && openedUpdateHistory.modal.contentViewport.bottom <= openedUpdateHistory.modal.y + openedUpdateHistory.modal.h / 2
    && openedUpdateHistory.modal.maxScroll > 0,
  JSON.stringify(openedUpdateHistory.modal));
kt.scrollUpdateHistoryForTest(240);
const scrolledUpdateHistory = kt.titleUpdateHistoryInfo();
check('更新履歴は一覧位置を保持してスクロールできる',
  scrolledUpdateHistory.open === true
    && scrolledUpdateHistory.modal.scroll > 0
    && scrolledUpdateHistory.modal.scroll <= scrolledUpdateHistory.modal.maxScroll,
  JSON.stringify(scrolledUpdateHistory.modal));
const touchStartScroll = scrolledUpdateHistory.modal.scroll;
const touchId = touchDown(scrolledUpdateHistory.modal.x, scrolledUpdateHistory.modal.contentViewport.top + 100);
touchMoveWindow(touchId, scrolledUpdateHistory.modal.x, scrolledUpdateHistory.modal.contentViewport.top - 120);
const touchScrolledUpdateHistory = kt.titleUpdateHistoryInfo();
check('指をモーダル外へ動かしても更新履歴のタッチスクロールを継続する',
  touchScrolledUpdateHistory.modal.scroll > touchStartScroll,
  JSON.stringify(touchScrolledUpdateHistory.modal));
touchUp(touchId, scrolledUpdateHistory.modal.x, scrolledUpdateHistory.modal.contentViewport.top - 120);
const fourthEntryY = scrolledUpdateHistory.modal.contentViewport.top + 26 + 3 * 64;
const fourthStartScroll = scrolledUpdateHistory.modal.scroll;
const fourthTouchId = touchDown(scrolledUpdateHistory.modal.x, fourthEntryY);
touchMoveWindow(fourthTouchId, scrolledUpdateHistory.modal.x, fourthEntryY - 120);
const fourthTouchScrolled = kt.titleUpdateHistoryInfo();
check('更新履歴4件目から指を始めてもスクロールできる',
  fourthTouchScrolled.modal.scroll > fourthStartScroll,
  JSON.stringify({ fourthEntryY, modal: fourthTouchScrolled.modal }));
touchUp(fourthTouchId, scrolledUpdateHistory.modal.x, fourthEntryY - 120);
const lowerEdgeStartScroll = kt.titleUpdateHistoryInfo().modal.scroll;
const lowerEdgeY = scrolledUpdateHistory.modal.contentViewport.bottom + 4;
const lowerEdgeTouchId = touchDown(scrolledUpdateHistory.modal.x, lowerEdgeY);
touchMoveWindow(lowerEdgeTouchId, scrolledUpdateHistory.modal.x, lowerEdgeY - 120);
const lowerEdgeScrolled = kt.titleUpdateHistoryInfo();
check('更新履歴の下段カード付近から指を始めてもスクロールを掴める',
  lowerEdgeScrolled.modal.scroll > lowerEdgeStartScroll,
  JSON.stringify({ lowerEdgeY, modal: lowerEdgeScrolled.modal }));
touchUp(lowerEdgeTouchId, scrolledUpdateHistory.modal.x, lowerEdgeY - 120);
const rightStartScroll = kt.titleUpdateHistoryInfo().modal.scroll;
const rightStartX = scrolledUpdateHistory.modal.contentViewport.x + scrolledUpdateHistory.modal.contentViewport.w - 20;
const rightStartY = scrolledUpdateHistory.modal.contentViewport.top + 100;
const rightTouchId = touchDown(rightStartX, rightStartY);
touchMoveWindow(rightTouchId, rightStartX, rightStartY - 120);
const rightScrolled = kt.titleUpdateHistoryInfo();
check('更新履歴の右半分から指を始めてもスクロールを掴める',
  rightScrolled.modal.scroll > rightStartScroll,
  JSON.stringify({ rightStartX, rightStartY, modal: rightScrolled.modal }));
touchUp(rightTouchId, rightStartX, rightStartY - 120);
if (openedUpdateHistory.close) down(openedUpdateHistory.close.x, openedUpdateHistory.close.y);
check('更新履歴は閉じるボタンでタイトルへ戻る',
  openedUpdateHistory.open === true
    && kt.titleUpdateHistoryInfo().open === false
    && kt.phase() === 'title',
  JSON.stringify(kt.titleUpdateHistoryInfo()));
const titleMenuInfo = kt.titleMenuInfo();
check('タイトルはBATTLEとGARAGEの意味別2ページへ分かれる',
  titleMenuInfo.pages.length === 2
    && JSON.stringify(titleMenuInfo.pages[0]) === JSON.stringify({
      key: 'battle', items: ['cpu', 'online', 'tutorial', 'free', 'ranking']
    })
    && JSON.stringify(titleMenuInfo.pages[1]) === JSON.stringify({
      key: 'garage', items: ['shop', 'achievements', 'soundTest']
    }),
  JSON.stringify(titleMenuInfo.pages));
check('タイトルスライドは250〜400msで、短いスワイプを戻す閾値を持つ',
  titleMenuInfo.slideMs >= 250 && titleMenuInfo.slideMs <= 400
    && titleMenuInfo.swipeThreshold >= 50 && titleMenuInfo.swipeThreshold <= 80,
  JSON.stringify(titleMenuInfo));
const battleTitleBtns = [btns.cpu, btns.online, btns.tutorial, btns.free, btns.ranking];
const garageTitleBtns = [btns.shop, btns.achievements, btns.soundTest];
check('各ページ内のボタンと左右矢印は重ならない',
  [battleTitleBtns, garageTitleBtns].every(pageButtons => pageButtons.every((button, index) => (
    pageButtons.slice(index + 1).every(other => !rectsOverlap(button, other))
      && !rectsOverlap(button, btns.left) && !rectsOverlap(button, btns.right)
  ))), JSON.stringify(btns));
check('BATTLE/GARAGEタブは見た目を太らせずAndroidで押しやすい当たり判定を持つ',
  btns.battleTab.h === 32 && btns.garageTab.h === 32
    && btns.battleTabHit.h >= 56 && btns.garageTabHit.h >= 56,
  JSON.stringify({ battle: btns.battleTab, battleHit: btns.battleTabHit, garage: btns.garageTab, garageHit: btns.garageTabHit }));

kt.setPhase('title');
kt.setTitleMenuPageForTest(0);
const noFireSwipe = down(btns.cpu.x, btns.cpu.y);
move(noFireSwipe, btns.cpu.x - 100, btns.cpu.y);
up(noFireSwipe, btns.cpu.x - 100, btns.cpu.y);
check('ボタン上からの長い左スワイプはボタンを誤発火せずGARAGEへ移る',
  kt.phase() === 'title' && kt.titleMenuInfo().page === 1,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const shortSwipe = down(btns.cpu.x, btns.cpu.y);
move(shortSwipe, btns.cpu.x - 30, btns.cpu.y);
up(shortSwipe, btns.cpu.x - 30, btns.cpu.y);
check('短い横スワイプは元のBATTLEへ戻りCPUを発火しない',
  kt.phase() === 'title' && kt.titleMenuInfo().page === 0,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const verticalMove = down(btns.cpu.x, btns.cpu.y);
move(verticalMove, btns.cpu.x, btns.cpu.y + 24);
up(verticalMove, btns.cpu.x, btns.cpu.y + 24);
check('ボタン上の縦移動もタップ扱いにせずCPUを発火しない', kt.phase() === 'title', kt.phase());
kt.setTitleMenuPageForTest(0);
const returnedMove = down(btns.cpu.x, btns.cpu.y);
move(returnedMove, btns.cpu.x, btns.cpu.y + 24);
move(returnedMove, btns.cpu.x, btns.cpu.y);
up(returnedMove, btns.cpu.x, btns.cpu.y);
check('指がslopを越えて元位置へ戻ってもCPUタップへ復帰しない',
  kt.phase() === 'title' && kt.titleMenuInfo().gesture === null,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const backInterruptedTap = down(btns.cpu.x, btns.cpu.y);
kt.cancelTitleMenuGestureForTest(false);
up(backInterruptedTap, btns.cpu.x, btns.cpu.y);
check('端末戻るで使うキャンセル処理はCPU押下途中の背面タップを破棄する',
  kt.phase() === 'title' && kt.titleMenuInfo().gesture === null,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const arrowTap = down(btns.right.x, btns.right.y);
check('右矢印はpointerdownだけではページを決定しない', kt.titleMenuInfo().page === 0, JSON.stringify(kt.titleMenuInfo()));
up(arrowTap, btns.right.x, btns.right.y);
check('右矢印をpointerupまで押すとGARAGEへ移る', kt.titleMenuInfo().page === 1, JSON.stringify(kt.titleMenuInfo()));
kt.setTitleMenuPageForTest(0);
const windowSwipe = touchDown(btns.cpu.x, btns.cpu.y);
touchMoveWindow(windowSwipe, btns.cpu.x - 100, btns.cpu.y);
touchUp(windowSwipe, btns.cpu.x - 100, btns.cpu.y);
check('AndroidタッチがCanvas外へ出ても左右スワイプを完了できる',
  kt.phase() === 'title' && kt.titleMenuInfo().page === 1,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const primarySwipe = touchDown(btns.cpu.x, btns.cpu.y);
const secondTouch = pid++;
canvas.__fire('pointerdown', {
  pointerId: secondTouch, clientX: btns.cpu.x + 16, clientY: btns.cpu.y,
  pointerType: 'touch', isPrimary: false, timeStamp: Date.now(), button: 0
});
touchMoveWindow(primarySwipe, btns.cpu.x - 100, btns.cpu.y);
touchUp(primarySwipe, btns.cpu.x - 100, btns.cpu.y);
check('2本目の指は進行中のタイトルスワイプを上書きせず入力を固着させない',
  kt.phase() === 'title' && kt.titleMenuInfo().page === 1 && kt.titleMenuInfo().gesture === null,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));
kt.setTitleMenuPageForTest(0);
const cancelledSwipe = down(btns.cpu.x, btns.cpu.y);
move(cancelledSwipe, btns.cpu.x - 100, btns.cpu.y);
win.__fire('pointercancel', {
  pointerId: cancelledSwipe, clientX: btns.cpu.x - 100, clientY: btns.cpu.y,
  pointerType: 'mouse', timeStamp: Date.now()
});
check('pointercancelはボタンを発火せず元のBATTLEへ戻す',
  kt.phase() === 'title' && kt.titleMenuInfo().page === 0 && kt.titleMenuInfo().gesture === null,
  JSON.stringify({ phase: kt.phase(), menu: kt.titleMenuInfo() }));

kt.setTitleMenuPageForTest(1);
const soundTestBtn = kt.soundTestBtn();
function tapSoundTest() { const id = down(soundTestBtn.x, soundTestBtn.y); up(id, soundTestBtn.x, soundTestBtn.y); }

const bonusTrackCount = kt.bonusTrackCount();
check('おまけ曲が6曲登録されている', bonusTrackCount === 6, String(bonusTrackCount));
check('最初はおまけ曲を選んでいない', kt.bgm().bonusTrack === 0, String(kt.bgm().bonusTrack));
tapSoundTest();
check('GARAGEのサウンドテストを押すと全BGM一覧を開く',
  kt.bgm().bonusTrack === 0 && kt.bgm().desired === 'none'
    && indexHtml.includes('const SOUND_TEST_TRACKS = Object.freeze([')
    && indexHtml.includes('const startupBgmPreloadCount = 0')
    && !indexHtml.includes('const startupBgmPreloads ='),
  `track=${kt.bgm().bonusTrack} desired=${kt.bgm().desired}`);
check('サウンドテスト画面からショップと実績の小ボタンを撤去する',
  !indexHtml.includes('soundTestShopBtn') && !indexHtml.includes('soundTestAchievementsBtn'),
  'legacy sound-test collection buttons remain');
check('サウンドテストはタイトル・ロビー・全ステージ・おまけ6曲を登録する',
  indexHtml.includes("key: 'title'")
    && indexHtml.includes("key: 'room'")
    && indexHtml.includes("STAGE_BGM_SOURCES.coolKai")
    && indexHtml.includes('...BONUS_BGM_TRACKS.slice(1)'),
  'sound test track list missing');
// 曲ごとに録音レベルが違うので、体感音量を揃えるための基準音量を個別に持つ。
const trackVolumes = kt.bonusTrackVolumes();
check('全曲に基準音量が設定されている',
  trackVolumes.length === bonusTrackCount && trackVolumes.every(v => v > 0 && v <= 1),
  JSON.stringify(trackVolumes));
check('おまけ曲はタイトル曲より大きい音量に設定されている',
  trackVolumes.every(v => v > kt.titleBgmBaseVolume()),
  `おまけ=${JSON.stringify(trackVolumes)} タイトル=${kt.titleBgmBaseVolume()}`);

// サウンドテストを閉じてから対戦へ移る。
tapSoundTest();
kt.setPhase('battle');
kt.syncBgm();
check('対戦へ移るとおまけ曲の選択が解除される', kt.bgm().bonusTrack === 0, String(kt.bgm().bonusTrack));
check('対戦中はステージ曲が鳴るべき曲になる', kt.bgm().desired === 'stage', kt.bgm().desired);
kt.setPhase('title');
kt.startBattle('coolKai');
check('クールカイを選んだ対戦は専用BGMを固定で流す',
  kt.bgm().desired === 'stage'
    && kt.bgm().stageTheme === 'coolKai'
    && kt.bgm().stageSrc.includes('six-eternel-dopagaki-remix.mp3'),
  JSON.stringify(kt.bgm()));
check('クール=カイの連戦は専用BGMを先頭へ戻さず継続する',
  indexHtml.includes('const continueCoolKaiBgm = desired === \'stage\'')
    && indexHtml.includes("stageBgmTheme === 'coolKai'")
    && indexHtml.includes('!continueCoolKaiBgm'),
  'continuous dedicated BGM guard missing');
kt.setPhase('title');
kt.syncBgm();
check('おまけ6とBATTLEロゴはドパガキリミックス名を表示する',
  indexHtml.includes("src: 'assets/six-eternel-dopagaki-remix.mp3'")
    && indexHtml.includes("label: 'SIX ÉTERNEL ―愛はひとつじゃない―（ドパガキリミックス）'")
    && indexHtml.includes('drawBgmNowPlayingLabel(748, UI.gold)'),
  'BGM display label missing');
check('タイトルへ戻ってもおまけ曲は鳴り出さない',
  kt.bgm().bonusTrack === 0 && kt.bgm().desired === 'title',
  `track=${kt.bgm().bonusTrack} desired=${kt.bgm().desired}`);

// ===== v184: にゃんタンクは移動封印ではなく次の手番をスキップさせる =====
check('にゃんタンクの必殺説明は次の手番を行動不能にする',
  kt.character('neko').specialDesc.includes('次の手番をスキップ')
    && indexHtml.includes('actionSkip: true'));
kt.startBattle('neko');
kt.disableCpuForTest();
const nyanTarget = kt.unitById('e1');
kt.emitNyanDisableForTest(nyanTarget.x, nyanTarget.y, 20, 'p1');
const nyanEffect = kt.turnEffectForTest('e1');
const nyanSaved = kt.buildSnapshotForTest().units.find(u => u.id === 'e1');
check('猫だまし命中は移動封印を付けず行動不能を1手付ける',
  nyanEffect.moveLockTurns === 0 && nyanEffect.actionSkipTurns === 1
    && nyanSaved.actionSkipTurns === 1,
  JSON.stringify({ effect: nyanEffect, saved: nyanSaved }));
const nyanVisual = typeof kt.actionSkipVisualForTest === 'function' ? kt.actionSkipVisualForTest('e1') : null;
check('行動不能は移動封印と異なる頭上の星と電撃で表示する',
  nyanVisual?.effect === 'stunned' && nyanVisual?.placement === 'head'
    && nyanVisual?.icon === 'stars' && nyanVisual?.electric === true
    && indexHtml.includes('drawActionSkipEffects(u, { x: a.x + shakeX, y: a.y }, imgTopAbs);'),
  JSON.stringify(nyanVisual));
const nyanStunConfig = typeof kt.actionSkipStunConfigForTest === 'function'
  ? kt.actionSkipStunConfigForTest() : null;
check('行動不能の付与演出と手番の震えは従来の1.5倍にする',
  nyanStunConfig?.duration === 1.875
    && nyanStunConfig?.hitFlashDuration === 1.68
    && nyanStunConfig?.effectDurationMultiplier === 1.5
    && nyanStunConfig?.shakePx >= 3
    && indexHtml.includes("kind: 'actionSkip'")
    && indexHtml.includes('actionSkipShakeOffset(u)'),
  JSON.stringify(nyanStunConfig));
const nyanTurnBefore = kt.state().turnCount;
kt.endTurnForTest();
const nyanSequenceStart = typeof kt.actionSkipSequenceForTest === 'function'
  ? kt.actionSkipSequenceForTest() : null;
check('猫だまし命中の結果表示中は行動不能の震え演出を開始しない',
  nyanSequenceStart?.waitingForHitFlash === true
    && nyanSequenceStart?.presentationVisible === false
    && nyanSequenceStart?.timer === nyanSequenceStart?.duration,
  JSON.stringify(nyanSequenceStart));
check('行動不能の手番へ一度移り、震え演出中は状態をまだ消費しない',
  kt.state().turnOrder[kt.state().activeIndex] === 'e1'
    && kt.state().turnCount === nyanTurnBefore + 1
    && kt.turnEffectForTest('e1').actionSkipTurns === 1
    && kt.hasCutIn(),
  JSON.stringify({ state: kt.state(), effect: kt.turnEffectForTest('e1') }));
for (let i = 0; i < 78; i++) kt.step(1 / 60); // 1.3秒。命中結果は1.68秒なのでまだ表示中。
const nyanSequenceDuringHit = typeof kt.actionSkipSequenceForTest === 'function'
  ? kt.actionSkipSequenceForTest() : null;
check('命中結果を見せている1.3秒間は行動不能演出の時間を消費しない',
  kt.specialFlashForTest()?.timer > 0
    && nyanSequenceDuringHit?.presentationVisible === false
    && nyanSequenceDuringHit?.timer === nyanSequenceDuringHit?.duration,
  JSON.stringify({ flash: kt.specialFlashForTest(), sequence: nyanSequenceDuringHit }));
for (let i = 0; i < 24; i++) kt.step(1 / 60); // 合計1.7秒。命中結果が終わり、ここから震え始める。
const nyanSequenceAfterHit = typeof kt.actionSkipSequenceForTest === 'function'
  ? kt.actionSkipSequenceForTest() : null;
check('猫だまし命中の結果表示が消えてから行動不能の震え演出を開始する',
  !kt.specialFlashForTest()
    && nyanSequenceAfterHit?.waitingForHitFlash === false
    && nyanSequenceAfterHit?.presentationVisible === true
    && nyanSequenceAfterHit?.timer < nyanSequenceAfterHit?.duration,
  JSON.stringify({ flash: kt.specialFlashForTest(), sequence: nyanSequenceAfterHit }));
for (let i = 0; i < 78; i++) kt.step(1 / 60); // 震え開始から約1.3秒。
check('従来の震え時間を過ぎても1.5倍の演出中はまだスキップしない',
  kt.state().turnOrder[kt.state().activeIndex] === 'e1'
    && kt.turnEffectForTest('e1').actionSkipTurns === 1
    && kt.hasCutIn(),
  JSON.stringify({ state: kt.state(), effect: kt.turnEffectForTest('e1') }));
for (let i = 0; i < 36; i++) kt.step(1 / 60); // 残り約0.6秒を見せ切る。
check('行動不能になったキャラの次の手番は操作させず自動で飛ばす',
  kt.state().turnOrder[kt.state().activeIndex] === 'p1'
    && kt.state().turnCount === nyanTurnBefore + 2
    && kt.turnEffectForTest('e1').actionSkipTurns === 0,
  JSON.stringify({ state: kt.state(), effect: kt.turnEffectForTest('e1') }));
check('オンライン状態は震えスキップが完了してから送る',
  indexHtml.includes('endTurn(() => netSyncTurn(acted))')
    && !indexHtml.includes('if (!waitingForPeerResult) netSyncTurn(acted);'),
  '震え途中の手番を送ると、遅延した相手側で古い状態へ巻き戻る');

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
check('1vs1の名前カードは2枚・広い専用枠高さ72・上端44',
  panels1v1.length === 2 && panels1v1.every(p => p.h === 74 && p.cardY === 50),
  JSON.stringify(panels1v1));
check('1vs1の司令盤はターン帯・ミニマップ・HUD下端を拡張位置へ揃える',
  kt.turnBarTop() === 158 && kt.minimapTop() === 190 && kt.hudBottom() === 270,
  `帯=${kt.turnBarTop()} 地図=${kt.minimapTop()} HUD=${kt.hudBottom()}`);
const spawn1v1 = kt.units.map(u => Math.round((u.x / kt.stageW()) * 1000) / 1000);

kt.setFreeFormat('2v2');
kt.startFreeMatch();
const vs2v2 = kt.matchupCutIn();
const setup2v2Rows = kt.freeRows();
const allyBefore = kt.freeConfig().allyIndex;
const foe2Before = kt.freeConfig().foe2Index;
kt.changeFreeOption('ally', 1);
kt.changeFreeOption('foe2', 2);
const setup2v2Config = kt.freeConfig();
kt.startFreeMatch();
check('2vs2の演習では追加2体も選択でき、キャラ行と設定行がそれぞれ揃う',
  !!setup2v2Rows.ally && !!setup2v2Rows.foe2
    && ['player', 'cpu', 'ally', 'foe2'].every(key => setup2v2Rows[key].h === 82)
    && setup2v2Rows.terrain.h === 48 && setup2v2Rows.format.h === 48
    && kt.unitById('p2').character === kt.chars()[setup2v2Config.allyIndex]
    && kt.unitById('e2').character === kt.chars()[setup2v2Config.foe2Index]
    && setup2v2Config.allyIndex !== allyBefore && setup2v2Config.foe2Index !== foe2Before,
  JSON.stringify({ rows: setup2v2Rows, config: setup2v2Config, p2: kt.unitById('p2').character, e2: kt.unitById('e2').character }));
check('2vs2のVSカットインは p1＆p2 vs e1＆e2 の順',
  vs2v2
    && vs2v2.left.map(entry => entry.id).join(',') === 'p1,p2'
    && vs2v2.right.map(entry => entry.id).join(',') === 'e1,e2'
    && [...vs2v2.left, ...vs2v2.right].every(entry => kt.chars().includes(entry.character)),
  JSON.stringify(vs2v2));
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
check('2vs2は司令盤のターン帯とミニマップをカード2段ぶん下げる',
  kt.turnBarTop() === 220 && kt.minimapTop() === 252 && kt.hudBottom() === 332,
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

// v136: 着弾時の「移動不可」は、敵へ実際に当たった時だけ成功表示を出す。
// 発射時の必殺カットインとは別物。空振りや味方だけの誤爆で成功したように見せない。
kt.clearSpecialFlashForTest();
kt.emitEmpForTest(-500, -500, 30, 'p1', 2);
check('電磁波が空振りなら着弾時の移動不可カットインを出さない',
  kt.specialFlashForTest() === null, JSON.stringify(kt.specialFlashForTest()));

const empOwner = kt.unitById('p1');
empOwner.x = 40; empOwner.y = 300;
empAlly.x = 300; empAlly.y = 300;
kt.unitById('e1').x = 700; kt.unitById('e1').y = 300;
kt.unitById('e2').x = 1000; kt.unitById('e2').y = 300;
kt.clearSpecialFlashForTest();
kt.emitEmpForTest(empAlly.x, empAlly.y, 20, 'p1', 2);
check('電磁波が味方だけに当たった時は成功カットインを出さない',
  kt.specialFlashForTest() === null, JSON.stringify(kt.specialFlashForTest()));

const empEnemy = kt.unitById('e1');
kt.clearSpecialFlashForTest();
kt.emitEmpForTest(empEnemy.x, empEnemy.y, 20, 'p1', 2);
const empHitFlash = kt.specialFlashForTest();
check('バインドスピットが敵へ命中した時だけ移動不可カットインを出す',
  !!empHitFlash && empHitFlash.text.includes('バインドスピット命中') && empHitFlash.text.includes('移動不可'),
  JSON.stringify(empHitFlash));
const empLockVisual = kt.moveLockVisualForTest('e1');
check('移動封印中は文字や電気ではなく、足元を前後から囲む鎖と南京錠を割り当てる',
  !!empLockVisual && !('label' in empLockVisual) && empLockVisual.turns === 2
    && empLockVisual.effect === 'chain' && empLockVisual.placement === 'feet' && empLockVisual.icon === 'padlock'
    && /drawMoveLockChains\(u, a, tilt, 'back'\);[\s\S]{0,3000}drawMoveLockChains\(u, a, tilt, 'front'\);/.test(indexHtml),
  JSON.stringify(empLockVisual));

// 撃破済みのキャラへの二重ヒット(v128)。2vs2で先に倒れた味方/敵は薄く描かれるのに、
// その上へダメージ数字が出ていた(実機報告)。爆風・電磁波・拡散弾のどれでも同じこと。
// 数字だけでなく与ダメ記録にも積まれていたので、結果画面の平均ダメージまで水増しされていた。
kt.startFreeMatch();
const downed = kt.unitById('e2');
const stillUp = kt.unitById('e1');
downed.hp = 0;
stillUp.x = downed.x + 900; // 巻き込まれない位置へ退避させ、倒れている側だけを見る
check('薄く描く条件とダメージ判定の条件が同じ関数を通っている',
  kt.unitDefeated('e2') === true && kt.unitDefeated('e1') === false,
  `e2=${kt.unitDefeated('e2')} e1=${kt.unitDefeated('e1')}`);

const statsBefore = kt.stats().damageDealt;
kt.stage3().clearDamageTexts();
kt.explodeAtForTest(downed.x, downed.y, 1, 'p1');
check('撃破済みのキャラにダメージ数字を出さない(爆風)',
  kt.stage3().damageTexts().length === 0, kt.stage3().damageTexts().join(','));
check('撃破済みへの爆風は与ダメ記録にも積まない',
  kt.stats().damageDealt === statsBefore,
  `${statsBefore}→${kt.stats().damageDealt}`);

kt.stage3().clearDamageTexts();
kt.emitEmpForTest(downed.x, downed.y, 200, 'p1', 1);
check('撃破済みのキャラにダメージ数字を出さない(電磁波)',
  kt.stage3().damageTexts().length === 0, kt.stage3().damageTexts().join(','));
check('撃破済みのキャラに移動封印をかけ直さない',
  !downed.moveLockTurns, String(downed.moveLockTurns));

kt.stage3().clearDamageTexts();
kt.fireworkShardExplodeForTest(downed.x, downed.y, 'p1');
check('撃破済みのキャラにダメージ数字を出さない(拡散弾)',
  kt.stage3().damageTexts().length === 0, kt.stage3().damageTexts().join(','));

// 直しすぎの検査。生きているキャラには今までどおり出る。
kt.stage3().clearDamageTexts();
const aliveTarget = kt.unitById('e1');
const aliveHpBefore = aliveTarget.hp;
kt.explodeAtForTest(aliveTarget.x, aliveTarget.y, 1, 'p1');
check('生きているキャラには今までどおりダメージ数字が出る',
  kt.stage3().damageTexts().length > 0 && aliveTarget.hp < aliveHpBefore,
  `${kt.stage3().damageTexts().join(',')} hp ${aliveHpBefore}→${aliveTarget.hp}`);

// 弾の owner は**ユニットのidの文字列**であって、ユニットそのものではない。
// v128の検査を書く時にここを取り違え、creditDamage が黙って何もしない状態で
// 「積んでいない」と誤判定しかけた。同じ間違いを繰り返さないよう固定する。
kt.startFreeMatch();
kt.fireForTest(160, -260);
check('弾のownerはユニットのidの文字列',
  kt.projectileOwnerKind().length > 0 && kt.projectileOwnerKind().every(t => t === 'string'),
  kt.projectileOwnerKind().join(','));
kt.startFreeMatch();

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
check('通常の状態同期でVSカットインを出し直さない', !kt.hasCutIn());
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
const freeStart = kt.freeStartBtn();
check('対戦方式の行は開始ボタンと重ならない',
  fr.format.y + fr.format.h / 2 < freeStart.y - freeStart.h / 2
    && fr.format.y - fr.format.h / 2 > fr.terrain.y + fr.terrain.h / 2,
  JSON.stringify({ format: fr.format, terrain: fr.terrain, freeStart }));
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
const arrowY = kt.freeRows().format.y;
up(down(500, arrowY), 500, arrowY); // 右矢印
check('演習画面の右矢印で1vs1→2vs2へ切り替わる',
  kt.formatOptions()[kt.freeConfig().formatIndex] === '2v2',
  kt.formatOptions()[kt.freeConfig().formatIndex]);
const secondArrowY = kt.freeRows().format.y;
up(down(190, secondArrowY), 190, secondArrowY);  // 左矢印
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


// ===== v122: 開始カットインが終わるまで手番を始めない =====
// 実機報告「初手が相手ターン(CPU)の時、カットイン中に発射されて明けたら着弾している」。
// 原因は2つ重なっていた。
//   1. resetMatch は activeIndex=0(自分)で startTurn を済ませるが、オンラインはその後に
//      先攻を入れ直す。入れ直した側は startTurn を通らず、思考時間が0のまま残る。
//   2. ホストは resetMatch から開始カットインまでの間に通信を4往復する。その間
//      gamePhase は battle でカットインも無いので、盤面が動いてしまう。
// 修正前の実測はカットイン終了の0.02秒後に発射。修正後は約2.1秒の猶予がある。
const h3 = kt.stage3();
const FRAME = 1 / 60;

kt.setFreeFormat('2v2');
kt.startFreeMatch();
check('開始カットインが出ている間は「手番はまだ始まっていない」',
  kt.hasCutIn() && h3.battleIntroPending());

// オンラインのホストと同じく、カットインが出たあとで先攻を差し替える。
h3.setActiveUnitForTest('e1');
h3.setUnitControl('e1', 'cpu');
let firedAt = -1, cutInEndedAt = -1, clock = 0;
for (let i = 0; i < 60 * 8; i++) {
  const had = kt.hasCutIn();
  kt.step(FRAME); clock += FRAME;
  if (had && !kt.hasCutIn() && cutInEndedAt < 0) cutInEndedAt = clock;
  if (firedAt < 0 && (kt.projectiles().length || kt.state().awaitingResolve)) firedAt = clock;
}
check('先攻を差し替えても、カットインが明ける前には撃たれない',
  cutInEndedAt > 0 && firedAt > cutInEndedAt, `cutIn=${cutInEndedAt} fire=${firedAt}`);
check('カットインが明けてから撃つまでに、盤面を見る時間が1秒以上ある',
  firedAt - cutInEndedAt >= 1, `猶予=${(firedAt - cutInEndedAt).toFixed(2)}秒`);
check('差し替えた側の手番でもCPUの行動計画がきちんと作られる',
  ['move', 'aim'].includes(h3.cpuPlan().phase));

// カットインを出さないまま時間が流れる窓(オンラインのホストの通信待ち)を再現する。
// online が firebase だと resetMatch は開始カットインを出さない。ホストはそのあと
// 「先攻の抽選 → 部屋の更新 → 盤面の保存 → 開始データの送信」と4往復してから出す。
kt.setFreeFormat('2v2');
kt.startFreeMatch();
settle(); // 直前の試合の開始カットインを最後まで消化してから始める(前の状態を持ち込まない)
h3.setOnlineForLogTest({
  kind: 'firebase', role: 'host', phase: 'starting', seat: 'p1', room: 'A2BC3DEF',
  auth: { uid: 'uid-p1' }, log: [], queue: [], clientId: 'uid-p1', currentRoundId: 'r'.repeat(48),
  // 撃たれてしまった時に送信で落ちると、検査に届く前にテストごと止まる。
  // ここは「撃たれないこと」を見るための足場なので、送信は受け流す。
  transport: { send: () => Promise.resolve(true), close() {}, setRoundId() {}, reconnect() {} },
  settings: h3.normalizeLobbySettings({ terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '2v2', revision: 1 }),
  slots: { p1: { uid: 'uid-p1' }, s1: { uid: 'uid-s1' } }, participantRole: 'player',
  pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), remoteAction: null
});
h3.resetMatchForTest();
check('ホストの通信待ちの間は、まだカットインが出ていない',
  !kt.hasCutIn() && h3.battleIntroPending());
h3.setActiveUnitForTest('e1');
h3.setUnitControl('e1', 'cpu');
let firedInGap = false;
for (let i = 0; i < 60 * 5 && !firedInGap; i++) {
  kt.step(FRAME);
  if (kt.projectiles().length || kt.state().awaitingResolve) firedInGap = true;
}
check('カットインがまだ出ていない通信待ちの間も、CPUは撃たない', !firedInGap);
h3.setOnlineForLogTest(null);

// ===== v122: 誰の手番かを名前と陣営色で出す =====
// 2vs2は4体居るので「CPUのターン」だけでは、味方CPUなのか敵CPUなのかも分からなかった。
kt.setFreeFormat('2v2');
kt.startFreeMatch();
kt.setLocalSeat('p1');
const mine = h3.turnCutInLines('p1');
const ally = h3.turnCutInLines('p2');
const foe = h3.turnCutInLines('e1');
const cards = kt.unitPanelLayout();
const cardName = id => (cards.find(c => c.id === id) || {}).label;
check('手番の知らせは、HPカードと同じ呼び名を見出しにする',
  mine.text === cardName('p1') && ally.text === cardName('p2') && foe.text === cardName('e1'),
  [mine.text, ally.text, foe.text].join('/'));
// 同じキャラを両陣営が選ぶことはあるので、名前だけに頼らない。
// 名前が並んでも、役どころの行と見出しの色で味方CPUと敵CPUが必ず分かれる。
check('同じキャラが左右に並んでも、味方CPUと敵CPUは見分けられる',
  ally.sub !== foe.sub && ally.color !== foe.color,
  `${ally.sub}/${foe.sub}`);
check('自分・味方・相手を言い分ける',
  mine.sub === 'あなたのターン' && ally.sub === '味方のターン（CPU）' && foe.sub === '相手のターン（CPU）',
  [mine.sub, ally.sub, foe.sub].join('/'));
check('自陣営と相手陣営で見出しの色が違う',
  mine.color === ally.color && mine.color !== foe.color);
// 実際に手番が変わるまで進め、出てくるカットインの中身を見る。
settle();
let turnCutIn = null;
{
  // 自分の手番は入力が無いと進まないので、全席をCPUにして手番を回す。
  for (const id of ['p1', 'p2', 'e1', 'e2']) h3.setUnitControl(id, 'cpu');
  const startId = kt.state().turnOrder[kt.state().activeIndex];
  for (let i = 0; i < 60 * 30 && !turnCutIn; i++) {
    kt.step(FRAME);
    const info = h3.cutInInfo();
    if (info && kt.state().turnOrder[kt.state().activeIndex] !== startId) turnCutIn = info;
  }
}
check('手番が変わると、その名前と役どころが実際にカットインへ出る',
  !!turnCutIn && turnCutIn.duration === h3.turnCutInDuration()
  && /のターン/.test(turnCutIn.sub) && !!turnCutIn.text,
  JSON.stringify(turnCutIn));

// ===== v122: テンポ =====
check('CPUが狙いを定める時間は1.5秒以上ある',
  h3.cpuThinkRange()[0] >= 1.5 && h3.cpuThinkRange()[1] > h3.cpuThinkRange()[0]);
check('手番の知らせは、前より長く出て読み切れる', h3.turnCutInDuration() >= 1.2);
kt.setFreeFormat('1v1');
kt.setLocalSeat('p1');


// 画像は端末や回線で読めないことがある。読めなくても「誰と誰が戦うのか」は
// 必ず出ること。文字の位置ではなく、実際に描かれた文字で確かめる。
// 画像を捨てるので、ほかの検査に影響しないよう一番最後に置く。
{
  kt.setFreeFormat('2v2');
  kt.startFreeMatch();
  const card = kt.matchupCutIn();
  const names = card.left.concat(card.right).map(e => kt.character(e.character).name);
  kt.dropImagesForTest();
  const countIn = (list, name) => list.filter(t => t === name).length;
  // まずカットインを消した状態を数える。名前はHPカードなどでも描かれるので、
  // 「カットインで何回増えたか」で見ないと、出ていないことに気づけない。
  settle();
  kt.resetDrawnText();
  kt.render();
  const before = kt.drawnText();
  // もう一度カットインを出し、砲弾がぶつかってVSの紋章が出るところまで進める。
  kt.showBattleStartCutInForTest();
  for (let i = 0; i < 30; i++) kt.step(1 / 60);
  kt.resetDrawnText();
  kt.render();
  const after = kt.drawnText();
  check('砲弾もキャラも画像が届かない端末で、4人の名前がカットインにも描かれる',
    names.every(n => countIn(after, n) > countIn(before, n)),
    names.map(n => `${n}:${countIn(before, n)}→${countIn(after, n)}`).join(' '));
  check('その状態でもVSの合図は文字で出る',
    after.includes('VS') && !before.includes('VS'), after.join('/'));
}

// v124: 1vs1の空きに出す「役割・HP・必殺技」。実際に描かれた文字で確かめる。
// 2vs2は窓が狭いので出さない。出すと顔と重なって両方読めなくなる。
{
  const shown = (fmt) => {
    kt.setFreeFormat(fmt);
    kt.startFreeMatch();
    const card = kt.matchupCutIn();
    const defs = card.left.concat(card.right).map(e => kt.character(e.character));
    for (let i = 0; i < 30; i++) kt.step(1 / 60);
    kt.resetDrawnText();
    kt.render();
    return { defs, drawn: kt.drawnText() };
  };
  const one = shown('1v1');
  check('1vs1では役割・HP・必殺技が実際に描かれる',
    one.defs.every(d => one.drawn.includes(d.role)
      && one.drawn.includes(`HP ${d.maxHp}`)
      && one.drawn.includes(d.special)),
    one.defs.map(d => d.role + '/' + d.maxHp + '/' + d.special).join(' ') + ' drawn=' + one.drawn.join('/'));
  const two = shown('2v2');
  check('2vs2では窓が狭いので出さない',
    two.defs.every(d => !two.drawn.includes(d.role)),
    two.defs.map(d => d.role).join(' ') + ' drawn=' + two.drawn.join('/'));
  kt.setFreeFormat('1v1');
}

// ===== v126: チュートリアル(あそび方) =====
// 読ませるのではなく、実際に操作させて覚えてもらう作り。
// 何度失敗しても詰まらないこと、負けて終わらないことが要。
{
  const steps = kt.tutorialSteps();
  check('チュートリアルは6項目で、すべて場の用意と完了判定を持つ',
    steps.length === 6 && steps.every(s => s.hasSetup && s.hasCleared && s.title && s.body.length),
    steps.map(s => s.key).join(','));
  // 本文は自動で折り返さない。端末ごとに折り返し位置が変わらないよう1行ずつ書く決まり。
  check('本文は1行ずつ書かれていて、長すぎる行が無い',
    steps.every(s => s.body.every(line => line.length <= 26)),
    JSON.stringify(steps.map(s => s.body.map(l => l.length))));
  check('教える順は、撃つ→風→動く→跳ぶ→必殺→足場',
    steps.map(s => s.key).join(',') === 'fire,wind,move,jump,special,terrain');

  kt.startTutorialForTest();
  const t0 = kt.tutorialState();
  check('チュートリアル中の手番は自分だけ(相手は撃ち返してこない)',
    t0.turnOrder.join() === 'p1' && t0.active, JSON.stringify(t0.turnOrder));
  check('最初は1つ目の項目から始まる', t0.stepIndex === 0 && t0.key === 'fire');
  settle();

  // 何もしなければ進まない。「当てるまで何度でも」なので、待つだけでは次へ行かない。
  for (let i = 0; i < 60 * 6; i++) kt.step(1 / 60);
  check('当てるまでは何分待っても次へ進まない', kt.tutorialState().stepIndex === 0,
    JSON.stringify(kt.tutorialState()));
  check('相手は一度も撃ってこない(弾が飛んでいない)', kt.projectiles().length === 0);
  check('時間切れで終わらない', kt.state().matchOver === false);

  // 当てたら「できた!」を見せてから次の項目へ。
  kt.tutorialHurtDummy(10);
  kt.step(1 / 60);
  check('当てた瞬間に「できた!」へ変わる', kt.tutorialState().cleared === true);
  for (let i = 0; i < 60 * 3; i++) kt.step(1 / 60);
  const t1 = kt.tutorialState();
  check('少し見せてから次の項目へ進む', t1.stepIndex === 1 && t1.key === 'wind' && !t1.cleared,
    JSON.stringify(t1));
  check('次の項目では的のHPが戻っている(倒して途中で終わらせない)',
    t1.foeHp === kt.character('iwa').maxHp, String(t1.foeHp));

  // 的が倒れても、勝ち負けは付かないし結果画面へも行かない。
  // 決着の入口(checkMatchEnd)を実際に呼んで、そこで止まることを見る。
  kt.tutorialHurtDummy(9999);
  kt.checkMatchEndForTest();
  check('的が倒れても結果画面へ行かない(勝ち負けを付けない)',
    kt.state().matchOver === false && kt.state().winner === null,
    JSON.stringify(kt.state()));
  kt.step(1 / 60);
  kt.step(1 / 60);
  check('倒れかけた的は1で止まり、撃ち続けられる', kt.tutorialState().foeHp >= 1,
    String(kt.tutorialState().foeHp));

  // 時間切れの仕組みも通さない。タイムアップの演出が明けても決着しないこと。
  kt.setTurnCountForTest(9999);
  kt.endTurnForTest();
  for (let i = 0; i < 60 * 4; i++) kt.step(1 / 60);
  check('手番を重ねても時間切れで終わらない',
    kt.state().matchOver === false && kt.state().winner === null, JSON.stringify(kt.state()));

  // 「動く」は動いたら完了。撃たなくてもよい。
  kt.tutorialGoto('move');
  const beforeX = kt.tutorialState().meX;
  kt.units.find(u => u.id === 'p1').x = beforeX + 80;
  kt.step(1 / 60);
  check('「動く」は動いた時点で完了する', kt.tutorialState().cleared === true);

  // 「跳ぶ」は跳躍を使ったら完了。前の項目で使い切っていても、始めに戻すこと。
  kt.units.find(u => u.id === 'p1').jumpAvailable = false;
  kt.tutorialGoto('jump');
  check('「跳ぶ」の始めには跳躍が使える(前の項目で使っていても戻す)',
    kt.units.find(u => u.id === 'p1').jumpAvailable === true);
  kt.units.find(u => u.id === 'p1').jumpAvailable = false;
  kt.step(1 / 60);
  check('「跳ぶ」は跳躍を使った時点で完了する', kt.tutorialState().cleared === true);

  // 「必殺」は始めから溜まった状態にしておく。溜まるのを待たせない。
  kt.tutorialGoto('special');
  check('「必殺」の始めには必殺が溜まっている', kt.specialReady());
  // 発射を押した瞬間だけで次の「足場を壊す」へ移ると、飛んでいる必殺が
  // 次の項目まで勝手に達成してしまう。実際の必殺演出中も項目を保つこと。
  kt.tutorialFireSpecialForTest(80, -500);
  for (let i = 0; i < 60 * 1.6; i++) kt.step(1 / 60);
  check('必殺を撃ったあとは、演出中に次の項目へ遷移しない',
    kt.tutorialState().key === 'special' && kt.tutorialState().cleared,
    JSON.stringify({ tutorial: kt.tutorialState(), state: kt.state(), projectiles: kt.projectiles().length }));

  // 最後は足場を壊して落とす。的の左右が底まで掘られていること。
  kt.tutorialGoto('terrain');
  {
    // 的の足元だけが残り、左右は掘り抜かれていること。地面の有無で直接見る。
    const foe = kt.units.find(u => u.id === 'e1');
    const footY = foe.y + kt.unitRadius() + 6;
    const under = kt.isSolidAt(foe.x, footY);
    const left = kt.isSolidAt(foe.x - 86, footY);
    const right = kt.isSolidAt(foe.x + 86, footY);
    check('最後の項目では、的が細い足場の上に立っている(左右は掘り抜かれている)',
      under && !left && !right, `下=${under} 左=${left} 右=${right}`);
  }

  // 地形がランダムだと、闘技場のように中央が奈落の地形を引いた時に的が足場の無い
  // 場所へ置かれて落ちる。落下を「当てた」と誤判定して勝手に進んでいた。
  {
    // 最後の項目は地面を掘るので、掘った跡が残ったまま測ると嘘になる。
    // 実際の流れと同じく、始めからやり直して順に見る。
    kt.startTutorialForTest();
    settle();
    let allOnGround = true;
    const detail = [];
    for (const key of ['fire', 'wind', 'move', 'jump', 'special', 'terrain']) {
      kt.tutorialGoto(key);
      const foe = kt.units.find(u => u.id === 'e1');
      const onGround = kt.isSolidAt(foe.x, foe.y + kt.unitRadius() + 6);
      detail.push(`${key}:${onGround}`);
      if (!onGround) allOnGround = false;
    }
    check('どの項目でも、的は必ず地面の上に置かれる(落ちて勝手に進まない)',
      allOnGround, detail.join(' '));
  }
  // そのために地形は固定する。ランダムのままだと奈落のある地形を引く。
  check('チュートリアルの地形は固定されていて、毎回同じ手触りで覚えられる',
    kt.pattern() === 'rolling', kt.pattern());
  // チュートリアルは対戦ではないので、開始の見出しも「対戦開始」とは言わない。
  {
    kt.startTutorialForTest();
    kt.resetDrawnText();
    kt.render();
    const drawn = kt.drawnText();
    check('チュートリアルの開始カットは TUTORIAL START! と出る',
      drawn.includes('TUTORIAL START!') && !drawn.includes('BATTLE START'), drawn.join('/'));
  }

  // 最後の項目の足場は「通常弾1発で崩れる」大きさであること。
  // 一度、左右を掘るだけにしていたら、的が底まで続く太い柱の上に立ってしまい、
  // 1発では削りきれず何度撃っても終わらなかった(実機で指摘)。
  {
    const ledge = kt.tutorialLedge();
    // 共通化した通常弾のクレーターは半径44px。板はそれで丸ごと消える大きさに収める。
    check('足場は通常弾1発ぶんのクレーターに収まる大きさ',
      ledge.halfW * 2 <= 44 * 2 && ledge.thickness <= 44,
      `幅=${ledge.halfW * 2} 厚み=${ledge.thickness}`);
    let fell = 0;
    for (let run = 0; run < 4; run++) {
      kt.startTutorialForTest();
      settle();
      kt.tutorialGoto('terrain');
      const foe = kt.units.find(u => u.id === 'e1');
      // 中心から少しずれた、弱めの一発(半径44)でも崩れること
      kt.carveForTest(foe.x + (run % 2 ? 18 : -18), foe.y + kt.unitRadius() + 14, 44);
      for (let i = 0; i < 60 * 6; i++) kt.step(1 / 60);
      if (foe.hp <= 0 || foe.y + kt.unitRadius() >= kt.deadLineY()) fell++;
    }
    check('足場を1発撃てば、的は場外まで落ちる(4回とも)', fell === 4, `${fell}/4`);
  }

  // 最後の項目を終えると、完了の合図を出してタイトルへ戻る。
  kt.startTutorialForTest();
  settle();
  {
    kt.tutorialGoto('terrain');
    const foe = kt.units.find(u => u.id === 'e1');
    foe.hp = 0;                       // 足場を撃ち抜いて落ちた状態
    kt.step(1 / 60);
    check('最後の項目を終えると完了になる', kt.tutorialState() === null || kt.tutorialState().cleared,
      JSON.stringify(kt.tutorialState()));
    for (let i = 0; i < 60 * 6; i++) kt.step(1 / 60);
    check('完了するとタイトルへ戻り、通常の対戦モードへ戻る',
      kt.state().gamePhase === 'title' && kt.mode() === 'normal',
      `${kt.state().gamePhase}/${kt.mode()}`);
    check('完了すると、次からはタイトルで勧めない', kt.tutorialRecommended() === false);
    check('完了しても勝ち負けは付かない', kt.state().winner === null, String(kt.state().winner));
  }

  // 「とばす」はいつでも押せて、タイトルへ戻る。
  kt.startTutorialForTest();
  settle();
  kt.tutorialSkipForTest();
  check('とばすとタイトルへ戻り、通常の対戦モードに戻る',
    kt.state().gamePhase === 'title' && kt.mode() === 'normal' && kt.tutorialState() === null,
    `${kt.state().gamePhase}/${kt.mode()}`);
  // 飛ばした人にも二度目は勧めない。本人が決めたことを蒸し返さない。
  check('一度通すか飛ばすと、タイトルで勧めなくなる', kt.tutorialRecommended() === false);
}

// タイトルの「チュートリアル」は、ほかのボタンと重ならないこと。
{
  const b = kt.titleBtnRects();
  const others = [b.cpu, b.online, b.free, b.ranking, b.update];
  check('「チュートリアル」ボタンが他のタイトルボタンと重ならない',
    others.every(o => !rectsOverlap(b.tutorial, o)), JSON.stringify(b.tutorial));
  check('「チュートリアル」ボタンが画面内に収まっている',
    b.tutorial.y - b.tutorial.h / 2 > 0 && b.tutorial.y + b.tutorial.h / 2 < kt.viewH());

  // 高さ54の小ボタンへ高さ64の大ボタンと同じ文字位置を使うと、23pxの見出しが上枠へ食い込む。
  // 実際に描画された座標を見て、左右どちらも小ボタン専用の位置になっていることを固定する。
  kt.setPhase('title');
  kt.setTitleMenuPageForTest(0);
  kt.setTitleWoodUiReadyForTest();
  kt.resetDrawnText();
  kt.render();
  const titleText = kt.drawnTextDetails();
  const titleMenuTextSizes = titleText.filter(entry => ['チュートリアル', '演習', 'はじめての方へ', '条件を組んで開始', 'もう一度おさらい'].includes(entry.text));
  check('タイトルメニューのチュートリアル・演習文字を読みやすい大きさにする',
    titleMenuTextSizes.some(entry => /21px/.test(entry.font))
      && titleMenuTextSizes.filter(entry => /px/.test(entry.font)).some(entry => /11px/.test(entry.font)),
    JSON.stringify(titleMenuTextSizes));
  const tutorialLabel = titleText.find(entry => entry.text === 'チュートリアル');
  const freeLabel = titleText.find(entry => entry.text === '演習');
  const tutorialSub = titleText.find(entry => entry.text === 'もう一度おさらい');
  const freeSub = titleText.find(entry => entry.text === '条件を組んで開始');
  check('タイトルの「チュートリアル」「演習」は見出しを上げ、説明との間隔を広げる',
    tutorialLabel && freeLabel
      && tutorialSub && freeSub
      && tutorialLabel.y <= b.tutorial.y - 4
      && freeLabel.y <= b.free.y - 4
      && tutorialSub.y - tutorialLabel.y >= 14
      && freeSub.y - freeLabel.y >= 14,
    JSON.stringify({ tutorialLabel, tutorialSub, freeLabel, freeSub, tutorial: b.tutorial, free: b.free }));
  check('羊皮紙の文字は茶色ではなく深い青緑で読み分けられる',
    tutorialLabel && freeLabel
      && tutorialLabel.fillStyle === '#123f3d'
      && freeLabel.fillStyle === '#123f3d',
    JSON.stringify({ tutorialLabel, freeLabel }));
  kt.setTitleMenuPageForTest(1);
  kt.resetDrawnText();
  kt.render();
  const garageText = kt.drawnTextDetails();
  const soundLabel = garageText.find(entry => entry.text === 'サウンドテスト');
  const soundSub = garageText.find(entry => entry.text === '全BGMを試聴');
  check('GARAGEのサウンドテストは既存の緑盾内へ収まる文字サイズを使う',
    soundLabel && soundSub && /16px/.test(soundLabel.font)
      && soundLabel.y <= b.soundTest.y - 15 && soundSub.y <= b.soundTest.y + 10,
    JSON.stringify({ soundLabel, soundSub, button: b.soundTest }));
  check('GARAGEにはショップ・実績・サウンドテストだけを表示する',
    ['ショップ', '実績', 'サウンドテスト'].every(label => garageText.some(entry => entry.text === label)),
    JSON.stringify(garageText.filter(entry => ['ショップ', '実績', 'サウンドテスト', 'CPU BATTLE'].includes(entry.text))));
  kt.setTitleMenuPageForTest(0);

  // v168: 提供された木板・盾・吊り看板・羊皮紙を、タイトルの押せる枠として使う。
  // 画像名だけ置いて実際の配置が旧UIのまま、という実装を通さない。
  const woodUi = kt.titleWoodUiInfo();
  const expectedWoodAssets = [
    'assets/title-mode-board.webp',
    'assets/title-shield-button.webp',
    'assets/title-hanging-sign.webp',
    'assets/title-parchment-button.webp'
  ];
  check('タイトルが提供された4種類の木板UI素材を使う',
    !!woodUi && expectedWoodAssets.every(src => (
      Object.values(woodUi.assets).includes(src)
        && require('fs').existsSync(require('path').join(__dirname, '..', src))
    )),
    woodUi ? JSON.stringify(woodUi.assets) : '木板UIなし');
  if (woodUi) {
    const expectedKinds = {
      cpu: 'parchment', online: 'parchment',
      tutorial: 'parchment', free: 'parchment',
      ranking: 'hangingSign', shop: 'parchment', achievements: 'parchment', soundTest: 'shield'
    };
    check('BATTLEとGARAGEが既存の羊皮紙・吊り看板・緑盾を役割別に再利用する',
      Object.entries(expectedKinds).every(([role, asset]) => (
        woodUi.imageRects[role] && woodUi.imageRects[role].asset === asset
      )),
      JSON.stringify(woodUi.imageRects));
    check('GARAGEのサウンドテストは緑盾を中央へ置く',
      woodUi.imageRects.soundTest.x === kt.viewW() / 2 && woodUi.imageRects.soundTest.y <= 805,
      JSON.stringify(woodUi.imageRects.soundTest));
    check('木枠と中のボタン素材を同じ割合で一回り大きくする',
      woodUi.board.w >= 450 && woodUi.board.h >= 430
        && woodUi.imageRects.cpu.w >= 295 && woodUi.imageRects.cpu.h >= 80
        && woodUi.imageRects.tutorial.w >= 185 && woodUi.imageRects.tutorial.h >= 50
        && woodUi.imageRects.soundTest.w >= 120 && woodUi.imageRects.soundTest.h >= 110,
      JSON.stringify({ board: woodUi.board, imageRects: woodUi.imageRects }));
    check('中断データがあっても黄色い選択囲いを出さない',
      woodUi.selectionOutline === false, String(woodUi.selectionOutline));
    check('RANKINGの吊り看板はBATTLE下段の中央へ収まる',
      woodUi.imageRects.ranking.x === kt.viewW() / 2
        && woodUi.imageRects.ranking.y - woodUi.imageRects.ranking.h / 2
          <= woodUi.imageRects.tutorial.y + woodUi.imageRects.tutorial.h / 2 + 12,
      JSON.stringify({ ranking: woodUi.imageRects.ranking, tutorial: woodUi.imageRects.tutorial }));
    check('BATTLEは対戦5項目、GARAGEは管理3項目の順で、更新ボタンは木枠外へ固定する',
      woodUi.buttons.cpu.y < woodUi.buttons.online.y
        && woodUi.buttons.online.y < woodUi.buttons.tutorial.y
        && woodUi.buttons.tutorial.y === woodUi.buttons.free.y
        && woodUi.buttons.tutorial.x < woodUi.buttons.free.x
        && woodUi.buttons.tutorial.w < woodUi.buttons.cpu.w
        && woodUi.buttons.ranking.y > woodUi.buttons.tutorial.y
        && woodUi.buttons.shop.y < woodUi.buttons.achievements.y
        && woodUi.buttons.achievements.y < woodUi.buttons.soundTest.y
        && woodUi.buttons.update.y - woodUi.buttons.update.h / 2 > woodUi.board.y + woodUi.board.h,
      JSON.stringify({ board: woodUi.board, buttons: woodUi.buttons }));
    const pageButtonGroups = woodUi.pages.map(page => page.items.map(item => woodUi.buttons[item.id]));
    check('木板と両ページのボタンが画面内に収まり、同じページ内で重ならない',
      woodUi.board.x >= 0 && woodUi.board.y >= 0
        && woodUi.board.x + woodUi.board.w <= kt.viewW()
        && woodUi.board.y + woodUi.board.h <= kt.viewH()
        && Object.values(woodUi.buttons).every(button => (
          button.x - button.w / 2 >= 0 && button.x + button.w / 2 <= kt.viewW()
            && button.y - button.h / 2 >= 0 && button.y + button.h / 2 <= kt.viewH()
        ))
        && pageButtonGroups.every(group => group.every((button, index) => (
          group.slice(index + 1).every(other => !rectsOverlap(button, other))
        ))),
      JSON.stringify({ board: woodUi.board, buttons: woodUi.buttons }));
  }
}

// ===== 描き直しの節約(v129) =====
// 空と地形は「毎コマ作り直していた絵」を1枚に焼いて貼る形にした。
// **焼き直しの合図を書き忘れると、古い絵が出たままになる。** そこを固定する。
kt.startBattle('kyoryu');
kt.setTerrain('rolling');
kt.render();

// 1) 毎コマ焼き直していないこと。これが崩れると軽くした意味が無くなる。
const artA = kt.artBuilds();
for (let i = 0; i < 30; i++) kt.render();
const artB = kt.artBuilds();
check('空を毎コマ焼き直していない(30コマ描いても回数が増えない)',
  artB.sky === artA.sky, `${artA.sky}→${artB.sky}`);
check('地形を毎コマ束ね直していない(30コマ描いても回数が増えない)',
  artB.terrain === artA.terrain, `${artA.terrain}→${artB.terrain}`);

// 2) 中身が変わったら必ず作り直すこと。4枚それぞれの入口を実際に通す。
const dirtyAfter = (name, fn) => {
  kt.render();                       // ここで合図は必ず倒れる
  const before = kt.terrainArtDirty();
  fn();
  const after = kt.terrainArtDirty();
  check(`${name}のあと、地形を束ね直す合図が立つ`, before === false && after === true,
    `前=${before} 後=${after}`);
};
dirtyAfter('穴あけ', () => kt.carveCraterForTest(600, 460, 50));
// 拡散弾と中断からの復元は「縁取りを作り直さない穴あけ」を使う。
// この道は他の合図に助けてもらえないので、ここが抜けると古い地形が残る。
dirtyAfter('縁取りなしの穴あけ(拡散弾の道)', () => kt.carveCraterNoRimForTest(640, 470, 44));
dirtyAfter('地形の作り直し', () => kt.buildTerrainMaskForTest());
dirtyAfter('縁取りの描き直し', () => kt.rebuildTerrainRimForTest());
dirtyAfter('橋の描き直し', () => kt.rebuildBridgeForTest());
dirtyAfter('闘技場の飾りの描き直し', () => kt.rebuildArenaDecoForTest());

// 実際に束ね直しの回数が1つ増えることも見る(合図だけ立てて描き直さない実装を弾く)
kt.render();
const beforeCarve = kt.artBuilds().terrain;
kt.carveCraterForTest(700, 470, 46);
kt.render();
check('穴があいたら、地形を実際に1回だけ束ね直す',
  kt.artBuilds().terrain === beforeCarve + 1,
  `${beforeCarve}→${kt.artBuilds().terrain}`);

// 3) 空を焼き直す条件。テーマ・遠景の種・背景写真の有無で変わること。
kt.setThemeForTest('grass');
const sigBase = kt.skyArtSignature();
kt.setThemeForTest('snow');
check('テーマが変われば空を焼き直す', kt.skyArtSignature() !== sigBase,
  `${sigBase} / ${kt.skyArtSignature()}`);
const sigSnow = kt.skyArtSignature();
kt.setParallaxSeedForTest(12345.5);
check('遠景の種が変われば空を焼き直す', kt.skyArtSignature() !== sigSnow,
  `${sigSnow} / ${kt.skyArtSignature()}`);
kt.render();
const skyBefore = kt.artBuilds().sky;
kt.setThemeForTest('volcanic');
kt.render();
check('テーマを変えたら、空を実際に1回だけ焼き直す',
  kt.artBuilds().sky === skyBefore + 1, `${skyBefore}→${kt.artBuilds().sky}`);

// ===== 描く細かさ(v131) =====
// 以前は `VW * dpr` でキャンバスを持っていた。これは画面に映る大きさを見ていないので、
// 端末によっては画面の実画素より大きいキャンバスを塗ってから縮めていた(実機で1.7倍)。
// 見えるものは同じで、塗る量だけ増える。ここが崩れると軽量化がそのまま戻る。
const VW = 540, VH = 960;
const screens = [
  { name: '実機(1080x2374, 2.625倍)', w: 411, h: 904, dpr: 2.625 },
  { name: '横長の端末(412x915, 3倍)', w: 412, h: 915, dpr: 3 },
  { name: '低い解像度(360x640, 2倍)', w: 360, h: 640, dpr: 2 },
  { name: '等倍の画面(540x960, 1倍)', w: 540, h: 960, dpr: 1 }
];
for (const s of screens) {
  const r = kt.resizeForTest(s.w, s.h, s.dpr);
  const capped = s.dpr * Math.min(s.w / 540, s.h / 960) > kt.maxRenderScale();
  if (capped) {
    check(`${s.name}: 上限で頭打ちになる`,
      Math.abs(r.renderScale - kt.maxRenderScale()) < 0.001, JSON.stringify(r));
  } else {
    // 幅と高さの両方で、キャンバスの画素数が画面の実画素と一致すること(±1は丸め)
    check(`${s.name}: キャンバスが画面の実画素とぴったり一致する`,
      Math.abs(r.canvasW - r.画面の実画素W) <= 1 && Math.abs(r.canvasH - r.画面の実画素H) <= 1,
      JSON.stringify(r));
  }
  check(`${s.name}: 上限を超えない`,
    r.renderScale <= kt.maxRenderScale() + 0.001, `renderScale=${r.renderScale}`);
  // 大きさだけ合っていても、拡大率がずれていれば絵が画面からはみ出す。
  check(`${s.name}: キャンバスの大きさと拡大率が食い違わない`,
    Math.abs(r.transformScaleX * VW - r.canvasW) <= 1 && Math.abs(r.transformScaleY * VH - r.canvasH) <= 1,
    `拡大率=${r.transformScaleX}x${r.transformScaleY} キャンバス=${r.canvasW}x${r.canvasH}`);
}
// 上限に当たる端末(高精細)。画面より粗くはなるが、上限どおりで止まること。
const hi = kt.resizeForTest(412, 915, 4);
check('高精細な端末では上限で止まる(塗る量が二乗で増えるのを防ぐ)',
  Math.abs(hi.renderScale - kt.maxRenderScale()) < 0.001 && hi.canvasW < hi.画面の実画素W,
  JSON.stringify(hi));
// 上限の値そのもの。上げると重くなるので、変えたら必ずここも直す。
check('描く細かさの上限は2', kt.maxRenderScale() === 2, String(kt.maxRenderScale()));
kt.resizeForTest(540, 960, 1);

// ===== タイトル画面を1枚に焼く(v132) =====
// 背景の全画面グラデーションとロゴの影＋切り抜きは動かないのに、以前は毎コマ作っていた。
// 空(v129)と同じく2倍で1枚に焼き、画像の準備状態が変わった時だけ作り直す。
const titleIntro = kt.titleIntroInfo();
check('タイトルは石壁タップから始点・動画・終点の3素材を順番に使う',
  titleIntro.start.endsWith('assets/title-background-logo-start.jpg')
    && titleIntro.video.endsWith('assets/title-background-logo-transition.mp4')
    && titleIntro.end.endsWith('assets/title-background-logo-end.jpg')
    && /startTitleIntroSequence\(\);[\s\S]{0,120}enterTitleFromTap\(\);/.test(indexHtml),
  JSON.stringify(titleIntro));
check('タイトル背景を端末時刻で朝昼夕夜へ切り替えない',
  !indexHtml.includes('getTitleTimeTheme')
    && !indexHtml.includes('titleTimeBackgroundPaths')
    && !/assets\/title-(?:morning|day|evening|night)\.jpg/.test(indexHtml));
kt.startTitleIntroForTest();
check('新タイトル演出は起動後の開始操作で一度だけ開始状態になる',
  kt.titleIntroInfo().started === true, JSON.stringify(kt.titleIntroInfo()));
const titleArtStart = kt.titleArtInfo();
check('タイトルの動かない絵を焼く仕組みがある', !!titleArtStart,
  titleArtStart ? JSON.stringify(titleArtStart) : '未実装');
if (titleArtStart) {
  check('タイトルは仮想座標の2倍で焼く',
    titleArtStart.scale === 2 && titleArtStart.width === VW * 2 && titleArtStart.height === VH * 2,
    JSON.stringify(titleArtStart));

  kt.setPhase('title');
  kt.render();
  const titleAfterFirstDraw = kt.titleArtInfo();
  for (let i = 0; i < 30; i++) kt.render();
  const titleAfterThirtyFrames = kt.titleArtInfo();
  check('タイトルを毎コマ焼き直していない(30コマ描いても回数が増えない)',
    titleAfterThirtyFrames.builds === titleAfterFirstDraw.builds,
    `${titleAfterFirstDraw.builds}→${titleAfterThirtyFrames.builds}`);
  check('BATTLEとGARAGEは全画面より小さい2枚の木板キャッシュへ分離する',
    titleAfterThirtyFrames.menuCanvases.length === 2
      && titleAfterThirtyFrames.menuCanvases.every(canvas => (
        canvas.width < titleAfterThirtyFrames.width && canvas.height < titleAfterThirtyFrames.height
      )),
    JSON.stringify(titleAfterThirtyFrames.menuCanvases));
  check('タイトル木板も30コマで焼き直さず、完成済み画像だけをスライドする',
    titleAfterThirtyFrames.menuBuilds === titleAfterFirstDraw.menuBuilds,
    `${titleAfterFirstDraw.menuBuilds}→${titleAfterThirtyFrames.menuBuilds}`);

  const fallbackSignature = titleAfterThirtyFrames.signature;
  kt.setTitleArtReadyForTest();
  kt.render();
  const titleAfterImagesReady = kt.titleArtInfo();
  check('背景とロゴの準備状態が変わればタイトルを1回だけ焼き直す',
    titleAfterImagesReady.signature !== fallbackSignature
      && titleAfterImagesReady.builds === titleAfterThirtyFrames.builds + 1,
    `${fallbackSignature}→${titleAfterImagesReady.signature} / ${titleAfterThirtyFrames.builds}→${titleAfterImagesReady.builds}`);
}

// ===== 次の風を先に知らせる(v133) =====
// 画面に出した予報を次の切替で振り直すと、予報が嘘になる。1vs1の既存周期である
// 4ターン目までは今の風を保ち、4ターン目に予報そのものを使うことを確認する。
kt.startBattle('kyoryu');
settle();
const firstForecast = kt.windForecast();
check('対戦開始時に次の風が1つ用意される', !!firstForecast,
  firstForecast ? JSON.stringify(firstForecast) : '予報なし');
const forecastReady = kt.setWindCycleForTest(
  { dir: -1, strength: 0.25, calmWind: false },
  { dir: 1, strength: 0.75, calmWind: false }
);
kt.setTurnCountForTest(3);
kt.startTurnForTest();
const beforeWindChange = kt.wind();
kt.setTurnCountForTest(4);
kt.startTurnForTest();
const afterWindChange = kt.wind();
check('1vs1は4ターン目まで現在の風を保ち、予報した風を次に使う',
  forecastReady
    && beforeWindChange.dir === -1 && beforeWindChange.strength === 0.25
    && afterWindChange.dir === 1 && afterWindChange.strength === 0.75,
  JSON.stringify({ forecastReady, beforeWindChange, afterWindChange }));
kt.setWindCycleForTest(
  { dir: 1, strength: 0.5, calmWind: false },
  { dir: -1, strength: 0.123456789, calmWind: false }
);
kt.stage3().resetMatchForTest();
const forecastAfterRematch = kt.windForecast();
check('再戦では前の試合の風予報を持ち越さない', !!forecastAfterRematch
  && !(forecastAfterRematch.dir === -1 && forecastAfterRematch.strength === 0.123456789),
  JSON.stringify(forecastAfterRematch));

kt.setFreeWindForTest('left');
kt.startFreeMatch();
const fixedCurrent = kt.wind();
const fixedForecast = kt.windForecast();
check('固定風は現在と次が同じ値になる', fixedCurrent.dir === -1 && fixedCurrent.strength === 0.6
  && fixedForecast && fixedForecast.dir === fixedCurrent.dir && fixedForecast.strength === fixedCurrent.strength,
  JSON.stringify({ fixedCurrent, fixedForecast }));
kt.setFreeWindForTest('calm');
kt.startFreeMatch();
const calmCurrent = kt.wind();
const calmForecast = kt.windForecast();
check('無風固定は現在も次も無風になる', calmCurrent.strength === 0
  && calmForecast && calmForecast.strength === 0 && calmForecast.calmWind === true,
  JSON.stringify({ calmCurrent, calmForecast }));

kt.setFreeWindForTest('random');
kt.setFreeFormat('2v2');
kt.startFreeMatch();
kt.setWindCycleForTest(
  { dir: -1, strength: 0.2, calmWind: false },
  { dir: 1, strength: 0.8, calmWind: false }
);
kt.setTurnCountForTest(7);
kt.startTurnForTest();
const before2v2WindChange = kt.wind();
kt.setTurnCountForTest(8);
kt.startTurnForTest();
const after2v2WindChange = kt.wind();
check('2vs2は全員が2巡する8ターン目に予報した風を使う',
  before2v2WindChange.dir === -1 && before2v2WindChange.strength === 0.2
    && after2v2WindChange.dir === 1 && after2v2WindChange.strength === 0.8,
  JSON.stringify({ before2v2WindChange, after2v2WindChange }));

const forecastBeforeSave = kt.windForecast();
const forecastSnapshot = kt.buildSnapshotForTest();
kt.setWindCycleForTest(
  { dir: 1, strength: 0.1, calmWind: false },
  { dir: -1, strength: 0.9, calmWind: false }
);
kt.applySnapshotForTest(forecastSnapshot);
check('中断再開・観戦用の状態復元でも次の風が一致する',
  JSON.stringify(kt.windForecast()) === JSON.stringify(forecastBeforeSave),
  `${JSON.stringify(forecastBeforeSave)}→${JSON.stringify(kt.windForecast())}`);

const steelStagePatterns = [
  ['grassSteelPartial', 'grass'], ['grassSteelWhole', 'grass'],
  ['desertSteelPartial', 'desert'], ['desertSteelWhole', 'desert'],
  ['snowSteelPartial', 'snow'], ['snowSteelWhole', 'snow'],
  ['volcanicSteelPartial', 'volcanic'], ['volcanicSteelWhole', 'volcanic']
];
const steelStageChecks = steelStagePatterns.map(([pattern, theme]) => {
  const result = kt.newTerrainForTest(pattern);
  const partial = pattern.endsWith('Partial');
  return result.pattern === pattern && result.themeKey === theme
    && (partial
      ? result.material === 'terrain' && result.materialSegments.some(column => column.length > 0)
      : result.material === 'steel' && result.materialSegments.every(column => column.length === 0));
});
check('各背景に一部鋼鉄・全面鋼鉄の公式ステージが追加されている',
  steelStageChecks.every(Boolean), JSON.stringify(steelStageChecks));

kt.newTerrainForTest('grassSteelPartial');
const steelStageSnapshot = kt.buildSnapshotForTest();
check('鋼鉄ステージの素材情報が開始スナップショットへ保存される',
  steelStageSnapshot.pattern === 'grassSteelPartial'
    && steelStageSnapshot.terrainMaterial === 'terrain'
    && Array.isArray(steelStageSnapshot.terrainMaterialSegments)
    && steelStageSnapshot.terrainMaterialSegments.some(column => column.length > 0),
  JSON.stringify({ pattern: steelStageSnapshot.pattern, material: steelStageSnapshot.terrainMaterial }));

// ===== 協力戦: 複数必殺を同時オーラ→同時カットインで見せる =====
// 本番へデバッグ口を残さず、Nodeハーネスだけで実際のarm→予兆→描画経路を通す。
kt.setFreeFormat('2v2');
kt.startFreeMatch();
const coopSpecialKeys = ['kyoryu', 'medama', 'iwa', 'tori'];
const coopSpecialIds = ['p1', 'p2', 'e1', 'e2'];
const armedCoopSpecials = kt.armCoopSpecialSalvoForTest(coopSpecialIds, coopSpecialKeys);
check('4体の必殺を同じ一斉砲撃へ積むと、全員同時オーラの予兆から始まる',
  armedCoopSpecials.armed === true
    && armedCoopSpecials.phase === 'special-aura'
    && armedCoopSpecials.duration === 0.9
    && armedCoopSpecials.entries.length === 4
    && armedCoopSpecials.charges.every(charge => charge === 0)
    && armedCoopSpecials.auraVisible && !armedCoopSpecials.flashVisible
    && armedCoopSpecials.projectileCount === 0,
  JSON.stringify(armedCoopSpecials));
check('同時オーラは4体のキャラ・技名・固有色を欠かさず同じ時間状態で保持する',
  armedCoopSpecials.entries.map(entry => entry.key).join(',') === coopSpecialKeys.join(',')
    && armedCoopSpecials.entries.every((entry, index) => (
      entry.label === kt.character(coopSpecialKeys[index]).name
        && entry.text === kt.character(coopSpecialKeys[index]).special
        && /^#[0-9a-f]{6}$/i.test(entry.color)
    )),
  JSON.stringify(armedCoopSpecials.entries));
const coopSpecialCutin = kt.advanceCoopSpecialAuraForTest();
check('同時オーラ終了後にだけ2.37秒のカットインへ進み、まだ発射しない',
  coopSpecialCutin.advanced === true
    && coopSpecialCutin.phase === 'special-cutin'
    && coopSpecialCutin.duration === 2.37
    && coopSpecialCutin.entries.length === 4
    && coopSpecialCutin.projectileCount === 0,
  JSON.stringify(coopSpecialCutin));
const firstCoopSpecialPanel = kt.drawCoopSpecialSalvoForTest(0.08);
const secondCoopSpecialPanel = kt.drawCoopSpecialSalvoForTest(0.24);
const thirdCoopSpecialPanel = kt.drawCoopSpecialSalvoForTest(0.40);
check('複数必殺パネルは全員同時出現ではなく約0.16秒差で1体ずつ飛び込む',
  firstCoopSpecialPanel.text.includes(kt.character('kyoryu').special)
    && !firstCoopSpecialPanel.text.includes(kt.character('medama').special)
    && secondCoopSpecialPanel.text.includes(kt.character('medama').special)
    && !secondCoopSpecialPanel.text.includes(kt.character('iwa').special)
    && thirdCoopSpecialPanel.text.includes(kt.character('iwa').special)
    && !thirdCoopSpecialPanel.text.includes(kt.character('tori').special),
  JSON.stringify({
    first: firstCoopSpecialPanel.text,
    second: secondCoopSpecialPanel.text,
    third: thirdCoopSpecialPanel.text,
  }));
const drawnCoopSpecials = kt.drawCoopSpecialSalvoForTest();
const expectedCoopSpecialNames = coopSpecialKeys.map(key => kt.character(key).special);
check('4体同時カットインをCanvasへ描くと「同時必殺」と全員の技名が同じフレームに出る',
  drawnCoopSpecials.text.includes('同時必殺')
    && drawnCoopSpecials.text.includes('4 UNIT SPECIAL SALVO')
    && expectedCoopSpecialNames.every(name => drawnCoopSpecials.text.includes(name))
    && drawnCoopSpecials.details.some(entry => entry.text === '同時必殺' && /48px/.test(entry.font)),
  JSON.stringify(drawnCoopSpecials.text));
check('同時カットインはカタモン固有の黒鉄・真鍮パネルとして実装し、他作品の画像を持ち込まない',
  indexHtml.includes('カタモンの黒鉄板・真鍮継ぎ目・リベットで画面を割る')
    && !/persona|ペルソナ|atlus/i.test(indexHtml),
  'original presentation guard missing');
const supportSalvo = kt.launchCoopSupportSalvoForTest();
check('一斉行動の跳躍と救助弾は通常物理へ順番に投入し、各使用権を1回だけ消費する',
  supportSalvo.projectiles.length === 2
    && supportSalvo.projectiles[0].owner === 'p1' && supportSalvo.projectiles[0].jump === true
    && supportSalvo.projectiles[1].owner === 'p2' && supportSalvo.projectiles[1].coopItemId === 'rescue-kit'
    && supportSalvo.jumpAvailable === false
    && supportSalvo.rescueUsesLeft === 0
    && supportSalvo.launchTicks.join(',') === '0,18',
  JSON.stringify(supportSalvo));

console.log(`\n=== regression seat=${SEAT} ===`);
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
