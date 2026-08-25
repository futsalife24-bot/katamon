(function initKatamonGearRewards(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearRewards(root) {
  'use strict';

  const MAX_GEARS_PER_REWARD = 5;
  // Every persistence wrapper uses this one namespace.  Web Locks are shared
  // between tabs of the same origin, so a load -> pure operation -> save is
  // one critical section instead of a lost-update window.
  const GEAR_MUTATION_LOCK_NAME = 'katamon_gear_v1:mutation';

  class GearRewardsError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'GearRewardsError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }
  const fail = (code, message, cause) => { throw new GearRewardsError(code, message, cause); };
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
  const assertNow = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_NOW_MS', 'nowMs must be a non-negative safe integer');
    return value;
  };
  const addSafe = (left, right, path) => {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
      fail('INTEGER_OVERFLOW', `${path} exceeds the safe integer range`);
    }
    return left + right;
  };

  function resolveStorageApi() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-storage.js');
    if (root && root.KatamonGearStorage) return root.KatamonGearStorage;
    fail('GEAR_STORAGE_UNAVAILABLE', 'KatamonGearStorage must be available before using gear rewards');
  }
  function resolveDomain() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js');
    if (root && root.KatamonGearDomain) return root.KatamonGearDomain;
    fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be available before using gear rewards');
  }
  function canonicalState(rawState) {
    const api = resolveStorageApi();
    try { return api.validateGearStorageState(rawState); } catch (error) {
      fail(error && error.code ? error.code : 'INVALID_GEAR_STORAGE_STATE', error && error.message, error);
    }
  }
  function canonicalReward(rawReward) {
    // Validate a reward through its real storage schema rather than keeping a
    // second, looser schema in the business module.
    const api = resolveStorageApi();
    const probe = api.createDefaultGearStorageState();
    probe.unclaimedRewards = [rawReward];
    const checked = canonicalState(probe);
    return checked.unclaimedRewards[0];
  }
  function stableJson(value) {
    // All caller data passes storage validation first. Its canonical clones
    // are ordinary JSON data, so this comparison neither invokes getters nor
    // accepts sparse/prototype-polluted input.
    return JSON.stringify(value);
  }
  function rewardCanonicalEquals(left, right) {
    return stableJson(left) === stableJson(right);
  }
  function assertV2Ledger(state) {
    if (!isPlainRecord(state.rewardLedger)) fail('INVALID_REWARD_LEDGER', 'rewardLedger must be a plain object');
    return state.rewardLedger;
  }
  function ledgerHas(ledger, rewardId) { return hasOwn(ledger, rewardId) && ledger[rewardId] === true; }
  function cloneLedgerWith(ledger, rewardId) {
    const result = {};
    Object.keys(ledger).sort().forEach((key) => { Object.defineProperty(result, key, { value: ledger[key], enumerable: true, writable: true, configurable: true }); });
    Object.defineProperty(result, rewardId, { value: true, enumerable: true, writable: true, configurable: true });
    return result;
  }
  function findPending(state, rewardId) { return state.unclaimedRewards.find((reward) => reward.rewardId === rewardId) || null; }
  function readIncomingRewardId(rawReward) {
    if (!isPlainRecord(rawReward)) fail('INVALID_REWARD', 'reward must be a plain object');
    const descriptor = Object.getOwnPropertyDescriptor(rawReward, 'rewardId');
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('INVALID_REWARD', 'reward.rewardId must be an enumerable data property');
    return assertNonEmptyString(descriptor.value, 'reward.rewardId');
  }
  function gearIdsInState(state) {
    const ids = new Set();
    state.inventory.forEach((entry) => ids.add(entry.gear.gearId));
    state.tempBox.forEach((entry) => ids.add(entry.gear.gearId));
    state.unclaimedRewards.forEach((reward) => reward.gears.forEach((gear) => ids.add(gear.gearId)));
    return ids;
  }
  function validateIncomingAgainstState(state, reward) {
    const ids = gearIdsInState(state);
    for (const gear of reward.gears) {
      if (ids.has(gear.gearId)) fail('DUPLICATE_GEAR_ID', `reward repeats existing gearId ${gear.gearId}`);
      ids.add(gear.gearId);
    }
  }

  function queueUnclaimedReward(rawState, rawReward) {
    const state = canonicalState(rawState);
    const ledger = assertV2Ledger(state);
    const incomingRewardId = readIncomingRewardId(rawReward);
    // A completed tombstone wins before inspecting retry payload content.  A
    // caller may retry after an ambiguous read-back with only stale metadata;
    // re-validating it must never turn an already-complete reward into work.
    if (ledgerHas(ledger, incomingRewardId)) return { nextState: state, duplicateProcessed: true, duplicatePending: false, queued: false };
    const reward = canonicalReward(rawReward);
    const existing = findPending(state, reward.rewardId);
    if (existing) {
      if (rewardCanonicalEquals(existing, reward)) return { nextState: state, duplicateProcessed: false, duplicatePending: true, queued: false };
      fail('REWARD_ID_CONFLICT', `rewardId ${reward.rewardId} has different pending content`);
    }
    if (state.unclaimedRewards.length >= resolveStorageApi().UNCLAIMED_REWARD_CAPACITY) fail('UNCLAIMED_REWARD_CAPACITY_EXCEEDED', 'unclaimed reward capacity is full');
    validateIncomingAgainstState(state, reward);
    const nextState = canonicalState({ ...state, unclaimedRewards: [...state.unclaimedRewards, reward] });
    return { nextState, duplicateProcessed: false, duplicatePending: false, queued: true };
  }

  function isExpired(entry, nowMs, ttl) {
    return nowMs >= entry.enteredAtMs && nowMs - entry.enteredAtMs >= ttl;
  }
  function runStorageMaintenance(rawState, nowMs) {
    const state = canonicalState(rawState);
    const now = assertNow(nowMs);
    const api = resolveStorageApi();
    const domain = resolveDomain();
    let powder = state.resources.powder;
    let blueprintShards = state.resources.blueprintShards;
    const expiredGearIds = [];
    const survivors = [];
    let powderGained = 0;
    let blueprintShardsGained = 0;
    state.tempBox.forEach((entry) => {
      if (!isExpired(entry, now, api.TEMP_BOX_TTL_MS)) { survivors.push(entry); return; }
      let yieldValue;
      try { yieldValue = domain.calculateDismantleYield(entry.gear); } catch (error) {
        fail(error && error.code ? error.code : 'INVALID_DISMANTLE_YIELD', 'could not calculate expiry dismantle yield', error);
      }
      powder = addSafe(powder, yieldValue.powder, 'resources.powder');
      blueprintShards = addSafe(blueprintShards, yieldValue.blueprintShards, 'resources.blueprintShards');
      powderGained = addSafe(powderGained, yieldValue.powder, 'powderGained');
      blueprintShardsGained = addSafe(blueprintShardsGained, yieldValue.blueprintShards, 'blueprintShardsGained');
      expiredGearIds.push(entry.gear.gearId);
    });
    // Array#index remains the documented tie-break after the stable enteredAt
    // sort.  No incidental gearId ordering can change who is promoted first.
    const ordered = survivors.map((entry, index) => ({ entry, index })).sort((left, right) => {
      if (left.entry.enteredAtMs < right.entry.enteredAtMs) return -1;
      if (left.entry.enteredAtMs > right.entry.enteredAtMs) return 1;
      return left.index - right.index;
    });
    const inventory = [...state.inventory];
    const movedGearIds = [];
    const movedIndexes = new Set();
    ordered.forEach(({ entry, index }) => {
      if (inventory.length < api.MAIN_INVENTORY_CAPACITY) {
        inventory.push({ gear: entry.gear, locked: entry.locked, favorite: entry.favorite });
        movedGearIds.push(entry.gear.gearId);
        movedIndexes.add(index);
      }
    });
    // Keep every non-promoted entry in its existing TEMP BOX order. Ordering
    // only selects promotion candidates; it does not silently reorder storage.
    const remainingTemp = survivors.filter((_entry, index) => !movedIndexes.has(index));
    const nextState = canonicalState({
      ...state,
      inventory,
      tempBox: remainingTemp,
      resources: { powder, blueprintShards },
    });
    return { nextState, expiredGearIds, movedGearIds, powderGained, blueprintShardsGained };
  }

  function claimUnclaimedReward(rawState, rewardId, nowMs) {
    const state = canonicalState(rawState);
    const id = assertNonEmptyString(rewardId, 'rewardId');
    const now = assertNow(nowMs);
    const ledger = assertV2Ledger(state);
    if (ledgerHas(ledger, id)) return { nextState: state, duplicate: true, claimed: false, expiredGearIds: [], movedGearIds: [] };
    const reward = findPending(state, id);
    if (!reward) fail('REWARD_NOT_FOUND', `rewardId ${id} is neither pending nor processed`);
    const maintenance = runStorageMaintenance(state, now);
    const maintained = maintenance.nextState;
    // Validation made the reward's gears globally unique; remove it before
    // placement so its own ids do not look like a collision.
    const pendingWithoutClaim = maintained.unclaimedRewards.filter((candidate) => candidate.rewardId !== id);
    const physicalAvailable = (resolveStorageApi().MAIN_INVENTORY_CAPACITY - maintained.inventory.length)
      + (resolveStorageApi().TEMP_BOX_CAPACITY - maintained.tempBox.length);
    if (physicalAvailable < reward.gears.length) fail('CLAIM_CAPACITY_EXCEEDED', 'not enough inventory and TEMP BOX capacity for this claim');
    const blueprintShards = addSafe(maintained.resources.blueprintShards, reward.blueprintShards, 'resources.blueprintShards');
    const inventory = [...maintained.inventory];
    const tempBox = [...maintained.tempBox];
    const placedInventoryGearIds = [];
    const placedTempGearIds = [];
    reward.gears.forEach((gear) => {
      if (inventory.length < resolveStorageApi().MAIN_INVENTORY_CAPACITY) {
        inventory.push({ gear, locked: false, favorite: false });
        placedInventoryGearIds.push(gear.gearId);
      } else {
        tempBox.push({ gear, locked: false, favorite: false, enteredAtMs: now });
        placedTempGearIds.push(gear.gearId);
      }
    });
    const nextState = canonicalState({
      ...maintained,
      inventory,
      tempBox,
      unclaimedRewards: pendingWithoutClaim,
      rewardLedger: cloneLedgerWith(maintained.rewardLedger, id),
      resources: { powder: maintained.resources.powder, blueprintShards },
    });
    return {
      nextState, duplicate: false, claimed: true, expiredGearIds: maintenance.expiredGearIds,
      movedGearIds: maintenance.movedGearIds, powderGained: maintenance.powderGained,
      blueprintShardsGained: maintenance.blueprintShardsGained, placedInventoryGearIds, placedTempGearIds,
    };
  }

  function getGearRewardGate(rawState) {
    const state = canonicalState(rawState);
    const api = resolveStorageApi();
    const reasons = [];
    if (state.unclaimedRewards.length >= api.UNCLAIMED_REWARD_CAPACITY) reasons.push('unclaimed_full');
    if (state.inventory.length >= api.MAIN_INVENTORY_CAPACITY && state.tempBox.length >= api.TEMP_BOX_CAPACITY) reasons.push('physical_storage_full');
    return { allowed: reasons.length === 0, reasons };
  }

  function resolveLockManager(storage, options) {
    if (options !== undefined && (!isPlainRecord(options) || Reflect.ownKeys(options).some((key) => key !== 'lockManager'))) {
      fail('INVALID_PERSIST_OPTIONS', 'persistence options may contain only lockManager');
    }
    const injected = options && options.lockManager;
    const storageManager = storage && storage.gearMutationLockManager;
    // Node 24 also exposes a navigator-shaped global.  Persistence tests and
    // server callers must inject their own shared manager; only an actual
    // browser window may select the cross-tab Web Locks implementation.
    const browserLocks = root && root.window === root && root.navigator && root.navigator.locks;
    const manager = injected || storageManager || browserLocks;
    if (!manager || typeof manager.request !== 'function') {
      fail('STORAGE_LOCK_UNAVAILABLE', 'a Web Locks compatible lockManager is required for gear reward persistence');
    }
    return manager;
  }
  async function withGearStorageLock(storage, options, operation) {
    const manager = resolveLockManager(storage, options);
    let operationError = null;
    let callbackInvoked = false;
    try {
      const result = await manager.request(GEAR_MUTATION_LOCK_NAME, { mode: 'exclusive' }, async (lock) => {
        callbackInvoked = true;
        // A compatible test/injected manager may use null to signal a lock
        // refusal.  Never continue to a write without demonstrable ownership.
        if (lock == null) fail('STORAGE_LOCK_NOT_ACQUIRED', 'gear reward storage lock was not acquired');
        try { return await operation(); } catch (error) { operationError = error; throw error; }
      });
      if (!callbackInvoked) fail('STORAGE_LOCK_NOT_ACQUIRED', 'gear reward storage lock callback was not run');
      return result;
    } catch (error) {
      if (error === operationError) throw error;
      if (error instanceof GearRewardsError) throw error;
      fail('STORAGE_LOCK_FAILED', 'could not acquire or run the gear reward storage lock', error);
    }
  }
  async function persistQueueReward(reward, storage, options) {
    return withGearStorageLock(storage, options, () => {
      const api = resolveStorageApi();
      const current = api.loadGearState(storage);
      const result = queueUnclaimedReward(current, reward);
      if (result.queued) result.nextState = api.saveGearState(result.nextState, storage);
      return result;
    });
  }
  async function persistClaimReward(rewardId, nowMs, storage, options) {
    return withGearStorageLock(storage, options, () => {
      const api = resolveStorageApi();
      const current = api.loadGearState(storage);
      const result = claimUnclaimedReward(current, rewardId, nowMs);
      if (result.claimed) result.nextState = api.saveGearState(result.nextState, storage);
      return result;
    });
  }
  async function persistStorageMaintenance(nowMs, storage, options) {
    return withGearStorageLock(storage, options, () => {
      const api = resolveStorageApi();
      const current = api.loadGearState(storage);
      const result = runStorageMaintenance(current, nowMs);
      if (result.expiredGearIds.length || result.movedGearIds.length) result.nextState = api.saveGearState(result.nextState, storage);
      return result;
    });
  }

  return Object.freeze({
    GearRewardsError, MAX_GEARS_PER_REWARD, GEAR_MUTATION_LOCK_NAME,
    queueUnclaimedReward, claimUnclaimedReward, runStorageMaintenance, getGearRewardGate,
    persistQueueReward, persistClaimReward, persistStorageMaintenance,
  });
});
