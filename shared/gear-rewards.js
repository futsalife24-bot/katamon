(function initKatamonGearRewards(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearRewards(root) {
  'use strict';

  const MAX_GEARS_PER_REWARD = 5;
  const GEAR_TRANSACTION_STORAGE_KEY = 'katamon_gear_txn_v1';
  const TARGETED_BOX_SOURCE_ID = 'targeted_box';
  const TARGETED_BOX_REQUEST_ID_MAX_LENGTH = 64;
  const TARGETED_BOX_ENTROPY_MAX_LENGTH = 128;
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
  const assertGearId = (value) => assertNonEmptyString(value, 'gearId');
  function canonicalMetadataPatch(rawPatch) {
    if (!isPlainRecord(rawPatch)) fail('INVALID_GEAR_METADATA_PATCH', 'metadata patch must be a plain object');
    const keys = Reflect.ownKeys(rawPatch);
    if (keys.length < 1 || keys.some((key) => key !== 'favorite' && key !== 'locked')) fail('INVALID_GEAR_METADATA_PATCH', 'metadata patch may contain only favorite and locked');
    const patch = {};
    keys.sort().forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(rawPatch, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean') fail('INVALID_GEAR_METADATA_PATCH', `metadata.${key} must be a boolean data property`);
      patch[key] = descriptor.value;
    });
    return patch;
  }
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
  function resolvePresetStorage() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-preset-storage.js');
    if (root && root.KatamonGearPresetStorage) return root.KatamonGearPresetStorage;
    fail('PRESET_STORAGE_UNAVAILABLE', 'KatamonGearPresetStorage must be available before dismantling Gear');
  }
  function resolveTransactions() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-transactions.js');
    if (root && root.KatamonGearTransactions) return root.KatamonGearTransactions;
    fail('GEAR_TRANSACTIONS_UNAVAILABLE', 'KatamonGearTransactions must be available before opening a targeted box');
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
  function assertRewardLedger(state) {
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
    const ledger = assertRewardLedger(state);
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
    const ledger = assertRewardLedger(state);
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
    const rewardPowderGained = reward.powder;
    const powder = addSafe(maintained.resources.powder, rewardPowderGained, 'resources.powder');
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
      resources: { powder, blueprintShards },
    });
    return {
      nextState, duplicate: false, claimed: true, expiredGearIds: maintenance.expiredGearIds,
      movedGearIds: maintenance.movedGearIds, powderGained: maintenance.powderGained,
      rewardPowderGained,
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

  function highestTargetedBoxQualityProfileId(rawFoundationState) {
    if (!isPlainRecord(rawFoundationState) || !isPlainRecord(rawFoundationState.boss)
      || !Array.isArray(rawFoundationState.boss.unlockedDifficulties)) {
      fail('INVALID_FOUNDATION_GEAR_ENTITLEMENT', 'foundation boss progression is unavailable');
    }
    const unlocked = new Set(rawFoundationState.boss.unlockedDifficulties);
    if (unlocked.has('extreme')) return 'coop-extreme';
    if (unlocked.has('hard')) return 'coop-hard';
    if (unlocked.has('normal')) return 'coop-normal';
    fail('TARGETED_BOX_QUALITY_NOT_UNLOCKED', 'a cooperative boss difficulty must be unlocked first');
  }
  function canonicalTargetedBoxRequest(rawRequest) {
    if (!isPlainRecord(rawRequest)) fail('INVALID_TARGETED_BOX_REQUEST', 'targeted box request must be a plain object');
    const allowed = new Set(['requestId', 'kind', 'slotId', 'setId', 'createdAtMs']);
    const keys = Reflect.ownKeys(rawRequest);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) fail('INVALID_TARGETED_BOX_REQUEST', 'targeted box request contains unknown fields');
    const requestId = assertNonEmptyString(rawRequest.requestId, 'requestId');
    if (requestId.length > TARGETED_BOX_REQUEST_ID_MAX_LENGTH) fail('INVALID_TARGETED_BOX_REQUEST_ID', 'requestId is too long');
    const kind = assertNonEmptyString(rawRequest.kind, 'kind');
    const request = { requestId, kind, createdAtMs: assertNow(rawRequest.createdAtMs) };
    if (hasOwn(rawRequest, 'slotId')) request.slotId = rawRequest.slotId;
    if (hasOwn(rawRequest, 'setId')) request.setId = rawRequest.setId;
    return request;
  }
  function canonicalTargetedBoxSelection(rawRequest) {
    if (!isPlainRecord(rawRequest)) fail('INVALID_TARGETED_BOX_REQUEST', 'targeted box request must be a plain object');
    const allowed = new Set(['requestId', 'kind', 'slotId', 'setId', 'createdAtMs']);
    const keys = Reflect.ownKeys(rawRequest);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) fail('INVALID_TARGETED_BOX_REQUEST', 'targeted box request contains unknown fields');
    const request = { kind: assertNonEmptyString(rawRequest.kind, 'kind'), createdAtMs: assertNow(rawRequest.createdAtMs) };
    if (hasOwn(rawRequest, 'requestId')) {
      request.requestId = assertNonEmptyString(rawRequest.requestId, 'requestId');
      if (request.requestId.length > TARGETED_BOX_REQUEST_ID_MAX_LENGTH) fail('INVALID_TARGETED_BOX_REQUEST_ID', 'requestId is too long');
    }
    if (hasOwn(rawRequest, 'slotId')) request.slotId = rawRequest.slotId;
    if (hasOwn(rawRequest, 'setId')) request.setId = rawRequest.setId;
    return request;
  }
  function targetedBoxSourceDetail(request, quote) {
    const sourceDetail = {
      kind: quote.kind,
      qualityProfileId: quote.constraints.qualityProfileId,
      requestId: request.requestId,
    };
    if (hasOwn(quote.constraints, 'setId')) sourceDetail.setId = quote.constraints.setId;
    if (hasOwn(quote.constraints, 'slotId')) sourceDetail.slotId = quote.constraints.slotId;
    return sourceDetail;
  }
  function secureTargetedBoxToken(label) {
    if (root && root.crypto && typeof root.crypto.randomUUID === 'function') return `${label}:${root.crypto.randomUUID()}`;
    fail('TARGETED_BOX_CRYPTO_UNAVAILABLE', 'secure random UUID support is required to open a targeted box');
  }
  function openTargetedBox(rawState, rawRequest, qualityProfileId, rawEntropySeed) {
    const state = canonicalState(rawState);
    const request = canonicalTargetedBoxRequest(rawRequest);
    const entropySeed = assertNonEmptyString(rawEntropySeed, 'entropySeed');
    if (entropySeed.length > TARGETED_BOX_ENTROPY_MAX_LENGTH) fail('INVALID_TARGETED_BOX_ENTROPY', 'entropySeed is too long');
    const domain = resolveDomain();
    const constraints = { qualityProfileId };
    if (hasOwn(request, 'slotId')) constraints.slotId = request.slotId;
    if (hasOwn(request, 'setId')) constraints.setId = request.setId;
    let quote;
    try { quote = domain.getTargetedBoxQuote(request.kind, constraints); } catch (error) {
      fail(error && error.code ? error.code : 'INVALID_TARGETED_BOX_REQUEST', error && error.message, error);
    }
    const qualityProfile = Object.values(domain.COOP_BOSS_QUALITY_PROFILES).find((entry) => entry.id === quote.constraints.qualityProfileId);
    if (!qualityProfile) fail('TARGETED_BOX_QUALITY_PROFILE_UNAVAILABLE', 'targeted box quality profile is unavailable');
    const rewardId = `targeted-box:${request.requestId}`;
    const gearId = `targeted-gear:${request.requestId}`;
    const sourceDetail = targetedBoxSourceDetail(request, quote);
    const ledger = assertRewardLedger(state);
    if (ledgerHas(ledger, rewardId)) return { nextState: state, duplicate: true, opened: false, quote, reward: null, spentBlueprintShards: 0 };
    const pending = findPending(state, rewardId);
    if (pending) {
      if (pending.sourceId !== TARGETED_BOX_SOURCE_ID || JSON.stringify(pending.sourceDetail) !== JSON.stringify(sourceDetail)) {
        fail('DUPLICATE_REWARD_MISMATCH', `rewardId ${rewardId} already exists with different targeted-box parameters`);
      }
      return { nextState: state, duplicate: true, opened: false, quote, reward: pending, spentBlueprintShards: 0 };
    }
    const gate = getGearRewardGate(state);
    if (!gate.allowed) fail('TARGETED_BOX_REWARD_GATE_BLOCKED', `targeted box cannot open: ${gate.reasons.join(',')}`);
    if (state.resources.blueprintShards < quote.blueprintShards) fail('INSUFFICIENT_BLUEPRINT_SHARDS', 'not enough blueprint shards to open this targeted box');
    let gear;
    try {
      gear = domain.createGear({
        gearId,
        generationSeed: `targeted-box:${entropySeed}:generation`,
        enhancementSeed: `targeted-box:${entropySeed}:enhancement`,
        sourceId: TARGETED_BOX_SOURCE_ID,
        sourceDetail,
        acquiredAt: request.createdAtMs,
        qualityProfile,
        setProfile: domain.GEAR_SET_PROFILES.uniform,
        slotId: quote.constraints.slotId,
        setId: quote.constraints.setId,
      });
    } catch (error) {
      fail(error && error.code ? error.code : 'TARGETED_BOX_GENERATION_FAILED', error && error.message, error);
    }
    const reward = canonicalReward({ rewardId, sourceId: TARGETED_BOX_SOURCE_ID, sourceDetail, createdAtMs: request.createdAtMs, gears: [gear], powder: 0, blueprintShards: 0 });
    const queued = queueUnclaimedReward(state, reward);
    if (!queued.queued) {
      return { ...queued, opened: false, quote, reward, spentBlueprintShards: 0 };
    }
    const nextState = canonicalState({
      ...queued.nextState,
      resources: {
        powder: queued.nextState.resources.powder,
        blueprintShards: state.resources.blueprintShards - quote.blueprintShards,
      },
    });
    return { ...queued, nextState, opened: true, quote, reward, spentBlueprintShards: quote.blueprintShards };
  }

  function setStoredGearMetadata(rawState, gearId, rawPatch) {
    const state = canonicalState(rawState);
    const id = assertGearId(gearId);
    const patch = canonicalMetadataPatch(rawPatch);
    let location = null;
    let found = false;
    const update = (entry, candidateLocation) => {
      if (entry.gear.gearId !== id) return entry;
      if (found) fail('DUPLICATE_GEAR_ID', `gearId ${id} appears more than once`);
      found = true; location = candidateLocation;
      return { ...entry, ...patch };
    };
    const inventory = state.inventory.map((entry) => update(entry, 'inventory'));
    const tempBox = state.tempBox.map((entry) => update(entry, 'tempBox'));
    if (!found) fail('GEAR_NOT_FOUND', `gearId ${id} is not stored in inventory or TEMP BOX`);
    const nextState = canonicalState({ ...state, inventory, tempBox });
    return { nextState, gearId: id, location, favorite: nextState[location].find((entry) => entry.gear.gearId === id).favorite, locked: nextState[location].find((entry) => entry.gear.gearId === id).locked };
  }
  function presetReferencesGear(presetState, gearId) {
    return Object.values(presetState.characters || {}).some((character) => (character.presets || []).some((preset) => Object.values(preset.slots || {}).includes(gearId)));
  }
  function dismantleInventoryGear(rawState, presetState, gearId) {
    const state = canonicalState(rawState);
    const id = assertGearId(gearId);
    const index = state.inventory.findIndex((entry) => entry.gear.gearId === id);
    if (index < 0) fail('GEAR_NOT_IN_INVENTORY', 'manual dismantle is limited to Inventory Gear');
    const entry = state.inventory[index];
    if (entry.locked) fail('GEAR_LOCKED', 'locked Gear cannot be dismantled');
    if (presetReferencesGear(presetState, id)) fail('GEAR_REFERENCED_BY_PRESET', 'remove Gear from every preset before dismantling it');
    let checkedGear; let yieldValue;
    try {
      checkedGear = resolveDomain().validateGear(entry.gear);
      yieldValue = resolveDomain().calculateDismantleYield(checkedGear);
    } catch (error) { fail(error?.code || 'INVALID_DISMANTLE_YIELD', 'could not calculate dismantle yield', error); }
    const nextState = canonicalState({
      ...state,
      inventory: state.inventory.filter((_candidate, candidateIndex) => candidateIndex !== index),
      resources: {
        powder: addSafe(state.resources.powder, yieldValue.powder, 'resources.powder'),
        blueprintShards: addSafe(state.resources.blueprintShards, yieldValue.blueprintShards, 'resources.blueprintShards'),
      },
    });
    return { nextState, gearId: id, gear: checkedGear, yield: { ...yieldValue } };
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
  function assertNoPendingGearTransaction(storage) {
    let target = storage;
    if (target === undefined) {
      try { target = root && root.localStorage; } catch (error) {
        fail('STORAGE_READ_FAILED', 'could not inspect the pending gear transaction', error);
      }
    }
    if (!target || typeof target.getItem !== 'function') {
      fail('STORAGE_UNAVAILABLE', 'storage.getItem is required for pending transaction guard');
    }
    let pending;
    try { pending = target.getItem(GEAR_TRANSACTION_STORAGE_KEY); } catch (error) {
      fail('STORAGE_READ_FAILED', 'could not inspect the pending gear transaction', error);
    }
    if (pending !== null) {
      fail('PENDING_GEAR_TRANSACTION_EXISTS', 'recover the pending gear transaction before mutating gear storage');
    }
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
        try {
          // Raw WAL presence is checked after lock acquisition and before any
          // load/mutation.  Malformed journals also block until recovery or an
          // explicit repair flow handles them.
          assertNoPendingGearTransaction(storage);
          return await operation();
        } catch (error) { operationError = error; throw error; }
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
  async function persistSetGearEntryMetadata(gearId, patch, storage, options) {
    return withGearStorageLock(storage, options, () => {
      const api = resolveStorageApi();
      const current = api.loadGearState(storage);
      const result = setStoredGearMetadata(current, gearId, patch);
      result.nextState = api.saveGearState(result.nextState, storage);
      const stored = result.nextState[result.location].find((entry) => entry.gear.gearId === result.gearId);
      if (!stored || stored.favorite !== result.favorite || stored.locked !== result.locked) fail('STORAGE_READ_BACK_MISMATCH', 'Gear metadata read-back did not match');
      return result;
    });
  }
  async function persistDismantleInventoryGear(gearId, storage, options = {}) {
    if (!isPlainRecord(options) || Object.keys(options).some((key) => key !== 'lockManager' && key !== 'characterIds')) fail('INVALID_DISMANTLE_OPTIONS', 'dismantle options contain unknown fields');
    const lockOptions = options.lockManager === undefined ? undefined : { lockManager: options.lockManager };
    return withGearStorageLock(storage, lockOptions, () => {
      const api = resolveStorageApi();
      const current = api.loadGearState(storage);
      const presetState = resolvePresetStorage().load(storage, { characterIds: options.characterIds });
      const result = dismantleInventoryGear(current, presetState, gearId);
      result.nextState = api.saveGearState(result.nextState, storage);
      const remaining = result.nextState.inventory.some((entry) => entry.gear.gearId === result.gearId)
        || result.nextState.tempBox.some((entry) => entry.gear.gearId === result.gearId);
      if (remaining) fail('STORAGE_READ_BACK_MISMATCH', 'dismantled Gear still exists after read-back');
      return result;
    });
  }
  async function persistOpenTargetedBox(request, storage, options) {
    const commonJs = typeof module === 'object' && module.exports;
    if (commonJs && options && Reflect.ownKeys(options).some((key) => !['lockManager', 'testEntropySeed'].includes(key))) {
      fail('INVALID_PERSIST_OPTIONS', 'targeted box persistence options contain unknown fields');
    }
    const lockOptions = commonJs && options
      ? { lockManager: options.lockManager }
      : options;
    return withGearStorageLock(storage, lockOptions, () => {
      const api = resolveStorageApi();
      const foundation = resolveTransactions().loadStrictFoundationState(storage).state;
      const qualityProfileId = highestTargetedBoxQualityProfileId(foundation);
      const selection = canonicalTargetedBoxSelection(request);
      const requestId = selection.requestId || secureTargetedBoxToken('box');
      const entropySeed = commonJs && options && options.testEntropySeed
        ? assertNonEmptyString(options.testEntropySeed, 'testEntropySeed') : secureTargetedBoxToken('roll');
      const current = api.loadGearState(storage);
      const result = openTargetedBox(current, { ...selection, requestId }, qualityProfileId, entropySeed);
      if (result.opened) result.nextState = api.saveGearState(result.nextState, storage);
      return result;
    });
  }

  return Object.freeze({
    GearRewardsError, MAX_GEARS_PER_REWARD, GEAR_TRANSACTION_STORAGE_KEY, GEAR_MUTATION_LOCK_NAME,
    TARGETED_BOX_SOURCE_ID, TARGETED_BOX_REQUEST_ID_MAX_LENGTH, TARGETED_BOX_ENTROPY_MAX_LENGTH,
    queueUnclaimedReward, claimUnclaimedReward, runStorageMaintenance, getGearRewardGate, setStoredGearMetadata, dismantleInventoryGear,
    highestTargetedBoxQualityProfileId, openTargetedBox,
    persistQueueReward, persistClaimReward, persistStorageMaintenance, persistSetGearEntryMetadata, persistDismantleInventoryGear, persistOpenTargetedBox,
  });
});
