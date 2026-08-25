(function initKatamonGearCpuRunStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearCpuRunStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearCpuRunStorage(root) {
  'use strict';

  // This is deliberately separate from katamon_suspend_v1.  The legacy key
  // remains the battle snapshot; this key owns only a CPU reward run identity,
  // its peak, and a durable settlement entitlement.
  const CPU_GEAR_RUN_STORAGE_KEY = 'katamon_cpu_gear_run_v1';
  const CPU_GEAR_RUN_SCHEMA_VERSION = 1;
  // This lock owns the small CPU run identity/peak/intent state plus the
  // legacy CPU suspend lifecycle that is coupled to it.  It is intentionally
  // separate from the Gear Storage lock: settlement releases this lock before
  // it calls the Phase 2B reward queue writer, preventing cross-lock re-entry.
  const CPU_GEAR_RUN_LOCK_NAME = 'katamon_cpu_gear_run_v1:mutation';
  const ACTIVE = 'active';
  const SETTLEMENT_PENDING = 'settlement_pending';
  const RUN_ID_RE = /^cpu-run:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const OWNER_SESSION_ID_RE = /^cpu-session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SNAPSHOT_ID_RE = /^cpu-snapshot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  class CpuGearRunStorageError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'CpuGearRunStorageError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }
  const fail = (code, message, cause) => { throw new CpuGearRunStorageError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function assertExactDataKeys(value, keys, path) {
    if (!isPlainRecord(value)) fail('INVALID_CPU_GEAR_RUN_STATE', `${path} must be a plain object`);
    const own = Reflect.ownKeys(value);
    own.forEach((key) => {
      if (typeof key !== 'string') fail('INVALID_CPU_GEAR_RUN_STATE', `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail('INVALID_CPU_GEAR_RUN_STATE', `${path}.${key} must be an enumerable data property`);
      }
    });
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      fail('UNKNOWN_CPU_GEAR_RUN_FIELD', `${path} has unknown or missing fields`);
    }
  }
  function assertPeak(value, path = 'peakStreak') {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_CPU_GEAR_RUN_PEAK', `${path} must be a non-negative safe integer`);
    return value;
  }
  function assertRunId(value) {
    if (typeof value !== 'string' || !RUN_ID_RE.test(value)) {
      fail('INVALID_CPU_GEAR_RUN_ID', 'runId must be a crypto UUID prefixed with cpu-run:');
    }
    return value;
  }
  function assertOwnerSessionId(value) {
    // null is accepted only for a pre-fencing active record.  The browser
    // bridge claims it under the CPU lifecycle lock before the run can mutate;
    // this keeps an unshipped/local pre-release record recoverable without
    // silently inventing an owner at decode time.
    if (value === null) return null;
    if (typeof value !== 'string' || !OWNER_SESSION_ID_RE.test(value)) {
      fail('INVALID_CPU_GEAR_OWNER_SESSION_ID', 'ownerSessionId must be a crypto UUID prefixed with cpu-session: or null');
    }
    return value;
  }
  function assertSnapshotId(value) {
    if (typeof value !== 'string' || !SNAPSHOT_ID_RE.test(value)) {
      fail('INVALID_CPU_GEAR_SNAPSHOT_ID', 'snapshotId must be a crypto UUID prefixed with cpu-snapshot:');
    }
    return value;
  }
  function cloneResumeClaim(value) {
    if (value === null) return null;
    assertExactDataKeys(value, ['sourceOwnerSessionId', 'targetOwnerSessionId', 'snapshotId', 'targetSnapshotId'], 'cpu gear resume claim');
    const sourceOwnerSessionId = assertOwnerSessionId(value.sourceOwnerSessionId);
    const targetOwnerSessionId = assertOwnerSessionId(value.targetOwnerSessionId);
    if (targetOwnerSessionId === null) {
      fail('INVALID_CPU_GEAR_RESUME_CLAIM', 'resume claim target owner must be present');
    }
    return {
      sourceOwnerSessionId,
      targetOwnerSessionId,
      snapshotId: assertSnapshotId(value.snapshotId),
      // A successful rebind rotates the legacy snapshot identity.  This makes
      // two tabs that observed the old bytes mutually exclusive while still
      // leaving the rebound snapshot available for crash recovery.
      targetSnapshotId: assertSnapshotId(value.targetSnapshotId),
    };
  }
  function resolveCpuRewards() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-cpu-rewards.js');
    if (root && root.KatamonGearCpuRewards) return root.KatamonGearCpuRewards;
    fail('CPU_GEAR_REWARDS_UNAVAILABLE', 'KatamonGearCpuRewards must be loaded before CPU run state validation');
  }
  function cloneIntent(intent) {
    const api = resolveCpuRewards();
    try { return api.validateCpuSettlementIntent(intent); } catch (error) {
      fail(error && error.code ? error.code : 'INVALID_CPU_SETTLEMENT_INTENT', error && error.message, error);
    }
  }

  function validateCpuGearRunState(rawState) {
    assertExactDataKeys(rawState, ['schemaVersion', 'runId', 'state', 'peakStreak', 'ownerSessionId', 'resumeClaim', 'settlementIntent'], 'cpu gear run state');
    if (rawState.schemaVersion !== CPU_GEAR_RUN_SCHEMA_VERSION) {
      if (Number.isSafeInteger(rawState.schemaVersion) && rawState.schemaVersion > CPU_GEAR_RUN_SCHEMA_VERSION) {
        fail('UNSUPPORTED_FUTURE_CPU_GEAR_RUN_VERSION', 'CPU gear run state is newer than this client');
      }
      fail('UNSUPPORTED_CPU_GEAR_RUN_VERSION', 'CPU gear run state version is unsupported');
    }
    const runId = assertRunId(rawState.runId);
    const peakStreak = assertPeak(rawState.peakStreak);
    const ownerSessionId = assertOwnerSessionId(rawState.ownerSessionId);
    const resumeClaim = cloneResumeClaim(rawState.resumeClaim);
    if (rawState.state !== ACTIVE && rawState.state !== SETTLEMENT_PENDING) {
      fail('INVALID_CPU_GEAR_RUN_STATUS', 'CPU gear run state must be active or settlement_pending');
    }
    if (rawState.state === ACTIVE) {
      if (rawState.settlementIntent !== null) fail('INVALID_CPU_GEAR_RUN_STATE', 'an active run must not contain a settlement intent');
      return { schemaVersion: CPU_GEAR_RUN_SCHEMA_VERSION, runId, state: ACTIVE, peakStreak, ownerSessionId, resumeClaim, settlementIntent: null };
    }
    if (resumeClaim !== null) fail('INVALID_CPU_GEAR_RUN_STATE', 'a pending settlement must not contain a resume claim');
    const settlementIntent = cloneIntent(rawState.settlementIntent);
    if (settlementIntent.runId !== runId || settlementIntent.peakStreak !== peakStreak) {
      fail('CPU_GEAR_RUN_INTENT_MISMATCH', 'settlement intent must match the saved run identity and peak');
    }
    return { schemaVersion: CPU_GEAR_RUN_SCHEMA_VERSION, runId, state: SETTLEMENT_PENDING, peakStreak, ownerSessionId, resumeClaim: null, settlementIntent };
  }

  function createActiveCpuGearRun(runId, peakStreak = 0, ownerSessionId = null) {
    return validateCpuGearRunState({
      schemaVersion: CPU_GEAR_RUN_SCHEMA_VERSION,
      runId,
      state: ACTIVE,
      peakStreak,
      ownerSessionId,
      resumeClaim: null,
      settlementIntent: null,
    });
  }
  function withPeakStreak(rawState, candidatePeakStreak) {
    const state = validateCpuGearRunState(rawState);
    if (state.state !== ACTIVE) fail('CPU_GEAR_SETTLEMENT_PENDING', 'a pending settlement must be resolved before changing the run peak');
    return validateCpuGearRunState({
      ...state,
      peakStreak: Math.max(state.peakStreak, assertPeak(candidatePeakStreak, 'candidatePeakStreak')),
    });
  }
  function withOwnerSessionId(rawState, ownerSessionId) {
    const state = validateCpuGearRunState(rawState);
    if (state.resumeClaim !== null) fail('CPU_GEAR_RESUME_CLAIM_PENDING', 'complete the pending resume claim before changing the owner');
    const owner = assertOwnerSessionId(ownerSessionId);
    if (owner === null) fail('INVALID_CPU_GEAR_OWNER_SESSION_ID', 'ownerSessionId cannot be cleared by a lifecycle mutation');
    return validateCpuGearRunState({ ...state, ownerSessionId: owner });
  }
  function withResumeClaim(rawState, rawClaim) {
    const state = validateCpuGearRunState(rawState);
    if (state.state !== ACTIVE) fail('CPU_GEAR_RESUME_CLAIM_INVALID_STATE', 'only an active run may have a resume claim');
    const claim = cloneResumeClaim(rawClaim);
    if (claim === null) fail('INVALID_CPU_GEAR_RESUME_CLAIM', 'resume claim must be present');
    if (state.resumeClaim !== null) {
      if (state.resumeClaim.sourceOwnerSessionId !== claim.sourceOwnerSessionId
          || state.resumeClaim.snapshotId !== claim.snapshotId) {
        fail('CPU_GEAR_RESUME_CLAIM_CONFLICT', 'resume claim belongs to a different snapshot');
      }
    }
    return validateCpuGearRunState({ ...state, resumeClaim: claim });
  }
  function withResumeClaimOwner(rawState, ownerSessionId) {
    const state = validateCpuGearRunState(rawState);
    const owner = assertOwnerSessionId(ownerSessionId);
    if (state.state !== ACTIVE || state.resumeClaim === null || owner === null
        || state.resumeClaim.targetOwnerSessionId !== owner) {
      fail('CPU_GEAR_RESUME_CLAIM_CONFLICT', 'resume claim owner transition is invalid');
    }
    return validateCpuGearRunState({ ...state, ownerSessionId: owner });
  }
  function completeResumeClaim(rawState, ownerSessionId) {
    const state = validateCpuGearRunState(rawState);
    const owner = assertOwnerSessionId(ownerSessionId);
    if (state.state !== ACTIVE || state.resumeClaim === null || owner === null
        || state.ownerSessionId !== owner || state.resumeClaim.targetOwnerSessionId !== owner) {
      fail('CPU_GEAR_RESUME_CLAIM_CONFLICT', 'resume claim completion is invalid');
    }
    return validateCpuGearRunState({ ...state, resumeClaim: null });
  }
  function withSettlementIntent(rawState, rawIntent) {
    const state = validateCpuGearRunState(rawState);
    if (state.state === SETTLEMENT_PENDING) {
      const incoming = cloneIntent(rawIntent);
      if (JSON.stringify(incoming) !== JSON.stringify(state.settlementIntent)) {
        fail('CPU_GEAR_SETTLEMENT_CONFLICT', 'the pending settlement intent does not match this retry');
      }
      return state;
    }
    const settlementIntent = cloneIntent(rawIntent);
    if (settlementIntent.runId !== state.runId || settlementIntent.peakStreak !== state.peakStreak) {
      fail('CPU_GEAR_RUN_INTENT_MISMATCH', 'settlement intent does not belong to the active run');
    }
    return validateCpuGearRunState({ ...state, state: SETTLEMENT_PENDING, settlementIntent });
  }

  function resolveStorage(storage, method) {
    let target = storage;
    if (target === undefined) {
      try { target = root && root.localStorage; } catch (error) { fail('CPU_GEAR_RUN_STORAGE_UNAVAILABLE', 'localStorage is unavailable', error); }
    }
    if (!target || typeof target[method] !== 'function') fail('CPU_GEAR_RUN_STORAGE_UNAVAILABLE', `storage.${method} is unavailable`);
    return target;
  }
  function resolveLockManager(options) {
    const explicit = options && options.lockManager;
    if (explicit && typeof explicit.request === 'function') return explicit;
    let browserLocks;
    try { browserLocks = root && root.navigator && root.navigator.locks; } catch (error) {
      fail('CPU_GEAR_RUN_LOCK_UNAVAILABLE', 'CPU gear run lock is unavailable', error);
    }
    if (!browserLocks || typeof browserLocks.request !== 'function') {
      fail('CPU_GEAR_RUN_LOCK_UNAVAILABLE', 'Web Locks are required for CPU Gear run persistence');
    }
    return browserLocks;
  }
  function withCpuGearRunLock(operation, options) {
    if (typeof operation !== 'function') fail('INVALID_CPU_GEAR_RUN_LOCK_OPERATION', 'CPU gear run lock operation must be a function');
    const lockManager = resolveLockManager(options);
    let callbackStarted = false;
    const wrappedOperation = (lock) => {
      callbackStarted = true;
      return operation(lock);
    };
    try {
      const result = lockManager.request(CPU_GEAR_RUN_LOCK_NAME, { mode: 'exclusive' }, wrappedOperation);
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          if (callbackStarted) throw error;
          fail('CPU_GEAR_RUN_LOCK_UNAVAILABLE', 'could not acquire CPU gear run lock', error);
        });
      }
      return result;
    } catch (error) {
      if (callbackStarted) throw error;
      fail('CPU_GEAR_RUN_LOCK_UNAVAILABLE', 'could not acquire CPU gear run lock', error);
    }
  }
  function encodeCpuGearRunState(state) { return JSON.stringify(validateCpuGearRunState(state)); }
  function decodeCpuGearRunState(raw) {
    if (typeof raw !== 'string' || raw.length === 0) fail('CPU_GEAR_RUN_JSON_PARSE_FAILED', 'CPU gear run storage is malformed');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { fail('CPU_GEAR_RUN_JSON_PARSE_FAILED', 'CPU gear run storage JSON is malformed', error); }
    return validateCpuGearRunState(parsed);
  }
  function loadCpuGearRunState(storage) {
    const target = resolveStorage(storage, 'getItem');
    let raw;
    try { raw = target.getItem(CPU_GEAR_RUN_STORAGE_KEY); } catch (error) { fail('CPU_GEAR_RUN_STORAGE_READ_FAILED', 'could not read CPU gear run storage', error); }
    return raw === null ? null : decodeCpuGearRunState(raw);
  }
  function saveCpuGearRunState(state, storage) {
    const target = resolveStorage(storage, 'setItem');
    if (typeof target.getItem !== 'function') fail('CPU_GEAR_RUN_STORAGE_UNAVAILABLE', 'storage.getItem is required for read-back verification');
    const encoded = encodeCpuGearRunState(state);
    try { target.setItem(CPU_GEAR_RUN_STORAGE_KEY, encoded); } catch (error) { fail('CPU_GEAR_RUN_STORAGE_WRITE_FAILED', 'could not write CPU gear run storage', error); }
    let readBack;
    try { readBack = target.getItem(CPU_GEAR_RUN_STORAGE_KEY); } catch (error) { fail('CPU_GEAR_RUN_STORAGE_READ_BACK_FAILED', 'could not verify CPU gear run storage', error); }
    if (readBack !== encoded) fail('CPU_GEAR_RUN_STORAGE_READ_BACK_MISMATCH', 'CPU gear run read-back verification failed');
    return decodeCpuGearRunState(encoded);
  }
  function removeCpuGearRunState(storage) {
    const target = resolveStorage(storage, 'removeItem');
    if (typeof target.getItem !== 'function') fail('CPU_GEAR_RUN_STORAGE_UNAVAILABLE', 'storage.getItem is required for removal verification');
    try { target.removeItem(CPU_GEAR_RUN_STORAGE_KEY); } catch (error) { fail('CPU_GEAR_RUN_STORAGE_CLEANUP_FAILED', 'could not remove CPU gear run storage', error); }
    let readBack;
    try { readBack = target.getItem(CPU_GEAR_RUN_STORAGE_KEY); } catch (error) { fail('CPU_GEAR_RUN_STORAGE_CLEANUP_FAILED', 'could not verify CPU gear run storage removal', error); }
    if (readBack !== null) fail('CPU_GEAR_RUN_STORAGE_CLEANUP_FAILED', 'CPU gear run storage remains after removal');
    return true;
  }

  function createCryptoUuid(prefix, unavailableCode, label) {
    let cryptoApi;
    try { cryptoApi = root && root.crypto; } catch (error) { fail(unavailableCode, 'crypto API is unavailable', error); }
    if (!cryptoApi || typeof cryptoApi.randomUUID !== 'function') {
      fail(unavailableCode, `crypto.randomUUID is required for ${label}`);
    }
    let uuid;
    try { uuid = cryptoApi.randomUUID(); } catch (error) { fail(unavailableCode, `could not generate a cryptographic ${label}`, error); }
    return `${prefix}:${uuid}`;
  }
  function createCryptoRunId() {
    return assertRunId(createCryptoUuid('cpu-run', 'CPU_RUN_ID_UNAVAILABLE', 'CPU gear run identity'));
  }
  function createCryptoOwnerSessionId() {
    return assertOwnerSessionId(createCryptoUuid('cpu-session', 'CPU_OWNER_SESSION_UNAVAILABLE', 'CPU Gear owner session'));
  }
  function createCryptoSnapshotId() {
    return assertSnapshotId(createCryptoUuid('cpu-snapshot', 'CPU_SNAPSHOT_ID_UNAVAILABLE', 'CPU Gear suspend snapshot'));
  }

  return Object.freeze({
    CpuGearRunStorageError,
    CPU_GEAR_RUN_STORAGE_KEY, CPU_GEAR_RUN_SCHEMA_VERSION, CPU_GEAR_RUN_LOCK_NAME, ACTIVE, SETTLEMENT_PENDING,
    createCryptoRunId, createCryptoOwnerSessionId, createCryptoSnapshotId, createActiveCpuGearRun,
    withPeakStreak, withOwnerSessionId, withResumeClaim, withResumeClaimOwner, completeResumeClaim, withSettlementIntent,
    validateCpuGearRunState, encodeCpuGearRunState, decodeCpuGearRunState,
    loadCpuGearRunState, saveCpuGearRunState, removeCpuGearRunState, withCpuGearRunLock,
  });
});
