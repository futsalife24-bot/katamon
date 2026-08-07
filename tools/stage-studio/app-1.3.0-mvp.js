(function () {
  'use strict';

  const APP_VERSION = '1.3.0-mvp';
  const Core = globalThis.StageCore || null;
  const StageZip = globalThis.StageZip || null;
  const SharedStorage = globalThis.StageStorage || null;
  const RAW_LIMITS = Core && Core.LIMITS ? Core.LIMITS : {};
  const LIMITS = Object.assign({}, RAW_LIMITS, {
    stageWidth: RAW_LIMITS.stageWidth || 1440,
    stageHeight: RAW_LIMITS.stageHeight || 660,
    terrainBottomY: RAW_LIMITS.terrainBottomY || RAW_LIMITS.terrainBottom || 636,
    columnWidth: RAW_LIMITS.columnWidth || 3,
    rowHeight: RAW_LIMITS.rowHeight || 4,
    terrainColumns: RAW_LIMITS.terrainColumns || RAW_LIMITS.columns || 480,
    terrainRows: RAW_LIMITS.terrainRows || RAW_LIMITS.rows || 165,
    unitRadius: RAW_LIMITS.unitRadius || 18,
    maxSpawnPoints: RAW_LIMITS.maxSpawnPoints || RAW_LIMITS.maxSpawns || 4,
    maxJsonBytes: RAW_LIMITS.maxJsonBytes || RAW_LIMITS.maxFileBytes || 2 * 1024 * 1024,
    maxZipBytes: RAW_LIMITS.maxZipBytes || 6 * 1024 * 1024,
    maxTitleLength: RAW_LIMITS.maxTitleLength || 48,
    maxDescriptionLength: RAW_LIMITS.maxDescriptionLength || 500,
    maxAuthorLength: RAW_LIMITS.maxAuthorLength || 32
  });
  /* Fallback properties above deliberately mirror the shared module's fixed game dimensions. */
  const RAW_PHYSICS = Core && Core.PHYSICS ? Core.PHYSICS : {};
  const PHYSICS = Object.assign({}, RAW_PHYSICS, {
    fixedDt: RAW_PHYSICS.fixedDt || 1 / 120,
    gravity: RAW_PHYSICS.gravity || 650,
    windAccelerationMax: RAW_PHYSICS.windAccelerationMax || RAW_PHYSICS.windAccelMax || 260,
    velocityScale: RAW_PHYSICS.velocityScale || 7.8,
    projectileRadius: RAW_PHYSICS.projectileRadius || 5,
    normalBlastRadius: RAW_PHYSICS.normalBlastRadius || RAW_PHYSICS.defaultExplosionRadius || 44,
    deadLineY: Number.isFinite(RAW_PHYSICS.deadLineY) ? RAW_PHYSICS.deadLineY : LIMITS.terrainBottomY,
    fallTrigger: Number.isFinite(RAW_PHYSICS.fallTrigger) ? RAW_PHYSICS.fallTrigger : 22
  });
  const SCREEN_ORDER = ['home', 'new', 'generate', 'terrain', 'spawns', 'playtest', 'validate', 'export'];
  const SCREEN_ALIASES = Object.freeze({ gimmicks: 'playtest', appearance: 'terrain' });
  const SLOT_ORDER = ['p1', 'e1', 'p2', 'e2'];
  const TERRAIN_TOOL_LABELS = Object.freeze({
    draw: '描く', erase: '削る', guide: 'キャラ確認', fill: '塗りつぶし',
    line: '線', rectangle: '四角', circle: '円'
  });
  const PRESET_LABELS = {
    flat: '平原', rolling: '丘陵', plateauLeft: '左高台', plateauRight: '右高台',
    mountainCenter: '中央山', valley: '渓谷', grandCanyon: '大峡谷', centerHole: '中央穴',
    crater: 'クレーター', stairs: '階段', symmetric: '左右対称', asymmetric: '左右非対称',
    fortress: '要塞', floatingIslands: '浮島', platforms: '複数足場', cave: '洞窟',
    elevation: '高低差重視', random: 'ランダム'
  };
  /* Keep these values aligned with the target game's canonical stage themes. */
  const THEME_COLORS = Object.freeze({
    grass: {
      sky: '#1a2340', terrain: '#7a5a3a', gradient: ['#1a2340', '#4a5a8a'],
      dirtTop: '#7a5a3a', dirtBottom: '#33241a', rim: '#9be08a', rimShadow: '#4f8a4f',
      strata: 'rgba(255,222,160,0.10)', stoneLight: 'rgba(236,213,172,0.16)', stoneDark: 'rgba(38,24,16,0.20)'
    },
    desert: {
      sky: '#3a2b1a', terrain: '#c9954a', gradient: ['#3a2b1a', '#c98a4a'],
      dirtTop: '#c9954a', dirtBottom: '#5a3a1c', rim: '#e0c37a', rimShadow: '#a97f30',
      strata: 'rgba(255,223,153,0.14)', stoneLight: 'rgba(255,226,168,0.18)', stoneDark: 'rgba(83,44,18,0.20)'
    },
    snow: {
      sky: '#233047', terrain: '#e8eef5', gradient: ['#233047', '#7c9bb8'],
      dirtTop: '#e8eef5', dirtBottom: '#6f7f93', rim: '#ffffff', rimShadow: '#b9cadd',
      strata: 'rgba(214,240,255,0.17)', stoneLight: 'rgba(255,255,255,0.22)', stoneDark: 'rgba(62,87,116,0.17)'
    },
    volcanic: {
      sky: '#200f14', terrain: '#5a4038', gradient: ['#200f14', '#8a3018'],
      dirtTop: '#5a4038', dirtBottom: '#180f0d', rim: '#ff7a3a', rimShadow: '#a8371a',
      strata: 'rgba(255,105,47,0.12)', stoneLight: 'rgba(255,142,91,0.13)', stoneDark: 'rgba(10,5,5,0.30)'
    }
  });
  const BACKGROUND_SOURCES = Object.freeze({
    grass: '../../assets/stage-grass-bg.jpg',
    desert: '../../assets/stage-desert-bg.jpg',
    snow: '../../assets/stage-snow-bg.jpg',
    volcanic: '../../assets/stage-volcanic-bg.jpg'
  });
  const CHARACTER_SOURCES = Object.freeze({
    kyoryu: ['../../assets/kyoryu.webp', '../../assets/kyoryu.png'],
    medama: ['../../assets/medama.webp', '../../assets/medama.png'],
    tori: ['../../assets/tori.webp', '../../assets/tori.png'],
    iwa: ['../../assets/iwa.webp', '../../assets/iwa.png']
  });
  const SLOT_CHARACTER = Object.freeze({ p1: 'kyoryu', e1: 'medama', p2: 'tori', e2: 'iwa' });
  const SPRITE_SIZE = 78;
  const SPRITE_REFERENCE_ASPECT = 1.318;
  const UNIT_HIT_RADIUS = 30;
  const UNIT_HIT_RISE = 23;
  const LOW_POWER_AUTO_DETECTED = (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 4)
    || (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 4);
  const ISSUE_MESSAGES = {
    'schema.root': 'ステージデータの形式が正しくありません。',
    'schema.version': '対応していないステージ形式です。',
    'stage.size': '対象ゲームに対応する固定サイズではありません。',
    'stage.id': 'ステージIDが正しくありません。',
    'stage.title': 'ステージ名を1〜48文字で入力してください。',
    'stage.description': '説明が長すぎます。',
    'stage.author': '作成者表示名が長すぎます。',
    'compatibility.game': '対象ゲームとの互換情報が正しくありません。',
    'coordinate.system': '座標系が正しくありません。',
    'terrain.empty': '地形がありません。地形を描いてください。',
    'terrain.columns': '地形データの列数が正しくありません。',
    'terrain.segmentRange': '地形の範囲または厚みが不正です。',
    'terrain.thin': '薄い地形があり、キャラクターが引っ掛かる可能性があります。',
    'terrain.complex': '地形が複雑で、低性能端末では重くなる可能性があります。',
    'spawn.insufficient': '出撃地点を2つ以上配置してください。',
    'spawn.tooMany': '出撃地点は最大4つです。',
    'spawn.invalid': '出撃地点の座標が正しくありません。',
    'spawn.duplicate': '出撃地点が重複しています。',
    'spawn.outside': '画面外の出撃地点があります。',
    'spawn.insideTerrain': '地形内に埋まっている出撃地点があります。',
    'spawn.falling': '出撃直後に落下する地点があります。',
    'spawn.notGrounded': '地面から離れた出撃地点があります。',
    'spawn.nearCliff': '崖に近い出撃地点があります。',
    'spawn.overlap': '出撃地点同士が近すぎます。',
    'spawn.teams': '両チームの出撃地点が必要です。',
    'gimmick.unsupported': '未対応のギミックが含まれています。',
    'gimmick.windRange': '風の設定範囲が正しくありません。',
    'gimmick.windDuplicate': '風ギミックが重複しています。',
    'background.unsupported': '未対応の背景が指定されています。',
    'material.unsupported': '未対応の地形素材が指定されています。',
    'fairness.height': 'チーム間の平均高度に大きな差があります。',
    'fairness.distance': 'チーム間の中央までの距離差が大きめです。',
    'performance.terrain': '推定描画負荷が高めです。',
    'file.tooLarge': 'ファイル容量の上限を超えています。',
    unsupported_version: '対応していないステージ形式です。',
    stage_id: 'ステージIDが正しくありません。',
    title: 'ステージ名を入力してください。',
    title_length: 'ステージ名が長すぎます。',
    description_length: '説明が長すぎます。',
    game_compatibility: '対象ゲームとの互換情報が正しくありません。',
    stage_size: '対象ゲームに対応する固定サイズではありません。',
    coordinate_system: '座標系が正しくありません。',
    terrain_shape: '地形データの列数または形式が正しくありません。',
    terrain_segment: '地形の座標または並び順が正しくありません。',
    thin_terrain: '薄い地形があり、キャラクターが引っ掛かる可能性があります。',
    complex_terrain: '地形が複雑で、低性能端末では重くなる可能性があります。',
    spawn_count: '出撃地点を2つ以上配置してください。',
    spawn_limit: '出撃地点は最大4つです。',
    spawn_bounds: '画面外の出撃地点があります。',
    spawn_inside_terrain: '地形内に埋まっている出撃地点があります。',
    spawn_fall: '出撃直後に落下する可能性があります。',
    spawn_cliff: '崖に近い出撃地点があります。',
    spawn_overlap: '出撃地点同士が重なっています。',
    spawn_required_slots: '赤チーム1と青チーム1の出撃地点が必要です。',
    unsupported_material: 'MVPで未対応の地形素材が含まれています。',
    unsupported_gimmick: 'MVPで未対応のギミックが含まれています。',
    wind_direction: '風向きが正しくありません。',
    wind_strength: '風の強さは0〜100%で指定してください。',
    wind_duplicate: '風ギミックが重複しています。',
    height_imbalance: '左右の平均高度に大きな差があります。',
    spawn_distance: '出撃地点同士が近く、砲撃可能範囲が狭い可能性があります。',
    file_size: 'ファイル容量の上限を超えています。',
    unsafe_key: '危険なプロパティ名が含まれています。',
    unknown_field: '未対応の項目が含まれています。'
  };

  const $ = (id) => document.getElementById(id);
  const clone = (value) => {
    if (Core && typeof Core.clone === 'function') return Core.clone(value);
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nowIso = () => new Date().toISOString();
  const normalizeScreen = (screen) => {
    const candidate = SCREEN_ALIASES[screen] || screen;
    return SCREEN_ORDER.includes(candidate) ? candidate : 'home';
  };

  function loadImageWithFallback(sources) {
    const image = new Image();
    let index = 0;
    image.decoding = 'async';
    image.onload = () => renderAllCanvases();
    image.onerror = () => {
      index += 1;
      if (index < sources.length) image.src = sources[index];
    };
    image.src = sources[index];
    return image;
  }

  const stageBackgroundImages = Object.fromEntries(Object.entries(BACKGROUND_SOURCES)
    .map(([key, source]) => [key, loadImageWithFallback([source])]));
  const characterImages = Object.fromEntries(Object.entries(CHARACTER_SOURCES)
    .map(([key, sources]) => [key, loadImageWithFallback(sources)]));

  const terrainNoiseTile = document.createElement('canvas');
  terrainNoiseTile.width = 28;
  terrainNoiseTile.height = 28;
  (() => {
    const context = terrainNoiseTile.getContext('2d');
    const image = context.createImageData(28, 28);
    let seed = 0x4b415441;
    for (let index = 0; index < image.data.length; index += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const value = seed & 1 ? 255 : 0;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = Math.abs(seed >>> 24) % 47;
    }
    context.putImageData(image, 0, 0);
  })();

  const state = {
    stage: null,
    grid: new Uint8Array(LIMITS.terrainColumns * LIMITS.terrainRows),
    currentScreen: 'home',
    activeTool: 'draw',
    characterGuides: [],
    activeGuideIndex: 0,
    guideDrag: null,
    activeSpawn: 'p1',
    undo: [],
    redo: [],
    maxHistory: 24,
    lastValidation: null,
    view: { zoom: 1, panX: 0, panY: 0 },
    pointerMap: new Map(),
    strokeActive: false,
    lastWorldPoint: null,
    shapeStart: null,
    shapeBaseGrid: null,
    pinch: null,
    noiseCounter: 0,
    generationJob: null,
    generatorWorker: null,
    autosaveTimer: null,
    preferenceSaveTimer: null,
    dirty: false,
    editRevision: 0,
    storageDurable: null,
    storageWarningShown: false,
    testGrid: null,
    testActorX: null,
    testActorY: null,
    testActorStatus: 'grounded',
    testFallTrail: [],
    testTrajectory: [],
    testImpact: null,
    appearanceBrightness: 1,
    deferredInstallPrompt: null,
    pwaUpdateRequested: false,
    orientationLockActive: false,
    orientationFullscreenEntered: false,
    orientationGuideToken: 0,
    lowPowerMode: LOW_POWER_AUTO_DETECTED,
    lowPowerAutoDetected: LOW_POWER_AUTO_DETECTED,
    toastTimer: null,
    ready: false,
    documentStarted: false
  };

  function coreReady() {
    return !!(Core && typeof Core.createStageDocument === 'function' && typeof Core.generateStage === 'function');
  }

  function showToast(message, duration) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, duration || 2600);
  }

  function isLandscapeViewport() {
    return globalThis.innerWidth > globalThis.innerHeight;
  }

  function updateOrientationControls() {
    const landscape = isLandscapeViewport();
    document.querySelectorAll('[data-orientation-toggle]').forEach((button) => {
      const label = button.querySelector('[data-orientation-label]');
      const icon = button.querySelector('[aria-hidden="true"]');
      if (label) label.textContent = landscape ? '縦画面' : '横画面';
      if (icon) icon.textContent = landscape ? '↕' : '↔';
      button.dataset.orientation = landscape ? 'landscape' : 'portrait';
      button.setAttribute('aria-label', landscape ? '縦画面へ戻す' : '横画面へ切り替える');
    });
    requestAnimationFrame(renderAllCanvases);
  }

  function showOrientationGuide(button) {
    const card = button && button.closest('.canvas-card');
    const guide = card && card.querySelector('[data-orientation-guide]');
    const token = ++state.orientationGuideToken;
    if (guide) {
      guide.hidden = false;
      setTimeout(() => {
        if (token === state.orientationGuideToken && !isLandscapeViewport()) guide.hidden = false;
      }, 180);
    }
    showToast('この端末では自動回転できません。画面回転ロックを解除して、端末を横向きにしてください。', 5600);
  }

  async function togglePreferredOrientation(button) {
    const orientation = globalThis.screen && globalThis.screen.orientation;
    if (isLandscapeViewport()) {
      try { if (orientation && typeof orientation.unlock === 'function') orientation.unlock(); } catch (_) {}
      state.orientationLockActive = false;
      if (state.orientationFullscreenEntered && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try { await document.exitFullscreen(); } catch (_) {}
      }
      state.orientationFullscreenEntered = false;
      showToast('縦向きへ戻す場合は端末を縦にしてください。');
      updateOrientationControls();
      return;
    }

    if (!orientation || typeof orientation.lock !== 'function') {
      showOrientationGuide(button);
      return;
    }

    try {
      if (!document.fullscreenElement && document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
        try {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch (_) {
          await document.documentElement.requestFullscreen();
        }
        state.orientationFullscreenEntered = true;
      }
      await orientation.lock('landscape');
      state.orientationLockActive = true;
      state.orientationGuideToken += 1;
      document.querySelectorAll('[data-orientation-guide]').forEach((guide) => { guide.hidden = true; });
      showToast('横画面に切り替えました。');
      updateOrientationControls();
    } catch (_) {
      if (state.orientationFullscreenEntered && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try { await document.exitFullscreen(); } catch (_) {}
      }
      state.orientationFullscreenEntered = false;
      state.orientationLockActive = false;
      showOrientationGuide(button);
    }
  }

  function readableError(error, fallback) {
    if (error && error.code && ISSUE_MESSAGES[error.code]) return ISSUE_MESSAGES[error.code];
    const text = error instanceof Error ? error.message : String(error || '');
    if (text && !/[�]|(?:驛|髯|郢|繝){2,}/.test(text)) return text;
    return fallback || '処理を完了できませんでした。';
  }

  function issueText(issue) {
    if (!issue) return '不明な問題です。';
    return ISSUE_MESSAGES[issue.code] || readableError(issue.message, `確認が必要です（${issue.code || 'unknown'}）。`);
  }

  function markDirty() {
    state.documentStarted = true;
    state.dirty = true;
    state.editRevision += 1;
    state.lastValidation = null;
    if (state.stage) state.stage.updatedAt = nowIso();
    if (state.stage && state.stage.checksums) state.stage.checksums.contentHash = '';
    $('saveState').textContent = '変更を保存中…';
    scheduleAutosave();
    updateHistoryButtons();
    updateExportSummary();
  }

  function navigate(screen, options) {
    screen = normalizeScreen(screen);
    const previousScreen = state.currentScreen;
    document.querySelectorAll('.screen').forEach((node) => node.classList.toggle('is-active', node.dataset.screen === screen));
    document.querySelectorAll('.step-tab').forEach((node) => node.classList.toggle('is-active', node.dataset.step === screen));
    state.currentScreen = screen;
    const active = document.querySelector(`.screen[data-screen="${screen}"]`);
    if (active) active.scrollTop = 0;
    if (!options || !options.fromHistory) {
      const hash = `#${screen}`;
      if (location.hash !== hash) history.pushState({ stageStudioScreen: screen }, '', hash);
    }
    if (screen === 'terrain') renderTerrainCanvas();
    if (screen === 'spawns') { renderSpawnCards(); renderSpawnCanvas(); }
    if (screen === 'playtest') resetPlaytest(false);
    if (screen === 'validate') renderValidation(state.lastValidation);
    if (screen === 'export') updateExportSummary();
    if (state.ready && state.documentStarted && state.stage && previousScreen !== screen) {
      clearTimeout(state.preferenceSaveTimer);
      state.preferenceSaveTimer = setTimeout(() => saveDraftNow(true, true), 250);
    }
  }

  function createFallbackStage(metadata) {
    const randomSource = globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function'
      ? globalThis.crypto.getRandomValues(new Uint8Array(12)) : new Uint8Array(12);
    const randomHex = Array.from(randomSource, (b) => b.toString(16).padStart(2, '0')).join('');
    const createdAt = nowIso();
    return {
      schemaVersion: '1.0.0', stageId: `stage_${randomHex}`, title: metadata.title || 'サンプルステージ',
      description: metadata.description || '', authorDisplayName: metadata.authorDisplayName || '作成者',
      createdAt, updatedAt: createdAt, generatorVersion: '1.0.0', seed: metadata.seed || 'stage-studio',
      gameCompatibility: { gameId: 'katamon', minBuild: 'v138', maxBuild: null },
      stageWidth: LIMITS.stageWidth, stageHeight: LIMITS.stageHeight,
      coordinateSystem: { origin: 'top-left', xAxis: 'right', yAxis: 'down', unit: 'px', terrainColumnWidth: LIMITS.columnWidth, terrainRowHeight: LIMITS.rowHeight },
      terrain: { encoding: 'column-segments-v1', columns: Array.from({ length: LIMITS.terrainColumns }, () => []), destructible: true, minimumThickness: 12 },
      materials: [{ id: 'terrain', type: 'destructible', destructible: true, color: '#7A5435' }],
      spawnPoints: [], gimmicks: [], decorations: { enabled: true, foreground: [], background: [] },
      background: { mode: 'theme', theme: 'grass', color: '#87B9D8', gradient: { from: '#6DA9D2', to: '#D7E8E8' } },
      battleRules: { format: '1v1', maxPlayers: 2, turnLimit: null, rankedAllowed: false, onlineAllowed: false },
      preview: { width: 0, height: 0, mimeType: null, data: null }, generation: { preset: 'blank', parameters: {} },
      checksums: { algorithm: 'SHA-256', contentHash: '' }
    };
  }

  function createDocument(metadata) {
    const options = Object.assign({ title: 'サンプルステージ', authorDisplayName: '作成者', seed: 'stage-studio-001' }, metadata || {});
    return coreReady() ? Core.createStageDocument(options) : createFallbackStage(options);
  }

  function gridFromTerrain(terrain) {
    if (Core && typeof Core.gridFromTerrain === 'function') return Core.gridFromTerrain(terrain);
    if (Core && typeof Core.segmentsToGrid === 'function') return Core.segmentsToGrid(terrain.columns || terrain);
    const grid = new Uint8Array(LIMITS.terrainColumns * LIMITS.terrainRows);
    const columns = terrain && Array.isArray(terrain.columns) ? terrain.columns : [];
    for (let c = 0; c < Math.min(columns.length, LIMITS.terrainColumns); c++) {
      for (const segment of columns[c] || []) {
        const from = clamp(Math.floor(segment[0] / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
        const to = clamp(Math.ceil(segment[1] / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
        for (let r = from; r <= to; r++) grid[r * LIMITS.terrainColumns + c] = 1;
      }
    }
    return grid;
  }

  function columnsFromGrid(grid) {
    if (Core && typeof Core.terrainFromGrid === 'function') return Core.terrainFromGrid(grid);
    if (Core && typeof Core.gridToSegments === 'function') {
      return Core.gridToSegments(grid).map((segments) => segments
        .map((segment) => [clamp(segment[0], 0, LIMITS.terrainBottomY), clamp(segment[1], 0, LIMITS.terrainBottomY)])
        .filter((segment) => segment[1] > segment[0]));
    }
    const columns = Array.from({ length: LIMITS.terrainColumns }, () => []);
    for (let c = 0; c < LIMITS.terrainColumns; c++) {
      let start = -1;
      for (let r = 0; r < LIMITS.terrainRows; r++) {
        const solid = !!grid[r * LIMITS.terrainColumns + c];
        if (solid && start < 0) start = r;
        if ((!solid || r === LIMITS.terrainRows - 1) && start >= 0) {
          const endRow = solid && r === LIMITS.terrainRows - 1 ? r + 1 : r;
          columns[c].push([start * LIMITS.rowHeight, Math.min(LIMITS.terrainBottomY, endRow * LIMITS.rowHeight)]);
          start = -1;
        }
      }
    }
    return columns;
  }

  function syncTerrainToStage() {
    if (!state.stage) return;
    state.stage.terrain.columns = columnsFromGrid(state.grid);
  }

  function syncMetadataFromForm() {
    if (!state.stage) return;
    state.stage.title = $('stageTitle').value.trim().slice(0, LIMITS.maxTitleLength || 48) || 'ステージ';
    state.stage.authorDisplayName = $('stageAuthor').value.trim().slice(0, LIMITS.maxAuthorLength || 32) || '作成者';
    state.stage.description = $('stageDescription').value.trim().slice(0, LIMITS.maxDescriptionLength || 500);
  }

  function syncStageToForm() {
    if (!state.stage) return;
    $('stageTitle').value = state.stage.title || 'ステージ';
    $('stageAuthor').value = state.stage.authorDisplayName || '作成者';
    $('stageDescription').value = state.stage.description || '';
    $('seedInput').value = state.stage.seed || 'stage-studio-001';
    const generation = state.stage.generation || {};
    if (generation.preset && $('presetSelect').querySelector(`option[value="${generation.preset}"]`)) $('presetSelect').value = generation.preset;
    const params = generation.parameters || {};
    if (Number.isFinite(params.elevation)) $('reliefRange').value = Math.round(params.elevation * 100);
    if (Number.isFinite(params.smoothness)) $('smoothRange').value = Math.round(params.smoothness * 100);
    if (Number.isFinite(params.platformCount)) $('platformRange').value = params.platformCount;
    if (Number.isFinite(params.density)) $('densityRange').value = Math.round(params.density * 100);
    if (Number.isFinite(params.valleyDepth)) $('valleyRange').value = Math.round(params.valleyDepth * 100);
    if (Number.isFinite(params.mountainCount)) $('mountainRange').value = Math.round(params.mountainCount);
    if (Number.isFinite(params.cavityRate)) $('cavityRange').value = Math.round(params.cavityRate * 100);
    if (Number.isFinite(params.difficulty)) $('difficultyRange').value = Math.round(params.difficulty * 100);
    $('generationPlayerCount').value = params.playerCount === 4 ? '4' : '2';
    $('symmetryInput').checked = !!params.symmetric;
    const wind = Array.isArray(state.stage.gimmicks) ? state.stage.gimmicks.find((item) => item && item.type === 'globalWind') : null;
    $('windEnabled').checked = !!(wind && wind.enabled !== false);
    $('windDirection').value = wind && Number(wind.direction) < 0 ? '-1' : '1';
    $('windStrength').value = Math.round((wind && Number(wind.strength) || 0.35) * 100);
    const background = state.stage.background || {};
    if (THEME_COLORS[background.theme]) $('themeSelect').value = background.theme;
    $('backgroundMode').value = ['theme', 'gradient', 'color'].includes(background.mode) ? background.mode : 'theme';
    const editableBackground = background.mode === 'gradient' && background.gradient ? background.gradient.from : background.color;
    $('backgroundColor').value = /^#[0-9a-f]{6}$/i.test(editableBackground || '') ? editableBackground : THEME_COLORS[$('themeSelect').value].sky;
    $('terrainColor').value = state.stage.materials && /^#[0-9a-f]{6}$/i.test(state.stage.materials[0] && state.stage.materials[0].color || '') ? state.stage.materials[0].color : THEME_COLORS[$('themeSelect').value].terrain;
    $('brightnessRange').value = Math.round(clamp(state.appearanceBrightness || 1, 0.6, 1.3) * 100);
    $('decorationsEnabled').checked = state.stage.decorations ? state.stage.decorations.enabled !== false : true;
    $('spawnCount').value = state.stage.spawnPoints && state.stage.spawnPoints.length >= 4 ? '4' : '2';
    updateRangeOutputs();
    updateAppearance();
    updateExportSummary();
  }

  function surfaceYAtGrid(grid, x) {
    const column = clamp(Math.floor(x / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    for (let row = 0; row < LIMITS.terrainRows; row++) {
      if (grid[row * LIMITS.terrainColumns + column]) return row * LIMITS.rowHeight;
    }
    return LIMITS.stageHeight;
  }

  function defaultCharacterGuides(grid) {
    return [
      { x: LIMITS.stageWidth * 0.28, character: 'kyoryu', direction: 'right' },
      { x: LIMITS.stageWidth * 0.72, character: 'medama', direction: 'left' }
    ].map((guide) => ({
      x: guide.x,
      y: surfaceYAtGrid(grid, guide.x) - LIMITS.unitRadius,
      character: guide.character,
      direction: guide.direction
    }));
  }

  function setStage(stage, options) {
    clearTimeout(state.autosaveTimer);
    state.dirty = false;
    state.stage = clone(stage);
    state.grid = gridFromTerrain(state.stage.terrain);
    state.characterGuides = defaultCharacterGuides(state.grid);
    state.activeGuideIndex = 0;
    state.guideDrag = null;
    state.appearanceBrightness = 1;
    state.undo = [];
    state.redo = [];
    state.lastValidation = null;
    state.view = { zoom: 1, panX: 0, panY: 0 };
    state.shapeStart = null;
    state.shapeBaseGrid = null;
    state.noiseCounter = 0;
    syncStageToForm();
    renderSpawnCards();
    resetPlaytest(false);
    renderAllCanvases();
    if (!options || !options.skipSave) markDirty();
  }

  function captureSnapshot() {
    return {
      grid: state.grid.slice(),
      spawnPoints: clone(state.stage.spawnPoints || []),
      gimmicks: clone(state.stage.gimmicks || []),
      background: clone(state.stage.background || {}),
      decorations: clone(state.stage.decorations || {}),
      materials: clone(state.stage.materials || []),
      characterGuides: clone(state.characterGuides || []),
      appearanceBrightness: state.appearanceBrightness
    };
  }

  function restoreSnapshot(snapshot) {
    state.grid = snapshot.grid.slice();
    state.stage.spawnPoints = clone(snapshot.spawnPoints);
    state.stage.gimmicks = clone(snapshot.gimmicks);
    state.stage.background = clone(snapshot.background);
    state.stage.decorations = clone(snapshot.decorations);
    state.stage.materials = clone(snapshot.materials);
    state.characterGuides = Array.isArray(snapshot.characterGuides) && snapshot.characterGuides.length
      ? clone(snapshot.characterGuides)
      : defaultCharacterGuides(snapshot.grid);
    if (Number.isFinite(snapshot.appearanceBrightness)) state.appearanceBrightness = snapshot.appearanceBrightness;
    syncTerrainToStage();
    syncStageToForm();
    renderSpawnCards();
    renderAllCanvases();
    markDirty();
  }

  function pushUndo() {
    state.undo.push(captureSnapshot());
    if (state.undo.length > state.maxHistory) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(captureSnapshot());
    restoreSnapshot(state.undo.pop());
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(captureSnapshot());
    restoreSnapshot(state.redo.pop());
  }

  function updateHistoryButtons() {
    ['undoGlobal', 'undoButton'].forEach((id) => { $(id).disabled = !state.undo.length; });
    ['redoGlobal', 'redoButton'].forEach((id) => { $(id).disabled = !state.redo.length; });
  }

  function serializeSnapshot(snapshot) {
    return {
      terrainColumns: columnsFromGrid(snapshot.grid),
      spawnPoints: clone(snapshot.spawnPoints || []),
      gimmicks: clone(snapshot.gimmicks || []),
      background: clone(snapshot.background || {}),
      decorations: clone(snapshot.decorations || {}),
      materials: clone(snapshot.materials || []),
      characterGuides: clone(snapshot.characterGuides || []),
      appearanceBrightness: snapshot.appearanceBrightness
    };
  }

  function deserializeSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.terrainColumns)) return null;
    return {
      grid: gridFromTerrain({ columns: snapshot.terrainColumns }),
      spawnPoints: clone(snapshot.spawnPoints || []),
      gimmicks: clone(snapshot.gimmicks || []),
      background: clone(snapshot.background || {}),
      decorations: clone(snapshot.decorations || {}),
      materials: clone(snapshot.materials || []),
      characterGuides: Array.isArray(snapshot.characterGuides) && snapshot.characterGuides.length
        ? clone(snapshot.characterGuides)
        : null,
      appearanceBrightness: Number.isFinite(snapshot.appearanceBrightness) ? snapshot.appearanceBrightness : 1
    };
  }

  const memoryDrafts = new Map();
  let fallbackDbPromise = null;

  function openFallbackDb() {
    if (!('indexedDB' in globalThis)) return Promise.resolve(null);
    if (fallbackDbPromise) return fallbackDbPromise;
    fallbackDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('stage-studio-drafts-v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('drafts')) {
          const store = db.createObjectStore('drafts', { keyPath: 'stageId' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('端末保存を開始できません。'));
    });
    return fallbackDbPromise;
  }

  async function sharedStorageMethod(names, args) {
    if (!SharedStorage) return { handled: false };
    for (const name of names) {
      if (typeof SharedStorage[name] === 'function') {
        return { handled: true, value: await SharedStorage[name].apply(SharedStorage, args) };
      }
    }
    return { handled: false };
  }

  async function putDraft(record) {
    const shared = await sharedStorageMethod(['putDraft', 'saveDraft', 'put'], [record]);
    if (shared.handled) return shared.value;
    const db = await openFallbackDb();
    if (!db) { memoryDrafts.set(record.stageId, clone(record)); return record; }
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error || new Error('下書きを保存できません。'));
    });
  }

  async function getDraft(stageId) {
    const shared = await sharedStorageMethod(['getDraft', 'get'], [stageId]);
    if (shared.handled) return shared.value;
    const db = await openFallbackDb();
    if (!db) return clone(memoryDrafts.get(stageId) || null);
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(stageId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('下書きを読み込めません。'));
    });
  }

  async function listDrafts() {
    const shared = await sharedStorageMethod(['listDrafts', 'list'], []);
    if (shared.handled) {
      const value = shared.value;
      return Array.isArray(value) ? value : (value && Array.isArray(value.items) ? value.items : []);
    }
    const db = await openFallbackDb();
    if (!db) return Array.from(memoryDrafts.values()).map(clone);
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('下書き一覧を読み込めません。'));
    });
  }

  async function removeDraft(stageId) {
    const shared = await sharedStorageMethod(['deleteDraft', 'removeDraft', 'delete'], [stageId]);
    if (shared.handled) return shared.value;
    const db = await openFallbackDb();
    if (!db) { memoryDrafts.delete(stageId); return; }
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts', 'readwrite').objectStore('drafts').delete(stageId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('下書きを削除できません。'));
    });
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => saveDraftNow(true), 700);
  }

  async function saveDraftNow(silent, preserveCanonicalStage) {
    if (!state.stage) return true;
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
    if (!preserveCanonicalStage) {
      syncMetadataFromForm();
      syncTerrainToStage();
      if (state.stage.checksums) state.stage.checksums.contentHash = '';
    }
    const savingRevision = state.editRevision;
    const record = {
      id: state.stage.stageId,
      stageId: state.stage.stageId,
      title: state.stage.title,
      authorDisplayName: state.stage.authorDisplayName,
      updatedAt: state.stage.updatedAt,
      stage: clone(state.stage),
      history: state.undo.slice(-12).map(serializeSnapshot),
      redoHistory: state.redo.slice(-12).map(serializeSnapshot),
      lastScreen: state.currentScreen,
      editorState: { screen: state.currentScreen, view: clone(state.view), appearanceBrightness: state.appearanceBrightness, noiseCounter: state.noiseCounter, lowPowerMode: state.lowPowerMode, characterGuides: clone(state.characterGuides) },
      editor: { screen: state.currentScreen, view: clone(state.view), appearanceBrightness: state.appearanceBrightness, noiseCounter: state.noiseCounter, lowPowerMode: state.lowPowerMode, characterGuides: clone(state.characterGuides) }
    };
    try {
      await putDraft(record);
      state.documentStarted = true;
      const savedLatestRevision = savingRevision === state.editRevision;
      if (savedLatestRevision) {
        state.dirty = false;
        $('saveState').textContent = `保存済み ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
        if (!silent) showToast('下書きを端末へ保存しました。');
      }
      refreshDraftList();
      refreshStorageEstimate();
      return savedLatestRevision;
    } catch (error) {
      $('saveState').textContent = '端末保存に失敗';
      showToast(readableError(error, '端末の空き容量を確認し、JSONでバックアップしてください。'), 5000);
      return false;
    }
  }

  async function refreshDraftList() {
    const list = $('draftList');
    try {
      const drafts = (await listDrafts()).filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      $('savedCount').textContent = `${drafts.length}件`;
      list.replaceChildren();
      if (!drafts.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = '保存済みの下書きはありません。';
        list.append(empty);
        $('resumeDraftButton').disabled = true;
        return;
      }
      $('resumeDraftButton').disabled = false;
      for (const draft of drafts.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'draft-item';
        const title = document.createElement('strong');
        title.textContent = draft.title || (draft.stage && draft.stage.title) || '名称未設定';
        const time = document.createElement('small');
        const stamp = new Date(draft.updatedAt || (draft.stage && draft.stage.updatedAt) || Date.now());
        time.textContent = Number.isFinite(stamp.getTime()) ? stamp.toLocaleString('ja-JP') : '保存日時不明';
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = '開く';
        open.addEventListener('click', () => loadDraftRecord(draft));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'draft-delete';
        remove.textContent = '削除';
        remove.addEventListener('click', async () => {
          if (!(await confirmAction('下書きを削除', `「${title.textContent}」をこの端末から削除します。`))) return;
          await removeDraft(draft.id || draft.stageId || (draft.stage && draft.stage.stageId));
          await refreshDraftList();
          showToast('下書きを削除しました。');
        });
        item.append(title, time, open, remove);
        list.append(item);
      }
    } catch (error) {
      list.textContent = '';
      const message = document.createElement('p');
      message.className = 'muted';
      message.textContent = readableError(error, '下書き一覧を読み込めませんでした。');
      list.append(message);
    }
  }

  function loadDraftRecord(record) {
    const draftStage = record && record.stage ? record.stage : record;
    if (!draftStage || !draftStage.terrain) return showToast('下書きが壊れているため開けません。');
    setStage(draftStage, { skipSave: true });
    state.documentStarted = true;
    const editor = record && (record.editorState || record.editor) || {};
    if (Array.isArray(record.history)) state.undo = record.history.map(deserializeSnapshot).filter(Boolean).slice(-state.maxHistory);
    if (Array.isArray(record.redoHistory)) state.redo = record.redoHistory.map(deserializeSnapshot).filter(Boolean).slice(-state.maxHistory);
    if (editor.view) state.view = Object.assign(state.view, editor.view);
    if (Number.isFinite(editor.appearanceBrightness)) state.appearanceBrightness = clamp(editor.appearanceBrightness, 0.6, 1.3);
    if (Number.isFinite(editor.noiseCounter)) state.noiseCounter = Math.max(0, Math.floor(editor.noiseCounter));
    if (typeof editor.lowPowerMode === 'boolean') state.lowPowerMode = editor.lowPowerMode;
    if (Array.isArray(editor.characterGuides) && editor.characterGuides.length) {
      state.characterGuides = editor.characterGuides.slice(0, 4).map((guide, index) => ({
        x: clamp(Number(guide.x) || LIMITS.stageWidth * (index ? 0.72 : 0.28), 0, LIMITS.stageWidth),
        y: clamp(Number(guide.y) || 0, -SPRITE_SIZE, LIMITS.stageHeight + SPRITE_SIZE),
        character: CHARACTER_SOURCES[guide.character] ? guide.character : (index ? 'medama' : 'kyoryu'),
        direction: guide.direction === 'left' ? 'left' : 'right'
      }));
    }
    updateLowPowerModeUi();
    syncStageToForm();
    updateHistoryButtons();
    $('saveState').textContent = '下書きを復元しました';
    const restoredScreen = normalizeScreen(record.lastScreen || editor.screen || 'terrain');
    navigate(restoredScreen);
  }

  async function refreshStorageEstimate() {
    let shared = { handled: false };
    try { shared = await sharedStorageMethod(['estimateUsage'], []); } catch (_) {}
    if (shared.handled && shared.value) {
      const estimate = shared.value;
      state.storageDurable = estimate.backend !== 'memory' && estimate.durable !== false;
      if (!state.storageDurable) {
        $('storageUsage').textContent = '一時保存（再読込で消えます）';
        if (!state.storageWarningShown) {
          state.storageWarningShown = true;
          showToast('端末保存を利用できないため一時保存中です。再読み込み前にJSONでバックアップしてください。', 7000);
        }
        return false;
      }
      const used = Number(estimate.stageStudioUsage == null ? estimate.usage : estimate.stageStudioUsage) || 0;
      const quota = Number(estimate.quota) || 0;
      const human = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
      $('storageUsage').textContent = quota ? `${human(used)} / ${human(quota)}` : human(used);
      if (quota && used / quota > 0.85) showToast('端末保存の空き容量が少なくなっています。ファイルへバックアップしてください。', 5000);
      return true;
    }
    state.storageDurable = 'indexedDB' in globalThis;
    if (!state.storageDurable) {
      $('storageUsage').textContent = '一時保存（再読込で消えます）';
      if (!state.storageWarningShown) {
        state.storageWarningShown = true;
        showToast('端末保存を利用できないため一時保存中です。再読み込み前にJSONでバックアップしてください。', 7000);
      }
      return false;
    }
    if (!(navigator.storage && navigator.storage.estimate)) {
      $('storageUsage').textContent = 'ブラウザ管理';
      return true;
    }
    try {
      const estimate = await navigator.storage.estimate();
      const used = Number(estimate.usage) || 0;
      const quota = Number(estimate.quota) || 0;
      const human = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
      $('storageUsage').textContent = quota ? `${human(used)} / ${human(quota)}` : human(used);
      if (quota && used / quota > 0.85) showToast('端末保存の空き容量が少なくなっています。ファイルへバックアップしてください。', 5000);
      return true;
    } catch (_) {
      $('storageUsage').textContent = '確認できません';
      return true;
    }
  }

  function confirmAction(title, message) {
    const dialog = $('confirmDialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(globalThis.confirm(message));
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    });
  }

  function resizeCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = state.lowPowerMode ? 1 : Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d', { alpha: false });
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width: rect.width, height: rect.height, dpr };
  }

  function canvasTransform(canvas, editable) {
    const rect = canvas.getBoundingClientRect();
    const fit = Math.min(rect.width / LIMITS.stageWidth, rect.height / LIMITS.stageHeight);
    const zoom = editable ? state.view.zoom : 1;
    const scale = fit * zoom;
    const width = LIMITS.stageWidth * scale;
    const height = LIMITS.stageHeight * scale;
    return {
      scale,
      offsetX: (rect.width - width) / 2 + (editable ? state.view.panX : 0),
      offsetY: (rect.height - height) / 2 + (editable ? state.view.panY : 0),
      cssWidth: rect.width,
      cssHeight: rect.height
    };
  }

  function worldToScreen(point, transform) {
    return { x: transform.offsetX + point.x * transform.scale, y: transform.offsetY + point.y * transform.scale };
  }

  function screenToWorld(canvas, clientX, clientY, editable) {
    const rect = canvas.getBoundingClientRect();
    const transform = canvasTransform(canvas, editable);
    return {
      x: (clientX - rect.left - transform.offsetX) / transform.scale,
      y: (clientY - rect.top - transform.offsetY) / transform.scale
    };
  }

  function stageForGrid(grid) {
    const next = clone(state.stage);
    next.terrain.columns = columnsFromGrid(grid);
    return next;
  }

  function paintCircle(grid, x, y, radius, solid) {
    if (Core && typeof Core.paintCircle === 'function') return Core.paintCircle(grid, x, y, radius, solid);
    const minColumn = clamp(Math.floor((x - radius) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const maxColumn = clamp(Math.ceil((x + radius) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const minRow = clamp(Math.floor((y - radius) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    const maxRow = clamp(Math.ceil((y + radius) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const dx = column * LIMITS.columnWidth + LIMITS.columnWidth / 2 - x;
        const dy = row * LIMITS.rowHeight + LIMITS.rowHeight / 2 - y;
        if (dx * dx + dy * dy <= radius * radius) grid[row * LIMITS.terrainColumns + column] = solid ? 1 : 0;
      }
    }
    return grid;
  }

  function imageReady(image) {
    return !!(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }

  function drawImageCover(context, image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) * 0.48);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  }

  function characterCollision(guide, grid) {
    const centerX = Number(guide.x);
    const centerY = Number(guide.y) - UNIT_HIT_RISE;
    if (centerX - UNIT_HIT_RADIUS < 0 || centerX + UNIT_HIT_RADIUS > LIMITS.stageWidth
        || centerY - UNIT_HIT_RADIUS < 0 || centerY + UNIT_HIT_RADIUS > LIMITS.stageHeight) return 'outside';
    const minColumn = clamp(Math.floor((centerX - UNIT_HIT_RADIUS) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const maxColumn = clamp(Math.floor((centerX + UNIT_HIT_RADIUS) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const minRow = clamp(Math.floor((centerY - UNIT_HIT_RADIUS) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    const maxRow = clamp(Math.floor((centerY + UNIT_HIT_RADIUS) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    for (let column = minColumn; column <= maxColumn; column++) {
      for (let row = minRow; row <= maxRow; row++) {
        if (!grid[row * LIMITS.terrainColumns + column]) continue;
        const left = column * LIMITS.columnWidth;
        const top = row * LIMITS.rowHeight;
        const nearestX = clamp(centerX, left, left + LIMITS.columnWidth);
        const nearestY = clamp(centerY, top, top + LIMITS.rowHeight);
        const deltaX = centerX - nearestX;
        const deltaY = centerY - nearestY;
        if (deltaX * deltaX + deltaY * deltaY <= UNIT_HIT_RADIUS * UNIT_HIT_RADIUS) return 'overlap';
      }
    }
    return null;
  }

  function nearestSafeCharacterGuide(guide, grid) {
    const minimumX = UNIT_HIT_RADIUS;
    const maximumX = LIMITS.stageWidth - UNIT_HIT_RADIUS;
    const originX = clamp(Number(guide.x) || LIMITS.stageWidth / 2, minimumX, maximumX);
    const candidates = [originX];
    for (let column = 0; column < LIMITS.terrainColumns; column++) {
      const x = clamp(column * LIMITS.columnWidth + LIMITS.columnWidth / 2, minimumX, maximumX);
      if (Math.abs(x - originX) > 0.001) candidates.push(x);
    }
    let best = null;
    let bestDistance = Infinity;
    for (const x of candidates) {
      const surfaceY = surfaceYAtGrid(grid, x);
      if (surfaceY >= LIMITS.stageHeight) continue;
      const candidate = Object.assign({}, guide, { x, y: surfaceY - LIMITS.unitRadius });
      if (characterCollision(candidate, grid)) continue;
      const deltaX = x - Number(guide.x || 0);
      const deltaY = candidate.y - Number(guide.y || 0);
      const distance = deltaX * deltaX + deltaY * deltaY;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  function snapInvalidCharacterGuides() {
    if ($('toolLock').checked) return showToast('ツールロック中です。解除するとキャラクターを移動できます。');
    const invalid = state.characterGuides
      .map((guide, index) => ({ index, guide, collision: characterCollision(guide, state.grid) }))
      .filter((item) => item.collision);
    if (!invalid.length) return showToast('赤いキャラクターはありません。現在の配置で安全です。');
    const placements = invalid.map((item) => ({ index: item.index, guide: nearestSafeCharacterGuide(item.guide, state.grid) }))
      .filter((item) => item.guide);
    if (!placements.length) return showToast('安全に乗せられる足場がありません。先に地形を描いてください。', 5000);
    pushUndo();
    for (const placement of placements) state.characterGuides[placement.index] = placement.guide;
    state.activeGuideIndex = placements[0].index;
    setActiveTool('guide');
    renderTerrainCanvas();
    markDirty();
    const unresolved = invalid.length - placements.length;
    showToast(unresolved
      ? `${placements.length}体を最寄りの安全位置へ移動しました。${unresolved}体は足場を見つけられませんでした。`
      : `${placements.length}体を最寄りの安全位置へ移動しました。Undoで戻せます。`, 5000);
  }

  function drawCharacterAt(context, guide, grid, options) {
    const settings = options || {};
    const image = characterImages[guide.character] || characterImages.kyoryu;
    const collision = settings.forceInvalid || characterCollision(guide, grid);
    const enemyTeam = settings.team === 'cpu' || settings.team === 'enemy';
    const teamTint = enemyTeam ? '255,150,120' : '120,190,255';
    const ringTint = collision ? '255,72,72' : teamTint;
    const hitY = guide.y - UNIT_HIT_RISE;
    context.save();
    context.fillStyle = `rgba(${ringTint},${collision ? 0.24 : 0.09})`;
    context.strokeStyle = `rgba(${ringTint},${collision ? 0.98 : 0.56})`;
    context.lineWidth = settings.active ? 3.5 : 1.8;
    context.beginPath();
    context.arc(guide.x, hitY, UNIT_HIT_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    if (imageReady(image)) {
      const aspect = image.naturalWidth / image.naturalHeight;
      const spriteHeight = SPRITE_SIZE * Math.sqrt(SPRITE_REFERENCE_ASPECT / aspect);
      const spriteWidth = spriteHeight * aspect;
      context.save();
      context.globalAlpha = settings.ghost ? 0.82 : 1;
      context.translate(guide.x, guide.y + LIMITS.unitRadius);
      if (guide.direction === 'left') context.scale(-1, 1);
      if (collision) context.filter = 'sepia(1) saturate(7) hue-rotate(315deg) brightness(.9)';
      context.drawImage(image, -spriteWidth / 2, -spriteHeight, spriteWidth, spriteHeight);
      context.restore();
    } else {
      context.fillStyle = collision ? '#ef5c5c' : (enemyTeam ? '#ff9678' : '#78beff');
      context.beginPath();
      context.arc(guide.x, guide.y, LIMITS.unitRadius, 0, Math.PI * 2);
      context.fill();
    }

    if (collision) {
      context.strokeStyle = '#ff4040';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(guide.x - 12, hitY - 12);
      context.lineTo(guide.x + 12, hitY + 12);
      context.moveTo(guide.x + 12, hitY - 12);
      context.lineTo(guide.x - 12, hitY + 12);
      context.stroke();
    }
    context.restore();
    return collision;
  }

  function drawTerrain(context, columns, theme, terrainTop, showCollision) {
    const gradient = context.createLinearGradient(0, 180, 0, LIMITS.terrainBottomY);
    gradient.addColorStop(0, terrainTop);
    gradient.addColorStop(1, theme.dirtBottom);
    context.fillStyle = gradient;
    for (let column = 0; column < columns.length; column++) {
      const x = column * LIMITS.columnWidth;
      for (const segment of columns[column]) {
        context.fillRect(x, segment[0], LIMITS.columnWidth + 0.6, Math.max(0, segment[1] - segment[0]));
      }
    }

    if (!state.lowPowerMode) {
      context.save();
      context.beginPath();
      for (let column = 0; column < columns.length; column++) {
        const x = column * LIMITS.columnWidth;
        for (const segment of columns[column]) context.rect(x, segment[0], LIMITS.columnWidth + 0.7, Math.max(0, segment[1] - segment[0]));
      }
      context.clip();
      context.fillStyle = context.createPattern(terrainNoiseTile, 'repeat');
      context.fillRect(0, 0, LIMITS.stageWidth, LIMITS.stageHeight);
      context.lineCap = 'round';
      context.strokeStyle = theme.strata;
      context.lineWidth = 2;
      for (let band = 0; band < 9; band++) {
        const baseY = 246 + band * 44;
        context.beginPath();
        for (let x = -20; x <= LIMITS.stageWidth + 20; x += 18) {
          const y = baseY + Math.sin(x * 0.012 + band * 1.7) * 6 + Math.sin(x * 0.031 + band) * 2;
          if (x === -20) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
      for (let index = 0; index < 120; index++) {
        const x = (index * 73.37 + 19) % LIMITS.stageWidth;
        const y = 238 + ((index * 47.19 + 31) % Math.max(1, LIMITS.stageHeight - 260));
        context.fillStyle = index % 3 === 0 ? theme.stoneLight : theme.stoneDark;
        context.beginPath();
        context.ellipse(x, y, 2.4 + (index % 5) * 0.9, 1.5 + (index % 3) * 0.8, Math.sin(index * 2.13) * 0.75, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    for (let column = 0; column < columns.length; column++) {
      const segment = columns[column][0];
      if (!segment) continue;
      const x = column * LIMITS.columnWidth;
      context.fillStyle = theme.rimShadow;
      context.fillRect(x, segment[0] + 4, LIMITS.columnWidth + 0.7, 5);
      context.fillStyle = showCollision ? 'rgba(255,226,94,.72)' : theme.rim;
      context.fillRect(x, segment[0], LIMITS.columnWidth + 0.7, 5);
    }
  }

  function mixHexColor(from, to, ratio) {
    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const read = (color, offset) => Number.parseInt(String(color).slice(offset, offset + 2), 16);
    const channel = (a, b) => Math.round(a + (b - a) * safeRatio).toString(16).padStart(2, '0');
    return `#${channel(read(from, 1), read(to, 1))}${channel(read(from, 3), read(to, 3))}${channel(read(from, 5), read(to, 5))}`;
  }

  function drawCharacterGuides(context, grid) {
    let warningCount = 0;
    state.characterGuides.forEach((guide, index) => {
      if (drawCharacterAt(context, guide, grid, { active: index === state.activeGuideIndex, ghost: true, team: index ? 'cpu' : 'player' })) warningCount += 1;
    });
    const hint = $('characterGuideHint');
    const panel = $('characterGuidePanel');
    const snapButton = $('snapCharacterGuides');
    if (hint) {
      hint.dataset.state = warningCount ? 'warning' : 'ok';
      hint.textContent = warningCount
        ? `警告：${warningCount}体が地形または画面外と重なっています。ドラッグするか、安全位置へ移動できます。`
        : '実ゲームと同じ寸法です。キャラ確認でドラッグでき、重なると赤く警告します。';
    }
    if (panel) panel.dataset.state = warningCount ? 'warning' : 'ok';
    if (snapButton) snapButton.disabled = !warningCount;
  }

  function drawStageScene(canvas, grid, options) {
    const prepared = resizeCanvas(canvas);
    if (!prepared || !state.stage) return;
    const { context, width, height } = prepared;
    const settings = options || {};
    const transform = canvasTransform(canvas, !!settings.editable);
    const background = state.stage.background || {};
    const themeKey = THEME_COLORS[background.theme] ? background.theme : 'grass';
    const theme = THEME_COLORS[themeKey];
    const gradientColors = background.gradient && /^#[0-9a-f]{6}$/i.test(background.gradient.from || '') && /^#[0-9a-f]{6}$/i.test(background.gradient.to || '')
      ? [background.gradient.from, background.gradient.to] : theme.gradient;
    const backgroundGradient = context.createLinearGradient(0, 0, 0, height);
    const solidColor = /^#[0-9a-f]{6}$/i.test(background.color || '') ? background.color : theme.sky;
    backgroundGradient.addColorStop(0, background.mode === 'color' ? solidColor : gradientColors[0]);
    backgroundGradient.addColorStop(1, background.mode === 'color' ? solidColor : gradientColors[gradientColors.length - 1]);
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.beginPath();
    context.rect(transform.offsetX, transform.offsetY, LIMITS.stageWidth * transform.scale, LIMITS.stageHeight * transform.scale);
    context.clip();
    context.translate(transform.offsetX, transform.offsetY);
    context.scale(transform.scale, transform.scale);

    const showGameBackground = background.mode === 'theme'
      && state.stage.decorations && state.stage.decorations.enabled !== false
      && imageReady(stageBackgroundImages[themeKey]);
    if (showGameBackground) drawImageCover(context, stageBackgroundImages[themeKey], 0, 0, LIMITS.stageWidth, LIMITS.stageHeight);

    const columns = columnsFromGrid(grid);
    const material = state.stage.materials && state.stage.materials[0] || {};
    const terrainTop = /^#[0-9a-f]{6}$/i.test(material.color || '') ? material.color : theme.dirtTop;
    const terrainTheme = Object.assign({}, theme, {
      dirtBottom: mixHexColor(terrainTop, '#000000', 0.58),
      rim: mixHexColor(terrainTop, '#ffffff', 0.34),
      rimShadow: mixHexColor(terrainTop, '#000000', 0.36)
    });
    drawTerrain(context, columns, terrainTheme, terrainTop, !!settings.showCollision);

    if (!state.lowPowerMode && settings.showGrid && transform.scale * 24 >= 10) {
      context.strokeStyle = 'rgba(255,255,255,.22)';
      context.lineWidth = 1 / transform.scale;
      context.beginPath();
      for (let x = 0; x <= LIMITS.stageWidth; x += 72) { context.moveTo(x, 0); context.lineTo(x, LIMITS.stageHeight); }
      for (let y = 0; y <= LIMITS.stageHeight; y += 48) { context.moveTo(0, y); context.lineTo(LIMITS.stageWidth, y); }
      context.stroke();
    }

    context.strokeStyle = 'rgba(255,255,255,.55)';
    context.lineWidth = 2 / transform.scale;
    context.strokeRect(0, 0, LIMITS.stageWidth, LIMITS.stageHeight);
    context.strokeStyle = 'rgba(255,72,72,.72)';
    context.setLineDash([10 / transform.scale, 7 / transform.scale]);
    context.beginPath();
    context.moveTo(0, LIMITS.terrainBottomY);
    context.lineTo(LIMITS.stageWidth, LIMITS.terrainBottomY);
    context.stroke();
    context.setLineDash([]);

    if (settings.guides) drawCharacterGuides(context, grid);
    if (settings.spawns === true) drawSpawnsOnContext(context, transform.scale, grid);
    if (Array.isArray(settings.testFallTrail) && settings.testFallTrail.length > 1) {
      context.strokeStyle = 'rgba(255, 207, 77, .9)';
      context.lineWidth = 3 / transform.scale;
      context.setLineDash([7 / transform.scale, 6 / transform.scale]);
      context.beginPath();
      settings.testFallTrail.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.stroke();
      context.setLineDash([]);
    }
    if (Number.isFinite(settings.testActorX)) {
      const actorGround = surfaceYAtGrid(grid, settings.testActorX);
      const actor = {
        x: settings.testActorX,
        y: Number.isFinite(settings.testActorY) ? settings.testActorY : actorGround - LIMITS.unitRadius,
        character: 'kyoryu',
        direction: Number($('shotAngle').value) > 90 ? 'left' : 'right'
      };
      const actorDead = settings.testActorStatus === 'dead';
      drawCharacterAt(context, actor, grid, { active: true, team: 'player', forceInvalid: actorDead ? 'outside' : null });
      if (actorDead) {
        context.fillStyle = '#fff';
        context.font = '700 15px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText('DEAD LINE', actor.x, actor.y - SPRITE_SIZE - 10);
      }
    }
    if (Array.isArray(settings.trajectory) && settings.trajectory.length) drawTrajectoryOnContext(context, settings.trajectory, settings.impact, transform.scale);
    context.restore();

    const brightness = clamp(state.appearanceBrightness || 1, 0.6, 1.3);
    if (brightness < 1) {
      context.fillStyle = `rgba(0,0,0,${1 - brightness})`;
      context.fillRect(0, 0, width, height);
    } else if (brightness > 1) {
      context.fillStyle = `rgba(255,255,255,${(brightness - 1) * 0.45})`;
      context.fillRect(0, 0, width, height);
    }
  }

  function drawSpawnsOnContext(context, scale, grid) {
    const spawns = Array.isArray(state.stage.spawnPoints) ? state.stage.spawnPoints : [];
    for (const spawn of spawns) {
      const active = spawn.slot === state.activeSpawn;
      drawCharacterAt(context, Object.assign({}, spawn, { character: SLOT_CHARACTER[spawn.slot] || 'kyoryu' }), grid, {
        active,
        ghost: true,
        team: spawn.team
      });
      const direction = spawn.direction === 'left' ? -1 : 1;
      context.strokeStyle = active ? '#ffd24a' : '#fff5dc';
      context.lineWidth = (active ? 4 : 2.5) / scale;
      context.beginPath();
      context.moveTo(spawn.x, spawn.y + LIMITS.unitRadius + 7);
      context.lineTo(spawn.x + direction * 30, spawn.y + LIMITS.unitRadius + 7);
      context.lineTo(spawn.x + direction * 21, spawn.y + LIMITS.unitRadius);
      context.moveTo(spawn.x + direction * 30, spawn.y + LIMITS.unitRadius + 7);
      context.lineTo(spawn.x + direction * 21, spawn.y + LIMITS.unitRadius + 14);
      context.stroke();
    }
  }

  function drawTrajectoryOnContext(context, trajectory, impact, scale) {
    context.strokeStyle = '#fff3a5';
    context.lineWidth = 3 / scale;
    context.setLineDash([10 / scale, 8 / scale]);
    context.beginPath();
    trajectory.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.stroke();
    context.setLineDash([]);
    if (impact) {
      context.fillStyle = 'rgba(255, 93, 68, .25)';
      context.strokeStyle = '#ff765e';
      context.lineWidth = 3 / scale;
      context.beginPath();
      context.arc(impact.x, impact.y, PHYSICS.normalBlastRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  let renderQueued = false;
  function renderAllCanvases() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderTerrainCanvas();
      renderSpawnCanvas();
      renderTestCanvas();
    });
  }

  function renderTerrainCanvas() {
    if (state.currentScreen !== 'terrain') return;
    drawStageScene($('terrainCanvas'), state.grid, { editable: true, guides: true, showGrid: $('showGrid').checked, showCollision: $('showCollision').checked });
    $('zoomLabel').textContent = `${Math.round(state.view.zoom * 100)}%`;
  }

  function renderSpawnCanvas() {
    if (state.currentScreen !== 'spawns') return;
    drawStageScene($('spawnCanvas'), state.grid, { spawns: true, showCollision: true });
  }

  function renderTestCanvas() {
    if (state.currentScreen !== 'playtest') return;
    drawStageScene($('testCanvas'), state.testGrid || state.grid, {
      spawns: true,
      testActorX: state.testActorX,
      testActorY: state.testActorY,
      testActorStatus: state.testActorStatus,
      testFallTrail: state.testFallTrail,
      trajectory: state.testTrajectory,
      impact: state.testImpact
    });
  }

  function eventPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const SHAPE_TOOLS = new Set(['line', 'rectangle', 'circle']);

  function activeBrushRadius() {
    return Number($('brushSize').value) * (0.55 + Number($('brushHardness').value) / 100 * 0.45);
  }

  function enforceTerrainBounds(grid) {
    const firstForbiddenRow = clamp(Math.ceil(LIMITS.terrainBottomY / LIMITS.rowHeight), 0, LIMITS.terrainRows);
    for (let row = firstForbiddenRow; row < LIMITS.terrainRows; row++) {
      grid.fill(0, row * LIMITS.terrainColumns, (row + 1) * LIMITS.terrainColumns);
    }
    return grid;
  }

  function paintWorldPoint(point, grid, solid) {
    const target = grid || state.grid;
    paintCircle(
      target,
      clamp(point.x, 0, LIMITS.stageWidth),
      clamp(point.y, 0, LIMITS.terrainBottomY),
      activeBrushRadius(),
      solid == null ? state.activeTool !== 'erase' : solid
    );
    enforceTerrainBounds(target);
  }

  function paintInterpolated(from, to, grid, solid) {
    const radius = Number($('brushSize').value);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(4, radius * 0.32)));
    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      paintWorldPoint({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, grid, solid);
    }
  }

  function fillRectangle(grid, from, to) {
    const minColumn = clamp(Math.floor(Math.min(from.x, to.x) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const maxColumn = clamp(Math.floor(Math.max(from.x, to.x) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const minRow = clamp(Math.floor(Math.min(from.y, to.y) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    const maxRow = clamp(Math.floor(Math.max(from.y, to.y) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    for (let row = minRow; row <= maxRow; row++) {
      grid.fill(1, row * LIMITS.terrainColumns + minColumn, row * LIMITS.terrainColumns + maxColumn + 1);
    }
    enforceTerrainBounds(grid);
  }

  function fillEllipse(grid, from, to) {
    const centerX = (from.x + to.x) / 2;
    const centerY = (from.y + to.y) / 2;
    const radiusX = Math.max(activeBrushRadius(), Math.abs(to.x - from.x) / 2);
    const radiusY = Math.max(activeBrushRadius(), Math.abs(to.y - from.y) / 2);
    const minColumn = clamp(Math.floor((centerX - radiusX) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const maxColumn = clamp(Math.ceil((centerX + radiusX) / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const minRow = clamp(Math.floor((centerY - radiusY) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    const maxRow = clamp(Math.ceil((centerY + radiusY) / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
    for (let row = minRow; row <= maxRow; row++) {
      const y = row * LIMITS.rowHeight + LIMITS.rowHeight / 2;
      for (let column = minColumn; column <= maxColumn; column++) {
        const x = column * LIMITS.columnWidth + LIMITS.columnWidth / 2;
        const normalized = ((x - centerX) * (x - centerX)) / (radiusX * radiusX) + ((y - centerY) * (y - centerY)) / (radiusY * radiusY);
        if (normalized <= 1) grid[row * LIMITS.terrainColumns + column] = 1;
      }
    }
    enforceTerrainBounds(grid);
  }

  function previewShape(to) {
    if (!state.shapeStart || !state.shapeBaseGrid) return;
    state.grid = state.shapeBaseGrid.slice();
    if (state.activeTool === 'line') paintInterpolated(state.shapeStart, to, state.grid, true);
    else if (state.activeTool === 'rectangle') fillRectangle(state.grid, state.shapeStart, to);
    else if (state.activeTool === 'circle') fillEllipse(state.grid, state.shapeStart, to);
  }

  function floodFill(point) {
    const column = clamp(Math.floor(point.x / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1);
    const rowLimit = clamp(Math.ceil(LIMITS.terrainBottomY / LIMITS.rowHeight), 0, LIMITS.terrainRows);
    const row = clamp(Math.floor(point.y / LIMITS.rowHeight), 0, Math.max(0, rowLimit - 1));
    const start = row * LIMITS.terrainColumns + column;
    if (state.grid[start]) return false;
    const pending = [start];
    state.grid[start] = 1;
    while (pending.length) {
      const index = pending.pop();
      const currentRow = Math.floor(index / LIMITS.terrainColumns);
      const currentColumn = index - currentRow * LIMITS.terrainColumns;
      const neighbors = [];
      if (currentColumn > 0) neighbors.push(index - 1);
      if (currentColumn + 1 < LIMITS.terrainColumns) neighbors.push(index + 1);
      if (currentRow > 0) neighbors.push(index - LIMITS.terrainColumns);
      if (currentRow + 1 < rowLimit) neighbors.push(index + LIMITS.terrainColumns);
      for (const neighbor of neighbors) {
        if (!state.grid[neighbor]) {
          state.grid[neighbor] = 1;
          pending.push(neighbor);
        }
      }
    }
    enforceTerrainBounds(state.grid);
    return true;
  }

  function beginTerrainPointer(event) {
    const canvas = $('terrainCanvas');
    try {
      if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(event.pointerId);
    } catch (_) {
      /* Some WebKit and synthetic touch paths do not allow explicit pointer capture. */
    }
    state.pointerMap.set(event.pointerId, eventPoint(canvas, event));
    if (state.pointerMap.size === 1) {
      const world = screenToWorld(canvas, event.clientX, event.clientY, true);
      if (state.activeTool === 'guide') {
        let selectedIndex = -1;
        let selectedDistance = Infinity;
        state.characterGuides.forEach((guide, index) => {
          const distance = Math.hypot(guide.x - world.x, (guide.y - 32) - world.y);
          if (distance < selectedDistance && distance <= 150) {
            selectedIndex = index;
            selectedDistance = distance;
          }
        });
        if (selectedIndex < 0) {
          state.pointerMap.delete(event.pointerId);
          showToast('動かすキャラクターをタップしてください。');
          return;
        }
        pushUndo();
        state.activeGuideIndex = selectedIndex;
        const guide = state.characterGuides[selectedIndex];
        state.guideDrag = { index: selectedIndex, offsetX: guide.x - world.x, offsetY: guide.y - world.y };
        state.strokeActive = true;
        renderTerrainCanvas();
        return;
      }
      pushUndo();
      state.lastWorldPoint = world;
      if (state.activeTool === 'fill') {
        if (!floodFill(world)) {
          state.undo.pop();
          updateHistoryButtons();
          showToast('地形のない場所をタップすると塗りつぶせます。');
          return;
        }
        state.strokeActive = true;
      } else {
        state.strokeActive = true;
        if (SHAPE_TOOLS.has(state.activeTool)) {
          state.shapeStart = world;
          state.shapeBaseGrid = state.grid.slice();
          previewShape(world);
        } else {
          paintWorldPoint(world);
        }
      }
      renderAllCanvases();
    } else if (state.pointerMap.size === 2) {
      if (state.strokeActive && state.undo.length) {
        const beforeStroke = state.undo.pop();
        state.grid = beforeStroke.grid.slice();
        state.characterGuides = clone(beforeStroke.characterGuides || state.characterGuides);
        state.redo.length = 0;
        updateHistoryButtons();
      }
      state.strokeActive = false;
      state.guideDrag = null;
      state.shapeStart = null;
      state.shapeBaseGrid = null;
      const points = Array.from(state.pointerMap.values());
      state.pinch = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        centerX: (points[0].x + points[1].x) / 2,
        centerY: (points[0].y + points[1].y) / 2,
        zoom: state.view.zoom,
        panX: state.view.panX,
        panY: state.view.panY
      };
    }
  }

  function moveTerrainPointer(event) {
    if (!state.pointerMap.has(event.pointerId)) return;
    const canvas = $('terrainCanvas');
    state.pointerMap.set(event.pointerId, eventPoint(canvas, event));
    if (state.pointerMap.size >= 2 && state.pinch) {
      const points = Array.from(state.pointerMap.values()).slice(0, 2);
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      state.view.zoom = clamp(state.pinch.zoom * distance / Math.max(1, state.pinch.distance), 0.65, 4);
      state.view.panX = state.pinch.panX + centerX - state.pinch.centerX;
      state.view.panY = state.pinch.panY + centerY - state.pinch.centerY;
      renderAllCanvases();
      return;
    }
    if (state.pointerMap.size === 1 && state.strokeActive && (event.buttons || event.pointerType === 'touch' || event.pointerType === 'pen')) {
      const world = screenToWorld(canvas, event.clientX, event.clientY, true);
      if (state.activeTool === 'guide' && state.guideDrag) {
        const guide = state.characterGuides[state.guideDrag.index];
        guide.x = clamp(world.x + state.guideDrag.offsetX, -SPRITE_SIZE, LIMITS.stageWidth + SPRITE_SIZE);
        guide.y = clamp(world.y + state.guideDrag.offsetY, -SPRITE_SIZE, LIMITS.stageHeight + SPRITE_SIZE);
        renderTerrainCanvas();
        return;
      }
      if (state.activeTool === 'fill') return;
      if (SHAPE_TOOLS.has(state.activeTool)) previewShape(world);
      else paintInterpolated(state.lastWorldPoint || world, world);
      state.lastWorldPoint = world;
      renderAllCanvases();
    }
  }

  function endTerrainPointer(event) {
    state.pointerMap.delete(event.pointerId);
    if (state.pointerMap.size < 2) state.pinch = null;
    if (!state.pointerMap.size) {
      if (state.strokeActive) {
        state.strokeActive = false;
        state.lastWorldPoint = null;
        state.shapeStart = null;
        state.shapeBaseGrid = null;
        state.guideDrag = null;
        syncTerrainToStage();
        resetPlaytest(false);
        markDirty();
      }
    }
  }

  function adjustedSurfaceColumns(grid, calculateTop) {
    const columns = columnsFromGrid(grid).map((segments) => segments.map((segment) => segment.slice()));
    const surfaces = columns.map((segments) => segments.length ? segments[0][0] : null);
    const minimumThickness = Math.max(LIMITS.rowHeight, Number(state.stage.terrain.minimumThickness) || 12);
    for (let column = 0; column < columns.length; column++) {
      if (!columns[column].length) continue;
      const proposed = calculateTop(column, surfaces);
      if (!Number.isFinite(proposed)) continue;
      const segment = columns[column][0];
      const maximumTop = Math.max(0, Math.min(LIMITS.terrainBottomY - minimumThickness, segment[1] - minimumThickness));
      segment[0] = clamp(Math.round(proposed / LIMITS.rowHeight) * LIMITS.rowHeight, 0, maximumTop);
    }
    return enforceTerrainBounds(gridFromTerrain({ columns }));
  }

  function smoothTerrainGrid(grid) {
    return adjustedSurfaceColumns(grid, (column, surfaces) => {
      const neighbors = [];
      for (let offset = -2; offset <= 2; offset++) {
        const value = surfaces[column + offset];
        if (Number.isFinite(value)) neighbors.push(value);
      }
      return neighbors.length ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length : surfaces[column];
    });
  }

  function flattenTerrainGrid(grid) {
    const surfaces = columnsFromGrid(grid).map((segments) => segments.length ? segments[0][0] : null).filter(Number.isFinite).sort((a, b) => a - b);
    if (!surfaces.length) return grid;
    const middle = Math.floor(surfaces.length / 2);
    const median = surfaces.length % 2 ? surfaces[middle] : (surfaces[middle - 1] + surfaces[middle]) / 2;
    return adjustedSurfaceColumns(grid, () => median);
  }

  function seedToUint32(text) {
    let hash = 2166136261;
    for (const character of String(text)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function deterministicRandom(seed) {
    let value = seedToUint32(seed);
    return () => {
      value += 0x6D2B79F5;
      let next = value;
      next = Math.imul(next ^ next >>> 15, next | 1);
      next ^= next + Math.imul(next ^ next >>> 7, next | 61);
      return ((next ^ next >>> 14) >>> 0) / 4294967296;
    };
  }

  function addTerrainNoise(grid) {
    state.noiseCounter += 1;
    const random = deterministicRandom(`${state.stage.seed || ''}|terrain-noise-v1|${state.noiseCounter}`);
    const raw = Array.from({ length: LIMITS.terrainColumns }, () => (random() - 0.5) * 52);
    const noise = raw.map((value, column) => {
      let sum = value;
      let count = 1;
      for (let offset = 1; offset <= 3; offset++) {
        if (Number.isFinite(raw[column - offset])) { sum += raw[column - offset]; count += 1; }
        if (Number.isFinite(raw[column + offset])) { sum += raw[column + offset]; count += 1; }
      }
      return sum / count;
    });
    return adjustedSurfaceColumns(grid, (column, surfaces) => Number.isFinite(surfaces[column]) ? surfaces[column] + noise[column] : null);
  }

  function mirrorTerrainGrid(grid) {
    const mirrored = new Uint8Array(grid.length);
    for (let row = 0; row < LIMITS.terrainRows; row++) {
      const rowStart = row * LIMITS.terrainColumns;
      for (let column = 0; column < LIMITS.terrainColumns; column++) {
        mirrored[rowStart + (LIMITS.terrainColumns - 1 - column)] = grid[rowStart + column];
      }
    }
    return enforceTerrainBounds(mirrored);
  }

  function symmetrizeTerrainGrid(grid) {
    const symmetric = grid.slice();
    const half = Math.floor(LIMITS.terrainColumns / 2);
    for (let row = 0; row < LIMITS.terrainRows; row++) {
      const rowStart = row * LIMITS.terrainColumns;
      for (let column = 0; column < half; column++) {
        symmetric[rowStart + (LIMITS.terrainColumns - 1 - column)] = symmetric[rowStart + column];
      }
    }
    return enforceTerrainBounds(symmetric);
  }

  function runTerrainOperation(label, transform) {
    if ($('toolLock').checked) return showToast('ツールロック中です。解除すると編集できます。');
    pushUndo();
    try {
      const result = transform(state.grid.slice());
      if (!(result instanceof Uint8Array) || result.length !== state.grid.length) throw new Error('地形処理の結果が不正です。');
      state.grid = enforceTerrainBounds(result);
      syncTerrainToStage();
      resetPlaytest(false);
      renderAllCanvases();
      markDirty();
      showToast(`${label}を適用しました。Undoで戻せます。`);
    } catch (error) {
      state.undo.pop();
      updateHistoryButtons();
      showToast(readableError(error, `${label}を適用できませんでした。`), 5000);
    }
  }

  function setZoom(next) {
    state.view.zoom = clamp(next, 0.65, 4);
    if (state.view.zoom <= 1) { state.view.panX = 0; state.view.panY = 0; }
    renderTerrainCanvas();
  }

  function findGroundY(x) {
    syncTerrainToStage();
    if (Core && typeof Core.groundYAt === 'function') return Core.groundYAt(state.stage, x);
    const column = state.stage.terrain.columns[clamp(Math.floor(x / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1)] || [];
    return column.length ? column[0][0] : LIMITS.stageHeight;
  }

  function makeSpawn(slot, index, x) {
    const team = slot.startsWith('p') ? 'player' : 'enemy';
    const ground = findGroundY(x);
    return {
      id: `spawn_${slot}`,
      slot,
      team,
      order: index + 1,
      x: Math.round(x * 1000) / 1000,
      y: Math.round((ground - LIMITS.unitRadius) * 1000) / 1000,
      direction: team === 'player' ? 'right' : 'left'
    };
  }

  function desiredSpawnSlots() {
    return $('spawnCount').value === '4' ? SLOT_ORDER.slice() : SLOT_ORDER.slice(0, 2);
  }

  function ensureSpawnCount(pushHistoryFirst) {
    if (pushHistoryFirst) pushUndo();
    const desired = desiredSpawnSlots();
    const ratios = { p1: 0.15, e1: 0.85, p2: 0.3, e2: 0.7 };
    const existing = new Map((state.stage.spawnPoints || []).map((spawn) => [spawn.slot, spawn]));
    state.stage.spawnPoints = desired.map((slot, index) => existing.get(slot) || makeSpawn(slot, index, LIMITS.stageWidth * ratios[slot]));
    state.stage.battleRules = Object.assign({}, state.stage.battleRules, { format: desired.length === 4 ? '2v2' : '1v1', maxPlayers: desired.length });
    if (!desired.includes(state.activeSpawn)) state.activeSpawn = desired[0];
    renderSpawnCards();
    renderAllCanvases();
    markDirty();
  }

  function autoPlaceSpawns(pushHistoryFirst) {
    if (pushHistoryFirst) pushUndo();
    const ratios = { p1: 0.15, e1: 0.85, p2: 0.3, e2: 0.7 };
    state.stage.spawnPoints = desiredSpawnSlots().map((slot, index) => makeSpawn(slot, index, LIMITS.stageWidth * ratios[slot]));
    state.stage.battleRules = Object.assign({}, state.stage.battleRules, { format: state.stage.spawnPoints.length === 4 ? '2v2' : '1v1', maxPlayers: state.stage.spawnPoints.length });
    renderSpawnCards();
    renderAllCanvases();
    markDirty();
  }

  function renderSpawnCards() {
    const container = $('spawnCards');
    if (!container || !state.stage) return;
    container.replaceChildren();
    const labels = { p1: 'プレイヤー1（青）', e1: '相手1（赤）', p2: 'プレイヤー2（青）', e2: '相手2（赤）' };
    for (const spawn of state.stage.spawnPoints || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `spawn-card${spawn.slot === state.activeSpawn ? ' is-selected' : ''}`;
      button.dataset.slot = spawn.slot;
      button.setAttribute('aria-pressed', String(spawn.slot === state.activeSpawn));
      const dot = document.createElement('span');
      dot.className = `team-dot ${spawn.team === 'player' ? 'blue' : 'red'}`;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = labels[spawn.slot] || spawn.slot;
      const small = document.createElement('small');
      small.textContent = `x ${Math.round(spawn.x)} / ${spawn.direction === 'left' ? '左向き' : '右向き'}`;
      text.append(strong, document.createElement('br'), small);
      button.append(dot, text);
      button.addEventListener('click', () => {
        state.activeSpawn = spawn.slot;
        renderSpawnCards();
        renderSpawnCanvas();
        $('spawnHint').textContent = `${labels[spawn.slot]}の配置先をタップしてください。`;
      });
      container.append(button);
    }
  }

  function placeSpawnFromPointer(event) {
    const canvas = $('spawnCanvas');
    const world = screenToWorld(canvas, event.clientX, event.clientY, false);
    const spawn = (state.stage.spawnPoints || []).find((item) => item.slot === state.activeSpawn);
    if (!spawn) return;
    const x = clamp(world.x, LIMITS.unitRadius, LIMITS.stageWidth - LIMITS.unitRadius);
    const ground = findGroundY(x);
    if (ground >= LIMITS.stageHeight) {
      $('spawnHint').textContent = 'この位置には地面がありません。別の場所を選んでください。';
      return;
    }
    pushUndo();
    spawn.x = Math.round(x * 1000) / 1000;
    spawn.y = Math.round((ground - LIMITS.unitRadius) * 1000) / 1000;
    renderSpawnCards();
    renderSpawnCanvas();
    markDirty();
    $('spawnHint').textContent = `${Math.round(spawn.x)}pxへ地面吸着で配置しました。`;
  }

  function toggleActiveSpawnFacing() {
    const spawn = (state.stage.spawnPoints || []).find((item) => item.slot === state.activeSpawn);
    if (!spawn) return;
    pushUndo();
    spawn.direction = spawn.direction === 'left' ? 'right' : 'left';
    renderSpawnCards();
    renderSpawnCanvas();
    markDirty();
  }

  function applyWindFromForm(pushHistoryFirst) {
    if (pushHistoryFirst) pushUndo();
    const others = (state.stage.gimmicks || []).filter((item) => item && item.type !== 'globalWind');
    if ($('windEnabled').checked) {
      others.push({
        id: 'gimmick_global_wind',
        type: 'globalWind',
        direction: Number($('windDirection').value),
        strength: Number($('windStrength').value) / 100
      });
    }
    state.stage.gimmicks = others;
    $('windOutput').textContent = $('windStrength').value;
    if (pushHistoryFirst) {
      markDirty();
      resetPlaytest(false);
    }
  }

  function applyAppearanceFromForm(pushHistoryFirst) {
    if (pushHistoryFirst) pushUndo();
    const preset = $('themeSelect').value;
    const theme = THEME_COLORS[preset] || THEME_COLORS.grass;
    const mode = ['theme', 'gradient', 'color'].includes($('backgroundMode').value) ? $('backgroundMode').value : 'theme';
    state.stage.background = Object.assign({}, state.stage.background, {
      mode,
      theme: preset,
      color: $('backgroundColor').value,
      gradient: { from: $('backgroundColor').value, to: theme.gradient[1] }
    });
    state.stage.decorations = Object.assign({}, state.stage.decorations, { enabled: $('decorationsEnabled').checked });
    state.stage.materials = [{ id: 'terrain', type: 'destructible', destructible: true, color: $('terrainColor').value }];
    state.appearanceBrightness = Number($('brightnessRange').value) / 100;
    updateAppearance();
    renderAllCanvases();
    markDirty();
  }

  function applyThemeDefaults() {
    const theme = THEME_COLORS[$('themeSelect').value] || THEME_COLORS.grass;
    $('backgroundColor').value = theme.gradient[0];
    $('terrainColor').value = theme.terrain;
    applyAppearanceFromForm(true);
  }

  function updateAppearance() {
    state.appearanceBrightness = Number($('brightnessRange').value) / 100;
    $('brightnessOutput').textContent = $('brightnessRange').value;
    renderTerrainCanvas();
  }

  function updateLowPowerModeUi() {
    const input = $('lowPowerMode');
    if (!input) return;
    input.checked = state.lowPowerMode;
    document.documentElement.classList.toggle('low-power-mode', state.lowPowerMode);
    $('showGrid').disabled = state.lowPowerMode;
    $('lowPowerHint').textContent = state.lowPowerMode
      ? (state.lowPowerAutoDetected ? '端末情報から自動で有効にしました。CanvasはDPR 1、グリッドと装飾は省略します。' : '軽量表示中：CanvasはDPR 1、グリッドと装飾は省略します。')
      : '標準表示中：Canvasは最大DPR 2で描画します。';
  }

  function setLowPowerMode(enabled) {
    state.lowPowerMode = !!enabled;
    state.lowPowerAutoDetected = false;
    updateLowPowerModeUi();
    renderAllCanvases();
    clearTimeout(state.preferenceSaveTimer);
    if (state.stage) state.preferenceSaveTimer = setTimeout(() => saveDraftNow(true, true), 250);
    showToast(state.lowPowerMode ? '軽量表示を有効にしました。' : '標準表示へ戻しました。');
  }

  function updateRangeOutputs() {
    $('reliefOutput').textContent = $('reliefRange').value;
    $('smoothOutput').textContent = $('smoothRange').value;
    $('platformOutput').textContent = $('platformRange').value;
    $('densityOutput').textContent = $('densityRange').value;
    $('valleyOutput').textContent = $('valleyRange').value;
    $('mountainOutput').textContent = $('mountainRange').value;
    $('cavityOutput').textContent = $('cavityRange').value;
    $('difficultyOutput').textContent = $('difficultyRange').value;
    $('brushOutput').textContent = $('brushSize').value;
    $('hardnessOutput').textContent = $('brushHardness').value;
    $('windOutput').textContent = $('windStrength').value;
    $('angleOutput').textContent = $('shotAngle').value;
    $('powerOutput').textContent = $('shotPower').value;
    $('brightnessOutput').textContent = $('brightnessRange').value;
  }

  function generationParameters() {
    return {
      elevation: Number($('reliefRange').value) / 100,
      smoothness: Number($('smoothRange').value) / 100,
      platformCount: Number($('platformRange').value),
      symmetric: $('symmetryInput').checked,
      density: Number($('densityRange').value) / 100,
      valleyDepth: Number($('valleyRange').value) / 100,
      mountainCount: Number($('mountainRange').value),
      cavityRate: Number($('cavityRange').value) / 100,
      destructibleRate: 1,
      hardTerrainRate: 0,
      playerCount: Number($('generationPlayerCount').value) === 4 ? 4 : 2,
      difficulty: Number($('difficultyRange').value) / 100
    };
  }

  function generationMetadata() {
    return {
      title: $('stageTitle').value.trim() || 'ステージ',
      description: $('stageDescription').value.trim(),
      authorDisplayName: $('stageAuthor').value.trim() || '作成者',
      theme: $('themeSelect').value
    };
  }

  function setGenerationBusy(busy) {
    $('generationProgress').hidden = !busy;
    if (busy) $('generationProgressText').textContent = '地形を生成しています… 10%';
    $('generateStage').disabled = busy;
    $('randomizeSeed').disabled = busy;
  }

  function finishGeneratedStage(stage) {
    const requestedTheme = state.generationJob && state.generationJob.metadata && state.generationJob.metadata.theme;
    const themeKey = THEME_COLORS[requestedTheme] ? requestedTheme : 'grass';
    const theme = THEME_COLORS[themeKey];
    stage.background = {
      mode: 'theme', theme: themeKey, color: theme.gradient[0],
      gradient: { from: theme.gradient[0], to: theme.gradient[1] }
    };
    if (stage.materials && stage.materials[0]) stage.materials[0].color = theme.terrain;
    state.generationJob = null;
    setGenerationBusy(false);
    setStage(stage);
    navigate('terrain');
    showToast('同じシードで再現できる地形を生成しました。');
  }

  function generateOnMainThread(job) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!state.generationJob || state.generationJob.id !== job.id) return;
        try {
          const stage = Core.generateStage(Object.assign({}, job.metadata, {
            seed: job.seed,
            preset: job.preset,
            generationParameters: job.parameters
          }));
          finishGeneratedStage(stage);
        } catch (error) {
          state.generationJob = null;
          setGenerationBusy(false);
          showToast(readableError(error, '地形を生成できませんでした。'), 5000);
        }
      }, 0);
    });
  }

  function startGeneration() {
    if (!coreReady()) return showToast('共通ステージモジュールを読み込めません。再読み込みしてください。', 5000);
    const seed = $('seedInput').value.trim();
    if (!seed) return showToast('シードを入力してください。');
    const job = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seed,
      preset: $('presetSelect').value,
      parameters: generationParameters(),
      metadata: generationMetadata()
    };
    state.generationJob = job;
    setGenerationBusy(true);
    if (state.generatorWorker) {
      try {
        state.generatorWorker.postMessage({
          type: 'generate', jobId: job.id, seed: job.seed, preset: job.preset,
          parameters: job.parameters, metadata: job.metadata
        });
        return;
      } catch (_) {
        state.generatorWorker.terminate();
        state.generatorWorker = null;
      }
    }
    generateOnMainThread(job);
  }

  function cancelGeneration() {
    if (!state.generationJob) return;
    if (state.generatorWorker) state.generatorWorker.postMessage({ type: 'cancel', jobId: state.generationJob.id });
    state.generationJob = null;
    setGenerationBusy(false);
    showToast('生成を中止しました。');
  }

  function initializeGeneratorWorker() {
    if (!('Worker' in globalThis)) return;
    try {
      const worker = new Worker('./generator-worker.js');
      worker.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'worker-error') {
          worker.terminate();
          state.generatorWorker = null;
          return;
        }
        if (!state.generationJob || message.jobId !== state.generationJob.id) return;
        if (message.type === 'progress') {
          $('generationProgressText').textContent = `地形を生成しています… ${Math.round(clamp(Number(message.value) || 0, 0, 1) * 100)}%`;
          return;
        }
        if (message.type === 'generated') finishGeneratedStage(message.stage);
        if (message.type === 'cancelled') { state.generationJob = null; setGenerationBusy(false); }
        if (message.type === 'error') {
          const job = state.generationJob;
          worker.terminate();
          state.generatorWorker = null;
          generateOnMainThread(job);
        }
      });
      worker.addEventListener('error', () => {
        const job = state.generationJob;
        worker.terminate();
        state.generatorWorker = null;
        if (job) generateOnMainThread(job);
      });
      state.generatorWorker = worker;
    } catch (_) {
      state.generatorWorker = null;
    }
  }

  function createBlankStage() {
    if (!coreReady()) return showToast('共通ステージモジュールを読み込めません。');
    const blank = Core.generateStage(Object.assign({}, generationMetadata(), {
      seed: $('seedInput').value.trim() || 'stage-studio',
      preset: 'blank',
      generationParameters: generationParameters()
    }));
    setStage(blank);
    navigate('terrain');
    showToast('白紙のステージを作成しました。');
  }

  function duplicateCurrentStage() {
    if (!state.stage) return;
    const identity = createDocument({ title: state.stage.title, authorDisplayName: state.stage.authorDisplayName });
    const copy = clone(state.stage);
    copy.stageId = identity.stageId;
    copy.title = `${copy.title || 'ステージ'}のコピー`.slice(0, LIMITS.maxTitleLength);
    copy.createdAt = nowIso();
    copy.updatedAt = copy.createdAt;
    copy.checksums = { algorithm: 'SHA-256', contentHash: '' };
    setStage(copy);
    navigate('new');
    showToast('別のステージIDで複製しました。');
  }

  function groundForGrid(grid, x, referenceY) {
    const testStage = stageForGrid(grid);
    if (Core && typeof Core.groundYAt === 'function') return Core.groundYAt(testStage, x, referenceY);
    const column = testStage.terrain.columns[clamp(Math.floor(x / LIMITS.columnWidth), 0, LIMITS.terrainColumns - 1)] || [];
    if (Number.isFinite(referenceY)) {
      const below = column.find((segment) => segment[0] >= referenceY);
      if (below) return below[0];
    }
    return column.length ? column[0][0] : LIMITS.stageHeight;
  }

  function setTestActorStatus(status, label) {
    state.testActorStatus = status;
    const output = $('testActorStatus');
    output.dataset.state = status;
    output.textContent = label;
  }

  function simulateTestActorFall(targetX, targetGround, reason) {
    const startY = Number.isFinite(state.testActorY) ? state.testActorY : Math.max(0, groundForGrid(state.testGrid, state.testActorX) - LIMITS.unitRadius);
    let y = startY;
    let velocityY = 0;
    const trail = [{ x: targetX, y }];
    const maximumSteps = Math.ceil(6 / PHYSICS.fixedDt);
    state.testActorX = targetX;
    setTestActorStatus('falling', '落下中');
    for (let step = 1; step <= maximumSteps; step++) {
      velocityY += PHYSICS.gravity * PHYSICS.fixedDt;
      y += velocityY * PHYSICS.fixedDt;
      if (step % 8 === 0) trail.push({ x: targetX, y: Math.min(y, PHYSICS.deadLineY - LIMITS.unitRadius) });
      if (y + LIMITS.unitRadius >= PHYSICS.deadLineY) {
        state.testActorY = PHYSICS.deadLineY - LIMITS.unitRadius;
        trail.push({ x: targetX, y: state.testActorY });
        state.testFallTrail = trail;
        setTestActorStatus('dead', '落下（DEAD LINE到達）');
        return {
          fell: true,
          dead: true,
          distance: Math.max(0, state.testActorY - startY),
          message: `${reason}、重力 ${PHYSICS.gravity}px/s²・固定刻み ${PHYSICS.fixedDt.toFixed(5)}秒で落下し、DEAD LINE（y=${Math.round(PHYSICS.deadLineY)}）へ到達しました。`
        };
      }
      if (Number.isFinite(targetGround) && targetGround < PHYSICS.deadLineY && y + LIMITS.unitRadius >= targetGround) {
        state.testActorY = targetGround - LIMITS.unitRadius;
        trail.push({ x: targetX, y: state.testActorY });
        state.testFallTrail = trail;
        const distance = Math.max(0, state.testActorY - startY);
        setTestActorStatus('landed', `着地（${Math.round(distance)}px落下）`);
        return {
          fell: true,
          dead: false,
          distance,
          message: `${reason}、${Math.round(distance)}px落下して下の足場へ着地しました。`
        };
      }
    }
    state.testActorY = PHYSICS.deadLineY - LIMITS.unitRadius;
    state.testFallTrail = trail.concat({ x: targetX, y: state.testActorY });
    setTestActorStatus('dead', '落下（確認上限到達）');
    return { fell: true, dead: true, distance: state.testActorY - startY, message: `${reason}、確認時間内に着地できませんでした。` };
  }

  function settleTestActor(reason, targetX) {
    const x = Number.isFinite(targetX) ? targetX : state.testActorX;
    const oldY = Number.isFinite(state.testActorY) ? state.testActorY : groundForGrid(state.testGrid, x) - LIMITS.unitRadius;
    const oldFeet = oldY + LIMITS.unitRadius;
    const targetGround = groundForGrid(state.testGrid, x, oldFeet);
    if (targetGround >= PHYSICS.deadLineY || targetGround - oldFeet > PHYSICS.fallTrigger) {
      return simulateTestActorFall(x, targetGround, reason);
    }
    state.testActorX = x;
    state.testActorY = targetGround - LIMITS.unitRadius;
    state.testFallTrail = [];
    setTestActorStatus('grounded', '接地');
    return { fell: false, dead: false, distance: 0, message: '' };
  }

  function resetPlaytest(showMessage) {
    if (!state.stage) return;
    state.testGrid = state.grid.slice();
    const first = (state.stage.spawnPoints || []).find((spawn) => spawn.slot === 'p1') || state.stage.spawnPoints[0];
    state.testActorX = first ? first.x : LIMITS.stageWidth * 0.15;
    const spawnFeetY = first && Number.isFinite(first.y) ? first.y + LIMITS.unitRadius : undefined;
    const ground = groundForGrid(state.testGrid, state.testActorX, spawnFeetY);
    state.testActorY = Math.min(ground, PHYSICS.deadLineY) - LIMITS.unitRadius;
    state.testFallTrail = [];
    if (ground >= PHYSICS.deadLineY) setTestActorStatus('dead', '落下（足場なし）');
    else setTestActorStatus('grounded', '接地');
    state.testTrajectory = [];
    state.testImpact = null;
    if (showMessage !== false) {
      $('testResult').textContent = ground >= PHYSICS.deadLineY
        ? `開始地点に足場がなく、DEAD LINE（y=${Math.round(PHYSICS.deadLineY)}）へ落下する配置です。`
        : 'テスト状態をリセットしました。';
    }
    renderTestCanvas();
  }

  function moveTestActor(direction) {
    if (!state.testGrid) resetPlaytest(false);
    if (state.testActorStatus === 'dead') {
      $('testResult').textContent = 'キャラクターは落下済みです。テストをリセットしてください。';
      return;
    }
    const nextX = clamp(state.testActorX + direction * 28, LIMITS.unitRadius, LIMITS.stageWidth - LIMITS.unitRadius);
    state.testTrajectory = [];
    state.testImpact = null;
    const settled = settleTestActor('移動先で足場を失い', nextX);
    $('testResult').textContent = settled.fell ? settled.message : `左右移動を確認中：x ${Math.round(nextX)}px。足場へ接地しています。`;
    renderTestCanvas();
  }

  function fallbackTrace(stage, options) {
    const radians = options.angle * Math.PI / 180;
    const projectile = {
      x: options.x,
      y: options.y,
      vx: Math.cos(radians) * options.power * PHYSICS.velocityScale,
      vy: -Math.sin(radians) * options.power * PHYSICS.velocityScale
    };
    const wind = (stage.gimmicks || []).find((item) => item.type === 'globalWind');
    const acceleration = wind ? Number(wind.direction) * Number(wind.strength) * PHYSICS.windAccelerationMax : 0;
    const points = [{ x: projectile.x, y: projectile.y }];
    let hit = null;
    for (let step = 1; step <= 960; step++) {
      projectile.vx += acceleration * PHYSICS.fixedDt;
      projectile.vy += PHYSICS.gravity * PHYSICS.fixedDt;
      projectile.x += projectile.vx * PHYSICS.fixedDt;
      projectile.y += projectile.vy * PHYSICS.fixedDt;
      if (step % 4 === 0) points.push({ x: projectile.x, y: projectile.y });
      const column = stage.terrain.columns[Math.floor(projectile.x / LIMITS.columnWidth)] || [];
      if (column.some((segment) => projectile.y >= segment[0] && projectile.y < segment[1])) { hit = { x: projectile.x, y: projectile.y }; break; }
      if (projectile.x < -64 || projectile.x > LIMITS.stageWidth + 64 || projectile.y > LIMITS.stageHeight + 64) break;
    }
    return { points, hit, outcome: hit ? 'terrain' : 'out' };
  }

  function firePlaytest() {
    if (!state.testGrid) resetPlaytest(false);
    if (state.testActorStatus === 'dead') {
      $('testResult').textContent = 'キャラクターは落下済みです。テストをリセットしてください。';
      return;
    }
    const testStage = stageForGrid(state.testGrid);
    const actorFeetY = Number.isFinite(state.testActorY) ? state.testActorY + LIMITS.unitRadius : undefined;
    const ground = groundForGrid(state.testGrid, state.testActorX, actorFeetY);
    if (ground >= PHYSICS.deadLineY) {
      const fallen = settleTestActor('砲撃前に足場を失い', state.testActorX);
      $('testResult').textContent = fallen.message;
      renderTestCanvas();
      return;
    }
    const options = {
      x: state.testActorX,
      y: (Number.isFinite(state.testActorY) ? state.testActorY : ground - LIMITS.unitRadius) - 8,
      angle: Number($('shotAngle').value),
      power: Number($('shotPower').value),
      maxSeconds: 8
    };
    let result;
    try {
      result = Core && typeof Core.traceProjectile === 'function' ? Core.traceProjectile(testStage, options) : fallbackTrace(testStage, options);
    } catch (error) {
      showToast(readableError(error, '弾道を計算できませんでした。'));
      return;
    }
    state.testTrajectory = Array.isArray(result.points) ? result.points : [];
    state.testImpact = result.hit || result.impact || null;
    if (state.testImpact) {
      paintCircle(state.testGrid, state.testImpact.x, state.testImpact.y, PHYSICS.normalBlastRadius, false);
      enforceTerrainBounds(state.testGrid);
      const settled = settleTestActor('爆発で足場が崩れ', state.testActorX);
      const impactMessage = `着弾 x ${Math.round(state.testImpact.x)} / y ${Math.round(state.testImpact.y)}。爆発範囲と地形破壊を反映しました。`;
      $('testResult').textContent = settled.fell ? `${impactMessage} ${settled.message}` : `${impactMessage} キャラクターは足場へ接地しています。`;
    } else {
      $('testResult').textContent = '砲弾は地形へ当たらず画面外へ出ました。角度や威力を調整してください。';
    }
    renderTestCanvas();
  }

  function materializeStage() {
    syncMetadataFromForm();
    syncTerrainToStage();
    applyWindFromForm(false);
    const preset = $('themeSelect').value;
    const theme = THEME_COLORS[preset] || THEME_COLORS.grass;
    const mode = ['theme', 'gradient', 'color'].includes($('backgroundMode').value) ? $('backgroundMode').value : 'theme';
    state.stage.background = Object.assign({}, state.stage.background, {
      mode, theme: preset, color: $('backgroundColor').value,
      gradient: { from: $('backgroundColor').value, to: theme.gradient[1] }
    });
    state.stage.decorations = Object.assign({}, state.stage.decorations, { enabled: $('decorationsEnabled').checked });
    state.stage.materials = [{ id: 'terrain', type: 'destructible', destructible: true, color: $('terrainColor').value }];
    state.appearanceBrightness = Number($('brightnessRange').value) / 100;
    return clone(state.stage);
  }

  function validateCurrentStage(showResult) {
    const document = materializeStage();
    let result;
    if (Core && typeof Core.validateStage === 'function') result = Core.validateStage(document);
    else result = { valid: false, errors: [{ code: 'core.missing', message: '共通検証モジュールを読み込めません。' }], warnings: [] };
    state.lastValidation = result;
    renderValidation(result);
    if (showResult) {
      if (result.valid && !(result.warnings || []).length) showToast('エラーなし。共有できる状態です。');
      else if (result.valid) showToast(`保存できます。参考警告が${result.warnings.length}件あります。`);
      else showToast(`修正が必要なエラーが${result.errors.length}件あります。`, 4500);
    }
    updateExportSummary();
    return result;
  }

  async function validateAndFinalize() {
    const result = validateCurrentStage(false);
    if (!result.valid) {
      showToast(`修正が必要なエラーが${result.errors.length}件あります。`, 4500);
      return result;
    }
    try {
      const finalized = Core && typeof Core.finalizeStage === 'function'
        ? await Core.finalizeStage(materializeStage(), { touchUpdatedAt: false }) : materializeStage();
      state.stage = clone(finalized);
      state.lastValidation = Core && typeof Core.validateStage === 'function' ? Core.validateStage(state.stage) : result;
      renderValidation(state.lastValidation);
      updateExportSummary();
      await saveDraftNow(true, true);
      const warnings = state.lastValidation.warnings || [];
      showToast(warnings.length ? `保存できます。参考警告が${warnings.length}件あります。` : 'エラーなし。共有できる状態です。');
      return state.lastValidation;
    } catch (error) {
      showToast(readableError(error, 'ハッシュを生成できませんでした。'), 5000);
      return result;
    }
  }

  function renderIssueList(element, issues, emptyText) {
    element.replaceChildren();
    if (!issues || !issues.length) {
      const item = document.createElement('li');
      item.className = 'muted';
      item.textContent = emptyText;
      element.append(item);
      return;
    }
    for (const issue of issues) {
      const item = document.createElement('li');
      item.textContent = issueText(issue);
      element.append(item);
    }
  }

  function renderValidation(result) {
    const summary = $('validationSummary');
    summary.className = 'validation-summary is-idle';
    if (!result) {
      summary.replaceChildren();
      const strong = document.createElement('strong'); strong.textContent = 'まだ検証していません';
      const span = document.createElement('span'); span.textContent = '保存・共有前に確認してください。';
      summary.append(strong, span);
      renderIssueList($('validationErrors'), [], '検証後に表示します。');
      renderIssueList($('validationWarnings'), [], '検証後に表示します。');
      return;
    }
    const warnings = result.warnings || [];
    summary.className = `validation-summary ${result.valid ? (warnings.length ? 'is-warning' : 'is-valid') : 'is-invalid'}`;
    summary.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = result.valid ? (warnings.length ? '保存できます（参考警告あり）' : '検証OK') : '修正が必要です';
    const span = document.createElement('span');
    span.textContent = `エラー ${result.errors ? result.errors.length : 0}件 / 警告 ${warnings.length}件`;
    summary.append(strong, span);
    renderIssueList($('validationErrors'), result.errors || [], 'エラーはありません。');
    renderIssueList($('validationWarnings'), warnings, '警告はありません。');
  }

  async function finalizeForExport() {
    const result = validateCurrentStage(false);
    if (!result.valid) {
      navigate('validate');
      throw new Error('検証エラーを修正してから共有してください。');
    }
    const document = materializeStage();
    const finalized = Core && typeof Core.finalizeStage === 'function'
      ? await Core.finalizeStage(document, { touchUpdatedAt: false }) : document;
    state.stage = clone(finalized);
    updateExportSummary();
    await saveDraftNow(true, true);
    return finalized;
  }

  function blobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeFileBase(title) {
    return Core && typeof Core.safeFileName === 'function' ? Core.safeFileName(title) : String(title || 'stage').replace(/[^\w\-]+/g, '-').slice(0, 48).toLowerCase();
  }

  async function makeJsonFile() {
    const finalized = await finalizeForExport();
    const json = JSON.stringify(finalized, null, 2);
    return new File([json], `${safeFileBase(finalized.title)}.stage.json`, { type: 'application/json' });
  }

  async function makeZipFile() {
    const finalized = await finalizeForExport();
    if (!(StageZip && typeof StageZip.createStageBundle === 'function')) throw new Error('この環境ではZIP機能を読み込めません。JSONをご利用ください。');
    const blob = await StageZip.createStageBundle(finalized, { core: Core });
    return new File([blob], `${safeFileBase(finalized.title)}.stage.zip`, { type: 'application/zip' });
  }

  async function exportJson() {
    try {
      const file = await makeJsonFile();
      blobDownload(file, file.name);
      showToast(`${file.name} を保存しました。`);
    } catch (error) { showToast(readableError(error), 5000); }
  }

  async function exportZip() {
    try {
      const file = await makeZipFile();
      blobDownload(file, file.name);
      showToast(`${file.name} を保存しました。`);
    } catch (error) { showToast(readableError(error), 5000); }
  }

  async function shareStage() {
    try {
      const file = await makeJsonFile();
      let shareFailed = false;
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title: state.stage.title, text: 'Stage Studioで作成したステージです。', files: [file] });
          showToast('共有シートへ渡しました。');
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          shareFailed = true;
        }
      }
      blobDownload(file, file.name);
      showToast(shareFailed
        ? '共有に失敗したため、ファイルへ保存しました。'
        : '共有シートが利用できないため、ファイルへ保存しました。');
    } catch (error) {
      showToast(readableError(error), 5000);
    }
  }

  async function copyJson() {
    try {
      const finalized = await finalizeForExport();
      const text = JSON.stringify(finalized);
      let copied = false;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (_) {
          // iOSではハッシュ計算や端末保存を待つ間にユーザー操作権限が切れる場合がある。
          // Clipboard APIが存在しても失敗した時は、従来の選択コピーへ切り替える。
        }
      }
      if (!copied) {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        try {
          area.select();
          if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) throw new Error('コピーできませんでした。');
        } finally {
          area.remove();
        }
      }
      showToast('正規化済みJSONをコピーしました。');
    } catch (error) { showToast(readableError(error), 5000); }
  }

  function hasZipSignature(bytes) {
    return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
  }

  async function importStageFile(file) {
    if (!file) return;
    const maxInput = Math.max(LIMITS.maxJsonBytes, LIMITS.maxZipBytes);
    if (file.size > maxInput) return showToast('ファイル容量が上限を超えています。', 5000);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let stageDocument;
      if (hasZipSignature(bytes)) {
        if (!(StageZip && typeof StageZip.readStageBundle === 'function')) throw new Error('ZIP読込機能を利用できません。JSONファイルを選んでください。');
        const bundle = await StageZip.readStageBundle(bytes, { core: Core, verifyHash: true });
        stageDocument = bundle.stage;
      } else {
        if (bytes.length > LIMITS.maxJsonBytes) throw new Error('JSONファイルの容量上限を超えています。');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!text.trimStart().startsWith('{')) throw new Error('JSONまたはZIP形式ではありません。');
        stageDocument = JSON.parse(text);
        if (!Core || typeof Core.validateStage !== 'function') throw new Error('共通検証モジュールを読み込めません。');
        const rawResult = Core.validateStage(stageDocument, { fileSize: file.size });
        if (!rawResult.valid) {
          const error = new Error(issueText(rawResult.errors[0]));
          error.validation = rawResult;
          throw error;
        }
        if (Core && typeof Core.migrateStage === 'function') {
          stageDocument = Core.migrateStage(stageDocument);
          if (!stageDocument) throw new Error('対応していないステージ形式です。');
        }
        const result = Core.validateStage(stageDocument, { fileSize: file.size });
        if (!result.valid) {
          const error = new Error(issueText(result.errors[0]));
          error.validation = result;
          throw error;
        }
        const hash = stageDocument.checksums && stageDocument.checksums.contentHash;
        if (!/^[a-f0-9]{64}$/i.test(String(hash || ''))) throw new Error('contentHashがないためインポートできません。Stage Studioから再出力してください。');
        if (Core.verifyStageHash) {
          const hashResult = await Core.verifyStageHash(stageDocument);
          const hashValid = typeof hashResult === 'boolean' ? hashResult : !!(hashResult && hashResult.valid);
          if (!hashValid) throw new Error('contentHashが一致しません。ファイルが変更または破損しています。');
        }
      }
      setStage(stageDocument, { skipSave: true });
      state.documentStarted = true;
      await saveDraftNow(true, true);
      navigate('terrain');
      showToast(`「${state.stage.title}」を安全にインポートしました。`);
    } catch (error) {
      showToast(readableError(error, 'ファイルを安全に読み込めませんでした。'), 6000);
    } finally {
      document.querySelectorAll('input[type="file"]').forEach((input) => { input.value = ''; });
    }
  }

  function updateExportSummary() {
    if (!state.stage) return;
    $('exportStageTitle').textContent = state.stage.title || '名称未設定';
    $('exportAuthor').textContent = state.stage.authorDisplayName || '作成者';
    const compatibility = state.stage.gameCompatibility || {};
    $('exportCompatibility').textContent = `${compatibility.gameId || '対象ゲーム'} ${compatibility.minBuild || ''}`.trim();
    const validation = state.lastValidation;
    $('exportValidation').textContent = validation ? (validation.valid ? '保存可能' : `エラー ${validation.errors.length}件`) : '未検証';
    $('exportWarningCount').textContent = validation ? `${(validation.warnings || []).length}件` : '—';
    const bytes = new Blob([JSON.stringify(state.stage)]).size;
    $('exportFileSize').textContent = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB（JSON推定）` : `${bytes}B（JSON推定）`;
    const hash = state.stage.checksums && state.stage.checksums.contentHash || '';
    $('exportHash').textContent = hash || '未生成';
  }

  function updateShareCapabilities() {
    const parts = ['ファイル保存', 'JSONコピー'];
    let fileShare = false;
    try {
      const probe = new File(['{}'], 'stage.json', { type: 'application/json' });
      fileShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
    } catch (_) { fileShare = false; }
    if (fileShare) parts.unshift('OS共有シート');
    $('shareStage').hidden = !fileShare;
    if (StageZip && typeof StageZip.createStageBundle === 'function') parts.push('ZIP');
    else $('exportZip').disabled = true;
    $('shareCapabilities').textContent = `この端末で利用可能: ${parts.join(' / ')}`;
  }

  function setActiveTool(tool) {
    const supported = ['draw', 'erase', 'line', 'rectangle', 'circle', 'fill', 'guide'];
    state.activeTool = supported.includes(tool) ? tool : 'draw';
    document.querySelectorAll('[data-tool]').forEach((button) => {
      const selected = button.dataset.tool === state.activeTool;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const label = $('activeTerrainTool');
    if (label) label.textContent = TERRAIN_TOOL_LABELS[state.activeTool] || TERRAIN_TOOL_LABELS.draw;
  }

  function setTerrainInspector(panelName) {
    const supported = ['brush', 'shape', 'display', 'appearance'];
    const selectedPanel = supported.includes(panelName) ? panelName : 'brush';
    document.querySelectorAll('[data-terrain-panel]').forEach((button) => {
      const selected = button.dataset.terrainPanel === selectedPanel;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-terrain-panel-content]').forEach((panel) => {
      panel.hidden = panel.dataset.terrainPanelContent !== selectedPanel;
    });
  }

  function randomSeed() {
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const values = globalThis.crypto.getRandomValues(new Uint32Array(2));
      return `stage-${values[0].toString(36)}-${values[1].toString(36)}`;
    }
    return `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function populatePresets() {
    const select = $('presetSelect');
    select.replaceChildren();
    const source = Core && Array.isArray(Core.PRESETS)
      ? Core.PRESETS
      : Object.keys(PRESET_LABELS).map((key) => ({ key, name: PRESET_LABELS[key] }));
    for (const preset of source) {
      if (!preset || preset.key === 'blank') continue;
      const option = document.createElement('option');
      option.value = preset.key;
      option.textContent = preset.name || PRESET_LABELS[preset.key] || preset.key;
      select.append(option);
    }
    select.value = select.querySelector('option[value="rolling"]') ? 'rolling' : (select.options[0] && select.options[0].value || 'rolling');
  }

  async function resumeLatestDraft() {
    try {
      const drafts = (await listDrafts()).filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      if (!drafts.length) return showToast('再開できる下書きがありません。');
      loadDraftRecord(drafts[0]);
    } catch (error) {
      showToast(readableError(error, '下書きを再開できませんでした。'), 5000);
    }
  }

  async function updateConnectivity(event) {
    if (event && event.type === 'online') {
      $('offlineNotice').hidden = true;
      return;
    }
    let offline = navigator.onLine === false;
    if (!offline && 'caches' in globalThis) {
      try {
        const marker = new URL('./.offline-marker', location.href).href;
        offline = !!(await caches.match(marker));
      } catch (_) {}
    }
    $('offlineNotice').hidden = !offline;
  }

  function updateInstallGuide() {
    const standalone = globalThis.matchMedia && globalThis.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = navigator.standalone === true;
    if (standalone || iosStandalone) {
      $('installGuide').textContent = 'Stage Studioはアプリ表示で動作中です。オフラインでも下書きを編集できます。';
      $('installButton').hidden = true;
      return;
    }
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) {
      $('installGuide').textContent = 'Safariの共有ボタンから「ホーム画面に追加」を選んでください。インストールしなくても利用できます。';
    } else if (/Android/i.test(ua)) {
      $('installGuide').textContent = 'Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。';
    } else {
      $('installGuide').textContent = '対応ブラウザのメニューからアプリとしてインストールできます。通常のタブでも利用できます。';
    }
  }

  function setupPwa() {
    updateInstallGuide();
    globalThis.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      $('installButton').hidden = false;
    });
    globalThis.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      $('installButton').hidden = true;
      updateInstallGuide();
      showToast('Stage Studioをインストールしました。');
    });
    $('installButton').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) {
        updateInstallGuide();
        return showToast($('installGuide').textContent, 5000);
      }
      state.deferredInstallPrompt.prompt();
      try { await state.deferredInstallPrompt.userChoice; } catch (_) {}
      state.deferredInstallPrompt = null;
      $('installButton').hidden = true;
    });

    if (!('serviceWorker' in navigator)) return;
    const hadStudioController = !!(navigator.serviceWorker.controller
      && /\/tools\/stage-studio\/sw\.js$/i.test(new URL(navigator.serviceWorker.controller.scriptURL).pathname));
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!state.pwaUpdateRequested) return;
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      const announceWaiting = () => { if (hadStudioController && registration.waiting) $('updateNotice').hidden = false; };
      announceWaiting();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && hadStudioController) $('updateNotice').hidden = false;
        });
      });
      $('applyUpdate').addEventListener('click', async () => {
        const saved = await saveDraftNow(true);
        const durable = await refreshStorageEstimate();
        if (!saved || state.dirty || !durable) {
          showToast('端末へ安全に保存できないため更新を中止しました。JSONでバックアップしてから再度お試しください。', 7000);
          return;
        }
        state.pwaUpdateRequested = true;
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      });
    }).catch(() => {
      $('installGuide').textContent += ' オフライン準備に失敗した場合は、オンライン時に再読み込みしてください。';
    });
  }

  function bindEvents() {
    document.querySelectorAll('.step-tab').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.step === 'spawns' && state.stage) {
          const wanted = desiredSpawnSlots().length;
          if (!Array.isArray(state.stage.spawnPoints) || state.stage.spawnPoints.length !== wanted) ensureSpawnCount(false);
        }
        navigate(button.dataset.step);
      });
    });

    $('newStageHome').addEventListener('click', () => navigate('new'));
    $('resumeDraftButton').addEventListener('click', resumeLatestDraft);
    $('refreshDrafts').addEventListener('click', () => { refreshDraftList(); refreshStorageEstimate(); });
    $('lowPowerMode').addEventListener('change', (event) => setLowPowerMode(event.target.checked));
    $('startBlank').addEventListener('click', createBlankStage);
    $('startPreset').addEventListener('click', () => navigate('generate'));
    $('duplicateCurrent').addEventListener('click', duplicateCurrentStage);

    ['importFileHome', 'importFileNew', 'importFileExport'].forEach((id) => {
      $(id).addEventListener('change', (event) => importStageFile(event.target.files && event.target.files[0]));
    });

    ['stageTitle', 'stageAuthor', 'stageDescription'].forEach((id) => {
      $(id).addEventListener('input', () => {
        syncMetadataFromForm();
        markDirty();
      });
    });

    ['reliefRange', 'smoothRange', 'platformRange', 'densityRange', 'valleyRange', 'mountainRange', 'cavityRange', 'difficultyRange']
      .forEach((id) => $(id).addEventListener('input', updateRangeOutputs));
    $('randomizeSeed').addEventListener('click', () => { $('seedInput').value = randomSeed(); });
    $('generateStage').addEventListener('click', startGeneration);
    $('cancelGeneration').addEventListener('click', cancelGeneration);

    $('toolDraw').addEventListener('click', () => setActiveTool('draw'));
    $('toolErase').addEventListener('click', () => setActiveTool('erase'));
    $('toolLine').addEventListener('click', () => setActiveTool('line'));
    $('toolRectangle').addEventListener('click', () => setActiveTool('rectangle'));
    $('toolCircle').addEventListener('click', () => setActiveTool('circle'));
    $('toolFill').addEventListener('click', () => setActiveTool('fill'));
    $('toolGuide').addEventListener('click', () => setActiveTool('guide'));
    $('snapCharacterGuides').addEventListener('click', snapInvalidCharacterGuides);
    document.querySelectorAll('[data-orientation-toggle]').forEach((button) => {
      button.addEventListener('click', () => togglePreferredOrientation(button));
    });
    document.querySelectorAll('[data-orientation-dismiss]').forEach((button) => {
      button.addEventListener('click', () => {
        state.orientationGuideToken += 1;
        button.closest('[data-orientation-guide]').hidden = true;
      });
    });
    document.querySelectorAll('[data-terrain-panel]').forEach((button) => {
      button.addEventListener('click', () => setTerrainInspector(button.dataset.terrainPanel));
    });
    $('undoButton').addEventListener('click', undo);
    $('redoButton').addEventListener('click', redo);
    $('undoGlobal').addEventListener('click', undo);
    $('redoGlobal').addEventListener('click', redo);
    $('clearTerrain').addEventListener('click', async () => {
      if (!(await confirmAction('地形を全消去', '描いた地形をすべて消去します。Undoで戻せます。'))) return;
      pushUndo();
      state.grid.fill(0);
      syncTerrainToStage();
      resetPlaytest(false);
      renderAllCanvases();
      markDirty();
    });
    $('smoothTerrain').addEventListener('click', () => runTerrainOperation('滑らか処理', smoothTerrainGrid));
    $('flattenTerrain').addEventListener('click', () => runTerrainOperation('平坦化', flattenTerrainGrid));
    $('noiseTerrain').addEventListener('click', () => runTerrainOperation('ノイズ', addTerrainNoise));
    $('mirrorTerrain').addEventListener('click', () => runTerrainOperation('左右反転', mirrorTerrainGrid));
    $('symmetrizeTerrain').addEventListener('click', () => runTerrainOperation('左右対称化', symmetrizeTerrainGrid));
    $('brushSize').addEventListener('input', updateRangeOutputs);
    $('brushHardness').addEventListener('input', updateRangeOutputs);
    $('showGrid').addEventListener('change', renderTerrainCanvas);
    $('showCollision').addEventListener('change', renderTerrainCanvas);
    $('zoomOut').addEventListener('click', () => setZoom(state.view.zoom / 1.25));
    $('zoomIn').addEventListener('click', () => setZoom(state.view.zoom * 1.25));
    $('zoomReset').addEventListener('click', () => {
      state.view = { zoom: 1, panX: 0, panY: 0 };
      renderTerrainCanvas();
    });

    const terrainCanvas = $('terrainCanvas');
    terrainCanvas.addEventListener('pointerdown', (event) => {
      if ($('toolLock').checked) return showToast('ツールロック中です。解除すると編集できます。');
      event.preventDefault();
      beginTerrainPointer(event);
    });
    terrainCanvas.addEventListener('pointermove', (event) => {
      if (!state.pointerMap.has(event.pointerId)) return;
      event.preventDefault();
      moveTerrainPointer(event);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => terrainCanvas.addEventListener(type, endTerrainPointer));

    $('spawnCount').addEventListener('change', () => ensureSpawnCount(true));
    $('autoPlaceSpawns').addEventListener('click', () => autoPlaceSpawns(true));
    $('toggleSpawnFacing').addEventListener('click', toggleActiveSpawnFacing);
    $('spawnCanvas').addEventListener('pointerdown', (event) => {
      if (!event.isPrimary) return;
      event.preventDefault();
      placeSpawnFromPointer(event);
    });

    $('windEnabled').addEventListener('change', () => applyWindFromForm(true));
    $('windDirection').addEventListener('change', () => applyWindFromForm(true));
    $('windStrength').addEventListener('input', updateRangeOutputs);
    $('windStrength').addEventListener('change', () => applyWindFromForm(true));

    $('themeSelect').addEventListener('change', applyThemeDefaults);
    $('backgroundMode').addEventListener('change', () => applyAppearanceFromForm(true));
    ['backgroundColor', 'terrainColor', 'brightnessRange'].forEach((id) => $(id).addEventListener('input', updateAppearance));
    ['backgroundColor', 'terrainColor', 'brightnessRange'].forEach((id) => $(id).addEventListener('change', () => applyAppearanceFromForm(true)));
    $('decorationsEnabled').addEventListener('change', () => applyAppearanceFromForm(true));

    ['shotAngle', 'shotPower'].forEach((id) => $(id).addEventListener('input', updateRangeOutputs));
    $('moveTestLeft').addEventListener('click', () => moveTestActor(-1));
    $('moveTestRight').addEventListener('click', () => moveTestActor(1));
    $('fireTest').addEventListener('click', firePlaytest);
    $('resetTest').addEventListener('click', () => resetPlaytest(true));

    $('validateStage').addEventListener('click', validateAndFinalize);
    $('saveDraft').addEventListener('click', () => saveDraftNow(false));
    $('exportJson').addEventListener('click', exportJson);
    $('exportZip').addEventListener('click', exportZip);
    $('shareStage').addEventListener('click', shareStage);
    $('copyJson').addEventListener('click', copyJson);

    globalThis.addEventListener('online', updateConnectivity);
    globalThis.addEventListener('offline', updateConnectivity);
    globalThis.addEventListener('orientationchange', updateOrientationControls);
    globalThis.addEventListener('resize', updateOrientationControls);
    document.addEventListener('fullscreenchange', updateOrientationControls);
    globalThis.addEventListener('popstate', () => {
      const screen = location.hash.slice(1);
      navigate(normalizeScreen(screen), { fromHistory: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.dirty) saveDraftNow(true);
    });
    globalThis.addEventListener('pagehide', () => { if (state.dirty) saveDraftNow(true); });

    if ('ResizeObserver' in globalThis) {
      const observer = new ResizeObserver(renderAllCanvases);
      ['terrainCanvas', 'spawnCanvas', 'testCanvas'].forEach((id) => observer.observe($(id)));
    } else {
      globalThis.addEventListener('resize', renderAllCanvases);
    }
  }

  function initialize() {
    populatePresets();
    bindEvents();
    initializeGeneratorWorker();
    setupPwa();
    updateConnectivity();
    updateRangeOutputs();
    updateShareCapabilities();
    setActiveTool('draw');
    updateLowPowerModeUi();
    updateHistoryButtons();
    setTerrainInspector('brush');
    updateOrientationControls();
    $('appVersion').textContent = `${APP_VERSION}${Core && Core.GENERATOR_VERSION ? ` / 生成器 ${Core.GENERATOR_VERSION}` : ''}`;

    if (coreReady()) {
      try {
        const initial = Core.generateStage({
          seed: $('seedInput').value,
          preset: 'rolling',
          generationParameters: generationParameters(),
          title: $('stageTitle').value,
          authorDisplayName: $('stageAuthor').value,
          theme: $('themeSelect').value
        });
        setStage(initial, { skipSave: true });
        $('saveState').textContent = '新規作成できます';
      } catch (error) {
        setStage(createDocument(), { skipSave: true });
        showToast(readableError(error, '初期ステージを準備できませんでした。'), 6000);
      }
    } else {
      setStage(createDocument(), { skipSave: true });
      $('saveState').textContent = '共通モジュール読込エラー';
      showToast('共通ステージモジュールを読み込めません。サーバー経由で再度開いてください。', 7000);
    }

    refreshDraftList();
    refreshStorageEstimate();
    const requestedScreen = location.hash.slice(1);
    const firstScreen = requestedScreen ? normalizeScreen(requestedScreen) : 'home';
    history.replaceState({ stageStudioScreen: firstScreen }, '', `#${firstScreen}`);
    navigate(firstScreen, { fromHistory: true });
    state.ready = true;
  }

  initialize();
})();
