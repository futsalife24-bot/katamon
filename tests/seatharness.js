// カタモン Stage 2a 検証ハーネス
// index.html の <script> を抜き出し、Canvas/Audio/DOM をスタブしたNode上で実行して
// 「席(localUnit/foeUnit)の切り離しが効いているか」を自動で確かめる。
// 単体では使わない。tests/seattest.js と tests/regressiontest.js から読み込む。
//   node tests/seattest.js p1    (通常の席)
//   node tests/seattest.js e1    (オンライン対戦のゲスト想定の席)
const fs = require('fs');
const path = require('path');
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

const SEAT = process.argv[2] === 'e1' ? 'e1' : 'p1';
const HTML = path.join(__dirname, '..', 'index.html');

// ---- スクリプト抽出 ----
const html = fs.readFileSync(HTML, 'utf8');
const m = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error('script tag not found');
let code = m[1];

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
      signature: titleArtSignature()
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
        bonus: { ...titleBonusBtn }, ranking: { ...titleRankingBtn }, update: { ...titleUpdateBtn }
      }
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
      titleTimeBackgroundReady = true;
      titleTimeBackgroundFailed = false;
      titleLogoReady = true;
      titleLogoFailed = false;
      titleLogoImage.complete = true;
      titleLogoImage.naturalWidth = 1530;
      titleLogoImage.naturalHeight = 1170;
      if (typeof titleWoodUiImages !== 'undefined') {
        for (const image of Object.values(titleWoodUiImages)) {
          image.complete = true;
          image.naturalWidth = 1000;
          image.naturalHeight = 800;
        }
      }
      return true;
    },
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
    startBattle: (key) => { selectCharacterAndStart(key || CHARACTER_LIST[0]); },
    setTerrain: (pattern) => { newTerrain(pattern); },
    setFlatTerrainForTest: (surface = 420) => {
      const y = Math.max(0, Math.min(TERRAIN_BOTTOM_Y - 60, Number(surface)));
      const segments = Array.from({ length: TERRAIN_COLS }, () => [[y, TERRAIN_BOTTOM_Y]]);
      loadTerrainFromSave(segments, [], 'rolling', false, THEME_KEYS[0], 1, null, null);
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
    setCameraSliderValueForTest: (value) => setCameraZoomFromSlider({
      x: CAMERA_SLIDER.x + CAMERA_SLIDER.w * Number(value),
      y: CAMERA_SLIDER.y
    }),
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
      dSmash: !!p.dSmash,
      barucopterMarker: !!p.barucopterMarker,
      barucopterBullet: !!p.barucopterBullet,
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
    resolveProjectileUnitImpactForTest: (index, unitId) => {
      const p = projectiles[index];
      const target = unitById(unitId);
      if (!p || !target) return false;
      if (p.barucopterBullet && typeof resolveBarucopterBulletUnitImpact === 'function') {
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
    impactVisualCountsForTest: () => ({
      explosions: particles.length,
      lightningRemnants: lightningBeams.length,
      groundFlames: typeof groundFlames === 'undefined' ? 0 : groundFlames.length
    }),
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
    startFree: () => { startFreeMatch(); },
    resultTitleBtn: () => ({ ...resultTitleBtn, shift: resultButtonShift() }),
    continueBtn: () => ({ ...continueBtn, shift: resultButtonShift() }),
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
    proto: () => PROTO_VERSION,
    stage3: () => ({ normalizeRoomCode, isRoomCode, generateRoomCode, parseFirebaseSse, createSseDeduper, commitPayload, fairFirstPlayer, hasSafeSnapshot, snapshotValidationReason, normalizeFirebaseSnapshot, validateFirebaseMessage, validateFirebaseMessageDetail, acceptPeerCommit, acceptPeerReveal, firebaseActionMatches, bufferFirebaseTerminal, firebaseFlowAllows, stateSnapshotMatchesBaseline, stateSnapshotMismatchReason, firebasePushId, stableFirebaseJson, normalizeFirebaseMessageForCompare, createSerialSendQueue, advanceFirebasePendingVisibleTime, advanceFirebasePeerLiveness, resetFirebasePeerLiveness, advanceFirebaseLobbyLiveness, firebaseSeatStale, onlineErrorTitle, canLeaveFirebaseLobby, estimateFirebaseServerNow, firebaseServerTimeOffsetFromToken,
      computeDamage, roomTtlMs: () => ROOM_TTL_MS, roomLeaseRenewMs: () => ROOM_LEASE_RENEW_MS,
      firebaseProto: () => FIREBASE_PROTO_VERSION, firebaseSeats: () => FIREBASE_SEATS.slice(), firebasePlayerSeats: () => FIREBASE_PLAYER_SEATS.slice(), firebaseRoundId, normalizeLobbySettings, firebasePacketSeatAllowed,
      receiveFirebaseForTest: msg => netReceiveInner(msg),
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
      setActiveUnitForTest: (id) => { const i = turnOrder.indexOf(id); if (i >= 0) activeIndex = i; return activeUnit().id; }
    }),
    setPhase: (p) => { gamePhase = p; },
    phase: () => gamePhase,
    setBattleModeForTest: (mode) => { battleMode = mode; },
    // 画面の揺れ。対戦中以外でも必ず止まることを見るため(v110の起動演出で震え続けた)。
    shakeTimer: () => shakeTimer,
    triggerShakeForTest: (mag, sec) => triggerShake(mag, sec),
    // おまけ曲(タイトルの「おまけ」ボタン)
    bonusBtn: () => ({ ...titleBonusBtn }),
    titleBtnRects: () => ({
      cpu: { ...titleVsCpuBtn }, online: { ...titleOnlineBtn }, free: { ...titleFreeBtn },
      tutorial: { ...titleTutorialBtn },
      bonus: { ...titleBonusBtn }, ranking: { ...titleRankingBtn }, update: { ...titleUpdateBtn }
    }),
    titleUpdateHistoryInfo: () => ({
      build: typeof BUILD_ID === 'undefined' ? '' : BUILD_ID,
      history: typeof LATEST_UPDATE_HISTORY === 'undefined' ? null : { ...LATEST_UPDATE_HISTORY },
      entries: typeof UPDATE_HISTORY === 'undefined' ? [] : UPDATE_HISTORY.map(entry => ({ ...entry })),
      open: typeof updateHistoryOpen === 'undefined' ? false : updateHistoryOpen,
      update: { ...titleUpdateBtn },
      panel: typeof titleUpdateHistoryPanel === 'undefined' ? null : { ...titleUpdateHistoryPanel },
      modal: typeof titleUpdateHistoryModal === 'undefined' ? null : { ...titleUpdateHistoryModal },
      close: typeof titleUpdateHistoryCloseBtn === 'undefined' ? null : { ...titleUpdateHistoryCloseBtn }
    }),
    bgm: () => ({ bonusTrack: bonusBgmTrack, desired: desiredBgm(), current: currentBgmKind() }),
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
    freePreviewShouldMirror: (kind, imageKey) => (typeof freePreviewShouldMirror === 'function'
      ? freePreviewShouldMirror(kind, imageKey)
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
    hudBottom: () => 116 + hudShift(),
    minimapTop: () => minimapTop(),
    turnBarTop: () => 94 + hudShift(),
    cpuPickTarget: (id) => { const t = cpuPickTarget(unitById(id)); return t ? t.id : null; },
    cpuFriendlyFireRadius: () => CPU_FRIENDLY_FIRE_RADIUS,
    emitEmpForTest: (x, y, radius, ownerId, turns) => emitEmp(x, y, radius, ownerId, turns || 1),
    emitNyanDisableForTest: (x, y, radius, ownerId) => emitEmp(x, y, radius, ownerId, 1, 'turnSkip'),
    turnEffectForTest: (id) => {
      const u = unitById(id);
      return u ? { moveLockTurns: u.moveLockTurns || 0, actionSkipTurns: u.actionSkipTurns || 0 } : null;
    },
    specialFlashForTest: () => specialFlash && specialFlash.timer > 0 ? { ...specialFlash } : null,
    clearSpecialFlashForTest: () => { specialFlash = { timer: 0, key: null, text: '', color: '', sub: '' }; },
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
    explodeAtForTest: (x, y, blastMul, ownerId, normalImpactSound) => (
      explodeAt(x, y, blastMul || 1, ownerId, 1, !!normalImpactSound)
    ),
    setNormalImpactBufferForTest: () => { normalImpactBuffer = { __decodedAudio: true }; },
    decodedAudioStartsForTest: () => globalThis.__ktDecodedAudioStarts,
    triggerTitleWallImpactForTest: () => {
      beginWallBreak({ x: VW / 2, y: VH / 2 });
      updateWallBreak(WALL_IMPACT_SEC);
    },
    fireworkShardExplodeForTest: (x, y, ownerId) => fireworkShardExplode({ owner: ownerId }, 1, x, y),
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

const store = new Map();
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
globalThis.navigator = { userAgent: 'node-harness', serviceWorker: undefined, vibrate: noop };
globalThis.location = { search: `?seat=${SEAT}`, protocol: 'http:', hostname: 'localhost', href: `http://localhost/?seat=${SEAT}`, reload: noop };
globalThis.history = { back: noop, pushState: noop, replaceState: noop };
globalThis.matchMedia = win.matchMedia;
globalThis.devicePixelRatio = 1;

// ---- 実行 ----
(0, eval)(code);
module.exports = { kt: () => globalThis.__kt, canvas: gameCanvas, SEAT };
