// カタモン Stage 2a 検証ハーネス
// index.html の <script> を抜き出し、Canvas/Audio/DOM をスタブしたNode上で実行して
// 「席(localUnit/foeUnit)の切り離しが効いているか」を自動で確かめる。
// 単体では使わない。tests/seattest.js と tests/regressiontest.js から読み込む。
//   node tests/seattest.js p1    (通常の席)
//   node tests/seattest.js e1    (オンライン対戦のゲスト想定の席)
const fs = require('fs');
const path = require('path');
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;
// 本番ではindex.html直後に読み込まれる協力要塞API。ハーネスはinline scriptだけを
// 実行するため、実弾のCORE・部位判定を検証する時だけ同じAPIを先に接続する。
globalThis.KatamonCoopBoss = require('../coop-mvp-boss.js');

const SEAT = process.argv[2] === 'e1' ? 'e1' : 'p1';
const HTML = path.join(__dirname, '..', 'index.html');

// ---- ブラウザと同じ順のスクリプト抽出 ----
const html = fs.readFileSync(HTML, 'utf8');
const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const inlineIndex = scriptTags.findIndex(([, attributes]) => !/\bsrc\s*=/.test(attributes));
if (inlineIndex < 0) throw new Error('inline game script tag not found');
const sourceFromAttributes = (attributes) => {
  const match = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes);
  return match ? match[1] : null;
};
const preludeSources = scriptTags
  .slice(0, inlineIndex)
  .map(([attributes]) => sourceFromAttributes(attributes))
  .filter(Boolean);
const externalPrelude = preludeSources.map((source) => {
  const relativePath = source.replace(/[?#].*$/, '');
  const absolutePath = path.join(__dirname, '..', relativePath);
  // 本体ファイルをリネームせず、外部script欠落時にハーネスが確実に落ちることを
  // 検証するためのテスト専用スイッチ。通常の実行では未設定にする。
  if (process.env.KATAMON_TEST_FORCE_MISSING_SCRIPT === relativePath) {
    throw new Error(`external script not found: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath)) throw new Error(`external script not found: ${relativePath}`);
  // 外部scriptは実ブラウザと同じく CommonJS の `module` / `require` を
  // 持たない環境で評価する。Phase 2C からGearのUMD群もindex.html前段へ
  // 接続されるため、Nodeのharness側requireを誤って選ぶと依存解決の基準が
  // ブラウザ本番と食い違う。
  return `(function browserScriptScope() { const module = undefined; const require = undefined;\n${fs.readFileSync(absolutePath, 'utf8')}\n})();`;
}).join('\n;\n');
let code = `${externalPrelude}\n;\n${scriptTags[inlineIndex][2]}`;

// ---- 検証フックを IIFE の内側に差し込む ----
// (本体には残さない。ここで組み立てるだけ。)
const HOOK = `
  globalThis.__kt = {
    units, unitById, localUnit, foeUnit, activeUnit, isLocalTurn, localWon,
    setLocalSeat,
    seat: () => localUnitId,
    projectiles: () => projectiles,
    state: () => ({ gamePhase, matchOver, winner, awaitingResolve, turnCount, activeIndex, turnOrder: turnOrder.slice() }),
    panels: () => __panelLog.slice(),
    drawnText: () => globalThis.__ktTextLog.slice(),
    drawnTextDetails: () => globalThis.__ktTextDrawLog.map(entry => ({ ...entry })),
    resetDrawnText: () => {
      globalThis.__ktTextLog.length = 0;
      globalThis.__ktTextDrawLog.length = 0;
    },
    resetPanels: () => { __panelLog.length = 0; },
    render: () => render(),
    // 描く細かさ(v131)。画面の実画素とキャンバスの画素が一致しているかを見る。
    resizeForTest: (w, h, dpr) => {
      window.innerWidth = w; window.innerHeight = h; window.devicePixelRatio = dpr;
      resize();
      const cssW = parseFloat(canvas.style.width);
      const cssH = parseFloat(canvas.style.height);
      return {
        cssW, cssH,
        canvasW: canvas.width, canvasH: canvas.height,
        画面の実画素W: Math.round(cssW * dpr),
        画面の実画素H: Math.round(cssH * dpr),
        renderScale: canvas.width / VW,
        // 実際にctxへ指示された拡大率。キャンバスの画素数と一致していないといけない。
        transformScaleX: globalThis.__ktTransform ? globalThis.__ktTransform[0] : null,
        transformScaleY: globalThis.__ktTransform ? globalThis.__ktTransform[3] : null
      };
    },
    maxRenderScale: () => MAX_RENDER_SCALE,
    // 描き直しの節約(v129)。焼いた絵を何回作り直したかと、作り直しの合図が立っているか。
    artBuilds: () => ({ sky: skyArtBuilds, terrain: terrainArtBuilds }),
    // タイトルの焼き付け(v132)。未実装の版でもハーネス自体を例外で止めず、
    // テスト結果をFAILとして表示できるよう typeof で包む。
    titleArtInfo: () => typeof titleArtBuilds === 'undefined' ? null : ({
      builds: titleArtBuilds,
      scale: TITLE_ART_SCALE,
      width: titleArtCanvas.width,
      height: titleArtCanvas.height,
      signature: titleArtSignature(),
      menuBuilds: typeof titleMenuArtBuilds === 'undefined' ? null : titleMenuArtBuilds,
      menuCanvases: typeof titleMenuArtCanvases === 'undefined' ? [] : titleMenuArtCanvases.map(canvas => ({
        width: canvas.width, height: canvas.height
      }))
    }),
    // タイトル木板UI(v168)。未実装版でもハーネスを止めず、検査結果として失敗させる。
    titleWoodUiInfo: () => typeof titleWoodUiImages === 'undefined' ? null : ({
      assets: Object.fromEntries(Object.entries(titleWoodUiImages).map(([key, image]) => [key, image.src])),
      board: { ...TITLE_WOOD_BOARD_RECT },
      imageRects: JSON.parse(JSON.stringify(TITLE_WOOD_IMAGE_RECTS)),
      selectionOutline: typeof TITLE_WOOD_SELECTION_OUTLINE === 'undefined'
        ? true : TITLE_WOOD_SELECTION_OUTLINE,
      buttons: {
        cpu: { ...titleVsCpuBtn }, online: { ...titleOnlineBtn },
        tutorial: { ...titleTutorialBtn }, free: { ...titleFreeBtn },
        ranking: { ...titleRankingBtn }, shop: { ...titleShopBtn },
        achievements: { ...titleAchievementsBtn }, soundTest: { ...titleSoundTestBtn },
        update: { ...titleUpdateBtn }
      },
      pages: typeof TITLE_MENU_PAGES === 'undefined' ? [] : TITLE_MENU_PAGES.map(page => ({
        key: page.key,
        items: page.items.map(item => ({ id: item.id, image: item.image, kind: item.kind, button: { ...item.button } }))
      }))
    }),
    setTitleWoodUiReadyForTest: () => {
      if (typeof titleWoodUiImages === 'undefined') return false;
      for (const image of Object.values(titleWoodUiImages)) {
        image.complete = true;
        image.naturalWidth = 1000;
        image.naturalHeight = 800;
      }
      return true;
    },
    setTitleArtReadyForTest: () => {
      if (typeof titleArtBuilds === 'undefined') return false;
      titleIntroStartReady = true;
      titleIntroStartFailed = false;
      titleIntroEndReady = true;
      titleIntroEndFailed = false;
      titleIntroStartImage.complete = true;
      titleIntroStartImage.naturalWidth = 1080;
      titleIntroStartImage.naturalHeight = 1918;
      titleIntroEndImage.complete = true;
      titleIntroEndImage.naturalWidth = 1080;
      titleIntroEndImage.naturalHeight = 1918;
      if (typeof titleWoodUiImages !== 'undefined') {
        for (const image of Object.values(titleWoodUiImages)) {
          image.complete = true;
          image.naturalWidth = 1000;
          image.naturalHeight = 800;
        }
      }
      return true;
    },
    titleIntroInfo: () => ({
      phase: typeof titleIntroPhase === 'undefined' ? '' : titleIntroPhase,
      started: typeof titleIntroStarted !== 'undefined' && titleIntroStarted,
      start: typeof titleIntroStartImage === 'undefined' ? '' : titleIntroStartImage.src,
      video: typeof titleIntroVideo === 'undefined' ? '' : titleIntroVideo.src,
      end: typeof titleIntroEndImage === 'undefined' ? '' : titleIntroEndImage.src,
      videoFailed: typeof titleIntroVideoFailed !== 'undefined' && titleIntroVideoFailed
    }),
    startTitleIntroForTest: () => typeof startTitleIntroSequence === 'function' && startTitleIntroSequence(),
    terrainArtDirty: () => terrainArtDirty,
    rebuildTerrainRimForTest: () => rebuildTerrainRim(),
    rebuildBridgeForTest: () => rebuildBridgeDecoration(),
    rebuildArenaDecoForTest: () => rebuildArenaDecoration(),
    buildTerrainMaskForTest: () => buildTerrainMask(currentSegments, false),
    carveCraterForTest: (x, y, r) => carveCrater(x, y, r),
    // 縁取りを作り直さない穴あけ。拡散弾と中断からの復元がこの道を通る。
    carveCraterNoRimForTest: (x, y, r) => carveCraterInternal(x, y, r, false),
    setThemeForTest: (key) => { if (THEMES[key]) { currentThemeKey = key; currentTheme = THEMES[key]; } },
    setParallaxSeedForTest: (v) => { parallaxSeed = v; },
    skyArtSignature: () => skyArtSignature(),
    appearanceForTest: () => ({
      themeKey: currentThemeKey,
      theme: { ...currentTheme, sky: currentTheme.sky.slice() },
      custom: currentCustomAppearance ? JSON.parse(JSON.stringify(currentCustomAppearance)) : null,
      usesOfficialThemeObject: currentTheme === THEMES[currentThemeKey]
    }),
    step: (dt) => update(dt),
    // Real production path: Phase 2C tests use this to prove an active run
    // blocks a second CPU start.
    startBattle: (key) => selectCharacterAndStart(key || CHARACTER_LIST[0]),
    // The historic regression file contains many independent CPU scenarios in
    // one in-memory harness.  This test-only fixture resets only the tiny CPU
    // Gear run key before each isolated scenario; it does not exist in the
    // shipped game and never weakens the production active-run guard.
    startFreshBattleForLegacyRegression: (key) => {
      try { globalThis.KatamonGearCpuRunStorage.removeCpuGearRunState(localStorage); } catch (_) {}
      return selectCharacterAndStart(key || CHARACTER_LIST[0]);
    },
    newTerrainForTest: (pattern) => {
      newTerrain(pattern);
      return {
        pattern: currentPattern,
        themeKey: currentThemeKey,
        material: currentTerrainMaterial,
        materialSegments: currentTerrainMaterialSegments.map(column => column.map(segment => segment.slice()))
      };
    },
    // v209: CPU BATTLE の連戦で、相手とステージ種別を直前から必ず引き直す。
    // 乱数を0へ固定して、旧実装でも例外で止まらず「同じまま」を検出できるようにする。
    cpuBattleRematchForTest: () => {
      if (typeof prepareNextCpuBattleRound !== 'function') return null;
      const savedRandom = Math.random;
      try {
        Math.random = () => 0;
        online = null;
        battleMode = 'normal';
        winStreak = 0;
        selectedCustomAdapter = null;
        setMatchFormat('1v1');
        player.character = 'kyoryu';
        cpu.character = 'kyoryu';
        newTerrain('plateauLeft');
        resetMatch(true);
        return { cpu: cpu.character, pattern: currentPattern };
      } finally {
        Math.random = savedRandom;
      }
    },
    cpuBossRoundForTest: () => {
      const savedRandom = Math.random;
      try {
        Math.random = () => 0;
        online = null;
        battleMode = 'normal';
        winStreak = 10;
        selectedCustomAdapter = null;
        setMatchFormat('1v1');
        player.character = 'kyoryu';
        cpu.character = 'iwa';
        resetMatch(true);
        return { isBoss: isBossMatch, pattern: currentPattern, cpu: { hp: cpu.hp, maxHp: cpu.maxHp, specialCharge: cpu.specialCharge } };
      } finally {
        Math.random = savedRandom;
      }
    },
    setTerrain: (pattern) => { newTerrain(pattern); },
    setFlatTerrainForTest: (surface = 420) => {
      const y = Math.max(0, Math.min(TERRAIN_BOTTOM_Y - 60, Number(surface)));
      const segments = Array.from({ length: TERRAIN_COLS }, () => [[y, TERRAIN_BOTTOM_Y]]);
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
    },
    coopSteelStageForTest: () => {
      setStageDimensions(2160, 960);
      loadCoopBossTerrain();
      const platformCenters = COOP_PLATFORM_LAYOUT.map(platform => {
        const x = STAGE_W * ((platform.start + platform.end) / 2);
        return { x, y: groundYAt(x), spawnSteel: platform.spawnSteel };
      });
      const segmentIsSteel = (columnIndex, segment) => (currentTerrainMaterialSegments[columnIndex] || []).some(material => (
        material[2] === 'steel' && material[0] <= segment[0] && material[1] >= segment[1]
      ));
      const steelEveryGround = currentSegments.every((column, columnIndex) => (
        column.some(segment => segment[0] === coopBossGroundY() && segment[1] === TERRAIN_BOTTOM_Y
          && segmentIsSteel(columnIndex, segment))
      ));
      const platformSteel = platformCenters.map(platform => {
        const columnIndex = Math.max(0, Math.min(TERRAIN_COLS - 1, Math.floor(platform.x / COL_W)));
        const segment = currentSegments[columnIndex].find(entry => entry[0] < coopBossGroundY());
        return !!segment && segmentIsSteel(columnIndex, segment);
      });
      const spawnSampleY = platformCenters[0].y + 6;
      const destructibleSampleY = platformCenters[4].y + 6;
      const spawnSolidBefore = isSolidAt(platformCenters[0].x, spawnSampleY);
      const destructibleSolidBefore = isSolidAt(platformCenters[4].x, destructibleSampleY);
      carveCraterInternal(platformCenters[0].x, platformCenters[0].y, 44, true);
      carveCraterInternal(platformCenters[4].x, platformCenters[4].y, 44, true);
      return {
        stageW: STAGE_W,
        stageH: STAGE_H,
        terrainCols: TERRAIN_COLS,
        groundY: groundYAt(STAGE_W * 0.9),
        platformCenters,
        platformColumnCount: currentSegments.filter(column => column.length > 1).length,
        steelEveryGround,
        platformSteel,
        spawnPlatformIntact: spawnSolidBefore && isSolidAt(platformCenters[0].x, spawnSampleY),
        destructiblePlatformOpened: destructibleSolidBefore && !isSolidAt(platformCenters[4].x, destructibleSampleY),
      };
    },
    coopBossJumpLandingForTest: (ownerX = 760, bossX = 1180, bossY = 532, impactX = 1030, impactY = 430, terrainHit = false, directBossHit = true) => {
      const owner = { id: 'jump-owner', x: ownerX, y: 532, hp: 100, team: 'player' };
      const boss = { id: COOP_BOSS_UNIT_ID, x: bossX, y: bossY, hp: 1870, team: 'cpu' };
      const projectile = { vy: terrainHit ? 80 : 0, prevY: terrainHit ? impactY - 4 : impactY };
      const landing = coopBossJumpLandingForImpact(
        owner, boss, impactX, impactY, projectile, terrainHit, directBossHit
      );
      return landing ? {
        ...landing,
        bossRect: coopBossRect(boss),
        distance: distanceToCoopBossBody(boss, landing.x, landing.y),
        clearance: COOP_BOSS_JUMP_CLEARANCE
      } : null;
    },
    coopBossTerrainTeleportForTest: () => {
      setStageDimensions(1440, 660);
      const segments = Array.from({ length: TERRAIN_COLS }, () => [[548, TERRAIN_BOTTOM_Y]]);
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
      setMatchFormat('coop4v1');
      localUnitId = 'p1';
      player.x = 760; player.y = 532; player.hp = player.maxHp; player.grounded = true; player.moveLockTurns = 0;
      coopBossUnit.x = 1180; coopBossUnit.y = 532; coopBossUnit.hp = coopBossUnit.maxHp;
      const projectile = { owner: player.id, jump: true, prevX: 1176, prevY: 544, vy: 80 };
      teleportOwnerToImpact(projectile, coopBossUnit.x, 548, true, null);
      return {
        x: player.x,
        y: player.y,
        grounded: player.grounded,
        jumpConsumed: projectile.jump === false,
        bossRect: coopBossRect(coopBossUnit),
        distance: distanceToCoopBossBody(coopBossUnit, player.x, player.y),
        clearance: COOP_BOSS_JUMP_CLEARANCE
      };
    },
    coopCoreNormalProjectileForTest: () => {
      setStageDimensions(1440, 660);
      const segments = Array.from({ length: TERRAIN_COLS }, () => [[548, TERRAIN_BOTTOM_Y]]);
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
      setMatchFormat('coop4v1');
      matchOver = false;
      winner = null;
      projectiles.length = 0;
      wind.dir = 0;
      wind.strength = 0;

      const owner = unitById('p1');
      const boss = unitById(COOP_BOSS_UNIT_ID);
      owner.x = 100;
      owner.y = 548 - UNIT_RADIUS;
      owner.hp = owner.maxHp;
      boss.x = 760;
      boss.y = 548 - UNIT_RADIUS;
      boss.maxHp = 2200;
      boss.hp = boss.maxHp;
      boss.phase = 1;
      const api = coopBossLiveApi();
      boss.bossState = api.exposeLiveCore(
        api.createLiveState({ bodyMaxHp: boss.maxHp, difficulty: 'normal' }),
        'parts'
      );
      const rect = coopBossRect(boss);
      const core = api.LIVE_CORE_SHAPE;
      const coreX = rect.x + rect.width * core.x;
      const coreY = rect.y + rect.height * core.y;
      fireProjectile(owner.id, { x: rect.x - 60, y: coreY }, 480, 0, {
        radius: 5,
        blastMul: 1,
        terrainBlastMul: 0,
        damageMul: 1,
        gravityMul: 0,
        windMul: 0,
        noTerrain: true,
      });
      const shot = projectiles[0];
      const nonPiercing = shot?.pierce === false;
      const beforeHp = boss.hp;
      for (let step = 0; step < 240 && projectiles.length; step++) stepWorldPhysics(PHYSICS_DT);
      const coreDamage = beforeHp - boss.hp;

      // COREを外した通常弾まで要塞を素通りしないことも、同じ実弾経路で固定する。
      projectiles.length = 0;
      boss.hp = boss.maxHp;
      fireProjectile(owner.id, { x: rect.x - 60, y: rect.y + rect.height * 0.9 }, 480, 0, {
        radius: 5,
        blastMul: 1,
        terrainBlastMul: 0,
        damageMul: 1,
        gravityMul: 0,
        windMul: 0,
        noTerrain: true,
      });
      const offTargetBeforeHp = boss.hp;
      for (let step = 0; step < 240 && projectiles.length; step++) stepWorldPhysics(PHYSICS_DT);
      return {
        nonPiercing,
        coreX,
        coreY,
        projectileConsumed: projectiles.length === 0,
        bodyDamage: coreDamage,
        expectedCoreDamage: 90,
        offTargetDamage: offTargetBeforeHp - boss.hp,
        expectedHullDamage: 30,
        coreStillExposed: boss.bossState?.core?.exposed === true,
      };
    },
    coopItemTargetAllowedForTest: (itemId, hp, team = 'player', id = 'ally') => {
      const owner = localUnit();
      return coopItemCanImpactTarget(
        { owner: owner.id, coopItemId: itemId },
        { id, team, hp, maxHp: 100 }
      );
    },
    coopRescueFlightThroughBossForTest: () => {
      setStageDimensions(1440, 660);
      const segments = Array.from({ length: TERRAIN_COLS }, () => [[548, TERRAIN_BOTTOM_Y]]);
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
      setMatchFormat('coop4v1');
      matchOver = false;
      projectiles.length = 0;
      wind.dir = 0;
      wind.strength = 0;

      const owner = unitById('p1');
      const livingAlly = unitById('e1');
      const downedAlly = unitById('p2');
      const spareAlly = unitById('e2');
      const boss = unitById(COOP_BOSS_UNIT_ID);
      const place = (unit, x, hp) => {
        unit.x = x;
        unit.y = 548 - UNIT_RADIUS;
        unit.hp = hp;
        unit.grounded = true;
        unit.vy = 0;
      };
      place(owner, 100, owner.maxHp);
      place(livingAlly, 360, livingAlly.maxHp);
      place(spareAlly, 470, spareAlly.maxHp);
      place(boss, 760, boss.maxHp);
      place(downedAlly, 1100, 0);
      owner.coopItem = 'rescue-kit';
      owner.coopItemUsesLeft = 1;

      const launched = launchCoopItemShot(owner, { x: owner.x, y: owner.y - UNIT_HIT_RISE }, 720, 0, 'rescue-kit');
      const projectile = projectiles[0];
      if (projectile) {
        // 対象選別だけを決定的に検証するため、実弾を水平・無風に固定する。
        // 移動・当たり判定・着弾解決は本番と同じ stepWorldPhysics を通す。
        projectile.gravityMul = 0;
        projectile.windMul = 0;
      }
      let passedLivingAllies = false;
      let passedBoss = false;
      for (let step = 0; step < 260 && projectiles.length; step++) {
        stepWorldPhysics(PHYSICS_DT);
        const active = projectiles[0];
        if (!active) break;
        if (active.x > spareAlly.x + UNIT_HIT_RADIUS + active.radius) passedLivingAllies = true;
        const bossRect = coopBossRect(boss);
        if (active.x > bossRect.x + bossRect.width + active.radius) passedBoss = true;
      }
      return {
        launched,
        passedLivingAllies,
        passedBoss,
        projectileConsumed: projectiles.length === 0,
        downedAllyHp: downedAlly.hp,
        livingAllyHp: livingAlly.hp,
        spareAllyHp: spareAlly.hp,
        bossHp: boss.hp,
      };
    },
    cpuStepIsSafe: (u, toX) => cpuStepIsSafe(u, toX),
    placeOnGround: (id, x) => { const u = unitById(id); if (Number.isFinite(x)) u.x = x; initUnitOnGround(u); return { x: u.x, y: u.y }; },
    setUnitPositionForTest: (id, x, y) => {
      const u = unitById(id);
      if (!u) return null;
      if (Number.isFinite(x)) u.x = x;
      if (Number.isFinite(y)) u.y = y;
      return { x: u.x, y: u.y };
    },
    setUnitHpForTest: (id, hp) => {
      const u = unitById(id);
      if (!u || !Number.isFinite(hp)) return null;
      u.hp = Math.max(0, Math.min(u.maxHp, hp));
      return u.hp;
    },
    stageW: () => STAGE_W,
    arenaLayoutForTest: () => {
      const shelves = typeof arenaShelves === 'function'
        ? arenaShelves()
        : (typeof ARENA_SHELVES === 'undefined' ? [] : ARENA_SHELVES);
      return {
        stageHeight: STAGE_H,
        wallBottom: currentPattern === 'tieredBasin'
          ? currentSegments?.[0]?.[0]?.[1] ?? null
          : null,
        shelves: shelves.map(shelf => ({ ...shelf })),
        obstacles: arenaObstacles.map(obstacle => ({
          anchorY: obstacle.anchorY,
          y: obstacle.y
        }))
      };
    },
    arenaWallExtension: () => ARENA_WALL_SKY_EXTENSION,
    arenaWallRatio: () => ARENA_WALL_RATIO,
    isSolidAt: (x, y) => isSolidAt(x, y),
    minCameraZoom: () => MIN_CAMERA_ZOOM,
    controlPanelY: () => CONTROL_PANEL_Y,
    cameraForTest: () => ({
      zoom: cameraZoom,
      x: cameraX,
      y: cameraY,
      visibleWidth: visibleWorldWidth(),
      visibleHeight: visibleWorldHeight(),
      stageTopY: worldToScreenY(0),
      stageBottomY: worldToScreenY(STAGE_H),
      centerWorldX: cameraX + visibleWorldWidth() / 2,
      centerWorldY: cameraY + visibleWorldHeight() / 2,
      sliderValue: cameraSliderValue()
    }),
    setCameraZoomForTest: (zoom) => { cameraZoom = Number(zoom); cameraDistanceSetting = null; },
    setCameraSliderValueForTest: (value) => {
      const slider = cameraSliderRect();
      setCameraZoomFromSlider({
        x: slider.x + slider.w * Number(value),
        y: slider.y
      });
    },
    deadLineY: () => DEAD_LINE_Y,
    groundYAt: (x, refY) => walkableGroundYAt(x, refY),
    chars: () => CHARACTER_LIST.slice(),
    deathGate: () => ({ range: DEATH_GATE_RANGE, speed: DEATH_GATE_SPEED, bottomRadius: DEATH_GATE_CARVE_RADIUS_BOTTOM, topRadius: DEATH_GATE_CARVE_RADIUS_TOP, curvePower: DEATH_GATE_CARVE_CURVE_POWER, stride: DEATH_GATE_CARVE_STRIDE, startDepth: DEATH_GATE_START_DEPTH }),
    character: key => ({ ...CHARACTERS[key] }),
    defenseMultiplierForTest: key => CHARACTERS[key]?.damageTakenMul || 1,
    shotPhysicsProfileForTest: (key, useSpecial, useJump) => {
      const def = CHARACTERS[key];
      // v135より前にも検査だけを先に差し込み、壊れた実装で落ちることを確認できるようにする。
      if (typeof shotPhysicsProfile === 'function') return { ...shotPhysicsProfile(def, !!useSpecial, !!useJump) };
      return {
        blastMul: def.blastMul || 1,
        windMul: def.windMul || 1,
        gravityMul: def.gravityMul || 1,
        velScaleMul: def.velScaleMul || 1,
        guideMul: def.guideMul || 1,
        tBias: def.tBias || 1
      };
    },
    launchVelocityForTest: (key, dx, dy, useSpecial, useJump) => (
      computeLaunchVelocity(dx, dy, CHARACTERS[key], !!useSpecial, !!useJump)
    ),
    projectileProfilesForTest: () => projectiles.map(p => ({
      x: p.x,
      y: p.y,
      owner: p.owner,
      radius: p.radius,
      blastMul: p.blastMul, windMul: p.windMul, gravityMul: p.gravityMul,
      terrainBlastMul: p.terrainBlastMul,
      knockbackSpeed: p.knockbackSpeed,
      normalImpactSound: !!p.normalImpactSound,
      noTerrain: !!p.noTerrain,
      ignoreObstacles: !!p.ignoreObstacles,
      lightning: !!p.lightning,
      directHitOnly: !!p.directHitOnly,
      groundFlame: !!p.groundFlame,
      pierce: !!p.pierce,
      prismBeam: !!p.prismBeam,
      prismBounces: Number(p.prismBounces || 0),
      prismMaxBounces: Number(p.prismMaxBounces || 0),
      prismMaxDistance: Number(p.prismMaxDistance || 0),
      travelDistance: Number(p.travelDistance || 0),
      deathGateScythe: !!p.deathGateScythe,
      deathGateCarves: Number(p.deathGateCarves || 0),
      maxDistance: Number(p.maxDistance || 0),
      dSmash: !!p.dSmash,
      barucopterMarker: !!p.barucopterMarker,
      barucopterBullet: !!p.barucopterBullet,
      coolKaiOnigiri: !!p.coolKaiOnigiri,
      coolKaiRotation: Number(p.coolKaiRotation || 0),
      coolKaiDelay: Number(p.coolKaiDelay || 0),
      scorpionRail: !!p.scorpionRail,
      scorpionRailActive: !!p.scorpionRailActive,
      vx: p.vx,
      vy: p.vy,
      dSmashDrilling: !!p.dSmashDrilling,
      dSmashBlasts: Number(p.dSmashBlasts || 0),
      drainHeal: !!p.drainHeal,
      damageMul: p.damageMul
    })),
    barucoptersForTest: () => typeof barucopters === 'undefined'
      ? []
      : barucopters.map(b => ({ ...b })),
    startBarucopterForTest: (index, x, y) => {
      const p = projectiles[index];
      if (!p || typeof startBarucopterBarrage !== 'function') return null;
      const started = startBarucopterBarrage(p, x, y);
      if (started) projectiles.splice(index, 1);
      return started ? { ...barucopters[barucopters.length - 1] } : null;
    },
    stepBarucoptersForTest: seconds => {
      if (typeof stepBarucopters !== 'function') return false;
      const steps = Math.ceil(Math.max(0, Number(seconds) || 0) / PHYSICS_DT);
      for (let i = 0; i < steps; i++) stepBarucopters(PHYSICS_DT);
      return true;
    },
    dSmashConfigForTest: () => typeof D_SMASH_DRILL_BLASTS === 'undefined'
      ? null
      : {
          blasts: D_SMASH_DRILL_BLASTS.slice(),
          stride: D_SMASH_DRILL_STRIDE
        },
    scorpionRailConfigForTest: () => typeof SCORPION_RAIL_SPEED === 'undefined'
      ? null
      : {
          speed: SCORPION_RAIL_SPEED,
          range: SCORPION_RAIL_RANGE,
          carveRadius: SCORPION_RAIL_CARVE_RADIUS,
          damage: SCORPION_RAIL_DAMAGE,
          waveWidth: typeof SCORPION_RAIL_WAVE_WIDTH === 'undefined' ? 0 : SCORPION_RAIL_WAVE_WIDTH,
          trailLength: typeof SCORPION_RAIL_TRAIL_LENGTH === 'undefined' ? 0 : SCORPION_RAIL_TRAIL_LENGTH
        },
    scorpionRailSpikeConfigForTest: () => typeof SCORPION_RAIL_SPIKE_COUNT === 'undefined'
      ? null
      : {
          count: SCORPION_RAIL_SPIKE_COUNT,
          life: SCORPION_RAIL_SPIKE_LIFE,
          height: SCORPION_RAIL_SPIKE_HEIGHT
        },
    startScorpionRailForTest: (index, x, y, direction = null) => {
      const p = projectiles[index];
      if (!p || typeof startScorpionRail !== 'function') return null;
      const movedEnemies = [];
      if (direction === 1 || direction === -1) {
        const ownerTeam = teamOfOwner(p.owner);
        for (const unit of units) {
          if (unit.team === ownerTeam) continue;
          movedEnemies.push({ unit, x: unit.x });
          unit.x = x + direction * 240;
        }
      }
      startScorpionRail(p, x, y);
      if ((direction === 1 || direction === -1) && p.railTangentX * direction < 0) {
        p.railTangentX *= -1;
        p.railTangentY *= -1;
        p.vx = p.railTangentX * SCORPION_RAIL_SPEED;
        p.vy = p.railTangentY * SCORPION_RAIL_SPEED;
      }
      for (const saved of movedEnemies) saved.unit.x = saved.x;
      return { active: !!p.scorpionRailActive, vx: p.vx, vy: p.vy, pierce: !!p.pierce };
    },
    setScorpionRailStepTerrainForTest: (wallX = 620, floorY = 420, topY = 320) => {
      const segments = Array.from({ length: TERRAIN_COLS }, (_, c) => {
        const x = (c + 0.5) * COL_W;
        return [[x >= wallX ? topY : floorY, TERRAIN_BOTTOM_Y]];
      });
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
      return { wallX, floorY, topY };
    },
    advanceScorpionRailForTest: (index, distance) => {
      const p = projectiles[index];
      if (!p || typeof advanceScorpionRailSurface !== 'function') return null;
      const moved = advanceScorpionRailSurface(p, distance);
      return {
        moved,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        normalX: p.railNormalX,
        normalY: p.railNormalY,
        attached: typeof scorpionRailHasSupport === 'function' ? scorpionRailHasSupport(p) : false,
        points: (p.railTrail || []).map(point => ({ ...point }))
      };
    },
    vsSpecialTextForTest: key => typeof vsSpecialTextLayout !== 'function'
      ? null
      : vsSpecialTextLayout(CHARACTERS[key]?.special || '', 80),
    groundFlameConfigForTest: () => typeof GROUND_FLAME_TICK_DAMAGE === 'undefined'
      ? null
      : {
          damage: GROUND_FLAME_TICK_DAMAGE,
          ticks: GROUND_FLAME_TICK_COUNT,
          interval: GROUND_FLAME_TICK_INTERVAL
        },
    groundFlamesForTest: () => typeof groundFlames === 'undefined'
      ? []
      : groundFlames.map(flame => ({
          x: flame.x,
          y: flame.y,
          delay: flame.delay,
          ticksDone: Number(flame.ticksDone || 0),
          tickTimer: Number(flame.tickTimer || 0)
        })),
    fireSpecialImmediateForTest: (key, vx0, vy0) => {
      const u = localUnit();
      applyCharacter(u, key);
      launchShot(u, { ...unitAnchor(u) }, vx0, vy0, true, true, false);
      return projectiles.length - 1;
    },
    fireSpecialImmediateForUnitForTest: (id, key, vx0, vy0) => {
      const u = unitById(id);
      if (!u) return -1;
      applyCharacter(u, key);
      launchShot(u, { ...unitAnchor(u) }, vx0, vy0, true, true, false);
      return projectiles.length - 1;
    },
    fireSpecialWithHpForTest: (key, hp, vx0, vy0) => {
      const u = localUnit();
      applyCharacter(u, key);
      u.hp = Math.max(0, Math.min(u.maxHp, Number(hp)));
      launchShot(u, { ...unitAnchor(u) }, vx0, vy0, true, true, false);
      return projectiles.length - 1;
    },
    spawnDeathGateForTest: (ownerId, x, y) => {
      if (typeof spawnDeathGate !== 'function') return -1;
      spawnDeathGate({ owner: ownerId }, x, y);
      return projectiles.length - 1;
    },
    resolveProjectileUnitImpactForTest: (index, unitId) => {
      const p = projectiles[index];
      const target = unitById(unitId);
      if (!p || !target) return false;
      if (p.prismBeam && typeof resolvePrismBeamUnitImpact === 'function') {
        resolvePrismBeamUnitImpact(p, target);
      } else if (p.coolKaiOnigiri && typeof resolveCoolKaiOnigiriUnitImpact === 'function') {
        resolveCoolKaiOnigiriUnitImpact(p, target, p.x, p.y);
      } else if (p.scorpionRail && typeof resolveScorpionRailImpact === 'function') {
        resolveScorpionRailImpact(p, target);
      } else if (p.barucopterBullet && typeof resolveBarucopterBulletUnitImpact === 'function') {
        resolveBarucopterBulletUnitImpact(p, target, p.x, p.y);
      } else if (typeof resolveProjectileUnitImpact === 'function') {
        resolveProjectileUnitImpact(p, target, p.x, p.y);
      } else {
        explodeAt(p.x, p.y, p.blastMul, p.owner, p.damageMul, p.normalImpactSound);
      }
      return true;
    },
    resolveProjectileSurfaceImpactForTest: (index, x, y) => {
      const p = projectiles[index];
      if (!p) return false;
      if (typeof resolveProjectileSurfaceImpact === 'function') {
        resolveProjectileSurfaceImpact(p, x, y);
      } else {
        explodeAt(x, y, p.blastMul, p.owner, p.damageMul, p.normalImpactSound);
      }
      return true;
    },
    resolveBarucopterBulletSurfaceImpactForTest: (index, x, y) => {
      const p = projectiles[index];
      if (!p || !p.barucopterBullet || typeof resolveBarucopterBulletSurfaceImpact !== 'function') return false;
      resolveBarucopterBulletSurfaceImpact(p, x, y);
      return true;
    },
    impactVisualCountsForTest: () => ({
      explosions: particles.length,
      lightningRemnants: lightningBeams.length,
      groundFlames: typeof groundFlames === 'undefined' ? 0 : groundFlames.length,
      scorpionRailSpikes: typeof scorpionRailSpikeBursts === 'undefined' ? 0 : scorpionRailSpikeBursts.length
    }),
    drawScorpionRailImpactSpikesForTest: () => {
      if (typeof drawScorpionRailImpactSpikes !== 'function') return false;
      for (const spike of scorpionRailSpikeBursts) {
        spike.age = spike.delay + spike.maxAge * 0.2;
      }
      drawScorpionRailImpactSpikes();
      return true;
    },
    resolveGroundFlameImpactForTest: (index, x, y) => {
      const p = projectiles[index];
      if (!p || typeof resolveGroundFlameImpact !== 'function') return null;
      return resolveGroundFlameImpact(p, x, y).map(point => ({ ...point }));
    },
    detonateProjectileForTest: (index, x, y) => {
      const p = projectiles[index];
      if (!p) return false;
      explodeAt(x, y, p.blastMul, p.owner, p.damageMul, p.normalImpactSound, p.drainHeal, p.terrainBlastMul, p.knockbackSpeed);
      return true;
    },
    updateFallingForTest: (id, dt) => {
      const u = unitById(id);
      if (!u) return null;
      updateFalling(dt, u);
      return { x: u.x, y: u.y, vy: u.vy, grounded: u.grounded, knockbackVx: u.knockbackVx || 0 };
    },
    clearProjectilesForTest: () => {
      projectiles.length = 0;
      if (typeof barucopters !== 'undefined') barucopters.length = 0;
    },
    deathGateTestX: () => {
      for (let x = Math.round(STAGE_W * 0.2); x <= Math.round(STAGE_W * 0.8); x += 12) {
        const y = groundYAt(x);
        // surfaceY が FLOOR_Y でなければ、その列には着弾できる地面がある。
        if (y >= DEAD_LINE_Y) continue;
        // 鎌の幅(約34px)とユニット判定より十分離しつつ、谷が広い地形でも候補を確保する。
        if (units.every(u => Math.abs(u.x - x) > 80)) return x;
      }
      return STAGE_W / 2;
    },
    fireDeathGateForTest: (x) => {
      const u = localUnit();
      const targetX = Number.isFinite(x) ? x : STAGE_W / 2;
      applyCharacter(u, 'shinigami');
      launchShot(u, { x: targetX, y: Math.max(0, groundYAt(targetX) - 84) }, 0, 320, true, true);
    },
    // 固定刻み検証用。狙いをUIから作らず、初速をそのまま与えて撃つ。
    // unitId を省くと自席から撃つが、席によって位置が変わるので検証では明示すること。
    fireForTest: (vx0, vy0, opts = {}) => {
      const u = opts.unitId ? unitById(opts.unitId) : localUnit();
      launchShot(u, { ...unitAnchor(u) }, vx0, vy0, !!opts.useSpecial, false, !!opts.useJump);
    },
    setAwaitingResolveForTest: value => { awaitingResolve = value === true; return awaitingResolve; },
    awaitingResolveForTest: () => awaitingResolve,
    setGamePhaseForTest: value => { gamePhase = value; return gamePhase; },
    physicsDt: () => PHYSICS_DT,
    unitRadius: () => UNIT_RADIUS,
    terrainBottomY: () => TERRAIN_BOTTOM_Y,
    groundBand: () => ({ min: GROUND_MIN_Y, max: GROUND_MAX_Y }),
    // CPUは照準に乱数を混ぜるので、決定性の検証中は行動させない。
    disableCpuForTest: () => { for (const u of units) u.control = 'local'; },
    setCharactersForTest: (p1Key, e1Key) => {
      applyCharacter(unitById('p1'), p1Key);
      applyCharacter(unitById('e1'), e1Key || p1Key);
    },
    setCharacterForUnitForTest: (unitId, characterId) => {
      const unit = unitById(unitId);
      if (!unit || !CHARACTER_LIST.includes(characterId)) return false;
      applyCharacter(unit, characterId);
      return unit.character;
    },
    // 素材の向きを加味した「世界で左を向いているか」。描画が使う式と同じもの。
    facesLeftInWorld: (id) => unitFacesLeftInWorld(unitById(id)),
    carveForTest: (x, y, r) => carveCrater(x, y, r),
    resetPhysicsClock: () => resetPhysicsClock(),
    selectWheelCards: () => {
      const cards = getRenderedSelectCards();
      const focused = cards.find(card => card.focused);
      return {
        total: CHARACTER_LIST.length,
        rendered: cards.length,
        focused: !!focused,
        focusedKey: focused ? focused.key : null
      };
    },
    // v147: 見た目の意図を色コードの偶然一致ではなく、素材の役割として固定する。
    // 実装前にもハーネス自体は止めず、検査結果をFAILとして出せるようtypeofで包む。
    selectCardPresentation: () => typeof SELECT_CARD_PRESENTATION === 'undefined'
      ? null
      : { ...SELECT_CARD_PRESENTATION },
    // v171: キャラ選択の見出しと、出撃ギアへ噛み合わせる中断再開ギア。
    // 旧実装へ検査だけを先に入れても例外で止まらず、FAILとして数が出るようにする。
    selectScreenInfo: () => ({
      heading: typeof SELECT_SCREEN_HEADING === 'undefined' ? null : SELECT_SCREEN_HEADING,
      headingY: typeof SELECT_SCREEN_HEADING_Y === 'undefined' ? null : SELECT_SCREEN_HEADING_Y,
      headingFontSize: typeof SELECT_SCREEN_HEADING_FONT_SIZE === 'undefined' ? null : SELECT_SCREEN_HEADING_FONT_SIZE,
      sortie: {
        ...selectSortieBtn,
        outerRadius: typeof SELECT_SORTIE_OUTER_RADIUS === 'undefined' ? null : SELECT_SORTIE_OUTER_RADIUS
      },
      resume: {
        ...resumeBtn,
        outerRadius: typeof SELECT_RESUME_OUTER_RADIUS === 'undefined' ? null : SELECT_RESUME_OUTER_RADIUS
      }
    }),
    selectResumeHitForTest: (x, y) => typeof hitSelectResumeGear === 'function'
      ? hitSelectResumeGear({ x, y })
      : hitRect({ x, y }, resumeBtn),
    drawSelectForTest: (withSave) => {
      gamePhase = 'select';
      hasSuspendedSave = !!withSave;
      globalThis.__ktTextLog.length = 0;
      globalThis.__ktTextDrawLog.length = 0;
      drawCharacterSelect();
      return globalThis.__ktTextLog.slice();
    },
    hud: () => ({
      fireActive: isLocalTurn() && !awaitingResolve && !matchOver && !cutIn && localUnit().grounded,
      moveActive: isLocalTurn() && localUnit().moveLockTurns <= 0 && !awaitingResolve && !matchOver && !cutIn,
      turnLabel: turnCutInLines(activeUnit()).short,
      fuelRatio: localUnit().fuelMax > 0 ? localUnit().fuel / localUnit().fuelMax : 0
    }),
    fireBtn: () => ({ ...FIRE_BTN }),
    moveBtns: () => ({ left: { ...leftBtn }, right: { ...rightBtn } }),
    hasCutIn: () => !!cutIn,
    matchupCutIn: () => cutIn && cutIn.kind === 'matchup' ? {
      kind: cutIn.kind,
      duration: cutIn.duration,
      left: cutIn.left.map(entry => ({ ...entry })),
      right: cutIn.right.map(entry => ({ ...entry }))
    } : null,
    showBattleStartCutInForTest: () => showBattleStartCutIn(),
    // 素材が届いていない端末を再現する(画像を持たない状態にする)。
    dropImagesForTest: () => {
      for (const key of Object.keys(charImages)) charImages[key] = null;
      for (const key of Object.keys(vsPlateImages)) vsPlateImages[key] = null;
    },
    // v123: 砲弾ネームプレートのVSカットイン
    vsPlate: () => ({
      slots: JSON.parse(JSON.stringify(VS_PLATE_SLOTS)),
      srcs: Object.fromEntries(Object.entries(vsPlateImages).map(([k, img]) => [k, img.src.split('/').pop()])),
      flySec: VS_FLY_SEC, exitSec: VS_EXIT_SEC, plateW: VS_PLATE_W, tilt: VS_TILT, duration: MATCHUP_CUTIN_DURATION,
      faces: JSON.parse(JSON.stringify(MATCHUP_FACES))
    }),
    forceWinner: (team) => { winner = team; matchOver = true; },
    // ---- v126: チュートリアル ----
    startTutorialForTest: () => startTutorial(),
    tutorialState: () => (tutorial ? {
      active: tutorialActive(), stepIndex: tutorial.stepIndex,
      key: TUTORIAL_STEPS[tutorial.stepIndex] && TUTORIAL_STEPS[tutorial.stepIndex].key,
      cleared: tutorial.cleared, stepShots: tutorial.stepShots,
      turnOrder: turnOrder.slice(), foeHp: unitById('e1').hp, meX: player.x
    } : null),
    tutorialSteps: () => TUTORIAL_STEPS.map(step => ({
      key: step.key, title: step.title, body: step.body.slice(), hint: step.hint,
      hasSetup: typeof step.setup === 'function', hasCleared: typeof step.cleared === 'function'
    })),
    tutorialGoto: (key) => {
      tutorial.stepIndex = TUTORIAL_STEPS.findIndex(step => step.key === key);
      applyTutorialStep();
    },
    // チュートリアルの実際の発射経路。必殺の保留演出とターン解決待ちまで通す。
    tutorialFireSpecialForTest: (vx0, vy0) => {
      const u = localUnit();
      launchShot(u, { ...unitAnchor(u) }, vx0, vy0, true, false, false);
      awaitingResolve = true;
    },
    tutorialHurtDummy: (amount) => { unitById('e1').hp -= amount; },
    tutorialSkipForTest: () => skipTutorial(),
    tutorialRecommended: () => tutorialIsRecommended(),
    tutorialSkipBtn: () => ({ ...tutorialSkipBtn }),
    endTurnForTest: () => endTurn(),
    checkMatchEndForTest: () => checkMatchEnd('テスト'),
    tutorialLedge: () => ({ halfW: TUTORIAL_LEDGE_HALF_W, thickness: TUTORIAL_LEDGE_THICKNESS }),
    setTurnCountForTest: (n) => { turnCount = n; },
    // --- リグレッション用 ---
    snapshot: () => buildSnapshot(),
    save: () => saveSuspendedMatch(),
    load: () => loadSuspendedMatch(),
    apply: (d) => applySnapshot(d),
    wind: () => ({ dir: wind.dir, strength: wind.strength }),
    windForecast: () => (typeof nextWind === 'undefined' || !nextWind ? null : { ...nextWind }),
    setWindCycleForTest: (current, forecast) => {
      wind.dir = current.dir;
      wind.strength = current.strength;
      calmWind = current.calmWind === true;
      if (typeof nextWind === 'undefined') return false;
      nextWind = { ...forecast };
      return true;
    },
    startTurnForTest: () => startTurn(),
    craters: () => craterHistory.length,
    craterHistory: () => craterHistory.map(crater => ({ ...crater })),
    streak: () => winStreak,
    stats: () => ({ ...runStats }),
    pendingScoreForTest: () => pendingScore ? { ...pendingScore } : null,
    mode: () => battleMode,
    freeConfig: () => ({ ...freeModeConfig }),
    freeTrainingOptions: () => (typeof FREE_TRAINING_OPTIONS === 'object'
      ? JSON.parse(JSON.stringify(FREE_TRAINING_OPTIONS))
      : null),
    practiceRulesForTest: () => (typeof freeTrainingRules === 'function' ? freeTrainingRules() : null),
    setFreeTrainingForTest: (values) => {
      if (typeof setFreeTrainingForTest === 'function') return setFreeTrainingForTest(values);
      return null;
    },
    refreshPracticeJumpForTest: (id) => {
      if (typeof refreshPracticeJumpForTest === 'function') return refreshPracticeJumpForTest(id);
      return null;
    },
    jumpTurnRefreshForTest: (id, moveLockTurns = 0) => {
      const unit = unitById(id);
      const next = turnOrder.indexOf(id);
      if (!unit || next < 0) return null;
      const before = activeIndex;
      activeIndex = next;
      unit.jumpAvailable = false;
      unit.moveLockTurns = Math.max(0, Number(moveLockTurns) || 0);
      startTurn();
      const result = {
        refreshed: unit.jumpAvailable === true,
        canUse: unit.jumpAvailable === true && unit.moveLockTurns <= 0,
        moveLockTurns: unit.moveLockTurns,
      };
      activeIndex = before;
      return result;
    },
    startFree: () => { startFreeMatch(); },
    resultTitleBtn: () => ({ ...resultTitleBtn, shift: resultButtonShift() }),
    continueBtn: () => ({ ...continueBtn, shift: resultButtonShift() }),
    cpuGearResultLayoutForTest: () => {
      const layout = typeof cpuGearResultLayout === 'function' ? cpuGearResultLayout() : null;
      if (!layout) return null;
      return {
        pending: layout.pending,
        voluntary: layout.voluntary,
        preview: JSON.parse(JSON.stringify(layout.preview)),
        lossPreview: layout.lossPreview ? JSON.parse(JSON.stringify(layout.lossPreview)) : null,
        continueButton: layout.continueButton ? { ...layout.continueButton, shift: resultButtonShift() } : null,
        settlementButton: { ...layout.settlementButton, shift: resultButtonShift() },
        titleButton: { ...layout.titleButton, shift: resultButtonShift() },
      };
    },
    cpuGearPendingSettlementLayoutForTest: () => {
      const layout = typeof cpuGearPendingSettlementLayout === 'function' ? cpuGearPendingSettlementLayout() : null;
      if (!layout) return null;
      return {
        preview: JSON.parse(JSON.stringify(layout.preview)),
        settlementButton: { ...layout.settlementButton },
        backButton: { ...layout.backButton },
      };
    },
    cpuGearTerminalSettlementRetryLayoutForTest: () => {
      const layout = typeof cpuGearTerminalSettlementRetryLayout === 'function' ? cpuGearTerminalSettlementRetryLayout() : null;
      if (!layout) return null;
      return {
        outcome: layout.outcome,
        preview: JSON.parse(JSON.stringify(layout.preview)),
        retryButton: { ...layout.retryButton, shift: resultButtonShift() },
      };
    },
    cpuGearTerminalSettlementReadErrorLayoutForTest: () => {
      const layout = typeof cpuGearTerminalSettlementReadErrorLayout === 'function' ? cpuGearTerminalSettlementReadErrorLayout() : null;
      return layout ? { retryButton: { ...layout.retryButton, shift: resultButtonShift() } } : null;
    },
    openCpuGearPendingSettlementFromTitleForTest: () => openCpuGearPendingSettlementFromTitle(),
    activateTitleCpuForTest: () => activateTitleMenuItem('cpu'),
    retryCpuGearTerminalSettlementPreparationForTest: () => retryCpuGearTerminalSettlementPreparation(),
    retryCpuGearTerminalSettlementReadForTest: () => retryCpuGearTerminalSettlementRead(),
    cpuGearRunStateForTest: () => {
      try { return typeof readCpuGearRunState === 'function' ? JSON.parse(JSON.stringify(readCpuGearRunState())) : null; }
      catch (error) { return { error: error && error.code ? error.code : String(error) }; }
    },
    // Owner controls exist only in the Node harness so the concurrency suite
    // can model two isolated browser runtimes against one localStorage.
    cpuGearOwnerSessionForTest: () => cpuGearOwnerSessionId,
    setCpuGearOwnerSessionForTest: (value) => { cpuGearOwnerSessionId = value || null; return cpuGearOwnerSessionId; },
    saveCpuBattleAtTurnStartForTest: () => saveCpuBattleAtTurnStart(),
    recordCpuGearPeakAfterWinForTest: () => recordCpuGearPeakAfterWin(),
    suspendRunToTitleForTest: () => suspendRunToTitle(),
    prepareCpuGearSettlementForTerminalOutcomeForTest: (outcome) => prepareCpuGearSettlementForTerminalOutcome(outcome),
    settleCpuGearRunForTest: (outcome) => settleCpuGearRun(outcome),
    takeOverCpuGearActiveRunOwnershipForTest: () => takeOverCpuGearActiveRunOwnership(),
    clearCpuGearRunForTest: () => {
      try { return globalThis.KatamonGearCpuRunStorage.removeCpuGearRunState(localStorage); }
      catch (_) { return false; }
    },
    resumeCpuSuspendForTest: () => resumeSuspendedMatch(),
    // These two hooks only model separate browser runtimes that both captured
    // the same legacy bytes before entering the shared CPU lifecycle lock.
    // Production callers always use resumeSuspendedMatch().
    captureCpuGearSuspendForTest: () => {
      const snapshot = readCpuGearLegacySuspendForClaim();
      return snapshot ? { key: snapshot.key, raw: snapshot.raw } : null;
    },
    captureCpuGearActiveRunDiscardTokenForTest: () => {
      const token = captureCpuGearActiveRunDiscardToken();
      return token ? JSON.parse(JSON.stringify(token)) : null;
    },
    claimCpuGearSuspendForTest: (expectedSnapshot) => claimCpuGearLegacySuspendForResume(expectedSnapshot),
    cpuGearPersistenceForTest: () => ({ state: cpuGearPersistenceState, status: cpuGearStatusText }),
    cpuBattleGearSnapshotForTest: () => cpuBattleGearSnapshot ? JSON.parse(JSON.stringify(cpuBattleGearSnapshot)) : null,
    cpuGearCritStateForTest: () => cpuGearCritState ? JSON.parse(JSON.stringify(cpuGearCritState)) : null,
    cpuGearStatusStateForTest: () => cpuGearStatusState ? JSON.parse(JSON.stringify(cpuGearStatusState)) : null,
    cpuGearShieldStateForTest: () => cpuGearShieldState ? JSON.parse(JSON.stringify(cpuGearShieldState)) : null,
    cpuGearRuntimeEffectsStateForTest: () => cpuGearRuntimeEffectsState ? JSON.parse(JSON.stringify(cpuGearRuntimeEffectsState)) : null,
    setCpuGearRuntimeEffectsForTest: (effects) => {
      const p1 = unitById('p1'); const combat = cpuGearCombatForUnit(p1);
      if (!cpuGearRuntimeEffectsState || !combat) return null;
      const checked = cpuGearModules().combat.beginAttackAction({ combat, state: effects }).state;
      if (checked.rescueNextAttackDamageBp !== 0) return null;
      cpuGearRuntimeEffectsState = Object.freeze({ ...cpuGearRuntimeEffectsState, effects: checked });
      return JSON.parse(JSON.stringify(cpuGearRuntimeEffectsState));
    },
    beginCpuGearAttackForTest: () => { beginCpuGearAttackAction(unitById('p1')); return cpuGearActiveAttackRuntime ? { ...cpuGearActiveAttackRuntime } : null; },
    completeCpuGearAttackForTest: () => { completeCpuGearAttackAction(unitById('p1')); return cpuGearRuntimeEffectsState ? JSON.parse(JSON.stringify(cpuGearRuntimeEffectsState)) : null; },
    recordCpuGearLastStandDamageForTest: (ownerId, actualDamage, damageType = 'direct_projectile', fromEnemyAttackAction = true) => {
      recordCpuGearLastStandDamage({ ownerId, target: unitById('p1'), actualDamage, damageType, fromEnemyAttackAction });
      return cpuGearRuntimeEffectsState ? JSON.parse(JSON.stringify(cpuGearRuntimeEffectsState)) : null;
    },
    setCpuGearShieldForTest: (value) => {
      if (!cpuGearShieldState || !Number.isFinite(value) || value < 0) return null;
      cpuGearShieldState = Object.freeze({ ...cpuGearShieldState, currentShield: value });
      return cpuGearShieldState.currentShield;
    },
    applyCpuGearHealingForTest: (sourceUnitId, targetUnitId, baseHealing) => {
      const target = unitById(targetUnitId);
      return typeof applyCpuGearHealing === 'function'
        ? applyCpuGearHealing({ sourceUnitId, target, baseHealing })
        : null;
    },
    launchGeneratedSelfHealForTest: (ownerId, amount) => {
      const unit = unitById(ownerId);
      if (!unit || typeof launchGeneratedSpecial !== 'function') return null;
      const before = unit.hp;
      const launched = launchGeneratedSpecial({
        blastMul: 1,
        specialSkill: {
          schemaVersion: 1,
          id: 'healing-test',
          projectile: { count: 1, speedMultiplier: 1, power: 1, gravityMultiplier: 1, penetrationCount: 0 },
          impact: { radiusMultiplier: 1, knockback: 0 },
          selfEffect: { heal: amount }
        }
      }, unit, ownerId, unitAnchor(unit), 0, 0);
      return { launched, actualHealing: unit.hp - before, hp: unit.hp };
    },
    drainExplosionForTest: (ownerId, targetUnitId) => {
      const target = unitById(targetUnitId);
      if (!target) return false;
      explodeAt(target.x, target.y, 1, ownerId, 1, false, true, 1, 0, false, { gearDamageProfile: 'excluded' });
      return true;
    },
    setSubweaponBarrierForTest: (id, active) => { const u = unitById(id); if (!u) return false; u.subweaponBarrierActive = !!active; return u.subweaponBarrierActive; },
    launchSubweaponForTest: (ownerId, subweaponId) => {
      const unit = unitById(ownerId);
      if (!unit) return null;
      unit.subweapon = subweaponId;
      unit.subweaponUsesLeft = 1;
      const beforeCount = projectiles.length;
      launchShot(unit, unitAnchor(unit), 8, -2, false, false, false, subweaponId);
      return {
        active: cpuGearActiveAttackRuntime ? { ...cpuGearActiveAttackRuntime } : null,
        projectileIndex: projectiles.length > beforeCount ? projectiles.length - 1 : -1,
        projectile: projectiles[projectiles.length - 1] ? { ...projectiles[projectiles.length - 1] } : null
      };
    },
    cpuBattleBaseStatsForTest: (characterId) => ({ ...characterBattleBaseStats(characterId) }),
    cpuGearRecoveryPromiseForTest: () => cpuGearRecoveryPromise,
    requestCpuGearSettlementForTest: (outcome) => requestCpuGearSettlement(outcome),
    continueCpuGearRunAfterWinForTest: () => continueCpuGearRunAfterWin(),
    setWinStreakForTest: (value) => { if (Number.isSafeInteger(value) && value >= 0) winStreak = value; return winStreak; },
    cpuGearResultActionBusyForTest: () => cpuGearResultActionInFlight(),
    keepsRunOnExit: () => keepsRunOnExit(),
    endPause: () => matchEndPause,
    hasSave: () => hasSuspendedSave,
    titleCpuButtonSub: () => titleCpuButtonSub(),
    saveBubbleText: () => SAVE_BUBBLE_TEXT,
    saveBubbleRect: (textW) => suspendedSaveBubbleRect(textW),
    saveBubbleTail: (box) => suspendedSaveBubbleTail(box),
    modeLabelY: () => TITLE_MODE_LABEL_Y,
    titleCpuBtn: () => ({ ...titleVsCpuBtn }),
    viewW: () => VW,
    viewH: () => VH,
    setHasSave: (v) => { hasSuspendedSave = !!v; },
    requestNewMatch: (k) => requestNewMatch(k),
    resolveNewMatchConfirm: (a) => resolveNewMatchConfirm(a),
    pendingNewMatch: () => pendingNewMatchKey,
    newMatchBtns: () => ({ resume: { ...newMatchResumeBtn }, start: { ...newMatchStartBtn }, cancel: { ...newMatchCancelBtn } }),
    newMatchTextY: () => ({ title: NEW_MATCH_TITLE_Y, body: NEW_MATCH_BODY_Y.slice() }),
    newMatchPanel: () => ({ ...NEW_MATCH_PANEL }),
    setStreak: (n) => { winStreak = n; },
    isBoss: () => isBossMatch,
    pattern: () => currentPattern,
    // --- オンライン対戦(ループバック)用 ---
    setTransport: (fn) => { makeTransport = fn; },
    beginOnline: (role) => beginOnline(role),
    endOnline: (sendBye) => endOnline(sendBye),
    exitOnlineFromMenu: () => exitOnlineFromMenu(),
    setOnlineKind: (kind) => { if (online) online.kind = kind; },
    onlineState: () => (online ? {
      role: online.role, phase: online.phase, seat: online.seat,
      queued: online.queue.length, peerLeft: online.peerLeft,
      versionMismatch: online.versionMismatch, resultSent: online.resultSent
    } : null),
    inputLocked: () => netInputLocked(),
    pending: () => !!pendingShot,
    specialBtn: () => ({ ...specialBtn }),
    specialReady: () => isSpecialReady(localUnit()),
    specialReadyForTest: (id) => isSpecialReady(unitById(id)),
    charges: () => units.map(u => u.specialCharge),
    fillCharges: () => { for (const u of units) u.specialCharge = SPECIAL_CHARGE_MAX; },
    specialSequenceForTest: () => ({
      phase: pendingShot ? pendingShot.phase || 'cutin' : null,
      auraVisible: !!specialAura,
      flashVisible: specialFlash.timer > 0,
      projectileCount: projectiles.length,
      auraDuration: SPECIAL_AURA_DURATION,
      flashDuration: SPECIAL_FLASH_DURATION
    }),
    specialCutInSoundProfile: () => (typeof SPECIAL_CUTIN_SOUND_PROFILE === 'object'
      ? { ...SPECIAL_CUTIN_SOUND_PROFILE }
      : null),
    specialCutInSoundAsset: () => (typeof SPECIAL_CUTIN_SOUND_URL === 'string'
      ? { url: SPECIAL_CUTIN_SOUND_URL, gain: SPECIAL_CUTIN_SOUND_GAIN }
      : null),
    coolKaiSpecialVoiceAsset: () => (typeof COOL_KAI_SPECIAL_VOICE_URL === 'string'
      ? { url: COOL_KAI_SPECIAL_VOICE_URL, gain: COOL_KAI_SPECIAL_VOICE_GAIN }
      : null),
    characterUnlockForTest: key => ({
      unlocked: typeof isCharacterUnlocked === 'function' ? isCharacterUnlocked(key) : null,
      condition: typeof unlockConditionLabel === 'function' ? unlockConditionLabel(characterUnlock(CHARACTERS[key])) : null,
      progress: typeof characterUnlockProgress === 'object' ? structuredClone(characterUnlockProgress) : null
    }),
    setCharacterUnlockProgressForTest: value => {
      characterUnlockProgress = normalizeUnlockProgress(value);
      saveCharacterUnlockProgress();
    },
    proto: () => PROTO_VERSION,
    stage3: () => ({ normalizeRoomCode, isRoomCode, generateRoomCode, parseFirebaseSse, createSseDeduper, commitPayload, fairFirstPlayer, hasSafeSnapshot, snapshotValidationReason, normalizeFirebaseSnapshot, validateFirebaseMessage, validateFirebaseMessageDetail, acceptPeerCommit, acceptPeerReveal, firebaseActionMatches, bufferFirebaseTerminal, firebaseFlowAllows, stateSnapshotMatchesBaseline, stateSnapshotMismatchReason, coopPhase2BossHpEligible, coopPhase2ExpectedWind, firebasePushId, stableFirebaseJson, normalizeFirebaseMessageForCompare, createSerialSendQueue, advanceFirebasePendingVisibleTime, advanceFirebasePeerLiveness, resetFirebasePeerLiveness, advanceFirebaseLobbyLiveness, firebaseSeatStale, onlineErrorTitle, canLeaveFirebaseLobby, estimateFirebaseServerNow, firebaseServerTimeOffsetFromToken,
      computeDamage, roomTtlMs: () => ROOM_TTL_MS, roomLeaseRenewMs: () => ROOM_LEASE_RENEW_MS,
      firebaseProto: () => FIREBASE_PROTO_VERSION, firebaseSeats: () => FIREBASE_SEATS.slice(), firebasePlayerSeats: () => FIREBASE_PLAYER_SEATS.slice(), firebaseRoundId, normalizeLobbySettings, firebasePacketSeatAllowed,
      receiveFirebaseForTest: msg => netReceiveInner(msg),
      drainOneNetworkMessageForTest: () => {
        if (!online?.queue?.length) return false;
        applyNetMessage(online.queue.shift().msg);
        return true;
      },
      resolveRemoteActionForTest: () => {
        if (!online?.remoteAction) return false;
        online.remoteAction.resolved = true;
        return true;
      },
      setUnitControlForTest: (unitId, control) => {
        const unit = unitById(unitId);
        if (!unit || (control !== 'local' && control !== 'remote')) return false;
        unit.control = control;
        return true;
      },
      firebaseReentryForTest: () => ({
        api: () => firebaseReentryApi(),
        storageKey: () => firebaseReentryApi().FIREBASE_REENTRY_STORAGE_KEY,
        loadCredential: storage => loadFirebaseReentryCredential(storage),
        saveCredential: (record, storage) => saveFirebaseReentryCredential(record, storage),
        clearCredential: storage => clearFirebaseReentryCredential(storage),
        createCredential: options => createFirebaseReentryCredential(options),
        restore: options => restoreFirebaseRoomSeatReentry(options),
        createRoom: (...args) => createFirebaseRoom(...args),
        claimRoom: (...args) => claimFirebaseRoom(...args),
        assertNoPending: () => assertNoPendingFirebaseReentry(),
        setOnline: value => { online = value; },
        noticeSeatLost: () => noticeOwnFirebaseSeatLost(),
        releaseFatal: () => releaseFirebaseRoomOnFatalExit(),
        acquireLease: (credential, lockManager) => acquireFirebaseReentryLease(credential, lockManager),
        releaseLease: lease => releaseFirebaseReentryLease(lease),
        pending: () => pendingFirebaseReentry,
        auth: () => firebaseAuth,
        reset: () => {
          clearPendingFirebaseReentry();
          firebaseAuth = null;
          pendingFirebaseReentry = null;
        }
      }),
      firebaseBattleRecoveryForTest: () => ({
        api: () => firebaseBattleRecoveryApi(),
        build: (candidate, messages) => buildFirebaseBattleRecoveryPlan(candidate, messages),
        readPending: () => readFirebaseBattleRecoveryPlanForPendingReentry(),
        deduper: () => createSseDeduper(),
        replay: (plan, options) => replayFirebaseBattleRecoveryPlan(plan, options),
        activatePending: options => activatePendingFirebaseBattleReentry(options),
        setPending: candidate => { pendingFirebaseReentry = candidate; },
        pending: () => pendingFirebaseReentry,
        activeOnline: () => online,
        endActive: () => endOnline(false),
        // A test-only terminal generator.  It deliberately shares the
        // recovery start/action *inputs* with the verifier, but never reads a
        // candidate terminal or calls the replay runner.  This lets tests
        // derive a terminal from the ordinary production engine before asking
        // the verifier to validate that independent packet.
        generateTerminal: async (plan, fire, options = {}) => {
          if (!plan?.start?.packet || !fire || fire.t !== 'fire') throw new Error('recovery terminal generator input is invalid');
          if (!online || online.kind !== 'firebase') throw new Error('Firebase ONLINE is required');
          const rollback = captureFirebaseBattleReplayRollback();
          return withFirebaseBattleReplayContext(async context => {
            try {
              online.phase = 'recovering';
              const verifiedStart = await verifyFirebaseRecoveryStart(plan);
              gamePhase = 'battle';
              battleIntroPending = false;
              applyVerifiedFirebaseStartSnapshot(verifiedStart.start.snap, verifiedStart.gearStart);
              setOnlineSeat(online.seat);
              const unit = unitById(fire.unitId);
              if (!unit || activeUnit()?.id !== fire.unitId || awaitingResolve) throw new Error('recovery terminal generator action is not active');
              if (![fire.x, fire.y, fire.anchor?.x, fire.anchor?.y, fire.vx0, fire.vy0].every(Number.isFinite)) throw new Error('recovery terminal generator fire is malformed');
              for (const move of options.moves || []) {
                if (!move || move.t !== 'move' || move.unitId !== fire.unitId || !firebaseHistoricalActionAllowed(move)) throw new Error('recovery terminal generator move is invalid');
                unit.netWalkTargetX = Math.min(STAGE_W - UNIT_RADIUS - 4, Math.max(UNIT_RADIUS + 4, Number(move.x)));
                unit.fuel = Math.max(0, Math.min(unit.fuelMax, Number(move.fuel)));
              }
              unit.x = fire.x;
              unit.y = fire.y;
              faceAllUnitsTowardOpponents();
              const action = beginFirebaseBattleReplayAction(fire);
              try {
                launchShot(unit, fire.anchor, fire.vx0, fire.vy0, fire.useSpecial, false, fire.useJump, fire.subweaponId || null);
                awaitingResolve = true;
                await firebaseRecoveryAwait(() => !awaitingResolve && !pendingShot && !projectiles.length && !barucopters.length && !groundFlames.length && units.every(entry => entry.grounded), options);
                const fullSnap = buildSnapshot({ includeTerrain: true });
                const snap = buildSnapshot({ includeTerrain: false });
                const runtimeState = createFirebaseOnlineGearRuntimeState();
                if (runtimeState) snap.gearRuntimeState = runtimeState;
                return Object.freeze({
                  snap: structuredClone(snap),
                  fullSnap: structuredClone(fullSnap),
                  identity: action.gearRngActionIdentity ? structuredClone(action.gearRngActionIdentity) : null,
                  action: Object.freeze({ activeIndex, activeUnitId: activeUnit()?.id || null, turnCount, unit: Object.freeze({ id: unit.id, x: unit.x, y: unit.y, control: unit.control, team: unit.team }) }),
                  sideEffects: Object.freeze({ outboundCount: context.outboundCount, visualCount: context.visualCount, randomCalls: context.randomCalls })
                });
              } finally {
                clearFirebaseBattleReplayAction(action);
              }
            } finally {
              restoreFirebaseBattleReplayRollback(rollback);
            }
          });
        },
        generateTerminals: async (plan, fires, options = {}) => {
          if (!Array.isArray(fires) || fires.length === 0) throw new Error('recovery terminal generator actions are required');
          if (!online || online.kind !== 'firebase') throw new Error('Firebase ONLINE is required');
          const rollback = captureFirebaseBattleReplayRollback();
          return withFirebaseBattleReplayContext(async context => {
            try {
              online.phase = 'recovering';
              const verifiedStart = await verifyFirebaseRecoveryStart(plan);
              gamePhase = 'battle';
              battleIntroPending = false;
              applyVerifiedFirebaseStartSnapshot(verifiedStart.start.snap, verifiedStart.gearStart);
              setOnlineSeat(online.seat);
              const terminals = [];
              for (const fire of fires) {
                const unit = unitById(fire?.unitId);
                if (!fire || fire.t !== 'fire' || !unit || activeUnit()?.id !== fire.unitId || awaitingResolve || !firebaseHistoricalActionAllowed(fire)) throw new Error('recovery terminal generator action is not active');
                if (![fire.x, fire.y, fire.anchor?.x, fire.anchor?.y, fire.vx0, fire.vy0].every(Number.isFinite)) throw new Error('recovery terminal generator fire is malformed');
                unit.x = fire.x;
                unit.y = fire.y;
                faceAllUnitsTowardOpponents();
                const action = beginFirebaseBattleReplayAction(fire);
                try {
                  launchShot(unit, fire.anchor, fire.vx0, fire.vy0, fire.useSpecial, false, fire.useJump, fire.subweaponId || null);
                  awaitingResolve = true;
                  await firebaseRecoveryAwait(() => !awaitingResolve && !pendingShot && !projectiles.length && !barucopters.length && !groundFlames.length && units.every(entry => entry.grounded), options);
                  const fullSnap = buildSnapshot({ includeTerrain: true });
                  const snap = buildSnapshot({ includeTerrain: false });
                  const runtimeState = createFirebaseOnlineGearRuntimeState();
                  if (runtimeState) snap.gearRuntimeState = runtimeState;
                  terminals.push(Object.freeze({ snap: structuredClone(snap), fullSnap: structuredClone(fullSnap), identity: action.gearRngActionIdentity ? structuredClone(action.gearRngActionIdentity) : null }));
                } finally {
                  clearFirebaseBattleReplayAction(action);
                }
              }
              return Object.freeze({ terminals: Object.freeze(terminals), sideEffects: Object.freeze({ outboundCount: context.outboundCount, visualCount: context.visualCount, randomCalls: context.randomCalls }) });
            } finally {
              restoreFirebaseBattleReplayRollback(rollback);
            }
          });
        },
        // These two read-only identity probes keep the live and recovery
        // construction paths independently observable in the focused runner
        // suite.  Neither launches an action nor reads a candidate terminal.
        replayGearActionIdentity: async fire => withFirebaseBattleReplayContext(async () => {
          const action = beginFirebaseBattleReplayAction(fire);
          try {
            return action.gearRngActionIdentity ? structuredClone(action.gearRngActionIdentity) : null;
          } finally {
            clearFirebaseBattleReplayAction(action);
          }
        }),
        replayGearIdentityMissingProbe: async ownerId => withFirebaseBattleReplayContext(async () =>
          firebaseOnlineGearCritActionIdentity(ownerId)),
        replayActive: () => firebaseBattleReplayActive(),
        replayRandomProbe: () => withFirebaseBattleReplayContext(async () => Math.random()),
        replayStartTurn: () => withFirebaseBattleReplayContext(async () => {
          startTurn();
          return buildSnapshot({ includeTerrain: false });
        }),
        onlinePhase: () => online?.phase || null,
        recoverySnapshotMismatch: (candidate, baseline) => firebaseRecoverySnapshotMismatchReason(candidate, baseline)
      }),
      // ---- Gear Phase 3D-2B: Firebaseロビー実配線 ----
      // mutableなonline本体は既存setOnlineForLogTest()だけで投入し、観測と操作は
      // production helperを直接通す。READY/reveal/startの非同期経路をsleep無しで検査する。
      firebaseGearLobbyForTest: () => ({
        characterIds: () => CHARACTER_LIST.slice(),
        state: () => online ? structuredClone({
          visibility: online.visibility,
          settings: online.settings,
          slots: online.slots,
          acceptedSettingsRevision: online.acceptedSettingsRevision,
          acceptedSettingsIdentity: online.acceptedSettingsIdentity,
          persistedRosterIdentity: online.persistedRosterIdentity,
          settingsAuthorityBlocked: !!online.settingsAuthorityBlocked,
          selfReady: !!online.selfReady,
          readyCapturePending: !!online.readyCapturePending,
          readyCaptureGeneration: online.readyCaptureGeneration || 0,
          selfCommit: online.selfCommit || null,
          selfCharacter: online.selfCharacter || null,
          selfNonce: online.selfNonce || null,
          selfGearCapture: online.selfGearCapture || null,
          participantGearReveals: online.participantGearReveals || {},
          verifiedStartGearManifest: online.verifiedStartGearManifest || null,
          battleGearSnapshotsByUnit: online.battleGearSnapshotsByUnit || null,
          battleGearShieldStateByUnit: online.battleGearShieldStateByUnit || null,
          battleGearRuntimeEffectsStateByUnit: online.battleGearRuntimeEffectsStateByUnit || null,
          battleGearActiveAttackRuntime: online.battleGearActiveAttackRuntime || null,
          localAction: online.localAction || null,
          remoteAction: online.remoteAction || null,
          gearRevealCompatibility: online.gearRevealCompatibility || null,
          protocolError: online.protocolError || ''
        }) : null,
        inspectPersistedRoom: room => inspectPersistedFirebaseRoom(room),
        applyPersistedRoom: room => applyPersistedFirebaseRoomAuthority(room),
        handleSettingsHint: settings => handleFirebaseSettingsHint(settings),
        refreshPersistedRoom: (broadcast = false, expectedSettingsHint = null) =>
          refreshFirebaseRoster(broadcast, expectedSettingsHint),
        gearEnabled: () => firebaseGearEnabled(),
        trustedContext: (seat, characterId) => firebaseGearTrustedContext(seat, characterId),
        readyAuthorityIdentity: () => firebaseReadyAuthorityIdentity(),
        renderGearMode: () => {
          renderFirebaseLobby();
          return {
            value: onlineGearModeEl ? onlineGearModeEl.value : null,
            disabled: onlineGearModeEl ? !!onlineGearModeEl.disabled : null,
            status: onlineGearModeStatusEl ? onlineGearModeStatusEl.textContent : '',
            enabled: onlineGearModeStatusEl ? onlineGearModeStatusEl.dataset.enabled : null
          };
        },
        captureReady: characterId => captureFirebaseReadyGear(characterId),
        commitReady: characterId => commitOwnCharacterSelection(characterId),
        updateSettings: options => updateFirebaseSettings(options),
        changeCharacter: characterId => {
          if (!onlineCharacterEl) return false;
          onlineCharacterEl.value = characterId;
          onlineCharacterEl.dispatchEvent({ type: 'change' });
          return true;
        },
        ensureReadyCurrent: () => ensureFirebaseReadyGearCurrent(),
        pollReadyStorage: () => updateFirebaseReadyGearStorageWatch(true),
        invalidateReady: reason => invalidateFirebaseRoundReadiness(reason),
        storageMutation: event => handleFirebaseGearStorageMutation(event),
        buildRevealPayload: () => buildFirebaseRevealPayload(),
        verifyReveal: msg => verifyPeerReveal(msg),
        buildStartEnvelope: () => buildFirebaseStartGearEnvelope(),
        validateStartEnvelope: msg => validateFirebaseStartGearEnvelope(msg),
        createBattleStartState: manifest => createFirebaseOnlineGearBattleStartState(manifest),
        applyBattleStartState: state => applyFirebaseOnlineGearBattleStartState(state),
        validateBattleStartSnapshot: (snap, state) => validateFirebaseOnlineGearStartSnapshot(snap, state),
        applyVerifiedStartSnapshot: (snap, state) => applyVerifiedFirebaseStartSnapshot(snap, state),
        shieldState: () => online?.battleGearShieldStateByUnit
          ? structuredClone(online.battleGearShieldStateByUnit) : null,
        runtimeEffectsState: () => online?.battleGearRuntimeEffectsStateByUnit
          ? structuredClone(online.battleGearRuntimeEffectsStateByUnit) : null,
        setRuntimeEffectsStateRawForTest: value => { online.battleGearRuntimeEffectsStateByUnit = value; },
        activeAttackRuntime: () => online?.battleGearActiveAttackRuntime
          ? structuredClone(online.battleGearActiveAttackRuntime) : null,
        battleSnapshotsForRuntimeTest: () => online?.battleGearSnapshotsByUnit || null,
        runtimeState: () => {
          const runtimeState = createFirebaseOnlineGearRuntimeState();
          return runtimeState ? structuredClone(runtimeState) : null;
        },
        prepareRuntimeState: snap => prepareFirebaseOnlineGearRuntimeStateForAcceptedSnapshot(snap),
        setShieldStateRawForTest: value => { online.battleGearShieldStateByUnit = value; },
        turnSnapshotForTest: () => {
          const snap = buildSnapshot({ includeTerrain: false });
          const runtimeState = createFirebaseOnlineGearRuntimeState();
          if (runtimeState) snap.gearRuntimeState = runtimeState;
          return structuredClone(snap);
        },
        setShieldForTest: (unitId, value) => {
          const state = online?.battleGearShieldStateByUnit;
          if (!state?.[unitId] || !Number.isFinite(value) || value < 0) return null;
          online.battleGearShieldStateByUnit = Object.freeze({
            ...state,
            [unitId]: Object.freeze({ currentShield: value })
          });
          return value;
        },
        applyResolvedDamage: (ownerId, targetId, requestedDamage, options = {}) =>
          applyResolvedUnitDamage(unitById(targetId), requestedDamage, { ownerId, ...options }),
        beginLastStandAttack: ownerId => beginFirebaseOnlineGearAttackAction(unitById(ownerId)),
        completeLastStandAttack: ownerId => completeFirebaseOnlineGearAttackAction(unitById(ownerId)),
        cancelLastStandAttack: ownerId => cancelFirebaseOnlineGearAttackAction(unitById(ownerId)),
        recordLastStandDamage: options => recordFirebaseOnlineGearLastStandDamage(options),
        actionDamageRequested: (ownerId, baseDamage) => battleGearActionDamageRequested(ownerId, baseDamage),
        resolveScorpionRailImpact: (ownerId, targetId, damageMul = 1) => {
          const target = unitById(targetId);
          const beforeHp = target.hp;
          resolveScorpionRailImpact({ owner: ownerId, damageMul, x: 0, y: 0, radius: 1, scorpionRailActive: false }, target);
          return Object.freeze({ actualDamage: beforeHp - target.hp, targetHp: target.hp });
        },
        applyHealing: (sourceUnitId, targetUnitId, baseHealing) =>
          applyBattleGearHealing({ sourceUnitId, target: unitById(targetUnitId), baseHealing }),
        recordSupportEvent: options => recordFirebaseOnlineGearSupportEvent(options),
        requestedDamage: (ownerId, targetId, damageType, baseDamage, projectile = null) =>
          battleGearRequestedDamage(ownerId, unitById(targetId), damageType, baseDamage, projectile),
        knockbackPolicy: (ownerId, targetId, damageType, projectile = null, legacyKnockbackSpeed = 0) =>
          battleGearKnockbackPolicy(ownerId, unitById(targetId), damageType, projectile, legacyKnockbackSpeed),
        applyKnockbackAfterDamage: ({ actualDamage, targetId, blastX, ownerId,
          damageType, projectile = null, legacyKnockbackSpeed = 0 }) =>
          applyBattleGearKnockbackAfterDamage({
            actualDamage,
            target: unitById(targetId),
            blastX,
            ownerId,
            damageType,
            projectile,
            legacyKnockbackSpeed
          }),
        rngActionIdentity: sourceUnitId => createFirebaseOnlineGearRngActionIdentity(sourceUnitId),
        critResolution: (ownerId, targetId, damageType, projectile = null) =>
          resolveFirebaseOnlineGearCrit(ownerId, unitById(targetId), damageType, projectile,
            onlineGearStaticCombatForUnit(unitById(ownerId))),
        statusResolution: (ownerId, targetId, statusId) =>
          firebaseOnlineGearHostileStatusOutcome(ownerId, unitById(targetId), statusId),
        setCritActionForTest: (ownerId, location = 'local', actionId = 'a'.repeat(32)) => {
          const index = turnOrder.indexOf(ownerId);
          if (index >= 0) activeIndex = index;
          const action = {
            unitId: ownerId,
            actionId,
            gearRngActionIdentity: createFirebaseOnlineGearRngActionIdentity(ownerId)
          };
          if (location === 'remote') {
            online.localAction = null;
            online.remoteAction = action;
          } else {
            online.localAction = action;
            online.remoteAction = null;
          }
          return structuredClone(action.gearRngActionIdentity);
        },
        onlineCombat: unitId => onlineGearStaticCombatForUnit(unitById(unitId)),
        battleSnapshotFreeze: () => online && online.battleGearSnapshotsByUnit ? {
          map: Object.isFrozen(online.battleGearSnapshotsByUnit),
          units: Object.fromEntries(Object.entries(online.battleGearSnapshotsByUnit).map(([id, value]) => [id, Object.isFrozen(value)]))
        } : null,
        expireRevealCompatibility: () => updateFirebaseGearRevealCompatibility(true),
        commitPayload: (character, nonce, bindingText = null) => commitPayload(character, nonce, bindingText)
      }),
      // 通信ログ(2026-07-27、実機報告の追跡用)。stage3()の内側に置き、既存の h.stage3() 経由で使えるようにする。
      setOnlineForLogTest: (obj) => { online = obj; },
      noteRemoteDamageBaseline: () => noteRemoteDamageBaseline(),
      flushRemoteDamageText: () => flushRemoteDamageText(),
      damageTexts: () => floatTexts.map(t => t.text),
      clearDamageTexts: () => { floatTexts.length = 0; },
      setHp: (id, hp) => { unitById(id).hp = hp; },
      logOnlineEvent: (e) => logOnlineEvent(e),
      persistOnlineLog: () => persistOnlineLog(),
      onlineLogKey: () => ONLINE_LOG_KEY,
      onlineLogMax: () => ONLINE_LOG_MAX,
      // ---- 席のゴースト対策(Issue #7) ----
      seatHeartbeatMs: () => FIREBASE_SEAT_HEARTBEAT_MS,
      seatStaleReleaseMs: () => FIREBASE_SEAT_STALE_RELEASE_MS,
      lobbySeatStaleVisibleMs: () => FIREBASE_LOBBY_SEAT_STALE_VISIBLE_MS,
      firebaseSeatHeartbeatAllowsRelease: (serverNow, seenAt) => firebaseSeatHeartbeatAllowsRelease(serverNow, seenAt),
      canReleaseFirebaseSeat: (seat) => canReleaseFirebaseSeat(seat),
      ownFirebaseSeatIsLost: () => ownFirebaseSeatIsLost(),
      firebaseSeatIsStale: (seat) => firebaseSeatIsStale(seat),
      firebaseSeatHeartbeatTarget: () => firebaseSeatHeartbeatTarget(),
      // 席ボードを実際に組み立てて、出来上がったDOMを覗く。
      renderLobbySeats: () => {
        renderFirebaseLobby();
        return (onlineSlotsEl ? onlineSlotsEl.children : []).map(row => ({
          cls: row.className,
          parts: row.children.map(c => c.tagName + ':' + c.className + ':' + c.textContent)
        }));
      },
      // ---- v164: 部屋内モンスター選択の全身画像 ----
      // 実装前にも検査側が例外で止まらず、機能なしとしてFAILを出せるようtypeofで包む。
      onlineCharacterPreviewForTest: key => {
        if (typeof updateOnlineCharacterPreview !== 'function' || !onlineCharacterEl || !onlineCharacterPreviewEl) return null;
        populateOnlineCharacters();
        onlineCharacterEl.value = key;
        onlineCharacterEl.dispatchEvent({ type: 'change' });
        return {
          character: onlineCharacterPreviewEl.dataset.character || '',
          src: onlineCharacterPreviewEl.src || '',
          alt: onlineCharacterPreviewEl.alt || '',
          options: onlineCharacterEl.children.length
        };
      },
      // ---- v162: 端末内の対人戦績(Issue #5) ----
      // 実装前にもハーネス自体は例外で止めず、検査をFAILとして表示できるようtypeofで包む。
      battleRecordFeature: () => typeof recordMatchResultOnce !== 'function' ? null : ({
        key: () => BATTLE_RECORD_KEY,
        deriveRivalId: deviceId => deriveRivalId(deviceId),
        identityFields: (deviceId, name) => firebaseIdentityFieldsForDevice(deviceId, name),
        reset: () => resetBattleRecordForTest(),
        reload: () => loadBattleRecord(),
        snapshot: () => JSON.parse(JSON.stringify(battleRecord)),
        record: detail => recordMatchResultOnce(detail),
        outcomeForSeat: (resultWinner, seat) => firebaseOutcomeForSeat(resultWinner, seat),
        rememberIdentity: msg => rememberFirebaseIdentity(msg),
        setResultState: (resultWinner, reason, over = true) => {
          winner = resultWinner;
          matchEndReason = reason;
          matchOver = over;
        },
        freezeRoundRivals: () => freezeFirebaseRoundRivals(),
        resultRows: () => firebaseBattleRecordResultRows(),
        renderLobbyText: () => {
          renderFirebaseLobby();
          const collect = node => !node ? [] : [node.textContent || '', ...node.children.flatMap(collect)];
          return collect(onlineBattleRecordEl).filter(Boolean).join(' | ');
        }
      }),
      showTitleNotice: (text) => showTitleNotice(text),
      titleNotice: () => activeTitleNotice(),
      titleNoticeBand: () => ({ top: TITLE_NOTICE_Y - TITLE_NOTICE_H / 2, bottom: TITLE_NOTICE_Y + TITLE_NOTICE_H / 2 }),
      saveBubbleBand: () => {
        const box = suspendedSaveBubbleRect(120);
        return { top: box.y, bottom: box.y + box.h };
      },
      titleModeLabelY: () => TITLE_MODE_LABEL_Y,
      // ---- マッチメイキング(Issue #23) ----
      pickOpenCandidates: (listing, selfUid, format, now) => pickOpenCandidates(listing, selfUid, format, now),
      usableOpenEntry: (code, entry, format, now) => usableOpenEntry(code, entry, format, now),
      normalizeOpenFormat: (f) => normalizeOpenFormat(f),
      openIndexTtlMs: () => OPEN_INDEX_TTL_MS,
      openMatchFormats: () => OPEN_MATCH_FORMATS.slice(),
      openMaxCandidates: () => OPEN_INDEX_MAX_CANDIDATES,
      syncQuickMatchListing: () => syncQuickMatchListing(),
      legacyQuickRoom: () => LEGACY_QUICK_MATCH_ROOM,
      // ---- 4人の席(Issue #25) ----
      firebaseSeatUnitId: (seat) => firebaseSeatUnitId(seat),
      firebaseSeatTeam: (seat) => FIREBASE_SEAT_TEAM[seat] || null,
      firebasePlayerSeats: () => firebasePlayerSeats(),
      firebaseSeatLabel: (seat) => firebaseSeatLabel(seat),
      firebaseLobbyIs2v2: () => firebaseLobbyIs2v2(),
      syncFirebaseParticipantRole: () => syncFirebaseParticipantRole(),
      localUnitId: () => localUnitId,
      allFirebasePlayersReady: () => allFirebasePlayersReady(),
      firebaseOccupiedPlayerSeats: () => firebaseOccupiedPlayerSeats(),
      firebaseCpuSeats: () => firebaseCpuSeats(),
      firebaseSeatReady: (seat) => firebaseSeatReady(seat),
      // ---- 段C: 手番の受け渡し(Issue #26) ----
      setOnlineSeat: (seat) => setOnlineSeat(seat),
      netControlsUnit: (id) => netControlsUnit(unitById(id)),
      unitSeatIsCpu: (id) => unitSeatIsCpu(unitById(id)),

      setMatchFormat: (format) => setMatchFormat(format),
      // 4人ぶんの伏せ合いと再戦(Issue #26 段C)
      firebaseSeatCommitted: (seat) => firebaseSeatCommitted(seat),
      firebaseSeatRevealVerified: (seat) => firebaseSeatRevealVerified(seat),
      allFirebasePlayersCommitted: () => allFirebasePlayersCommitted(),
      allFirebaseRevealsVerified: () => allFirebaseRevealsVerified(),
      allFirebaseRematchVotesIn: () => allFirebaseRematchVotesIn(),
      firebasePeersCommitted: () => firebasePeersCommitted(),
      firebaseRevealsReady: () => firebaseRevealsReady(),
      firebaseStartCharactersMatch: (snap) => firebaseStartCharactersMatch(snap),
      firebaseHasSeatedOpponent: () => firebaseHasSeatedOpponent(),
      updateFirebasePeerLiveness: () => updateFirebasePeerLiveness(),
      // ---- v121: 開始カットインが終わるまで手番を始めない / 手番表示 ----
      battleIntroPending: () => battleIntroPending,
      resetMatchForTest: () => resetMatch(false),
      turnCutInLines: (id) => turnCutInLines(unitById(id)),
      cutInInfo: () => cutIn && cutIn.kind === 'message'
        ? { text: cutIn.text, sub: cutIn.sub, color: cutIn.color, duration: cutIn.duration } : null,
      turnCutInDuration: () => TURN_CUTIN_DURATION,
      cpuThinkRange: () => [CPU_THINK_MIN_SEC, CPU_THINK_MIN_SEC + CPU_THINK_RANGE_SEC],
      // ---- v122 段D: 切断・CPU引き継ぎ(Issue #8) ----
      peerVisibleTimeoutMs: () => FIREBASE_PEER_VISIBLE_TIMEOUT_MS,
      pendingVisibleTimeoutMs: () => FIREBASE_PENDING_VISIBLE_TIMEOUT_MS,
      matchSeatSuspectMs: () => FIREBASE_MATCH_SEAT_SUSPECT_MS,
      matchSeatVerifyIntervalMs: () => FIREBASE_MATCH_SEAT_VERIFY_INTERVAL_MS,
      firebaseMatchTakeoverSeats: () => firebaseMatchTakeoverSeats(),
      firebaseMatchSeatSuspect: (seat) => firebaseMatchSeatSuspect(seat),
      firebaseMatchSeatAwaitingTakeover: (seat, ms) => firebaseMatchSeatAwaitingTakeover(seat, ms),
      firebaseSeatTakeoverPending: () => firebaseSeatTakeoverPending(),
      noteFirebaseMatchSeatMessage: (seat) => noteFirebaseMatchSeatMessage(seat),
      updateFirebaseMatchSeatTakeover: () => updateFirebaseMatchSeatTakeover(),
      applyFirebaseSeatTakeover: (seat) => applyFirebaseSeatTakeover(seat),
      updateFirebasePendingTerminals: () => updateFirebasePendingTerminals(),
      firebaseHostActsForEmptySeat: (seat, unitId) => firebaseHostActsForEmptySeat(seat, unitId),
      cpuPlan: () => ({ phase: cpuPhase, dir: cpuMoveDir, remaining: cpuMoveRemaining, think: cpuThinkTimer }),
      clearCpuPlan: () => { cpuPhase = null; cpuMoveDir = 0; cpuMoveRemaining = 0; cpuThinkTimer = -1; },
      setUnitControl: (id, control) => { const u = unitById(id); if (u) u.control = control; },
      unitControl: (id) => { const u = unitById(id); return u ? u.control : null; },
      setActiveUnitForTest: (id) => { const i = turnOrder.indexOf(id); if (i >= 0) activeIndex = i; return activeUnit().id; },
      setTurnOrderForTest: (ids) => {
        if (!Array.isArray(ids) || ids.length !== units.length || new Set(ids).size !== ids.length
            || ids.some(id => !unitById(id))) return false;
        turnOrder = ids.slice(); activeIndex = 0;
        return turnOrder.slice();
      }
    }),
    setPhase: (p) => { gamePhase = p; },
    phase: () => gamePhase,
    setBattleModeForTest: (mode) => { battleMode = mode; },
    setMatchFormatForTest: (format) => { setMatchFormat(format); return matchFormat; },
    setOnlineForCpuGearEligibilityForTest: (value) => { online = value || null; return !!online; },
    cpuGearEligibleForTest: () => isCpuGearEligibleRun(),
    // 画面の揺れ。対戦中以外でも必ず止まることを見るため(v110の起動演出で震え続けた)。
    shakeTimer: () => shakeTimer,
    triggerShakeForTest: (mag, sec) => triggerShake(mag, sec),
    // タイトルGARAGEのサウンドテスト
    soundTestBtn: () => ({ ...titleSoundTestBtn }),
    titleBtnRects: () => ({
      cpu: { ...titleVsCpuBtn }, online: { ...titleOnlineBtn }, free: { ...titleFreeBtn },
      tutorial: { ...titleTutorialBtn },
      ranking: { ...titleRankingBtn }, shop: { ...titleShopBtn }, achievements: { ...titleAchievementsBtn },
      soundTest: { ...titleSoundTestBtn }, update: { ...titleUpdateBtn },
      left: { ...titleMenuLeftBtn }, right: { ...titleMenuRightBtn },
      battleTab: { ...titleBattleTabBtn }, garageTab: { ...titleGarageTabBtn },
      battleTabHit: { ...titleBattleTabHit }, garageTabHit: { ...titleGarageTabHit }
    }),
    titleMenuInfo: () => ({
      page: typeof titleMenuPage === 'undefined' ? 0 : titleMenuPage,
      animation: typeof titleMenuAnimation === 'undefined' || !titleMenuAnimation ? null : { ...titleMenuAnimation },
      gesture: typeof titleMenuGesture === 'undefined' || !titleMenuGesture ? null : { ...titleMenuGesture },
      slideMs: typeof TITLE_MENU_SLIDE_MS === 'undefined' ? 0 : TITLE_MENU_SLIDE_MS,
      swipeThreshold: typeof TITLE_MENU_SWIPE_THRESHOLD === 'undefined' ? 0 : TITLE_MENU_SWIPE_THRESHOLD,
      pages: typeof TITLE_MENU_PAGES === 'undefined' ? [] : TITLE_MENU_PAGES.map(page => ({
        key: page.key, items: page.items.map(item => item.id)
      })),
      soundTestOpen: typeof soundTestOpen === 'undefined' ? false : soundTestOpen
    }),
    setTitleMenuPageForTest: (page) => {
      if (typeof titleMenuPage === 'undefined') return false;
      titleMenuPage = Math.max(TITLE_MENU_BATTLE, Math.min(TITLE_MENU_GARAGE, Number(page) || 0));
      titleMenuAnimation = null;
      titleMenuGesture = null;
      inputMode = null;
      inputPointerId = null;
      return true;
    },
    cancelTitleMenuGestureForTest: (animate = false) => cancelTitleMenuGesture(animate),
    titleUpdateHistoryInfo: () => ({
      build: typeof BUILD_ID === 'undefined' ? '' : BUILD_ID,
      history: typeof LATEST_UPDATE_HISTORY === 'undefined' ? null : { ...LATEST_UPDATE_HISTORY },
      entries: typeof UPDATE_HISTORY === 'undefined' ? [] : UPDATE_HISTORY.map(entry => ({ ...entry })),
      open: typeof updateHistoryOpen === 'undefined' ? false : updateHistoryOpen,
      update: { ...titleUpdateBtn },
      panel: typeof titleUpdateHistoryPanel === 'undefined' ? null : { ...titleUpdateHistoryPanel },
      modal: typeof titleUpdateHistoryModal === 'undefined' ? null : {
        ...titleUpdateHistoryModal,
        scroll: typeof updateHistoryScrollY === 'undefined' ? 0 : updateHistoryScrollY,
        maxScroll: typeof updateHistoryMaxScroll === 'undefined' ? 0 : updateHistoryMaxScroll,
        contentViewport: typeof updateHistoryContentViewport === 'function' ? updateHistoryContentViewport() : null
      },
      close: typeof titleUpdateHistoryCloseBtn === 'undefined' ? null : { ...titleUpdateHistoryCloseBtn }
    }),
    scrollUpdateHistoryForTest: (delta) => {
      if (typeof updateHistoryScrollBy === 'function') updateHistoryScrollBy(delta);
    },
    bgm: () => ({ bonusTrack: bonusBgmTrack, desired: desiredBgm(), current: currentBgmKind(), displayName: currentBgmDisplayName(), stageSrc: stageBgm.src, stageTheme: stageBgmTheme }),
    bonusTrackCount: () => BONUS_BGM_TRACKS.length - 1,
    bonusTrackVolumes: () => BONUS_BGM_TRACKS.slice(1).map(t => t.volume),
    finishBonusTrackForTest: () => (
      typeof advanceBonusBgmAfterEnd === 'function' ? advanceBonusBgmAfterEnd() : false
    ),
    titleBgmBaseVolume: () => TITLE_BGM_BASE_VOLUME,
    syncBgm: () => syncBgm(),
    controls: () => units.map(u => u.id + ':' + u.control).join(','),
    unitState: () => units.map(u => ({ id: u.id, hp: u.hp, x: Math.round(u.x * 100) / 100, ch: u.character, g: u.grounded })),
    // ---- 2vs2(Issue #20) ----
    matchFormat: () => matchFormat,
    is2v2: () => is2v2(),
    formatOptions: () => FORMAT_OPTIONS.map(o => o.key),
    freeRows: () => JSON.parse(JSON.stringify(freeRows())),
    freeStageGroup: () => (typeof freeStageGroup === 'function'
      ? JSON.parse(JSON.stringify(freeStageGroup()))
      : null),
    freeTrainingMenuRows: () => (typeof freeTrainingMenuRows === 'function'
      ? JSON.parse(JSON.stringify(freeTrainingMenuRows()))
      : null),
    freeStartBtn: () => ({ ...freeStartBtn() }),
    gamePhaseForTest: () => gamePhase,
    endFreeTrainingForTest: () => endFreeTrainingToTitle(),
    clearSuspendedForTest: () => clearSuspendedMatch(),
    suspendedSavePresentForTest: () => !!loadSuspendedMatch(),
    freeConfig: () => ({ ...freeModeConfig }),
    setFreeFormat: (key) => {
      freeModeConfig.formatIndex = Math.max(0, FORMAT_OPTIONS.findIndex(o => o.key === key));
    },
    setFreeWindForTest: (key) => {
      freeModeConfig.windIndex = Math.max(0, WIND_OPTIONS.findIndex(o => o.key === key));
      if (typeof applyLegacyFreeWind === 'function') applyLegacyFreeWind(key);
    },
    changeFreeOption: (kind, dir) => changeFreeOption(kind, dir),
    startFreeMatch: () => startFreeMatch(),
    unitPanelLayout: () => unitPanelLayout().map(s => ({ id: s.unit.id, label: s.unit.label, align: s.align, cardY: s.cardY, h: s.h })),
    hudBottom: () => HUD_BASE_BOTTOM + hudShift(),
    minimapTop: () => minimapTop(),
    turnBarTop: () => TURN_BAR_BASE_Y + hudShift(),
    cpuPickTarget: (id) => { const t = cpuPickTarget(unitById(id)); return t ? t.id : null; },
    cpuFriendlyFireRadius: () => CPU_FRIENDLY_FIRE_RADIUS,
    emitEmpForTest: (x, y, radius, ownerId, turns, actionOrdinal = null) => emitEmp(x, y, radius, ownerId, turns || 1, 'moveLock', actionOrdinal),
    fireEmpForTest: (ownerId) => {
      const owner = unitById(ownerId);
      fireProjectile(ownerId, unitAnchor(owner), 0, 0, { emp: true, empRadius: 100, empTurns: 2, noTerrain: true });
      return projectiles[projectiles.length - 1]?.gearStatusActionOrdinal ?? null;
    },
    launchGeneratedEmpForTest: (ownerId, count) => {
      const owner = unitById(ownerId);
      launchGeneratedSpecial({ blastMul: 1, windMul: 1, specialSkill: { schemaVersion: 1, id: 'status-test', projectile: { count, speedMultiplier: 1, power: 1, gravityMultiplier: 1, penetrationCount: 0 }, impact: { radiusMultiplier: 1, knockback: 0 }, targetEffect: { kind: 'movement-lock', chance: 1, durationTurns: 2 } } }, owner, ownerId, unitAnchor(owner), 1, -1);
      return projectiles.filter((projectile) => projectile.emp).map((projectile) => projectile.gearStatusActionOrdinal);
    },
    emitNyanDisableForTest: (x, y, radius, ownerId, actionOrdinal = null) => emitEmp(x, y, radius, ownerId, 1, 'turnSkip', actionOrdinal),
    turnEffectForTest: (id) => {
      const u = unitById(id);
      return u ? { moveLockTurns: u.moveLockTurns || 0, actionSkipTurns: u.actionSkipTurns || 0 } : null;
    },
    specialFlashForTest: () => specialFlash && specialFlash.timer > 0 ? { ...specialFlash } : null,
    clearSpecialFlashForTest: () => { specialFlash = { timer: 0, key: null, text: '', color: '', sub: '' }; },
    armCoopSpecialSalvoForTest: (unitIds, characterKeys) => {
      const ids = Array.isArray(unitIds) ? unitIds.slice(0, 4) : [];
      const keys = Array.isArray(characterKeys) ? characterKeys : [];
      coopSalvoSpecialAura = null;
      coopSalvoSpecialFlash = null;
      coopSalvoState = {
        phase: 'launching', participants: ids.slice(), expected: ids.slice(),
        ready: new Set(ids), nextLaunchIndex: 0, physicsTick: 0,
        launchTicks: [], deferredMatchEndReason: '',
        actions: ids.map((unitId, index) => {
          const unit = unitById(unitId);
          if (!unit) throw new Error('missing salvo test unit: ' + unitId);
          if (keys[index] && CHARACTERS[keys[index]]) unit.character = keys[index];
          unit.specialCharge = SPECIAL_CHARGE_MAX;
          const anchor = unitAnchor(unit);
          return {
            unitId, anchor, vx0: unit.team === 'player' ? 7 : -7, vy0: -5,
            useSpecial: true, useJump: false, subweaponId: null, coopItemId: null,
          };
        }),
      };
      const armed = armQueuedCoopSalvo();
      return {
        armed,
        phase: coopSalvoState?.phase || null,
        duration: coopSalvoSpecialAura?.duration || 0,
        charges: ids.map(unitId => unitById(unitId)?.specialCharge),
        entries: (coopSalvoSpecialAura?.entries || []).map(entry => ({ ...entry })),
        auraVisible: !!coopSalvoSpecialAura,
        flashVisible: !!coopSalvoSpecialFlash,
        projectileCount: projectiles.length,
      };
    },
    advanceCoopSpecialAuraForTest: () => {
      const duration = coopSalvoSpecialAura?.duration || COOP_SALVO_SPECIAL_AURA_DURATION;
      update(duration + 0.01);
      const advanced = coopSalvoState?.phase === 'special-cutin';
      return {
        advanced,
        phase: coopSalvoState?.phase || null,
        duration: coopSalvoSpecialFlash?.duration || 0,
        entries: (coopSalvoSpecialFlash?.entries || []).map(entry => ({ ...entry })),
        projectileCount: projectiles.length,
      };
    },
    drawCoopSpecialSalvoForTest: (elapsedSeconds) => {
      if (coopSalvoSpecialFlash) {
        const duration = coopSalvoSpecialFlash.duration || COOP_SALVO_SPECIAL_FLASH_DURATION;
        coopSalvoSpecialFlash.timer = Number.isFinite(elapsedSeconds)
          ? Math.max(0.001, duration - Math.max(0, elapsedSeconds))
          : duration * 0.45;
      }
      globalThis.__ktTextLog.length = 0;
      globalThis.__ktTextDrawLog.length = 0;
      drawCoopSalvoSpecialFlash();
      return {
        text: globalThis.__ktTextLog.slice(),
        details: globalThis.__ktTextDrawLog.map(entry => ({ ...entry })),
      };
    },
    launchCoopSupportSalvoForTest: () => {
      projectiles = [];
      const jumper = unitById('p1');
      const rescuer = unitById('p2');
      if (!jumper || !rescuer) throw new Error('support salvo test requires 2v2 units');
      jumper.jumpAvailable = true;
      jumper.moveLockTurns = 0;
      rescuer.coopItem = 'rescue-kit';
      rescuer.coopItemUsesLeft = 1;
      coopSalvoState = {
        phase: 'resolving', participants: ['p1', 'p2'], expected: ['p1', 'p2'], ready: new Set(['p1', 'p2']),
        actions: [
          { unitId: 'p1', anchor: unitAnchor(jumper), vx0: 7, vy0: -5, useSpecial: false, useJump: true, subweaponId: null, coopItemId: null },
          { unitId: 'p2', anchor: unitAnchor(rescuer), vx0: 7, vy0: -5, useSpecial: false, useJump: false, subweaponId: null, coopItemId: 'rescue-kit' },
        ],
        nextLaunchIndex: 0, physicsTick: 0, launchTicks: [], deferredMatchEndReason: '',
      };
      stepCoopSalvoLaunchQueue();
      coopSalvoState.physicsTick = COOP_SALVO_LAUNCH_INTERVAL_TICKS;
      stepCoopSalvoLaunchQueue();
      return {
        projectiles: projectiles.map(projectile => ({ owner: projectile.owner, jump: projectile.jump, coopItemId: projectile.coopItemId })),
        jumpAvailable: jumper.jumpAvailable,
        rescueUsesLeft: rescuer.coopItemUsesLeft,
        launchTicks: coopSalvoState.launchTicks.slice(),
      };
    },
    moveLockVisualForTest: (id) => typeof moveLockStatus === 'function' ? moveLockStatus(unitById(id)) : null,
    actionSkipVisualForTest: (id) => typeof actionSkipStatus === 'function' ? actionSkipStatus(unitById(id)) : null,
    actionSkipStunConfigForTest: () => ({
      duration: ACTION_SKIP_STUN_DURATION,
      shakePx: ACTION_SKIP_SHAKE_PX,
      hitFlashDuration: ACTION_SKIP_HIT_FLASH_DURATION,
      effectDurationMultiplier: ACTION_SKIP_EFFECT_DURATION_MULTIPLIER
    }),
    actionSkipSequenceForTest: () => cutIn && cutIn.kind === 'actionSkip' ? ({
      waitingForHitFlash: !!(cutIn.waitForSpecialFlash && specialFlash.timer > 0),
      presentationVisible: !(cutIn.waitForSpecialFlash && specialFlash.timer > 0),
      timer: cutIn.timer,
      duration: cutIn.duration
    }) : null,
    // owner は**ユニットのidの文字列**。実際の発射経路(launchShot)がそう渡している。
    // ここでユニットそのものを渡すと creditDamage が黙って何もしなくなり、検査が甘くなる。
    explodeAtForTest: (x, y, blastMul, ownerId, normalImpactSound, projectile = null) => (
      explodeAt(x, y, blastMul || 1, ownerId, 1, !!normalImpactSound, false, blastMul || 1,
        Number(projectile?.knockbackSpeed) || 0, false, projectile)
    ),
    explodeDrainAtForTest: (x, y, blastMul, ownerId, projectile = null) => (
      explodeAt(x, y, blastMul || 1, ownerId, 1, false, true, blastMul || 1,
        Number(projectile?.knockbackSpeed) || 0, false, projectile)
    ),
    normalGearKnockbackBaseForTest: () => NORMAL_GEAR_KNOCKBACK_BASE,
    setNormalImpactBufferForTest: () => { normalImpactBuffer = { __decodedAudio: true }; },
    decodedAudioStartsForTest: () => globalThis.__ktDecodedAudioStarts,
    triggerTitleWallImpactForTest: () => {
      beginWallBreak({ x: VW / 2, y: VH / 2 });
      updateWallBreak(WALL_IMPACT_SEC);
    },
    fireworkShardExplodeForTest: (x, y, ownerId) => fireworkShardExplode({ owner: ownerId }, 1, x, y),
    damageGroundFlameForTest: (x, y, ownerId) => damageGroundFlameTick({ x, y, owner: ownerId, remoteShot: false, ticksDone: 0, tickTimer: 0 }),
    fireworkConfigForTest: () => ({
      proximityRadius: typeof FIREWORK_PROXIMITY_RADIUS === 'undefined' ? null : FIREWORK_PROXIMITY_RADIUS,
      armDistance: typeof FIREWORK_ARM_DISTANCE === 'undefined' ? null : FIREWORK_ARM_DISTANCE,
      shardSpeed: typeof FIREWORK_SHARD_SPEED === 'undefined' ? null : FIREWORK_SHARD_SPEED,
      shardBlasts: typeof FIREWORK_SHARD_BLASTS === 'undefined' ? [] : FIREWORK_SHARD_BLASTS.slice()
    }),
    fireworkProximityProbeForTest: (ownerId, targetId, offset, travelDistance) => {
      if (typeof fireworkProximityTarget !== 'function') return null;
      const target = unitById(targetId);
      if (!target) return null;
      const a = unitHitCenter(target);
      const hit = fireworkProximityTarget({
        owner: ownerId,
        x: a.x - Number(offset || 0), y: a.y,
        travelDistance: Number(travelDistance || 0)
      });
      return hit ? hit.id : null;
    },
    projectileOwnerKind: () => projectiles.map(p => typeof p.owner),
    damageTexts: () => floatTexts.map(t => t.text),
    clearDamageTexts: () => { floatTexts.length = 0; },
    unitDefeated: (id) => unitDefeated(unitById(id)),
    saveSuspendedForTest: () => saveSuspendedMatch(),
    loadSuspendedForTest: () => loadSuspendedMatch(),
    applySnapshotForTest: (data) => applySnapshot(data),
    buildSnapshotForTest: () => JSON.parse(JSON.stringify(buildSnapshot())),
    canvas
  };
  const __panelLog = [];
  { // drawUnitPanel を包んで「左右どちらにどのユニットが出たか」を記録する
    const orig = drawUnitPanel;
    drawUnitPanel = function (u, edgeX, align, cardY, h) {
      __panelLog.push({ id: u.id, align, edgeX, cardY, h });
      return orig.apply(this, arguments);
    };
  }
`;
const tail = '\n})();';
const idx = code.lastIndexOf('})();');
if (idx < 0) throw new Error('IIFE tail not found');
code = code.slice(0, idx) + HOOK + '\n' + code.slice(idx);

// ---- ブラウザAPIのスタブ ----
const noop = () => {};
// 描かれた文字の記録。ctxのスタブはこのファイルのスコープなので globalThis に置き、
// ゲーム側スコープのフックからも同じ配列を見られるようにする。
globalThis.__ktTextLog = [];
globalThis.__ktTextDrawLog = [];
globalThis.__ktDecodedAudioStarts = 0;
function makeCtx() {
  const ctx = {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, filter: 'none', miterLimit: 10, lineDashOffset: 0
  };
  const methods = ['save','restore','beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo',
    'arc','arcTo','ellipse','rect','roundRect','fill','stroke','clip','fillRect','strokeRect','clearRect',
    'fillText','strokeText','translate','rotate','scale','transform','setTransform','resetTransform',
    'drawImage','putImageData','setLineDash','getLineDash'];
  for (const k of methods) ctx[k] = noop;
  // 描かれた文字と座標を控える。「画像が無くても名前は出るか」に加え、
  // 小さい枠へ文字が食い込んでいないかも同じ描画結果から検査する。
  ctx.fillText = (text, x, y) => {
    globalThis.__ktTextLog.push(String(text));
    globalThis.__ktTextDrawLog.push({
      text: String(text), x, y, font: ctx.font,
      fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth
    });
  };
  // 最後に指示された座標変換。キャンバスの画素数と食い違うと、絵が画面から
  // はみ出すか小さく寄る。大きさだけ見ていると気づけないので記録する。
  ctx.setTransform = (a, b, c, d, e, f) => { globalThis.__ktTransform = [a, b, c, d, e, f]; };
  ctx.measureText = () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop: noop });
  ctx.createPattern = () => ({});
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.isPointInPath = () => false;
  return ctx;
}
function makeCanvas(w = 540, h = 960) {
  const el = makeElement('canvas');
  el.width = w; el.height = h;
  const ctx = makeCtx();
  ctx.canvas = el;
  el.getContext = () => ctx;
  el.toDataURL = () => 'data:,';
  return el;
}
function makeElement(tag) {
  const listeners = new Map();
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], value: '', textContent: '', currentTime: 0, volume: 1, loop: false, muted: false,
    width: 0, height: 0, clientWidth: 540, clientHeight: 960,
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener: noop,
    dispatchEvent: (ev) => { for (const fn of (listeners.get(ev.type) || [])) fn(ev); return true; },
    __fire: (type, ev) => { for (const fn of (listeners.get(type) || [])) fn(Object.assign({ type, preventDefault: noop, stopPropagation: noop }, ev)); },
    setPointerCapture: noop, releasePointerCapture: noop, focus: noop, blur: noop, click: noop,
    // 子を実際に覚えておく。ロビーの席ボードのように「組み立てたDOMを検査したい」
    // テストのために必要。firstChild/removeChild も本物と同じ意味で動かさないと、
    // renderFirebaseLobby の「全部消してから作り直す」ループが空回りする。
    appendChild: (c) => { el.children.push(c); return c; },
    removeChild: (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    setAttribute: noop, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 540, height: 960, right: 540, bottom: 960, x: 0, y: 0 }),
    play: () => Promise.resolve(), pause: noop, load: noop
  };
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
  return el;
}

const elements = new Map();
const gameCanvas = makeCanvas();
elements.set('game', gameCanvas);
// onlineSlots / onlineBattleRecord はロビー内で組み立てたDOMを検査したいので実体を持たせる。
for (const id of ['debugPanel', 'titleBgm', 'stageBgm', 'roomBgm', 'bonusBgm', 'nameOverlay', 'nameInput', 'nameOk', 'nameCancel', 'onlineSlots', 'onlineBattleRecord']) {
  elements.set(id, makeElement(id.includes('Bgm') ? 'audio' : 'div'));
}
elements.set('onlineCharacterPicker', makeElement('div'));
elements.set('onlineCharacter', makeElement('select'));
elements.set('onlineCharacterPreview', makeElement('img'));
elements.set('onlineGearMode', makeElement('select'));
elements.set('onlineGearModeStatus', makeElement('div'));

// A one-shot pre-evaluation seed makes startup-recovery tests exercise the
// real bootstrap ordering.  It is deliberately not a production hook and is
// consumed before index.html is evaluated.
const initialStorage = globalThis.__KATAMON_TEST_INITIAL_STORAGE__;
if (initialStorage !== undefined) delete globalThis.__KATAMON_TEST_INITIAL_STORAGE__;
const store = new Map(initialStorage && typeof initialStorage === 'object' && !Array.isArray(initialStorage)
  ? Object.entries(initialStorage).map(([key, value]) => [key, String(value)])
  : []);
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

globalThis.document = Object.assign(makeElement('document'), {
  getElementById: id => elements.get(id) || null,
  querySelector: () => null,
  createElement: tag => (tag === 'canvas' ? makeCanvas(8, 8) : makeElement(tag)),
  hidden: false,
  lastModified: new Date().toUTCString(),
  body: makeElement('body'),
  documentElement: makeElement('html'),
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }
});

class ImageStub {
  constructor() { this.width = 64; this.height = 64; this.complete = false; }
  set src(v) { this._src = v; setTimeout(() => { this.complete = true; if (this.onerror) this.onerror(); }, 0); }
  get src() { return this._src; }
  addEventListener() {}
}
globalThis.Image = ImageStub;
globalThis.HTMLMediaElement = { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 };

const chain = (o) => { o.connect = (dest) => dest || o; o.disconnect = noop; return o; };
class AudioCtxStub {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return chain({ gain: { value: 1, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop, cancelScheduledValues: noop } }); }
  createOscillator() { return chain({ type: 'sine', frequency: { value: 440, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, detune: { value: 0, setValueAtTime: noop }, start: noop, stop: noop }); }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
  createBufferSource() {
    const source = chain({ buffer: null, stop: noop, loop: false, playbackRate: { value: 1, setValueAtTime: noop } });
    source.start = () => {
      if (source.buffer && source.buffer.__decodedAudio) globalThis.__ktDecodedAudioStarts++;
    };
    return source;
  }
  createBiquadFilter() { return chain({ type: 'lowpass', frequency: { value: 1000, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { value: 1 }, gain: { value: 0 } }); }
  createDynamicsCompressor() { return chain({ threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 } }); }
  createStereoPanner() { return chain({ pan: { value: 0, setValueAtTime: noop } }); }
  createWaveShaper() { return chain({ curve: null, oversample: 'none' }); }
}

// rAF は自動では回さない。テスト側が step() で明示的に時間を進める。
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.fetch = () => Promise.reject(new Error('offline stub'));

// window は pointerup を受け取るので、素通しではなくリスナーを保持する要素スタブにする。
const win = Object.assign(makeElement('window'), {
  innerWidth: 540, innerHeight: 960, devicePixelRatio: 1,
  AudioContext: AudioCtxStub, webkitAudioContext: AudioCtxStub,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop })
});
globalThis.window = win;
globalThis.AudioContext = AudioCtxStub;
// Browser Web Locks are required by the Gear cross-key transaction and the
// Phase 2C CPU-run lifecycle.  The harness intentionally grants immediately
// so legacy synchronous test hooks retain their existing contract; dedicated
// concurrency tests inject a controllable manager afterwards.
const immediateWebLocks = {
  request: (name, options, callback) => callback({ name, options })
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node-harness', vibrate: noop, locks: immediateWebLocks },
  configurable: true,
  writable: true
});
globalThis.localStorage.gearMutationLockManager = immediateWebLocks;
globalThis.location = { search: `?seat=${SEAT}`, protocol: 'http:', hostname: 'localhost', href: `http://localhost/?seat=${SEAT}`, reload: noop };
globalThis.history = { back: noop, pushState: noop, replaceState: noop };
globalThis.matchMedia = win.matchMedia;
globalThis.devicePixelRatio = 1;

// ---- 実行 ----
(0, eval)(code);
module.exports = { kt: () => globalThis.__kt, canvas: gameCanvas, SEAT };
