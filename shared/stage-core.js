(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = '1.0.0';
  const GENERATOR_VERSION = '1.0.0';
  const GAME_ID = 'katamon';
  const GAME_BUILD = 'v137';
  const LIMITS = Object.freeze({
    stageWidth: 1440,
    stageHeight: 660,
    terrainBottomY: 636,
    columnWidth: 3,
    rowHeight: 4,
    terrainColumns: 480,
    terrainRows: 165,
    maxSpawnPoints: 4,
    minSpawnPoints: 2,
    maxGimmicks: 16,
    maxSegmentsPerColumn: 8,
    maxJsonBytes: 2 * 1024 * 1024,
    maxZipBytes: 6 * 1024 * 1024,
    maxUncompressedBytes: 12 * 1024 * 1024,
    maxTitleLength: 48,
    maxDescriptionLength: 500,
    maxAuthorLength: 32,
    unitRadius: 16,
    minimumTerrainThickness: 12
  });
  const PHYSICS = Object.freeze({
    fixedDt: 1 / 120,
    gravity: 650,
    windAccelerationMax: 260,
    velocityScale: 7.8,
    projectileRadius: 5,
    normalBlastRadius: 44,
    stageExitMargin: 30
  });
  const PRESET_KEYS = Object.freeze([
    'flat', 'rolling', 'plateauLeft', 'plateauRight', 'mountainCenter', 'valley',
    'grandCanyon', 'centerHole', 'crater', 'stairs', 'symmetric', 'asymmetric',
    'fortress', 'floatingIslands', 'platforms', 'cave', 'elevation', 'random'
  ]);
  const PRESET_LABELS = Object.freeze({
    flat: '蟷ｳ蜴・, rolling: '荳倬匏', plateauLeft: '蟾ｦ鬮伜床', plateauRight: '蜿ｳ鬮伜床',
    mountainCenter: '荳ｭ螟ｮ螻ｱ', valley: '貂楢ｰｷ', grandCanyon: '螟ｧ蟲｡隹ｷ', centerHole: '荳ｭ螟ｮ遨ｴ',
    crater: '繧ｯ繝ｬ繝ｼ繧ｿ繝ｼ', stairs: '髫取ｮｵ', symmetric: '蟾ｦ蜿ｳ蟇ｾ遘ｰ', asymmetric: '蟾ｦ蜿ｳ髱槫ｯｾ遘ｰ',
    fortress: '隕∝｡・, floatingIslands: '豬ｮ蟲ｶ', platforms: '隍・焚雜ｳ蝣ｴ', cave: '豢樒ｪ・,
    elevation: '鬮倅ｽ主ｷｮ驥崎ｦ・, random: '繝ｩ繝ｳ繝繝'
  });
  const BACKGROUND_PRESETS = Object.freeze(['grass', 'desert', 'snow', 'volcanic']);
  const MATERIAL_TYPES = Object.freeze(['destructible']);
  const GIMMICK_TYPES = Object.freeze(['globalWind']);
  const SLOT_ORDER = Object.freeze(['p1', 'e1', 'p2', 'e2']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundNumber(value, precision) {
    const scale = Math.pow(10, precision == null ? 3 : precision);
    return Math.round(value * scale) / scale;
  }

  function sanitizeText(value, maxLength, fallback) {
    const text = String(value == null ? fallback || '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim();
    return text.slice(0, maxLength);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function stableObject(value, key) {
    if (typeof value === 'number') return Number.isFinite(value) ? roundNumber(value, 3) : null;
    if (Array.isArray(value)) return value.map((item) => stableObject(item));
    if (!isPlainObject(value)) return value;
    const result = {};
    Object.keys(value).sort().forEach((name) => {
      if (key === 'root' && name === 'checksums') return;
      if (typeof value[name] === 'undefined') return;
      result[name] = stableObject(value[name], name);
    });
    return result;
  }

  function canonicalStringify(stage) {
    return JSON.stringify(stableObject(stage, 'root'));
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(text, 'utf8'));
    throw new Error('UTF-8螟画鋤繧貞茜逕ｨ縺ｧ縺阪∪縺帙ｓ縲・);
  }

  async function sha256Hex(value) {
    const bytes = value instanceof Uint8Array ? value : utf8Bytes(String(value));
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoApi && cryptoApi.subtle) {
      const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') {
      return require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    }
    throw new Error('SHA-256繧貞茜逕ｨ縺ｧ縺阪∪縺帙ｓ縲・);
  }

  async function contentHash(stage) {
    return sha256Hex(canonicalStringify(stage));
  }

  function xmur3(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRandom(seed, preset, parameters, generatorVersion) {
    const source = [
      String(seed),
      String(generatorVersion || GENERATOR_VERSION),
      String(preset || 'rolling'),
      JSON.stringify(stableObject(parameters || {}))
    ].join('|');
    return mulberry32(xmur3(source)());
  }

  function randomId(randomValues) {
    const bytes = randomValues || new Uint8Array(12);
    if (!randomValues) {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else {
        const fallback = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(fallback() * 256);
      }
    }
    return 'stg_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function emptyColumns() {
    return Array.from({ length: LIMITS.terrainColumns }, () => []);
  }

  function defaultMetadata(options) {
    const now = options && options.now ? new Date(options.now) : new Date();
    const iso = Number.isFinite(now.getTime()) ? now.toISOString() : new Date(0).toISOString();
    return {
      stageId: options && options.stageId ? sanitizeText(options.stageId, 64, randomId()) : randomId(),
      title: sanitizeText(options && options.title, LIMITS.maxTitleLength, '譁ｰ縺励＞繧ｹ繝・・繧ｸ'),
      description: sanitizeText(options && options.description, LIMITS.maxDescriptionLength, ''),
      authorDisplayName: sanitizeText(options && options.authorDisplayName, LIMITS.maxAuthorLength, '菴懈・閠・),
      createdAt: options && options.createdAt ? new Date(options.createdAt).toISOString() : iso,
      updatedAt: options && options.updatedAt ? new Date(options.updatedAt).toISOString() : iso
    };
  }

  function createStageDocument(options) {
    const meta = defaultMetadata(options || {});
    return {
      schemaVersion: SCHEMA_VERSION,
      stageId: meta.stageId,
      title: meta.title,
      description: meta.description,
      authorDisplayName: meta.authorDisplayName,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      generatorVersion: (options && options.generatorVersion) || GENERATOR_VERSION,
      seed: sanitizeText(options && options.seed, 128, 'stage-studio'),
      gameCompatibility: { gameId: GAME_ID, minBuild: GAME_BUILD, maxBuild: null },
      stageWidth: LIMITS.stageWidth,
      stageHeight: LIMITS.stageHeight,
      coordinateSystem: { origin: 'top-left', xAxis: 'right', yAxis: 'down', unit: 'px' },
      terrain: {
        representation: 'column-segments',
        columnWidth: LIMITS.columnWidth,
        rowHeight: LIMITS.rowHeight,
        bottomY: LIMITS.terrainBottomY,
        columns: emptyColumns()
      },
      materials: [{
        id: 'terrain-default', type: 'destructible', label: '遐ｴ螢雁庄閭ｽ蝨ｰ蠖｢',
        colorTop: '#7a5a3a', colorBottom: '#33241a'
      }],
      spawnPoints: [],
      gimmicks: [],
      decorations: { enabled: true, foregroundPreset: 'none', backgroundPreset: 'none' },
      background: {
        type: 'preset', preset: 'grass', color: '#1a2340',
        gradient: ['#1a2340', '#2c3a63', '#4a5a8a'], brightness: 1
      },
      battleRules: {
        allowedModes: ['custom', 'private', 'test'], maxPlayers: LIMITS.maxSpawnPoints,
        turnLimit: 30, destructibleTerrain: true
      },
      preview: { mimeType: null, width: 0, height: 0, embedded: false },
      generation: { preset: 'blank', parameters: {} },
      checksums: { algorithm: 'SHA-256', contentHash: '' }
    };
  }

  function smoothstep(value, edge0, edge1) {
    const x = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function normalizeGenerationParameters(raw) {
    const source = raw || {};
    return {
      elevation: clamp(Number(source.elevation == null ? 0.55 : source.elevation), 0, 1),
      density: clamp(Number(source.density == null ? 0.72 : source.density), 0.1, 1),
      platformCount: clamp(Math.round(Number(source.platformCount == null ? 2 : source.platformCount)), 0, 8),
      valleyDepth: clamp(Number(source.valleyDepth == null ? 0.55 : source.valleyDepth), 0, 1),
      mountainCount: clamp(Math.round(Number(source.mountainCount == null ? 2 : source.mountainCount)), 0, 6),
      symmetric: !!source.symmetric,
      destructibleRate: 1,
      hardTerrainRate: 0,
      cavityRate: clamp(Number(source.cavityRate == null ? 0.15 : source.cavityRate), 0, 0.7),
      smoothness: clamp(Number(source.smoothness == null ? 0.72 : source.smoothness), 0.15, 1),
      players: Number(source.players) >= 4 ? 4 : 2,
      difficulty: clamp(Number(source.difficulty == null ? 0.5 : source.difficulty), 0, 1)
    };
  }

  function terrainFromHeights(heights, bottomY) {
    return heights.map((height) => {
      const top = roundNumber(clamp(height, 84, (bottomY || LIMITS.terrainBottomY) - LIMITS.rowHeight));
      return [[top, bottomY || LIMITS.terrainBottomY]];
    });
  }

  function movingAverage(values, radius) {
    const result = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) {
      let total = 0;
      let count = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
        total += values[j];
        count++;
      }
      result[i] = total / count;
    }
    return result;
  }

  function buildBaseHeights(preset, params, random) {
    const count = LIMITS.terrainColumns;
    const top = 292;
    const bottom = 532;
    const mid = 430;
    const range = 150 * (0.35 + params.elevation * 0.65);
    let heights = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      let y = mid;
      switch (preset) {
        case 'flat': y = 476; break;
        case 'plateauLeft': y = top + (bottom - top) * smoothstep(t, 0.24, 0.76); break;
        case 'plateauRight': y = bottom - (bottom - top) * smoothstep(t, 0.24, 0.76); break;
        case 'mountainCenter': y = bottom - range * Math.sin(Math.PI * t); break;
        case 'valley': y = top + range * (0.55 + params.valleyDepth * 0.45) * Math.sin(Math.PI * t); break;
        case 'grandCanyon': {
          const center = 1 - smoothstep(Math.abs(t - 0.5), 0.12, 0.32);
          y = 330 + center * 230;
          break;
        }
        case 'centerHole': y = 390 + Math.exp(-Math.pow((t - 0.5) / 0.12, 2)) * 160; break;
        case 'crater': y = 350 + Math.exp(-Math.pow((t - 0.5) / 0.25, 2)) * 180; break;
        case 'stairs': y = 320 + Math.floor(t * 6) * 36; break;
        case 'fortress': y = (t < 0.2 || t > 0.8) ? 330 : (t > 0.43 && t < 0.57 ? 370 : 500); break;
        case 'elevation': y = 300 + t * 230 + Math.sin(t * Math.PI * 5) * 28; break;
        case 'asymmetric': y = 420 + Math.sin(t * Math.PI * 2.4) * 78 + (t - 0.5) * 96; break;
        case 'symmetric': y = 455 - Math.cos((t - 0.5) * Math.PI * 4) * 52; break;
        case 'floatingIslands':
        case 'platforms':
        case 'cave':
        case 'rolling':
        default: y = mid + Math.sin(t * Math.PI * 4) * 34; break;
      }
      heights[i] = y;
    }
    const noise = new Float64Array(count);
    let value = random() * 2 - 1;
    for (let i = 0; i < count; i++) {
      value = value * (0.86 + params.smoothness * 0.11) + (random() * 2 - 1) * (0.14 - params.smoothness * 0.09);
      noise[i] = value;
    }
    noise.set(movingAverage(noise, Math.round(2 + params.smoothness * 6)));
    const noiseAmplitude = preset === 'flat' || preset === 'stairs' ? 2 : 10 + params.difficulty * 20;
    for (let i = 0; i < count; i++) heights[i] = clamp(heights[i] + noise[i] * noiseAmplitude, 220, 548);
    if (params.symmetric || preset === 'symmetric') {
      for (let i = 0; i < Math.floor(count / 2); i++) {
        const average = (heights[i] + heights[count - 1 - i]) / 2;
        heights[i] = average;
        heights[count - 1 - i] = average;
      }
    }
    return heights;
  }

  function addFloatingPlatform(columns, centerColumn, width, top, thickness) {
    const from = Math.max(0, Math.round(centerColumn - width / 2));
    const to = Math.min(columns.length - 1, Math.round(centerColumn + width / 2));
    for (let c = from; c <= to; c++) {
      const t = (c - from + 0.5) / Math.max(1, to - from + 1);
      const taper = Math.sin(Math.PI * t);
      if (taper < 0.08) continue;
      const platformTop = top + (1 - taper) * 12;
      const platformBottom = platformTop + Math.max(12, thickness * taper);
      columns[c] = [[roundNumber(platformTop), roundNumber(platformBottom)]].concat(columns[c]);
    }
  }

  function addCavity(columns, centerColumn, width, centerY, height) {
    const from = Math.max(0, Math.round(centerColumn - width / 2));
    const to = Math.min(columns.length - 1, Math.round(centerColumn + width / 2));
    for (let c = from; c <= to; c++) {
      const t = (c - from + 0.5) / Math.max(1, to - from + 1);
      const taper = Math.sin(Math.PI * t);
      if (taper < 0.12) continue;
      const cutTop = centerY - height * taper / 2;
      const cutBottom = centerY + height * taper / 2;
      const next = [];
      for (const segment of columns[c]) {
        if (cutBottom <= segment[0] || cutTop >= segment[1]) next.push(segment);
        else {
          if (cutTop > segment[0] + 8) next.push([segment[0], roundNumber(cutTop)]);
          if (cutBottom < segment[1] - 8) next.push([roundNumber(cutBottom), segment[1]]);
        }
      }
      columns[c] = next;
    }
  }

  function groundYAtColumns(columns, x, referenceY) {
    const column = columns[clamp(Math.floor(x / LIMITS.columnWidth), 0, columns.length - 1)] || [];
    const ref = Number.isFinite(referenceY) ? referenceY : -Infinity;
    for (const segment of column) if (segment[0] >= ref - 1) return segment[0];
    return column.length ? column[0][0] : LIMITS.stageHeight;
  }

  function defaultSpawns(columns, players) {
    const slots = players >= 4 ? ['p1', 'e1', 'p2', 'e2'] : ['p1', 'e1'];
    const ratios = { p1: 0.15, p2: 0.3, e1: 0.85, e2: 0.7 };
    return slots.map((slot, index) => {
      const x = roundNumber(LIMITS.stageWidth * ratios[slot]);
      const ground = groundYAtColumns(columns, x);
      return {
        id: 'spawn-' + slot,
        slot,
        team: slot.charAt(0) === 'p' ? 'player' : 'cpu',
        order: index + 1,
        x,
        y: roundNumber(ground - LIMITS.unitRadius),
        facing: slot.charAt(0) === 'p' ? 'right' : 'left',
        snapToGround: true
      };
    });
  }

  function generateStage(seed, preset, rawParameters, options) {
    const params = normalizeGenerationParameters(rawParameters);
    const requestedPreset = PRESET_KEYS.includes(preset) ? preset : 'rolling';
    const random = createRandom(seed, requestedPreset, params, GENERATOR_VERSION);
    const randomCandidates = PRESET_KEYS.filter((key) => key !== 'random' && key !== 'flat');
    const resolvedPreset = requestedPreset === 'random'
      ? randomCandidates[Math.floor(random() * randomCandidates.length)]
      : requestedPreset;
    const stage = createStageDocument(Object.assign({}, options || {}, {
      seed: String(seed == null ? 'stage-studio' : seed), generatorVersion: GENERATOR_VERSION
    }));
    const heights = buildBaseHeights(resolvedPreset, params, random);
    const columns = terrainFromHeights(heights, LIMITS.terrainBottomY);

    const platformTarget = resolvedPreset === 'floatingIslands' ? Math.max(2, params.platformCount)
      : resolvedPreset === 'platforms' ? Math.max(3, params.platformCount)
        : params.platformCount;
    for (let i = 0; i < platformTarget; i++) {
      if (resolvedPreset !== 'floatingIslands' && resolvedPreset !== 'platforms' && random() > 0.34) continue;
      const center = Math.round(LIMITS.terrainColumns * (0.18 + random() * 0.64));
      const width = 18 + Math.round(random() * 42);
      const baseGround = columns[center][columns[center].length - 1][0];
      addFloatingPlatform(columns, center, width, Math.max(110, baseGround - 100 - random() * 140), 24 + random() * 30);
    }

    const cavityCount = resolvedPreset === 'cave' ? 3 : (random() < params.cavityRate ? 1 : 0);
    for (let i = 0; i < cavityCount; i++) {
      addCavity(columns, LIMITS.terrainColumns * (0.28 + random() * 0.44), 24 + random() * 46, 455 + random() * 80, 45 + random() * 55);
    }

    if (resolvedPreset === 'centerHole') {
      const from = Math.floor(LIMITS.terrainColumns * 0.47);
      const to = Math.ceil(LIMITS.terrainColumns * 0.53);
      for (let c = from; c <= to; c++) columns[c] = [];
    }

    stage.terrain.columns = columns.map((column) => column
      .map((segment) => [roundNumber(segment[0]), roundNumber(segment[1])])
      .sort((a, b) => a[0] - b[0]));
    stage.spawnPoints = defaultSpawns(stage.terrain.columns, params.players);
    stage.generation = { preset: resolvedPreset, requestedPreset, parameters: params };
    stage.title = sanitizeText(options && options.title, LIMITS.maxTitleLength, PRESET_LABELS[resolvedPreset] + '繧ｹ繝・・繧ｸ');
    return stage;
  }

  function gridFromTerrain(terrain) {
    const grid = new Uint8Array(LIMITS.terrainColumns * LIMITS.terrainRows);
    if (!terrain || !Array.isArray(terrain.columns)) return grid;
    for (let c = 0; c < LIMITS.terrainColumns; c++) {
      const segments = terrain.columns[c] || [];
      for (const segment of segments) {
        const from = clamp(Math.floor(segment[0] / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
        const to = clamp(Math.ceil(segment[1] / LIMITS.rowHeight), 0, LIMITS.terrainRows - 1);
        for (let r = from; r <= to; r++) grid[r * LIMITS.terrainColumns + c] = 1;
      }
    }
    return grid;
  }

  function terrainFromGrid(grid) {
    const columns = emptyColumns();
    if (!(grid instanceof Uint8Array) || grid.length !== LIMITS.terrainColumns * LIMITS.terrainRows) return columns;
    for (let c = 0; c < LIMITS.terrainColumns; c++) {
      let start = -1;
      for (let r = 0; r <= LIMITS.terrainRows; r++) {
        const solid = r < LIMITS.terrainRows && grid[r * LIMITS.terrainColumns + c] === 1;
        if (solid && start < 0) start = r;
        if (!solid && start >= 0) {
          columns[c].push([start * LIMITS.rowHeight, Math.min(r * LIMITS.rowHeight, LIMITS.terrainBottomY)]);
          start = -1;
        }
      }
    }
    return columns;
  }

  function gridIsSolid(gri…979 tokens truncated…if (depth > 16) {
      issues.push({ level: 'error', code: 'security.depth', path: where, message: '繝・・繧ｿ縺ｮ蜈･繧悟ｭ舌′豺ｱ縺吶℃縺ｾ縺吶・ });
      return;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      issues.push({ level: 'error', code: 'number.nonFinite', path: where, message: '譛蛾剞縺ｧ縺ｪ縺・焚蛟､縺ｯ菴ｿ縺医∪縺帙ｓ縲・ });
      return;
    }
    if (typeof value === 'string') {
      if (/\b(?:javascript|data|vbscript)\s*:/i.test(value) || /https?:\/\//i.test(value)) {
        issues.push({ level: 'error', code: 'security.externalUrl', path: where, message: '螟夜ΚURL繧・ｮ溯｡悟庄閭ｽURL縺ｯ菴ｿ縺医∪縺帙ｓ縲・ });
      }
      if (/<\/?(?:script|style|iframe|object|embed|html|svg)\b/i.test(value)) {
        issues.push({ level: 'error', code: 'security.markup', path: where, message: 'HTML繝ｻCSS繝ｻ螳溯｡後さ繝ｼ繝峨・菴ｿ縺医∪縺帙ｓ縲・ });
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        issues.push({ level: 'error', code: 'security.prototype', path: where + '.' + key, message: '蜊ｱ髯ｺ縺ｪ繝励Ο繝代ユ繧｣蜷阪ｒ讀懷・縺励∪縺励◆縲・ });
        continue;
      }
      deepSecurityScan(value[key], where + '.' + key, depth + 1, issues);
    }
  }

  function addIssue(list, level, code, path, message) {
    list.push({ level, code, path, message });
  }

  function validateTerrain(stage, issues) {
    const terrain = stage.terrain;
    if (!isPlainObject(terrain) || terrain.representation !== 'column-segments') {
      addIssue(issues, 'error', 'terrain.representation', '$.terrain', '蟇ｾ蠢懊＠縺ｦ縺・↑縺・慍蠖｢蠖｢蠑上〒縺吶・);
      return;
    }
    if (!Array.isArray(terrain.columns) || terrain.columns.length !== LIMITS.terrainColumns) {
      addIssue(issues, 'error', 'terrain.columns', '$.terrain.columns', `蝨ｰ蠖｢縺ｯ${LIMITS.terrainColumns}蛻励〒縺ゅｋ蠢・ｦ√′縺ゅｊ縺ｾ縺吶Ａ);
      return;
    }
    let segmentCount = 0;
    let thinCount = 0;
    for (let c = 0; c < terrain.columns.length; c++) {
      const column = terrain.columns[c];
      if (!Array.isArray(column) || column.length > LIMITS.maxSegmentsPerColumn) {
        addIssue(issues, 'error', 'terrain.columnSegments', `$.terrain.columns[${c}]`, '蛻励・蝨ｰ蠖｢蛹ｺ髢捺焚縺御ｸ企剞繧定ｶ・∴縺ｦ縺・∪縺吶・);
        continue;
      }
      let previousBottom = -1;
      for (let s = 0; s < column.length; s++) {
        const segment = column[s];
        segmentCount++;
        if (!Array.isArray(segment) || segment.length !== 2 || !segment.every(Number.isFinite)) {
          addIssue(issues, 'error', 'terrain.segment', `$.terrain.columns[${c}][${s}]`, '蝨ｰ蠖｢蛹ｺ髢薙′荳肴ｭ｣縺ｧ縺吶・);
          continue;
        }
        const top = segment[0];
        const bottom = segment[1];
        if (top < 0 || bottom > LIMITS.terrainBottomY || top >= bottom || top < previousBottom) {
          addIssue(issues, 'error', 'terrain.segmentRange', `$.terrain.columns[${c}][${s}]`, '蝨ｰ蠖｢蛹ｺ髢薙・蠎ｧ讓吶・荳ｦ縺ｳ鬆・′荳肴ｭ｣縺ｧ縺吶・);
        }
        if (bottom - top < LIMITS.minimumTerrainThickness) thinCount++;
        previousBottom = bottom;
      }
    }
    if (segmentCount === 0) addIssue(issues, 'error', 'terrain.empty', '$.terrain.columns', '蝨ｰ蠖｢縺後≠繧翫∪縺帙ｓ縲・);
    if (thinCount > 0) addIssue(issues, 'warning', 'terrain.thin', '$.terrain.columns', `阮・＞雜ｳ蝣ｴ縺・{thinCount}縺区園縺ゅｊ縺ｾ縺吶Ａ);
    if (segmentCount > LIMITS.terrainColumns * 4) addIssue(issues, 'warning', 'terrain.complex', '$.terrain.columns', '蝨ｰ蠖｢縺瑚､・尅縺ｧ謠冗判雋闕ｷ縺碁ｫ倥￥縺ｪ繧句庄閭ｽ諤ｧ縺後≠繧翫∪縺吶・);
  }

  function validateSpawnPoints(stage, issues) {
    const spawns = stage.spawnPoints;
    if (!Array.isArray(spawns) || spawns.length < LIMITS.minSpawnPoints) {
      addIssue(issues, 'error', 'spawn.insufficient', '$.spawnPoints', '蜃ｺ謦・慍轤ｹ縺ｯ2縺区園莉･荳雁ｿ・ｦ√〒縺吶・);
      return;
    }
    if (spawns.length > LIMITS.maxSpawnPoints) {
      addIssue(issues, 'error', 'spawn.tooMany', '$.spawnPoints', `蜃ｺ謦・慍轤ｹ縺ｯ譛螟ｧ${LIMITS.maxSpawnPoints}縺区園縺ｧ縺吶Ａ);
    }
    const seenIds = new Set();
    const seenSlots = new Set();
    const grid = gridFromTerrain(stage.terrain);
    for (let i = 0; i < spawns.length; i++) {
      const spawn = spawns[i];
      const path = `$.spawnPoints[${i}]`;
      if (!isPlainObject(spawn) || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
        addIssue(issues, 'error', 'spawn.invalid', path, '蜃ｺ謦・慍轤ｹ縺ｮ蠖｢蠑上′荳肴ｭ｣縺ｧ縺吶・);
        continue;
      }
      if (seenIds.has(spawn.id) || seenSlots.has(spawn.slot)) addIssue(issues, 'error', 'spawn.duplicate', path, '蜃ｺ謦・慍轤ｹ縺ｮID縺ｾ縺溘・驟咲ｽｮ譫縺碁㍾隍・＠縺ｦ縺・∪縺吶・);
      seenIds.add(spawn.id);
      seenSlots.add(spawn.slot);
      if (!SLOT_ORDER.includes(spawn.slot) || !['player', 'cpu'].includes(spawn.team)) addIssue(issues, 'error', 'spawn.slot', path, '蜃ｺ謦・慍轤ｹ縺ｮ繝√・繝縺ｾ縺溘・驟咲ｽｮ譫縺御ｸ肴ｭ｣縺ｧ縺吶・);
      if (spawn.x < LIMITS.unitRadius || spawn.x > LIMITS.stageWidth - LIMITS.unitRadius || spawn.y < LIMITS.unitRadius || spawn.y > LIMITS.stageHeight - LIMITS.unitRadius) {
        addIssue(issues, 'error', 'spawn.outside', path, '蜃ｺ謦・慍轤ｹ縺後せ繝・・繧ｸ螟悶〒縺吶・);
      }
      if (gridIsSolid(grid, spawn.x, spawn.y) || gridIsSolid(grid, spawn.x, spawn.y - LIMITS.unitRadius * 0.8)) {
        addIssue(issues, 'error', 'spawn.insideTerrain', path, '蜃ｺ謦・慍轤ｹ縺悟慍蠖｢蜀・Κ縺ｫ蝓九∪縺｣縺ｦ縺・∪縺吶・);
      }
      const ground = groundYAtGrid(grid, spawn.x, spawn.y);
      if (ground >= LIMITS.stageHeight) addIssue(issues, 'error', 'spawn.falling', path, '蜃ｺ謦・峩蠕後↓關ｽ荳九☆繧句慍轤ｹ縺ｧ縺吶・);
      else if (Math.abs((ground - LIMITS.unitRadius) - spawn.y) > 18) addIssue(issues, 'warning', 'spawn.notGrounded', path, '蜃ｺ謦・慍轤ｹ縺悟慍髱｢縺九ｉ髮｢繧後※縺・∪縺吶ゅご繝ｼ繝蜿冶ｾｼ譎ゅ↓蝨ｰ髱｢縺ｸ蜷ｸ逹縺励∪縺吶・);
      const leftGround = groundYAtGrid(grid, Math.max(0, spawn.x - 28), spawn.y);
      const rightGround = groundYAtGrid(grid, Math.min(LIMITS.stageWidth - 1, spawn.x + 28), spawn.y);
      if (Math.max(leftGround, rightGround) >= LIMITS.stageHeight) addIssue(issues, 'warning', 'spawn.nearCliff', path, '蜃ｺ謦・慍轤ｹ縺悟ｴ悶↓霑代☆縺弱∪縺吶・);
      for (let j = 0; j < i; j++) {
        const other = spawns[j];
        const dx = other.x - spawn.x;
        const dy = other.y - spawn.y;
        if (dx * dx + dy * dy < Math.pow(LIMITS.unitRadius * 2.2, 2)) addIssue(issues, 'error', 'spawn.overlap', path, '蜃ｺ謦・慍轤ｹ蜷悟｣ｫ縺碁㍾縺ｪ縺｣縺ｦ縺・∪縺吶・);
      }
    }
    const playerCount = spawns.filter((spawn) => spawn.team === 'player').length;
    const cpuCount = spawns.filter((spawn) => spawn.team === 'cpu').length;
    if (!playerCount || !cpuCount) addIssue(issues, 'error', 'spawn.teams', '$.spawnPoints', '荳｡繝√・繝縺ｮ蜃ｺ謦・慍轤ｹ縺悟ｿ・ｦ√〒縺吶・);
    if (![2, 4].includes(spawns.length)) addIssue(issues, 'warning', 'spawn.format', '$.spawnPoints', '蟇ｾ雎｡繧ｲ繝ｼ繝縺ｮ蟇ｾ謌ｦ莠ｺ謨ｰ縺ｯ2莠ｺ縺ｾ縺溘・4莠ｺ縺ｧ縺吶・);
  }

  function validateGimmicks(stage, issues) {
    if (!Array.isArray(stage.gimmicks)) {
      addIssue(issues, 'error', 'gimmick.array', '$.gimmicks', '繧ｮ繝溘ャ繧ｯ荳隕ｧ縺御ｸ肴ｭ｣縺ｧ縺吶・);
      return;
    }
    if (stage.gimmicks.length > LIMITS.maxGimmicks) addIssue(issues, 'error', 'gimmick.tooMany', '$.gimmicks', '繧ｮ繝溘ャ繧ｯ謨ｰ縺御ｸ企剞繧定ｶ・∴縺ｦ縺・∪縺吶・);
    let windCount = 0;
    stage.gimmicks.forEach((gimmick, index) => {
      const path = `$.gimmicks[${index}]`;
      if (!isPlainObject(gimmick) || !GIMMICK_TYPES.includes(gimmick.type)) {
        addIssue(issues, 'error', 'gimmick.unsupported', path, '譛ｪ蟇ｾ蠢懊・繧ｮ繝溘ャ繧ｯ縺ｧ縺吶・);
        return;
      }
      if (gimmick.type === 'globalWind') {
        windCount++;
        if (!['left', 'right', 'calm'].includes(gimmick.direction) || !Number.isFinite(gimmick.strength) || gimmick.strength < 0 || gimmick.strength > 1) {
          addIssue(issues, 'error', 'gimmick.windRange', path, '鬚ｨ繧ｮ繝溘ャ繧ｯ縺ｮ譁ｹ蜷代∪縺溘・蠑ｷ縺輔′荳肴ｭ｣縺ｧ縺吶・);
        }
      }
    });
    if (windCount > 1) addIssue(issues, 'error', 'gimmick.windDuplicate', '$.gimmicks', '蜈ｨ菴馴｢ｨ縺ｯ1縺､縺縺鷹・鄂ｮ縺ｧ縺阪∪縺吶・);
  }

  function validateFairness(stage, issues) {
    const spawns = Array.isArray(stage.spawnPoints) ? stage.spawnPoints : [];
    const left = spawns.filter((spawn) => spawn.team === 'player');
    const right = spawns.filter((spawn) => spawn.team === 'cpu');
    if (!left.length || !right.length) return;
    const average = (items, key) => items.reduce((sum, item) => sum + item[key], 0) / items.length;
    const heightDiff = Math.abs(average(left, 'y') - average(right, 'y'));
    if (heightDiff > 90) addIssue(issues, 'warning', 'fairness.height', '$.spawnPoints', '繝√・繝髢薙・蟷ｳ蝮・ｫ伜ｺｦ蟾ｮ縺悟､ｧ縺阪＞繧ｹ繝・・繧ｸ縺ｧ縺吶・);
    const center = LIMITS.stageWidth / 2;
    const leftDistances = left.map((spawn) => Math.abs(spawn.x - center));
    const rightDistances = right.map((spawn) => Math.abs(spawn.x - center));
    const distanceDiff = Math.abs(leftDistances.reduce((a, b) => a + b, 0) / leftDistances.length - rightDistances.reduce((a, b) => a + b, 0) / rightDistances.length);
    if (distanceDiff > 150) addIssue(issues, 'warning', 'fairness.distance', '$.spawnPoints', '蜃ｺ謦・慍轤ｹ縺九ｉ荳ｭ螟ｮ縺ｾ縺ｧ縺ｮ霍晞屬蟾ｮ縺悟､ｧ縺阪＞繧ｹ繝・・繧ｸ縺ｧ縺吶・);
    const allSegments = stage.terrain && Array.isArray(stage.terrain.columns)
      ? stage.terrain.columns.reduce((sum, column) => sum + column.length, 0) : 0;
    if (allSegments > 1200) addIssue(issues, 'warning', 'performance.terrain', '$.terrain', '謗ｨ螳壽緒逕ｻ雋闕ｷ縺碁ｫ倥＞蝨ｰ蠖｢縺ｧ縺吶・);
  }

  function validateStage(stage, options) {
    const issues = [];
    if (!isPlainObject(stage)) {
      return { valid: false, errors: [{ level: 'error', code: 'schema.root', path: '$', message: '繧ｹ繝・・繧ｸ繝・・繧ｿ縺後が繝悶ず繧ｧ繧ｯ繝医〒縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲・ }], warnings: [], issues: [] };
    }
    deepSecurityScan(stage, '$', 0, issues);
    if (stage.schemaVersion !== SCHEMA_VERSION) addIssue(issues, 'error', 'schema.version', '$.schemaVersion', '蟇ｾ蠢懷､悶・繧ｹ繧ｭ繝ｼ繝槭ヰ繝ｼ繧ｸ繝ｧ繝ｳ縺ｧ縺吶・);
    if (stage.stageWidth !== LIMITS.stageWidth || stage.stageHeight !== LIMITS.stageHeight) addIssue(issues, 'error', 'stage.size', '$', `繧ｹ繝・・繧ｸ繧ｵ繧､繧ｺ縺ｯ${LIMITS.stageWidth}ﾃ・{LIMITS.stageHeight}縺ｮ縺ｿ蟇ｾ蠢懊＠縺ｦ縺・∪縺吶Ａ);
    if (!/^stg_[a-f0-9]{24}$/i.test(String(stage.stageId || ''))) addIssue(issues, 'error', 'stage.id', '$.stageId', '繧ｹ繝・・繧ｸID縺ｮ蠖｢蠑上′荳肴ｭ｣縺ｧ縺吶・);
    if (typeof stage.title !== 'string' || !stage.title.trim() || stage.title.length > LIMITS.maxTitleLength) addIssue(issues, 'error', 'stage.title', '$.title', '繧ｹ繝・・繧ｸ蜷阪′譛ｪ蜈･蜉帙∪縺溘・髟ｷ縺吶℃縺ｾ縺吶・);
    if (typeof stage.description !== 'string' || stage.description.length > LIMITS.maxDescriptionLength) addIssue(issues, 'error', 'stage.description', '$.description', '隱ｬ譏弱′髟ｷ縺吶℃縺ｾ縺吶・);
    if (typeof stage.authorDisplayName !== 'string' || stage.authorDisplayName.length > LIMITS.maxAuthorLength) addIssue(issues, 'error', 'stage.author', '$.authorDisplayName', '菴懈・閠・｡ｨ遉ｺ蜷阪′髟ｷ縺吶℃縺ｾ縺吶・);
    if (!stage.gameCompatibility || stage.gameCompatibility.gameId !== GAME_ID) addIssue(issues, 'error', 'compatibility.game', '$.gameCompatibility', '蟇ｾ雎｡繧ｲ繝ｼ繝縺ｨ縺ｮ莠呈鋤諠・ｱ縺御ｸ肴ｭ｣縺ｧ縺吶・);
    if (!stage.coordinateSystem || stage.coordinateSystem.origin !== 'top-left' || stage.coordinateSystem.yAxis !== 'down') addIssue(issues, 'error', 'coordinate.system', '$.coordinateSystem', '蟇ｾ蠢懊＠縺ｦ縺・↑縺・ｺｧ讓咏ｳｻ縺ｧ縺吶・);
    if (!Array.isArray(stage.materials) || stage.materials.some((material) => !material || !MATERIAL_TYPES.includes(material.type))) addIssue(issues, 'error', 'material.unsupported', '$.materials', '譛ｪ蟇ｾ蠢懊・蝨ｰ蠖｢邏譚舌′蜷ｫ縺ｾ繧後※縺・∪縺吶・);
    if (!stage.background || stage.background.type !== 'preset' || !BACKGROUND_PRESETS.includes(stage.background.preset)) addIssue(issues, 'error', 'background.unsupported', '$.background', '譛ｪ蟇ｾ蠢懊∪縺溘・荳肴ｭ｣縺ｪ閭梧勹縺ｧ縺吶・);
    validateTerrain(stage, issues);
    validateSpawnPoints(stage, issues);
    validateGimmicks(stage, issues);
    validateFairness(stage, issues);
    const byteLength = utf8Bytes(JSON.stringify(stage)).length;
    if (byteLength > LIMITS.maxJsonBytes) addIssue(issues, 'error', 'file.tooLarge', '$', '繧ｹ繝・・繧ｸ繝輔ぃ繧､繝ｫ縺ｮ螳ｹ驥丈ｸ企剞繧定ｶ・∴縺ｦ縺・∪縺吶・);
    if (options && Number.isFinite(options.fileSize) && options.fileSize > LIMITS.maxJsonBytes) addIssue(issues, 'error', 'file.inputTooLarge', '$', '隱ｭ縺ｿ霎ｼ繧薙□繝輔ぃ繧､繝ｫ縺悟､ｧ縺阪☆縺弱∪縺吶・);
    const errors = issues.filter((issue) => issue.level === 'error');
    const warnings = issues.filter((issue) => issue.level === 'warning');
    return { valid: errors.length === 0, errors, warnings, issues, byteLength };
  }

  function normalizeTerrainColumns(columns) {
    return columns.map((column) => column
      .map((segment) => [roundNumber(segment[0]), roundNumber(segment[1])])
      .sort((a, b) => a[0] - b[0]));
  }

  function normalizeStage(stage) {
    const next = clone(stage);
    next.title = sanitizeText(next.title, LIMITS.maxTitleLength, '繧ｹ繝・・繧ｸ');
    next.description = sanitizeText(next.description, LIMITS.maxDescriptionLength, '');
    next.authorDisplayName = sanitizeText(next.authorDisplayName, LIMITS.maxAuthorLength, '菴懈・閠・);
    next.stageWidth = LIMITS.stageWidth;
    next.stageHeight = LIMITS.stageHeight;
    next.terrain.columnWidth = LIMITS.columnWidth;
    next.terrain.rowHeight = LIMITS.rowHeight;
    next.terrain.bottomY = LIMITS.terrainBottomY;
    next.terrain.columns = normalizeTerrainColumns(next.terrain.columns);
    next.spawnPoints = next.spawnPoints.map((spawn) => Object.assign({}, spawn, {
      x: roundNumber(spawn.x), y: roundNumber(spawn.y), order: Math.round(spawn.order || 0)
    })).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    next.gimmicks = next.gimmicks.map((gimmick) => Object.assign({}, gimmick, {
      strength: gimmick.type === 'globalWind' ? roundNumber(gimmick.strength) : gimmick.strength
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    next.updatedAt = new Date(next.updatedAt || Date.now()).toISOString();
    next.checksums = { algorithm: 'SHA-256', contentHash: '' };
    return next;
  }

  async function finalizeStage(stage) {
    const next = normalizeStage(stage);
    const validation = validateStage(next);
    if (!validation.valid) {
      const error = new Error(validation.errors[0].message);
      error.validation = validation;
      throw error;
    }
    next.checksums.contentHash = await contentHash(next);
    return next;
  }

  async function verifyStageHash(stage) {
    if (!stage || !stage.checksums || !/^[a-f0-9]{64}$/i.test(stage.checksums.contentHash || '')) return false;
    return (await contentHash(stage)) === stage.checksums.contentHash.toLowerCase();
  }

  function safeFileName(value) {
    const base = sanitizeText(value, LIMITS.maxTitleLength, 'stage')
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\.\.+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.\- ]+|[.\- ]+$/g, '')
      .slice(0, 48);
    return (base || 'stage').toLowerCase();
  }

  function getGlobalWind(stage) {
    const gimmick = stage && Array.isArray(stage.gimmicks)
      ? stage.gimmicks.find((item) => item && item.type === 'globalWind' && item.enabled !== false)
      : null;
    if (!gimmick || gimmick.direction === 'calm') return gimmick ? { dir: 1, strength: 0 } : null;
    return { dir: gimmick.direction === 'left' ? -1 : 1, strength: clamp(Number(gimmick.strength) || 0, 0, 1) };
  }

  function toGameAdapter(stage) {
    const validation = validateStage(stage);
    if (!validation.valid) {
      const error = new Error(validation.errors[0].message);
      error.validation = validation;
      throw error;
    }
    return {
      id: stage.stageId,
      title: stage.title,
      schemaVersion: stage.schemaVersion,
      contentHash: stage.checksums && stage.checksums.contentHash || '',
      compatibility: clone(stage.gameCompatibility),
      pattern: 'custom',
      themeKey: stage.background.preset,
      segments: normalizeTerrainColumns(stage.terrain.columns),
      spawnPoints: stage.spawnPoints.map((spawn) => Object.assign({}, spawn)),
      wind: getGlobalWind(stage),
      gimmicks: stage.gimmicks.map((gimmick) => Object.assign({}, gimmick))
    };
  }

  function migrateStage(stage) {
    if (!isPlainObject(stage)) return null;
    if (stage.schemaVersion === SCHEMA_VERSION) return clone(stage);
    if (stage.schemaVersion === '0.9.0' && stage.terrain && Array.isArray(stage.terrain.columns)) {
      const next = clone(stage);
      next.schemaVersion = SCHEMA_VERSION;
      if (!next.preview) next.preview = { mimeType: null, width: 0, height: 0, embedded: false };
      if (!next.decorations) next.decorations = { enabled: true, foregroundPreset: 'none', backgroundPreset: 'none' };
      if (!next.checksums) next.checksums = { algorithm: 'SHA-256', contentHash: '' };
      return next;
    }
    return null;
  }

  return Object.freeze({
    SCHEMA_VERSION,
    GENERATOR_VERSION,
    GAME_ID,
    GAME_BUILD,
    LIMITS,
    PHYSICS,
    PRESET_KEYS,
    PRESET_LABELS,
    BACKGROUND_PRESETS,
    MATERIAL_TYPES,
    GIMMICK_TYPES,
    SLOT_ORDER,
    clamp,
    clone,
    canonicalStringify,
    sha256Hex,
    contentHash,
    createRandom,
    randomId,
    createStageDocument,
    generateStage,
    normalizeGenerationParameters,
    gridFromTerrain,
    terrainFromGrid,
    gridIsSolid,
    groundYAtGrid,
    paintGridCircle,
    computeLaunchVelocity,
    stepProjectile,
    traceProjectile,
    validateStage,
    normalizeStage,
    finalizeStage,
    verifyStageHash,
    safeFileName,
    getGlobalWind,
    toGameAdapter,
    migrateStage
  });
});

