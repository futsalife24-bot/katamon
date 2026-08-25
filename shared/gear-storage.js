(function initKatamonGearStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearStorage(root) {
  'use strict';

  // Phase 2A deliberately owns only the persistence envelope.  It does not
  // decide rewards, inventory routing, expiry, transactions, or battle rules.
  const GEAR_STORAGE_KEY = 'katamon_gear_v1';
  // The storage key stays v1 for compatibility.  The envelope itself is
  // independently versioned so Phase 2B can add a permanent reward tombstone
  // without changing the browser key.
  const GEAR_STORAGE_SCHEMA_VERSION = 2;
  const GEAR_REVEAL_STORAGE_KEY = 'katamon_gear_reveal_v1';
  const GEAR_REVEAL_SCHEMA_VERSION = 1;
  const MAIN_INVENTORY_CAPACITY = 500;
  const TEMP_BOX_CAPACITY = 50;
  const UNCLAIMED_REWARD_CAPACITY = 10;
  const MAX_GEARS_PER_REWARD = 5;
  const COOP_BOSS_MAX_GEARS_PER_REWARD = 3;
  const TEMP_BOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const REVEAL_LEVELS = Object.freeze([3, 6, 9, 12]);

  class GearStorageError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'GearStorageError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  const fail = (code, message, cause) => { throw new GearStorageError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  const assertNonEmptyString = (value, path) => {
    if (typeof value !== 'string' || value.length === 0) fail('INVALID_STRING', `${path} must be a non-empty string`);
    return value;
  };
  const assertNonNegativeSafeInteger = (value, path) => {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_NON_NEGATIVE_SAFE_INTEGER', `${path} must be a non-negative safe integer`);
    return value;
  };
  const assertStrictBoolean = (value, path) => {
    if (typeof value !== 'boolean') fail('INVALID_BOOLEAN', `${path} must be a boolean`);
    return value;
  };
  const defineData = (target, key, value) => {
    // Assignment to __proto__ is an inherited setter on ordinary objects.
    // Defining an own data property preserves every legal JSON key safely.
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  };
  const assertOwnDataProperties = (value, path, code = 'INVALID_STORAGE_PROPERTY') => {
    Reflect.ownKeys(value).forEach((key) => {
      if (typeof key !== 'string') fail(code, `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail(code, `${path}.${key} must be an enumerable data property`);
      }
    });
  };
  const assertDensePlainArray = (value, path, code = 'INVALID_STORAGE_ARRAY') => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code, `${path} must be an ordinary array`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.configurable || !hasOwn(lengthDescriptor, 'value') || !lengthDescriptor.writable) {
      fail(code, `${path}.length must be the ordinary array length property`);
    }
    const length = lengthDescriptor.value;
    const seenIndexes = new Set();
    Reflect.ownKeys(value).forEach((key) => {
      if (key === 'length') return;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
        fail(code, `${path} must not contain holes, symbols, or extra properties`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail(code, `${path}[${key}] must be an enumerable data property`);
      }
      seenIndexes.add(Number(key));
    });
    if (seenIndexes.size !== length) fail(code, `${path} must not contain holes`);
    return length;
  };
  const assertExactKeys = (value, keys, path) => {
    if (!isPlainRecord(value)) fail('INVALID_RECORD', `${path} must be a plain object`);
    assertOwnDataProperties(value, path);
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      fail('UNKNOWN_STORAGE_FIELD', `${path} must contain exactly: ${expected.join(', ')}`);
    }
  };

  // This is intentionally separate from GearDomain.stableStringify. Storage
  // accepts generic JSON-like sourceDetail data, whereas GearDomain controls
  // all gear-rule serialization and deterministic generation.
  function cloneJsonLike(value, path = 'value', seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('INVALID_JSON_DATA', `${path} must not contain NaN or Infinity`);
      return value;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) fail('CYCLIC_JSON_DATA', `${path} must not be cyclic`);
      seen.add(value);
      const length = assertDensePlainArray(value, path, 'INVALID_JSON_ARRAY');
      const result = Array.from({ length }, (_, index) => cloneJsonLike(value[index], `${path}[${index}]`, seen));
      seen.delete(value);
      return result;
    }
    if (isPlainRecord(value)) {
      if (seen.has(value)) fail('CYCLIC_JSON_DATA', `${path} must not be cyclic`);
      seen.add(value);
      const result = {};
      assertOwnDataProperties(value, path, 'INVALID_JSON_DATA');
      Object.keys(value).sort().forEach((key) => { defineData(result, key, cloneJsonLike(value[key], `${path}.${key}`, seen)); });
      seen.delete(value);
      return result;
    }
    fail('INVALID_JSON_DATA', `${path} must be JSON-like data`);
  }
  const stableJsonStringify = (value) => JSON.stringify(cloneJsonLike(value));

  function resolveGearDomain() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      // eslint-disable-next-line global-require
      return require('./gear-domain.js');
    }
    if (root && root.KatamonGearDomain) return root.KatamonGearDomain;
    fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be available before using gear storage');
  }

  function validateStoredGear(rawGear, path) {
    // Detect cyclic/non-JSON direct-save input before domain validation can
    // recurse through caller data. JSON-loaded data already satisfies this.
    const jsonSafeGear = cloneJsonLike(rawGear, path);
    // generationSeed is intentionally not part of a persisted Phase 1 gear.
    // Do not silently strip it: accepting it would create two competing
    // persistence contracts and could leak acquisition randomness later.
    if (hasOwn(jsonSafeGear, 'generationSeed')) fail('FORBIDDEN_GENERATION_SEED', `${path} must not persist generationSeed`);
    const domain = resolveGearDomain();
    let validated;
    try {
      validated = domain.validateGear(jsonSafeGear);
    } catch (error) {
      fail('INVALID_STORED_GEAR', `${path} failed gear-domain validation: ${error && error.code ? error.code : 'unknown'}`, error);
    }
    // GearDomain is the single owner of the gear object contract.  Comparing
    // its canonical validated result prevents this layer from silently
    // dropping any extra or non-canonical field while avoiding a duplicate
    // hand-written gear schema here.
    if (stableJsonStringify(jsonSafeGear) !== stableJsonStringify(validated)) {
      fail('NON_CANONICAL_STORED_GEAR', `${path} contains fields or values outside the canonical gear object`);
    }
    return validated;
  }

  function validateEntry(rawEntry, path, temporary) {
    const keys = temporary ? ['gear', 'locked', 'favorite', 'enteredAtMs'] : ['gear', 'locked', 'favorite'];
    assertExactKeys(rawEntry, keys, path);
    const entry = {
      gear: validateStoredGear(rawEntry.gear, `${path}.gear`),
      locked: assertStrictBoolean(rawEntry.locked, `${path}.locked`),
      favorite: assertStrictBoolean(rawEntry.favorite, `${path}.favorite`),
    };
    if (temporary) entry.enteredAtMs = assertNonNegativeSafeInteger(rawEntry.enteredAtMs, `${path}.enteredAtMs`);
    return entry;
  }

  function rewardGearLimit(sourceId) {
    return sourceId === 'coop_boss' ? COOP_BOSS_MAX_GEARS_PER_REWARD : MAX_GEARS_PER_REWARD;
  }

  function validateReward(rawReward, path, enforceCurrentGearCap = true) {
    assertExactKeys(rawReward, ['rewardId', 'sourceId', 'sourceDetail', 'createdAtMs', 'gears', 'blueprintShards'], path);
    if (!Array.isArray(rawReward.gears)) fail('INVALID_REWARD_GEARS', `${path}.gears must be an array`);
    assertDensePlainArray(rawReward.gears, `${path}.gears`);
    const sourceId = assertNonEmptyString(rawReward.sourceId, `${path}.sourceId`);
    const gearLimit = rewardGearLimit(sourceId);
    if (enforceCurrentGearCap && rawReward.gears.length > gearLimit) {
      fail('REWARD_GEAR_CAP_EXCEEDED', `${path}.gears exceeds the ${gearLimit} gear cap for ${sourceId}`);
    }
    return {
      rewardId: assertNonEmptyString(rawReward.rewardId, `${path}.rewardId`),
      sourceId,
      sourceDetail: cloneJsonLike(rawReward.sourceDetail, `${path}.sourceDetail`),
      createdAtMs: assertNonNegativeSafeInteger(rawReward.createdAtMs, `${path}.createdAtMs`),
      gears: rawReward.gears.map((gear, index) => validateStoredGear(gear, `${path}.gears[${index}]`)),
      blueprintShards: assertNonNegativeSafeInteger(rawReward.blueprintShards, `${path}.blueprintShards`),
    };
  }

  function validateGlobalIds(state) {
    const seenGearIds = new Set();
    const registerGear = (gear, path) => {
      if (seenGearIds.has(gear.gearId)) fail('DUPLICATE_GEAR_ID', `${path} repeats gearId ${gear.gearId}`);
      seenGearIds.add(gear.gearId);
    };
    state.inventory.forEach((entry, index) => registerGear(entry.gear, `inventory[${index}].gear`));
    state.tempBox.forEach((entry, index) => registerGear(entry.gear, `tempBox[${index}].gear`));
    state.unclaimedRewards.forEach((reward, rewardIndex) => reward.gears.forEach((gear, gearIndex) => registerGear(gear, `unclaimedRewards[${rewardIndex}].gears[${gearIndex}]`)));
    const rewardIds = new Set();
    state.unclaimedRewards.forEach((reward, index) => {
      if (rewardIds.has(reward.rewardId)) fail('DUPLICATE_REWARD_ID', `unclaimedRewards[${index}] repeats rewardId ${reward.rewardId}`);
      rewardIds.add(reward.rewardId);
    });
    Object.keys(state.rewardLedger || {}).forEach((rewardId) => {
      if (rewardIds.has(rewardId)) fail('REWARD_LEDGER_PENDING_CONFLICT', `rewardLedger and unclaimedRewards both contain rewardId ${rewardId}`);
    });
  }

  function validateV1GearStorageState(rawState) {
    assertExactKeys(rawState, ['storageSchemaVersion', 'inventory', 'tempBox', 'unclaimedRewards', 'resources'], 'gear storage state');
    if (rawState.storageSchemaVersion !== 1) fail('UNSUPPORTED_STORAGE_VERSION', 'gear storage state is not v1');
    if (!Array.isArray(rawState.inventory)) fail('INVALID_INVENTORY', 'inventory must be an array');
    if (!Array.isArray(rawState.tempBox)) fail('INVALID_TEMP_BOX', 'tempBox must be an array');
    if (!Array.isArray(rawState.unclaimedRewards)) fail('INVALID_UNCLAIMED_REWARDS', 'unclaimedRewards must be an array');
    assertDensePlainArray(rawState.inventory, 'inventory');
    assertDensePlainArray(rawState.tempBox, 'tempBox');
    assertDensePlainArray(rawState.unclaimedRewards, 'unclaimedRewards');
    if (rawState.inventory.length > MAIN_INVENTORY_CAPACITY) fail('INVENTORY_CAPACITY_EXCEEDED', 'inventory exceeds capacity');
    if (rawState.tempBox.length > TEMP_BOX_CAPACITY) fail('TEMP_BOX_CAPACITY_EXCEEDED', 'tempBox exceeds capacity');
    if (rawState.unclaimedRewards.length > UNCLAIMED_REWARD_CAPACITY) fail('UNCLAIMED_REWARD_CAPACITY_EXCEEDED', 'unclaimed rewards exceed capacity');
    assertExactKeys(rawState.resources, ['powder', 'blueprintShards'], 'resources');
    const state = {
      storageSchemaVersion: 1,
      inventory: rawState.inventory.map((entry, index) => validateEntry(entry, `inventory[${index}]`, false)),
      tempBox: rawState.tempBox.map((entry, index) => validateEntry(entry, `tempBox[${index}]`, true)),
      // Phase 2A v1 had no per-reward Gear cap. Validate that historical
      // envelope exactly as it was defined, then apply the approved v2
      // compatibility boundary explicitly in migrateV1ToV2().
      unclaimedRewards: rawState.unclaimedRewards.map((reward, index) => validateReward(reward, `unclaimedRewards[${index}]`, false)),
      resources: {
        powder: assertNonNegativeSafeInteger(rawState.resources.powder, 'resources.powder'),
        blueprintShards: assertNonNegativeSafeInteger(rawState.resources.blueprintShards, 'resources.blueprintShards'),
      },
    };
    validateGlobalIds(state);
    return state;
  }

  function validateRewardLedger(rawLedger) {
    if (!isPlainRecord(rawLedger)) fail('INVALID_REWARD_LEDGER', 'rewardLedger must be a plain object');
    assertOwnDataProperties(rawLedger, 'rewardLedger');
    const rewardLedger = {};
    Object.keys(rawLedger).sort().forEach((rewardId) => {
      assertNonEmptyString(rewardId, 'rewardLedger key');
      if (rawLedger[rewardId] !== true) fail('INVALID_REWARD_LEDGER_VALUE', `rewardLedger.${rewardId} must be true`);
      defineData(rewardLedger, rewardId, true);
    });
    return rewardLedger;
  }

  function validateV2GearStorageState(rawState) {
    assertExactKeys(rawState, ['storageSchemaVersion', 'inventory', 'tempBox', 'unclaimedRewards', 'rewardLedger', 'resources'], 'gear storage state');
    if (rawState.storageSchemaVersion !== 2) fail('UNSUPPORTED_STORAGE_VERSION', 'gear storage state is not v2');
    if (!Array.isArray(rawState.inventory)) fail('INVALID_INVENTORY', 'inventory must be an array');
    if (!Array.isArray(rawState.tempBox)) fail('INVALID_TEMP_BOX', 'tempBox must be an array');
    if (!Array.isArray(rawState.unclaimedRewards)) fail('INVALID_UNCLAIMED_REWARDS', 'unclaimedRewards must be an array');
    assertDensePlainArray(rawState.inventory, 'inventory');
    assertDensePlainArray(rawState.tempBox, 'tempBox');
    assertDensePlainArray(rawState.unclaimedRewards, 'unclaimedRewards');
    if (rawState.inventory.length > MAIN_INVENTORY_CAPACITY) fail('INVENTORY_CAPACITY_EXCEEDED', 'inventory exceeds capacity');
    if (rawState.tempBox.length > TEMP_BOX_CAPACITY) fail('TEMP_BOX_CAPACITY_EXCEEDED', 'tempBox exceeds capacity');
    if (rawState.unclaimedRewards.length > UNCLAIMED_REWARD_CAPACITY) fail('UNCLAIMED_REWARD_CAPACITY_EXCEEDED', 'unclaimed rewards exceed capacity');
    assertExactKeys(rawState.resources, ['powder', 'blueprintShards'], 'resources');
    const state = {
      storageSchemaVersion: 2,
      inventory: rawState.inventory.map((entry, index) => validateEntry(entry, `inventory[${index}]`, false)),
      tempBox: rawState.tempBox.map((entry, index) => validateEntry(entry, `tempBox[${index}]`, true)),
      unclaimedRewards: rawState.unclaimedRewards.map((reward, index) => validateReward(reward, `unclaimedRewards[${index}]`)),
      rewardLedger: validateRewardLedger(rawState.rewardLedger),
      resources: {
        powder: assertNonNegativeSafeInteger(rawState.resources.powder, 'resources.powder'),
        blueprintShards: assertNonNegativeSafeInteger(rawState.resources.blueprintShards, 'resources.blueprintShards'),
      },
    };
    validateGlobalIds(state);
    return state;
  }

  function migrateV1ToV2(rawState) {
    // Validate the complete old envelope before adding anything.  Migration is
    // deliberately structural only: it neither repairs gear nor loses rewards.
    const validatedV1 = validateV1GearStorageState(rawState);
    validatedV1.unclaimedRewards.forEach((reward) => {
      const limit = rewardGearLimit(reward.sourceId);
      if (reward.gears.length > limit) {
        fail('UNSUPPORTED_V1_REWARD_SHAPE', `v1 reward ${reward.rewardId} exceeds the v2 ${limit}-Gear limit for ${reward.sourceId}`);
      }
    });
    return {
      storageSchemaVersion: 2,
      inventory: validatedV1.inventory,
      tempBox: validatedV1.tempBox,
      unclaimedRewards: validatedV1.unclaimedRewards,
      rewardLedger: {},
      resources: validatedV1.resources,
    };
  }

  function migrateGearStorageState(rawState) {
    if (!isPlainRecord(rawState)) fail('INVALID_STORAGE_STATE', 'gear storage state must be a plain object');
    assertOwnDataProperties(rawState, 'gear storage state');
    if (!hasOwn(rawState, 'storageSchemaVersion')) fail('MISSING_STORAGE_SCHEMA_VERSION', 'gear storage schema version is required');
    if (!Number.isSafeInteger(rawState.storageSchemaVersion)) fail('INVALID_STORAGE_SCHEMA_VERSION', 'gear storage schema version must be a safe integer');
    if (rawState.storageSchemaVersion > GEAR_STORAGE_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_STORAGE_VERSION', 'gear storage is newer than this client');
    if (rawState.storageSchemaVersion < 1) fail('UNSUPPORTED_STORAGE_VERSION', 'gear storage migration is not available for this version');
    if (rawState.storageSchemaVersion === 1) return migrateV1ToV2(rawState);
    if (rawState.storageSchemaVersion === 2) return validateV2GearStorageState(rawState);
    fail('UNSUPPORTED_STORAGE_VERSION', 'gear storage migration is not available for this version');
  }

  function createDefaultGearStorageState() {
    return {
      storageSchemaVersion: GEAR_STORAGE_SCHEMA_VERSION,
      inventory: [],
      tempBox: [],
      unclaimedRewards: [],
      rewardLedger: {},
      resources: { powder: 0, blueprintShards: 0 },
    };
  }

  function validateRevealHistoryState(rawState) {
    assertExactKeys(rawState, ['schemaVersion', 'viewedThroughLevelByGearId'], 'gear reveal history');
    if (rawState.schemaVersion !== GEAR_REVEAL_SCHEMA_VERSION) fail('UNSUPPORTED_REVEAL_STORAGE_VERSION', 'gear reveal history is not v1');
    if (!isPlainRecord(rawState.viewedThroughLevelByGearId)) fail('INVALID_REVEAL_HISTORY', 'viewedThroughLevelByGearId must be a plain object');
    assertOwnDataProperties(rawState.viewedThroughLevelByGearId, 'viewedThroughLevelByGearId');
    const result = {};
    Object.keys(rawState.viewedThroughLevelByGearId).sort().forEach((gearId) => {
      assertNonEmptyString(gearId, 'viewedThroughLevelByGearId key');
      const level = rawState.viewedThroughLevelByGearId[gearId];
      if (!REVEAL_LEVELS.includes(level)) fail('INVALID_REVEAL_LEVEL', `reveal level for ${gearId} must be 3, 6, 9, or 12`);
      defineData(result, gearId, level);
    });
    return { schemaVersion: GEAR_REVEAL_SCHEMA_VERSION, viewedThroughLevelByGearId: result };
  }

  function migrateRevealHistoryState(rawState) {
    if (!isPlainRecord(rawState)) fail('INVALID_REVEAL_STORAGE_STATE', 'gear reveal history must be a plain object');
    assertOwnDataProperties(rawState, 'gear reveal history');
    if (!hasOwn(rawState, 'schemaVersion')) fail('MISSING_REVEAL_STORAGE_SCHEMA_VERSION', 'gear reveal history schema version is required');
    if (!Number.isSafeInteger(rawState.schemaVersion)) fail('INVALID_REVEAL_STORAGE_SCHEMA_VERSION', 'gear reveal history schema version must be a safe integer');
    if (rawState.schemaVersion > GEAR_REVEAL_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_REVEAL_STORAGE_VERSION', 'gear reveal history is newer than this client');
    if (rawState.schemaVersion < GEAR_REVEAL_SCHEMA_VERSION) fail('UNSUPPORTED_REVEAL_STORAGE_VERSION', 'gear reveal history migration is not available for this version');
    return validateRevealHistoryState(rawState);
  }

  function createDefaultRevealHistoryState() {
    return { schemaVersion: GEAR_REVEAL_SCHEMA_VERSION, viewedThroughLevelByGearId: {} };
  }

  const encodeGearStorageState = (state) => stableJsonStringify(migrateGearStorageState(state));
  const encodeRevealHistoryState = (state) => stableJsonStringify(migrateRevealHistoryState(state));
  function decodeStorageJson(raw, migrate, kind) {
    if (typeof raw !== 'string') fail('INVALID_STORAGE_VALUE', `${kind} storage value must be a string`);
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { fail('STORAGE_JSON_PARSE_FAILED', `${kind} storage JSON is malformed`, error); }
    return migrate(parsed);
  }
  const decodeGearStorageState = (raw) => decodeStorageJson(raw, migrateGearStorageState, 'gear');
  const decodeRevealHistoryState = (raw) => decodeStorageJson(raw, migrateRevealHistoryState, 'reveal');

  function resolveStorage(storage, requiredMethod) {
    let resolved = storage;
    if (resolved === undefined) {
      try { resolved = root && root.localStorage; } catch (error) { fail('STORAGE_UNAVAILABLE', 'localStorage is unavailable', error); }
    }
    if (!resolved || typeof resolved[requiredMethod] !== 'function') fail('STORAGE_UNAVAILABLE', `storage.${requiredMethod} is unavailable`);
    return resolved;
  }
  function loadState(storage, key, createDefault, decode) {
    const resolved = resolveStorage(storage, 'getItem');
    let raw;
    try { raw = resolved.getItem(key); } catch (error) { fail('STORAGE_READ_FAILED', `could not read ${key}`, error); }
    if (raw === null) return createDefault();
    return decode(raw);
  }
  function saveState(state, storage, key, encode) {
    const resolved = resolveStorage(storage, 'setItem');
    if (typeof resolved.getItem !== 'function') fail('STORAGE_UNAVAILABLE', 'storage.getItem is unavailable for read-back verification');
    const encoded = encode(state); // validate and serialize before any write
    try { resolved.setItem(key, encoded); } catch (error) { fail('STORAGE_WRITE_FAILED', `could not write ${key}`, error); }
    let readBack;
    try { readBack = resolved.getItem(key); } catch (error) { fail('STORAGE_READ_BACK_FAILED', `could not verify ${key}`, error); }
    if (readBack !== encoded) fail('STORAGE_READ_BACK_MISMATCH', `read-back verification failed for ${key}`);
    return decodeStorageJson(encoded, key === GEAR_STORAGE_KEY ? migrateGearStorageState : migrateRevealHistoryState, key === GEAR_STORAGE_KEY ? 'gear' : 'reveal');
  }
  const loadGearState = (storage) => loadState(storage, GEAR_STORAGE_KEY, createDefaultGearStorageState, decodeGearStorageState);
  const saveGearState = (state, storage) => saveState(state, storage, GEAR_STORAGE_KEY, encodeGearStorageState);
  const loadRevealHistory = (storage) => loadState(storage, GEAR_REVEAL_STORAGE_KEY, createDefaultRevealHistoryState, decodeRevealHistoryState);
  const saveRevealHistory = (state, storage) => saveState(state, storage, GEAR_REVEAL_STORAGE_KEY, encodeRevealHistoryState);
  const estimateSerializedSize = (serialized) => {
    if (typeof serialized !== 'string') fail('INVALID_SERIALIZED_VALUE', 'serialized value must be a string');
    return { chars: serialized.length, utf16Bytes: serialized.length * 2 };
  };

  return Object.freeze({
    GearStorageError,
    GEAR_STORAGE_KEY, GEAR_STORAGE_SCHEMA_VERSION, GEAR_REVEAL_STORAGE_KEY, GEAR_REVEAL_SCHEMA_VERSION,
    MAIN_INVENTORY_CAPACITY, TEMP_BOX_CAPACITY, UNCLAIMED_REWARD_CAPACITY, MAX_GEARS_PER_REWARD, COOP_BOSS_MAX_GEARS_PER_REWARD, TEMP_BOX_TTL_MS, REVEAL_LEVELS,
    createDefaultGearStorageState, createDefaultRevealHistoryState,
    migrateGearStorageState, migrateRevealHistoryState, validateGearStorageState: migrateGearStorageState, validateRevealHistoryState,
    encodeGearStorageState, decodeGearStorageState, encodeRevealHistoryState, decodeRevealHistoryState,
    loadGearState, saveGearState, loadRevealHistory, saveRevealHistory, estimateSerializedSize,
  });
});
