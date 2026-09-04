(function initKatamonStageBattleItems(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonStageBattleItems = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonStageBattleItems() {
  'use strict';

  const SPAWN_STATE_SCHEMA_VERSION = 1;
  const BATTLE_ITEM_RNG_VERSION = 1;
  const BATTLE_ITEM_RNG_NAMESPACE = 'stage-battle-item:v1';
  const BATTLE_ITEM_RNG_HASH_ALGORITHM = 'fnv1a32-utf16-v1';
  const KIND_RNG_LABEL = 'kind';
  const POSITION_RNG_LABEL = 'position';
  const RESOURCE_SHARD_RNG_LABEL = 'resource-shard';
  const ITEM_KINDS = Object.freeze(['healing', 'special_charge', 'gear_resource']);
  const ITEM_WEIGHTS = Object.freeze({ healing: 45, special_charge: 30, gear_resource: 25 });
  const MATCH_CAPS = Object.freeze({ healing: 2, special_charge: 1, gear_resource: 1 });
  const SPAWN_RULES = Object.freeze({
    initialTurn: 2,
    lifetimeTurns: 6,
    cooldownTurns: 4,
    maxActive: 1,
    maxPerMatch: 3,
    cutoffTurn: 20,
    pickupRadius: 32,
    edgeMargin: 80,
    unitClearance: 120,
    fairnessTolerance: 96
  });
  const RESOURCE_RULES = Object.freeze({
    powderPerBox: 3,
    shardChanceBasisPoints: 500,
    maxBoxesPerRun: 10,
    maxShardsPerRun: 1
  });
  const MODE_KEYS = Object.freeze([
    'offline', 'normalCpu', 'oneVsOne', 'officialStage', 'boss', 'online',
    'twoVsTwo', 'free', 'tutorial', 'demo', 'custom'
  ]);
  const SPAWN_STATE_KEYS = Object.freeze([
    'schemaVersion', 'itemId', 'runId', 'matchOrdinal', 'spawnOrdinal',
    'kind', 'x', 'y', 'spawnTurn', 'expiresTurn'
  ]);

  class StageBattleItemError extends Error {
    constructor(code, message) {
      super(message ? `${code}: ${message}` : code);
      this.name = 'StageBattleItemError';
      this.code = code;
    }
  }

  const fail = (code, message) => { throw new StageBattleItemError(code, message); };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  function exactData(value, keys, code) {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) fail(code, 'expected a plain exact-key object');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code, 'unknown or missing fields');
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value') || own(descriptor, 'get') || own(descriptor, 'set')) fail(code, 'accessors are not accepted');
    }
    return descriptors;
  }
  const dataValue = (descriptors, key) => descriptors[key].value;
  const safeInteger = (value, code, minimum = 0) => {
    if (!Number.isSafeInteger(value) || value < minimum) fail(code, 'expected a safe integer');
    return value;
  };
  const finiteNumber = (value, code) => {
    if (!Number.isFinite(value)) fail(code, 'expected a finite number');
    return value;
  };
  const bool = (value, code) => {
    if (typeof value !== 'boolean') fail(code, 'expected a boolean');
    return value;
  };
  const runId = (value, code = 'INVALID_BATTLE_ITEM_RUN_ID') => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) fail(code, 'invalid run id');
    return value;
  };
  const label = (value) => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail('INVALID_BATTLE_ITEM_RNG_LABEL');
    return value;
  };
  const kind = (value, code = 'INVALID_BATTLE_ITEM_KIND') => {
    if (!ITEM_KINDS.includes(value)) fail(code);
    return value;
  };
  const freezePoint = (point) => Object.freeze({ x: point.x, y: point.y });
  const freezeResources = (resources) => Object.freeze({
    boxesCollected: resources.boxesCollected,
    powder: resources.powder,
    blueprintShards: resources.blueprintShards
  });
  const freezeUnit = (unit) => Object.freeze({ hp: unit.hp, maxHp: unit.maxHp, specialCharge: unit.specialCharge });

  function validateIdentityValues(input, keys, code) {
    const descriptors = exactData(input, keys, code);
    return {
      descriptors,
      runId: runId(dataValue(descriptors, 'runId'), code),
      matchOrdinal: safeInteger(dataValue(descriptors, 'matchOrdinal'), code),
      spawnOrdinal: safeInteger(dataValue(descriptors, 'spawnOrdinal'), code)
    };
  }

  function canonicalRngKey(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'label'], 'INVALID_BATTLE_ITEM_RNG_INPUT');
    const rngLabel = label(dataValue(identity.descriptors, 'label'));
    return [
      BATTLE_ITEM_RNG_HASH_ALGORITHM,
      `version=${BATTLE_ITEM_RNG_VERSION}`,
      `namespace=${BATTLE_ITEM_RNG_NAMESPACE}`,
      `run=${JSON.stringify(identity.runId)}`,
      `match=${identity.matchOrdinal}`,
      `spawn=${identity.spawnOrdinal}`,
      `label=${rngLabel}`
    ].join('|');
  }

  function hash32(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function rollBasisPoints(input) {
    return hash32(canonicalRngKey(input)) % 10000;
  }

  function createItemId(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'kind'], 'INVALID_BATTLE_ITEM_ID_INPUT');
    const itemKind = kind(dataValue(identity.descriptors, 'kind'), 'INVALID_BATTLE_ITEM_ID_INPUT');
    const digest = hash32(JSON.stringify([
      BATTLE_ITEM_RNG_NAMESPACE,
      identity.runId,
      identity.matchOrdinal,
      identity.spawnOrdinal,
      itemKind
    ])).toString(16).padStart(8, '0');
    return `battle-item:v1:${identity.matchOrdinal}:${identity.spawnOrdinal}:${itemKind}:${digest}`;
  }

  function isEligibleBattleMode(flags) {
    const descriptors = exactData(flags, MODE_KEYS, 'INVALID_BATTLE_ITEM_MODE_FLAGS');
    const values = {};
    for (const key of MODE_KEYS) values[key] = bool(dataValue(descriptors, key), 'INVALID_BATTLE_ITEM_MODE_FLAGS');
    return values.offline && values.normalCpu && values.oneVsOne && values.officialStage
      && !values.boss && !values.online && !values.twoVsTwo && !values.free
      && !values.tutorial && !values.demo && !values.custom;
  }

  function validateCounts(value) {
    const descriptors = exactData(value, ITEM_KINDS, 'INVALID_BATTLE_ITEM_SPAWN_COUNTS');
    const result = {};
    for (const itemKind of ITEM_KINDS) result[itemKind] = safeInteger(dataValue(descriptors, itemKind), 'INVALID_BATTLE_ITEM_SPAWN_COUNTS');
    return result;
  }

  function selectItemKindForRoll(roll, currentStreak, spawnedCounts) {
    safeInteger(roll, 'INVALID_BATTLE_ITEM_ROLL');
    if (roll >= 10000) fail('INVALID_BATTLE_ITEM_ROLL');
    safeInteger(currentStreak, 'INVALID_BATTLE_ITEM_STREAK');
    const counts = validateCounts(spawnedCounts);
    const eligible = ITEM_KINDS.filter((itemKind) => counts[itemKind] < MATCH_CAPS[itemKind]
      && (itemKind !== 'gear_resource' || currentStreak >= 2));
    if (eligible.length === 0) return null;
    const totalWeight = eligible.reduce((sum, itemKind) => sum + ITEM_WEIGHTS[itemKind], 0);
    const weightedRoll = Math.floor((roll * totalWeight) / 10000);
    let cursor = 0;
    for (const itemKind of eligible) {
      cursor += ITEM_WEIGHTS[itemKind];
      if (weightedRoll < cursor) return itemKind;
    }
    return eligible[eligible.length - 1];
  }

  function selectItemKind(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'currentStreak', 'spawnedCounts'], 'INVALID_BATTLE_ITEM_SELECTION_INPUT');
    const streak = safeInteger(dataValue(identity.descriptors, 'currentStreak'), 'INVALID_BATTLE_ITEM_SELECTION_INPUT');
    const counts = dataValue(identity.descriptors, 'spawnedCounts');
    return selectItemKindForRoll(rollBasisPoints({
      runId: identity.runId,
      matchOrdinal: identity.matchOrdinal,
      spawnOrdinal: identity.spawnOrdinal,
      label: KIND_RNG_LABEL
    }), streak, counts);
  }

  function canAttemptSpawn(input) {
    const descriptors = exactData(input, ['turn', 'activeCount', 'spawnedCount', 'lastResolvedTurn'], 'INVALID_BATTLE_ITEM_SPAWN_TIMING');
    const turn = safeInteger(dataValue(descriptors, 'turn'), 'INVALID_BATTLE_ITEM_SPAWN_TIMING');
    const activeCount = safeInteger(dataValue(descriptors, 'activeCount'), 'INVALID_BATTLE_ITEM_SPAWN_TIMING');
    const spawnedCount = safeInteger(dataValue(descriptors, 'spawnedCount'), 'INVALID_BATTLE_ITEM_SPAWN_TIMING');
    const last = dataValue(descriptors, 'lastResolvedTurn');
    if (last !== null) {
      safeInteger(last, 'INVALID_BATTLE_ITEM_SPAWN_TIMING');
      if (last > turn) fail('INVALID_BATTLE_ITEM_SPAWN_TIMING');
    }
    if (turn < SPAWN_RULES.initialTurn || turn >= SPAWN_RULES.cutoffTurn
      || activeCount >= SPAWN_RULES.maxActive || spawnedCount >= SPAWN_RULES.maxPerMatch) return false;
    return last === null || turn - last >= SPAWN_RULES.cooldownTurns;
  }

  function readPoint(value, code, integerOnly) {
    const descriptors = exactData(value, ['x', 'y'], code);
    const validate = integerOnly ? safeInteger : finiteNumber;
    return { x: validate(dataValue(descriptors, 'x'), code), y: validate(dataValue(descriptors, 'y'), code) };
  }

  function validateSpawnPointInput(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'stageWidth', 'candidates', 'unitPositions'], 'INVALID_BATTLE_ITEM_SPAWN_POINT_INPUT');
    const stageWidth = safeInteger(dataValue(identity.descriptors, 'stageWidth'), 'INVALID_BATTLE_ITEM_SPAWN_POINT_INPUT', 1);
    const rawCandidates = dataValue(identity.descriptors, 'candidates');
    const rawUnits = dataValue(identity.descriptors, 'unitPositions');
    if (!Array.isArray(rawCandidates) || !Array.isArray(rawUnits) || rawUnits.length !== 2) fail('INVALID_BATTLE_ITEM_SPAWN_POINT_INPUT');
    const candidates = rawCandidates.map((point) => readPoint(point, 'INVALID_BATTLE_ITEM_SPAWN_POINT_INPUT', true));
    const unitPositions = rawUnits.map((point) => readPoint(point, 'INVALID_BATTLE_ITEM_SPAWN_POINT_INPUT', true));
    return { ...identity, stageWidth, candidates, unitPositions };
  }

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function eligibleSpawnPoints(input) {
    const parsed = validateSpawnPointInput(input);
    const [firstUnit, secondUnit] = parsed.unitPositions;
    const accepted = parsed.candidates.filter((point) => {
      if (point.x < SPAWN_RULES.edgeMargin || parsed.stageWidth - point.x < SPAWN_RULES.edgeMargin) return false;
      const firstDistance = distance(point, firstUnit);
      const secondDistance = distance(point, secondUnit);
      return firstDistance >= SPAWN_RULES.unitClearance
        && secondDistance >= SPAWN_RULES.unitClearance
        && Math.abs(firstDistance - secondDistance) <= SPAWN_RULES.fairnessTolerance;
    });
    accepted.sort((left, right) => left.x - right.x || left.y - right.y);
    return Object.freeze(accepted.map(freezePoint));
  }

  function chooseSpawnPoint(input) {
    const parsed = validateSpawnPointInput(input);
    const eligible = eligibleSpawnPoints(input);
    if (eligible.length === 0) return null;
    const roll = rollBasisPoints({
      runId: parsed.runId,
      matchOrdinal: parsed.matchOrdinal,
      spawnOrdinal: parsed.spawnOrdinal,
      label: POSITION_RNG_LABEL
    });
    const chosen = eligible[Math.floor((roll * eligible.length) / 10000)];
    return freezePoint(chosen);
  }

  function segmentCircleSweep(input) {
    const descriptors = exactData(input, ['from', 'to', 'center', 'radius'], 'INVALID_BATTLE_ITEM_SWEEP_INPUT');
    const from = readPoint(dataValue(descriptors, 'from'), 'INVALID_BATTLE_ITEM_SWEEP_INPUT', false);
    const to = readPoint(dataValue(descriptors, 'to'), 'INVALID_BATTLE_ITEM_SWEEP_INPUT', false);
    const center = readPoint(dataValue(descriptors, 'center'), 'INVALID_BATTLE_ITEM_SWEEP_INPUT', false);
    const radius = finiteNumber(dataValue(descriptors, 'radius'), 'INVALID_BATTLE_ITEM_SWEEP_INPUT');
    if (radius < 0) fail('INVALID_BATTLE_ITEM_SWEEP_INPUT');
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const fx = from.x - center.x;
    const fy = from.y - center.y;
    const radiusSquared = radius * radius;
    if ((fx * fx) + (fy * fy) <= radiusSquared) return Object.freeze({ hit: true, time: 0, point: freezePoint(from) });
    const a = (dx * dx) + (dy * dy);
    if (a === 0) return Object.freeze({ hit: false, time: null, point: null });
    const b = 2 * ((fx * dx) + (fy * dy));
    const c = (fx * fx) + (fy * fy) - radiusSquared;
    const discriminant = (b * b) - (4 * a * c);
    if (discriminant < 0) return Object.freeze({ hit: false, time: null, point: null });
    const root = Math.sqrt(Math.max(0, discriminant));
    const first = (-b - root) / (2 * a);
    const second = (-b + root) / (2 * a);
    const time = first >= 0 && first <= 1 ? first : (second >= 0 && second <= 1 ? second : null);
    if (time === null) return Object.freeze({ hit: false, time: null, point: null });
    return Object.freeze({ hit: true, time, point: freezePoint({ x: from.x + (dx * time), y: from.y + (dy * time) }) });
  }

  function validateSpawnState(raw) {
    const descriptors = exactData(raw, SPAWN_STATE_KEYS, 'INVALID_BATTLE_ITEM_SPAWN_STATE');
    const version = dataValue(descriptors, 'schemaVersion');
    if (version !== SPAWN_STATE_SCHEMA_VERSION) {
      if (Number.isSafeInteger(version) && version > SPAWN_STATE_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_BATTLE_ITEM_SPAWN_STATE_VERSION');
      fail('UNSUPPORTED_BATTLE_ITEM_SPAWN_STATE_VERSION');
    }
    const state = {
      schemaVersion: version,
      itemId: dataValue(descriptors, 'itemId'),
      runId: runId(dataValue(descriptors, 'runId'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      matchOrdinal: safeInteger(dataValue(descriptors, 'matchOrdinal'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      spawnOrdinal: safeInteger(dataValue(descriptors, 'spawnOrdinal'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      kind: kind(dataValue(descriptors, 'kind'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      x: safeInteger(dataValue(descriptors, 'x'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      y: safeInteger(dataValue(descriptors, 'y'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      spawnTurn: safeInteger(dataValue(descriptors, 'spawnTurn'), 'INVALID_BATTLE_ITEM_SPAWN_STATE'),
      expiresTurn: safeInteger(dataValue(descriptors, 'expiresTurn'), 'INVALID_BATTLE_ITEM_SPAWN_STATE')
    };
    if (typeof state.itemId !== 'string'
      || state.expiresTurn !== state.spawnTurn + SPAWN_RULES.lifetimeTurns
      || !Number.isSafeInteger(state.expiresTurn)
      || state.itemId !== createItemId({ runId: state.runId, matchOrdinal: state.matchOrdinal, spawnOrdinal: state.spawnOrdinal, kind: state.kind })) {
      fail('INVALID_BATTLE_ITEM_SPAWN_STATE');
    }
    return Object.freeze(state);
  }

  function createSpawnState(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'kind', 'x', 'y', 'spawnTurn'], 'INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    const itemKind = kind(dataValue(identity.descriptors, 'kind'), 'INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    const x = safeInteger(dataValue(identity.descriptors, 'x'), 'INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    const y = safeInteger(dataValue(identity.descriptors, 'y'), 'INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    const spawnTurn = safeInteger(dataValue(identity.descriptors, 'spawnTurn'), 'INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    const expiresTurn = spawnTurn + SPAWN_RULES.lifetimeTurns;
    if (!Number.isSafeInteger(expiresTurn)) fail('INVALID_BATTLE_ITEM_SPAWN_STATE_INPUT');
    return validateSpawnState({
      schemaVersion: SPAWN_STATE_SCHEMA_VERSION,
      itemId: createItemId({ runId: identity.runId, matchOrdinal: identity.matchOrdinal, spawnOrdinal: identity.spawnOrdinal, kind: itemKind }),
      runId: identity.runId,
      matchOrdinal: identity.matchOrdinal,
      spawnOrdinal: identity.spawnOrdinal,
      kind: itemKind,
      x,
      y,
      spawnTurn,
      expiresTurn
    });
  }

  const serializeSpawnState = (state) => JSON.stringify(validateSpawnState(state));
  function parseSpawnState(text) {
    if (typeof text !== 'string') fail('INVALID_BATTLE_ITEM_SPAWN_STATE');
    let raw;
    try { raw = JSON.parse(text); } catch (error) { fail('INVALID_BATTLE_ITEM_SPAWN_STATE', error.message); }
    return validateSpawnState(raw);
  }

  function validateUnit(value) {
    const descriptors = exactData(value, ['hp', 'maxHp', 'specialCharge'], 'INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const unit = {
      hp: safeInteger(dataValue(descriptors, 'hp'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT'),
      maxHp: safeInteger(dataValue(descriptors, 'maxHp'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT', 1),
      specialCharge: safeInteger(dataValue(descriptors, 'specialCharge'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT')
    };
    if (unit.hp > unit.maxHp || unit.specialCharge > 4) fail('INVALID_BATTLE_ITEM_PICKUP_INPUT');
    return unit;
  }

  function validateResources(value) {
    const descriptors = exactData(value, ['boxesCollected', 'powder', 'blueprintShards'], 'INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const resources = {
      boxesCollected: safeInteger(dataValue(descriptors, 'boxesCollected'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT'),
      powder: safeInteger(dataValue(descriptors, 'powder'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT'),
      blueprintShards: safeInteger(dataValue(descriptors, 'blueprintShards'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT')
    };
    if (resources.boxesCollected > RESOURCE_RULES.maxBoxesPerRun || resources.blueprintShards > RESOURCE_RULES.maxShardsPerRun) fail('INVALID_BATTLE_ITEM_PICKUP_INPUT');
    return resources;
  }

  function pickupResult(values) {
    return Object.freeze({
      consumed: values.consumed,
      reason: values.reason,
      unit: freezeUnit(values.unit),
      resources: freezeResources(values.resources),
      healed: values.healed || 0,
      chargeAdded: values.chargeAdded || 0,
      powderGranted: values.powderGranted || 0,
      shardGranted: values.shardGranted || 0
    });
  }

  function applyPickupEffect(input) {
    const identity = validateIdentityValues(input, ['runId', 'matchOrdinal', 'spawnOrdinal', 'kind', 'collectorType', 'unit', 'resources'], 'INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const itemKind = kind(dataValue(identity.descriptors, 'kind'), 'INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const collectorType = dataValue(identity.descriptors, 'collectorType');
    if (collectorType !== 'player' && collectorType !== 'cpu') fail('INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const unit = validateUnit(dataValue(identity.descriptors, 'unit'));
    const resources = validateResources(dataValue(identity.descriptors, 'resources'));
    const base = { unit, resources, healed: 0, chargeAdded: 0, powderGranted: 0, shardGranted: 0 };
    if (itemKind === 'healing') {
      if (unit.hp === 0) return pickupResult({ ...base, consumed: false, reason: 'knocked-out' });
      if (unit.hp === unit.maxHp) return pickupResult({ ...base, consumed: false, reason: 'full-health' });
      const healed = Math.min(Math.ceil(unit.maxHp * 0.2), unit.maxHp - unit.hp);
      return pickupResult({ ...base, consumed: true, reason: 'healed', healed, unit: { ...unit, hp: unit.hp + healed } });
    }
    if (itemKind === 'special_charge') {
      if (unit.specialCharge >= 4) return pickupResult({ ...base, consumed: false, reason: 'full-charge' });
      return pickupResult({ ...base, consumed: true, reason: 'charged', chargeAdded: 1, unit: { ...unit, specialCharge: unit.specialCharge + 1 } });
    }
    if (collectorType === 'cpu') return pickupResult({ ...base, consumed: true, reason: 'cpu-collected' });
    if (resources.boxesCollected >= RESOURCE_RULES.maxBoxesPerRun) return pickupResult({ ...base, consumed: true, reason: 'resource-cap' });
    if (!Number.isSafeInteger(resources.powder + RESOURCE_RULES.powderPerBox)) fail('INVALID_BATTLE_ITEM_PICKUP_INPUT');
    const shardGranted = resources.blueprintShards < RESOURCE_RULES.maxShardsPerRun
      && rollBasisPoints({ runId: identity.runId, matchOrdinal: identity.matchOrdinal, spawnOrdinal: identity.spawnOrdinal, label: RESOURCE_SHARD_RNG_LABEL }) < RESOURCE_RULES.shardChanceBasisPoints ? 1 : 0;
    return pickupResult({
      ...base,
      consumed: true,
      reason: 'resource-collected',
      powderGranted: RESOURCE_RULES.powderPerBox,
      shardGranted,
      resources: {
        boxesCollected: resources.boxesCollected + 1,
        powder: resources.powder + RESOURCE_RULES.powderPerBox,
        blueprintShards: resources.blueprintShards + shardGranted
      }
    });
  }

  return Object.freeze({
    SPAWN_STATE_SCHEMA_VERSION,
    BATTLE_ITEM_RNG_VERSION,
    BATTLE_ITEM_RNG_NAMESPACE,
    BATTLE_ITEM_RNG_HASH_ALGORITHM,
    KIND_RNG_LABEL,
    POSITION_RNG_LABEL,
    RESOURCE_SHARD_RNG_LABEL,
    ITEM_KINDS,
    ITEM_WEIGHTS,
    MATCH_CAPS,
    SPAWN_RULES,
    RESOURCE_RULES,
    StageBattleItemError,
    canonicalRngKey,
    rollBasisPoints,
    createItemId,
    isEligibleBattleMode,
    selectItemKindForRoll,
    selectItemKind,
    canAttemptSpawn,
    eligibleSpawnPoints,
    chooseSpawnPoint,
    segmentCircleSweep,
    createSpawnState,
    validateSpawnState,
    serializeSpawnState,
    parseSpawnState,
    applyPickupEffect
  });
});
