(function initKatamonGearWeekdayDungeonStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearWeekdayDungeonStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearWeekdayDungeonStorage(root) {
  'use strict';
  const WEEKDAY_DUNGEON_STORAGE_KEY = 'katamon_gear_weekday_dungeon_v1';
  const WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION = 1;
  const WEEKDAY_DUNGEON_LOCK_NAME = 'katamon_gear_weekday_dungeon_v1:mutation';
  class GearWeekdayDungeonStorageError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearWeekdayDungeonStorageError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearWeekdayDungeonStorageError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function exactKeys(value, keys, path) {
    if (!isPlainRecord(value)) fail('INVALID_WEEKDAY_DUNGEON_STATE', `${path} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) { if (typeof key !== 'string') fail('INVALID_WEEKDAY_DUNGEON_STATE', `${path} must not contain symbol properties`); const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !d.enumerable || !hasOwn(d, 'value')) fail('INVALID_WEEKDAY_DUNGEON_STATE', `${path}.${key} must be an enumerable data property`); }
    const actual = Object.keys(value).sort(), expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) fail('UNKNOWN_WEEKDAY_DUNGEON_STATE_FIELD', `${path} has unknown or missing fields`);
  }
  function domain() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-weekday-dungeon.js');
    if (root && root.KatamonGearWeekdayDungeon) return root.KatamonGearWeekdayDungeon;
    fail('WEEKDAY_DUNGEON_DOMAIN_UNAVAILABLE', 'KatamonGearWeekdayDungeon must be loaded first');
  }
  function gearStorage() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-storage.js');
    if (root && root.KatamonGearStorage) return root.KatamonGearStorage;
    fail('WEEKDAY_DUNGEON_GEAR_STORAGE_UNAVAILABLE', 'KatamonGearStorage must be loaded before a weekday reward can be marked queued');
  }
  function createWeekdayDungeonState() { return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION, maxConsumedDayIndex: -1, activeAttempt: null }); }
  function validateWeekdayDungeonState(rawState) {
    exactKeys(rawState, ['schemaVersion', 'maxConsumedDayIndex', 'activeAttempt'], 'weekday dungeon state');
    if (Number.isSafeInteger(rawState.schemaVersion) && rawState.schemaVersion > WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_STORAGE_VERSION', 'weekday dungeon state is newer than this client');
    if (rawState.schemaVersion !== WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION) fail('UNSUPPORTED_WEEKDAY_DUNGEON_STORAGE_VERSION', 'weekday dungeon state version is unsupported');
    if (!Number.isSafeInteger(rawState.maxConsumedDayIndex) || rawState.maxConsumedDayIndex < -1) fail('INVALID_WEEKDAY_DUNGEON_STATE', 'maxConsumedDayIndex must be >= -1');
    if (rawState.activeAttempt === null) return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION, maxConsumedDayIndex: rawState.maxConsumedDayIndex, activeAttempt: null });
    let attempt; try { attempt = domain().validateAttempt(rawState.activeAttempt); } catch (error) { fail(error && error.code ? error.code : 'INVALID_WEEKDAY_DUNGEON_STATE', error && error.message, error); }
    if (attempt.dayIndex !== rawState.maxConsumedDayIndex) fail('WEEKDAY_DUNGEON_STATE_ATTEMPT_MISMATCH', 'active attempt must equal the consumed day');
    return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION, maxConsumedDayIndex: rawState.maxConsumedDayIndex, activeAttempt: attempt });
  }
  function encodeWeekdayDungeonState(state) { return JSON.stringify(validateWeekdayDungeonState(state)); }
  function loadWeekdayDungeonState(storage) {
    if (!storage || typeof storage.getItem !== 'function') fail('WEEKDAY_DUNGEON_STORAGE_UNAVAILABLE', 'storage.getItem is required');
    let raw; try { raw = storage.getItem(WEEKDAY_DUNGEON_STORAGE_KEY); } catch (error) { fail('WEEKDAY_DUNGEON_STORAGE_READ_FAILED', 'could not read weekday dungeon storage', error); }
    if (raw === null) return createWeekdayDungeonState();
    if (typeof raw !== 'string') fail('INVALID_WEEKDAY_DUNGEON_STORAGE', 'weekday dungeon storage must be text');
    try { return validateWeekdayDungeonState(JSON.parse(raw)); } catch (error) { if (error && error.code) throw error; fail('INVALID_WEEKDAY_DUNGEON_STORAGE', 'weekday dungeon storage is malformed', error); }
  }
  function saveWeekdayDungeonState(state, storage) {
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') fail('WEEKDAY_DUNGEON_STORAGE_UNAVAILABLE', 'storage read/write methods are required');
    const checked = validateWeekdayDungeonState(state); const encoded = JSON.stringify(checked);
    let previousRaw;
    try { previousRaw = storage.getItem(WEEKDAY_DUNGEON_STORAGE_KEY); } catch (error) { fail('WEEKDAY_DUNGEON_STORAGE_READ_FAILED', 'could not capture prior weekday dungeon storage', error); }
    if (previousRaw !== null && typeof previousRaw !== 'string') fail('INVALID_WEEKDAY_DUNGEON_STORAGE', 'prior weekday dungeon storage must be text');
    try { storage.setItem(WEEKDAY_DUNGEON_STORAGE_KEY, encoded); } catch (error) { fail('WEEKDAY_DUNGEON_STORAGE_WRITE_FAILED', 'could not write weekday dungeon storage', error); }
    let readBack; let readBackError = null;
    try { readBack = storage.getItem(WEEKDAY_DUNGEON_STORAGE_KEY); } catch (error) { readBackError = error; }
    if (readBackError || readBack !== encoded) {
      let restored = false;
      try {
        if (previousRaw === null) {
          if (typeof storage.removeItem !== 'function') throw new Error('storage.removeItem is required to restore an empty value');
          storage.removeItem(WEEKDAY_DUNGEON_STORAGE_KEY);
        } else storage.setItem(WEEKDAY_DUNGEON_STORAGE_KEY, previousRaw);
        restored = storage.getItem(WEEKDAY_DUNGEON_STORAGE_KEY) === previousRaw;
      } catch (_rollbackError) { restored = false; }
      if (!restored) fail('WEEKDAY_DUNGEON_STORAGE_AMBIGUOUS_WRITE', 'weekday dungeon write could not be read back or safely rolled back', readBackError);
      if (readBackError) fail('WEEKDAY_DUNGEON_STORAGE_READ_BACK_FAILED', 'could not verify weekday dungeon storage', readBackError);
      fail('WEEKDAY_DUNGEON_STORAGE_READ_BACK_MISMATCH', 'weekday dungeon read-back verification failed');
    }
    return checked;
  }
  function resolveLocks(options) {
    if (options && hasOwn(options, 'lockManager')) {
      const explicit = options.lockManager;
      if (explicit && typeof explicit.request === 'function') return explicit;
      fail('WEEKDAY_DUNGEON_LOCK_UNAVAILABLE', 'an explicit weekday dungeon lock manager is unavailable');
    }
    let manager;
    try { manager = root && root.navigator && root.navigator.locks; } catch (error) { fail('WEEKDAY_DUNGEON_LOCK_UNAVAILABLE', 'weekday dungeon lock is unavailable', error); }
    if (!manager || typeof manager.request !== 'function') fail('WEEKDAY_DUNGEON_LOCK_UNAVAILABLE', 'Web Locks are required for weekday dungeon persistence');
    return manager;
  }
  function withWeekdayDungeonLock(operation, options) {
    if (typeof operation !== 'function') fail('INVALID_WEEKDAY_DUNGEON_OPERATION', 'operation must be a function');
    const manager = resolveLocks(options);
    let callbackStarted = false;
    const callback = (lock) => {
      callbackStarted = true;
      if (lock === null || (typeof lock !== 'object' && typeof lock !== 'function')) fail('WEEKDAY_DUNGEON_LOCK_INVALID_HANDLE', 'Web Lock callback must receive a non-null lock object');
      return operation(lock);
    };
    try {
      const result = manager.request(WEEKDAY_DUNGEON_LOCK_NAME, { mode: 'exclusive' }, callback);
      return Promise.resolve(result).then((value) => {
        if (!callbackStarted) fail('WEEKDAY_DUNGEON_LOCK_CALLBACK_NOT_EXECUTED', 'Web Lock request resolved without executing its callback');
        return value;
      }, (error) => {
        if (callbackStarted) throw error;
        fail('WEEKDAY_DUNGEON_LOCK_REQUEST_FAILED', 'weekday dungeon Web Lock request was rejected', error);
      });
    } catch (error) {
      if (callbackStarted) throw error;
      fail('WEEKDAY_DUNGEON_LOCK_REQUEST_FAILED', 'weekday dungeon Web Lock request failed', error);
    }
  }
  function assertCommitOptions(options) {
    if (!isPlainRecord(options)) fail('INVALID_WEEKDAY_DUNGEON_COMMIT_OPTIONS', 'commit options must be a plain object');
    for (const key of Reflect.ownKeys(options)) {
      if (typeof key !== 'string') fail('INVALID_WEEKDAY_DUNGEON_COMMIT_OPTIONS', 'commit options must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('INVALID_WEEKDAY_DUNGEON_COMMIT_OPTIONS', `commit options.${key} must be an enumerable data property`);
    }
    if (!hasOwn(options, 'nowMs') || !Number.isSafeInteger(options.nowMs) || options.nowMs < 0) fail('INVALID_WEEKDAY_DUNGEON_COMMIT_OPTIONS', 'commit options.nowMs must be a non-negative safe integer');
    return options.nowMs;
  }
  async function commitAttempt(rawAttempt, storage, options) {
    const attempt = domain().validateAttempt(rawAttempt);
    const nowMs = assertCommitOptions(options);
    return withWeekdayDungeonLock(() => {
      const firingDay = domain().getDayInfo({ nowMs });
      if (firingDay.dayIndex !== attempt.dayIndex) fail('WEEKDAY_DUNGEON_FIRE_DAY_MISMATCH', 'attempt must be committed on its own JST day');
      const current = loadWeekdayDungeonState(storage);
      if (current.activeAttempt && current.activeAttempt.phase === 'fired' && current.activeAttempt.attemptId !== attempt.attemptId) {
        fail('WEEKDAY_DUNGEON_RECOVERY_REQUIRED', 'the prior fired weekday dungeon attempt must be recovered before a new attempt');
      }
      if (attempt.dayIndex <= current.maxConsumedDayIndex) {
        if (current.activeAttempt && current.activeAttempt.attemptId === attempt.attemptId) return Object.freeze({ state: current, committed: false, attempt: current.activeAttempt });
        fail('WEEKDAY_DUNGEON_ALREADY_CONSUMED', 'a weekday dungeon attempt was already consumed for this or a later day');
      }
      const fired = domain().validateAttempt({ ...attempt, phase: 'fired' });
      const next = saveWeekdayDungeonState({ schemaVersion: WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION, maxConsumedDayIndex: fired.dayIndex, activeAttempt: fired }, storage);
      return Object.freeze({ state: next, committed: true, attempt: fired });
    }, options);
  }
  async function markQueued(rawAttempt, storage, options) {
    const attempt = domain().validateAttempt(rawAttempt);
    return withWeekdayDungeonLock(() => {
      const current = loadWeekdayDungeonState(storage);
      if (!current.activeAttempt || current.activeAttempt.attemptId !== attempt.attemptId || current.activeAttempt.dayIndex !== attempt.dayIndex) fail('WEEKDAY_DUNGEON_ACTIVE_ATTEMPT_MISSING', 'only the durable active attempt can be queued');
      if (current.activeAttempt.phase === 'queued') return Object.freeze({ state: current, marked: false, attempt: current.activeAttempt });
      let durableGearState;
      try { durableGearState = gearStorage().loadGearState(storage); } catch (error) { fail('WEEKDAY_DUNGEON_REWARD_DURABILITY_UNVERIFIABLE', 'could not verify weekday reward durability in Gear storage', error); }
      const rewardIsPending = durableGearState.unclaimedRewards.some((reward) => reward.rewardId === current.activeAttempt.rewardId);
      const rewardIsLedgered = durableGearState.rewardLedger && durableGearState.rewardLedger[current.activeAttempt.rewardId] === true;
      if (!rewardIsPending && !rewardIsLedgered) fail('WEEKDAY_DUNGEON_REWARD_NOT_DURABLE', 'weekday reward is neither pending nor ledgered in Gear storage');
      const queued = domain().validateAttempt({ ...current.activeAttempt, phase: 'queued' });
      const next = saveWeekdayDungeonState({ ...current, activeAttempt: queued }, storage);
      return Object.freeze({ state: next, marked: true, attempt: queued });
    }, options);
  }
  return Object.freeze({ GearWeekdayDungeonStorageError, WEEKDAY_DUNGEON_STORAGE_KEY, WEEKDAY_DUNGEON_STORAGE_SCHEMA_VERSION, WEEKDAY_DUNGEON_LOCK_NAME, createWeekdayDungeonState, validateWeekdayDungeonState, encodeWeekdayDungeonState, loadWeekdayDungeonState, saveWeekdayDungeonState, withWeekdayDungeonLock, commitAttempt, markQueued });
});
