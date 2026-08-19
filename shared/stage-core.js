(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = '1.0.0';
  var GENERATOR_VERSION = '1.0.0';
  var GAME_ID = 'katamon';
  var GAME_BUILD = 'v138';
  var STANDARD_LIMITS = Object.freeze({
    stageWidth: 1440,
    stageHeight: 660,
    terrainBottom: 636,
    columnWidth: 3,
    rowHeight: 4,
    columns: 480,
    rows: 165,
    maxSpawns: 4,
    maxGimmicks: 16,
    maxSegments: 4096,
    maxFileBytes: 2 * 1024 * 1024,
    maxTitleLength: 48,
    maxDescriptionLength: 500,
    maxAuthorLength: 32,
    maxSeedLength: 96,
    maxJsonDepth: 14,
    maxObjectNodes: 60000,
    unitRadius: 16,
    minimumTerrainThickness: 12
  });
  var LARGE_LIMITS = Object.freeze({
    stageWidth: 2160,
    stageHeight: 960,
    terrainBottom: 924,
    columnWidth: 3,
    rowHeight: 4,
    columns: 720,
    rows: 240,
    maxSpawns: 4,
    maxGimmicks: 16,
    maxSegments: 6144,
    maxFileBytes: 2 * 1024 * 1024,
    maxTitleLength: 48,
    maxDescriptionLength: 500,
    maxAuthorLength: 32,
    maxSeedLength: 96,
    maxJsonDepth: 14,
    maxObjectNodes: 90000,
    unitRadius: 16,
    minimumTerrainThickness: 12
  });
  var STAGE_SIZES = Object.freeze({ standard: STANDARD_LIMITS, large: LARGE_LIMITS });
  // 内部の地形処理はこの値を読む。公開する LIMITS は従来互換の標準サイズのままにする。
  var LIMITS = STANDARD_LIMITS;
  function stageSizeKey(input) {
    if (input && (input.size === 'large' || input.stageSize === 'large'
      || (Number(input.stageWidth) === LARGE_LIMITS.stageWidth && Number(input.stageHeight) === LARGE_LIMITS.stageHeight))) return 'large';
    return 'standard';
  }
  function getStageLimits(input) { return STAGE_SIZES[stageSizeKey(input)]; }
  function activateStageLimits(input) { LIMITS = getStageLimits(input); return LIMITS; }
  var PHYSICS = Object.freeze({
    gravity: 650,
    windAccelMax: 260,
    velocityScale: 7.8,
    fixedDt: 1 / 120,
    defaultExplosionRadius: 44,
    deadLineY: STANDARD_LIMITS.terrainBottom,
    fallTrigger: 22
  });
  var PRESET_DEFINITIONS = [
    ['blank', '白紙'],
    ['flat', '平原'],
    ['rolling', '丘陵'],
    ['plateauLeft', '左高台'],
    ['plateauRight', '右高台'],
    ['mountainCenter', '中央山'],
    ['valley', '渓谷'],
    ['grandCanyon', '大峡谷'],
    ['centerHole', '中央穴'],
    ['crater', 'クレーター'],
    ['stairs', '階段'],
    ['symmetric', '左右対称'],
    ['asymmetric', '左右非対称'],
    ['fortress', '要塞'],
    ['floatingIslands', '浮島'],
    ['platforms', '複数足場'],
    ['cave', '洞窟'],
    ['elevation', '高低差重視'],
    ['random', 'ランダム']
  ];
  var PRESETS = Object.freeze(PRESET_DEFINITIONS.map(function (entry) {
    return Object.freeze({ key: entry[0], name: entry[1] });
  }));
  var PRESET_KEYS = PRESETS.map(function (preset) { return preset.key; });
  var THEME_KEYS = ['grass', 'desert', 'snow', 'volcanic'];
  var MATERIAL_CATALOG = Object.freeze({
    terrain: Object.freeze({
      id: 'terrain',
      label: '通常地形',
      type: 'destructible',
      destructible: true,
      enabled: true,
      exportable: true,
      requiresGameFeature: null
    }),
    steel: Object.freeze({
      id: 'steel',
      label: '壊れない鋼鉄',
      type: 'indestructible',
      destructible: false,
      enabled: true,
      exportable: true,
      requiresGameFeature: null
    })
  });
  var SLOT_ORDER = ['p1', 'e1', 'p2', 'e2'];
  var TOP_LEVEL_KEYS = [
    'schemaVersion', 'stageId', 'title', 'description', 'authorDisplayName',
    'createdAt', 'updatedAt', 'generatorVersion', 'seed', 'generation',
    'gameCompatibility', 'stageWidth', 'stageHeight', 'coordinateSystem',
    'terrain', 'materials', 'spawnPoints', 'gimmicks', 'decorations',
    'background', 'battleRules', 'preview', 'checksums'
  ];

  var schemaDocument = {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$id': 'https://example.invalid/schemas/stage.schema.json',
    title: 'Stage Studio stage',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion', 'stageId', 'title', 'description', 'authorDisplayName',
      'createdAt', 'updatedAt', 'generatorVersion', 'seed', 'gameCompatibility',
      'stageWidth', 'stageHeight', 'coordinateSystem', 'terrain', 'materials',
      'spawnPoints', 'gimmicks', 'decorations', 'background', 'battleRules',
      'preview', 'checksums'
    ],
    properties: {
      schemaVersion: { const: SCHEMA_VERSION },
      stageId: { type: 'string', pattern: '^stage_[a-z0-9_-]{8,80}$' },
      title: { type: 'string', minLength: 1, maxLength: LIMITS.maxTitleLength },
      description: { type: 'string', maxLength: LIMITS.maxDescriptionLength },
      authorDisplayName: { type: 'string', maxLength: LIMITS.maxAuthorLength },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      generatorVersion: { type: 'string', maxLength: 24 },
      seed: { type: 'string', maxLength: LIMITS.maxSeedLength },
      generation: { type: 'object', additionalProperties: true },
      gameCompatibility: {
        type: 'object',
        additionalProperties: false,
        required: ['gameId', 'minBuild', 'maxBuild'],
        properties: {
          gameId: { const: GAME_ID },
          minBuild: { type: 'string', pattern: '^v[0-9]{1,9}$', maxLength: 40 },
          maxBuild: { type: ['string', 'null'], pattern: '^v[0-9]{1,9}$', maxLength: 40 }
        }
      },
      stageWidth: { enum: [STANDARD_LIMITS.stageWidth, LARGE_LIMITS.stageWidth] },
      stageHeight: { enum: [STANDARD_LIMITS.stageHeight, LARGE_LIMITS.stageHeight] },
      coordinateSystem: {
        type: 'object',
        additionalProperties: false,
        required: ['origin', 'unit', 'xAxis', 'yAxis', 'terrainColumnWidth', 'terrainRowHeight'],
        properties: {
          origin: { const: 'top-left' },
          unit: { const: 'px' },
          xAxis: { const: 'right' },
          yAxis: { const: 'down' },
          terrainColumnWidth: { const: LIMITS.columnWidth },
          terrainRowHeight: { const: LIMITS.rowHeight }
        }
      },
      terrain: {
        type: 'object',
        additionalProperties: false,
        required: ['encoding', 'columns', 'destructible', 'minimumThickness'],
        properties: {
          encoding: { const: 'column-segments-v1' },
          columns: {
            type: 'array',
            minItems: STANDARD_LIMITS.columns,
            maxItems: LARGE_LIMITS.columns,
            items: {
              type: 'array',
              maxItems: 32,
              items: {
                type: 'array',
                prefixItems: [
                  { type: 'number', minimum: 0, maximum: LARGE_LIMITS.terrainBottom },
                  { type: 'number', minimum: 0, maximum: LARGE_LIMITS.terrainBottom }
                ],
                minItems: 2,
                maxItems: 2
              }
            }
          },
          materialSegments: {
            type: 'array', minItems: STANDARD_LIMITS.columns, maxItems: LARGE_LIMITS.columns,
            items: { type: 'array', maxItems: 32, items: { type: 'array', prefixItems: [
              { type: 'number', minimum: 0, maximum: LARGE_LIMITS.terrainBottom },
              { type: 'number', minimum: 0, maximum: LARGE_LIMITS.terrainBottom },
              { enum: ['terrain', 'steel'] }
            ], minItems: 3, maxItems: 3 } }
          },
          destructible: { const: true },
          minimumThickness: { type: 'number', minimum: 4, maximum: 64 }
        }
      },
      materials: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'type', 'destructible'],
              properties: {
                id: { const: 'terrain' },
                type: { const: 'destructible' },
                destructible: { const: true },
                color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }
              }
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'type', 'destructible'],
              properties: {
                id: { const: 'steel' },
                type: { const: 'indestructible' },
                destructible: { const: false },
                color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }
              }
            }
          ]
        }
      },
      spawnPoints: {
        type: 'array',
        minItems: 2,
        maxItems: LIMITS.maxSpawns,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'slot', 'team', 'order', 'x', 'y', 'direction'],
          properties: {
            id: { type: 'string', pattern: '^spawn_[a-z0-9_-]{1,40}$' },
            slot: { enum: SLOT_ORDER },
            team: { enum: ['player', 'enemy'] },
            order: { type: 'integer', minimum: 1, maximum: 4 },
            x: { type: 'number', minimum: 0, maximum: LARGE_LIMITS.stageWidth },
            y: { type: 'number', minimum: -64, maximum: LARGE_LIMITS.stageHeight },
            direction: { enum: ['left', 'right'] }
          }
        }
      },
      gimmicks: {
        type: 'array',
        maxItems: LIMITS.maxGimmicks,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'direction', 'strength'],
          properties: {
            id: { type: 'string', pattern: '^gimmick_[a-z0-9_-]{1,40}$' },
            type: { const: 'globalWind' },
            direction: { enum: [-1, 1] },
            strength: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      },
      decorations: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled', 'foreground', 'background'],
        properties: {
          enabled: { type: 'boolean' },
          foreground: { type: 'array', maxItems: 32 },
          background: { type: 'array', maxItems: 32 }
        }
      },
      background: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'theme', 'color', 'gradient'],
        properties: {
          mode: { enum: ['theme', 'color', 'gradient'] },
          theme: { enum: THEME_KEYS },
          color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          gradient: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to'],
            properties: {
              from: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
              to: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }
            }
          }
        }
      },
      battleRules: {
        type: 'object',
        additionalProperties: false,
        required: ['format', 'maxPlayers', 'rankedAllowed', 'onlineAllowed'],
        properties: {
          format: { enum: ['1v1', '2v2'] },
          maxPlayers: { type: 'integer', minimum: 2, maximum: LIMITS.maxSpawns },
          turnLimit: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
          rankedAllowed: { const: false },
          onlineAllowed: { const: false }
        }
      },
      preview: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height', 'mimeType', 'data'],
        properties: {
          width: { const: 0 },
          height: { const: 0 },
          mimeType: { const: null },
          data: { const: null }
        }
      },
      checksums: {
        type: 'object',
        additionalProperties: false,
        required: ['algorithm', 'contentHash'],
        properties: {
          algorithm: { const: 'SHA-256' },
          contentHash: { type: 'string', pattern: '^$|^[a-f0-9]{64}$' }
        }
      }
    }
  };

  function schemaTypeMatches(value, expectedType) {
    if (expectedType === 'null') return value === null;
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (expectedType === 'integer') return Number.isInteger(value);
    if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === expectedType;
  }

  /*
   * Small, dependency-free JSON Schema 2020-12 subset used by stage.schema.json.
   * Keeping this beside schemaDocument makes browser imports enforce the same
   * declaration as tooling without shipping eval-based or dynamic code.
   */
  function validateSchemaValue(value, schema, path, errors, budget) {
    if (!schema || errors.length >= budget.maxErrors || budget.nodes >= budget.maxNodes) return;
    budget.nodes += 1;
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
      errors.push(issue('schema_const', path, '許可されていない値です。'));
      return;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some(function (allowed) { return allowed === value; })) {
      errors.push(issue('schema_enum', path, '許可されていない値です。'));
      return;
    }
    if (schema.type) {
      var types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some(function (type) { return schemaTypeMatches(value, type); })) {
        errors.push(issue('schema_type', path, 'データ型がステージ仕様と一致しません。'));
        return;
      }
    }
    if (value === null) return;
    if (typeof value === 'string') {
      if (schema.minLength != null && value.length < schema.minLength) errors.push(issue('schema_min_length', path, '文字数が不足しています。'));
      if (schema.maxLength != null && value.length > schema.maxLength) errors.push(issue('schema_max_length', path, '文字数が上限を超えています。'));
      if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.push(issue('schema_pattern', path, '文字列の形式が不正です。'));
      if (schema.format === 'date-time') {
        var time = Date.parse(value);
        if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) errors.push(issue('schema_date_time', path, '日時はUTCのISO 8601形式で指定してください。'));
      }
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(issue('schema_finite', path, '有限でない数値は使用できません。'));
      if (schema.minimum != null && value < schema.minimum) errors.push(issue('schema_minimum', path, '数値が下限を下回っています。'));
      if (schema.maximum != null && value > schema.maximum) errors.push(issue('schema_maximum', path, '数値が上限を超えています。'));
      return;
    }
    if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) errors.push(issue('schema_min_items', path, '項目数が不足しています。'));
      if (schema.maxItems != null && value.length > schema.maxItems) errors.push(issue('schema_max_items', path, '項目数が上限を超えています。'));
      var inspectLength = Math.min(value.length, schema.maxItems != null ? Math.max(schema.maxItems, 1) : value.length, budget.maxNodes - budget.nodes);
      for (var itemIndex = 0; itemIndex < inspectLength && errors.length < budget.maxErrors; itemIndex += 1) {
        var itemSchema = Array.isArray(schema.prefixItems) && itemIndex < schema.prefixItems.length ? schema.prefixItems[itemIndex] : schema.items;
        if (itemSchema && itemSchema !== true) validateSchemaValue(value[itemIndex], itemSchema, path + '[' + itemIndex + ']', errors, budget);
      }
      return;
    }
    if (value && typeof value === 'object') {
      var properties = schema.properties || {};
      (schema.required || []).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(value, key) && errors.length < budget.maxErrors) errors.push(issue('schema_required', path + '.' + key, '必須項目がありません。'));
      });
      var keys = Object.keys(value);
      for (var keyIndex = 0; keyIndex < keys.length && errors.length < budget.maxErrors; keyIndex += 1) {
        var key = keys[keyIndex];
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          validateSchemaValue(value[key], properties[key], path + '.' + key, errors, budget);
        } else if (schema.additionalProperties === false) {
          errors.push(issue('schema_additional_property', path + '.' + key, '未対応の項目が含まれています。'));
        } else if (schema.additionalProperties && schema.additionalProperties !== true) {
          validateSchemaValue(value[key], schema.additionalProperties, path + '.' + key, errors, budget);
        }
      }
    }
  }

  function validateAgainstStageSchema(input) {
    var errors = [];
    validateSchemaValue(input, schemaDocument, '$', errors, { nodes: 0, maxNodes: LIMITS.maxObjectNodes, maxErrors: 100 });
    return errors;
  }

  function clamp(value, min, max) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
  }

  function roundNumber(value, digits) {
    var power = Math.pow(10, digits == null ? 3 : digits);
    return Math.round(Number(value) * power) / power;
  }

  function safeText(value, maxLength, fallback) {
    var text = value == null ? '' : String(value);
    text = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text && fallback != null) text = fallback;
    return text.slice(0, maxLength);
  }

  function safeColor(value, fallback) {
    var text = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
  }

  function safeDate(value, fallback) {
    var date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }

  function buildNumber(value) {
    var match = typeof value === 'string' ? /^v([0-9]{1,9})$/.exec(value) : null;
    if (!match) return null;
    var number = Number(match[1]);
    return Number.isSafeInteger(number) ? number : null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStageId() {
    var token = '';
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      token = crypto.randomUUID().replace(/-/g, '');
    } else {
      token = Date.now().toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
    }
    return 'stage_' + token.toLowerCase().slice(0, 48);
  }

  function blankColumns() {
    return Array.from({ length: LIMITS.columns }, function () { return []; });
  }

  function presetName(key) {
    var found = PRESETS.find(function (preset) { return preset.key === key; });
    return found ? found.name : 'ランダム';
  }

  function createStageDocument(options) {
    options = options || {};
    activateStageLimits(options);
    var now = new Date().toISOString();
    var format = options.format === '2v2' ? '2v2' : '1v1';
    return {
      schemaVersion: SCHEMA_VERSION,
      stageId: /^stage_[a-z0-9_-]{8,80}$/.test(String(options.stageId || '')) ? String(options.stageId) : createStageId(),
      title: safeText(options.title, LIMITS.maxTitleLength, 'サンプルステージ'),
      description: safeText(options.description, LIMITS.maxDescriptionLength, ''),
      authorDisplayName: safeText(options.authorDisplayName, LIMITS.maxAuthorLength, '作成者'),
      createdAt: safeDate(options.createdAt, now),
      updatedAt: safeDate(options.updatedAt, now),
      generatorVersion: safeText(options.generatorVersion, 24, GENERATOR_VERSION),
      seed: safeText(options.seed, LIMITS.maxSeedLength, 'stage-studio'),
      generation: {
        preset: PRESET_KEYS.indexOf(options.preset) >= 0 ? options.preset : 'blank',
        parameters: {}
      },
      gameCompatibility: { gameId: GAME_ID, minBuild: GAME_BUILD, maxBuild: null },
      stageWidth: LIMITS.stageWidth,
      stageHeight: LIMITS.stageHeight,
      coordinateSystem: {
        origin: 'top-left',
        unit: 'px',
        xAxis: 'right',
        yAxis: 'down',
        terrainColumnWidth: LIMITS.columnWidth,
        terrainRowHeight: LIMITS.rowHeight
      },
      terrain: {
        encoding: 'column-segments-v1',
        columns: blankColumns(),
        destructible: true,
        minimumThickness: LIMITS.minimumTerrainThickness
      },
      materials: [{ id: 'terrain', type: 'destructible', destructible: true, color: '#7A5435' }],
      spawnPoints: [],
      gimmicks: [],
      decorations: { enabled: true, foreground: [], background: [] },
      background: {
        mode: 'theme',
        theme: THEME_KEYS.indexOf(options.theme) >= 0 ? options.theme : 'grass',
        color: '#87B9D8',
        gradient: { from: '#6DA9D2', to: '#D7E8E8' }
      },
      battleRules: {
        format: format,
        maxPlayers: format === '2v2' ? 4 : 2,
        turnLimit: null,
        rankedAllowed: false,
        onlineAllowed: false
      },
      preview: { width: 0, height: 0, mimeType: null, data: null },
      checksums: { algorithm: 'SHA-256', contentHash: '' }
    };
  }

  function seedToUint32(text) {
    var hash = 2166136261 >>> 0;
    text = String(text);
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      var value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function smooth(values, passes) {
    var result = values.slice();
    for (var pass = 0; pass < passes; pass += 1) {
      var next = result.slice();
      for (var index = 1; index < result.length - 1; index += 1) {
        next[index] = (result[index - 1] + result[index] * 2 + result[index + 1]) / 4;
      }
      result = next;
    }
    return result;
  }

  function nearestGroundTop(columns, columnIndex) {
    columnIndex = Math.max(0, Math.min(columns.length - 1, columnIndex));
    function walkableTop(segments) {
      var previousBottom = 0;
      for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        var top = segments[segmentIndex][0];
        if (top >= LIMITS.unitRadius && top - previousBottom >= LIMITS.unitRadius * 2) return top;
        previousBottom = Math.max(previousBottom, segments[segmentIndex][1]);
      }
      return segments.length ? segments[segments.length - 1][0] : null;
    }
    for (var radius = 0; radius < columns.length; radius += 1) {
      var left = columnIndex - radius;
      var right = columnIndex + radius;
      if (left >= 0 && columns[left] && columns[left].length) return walkableTop(columns[left]);
      if (right < columns.length && columns[right] && columns[right].length) return walkableTop(columns[right]);
    }
    return LIMITS.terrainBottom;
  }

  function makeSpawns(columns, format) {
    var ratios = format === '2v2'
      ? { p1: 0.15, p2: 0.30, e1: 0.85, e2: 0.70 }
      : { p1: 0.18, e1: 0.82 };
    var slots = format === '2v2' ? SLOT_ORDER : ['p1', 'e1'];
    return slots.map(function (slot, index) {
      var x = roundNumber(LIMITS.stageWidth * ratios[slot], 3);
      var column = Math.floor(x / LIMITS.columnWidth);
      var ground = nearestGroundTop(columns, column);
      return {
        id: 'spawn_' + slot,
        slot: slot,
        team: slot.charAt(0) === 'p' ? 'player' : 'enemy',
        order: index + 1,
        x: x,
        y: roundNumber(ground - LIMITS.unitRadius, 3),
        direction: slot.charAt(0) === 'p' ? 'right' : 'left'
      };
    });
  }

  function normalizeGenerationParameters(input) {
    input = input || {};
    return {
      elevation: roundNumber(clamp(input.elevation == null ? 0.55 : input.elevation, 0, 1), 3),
      density: roundNumber(clamp(input.density == null ? 0.75 : input.density, 0.2, 1), 3),
      platformCount: Math.round(clamp(input.platformCount == null ? 4 : input.platformCount, 0, 12)),
      valleyDepth: roundNumber(clamp(input.valleyDepth == null ? 0.55 : input.valleyDepth, 0, 1), 3),
      mountainCount: Math.round(clamp(input.mountainCount == null ? 2 : input.mountainCount, 0, 8)),
      symmetric: Boolean(input.symmetric),
      destructibleRate: 1,
      hardTerrainRate: 0,
      cavityRate: roundNumber(clamp(input.cavityRate == null ? 0.08 : input.cavityRate, 0, 0.35), 3),
      smoothness: roundNumber(clamp(input.smoothness == null ? 0.65 : input.smoothness, 0, 1), 3),
      playerCount: input.playerCount === 4 ? 4 : 2,
      difficulty: roundNumber(clamp(input.difficulty == null ? 0.5 : input.difficulty, 0, 1), 3),
      steelMode: ['none', 'partial', 'whole'].indexOf(input.steelMode) >= 0 ? input.steelMode : 'none'
    };
  }

  function generateStage(options) {
    options = options || {};
    activateStageLimits(options);
    var requestedPreset = PRESET_KEYS.indexOf(options.preset) >= 0 ? options.preset : 'rolling';
    var preset = requestedPreset;
    var parameters = normalizeGenerationParameters(options.generationParameters || options.parameters);
    var randomPresetPool = ['flat', 'rolling', 'plateauLeft', 'plateauRight', 'mountainCenter', 'valley', 'crater', 'stairs', 'symmetric', 'asymmetric', 'elevation'];
    var seedMaterial = safeText(options.seed, LIMITS.maxSeedLength, 'stage-studio') + '|' + GENERATOR_VERSION + '|' + requestedPreset + '|' + canonicalStringify(parameters);
    var random = mulberry32(seedToUint32(seedMaterial));
    if (preset === 'random') preset = randomPresetPool[Math.floor(random() * randomPresetPool.length)];
    var format = parameters.playerCount === 4 || options.format === '2v2' ? '2v2' : '1v1';
    var stage = createStageDocument({
      title: options.title || presetName(preset) + 'ステージ',
      description: options.description || '',
      authorDisplayName: options.authorDisplayName || '作成者',
      seed: options.seed || 'stage-studio',
      preset: requestedPreset,
      format: format,
      theme: options.theme,
      size: stageSizeKey(options)
    });
    // randomは選ばれた形ではなく、利用者が指定したrandom自体を保存する。
    // これで保存済みseed + generatorVersion + preset + parametersから同じ乱数列を再現できる。
    stage.generation = { preset: requestedPreset, parameters: parameters };

    if (preset === 'blank') {
      stage.spawnPoints = [];
      return stage;
    }

    var surfaces = [];
    var amplitude = (30 + parameters.elevation * 105) * (0.85 + parameters.difficulty * 0.3);
    var base = 500 + (1 - parameters.density) * 70;
    var mountainControlsEnabled = ['rolling', 'mountainCenter', 'symmetric', 'asymmetric', 'elevation'].indexOf(preset) >= 0;
    for (var column = 0; column < LIMITS.columns; column += 1) {
      var t = column / (LIMITS.columns - 1);
      var centered = t * 2 - 1;
      var noise = (random() - 0.5) * (1 - parameters.smoothness) * 46 * (0.75 + parameters.difficulty * 0.5);
      var y = base;
      if (preset === 'flat') y += Math.sin(t * Math.PI * 2) * 4;
      else if (preset === 'rolling') y += Math.sin(t * Math.PI * 3.4) * amplitude * 0.35 + Math.sin(t * Math.PI * 8.2) * 14;
      else if (preset === 'plateauLeft') y += t * amplitude - amplitude * 0.5;
      else if (preset === 'plateauRight') y += (1 - t) * amplitude - amplitude * 0.5;
      else if (preset === 'mountainCenter') y -= Math.exp(-centered * centered * 8) * amplitude;
      else if (preset === 'valley') y += Math.exp(-centered * centered * 9) * (55 + parameters.valleyDepth * 100) - 25;
      else if (preset === 'grandCanyon') y += Math.exp(-centered * centered * 16) * 155 - 30;
      else if (preset === 'centerHole') y += Math.exp(-centered * centered * 22) * 190 - 22;
      else if (preset === 'crater') y += Math.exp(-centered * centered * 11) * 100 - Math.exp(-Math.pow(Math.abs(centered) - 0.42, 2) * 65) * 42;
      else if (preset === 'stairs') y += (Math.floor(t * 8) - 3.5) * amplitude * 0.12;
      else if (preset === 'fortress') y += (t < 0.22 || t > 0.78 ? -78 : 24) + Math.sin(t * Math.PI * 5) * 10;
      else if (preset === 'floatingIslands') y += Math.sin(t * Math.PI * 2.5) * 32 + 45;
      else if (preset === 'platforms') y += Math.sin(t * Math.PI * 4) * 26 + 35;
      else if (preset === 'cave') y += Math.sin(t * Math.PI * 3) * 25 + 30;
      else if (preset === 'elevation') y += centered * amplitude * 0.75 + Math.sin(t * Math.PI * 4) * 25;
      else y += Math.sin(t * Math.PI * 3.2) * amplitude * 0.38 + Math.sin(t * Math.PI * 9) * 13;
      if (mountainControlsEnabled && parameters.mountainCount > 0) {
        for (var mountain = 0; mountain < parameters.mountainCount; mountain += 1) {
          var mountainCenter = (mountain + 1) / (parameters.mountainCount + 1);
          var mountainDistance = (t - mountainCenter) * (5.2 + parameters.mountainCount * 0.35);
          y -= Math.exp(-mountainDistance * mountainDistance)
            * amplitude * (0.08 + parameters.difficulty * 0.08);
        }
      }
      surfaces.push(clamp(y + noise, 310, LIMITS.terrainBottom - 28));
    }

    if (preset === 'symmetric' || parameters.symmetric) {
      for (var mirrorIndex = 0; mirrorIndex < Math.floor(LIMITS.columns / 2); mirrorIndex += 1) {
        var averaged = (surfaces[mirrorIndex] + surfaces[LIMITS.columns - 1 - mirrorIndex]) / 2;
        surfaces[mirrorIndex] = averaged;
        surfaces[LIMITS.columns - 1 - mirrorIndex] = averaged;
      }
    } else if (preset === 'asymmetric') {
      surfaces = surfaces.map(function (value, index) {
        return value + Math.sin(index / 37) * 34 + index / LIMITS.columns * 42;
      });
    }

    surfaces = smooth(surfaces, Math.round(parameters.smoothness * 6));
    var columns = surfaces.map(function (surface, index) {
      var top = Math.round(surface / LIMITS.rowHeight) * LIMITS.rowHeight;
      if ((preset === 'centerHole' || preset === 'grandCanyon') && Math.abs(index - LIMITS.columns / 2) < (preset === 'grandCanyon' ? 38 : 18)) return [];
      return [[top, LIMITS.terrainBottom]];
    });

    function addPlatform(center, width, top, thickness) {
      var start = Math.max(0, Math.floor(center - width / 2));
      var end = Math.min(LIMITS.columns - 1, Math.ceil(center + width / 2));
      for (var index = start; index <= end; index += 1) {
        var curve = Math.abs(index - center) / Math.max(1, width / 2);
        var platformTop = Math.round((top + curve * curve * 8) / LIMITS.rowHeight) * LIMITS.rowHeight;
        columns[index].unshift([platformTop, Math.min(platformTop + thickness, LIMITS.terrainBottom)]);
      }
    }

    if (preset === 'floatingIslands' || preset === 'platforms') {
      var count = preset === 'floatingIslands' ? Math.max(3, parameters.platformCount) : Math.max(2, parameters.platformCount);
      for (var platform = 0; platform < count; platform += 1) {
        var center = 45 + random() * (LIMITS.columns - 90);
        var width = 24 + random() * 45;
        var top = 225 + random() * 170;
        addPlatform(center, width, top, 20 + Math.round(random() * 24));
      }
    }

    if (preset === 'cave') {
      for (var caveColumn = 0; caveColumn < LIMITS.columns; caveColumn += 1) {
        var ceilingBottom = 120 + Math.sin(caveColumn / 43) * 25;
        columns[caveColumn].unshift([0, Math.round(ceilingBottom / LIMITS.rowHeight) * LIMITS.rowHeight]);
      }
    }

    if (parameters.cavityRate > 0 && preset !== 'cave') {
      var cavityCount = Math.round(parameters.cavityRate * 12 * (0.7 + parameters.difficulty * 0.6));
      for (var cavity = 0; cavity < cavityCount; cavity += 1) {
        var centerColumn = 35 + Math.floor(random() * (LIMITS.columns - 70));
        var cavityWidth = 10 + Math.floor(random() * 28);
        var cavityTop = 520 + Math.floor(random() * 55);
        var cavityBottom = Math.min(LIMITS.terrainBottom - 8, cavityTop + 16 + Math.floor(random() * 28));
        for (var offset = -cavityWidth; offset <= cavityWidth; offset += 1) {
          var target = centerColumn + offset;
          if (target < 0 || target >= LIMITS.columns || !columns[target].length) continue;
          var baseSegment = columns[target][columns[target].length - 1];
          if (cavityTop <= baseSegment[0] + 20) continue;
          columns[target].pop();
          columns[target].push([baseSegment[0], cavityTop], [cavityBottom, baseSegment[1]]);
        }
      }
    }

    columns = columns.map(function (segments) {
      var sorted = segments.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      var merged = [];
      sorted.forEach(function (segment) {
        if (!merged.length || segment[0] > merged[merged.length - 1][1]) {
          merged.push(segment.slice());
        } else {
          merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], segment[1]);
        }
      });
      return merged;
    });
    stage.terrain.columns = columns;
    if (parameters.steelMode === 'whole') {
      stage.materials = [{ id: 'steel', type: 'indestructible', destructible: false, color: '#49515B' }];
    } else if (parameters.steelMode === 'partial') {
      var steelSegments = columns.map(function () { return []; });
      var steelZones = [
        [0.12 + random() * 0.08, 0.24 + random() * 0.08],
        [0.43 + random() * 0.08, 0.57 + random() * 0.08],
        [0.76 + random() * 0.08, 0.88 + random() * 0.06]
      ];
      columns.forEach(function (segments, column) {
        var t = column / Math.max(1, LIMITS.columns - 1);
        if (!segments.length || !steelZones.some(function (zone) { return t >= zone[0] && t <= zone[1]; })) return;
        var baseSegment = segments[segments.length - 1];
        var capBottom = Math.min(baseSegment[1], baseSegment[0] + Math.max(18, LIMITS.rowHeight * 5));
        if (capBottom > baseSegment[0]) steelSegments[column] = [[baseSegment[0], capBottom, 'steel']];
      });
      stage.materials = [
        { id: 'terrain', type: 'destructible', destructible: true, color: '#7A5435' },
        { id: 'steel', type: 'indestructible', destructible: false, color: '#49515B' }
      ];
      stage.terrain.materialSegments = steelSegments;
    }
    stage.spawnPoints = makeSpawns(columns, format);
    if (options.wind && Number(options.wind.strength) > 0) {
      stage.gimmicks = [{
        id: 'gimmick_global_wind',
        type: 'globalWind',
        direction: Number(options.wind.direction) < 0 ? -1 : 1,
        strength: roundNumber(clamp(options.wind.strength, 0, 1), 3)
      }];
    }
    return normalizeStage(stage);
  }

  function segmentsToGrid(input, sizeHint) {
    activateStageLimits(sizeHint || input);
    var columns = input && input.terrain ? input.terrain.columns : input;
    columns = Array.isArray(columns) ? columns : blankColumns();
    var grid = new Uint8Array(LIMITS.columns * LIMITS.rows);
    for (var column = 0; column < Math.min(columns.length, LIMITS.columns); column += 1) {
      var segments = Array.isArray(columns[column]) ? columns[column] : [];
      for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        var segment = segments[segmentIndex];
        var top = Math.max(0, Math.floor(Number(segment[0]) / LIMITS.rowHeight));
        var bottom = Math.min(LIMITS.rows, Math.ceil(Number(segment[1]) / LIMITS.rowHeight));
        for (var row = top; row < bottom; row += 1) grid[row * LIMITS.columns + column] = 1;
      }
    }
    return grid;
  }

  function gridToSegments(grid, sizeHint) {
    activateStageLimits(sizeHint);
    if (!grid || grid.length !== LIMITS.columns * LIMITS.rows) throw new Error('地形グリッドのサイズが不正です。');
    var columns = blankColumns();
    for (var column = 0; column < LIMITS.columns; column += 1) {
      var start = -1;
      for (var row = 0; row <= LIMITS.rows; row += 1) {
        var solid = row < LIMITS.rows && grid[row * LIMITS.columns + column] !== 0;
        if (solid && start < 0) start = row;
        if (!solid && start >= 0) {
          columns[column].push([start * LIMITS.rowHeight, Math.min(row * LIMITS.rowHeight, LIMITS.stageHeight)]);
          start = -1;
        }
      }
    }
    return columns;
  }

  function paintCircle(grid, worldX, worldY, radius, solid, sizeHint) {
    activateStageLimits(sizeHint);
    if (!grid || grid.length !== LIMITS.columns * LIMITS.rows) throw new Error('地形グリッドのサイズが不正です。');
    worldX = clamp(worldX, 0, LIMITS.stageWidth);
    worldY = clamp(worldY, 0, LIMITS.stageHeight);
    radius = clamp(radius, 1, 240);
    var minColumn = Math.max(0, Math.floor((worldX - radius) / LIMITS.columnWidth));
    var maxColumn = Math.min(LIMITS.columns - 1, Math.ceil((worldX + radius) / LIMITS.columnWidth));
    var minRow = Math.max(0, Math.floor((worldY - radius) / LIMITS.rowHeight));
    var maxRow = Math.min(LIMITS.rows - 1, Math.ceil((worldY + radius) / LIMITS.rowHeight));
    var radiusSquared = radius * radius;
    for (var row = minRow; row <= maxRow; row += 1) {
      var y = row * LIMITS.rowHeight + LIMITS.rowHeight / 2;
      for (var column = minColumn; column <= maxColumn; column += 1) {
        var x = column * LIMITS.columnWidth + LIMITS.columnWidth / 2;
        var dx = x - worldX;
        var dy = y - worldY;
        if (dx * dx + dy * dy <= radiusSquared) grid[row * LIMITS.columns + column] = solid ? 1 : 0;
      }
    }
    return grid;
  }

  function carveCircle(stage, x, y, radius) {
    activateStageLimits(stage);
    var next = normalizeStage(stage);
    var hasMaterialOverrides = (next.terrain.materialSegments || []).some(function (column) { return column.length; });
    if (!hasMaterialOverrides && next.materials.length === 1 && next.materials[0].destructible !== true) return next;
    var grid = segmentsToGrid(next);
    paintCircle(grid, x, y, radius, false, next);
    next.terrain.columns = gridToSegments(grid, next);
    next.updatedAt = new Date().toISOString();
    next.checksums.contentHash = '';
    return next;
  }

  function isSolidAt(stage, x, y) {
    activateStageLimits(stage);
    if (!stage || !stage.terrain || !Array.isArray(stage.terrain.columns)) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= LIMITS.stageWidth || y >= LIMITS.stageHeight) return false;
    var column = Math.floor(x / LIMITS.columnWidth);
    var segments = stage.terrain.columns[column] || [];
    return segments.some(function (segment) { return y >= segment[0] && y < segment[1]; });
  }

  function groundYAt(stage, x, referenceY) {
    activateStageLimits(stage);
    if (!stage || !stage.terrain || !Array.isArray(stage.terrain.columns)) return LIMITS.stageHeight;
    var column = Math.max(0, Math.min(LIMITS.columns - 1, Math.floor(Number(x) / LIMITS.columnWidth)));
    var segments = stage.terrain.columns[column] || [];
    if (Number.isFinite(referenceY)) {
      for (var index = 0; index < segments.length; index += 1) {
        if (segments[index][0] >= referenceY) return segments[index][0];
      }
    }
    return segments.length ? segments[0][0] : LIMITS.stageHeight;
  }

  function stepProjectile(projectile, dt, windAccel, gravity) {
    dt = Number.isFinite(dt) ? dt : PHYSICS.fixedDt;
    windAccel = Number.isFinite(windAccel) ? windAccel : 0;
    gravity = Number.isFinite(gravity) ? gravity : PHYSICS.gravity;
    projectile.vx += windAccel * dt;
    projectile.vy += gravity * dt;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    return projectile;
  }

  function getGlobalWind(stage) {
    var gimmicks = stage && Array.isArray(stage.gimmicks) ? stage.gimmicks : [];
    var wind = gimmicks.find(function (item) { return item && item.type === 'globalWind'; });
    return wind ? {
      direction: wind.direction < 0 ? -1 : 1,
      strength: clamp(wind.strength, 0, 1),
      acceleration: (wind.direction < 0 ? -1 : 1) * clamp(wind.strength, 0, 1) * PHYSICS.windAccelMax
    } : { direction: 1, strength: 0, acceleration: 0 };
  }

  function traceProjectile(stage, options) {
    activateStageLimits(stage);
    options = options || {};
    var wind = getGlobalWind(stage);
    var state = {
      x: Number(options.x) || 0,
      y: Number(options.y) || 0,
      vx: Number(options.vx) || 0,
      vy: Number(options.vy) || 0
    };
    if (Number.isFinite(options.angle) && Number.isFinite(options.power)) {
      var radians = Number(options.angle) * Math.PI / 180;
      var speed = clamp(options.power, 0, 100) * PHYSICS.velocityScale;
      state.vx = Math.cos(radians) * speed;
      state.vy = -Math.sin(radians) * speed;
    }
    var dt = PHYSICS.fixedDt;
    var maxSteps = Math.min(3600, Math.ceil(clamp(options.maxSeconds == null ? 8 : options.maxSeconds, 0.1, 30) / dt));
    var points = [{ x: roundNumber(state.x, 3), y: roundNumber(state.y, 3), t: 0 }];
    var outcome = 'timeout';
    var hit = null;
    for (var step = 1; step <= maxSteps; step += 1) {
      stepProjectile(state, dt, wind.acceleration, PHYSICS.gravity);
      if (step % 4 === 0) points.push({ x: roundNumber(state.x, 3), y: roundNumber(state.y, 3), t: roundNumber(step * dt, 4) });
      if (isSolidAt(stage, state.x, state.y)) {
        outcome = 'terrain';
        hit = { x: roundNumber(state.x, 3), y: roundNumber(state.y, 3), t: roundNumber(step * dt, 4) };
        break;
      }
      if (state.x < -64 || state.x > LIMITS.stageWidth + 64 || state.y > LIMITS.stageHeight + 64 || state.y < -600) {
        outcome = 'out';
        break;
      }
    }
    return { points: points, outcome: outcome, hit: hit, wind: wind, finalState: state };
  }

  function issue(code, path, message) {
    return { code: code, path: path, message: message };
  }

  function securityScan(rootValue) {
    var errors = [];
    var nodes = 0;
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    var blockedKeys = { '__proto__': true, prototype: true, constructor: true };
    function visit(value, path, depth) {
      nodes += 1;
      if (nodes > LIMITS.maxObjectNodes) {
        if (!errors.some(function (entry) { return entry.code === 'too_many_nodes'; })) errors.push(issue('too_many_nodes', path, 'データ件数が上限を超えています。'));
        return;
      }
      if (depth > LIMITS.maxJsonDepth) {
        errors.push(issue('too_deep', path, 'JSONの入れ子が深すぎます。'));
        return;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        errors.push(issue('non_finite', path, '有限でない数値は使用できません。'));
        return;
      }
      if (typeof value === 'string') {
        if (value.length > 900000) errors.push(issue('string_too_large', path, '文字列が大きすぎます。'));
        if (/javascript\s*:|data\s*:\s*text\/html|<\s*\/?\s*(script|iframe|object|embed|style|html)\b/i.test(value)) {
          errors.push(issue('executable_content', path, '実行可能なHTMLやスクリプトは使用できません。'));
        }
        if (/https?:\/\/|^\/\//i.test(value)) errors.push(issue('external_url', path, '外部URLは使用できません。'));
        if (/(^|[\\/])\.\.([\\/]|$)|^[a-z]:[\\/]|^[\\/]{1,2}/i.test(value)) errors.push(issue('unsafe_path', path, '安全でないパスは使用できません。'));
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (seen) {
        if (seen.has(value)) {
          errors.push(issue('cycle', path, '循環参照は使用できません。'));
          return;
        }
        seen.add(value);
      }
      if (Array.isArray(value)) {
        for (var index = 0; index < value.length && nodes <= LIMITS.maxObjectNodes; index += 1) {
          visit(value[index], path + '[' + index + ']', depth + 1);
        }
      } else {
        var keys = Object.keys(value);
        for (var keyIndex = 0; keyIndex < keys.length && nodes <= LIMITS.maxObjectNodes; keyIndex += 1) {
          var key = keys[keyIndex];
          if (blockedKeys[key]) errors.push(issue('unsafe_key', path + '.' + key, '危険なプロパティ名は使用できません。'));
          else visit(value[key], path + '.' + key, depth + 1);
        }
      }
    }
    visit(rootValue, '$', 0);
    return errors;
  }

  function validateStage(input) {
    activateStageLimits(input);
    var errors = securityScan(input);
    var warnings = [];
    var metrics = { segmentCount: 0, fileBytes: 0, leftMeanHeight: null, rightMeanHeight: null };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      errors.push(issue('not_object', '$', 'ステージデータがオブジェクトではありません。'));
      return { valid: false, errors: errors, warnings: warnings, metrics: metrics };
    }
    errors = errors.concat(validateAgainstStageSchema(input));
    Object.keys(input).forEach(function (key) {
      if (TOP_LEVEL_KEYS.indexOf(key) < 0) errors.push(issue('unknown_field', '$.' + key, '未対応の項目が含まれています。'));
    });
    if (input.schemaVersion !== SCHEMA_VERSION) errors.push(issue('unsupported_version', '$.schemaVersion', '対応外のスキーマバージョンです。'));
    if (!/^stage_[a-z0-9_-]{8,80}$/.test(String(input.stageId || ''))) errors.push(issue('stage_id', '$.stageId', 'ステージIDが不正です。'));
    if (!safeText(input.title, LIMITS.maxTitleLength, '')) errors.push(issue('title', '$.title', 'ステージ名を入力してください。'));
    if (String(input.title || '').length > LIMITS.maxTitleLength) errors.push(issue('title_length', '$.title', 'ステージ名が長すぎます。'));
    if (String(input.description || '').length > LIMITS.maxDescriptionLength) errors.push(issue('description_length', '$.description', '説明文が長すぎます。'));
    if (!input.gameCompatibility || input.gameCompatibility.gameId !== GAME_ID) errors.push(issue('game_compatibility', '$.gameCompatibility', '対象ゲームとの互換性を確認できません。'));
    if (input.gameCompatibility && typeof input.gameCompatibility === 'object' && !Array.isArray(input.gameCompatibility)) {
      var minimumBuild = buildNumber(input.gameCompatibility.minBuild);
      var maximumBuild = input.gameCompatibility.maxBuild === null ? null : buildNumber(input.gameCompatibility.maxBuild);
      var currentBuild = buildNumber(GAME_BUILD);
      if (minimumBuild === null || (input.gameCompatibility.maxBuild !== null && maximumBuild === null)) {
        errors.push(issue('compatibility_build_format', '$.gameCompatibility', '対応ビルドはv138のような形式で指定してください。'));
      } else if (maximumBuild !== null && minimumBuild > maximumBuild) {
        errors.push(issue('compatibility_build_range', '$.gameCompatibility', '対応ビルドの最小値と最大値が逆転しています。'));
      } else if (currentBuild === null || currentBuild < minimumBuild || (maximumBuild !== null && currentBuild > maximumBuild)) {
        errors.push(issue('compatibility_unsupported', '$.gameCompatibility', 'このステージは現在のゲームバージョンに対応していません。'));
      }
    }
    if (input.stageWidth !== LIMITS.stageWidth || input.stageHeight !== LIMITS.stageHeight) errors.push(issue('stage_size', '$', 'このゲームで使えるステージサイズは標準1440×660または大型2160×960です。'));
    if (!input.coordinateSystem || input.coordinateSystem.origin !== 'top-left' || input.coordinateSystem.terrainColumnWidth !== LIMITS.columnWidth || input.coordinateSystem.terrainRowHeight !== LIMITS.rowHeight) {
      errors.push(issue('coordinate_system', '$.coordinateSystem', '座標系が対象ゲームと一致しません。'));
    }
    var columns = input.terrain && input.terrain.columns;
    if (!input.terrain || input.terrain.encoding !== 'column-segments-v1' || !Array.isArray(columns) || columns.length !== LIMITS.columns) {
      errors.push(issue('terrain_shape', '$.terrain', '地形データの列数または形式が不正です。'));
      columns = [];
    }
    var thinSegments = 0;
    var complexColumns = 0;
    columns.forEach(function (segments, columnIndex) {
      if (!Array.isArray(segments) || segments.length > 32) {
        errors.push(issue('terrain_column', '$.terrain.columns[' + columnIndex + ']', '地形列の形式または要素数が不正です。'));
        return;
      }
      if (segments.length > 6) complexColumns += 1;
      var previousBottom = -1;
      segments.forEach(function (segment, segmentIndex) {
        metrics.segmentCount += 1;
        if (!Array.isArray(segment) || segment.length !== 2 || !Number.isFinite(segment[0]) || !Number.isFinite(segment[1]) || segment[0] < 0 || segment[1] > LIMITS.terrainBottom || segment[1] <= segment[0] || segment[0] < previousBottom) {
          errors.push(issue('terrain_segment', '$.terrain.columns[' + columnIndex + '][' + segmentIndex + ']', '地形区間の座標または並び順が不正です。'));
          return;
        }
        if (segment[1] - segment[0] < LIMITS.minimumTerrainThickness) thinSegments += 1;
        previousBottom = segment[1];
      });
    });
    if (metrics.segmentCount > LIMITS.maxSegments) errors.push(issue('terrain_limit', '$.terrain', '地形区間の数が上限を超えています。'));
    if (thinSegments) warnings.push(issue('thin_terrain', '$.terrain', '細い足場が' + thinSegments + 'か所あります。引っ掛かりや崩落に注意してください。'));
    if (complexColumns > 20) warnings.push(issue('complex_terrain', '$.terrain', '地形が複雑なため、低性能端末で描画負荷が高くなる可能性があります。'));

    var spawns = Array.isArray(input.spawnPoints) ? input.spawnPoints : [];
    if (spawns.length < 2) errors.push(issue('spawn_count', '$.spawnPoints', '出撃地点を2つ以上配置してください。'));
    if (spawns.length > LIMITS.maxSpawns) errors.push(issue('spawn_limit', '$.spawnPoints', '出撃地点が上限を超えています。'));
    var usedSlots = Object.create(null);
    var usedSpawnIds = Object.create(null);
    var usedSpawnOrders = Object.create(null);
    spawns.forEach(function (spawn, index) {
      var path = '$.spawnPoints[' + index + ']';
      if (!spawn || SLOT_ORDER.indexOf(spawn.slot) < 0) {
        errors.push(issue('spawn_slot', path + '.slot', '出撃スロットが不正です。'));
        return;
      }
      if (usedSlots[spawn.slot]) errors.push(issue('spawn_duplicate_slot', path + '.slot', '同じ出撃スロットが重複しています。'));
      usedSlots[spawn.slot] = true;
      if (usedSpawnIds[spawn.id]) errors.push(issue('spawn_duplicate_id', path + '.id', '同じ出撃地点IDが重複しています。'));
      usedSpawnIds[spawn.id] = true;
      if (usedSpawnOrders[spawn.order]) errors.push(issue('spawn_duplicate_order', path + '.order', '出撃順が重複しています。'));
      usedSpawnOrders[spawn.order] = true;
      var expectedTeam = spawn.slot.charAt(0) === 'p' ? 'player' : 'enemy';
      if (spawn.team !== expectedTeam) errors.push(issue('spawn_team', path + '.team', '出撃スロットとチームが一致しません。'));
      if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y) || spawn.x < LIMITS.unitRadius || spawn.x > LIMITS.stageWidth - LIMITS.unitRadius || spawn.y < -LIMITS.unitRadius || spawn.y > LIMITS.stageHeight) {
        errors.push(issue('spawn_bounds', path, '出撃地点が画面外です。'));
      } else {
        if (isSolidAt(input, spawn.x, spawn.y) || isSolidAt(input, spawn.x, spawn.y - LIMITS.unitRadius)) errors.push(issue('spawn_inside_terrain', path, '出撃地点が地形に埋まっています。'));
        var ground = groundYAt(input, spawn.x, spawn.y + LIMITS.unitRadius - 4);
        if (ground >= LIMITS.stageHeight || ground - spawn.y > LIMITS.unitRadius + 24) warnings.push(issue('spawn_fall', path, '出撃直後に落下する可能性があります。'));
        if (ground - spawn.y < LIMITS.unitRadius - 4) errors.push(issue('spawn_inside_terrain', path, '出撃地点が地形に埋まっています。'));
        if (ground < 70) warnings.push(issue('spawn_headroom', path, '頭上空間が不足する可能性があります。'));
        var leftGround = groundYAt(input, Math.max(0, spawn.x - 36));
        var rightGround = groundYAt(input, Math.min(LIMITS.stageWidth - 1, spawn.x + 36));
        if (Math.max(leftGround, rightGround) - Math.min(leftGround, rightGround) > 90) warnings.push(issue('spawn_cliff', path, '出撃地点が崖に近すぎる可能性があります。'));
      }
      for (var otherIndex = 0; otherIndex < index; otherIndex += 1) {
        var other = spawns[otherIndex];
        if (!other) continue;
        var dx = Number(spawn.x) - Number(other.x);
        var dy = Number(spawn.y) - Number(other.y);
        if (dx * dx + dy * dy < Math.pow(LIMITS.unitRadius * 2.2, 2)) errors.push(issue('spawn_overlap', path, '出撃地点同士が重なっています。'));
      }
    });
    if (!usedSlots.p1 || !usedSlots.e1) errors.push(issue('spawn_required_slots', '$.spawnPoints', 'p1とe1の出撃地点が必要です。'));

    var battleRules = input.battleRules || {};
    var expectedPlayers = battleRules.format === '2v2' ? 4 : 2;
    if (battleRules.maxPlayers !== expectedPlayers || spawns.length !== expectedPlayers) {
      errors.push(issue('battle_format_spawns', '$.battleRules', '対戦形式・最大人数・出撃地点数が一致しません。'));
    }
    if (battleRules.format === '2v2' && (!usedSlots.p2 || !usedSlots.e2)) {
      errors.push(issue('spawn_required_slots', '$.spawnPoints', '2対2ではp1・e1・p2・e2の出撃地点が必要です。'));
    }

    var materials = Array.isArray(input.materials) ? input.materials : [];
    if (materials.length < 1 || materials.length > 2 || materials.some(function (material) {
      var expected = material && MATERIAL_CATALOG[material.id];
      return !expected || !expected.enabled || material.type !== expected.type || material.destructible !== expected.destructible;
    })) {
      errors.push(issue('unsupported_material', '$.materials', '地形素材の種類と壊れ方の組み合わせが正しくありません。'));
    }
    var materialIds = Object.create(null);
    materials.forEach(function (material) {
      if (material && materialIds[material.id]) errors.push(issue('unsupported_material', '$.materials', '同じ地形素材が重複しています。'));
      if (material) materialIds[material.id] = true;
    });
    var materialSegments = input.terrain && input.terrain.materialSegments;
    if (materialSegments != null) {
      if (!Array.isArray(materialSegments) || materialSegments.length !== columns.length) {
        errors.push(issue('material_segments_shape', '$.terrain.materialSegments', '素材区分の列数が地形と一致しません。'));
      } else materialSegments.forEach(function (entries, columnIndex) {
        (entries || []).forEach(function (segment) {
          if (!Array.isArray(segment) || segment.length !== 3 || !materialIds[segment[2]]) {
            errors.push(issue('material_segment_invalid', '$.terrain.materialSegments[' + columnIndex + ']', '地形素材区分が不正です。'));
          }
        });
      });
    }
    var gimmicks = Array.isArray(input.gimmicks) ? input.gimmicks : [];
    if (gimmicks.length > LIMITS.maxGimmicks) errors.push(issue('gimmick_limit', '$.gimmicks', 'ギミック数が上限を超えています。'));
    var globalWindCount = 0;
    var usedGimmickIds = Object.create(null);
    gimmicks.forEach(function (gimmick, index) {
      var path = '$.gimmicks[' + index + ']';
      if (gimmick && usedGimmickIds[gimmick.id]) errors.push(issue('gimmick_duplicate_id', path + '.id', '同じギミックIDが重複しています。'));
      if (gimmick) usedGimmickIds[gimmick.id] = true;
      if (!gimmick || gimmick.type !== 'globalWind') {
        errors.push(issue('unsupported_gimmick', path, '未対応のギミックが含まれています。MVPは全体風だけに対応します。'));
      } else {
        globalWindCount += 1;
        if (gimmick.direction !== -1 && gimmick.direction !== 1) errors.push(issue('wind_direction', path + '.direction', '風向きが不正です。'));
        if (!Number.isFinite(gimmick.strength) || gimmick.strength < 0 || gimmick.strength > 1) errors.push(issue('wind_strength', path + '.strength', '風の強さは0から1の範囲で指定してください。'));
      }
    });
    if (globalWindCount > 1) errors.push(issue('wind_duplicate', '$.gimmicks', '全体風ギミックは1つだけ配置できます。'));
    if (gimmicks.length > 8) warnings.push(issue('many_gimmicks', '$.gimmicks', 'ギミックが多いため確認に時間がかかる可能性があります。'));

    if (input.preview && (input.preview.data !== null || input.preview.mimeType !== null || input.preview.width !== 0 || input.preview.height !== 0)) {
      errors.push(issue('preview_unsupported', '$.preview', 'MVPはプレビュー画像の埋め込みに対応していません。'));
    }

    var leftHeights = [];
    var rightHeights = [];
    for (var heightColumn = 0; heightColumn < columns.length; heightColumn += 1) {
      if (!columns[heightColumn] || !columns[heightColumn].length) continue;
      var height = columns[heightColumn][0][0];
      (heightColumn < columns.length / 2 ? leftHeights : rightHeights).push(height);
    }
    function mean(values) {
      return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
    }
    metrics.leftMeanHeight = mean(leftHeights);
    metrics.rightMeanHeight = mean(rightHeights);
    if (metrics.leftMeanHeight != null && metrics.rightMeanHeight != null && Math.abs(metrics.leftMeanHeight - metrics.rightMeanHeight) > 90) {
      warnings.push(issue('height_imbalance', '$.terrain', '左右の平均高度に大きな差があります。公平性の参考として確認してください。'));
    }
    if (spawns.length >= 2) {
      var playerSpawn = spawns.find(function (spawn) { return spawn.slot === 'p1'; });
      var enemySpawn = spawns.find(function (spawn) { return spawn.slot === 'e1'; });
      if (playerSpawn && enemySpawn && Math.abs(playerSpawn.x - enemySpawn.x) < 220) warnings.push(issue('spawn_distance', '$.spawnPoints', '出撃地点同士が近く、砲撃可能範囲が狭い可能性があります。'));
    }
    try {
      metrics.fileBytes = byteLength(canonicalStringify(input));
      if (metrics.fileBytes > LIMITS.maxFileBytes) errors.push(issue('file_size', '$', 'ステージデータが2MBの上限を超えています。'));
    } catch (_) {
      errors.push(issue('serialization', '$', 'ステージデータを安全に読み取れません。'));
    }
    return { valid: errors.length === 0, errors: errors, warnings: warnings, metrics: metrics };
  }

  function normalizeColumns(columns) {
    var result = blankColumns();
    if (!Array.isArray(columns)) return result;
    for (var column = 0; column < LIMITS.columns; column += 1) {
      var source = Array.isArray(columns[column]) ? columns[column] : [];
      result[column] = source.map(function (segment) {
        return [roundNumber(clamp(segment && segment[0], 0, LIMITS.terrainBottom), 3), roundNumber(clamp(segment && segment[1], 0, LIMITS.terrainBottom), 3)];
      }).filter(function (segment) { return segment[1] > segment[0]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    }
    return result;
  }

  function normalizeMaterialSegments(columns, source) {
    var result = blankColumns();
    if (!Array.isArray(source)) return result;
    for (var column = 0; column < LIMITS.columns; column += 1) {
      var geometry = Array.isArray(columns[column]) ? columns[column] : [];
      var entries = Array.isArray(source[column]) ? source[column] : [];
      result[column] = entries.map(function (segment) {
        return [roundNumber(clamp(segment && segment[0], 0, LIMITS.terrainBottom), 3),
          roundNumber(clamp(segment && segment[1], 0, LIMITS.terrainBottom), 3),
          segment && segment[2] === 'steel' ? 'steel' : 'terrain'];
      }).filter(function (segment) {
        return segment[1] > segment[0] && geometry.some(function (base) {
          return segment[0] >= base[0] && segment[1] <= base[1];
        });
      });
    }
    return result;
  }

  function normalizeStage(input) {
    input = input || {};
    activateStageLimits(input);
    var base = createStageDocument({
      stageId: input.stageId,
      title: input.title,
      description: input.description,
      authorDisplayName: input.authorDisplayName,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      generatorVersion: input.generatorVersion,
      seed: input.seed,
      preset: input.generation && input.generation.preset,
      format: input.battleRules && input.battleRules.format,
      theme: input.background && input.background.theme,
      size: stageSizeKey(input)
    });
    base.schemaVersion = input.schemaVersion || SCHEMA_VERSION;
    base.generation = {
      preset: PRESET_KEYS.indexOf(input.generation && input.generation.preset) >= 0 ? input.generation.preset : 'blank',
      parameters: input.generation && input.generation.parameters && typeof input.generation.parameters === 'object'
        ? sortObjectNumbers(input.generation.parameters) : {}
    };
    base.gameCompatibility = {
      gameId: safeText(input.gameCompatibility && input.gameCompatibility.gameId, 40, GAME_ID),
      minBuild: safeText(input.gameCompatibility && input.gameCompatibility.minBuild, 40, GAME_BUILD),
      maxBuild: input.gameCompatibility && input.gameCompatibility.maxBuild != null ? safeText(input.gameCompatibility.maxBuild, 40, null) : null
    };
    base.terrain.columns = normalizeColumns(input.terrain && input.terrain.columns);
    base.terrain.materialSegments = normalizeMaterialSegments(base.terrain.columns, input.terrain && input.terrain.materialSegments);
    base.terrain.minimumThickness = roundNumber(clamp(input.terrain && input.terrain.minimumThickness || LIMITS.minimumTerrainThickness, 4, 64), 3);
    base.materials = (Array.isArray(input.materials) ? input.materials : base.materials).slice(0, 4).map(function (material) {
      return {
        id: safeText(material && material.id, 32, 'terrain').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'terrain',
        type: material && (material.type === 'destructible' || material.type === 'indestructible')
          ? material.type : safeText(material && material.type, 32, 'destructible'),
        destructible: material && material.destructible === true,
        color: safeColor(material && material.color, '#7A5435')
      };
    }).sort(function (a, b) { return a.id.localeCompare(b.id); });
    base.spawnPoints = (Array.isArray(input.spawnPoints) ? input.spawnPoints : []).slice(0, LIMITS.maxSpawns + 1).map(function (spawn, index) {
      var slot = SLOT_ORDER.indexOf(spawn && spawn.slot) >= 0 ? spawn.slot : SLOT_ORDER[index] || 'p1';
      return {
        id: safeText(spawn && spawn.id, 48, 'spawn_' + slot).replace(/[^a-z0-9_-]/gi, '').toLowerCase(),
        slot: slot,
        team: spawn && spawn.team === 'enemy' ? 'enemy' : 'player',
        order: Math.round(clamp(spawn && spawn.order || index + 1, 1, 4)),
        x: roundNumber(Number(spawn && spawn.x), 3),
        y: roundNumber(Number(spawn && spawn.y), 3),
        direction: spawn && spawn.direction === 'left' ? 'left' : 'right'
      };
    }).sort(function (a, b) { return a.order - b.order || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot); });
    base.gimmicks = (Array.isArray(input.gimmicks) ? input.gimmicks : []).slice(0, LIMITS.maxGimmicks + 1).map(function (gimmick, index) {
      return {
        id: safeText(gimmick && gimmick.id, 48, 'gimmick_' + (index + 1)).replace(/[^a-z0-9_-]/gi, '').toLowerCase(),
        type: safeText(gimmick && gimmick.type, 32, ''),
        direction: Number(gimmick && gimmick.direction) < 0 ? -1 : 1,
        strength: roundNumber(Number(gimmick && gimmick.strength), 3)
      };
    }).sort(function (a, b) { return a.id.localeCompare(b.id); });
    base.decorations = {
      enabled: !input.decorations || input.decorations.enabled !== false,
      foreground: Array.isArray(input.decorations && input.decorations.foreground) ? clone(input.decorations.foreground).slice(0, 32) : [],
      background: Array.isArray(input.decorations && input.decorations.background) ? clone(input.decorations.background).slice(0, 32) : []
    };
    base.background = {
      mode: ['theme', 'color', 'gradient'].indexOf(input.background && input.background.mode) >= 0 ? input.background.mode : 'theme',
      theme: THEME_KEYS.indexOf(input.background && input.background.theme) >= 0 ? input.background.theme : 'grass',
      color: safeColor(input.background && input.background.color, '#87B9D8'),
      gradient: {
        from: safeColor(input.background && input.background.gradient && input.background.gradient.from, '#6DA9D2'),
        to: safeColor(input.background && input.background.gradient && input.background.gradient.to, '#D7E8E8')
      }
    };
    base.battleRules = {
      format: input.battleRules && input.battleRules.format === '2v2' ? '2v2' : '1v1',
      maxPlayers: input.battleRules && input.battleRules.format === '2v2' ? 4 : 2,
      turnLimit: input.battleRules && Number.isInteger(input.battleRules.turnLimit) ? clamp(input.battleRules.turnLimit, 1, 999) : null,
      rankedAllowed: false,
      onlineAllowed: false
    };
    base.preview = {
      width: Math.round(clamp(input.preview && input.preview.width || 0, 0, 960)),
      height: Math.round(clamp(input.preview && input.preview.height || 0, 0, 640)),
      mimeType: ['image/webp', 'image/png'].indexOf(input.preview && input.preview.mimeType) >= 0 ? input.preview.mimeType : null,
      data: input.preview && typeof input.preview.data === 'string' ? input.preview.data.slice(0, 800000) : null
    };
    base.checksums = {
      algorithm: 'SHA-256',
      contentHash: /^[a-f0-9]{64}$/.test(String(input.checksums && input.checksums.contentHash || '')) ? String(input.checksums.contentHash) : ''
    };
    return base;
  }

  function sortObjectNumbers(value) {
    if (Array.isArray(value)) return value.map(sortObjectNumbers);
    if (!value || typeof value !== 'object') return typeof value === 'number' && Number.isFinite(value) ? roundNumber(value, 6) : value;
    var result = {};
    Object.keys(value).sort().forEach(function (key) {
      Object.defineProperty(result, key, {
        value: sortObjectNumbers(value[key]),
        enumerable: true,
        configurable: true,
        writable: true
      });
    });
    return result;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).sort().forEach(function (key) {
        if (value[key] !== undefined) {
          Object.defineProperty(result, key, {
            value: canonicalize(value[key]),
            enumerable: true,
            configurable: true,
            writable: true
          });
        }
      });
      return result;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? roundNumber(value, 6) : null;
    return value;
  }

  function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(text), 'utf8');
    return unescape(encodeURIComponent(String(text))).length;
  }

  function pureSha256(text) {
    function rightRotate(value, amount) { return value >>> amount | value << 32 - amount; }
    var maxWord = Math.pow(2, 32);
    var words = [];
    var ascii = unescape(encodeURIComponent(text));
    var bitLength = ascii.length * 8;
    var hash = pureSha256.h || [];
    var constants = pureSha256.k || [];
    var primeCounter = constants.length;
    var candidate = 2;
    function isComposite(number) {
      for (var factor = 2; factor * factor <= number; factor += 1) if (number % factor === 0) return true;
      return false;
    }
    while (primeCounter < 64) {
      if (!isComposite(candidate)) {
        if (primeCounter < 8) hash[primeCounter] = Math.pow(candidate, 0.5) * maxWord | 0;
        constants[primeCounter] = Math.pow(candidate, 1 / 3) * maxWord | 0;
        primeCounter += 1;
      }
      candidate += 1;
    }
    pureSha256.h = hash;
    pureSha256.k = constants;
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (var index = 0; index < ascii.length; index += 1) words[index >> 2] |= ascii.charCodeAt(index) << (3 - index % 4) * 8;
    words[words.length] = bitLength / maxWord | 0;
    words[words.length] = bitLength;
    var currentHash = hash.slice(0);
    for (var block = 0; block < words.length; block += 16) {
      var oldHash = currentHash.slice(0);
      var working = currentHash.slice(0, 8);
      var schedule = [];
      for (var offset = 0; offset < 64; offset += 1) {
        var word = offset < 16 ? words[block + offset] : (
          schedule[offset - 16] +
          (rightRotate(schedule[offset - 15], 7) ^ rightRotate(schedule[offset - 15], 18) ^ schedule[offset - 15] >>> 3) +
          schedule[offset - 7] +
          (rightRotate(schedule[offset - 2], 17) ^ rightRotate(schedule[offset - 2], 19) ^ schedule[offset - 2] >>> 10)
        ) | 0;
        schedule[offset] = word;
        var temp1 = working[7] +
          (rightRotate(working[4], 6) ^ rightRotate(working[4], 11) ^ rightRotate(working[4], 25)) +
          (working[4] & working[5] ^ ~working[4] & working[6]) +
          constants[offset] + word | 0;
        var temp2 = (rightRotate(working[0], 2) ^ rightRotate(working[0], 13) ^ rightRotate(working[0], 22)) +
          (working[0] & working[1] ^ working[0] & working[2] ^ working[1] & working[2]) | 0;
        working = [(temp1 + temp2) | 0].concat(working);
        working[4] = working[4] + temp1 | 0;
        working.pop();
      }
      for (var hashIndex = 0; hashIndex < 8; hashIndex += 1) currentHash[hashIndex] = currentHash[hashIndex] + working[hashIndex] | 0;
      void oldHash;
    }
    var result = '';
    for (var hashWord = 0; hashWord < 8; hashWord += 1) {
      for (var byte = 3; byte >= 0; byte -= 1) result += ((currentHash[hashWord] >> byte * 8) & 255).toString(16).padStart(2, '0');
    }
    return result;
  }

  async function sha256(text) {
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : null;
    if (typeof crypto !== 'undefined' && crypto.subtle && bytes) {
      var digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    }
    if (typeof require === 'function') {
      try {
        return require('crypto').createHash('sha256').update(text, 'utf8').digest('hex');
      } catch (_) { /* pure JavaScript fallback below */ }
    }
    return pureSha256(text);
  }

  function hashPayload(stage) {
    var normalized = normalizeStage(stage);
    normalized.checksums.contentHash = '';
    return canonicalStringify(normalized);
  }

  async function contentHash(stage) {
    return sha256(hashPayload(stage));
  }

  function contentHashSync(stage) {
    return pureSha256(hashPayload(stage));
  }

  async function finalizeStage(stage, options) {
    options = options || {};
    var rawResult = validateStage(stage);
    if (!rawResult.valid && options.allowInvalid !== true) {
      var rawError = new Error(rawResult.errors[0] ? rawResult.errors[0].message : 'ステージが不正です。');
      rawError.validation = rawResult;
      throw rawError;
    }
    var normalized = normalizeStage(stage);
    if (options.touchUpdatedAt !== false) normalized.updatedAt = new Date().toISOString();
    normalized.checksums.contentHash = '';
    var result = validateStage(normalized);
    if (!result.valid && options.allowInvalid !== true) {
      var error = new Error(result.errors[0] ? result.errors[0].message : 'ステージが不正です。');
      error.validation = result;
      throw error;
    }
    normalized.checksums.contentHash = await contentHash(normalized);
    return normalized;
  }

  async function verifyStageHash(stage) {
    var expected = String(stage && stage.checksums && stage.checksums.contentHash || '').toLowerCase();
    var actual = await contentHash(stage);
    return { valid: /^[a-f0-9]{64}$/.test(expected) && expected === actual, expected: expected, actual: actual };
  }

  function verifyStageHashSync(stage) {
    var expected = String(stage && stage.checksums && stage.checksums.contentHash || '').toLowerCase();
    var actual = contentHashSync(stage);
    return { valid: /^[a-f0-9]{64}$/.test(expected) && expected === actual, expected: expected, actual: actual };
  }

  function createStageIdentity(stage) {
    var validation = validateStage(stage);
    if (!validation.valid) {
      var error = new Error(validation.errors[0] ? validation.errors[0].message : 'ステージ識別情報を作成できません。');
      error.validation = validation;
      throw error;
    }
    var hash = verifyStageHashSync(stage);
    if (!hash.valid) throw new Error('contentHashが未確定、またはステージ内容と一致しません。');
    var normalized = normalizeStage(stage);
    return {
      stageId: normalized.stageId,
      schemaVersion: normalized.schemaVersion,
      contentHash: normalized.checksums.contentHash,
      gameCompatibility: clone(normalized.gameCompatibility)
    };
  }

  function compareStageIdentity(local, remote) {
    var reasons = [];
    var localIdentity = local || {};
    var remoteIdentity = remote || {};
    if (localIdentity.stageId !== remoteIdentity.stageId) reasons.push('stageIdが一致しません。');
    if (localIdentity.schemaVersion !== remoteIdentity.schemaVersion) reasons.push('schemaVersionが一致しません。');
    if (localIdentity.contentHash !== remoteIdentity.contentHash) reasons.push('contentHashが一致しません。');
    if (canonicalStringify(localIdentity.gameCompatibility || null)
        !== canonicalStringify(remoteIdentity.gameCompatibility || null)) {
      reasons.push('gameCompatibilityが一致しません。');
    }
    return {
      match: reasons.length === 0,
      reason: reasons.join(' '),
      reasons: reasons
    };
  }

  function safeFileName(title, suffix) {
    var name = safeText(title, 80, 'stage');
    if (typeof name.normalize === 'function') name = name.normalize('NFKC');
    name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '');
    if (!name) name = 'stage';
    name = name.slice(0, 64);
    return suffix ? name + suffix : name;
  }

  function toGameAdapter(stage) {
    activateStageLimits(stage);
    var result = validateStage(stage);
    if (!result.valid) {
      var error = new Error(result.errors[0] ? result.errors[0].message : 'ステージをゲーム用に変換できません。');
      error.validation = result;
      throw error;
    }
    var normalized = normalizeStage(stage);
    var spawnMap = {};
    normalized.spawnPoints.forEach(function (spawn) { spawnMap[spawn.slot] = clone(spawn); });
    var wind = getGlobalWind(normalized);
    return {
      stageId: normalized.stageId,
      schemaVersion: normalized.schemaVersion,
      contentHash: normalized.checksums.contentHash,
      gameCompatibility: clone(normalized.gameCompatibility),
      title: normalized.title,
      authorDisplayName: normalized.authorDisplayName,
      stageSize: stageSizeKey(normalized),
      stageWidth: normalized.stageWidth,
      stageHeight: normalized.stageHeight,
      segments: clone(normalized.terrain.columns),
      materialSegments: clone(normalized.terrain.materialSegments || []),
      pattern: 'custom',
      startOnIsland: false,
      themeKey: normalized.background.theme,
      parallaxSeed: seedToUint32(normalized.seed) % 10000,
      bridge: null,
      spawnMap: spawnMap,
      wind: wind,
      format: normalized.battleRules.format,
      appearance: {
        background: clone(normalized.background),
        terrainMaterial: normalized.materials[0] && normalized.materials[0].id === 'steel' && !(normalized.terrain.materialSegments || []).some(function (column) { return column.length; }) ? 'steel' : 'terrain',
        ...(normalized.terrain.materialSegments && normalized.terrain.materialSegments.some(function (column) { return column.length; })
          ? { terrainMaterialSegments: clone(normalized.terrain.materialSegments) } : {}),
        terrainColor: normalized.materials[0] && normalized.materials[0].color
          ? normalized.materials[0].color
          : '#7A5435',
        decorationsEnabled: normalized.decorations.enabled !== false
      }
    };
  }

  function migrateStage(input) {
    if (!input || typeof input !== 'object') throw new Error('ステージデータを読み取れません。');
    if (input.schemaVersion !== SCHEMA_VERSION) throw new Error('対応外のスキーマバージョンです。');
    return normalizeStage(input);
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    GENERATOR_VERSION: GENERATOR_VERSION,
    GAME_ID: GAME_ID,
    GAME_BUILD: GAME_BUILD,
    LIMITS: STANDARD_LIMITS,
    STAGE_SIZES: STAGE_SIZES,
    getStageLimits: getStageLimits,
    PHYSICS: PHYSICS,
    PRESETS: PRESETS,
    MATERIAL_CATALOG: MATERIAL_CATALOG,
    schemaDocument: schemaDocument,
    createStageDocument: createStageDocument,
    generateStage: generateStage,
    segmentsToGrid: segmentsToGrid,
    gridToSegments: gridToSegments,
    paintCircle: paintCircle,
    carveCircle: carveCircle,
    isSolidAt: isSolidAt,
    groundYAt: groundYAt,
    stepProjectile: stepProjectile,
    traceProjectile: traceProjectile,
    validateStage: validateStage,
    normalizeStage: normalizeStage,
    canonicalStringify: canonicalStringify,
    contentHash: contentHash,
    contentHashSync: contentHashSync,
    finalizeStage: finalizeStage,
    verifyStageHash: verifyStageHash,
    verifyStageHashSync: verifyStageHashSync,
    createStageIdentity: createStageIdentity,
    compareStageIdentity: compareStageIdentity,
    safeFileName: safeFileName,
    getGlobalWind: getGlobalWind,
    toGameAdapter: toGameAdapter,
    migrateStage: migrateStage
  });
});
