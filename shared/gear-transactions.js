(function initKatamonGearTransactions(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearTransactions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearTransactions(root) {
  'use strict';

  // A deliberately small write-ahead log for the one Phase 2B cross-key
  // operation.  The gear-state envelope is never copied here: a journal holds
  // only the one gear it changes and the (small) foundation raw strings.
  const GEAR_TRANSACTION_STORAGE_KEY = 'katamon_gear_txn_v1';
  const GEAR_TRANSACTION_SCHEMA_VERSION = 1;
  const ENHANCE_KIND = 'enhance_gear';
  // Shared with gear-rewards persistence: every mutation of katamon_gear_v1
  // must serialize, including a reward claim/maintenance and an enhancement.
  const GEAR_MUTATION_LOCK_NAME = 'katamon_gear_v1:mutation';

  class GearTransactionError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'GearTransactionError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }
  const fail = (code, message, cause) => { throw new GearTransactionError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
  const safeInteger = (value, path, min = 0) => {
    if (!Number.isSafeInteger(value) || value < min) fail('INVALID_TRANSACTION', `${path} must be a safe integer`);
    return value;
  };
  const nonEmptyString = (value, path) => {
    if (typeof value !== 'string' || value.length === 0) fail('INVALID_TRANSACTION', `${path} must be a non-empty string`);
    return value;
  };
  function exactKeys(value, keys, path) {
    if (!isPlainRecord(value)) fail('INVALID_TRANSACTION', `${path} must be a plain object`);
    Reflect.ownKeys(value).forEach((key) => {
      if (typeof key !== 'string') fail('INVALID_TRANSACTION', `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail('INVALID_TRANSACTION', `${path}.${key} must be an enumerable data property`);
      }
    });
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      fail('INVALID_TRANSACTION', `${path} has unknown or missing fields`);
    }
  }
  function stableJson(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('INVALID_TRANSACTION', 'journal data must be finite JSON');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) fail('INVALID_TRANSACTION', 'journal data must not be cyclic');
      seen.add(value);
      const result = `[${value.map((entry) => stableJson(entry, seen)).join(',')}]`;
      seen.delete(value);
      return result;
    }
    if (isPlainRecord(value)) {
      if (seen.has(value)) fail('INVALID_TRANSACTION', 'journal data must not be cyclic');
      seen.add(value);
      const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
      seen.delete(value);
      return result;
    }
    fail('INVALID_TRANSACTION', 'journal data must be JSON-like');
  }
  function cloneJson(value) {
    // All values reaching this point came from JSON or a domain API.  The
    // round trip gives each caller a fresh data-only object without invoking
    // foundation normalisation (which would discard unknown state).
    return JSON.parse(JSON.stringify(value));
  }
  function resolveModules() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return {
        gear: require('./gear-domain.js'),
        gearStorage: require('./gear-storage.js'),
        foundation: require('../coop-mvp-foundation.js'),
      };
    }
    if (root && root.KatamonGearDomain && root.KatamonGearStorage && root.KatamonCoopMvp) {
      return { gear: root.KatamonGearDomain, gearStorage: root.KatamonGearStorage, foundation: root.KatamonCoopMvp };
    }
    fail('TRANSACTION_DEPENDENCY_UNAVAILABLE', 'gear domain, gear storage, and coop foundation must be available');
  }
  function resolveStorage(storage, method) {
    let target = storage;
    if (target === undefined) {
      try { target = root && root.localStorage; } catch (error) { fail('STORAGE_UNAVAILABLE', 'localStorage is unavailable', error); }
    }
    if (!target || typeof target[method] !== 'function') fail('STORAGE_UNAVAILABLE', `storage.${method} is unavailable`);
    return target;
  }
  function rawRead(storage, key, code = 'STORAGE_READ_FAILED') {
    const target = resolveStorage(storage, 'getItem');
    try { return target.getItem(key); } catch (error) { fail(code, `could not read ${key}`, error); }
  }
  function resolveLockManager(storage, options = {}) {
    if (options.lockManager && typeof options.lockManager.request === 'function') return options.lockManager;
    if (storage && storage.gearMutationLockManager && typeof storage.gearMutationLockManager.request === 'function') return storage.gearMutationLockManager;
    // Node tests/services must inject their lock manager.  Do not silently
    // depend on a host-specific global shim: that would make lock guarantees
    // differ between Node versions.
    if (typeof module === 'object' && module.exports) fail('TRANSACTION_LOCK_UNAVAILABLE', 'Node transaction calls require an injected exclusive lock manager');
    try {
      if (root && root.navigator && root.navigator.locks && typeof root.navigator.locks.request === 'function') return root.navigator.locks;
    } catch (_error) { /* strict failure below */ }
    fail('TRANSACTION_LOCK_UNAVAILABLE', 'an exclusive transaction lock manager is required');
  }
  function withTransactionLock(storage, options, work) {
    const manager = resolveLockManager(storage, options);
    let operationError = null;
    let callbackInvoked = false;
    try {
      return Promise.resolve(manager.request(GEAR_MUTATION_LOCK_NAME, { mode: 'exclusive' }, async (lock) => {
        callbackInvoked = true;
        if (lock == null) fail('TRANSACTION_LOCK_NOT_ACQUIRED', 'exclusive gear mutation lock was not acquired');
        try { return await work(); } catch (error) { operationError = error; throw error; }
      })).then((result) => {
        if (!callbackInvoked) fail('TRANSACTION_LOCK_NOT_ACQUIRED', 'exclusive gear mutation lock callback was not run');
        return result;
      }).catch((error) => {
        if (error === operationError) throw error;
        if (error instanceof GearTransactionError) throw error;
        fail('TRANSACTION_LOCK_FAILED', 'could not acquire or run the exclusive transaction lock', error);
      });
    } catch (error) {
      if (error instanceof GearTransactionError) throw error;
      fail('TRANSACTION_LOCK_FAILED', 'could not acquire exclusive transaction lock', error);
    }
  }
  function writeVerified(storage, key, serialized, prefix) {
    const target = resolveStorage(storage, 'setItem');
    if (typeof target.getItem !== 'function') fail('STORAGE_UNAVAILABLE', 'storage.getItem is unavailable for read-back verification');
    try { target.setItem(key, serialized); } catch (error) { fail(`${prefix}_WRITE_FAILED`, `could not write ${key}`, error); }
    let readBack;
    try { readBack = target.getItem(key); } catch (error) { fail(`${prefix}_READ_BACK_FAILED`, `could not verify ${key}`, error); }
    if (readBack !== serialized) fail(`${prefix}_READ_BACK_MISMATCH`, `read-back verification failed for ${key}`);
  }
  function removeVerified(storage, key) {
    const target = resolveStorage(storage, 'removeItem');
    if (typeof target.getItem !== 'function') fail('STORAGE_UNAVAILABLE', 'storage.getItem is unavailable for removal verification');
    try { target.removeItem(key); } catch (error) { fail('TRANSACTION_COMMITTED_CLEANUP_FAILED', 'could not remove completed transaction journal', error); }
    let readBack;
    try { readBack = target.getItem(key); } catch (error) { fail('TRANSACTION_COMMITTED_CLEANUP_FAILED', 'could not verify transaction journal removal', error); }
    if (readBack !== null) fail('TRANSACTION_COMMITTED_CLEANUP_FAILED', 'completed transaction journal remains after removal');
  }

  // Strict, non-normalising bridge.  It validates only the guaranteed coin
  // contract and leaves every other parsed field (including future fields)
  // byte-for-byte represented by JSON.stringify after changing wallet.coins.
  function parseFoundationRaw(raw, modules) {
    const { foundation } = modules;
    if (raw === null) return { raw: null, state: cloneJson(foundation.createDefaultState()) };
    if (typeof raw !== 'string') fail('INVALID_FOUNDATION_STORAGE_VALUE', 'foundation storage must be a string or absent');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { fail('FOUNDATION_JSON_PARSE_FAILED', 'foundation storage JSON is malformed', error); }
    assertFoundationRawNumbersRepresentable(raw);
    if (!isPlainRecord(parsed)) fail('INVALID_FOUNDATION_STATE', 'foundation root must be a plain object');
    assertFoundationJsonNumbersSafe(parsed);
    if (!Number.isSafeInteger(parsed.schemaVersion)) fail('INVALID_FOUNDATION_SCHEMA_VERSION', 'foundation schema version must be a safe integer');
    if (parsed.schemaVersion > foundation.SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_FOUNDATION_SCHEMA_VERSION', 'foundation state is newer than this client');
    if (parsed.schemaVersion !== foundation.SCHEMA_VERSION) fail('UNSUPPORTED_FOUNDATION_SCHEMA_VERSION', 'foundation state is unsupported');
    if (!isPlainRecord(parsed.wallet)) fail('INVALID_FOUNDATION_WALLET', 'foundation wallet must be a plain object');
    if (!Number.isSafeInteger(parsed.wallet.coins) || parsed.wallet.coins < 0 || parsed.wallet.coins > foundation.COIN_CAP) {
      fail('INVALID_FOUNDATION_COINS', 'foundation wallet.coins must be within the coin cap');
    }
    return { raw, state: parsed };
  }
  function assertFoundationRawNumbersRepresentable(raw) {
    let inString = false;
    let escaped = false;
    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') { inString = true; continue; }
      if (character !== '-' && (character < '0' || character > '9')) continue;
      const match = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) continue;
      const token = match[0];
      const numeric = Number(token);
      const mantissaDigits = token.split(/[eE]/, 1)[0].replace(/[-.]/g, '');
      if ((numeric === 0 && /[1-9]/.test(mantissaDigits)) || Object.is(numeric, -0)) {
        fail('UNSAFE_FOUNDATION_JSON_NUMBER', 'foundation contains an underflowed or negative-zero JSON number');
      }
      // The strict bridge rewrites the containing JSON after changing only
      // wallet.coins.  Reject a token whose exact numeric spelling cannot
      // survive that round trip, or an unrelated future field could silently
      // lose precision (for example a decimal longer than IEEE-754 retains).
      if (JSON.stringify(numeric) !== token) {
        fail('UNSAFE_FOUNDATION_JSON_NUMBER', 'foundation contains a JSON number that cannot be reserialized exactly');
      }
      index += token.length - 1;
    }
  }
  function assertFoundationJsonNumbersSafe(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      // JSON.parse accepts 1e400 as Infinity and rounds integers past 2^53.
      // Re-serializing either would silently mutate unrelated foundation data.
      if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        fail('UNSAFE_FOUNDATION_JSON_NUMBER', 'foundation contains a non-round-trippable JSON number');
      }
      return;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) fail('INVALID_FOUNDATION_STATE', 'foundation state must not be cyclic');
      seen.add(value); value.forEach((entry) => assertFoundationJsonNumbersSafe(entry, seen)); seen.delete(value); return;
    }
    if (isPlainRecord(value)) {
      if (seen.has(value)) fail('INVALID_FOUNDATION_STATE', 'foundation state must not be cyclic');
      seen.add(value); Object.keys(value).forEach((key) => assertFoundationJsonNumbersSafe(value[key], seen)); seen.delete(value); return;
    }
    fail('INVALID_FOUNDATION_STATE', 'foundation state must contain JSON data only');
  }
  function loadStrictFoundationState(storage, modules = resolveModules()) {
    const raw = rawRead(storage, modules.foundation.STORAGE_KEY, 'FOUNDATION_READ_FAILED');
    return parseFoundationRaw(raw, modules);
  }
  function foundationRawWithCoins(parsedFoundation, coins) {
    const next = cloneJson(parsedFoundation);
    next.wallet.coins = coins;
    return JSON.stringify(next);
  }
  function validateCanonicalGear(value, modules, path) {
    let checked;
    try { checked = modules.gear.validateGear(value); } catch (error) { fail('INVALID_TRANSACTION_GEAR', `${path} is not a valid canonical gear`, error); }
    if (stableJson(value) !== stableJson(checked)) fail('INVALID_TRANSACTION_GEAR', `${path} is not canonical`);
    return checked;
  }
  const JOURNAL_KEYS = Object.freeze([
    'schemaVersion', 'transactionId', 'kind', 'createdAtMs', 'gearId', 'fromLevel', 'targetLevel',
    'powderBefore', 'powderAfter', 'coinBefore', 'coinAfter', 'gearBefore', 'gearAfter',
    'foundationRawBefore', 'foundationRawAfter',
  ]);
  function validateJournal(value, modules = resolveModules()) {
    exactKeys(value, JOURNAL_KEYS, 'transaction journal');
    if (value.schemaVersion !== GEAR_TRANSACTION_SCHEMA_VERSION) {
      if (Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > GEAR_TRANSACTION_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_TRANSACTION_VERSION', 'transaction journal is newer than this client');
      fail('UNSUPPORTED_TRANSACTION_VERSION', 'transaction journal version is unsupported');
    }
    nonEmptyString(value.transactionId, 'transactionId');
    if (value.kind !== ENHANCE_KIND) fail('UNSUPPORTED_TRANSACTION_KIND', 'only enhance_gear transactions are supported');
    safeInteger(value.createdAtMs, 'createdAtMs');
    nonEmptyString(value.gearId, 'gearId');
    safeInteger(value.fromLevel, 'fromLevel');
    safeInteger(value.targetLevel, 'targetLevel');
    if (value.targetLevel <= value.fromLevel) fail('INVALID_TRANSACTION', 'enhancement target must be above from level');
    safeInteger(value.powderBefore, 'powderBefore'); safeInteger(value.powderAfter, 'powderAfter');
    safeInteger(value.coinBefore, 'coinBefore'); safeInteger(value.coinAfter, 'coinAfter');
    const gearBefore = validateCanonicalGear(value.gearBefore, modules, 'gearBefore');
    const gearAfter = validateCanonicalGear(value.gearAfter, modules, 'gearAfter');
    if (gearBefore.gearId !== value.gearId || gearAfter.gearId !== value.gearId || gearBefore.enhancementLevel !== value.fromLevel || gearAfter.enhancementLevel !== value.targetLevel) {
      fail('INVALID_TRANSACTION', 'journal gear snapshots do not match transaction identity');
    }
    const cost = modules.gear.calculateEnhancementCost(value.fromLevel, value.targetLevel);
    if (value.powderBefore - value.powderAfter !== cost.powder || value.coinBefore - value.coinAfter !== cost.coins) fail('INVALID_TRANSACTION', 'journal costs do not match gear domain');
    let expectedAfter;
    try { expectedAfter = modules.gear.enhanceGear(gearBefore, value.targetLevel); } catch (error) { fail('INVALID_TRANSACTION_GEAR', 'could not reproduce enhanced gear', error); }
    if (stableJson(expectedAfter) !== stableJson(gearAfter)) fail('INVALID_TRANSACTION', 'journal gear after snapshot is not deterministic');
    if (value.foundationRawBefore !== null && typeof value.foundationRawBefore !== 'string') fail('INVALID_TRANSACTION', 'foundationRawBefore must be a string or null');
    if (typeof value.foundationRawAfter !== 'string') fail('INVALID_TRANSACTION', 'foundationRawAfter must be a string');
    const beforeFoundation = parseFoundationRaw(value.foundationRawBefore, modules);
    const afterFoundation = parseFoundationRaw(value.foundationRawAfter, modules);
    if (beforeFoundation.state.wallet.coins !== value.coinBefore || afterFoundation.state.wallet.coins !== value.coinAfter) fail('INVALID_TRANSACTION', 'journal foundation coin snapshots do not match');
    if (stableJson(foundationWithCoinObject(beforeFoundation.state, value.coinAfter)) !== stableJson(afterFoundation.state)) {
      fail('INVALID_TRANSACTION', 'journal foundation state changes more than wallet.coins');
    }
    return cloneJson(value);
  }
  function foundationWithCoinObject(state, coins) {
    const next = cloneJson(state);
    next.wallet.coins = coins;
    return next;
  }
  function encodeJournal(journal, modules = resolveModules()) { return JSON.stringify(validateJournal(journal, modules)); }
  function loadJournal(storage, modules = resolveModules()) {
    const raw = rawRead(storage, GEAR_TRANSACTION_STORAGE_KEY, 'TRANSACTION_JOURNAL_READ_FAILED');
    if (raw === null) return null;
    if (typeof raw !== 'string') fail('INVALID_TRANSACTION', 'transaction journal must be a string');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { fail('TRANSACTION_JOURNAL_JSON_PARSE_FAILED', 'transaction journal JSON is malformed', error); }
    return validateJournal(parsed, modules);
  }
  function saveJournalUnlocked(journal, storage, modules) {
    const encoded = encodeJournal(journal, modules);
    if (rawRead(storage, GEAR_TRANSACTION_STORAGE_KEY, 'TRANSACTION_JOURNAL_READ_FAILED') !== null) {
      fail('PENDING_TRANSACTION_EXISTS', 'recover the pending gear transaction before writing another');
    }
    writeVerified(storage, GEAR_TRANSACTION_STORAGE_KEY, encoded, 'TRANSACTION_JOURNAL');
    return validateJournal(JSON.parse(encoded), modules);
  }
  function saveJournal(journal, storage, options = {}) {
    const modules = options.modules || resolveModules();
    return withTransactionLock(storage, options, () => saveJournalUnlocked(journal, storage, modules));
  }
  function journalSize(journal, modules = resolveModules()) {
    const serialized = encodeJournal(journal, modules);
    return { chars: serialized.length, utf16Bytes: serialized.length * 2 };
  }

  function replaceGearSideFromJournal(journal, storage, modules) {
    const current = modules.gearStorage.loadGearState(storage);
    const index = current.inventory.findIndex((entry) => entry.gear.gearId === journal.gearId);
    if (index < 0) fail('TRANSACTION_CONFLICT', 'target gear is no longer in inventory');
    const entry = current.inventory[index];
    const beforeMatches = stableJson(entry.gear) === stableJson(journal.gearBefore) && current.resources.powder === journal.powderBefore;
    const afterMatches = stableJson(entry.gear) === stableJson(journal.gearAfter) && current.resources.powder === journal.powderAfter;
    if (afterMatches) return { gearApplied: false, gearAlreadyApplied: true };
    if (!beforeMatches) fail('TRANSACTION_CONFLICT', 'target gear or powder changed while transaction was pending');
    const next = cloneJson(current);
    next.inventory[index].gear = cloneJson(journal.gearAfter);
    next.resources.powder = journal.powderAfter;
    // saveGearState verifies its own read-back.  If it becomes ambiguous, the
    // journal deliberately remains and the next recovery reads actual state.
    modules.gearStorage.saveGearState(next, storage);
    return { gearApplied: true, gearAlreadyApplied: false };
  }
  function replaceFoundationSideFromJournal(journal, storage, modules) {
    const currentRaw = rawRead(storage, modules.foundation.STORAGE_KEY, 'FOUNDATION_READ_FAILED');
    if (currentRaw === journal.foundationRawAfter) return { coinApplied: false, coinAlreadyApplied: true };
    if (currentRaw !== journal.foundationRawBefore) fail('TRANSACTION_CONFLICT', 'foundation state changed while transaction was pending');
    writeVerified(storage, modules.foundation.STORAGE_KEY, journal.foundationRawAfter, 'FOUNDATION');
    return { coinApplied: true, coinAlreadyApplied: false };
  }
  function assertCurrentJournalMatches(journal, storage, modules) {
    const expected = encodeJournal(journal, modules);
    const current = rawRead(storage, GEAR_TRANSACTION_STORAGE_KEY, 'TRANSACTION_JOURNAL_READ_FAILED');
    if (current !== expected) fail('TRANSACTION_CONFLICT', 'pending journal changed while transaction was being recovered');
  }
  function recoverJournal(journal, storage, modules) {
    // A second tab may have installed a different WAL after the caller loaded
    // this one.  Never apply or clean up a journal that is no longer ours.
    assertCurrentJournalMatches(journal, storage, modules);
    const gear = replaceGearSideFromJournal(journal, storage, modules);
    const coin = replaceFoundationSideFromJournal(journal, storage, modules);
    // Re-read both, rather than trusting a previous read-back, before cleanup.
    const finalGear = modules.gearStorage.loadGearState(storage);
    const finalEntry = finalGear.inventory.find((entry) => entry.gear.gearId === journal.gearId);
    if (!finalEntry || stableJson(finalEntry.gear) !== stableJson(journal.gearAfter) || finalGear.resources.powder !== journal.powderAfter) fail('TRANSACTION_CONFLICT', 'gear side is not in committed state');
    const finalFoundationRaw = rawRead(storage, modules.foundation.STORAGE_KEY, 'FOUNDATION_READ_FAILED');
    if (finalFoundationRaw !== journal.foundationRawAfter) fail('TRANSACTION_CONFLICT', 'foundation side is not in committed state');
    // Recheck immediately before removal so a later WAL is never deleted.
    assertCurrentJournalMatches(journal, storage, modules);
    removeVerified(storage, GEAR_TRANSACTION_STORAGE_KEY);
    return { recovered: true, transactionId: journal.transactionId, ...gear, ...coin };
  }
  function recoverPendingGearTransactionUnlocked(storage, modules) {
    const journal = loadJournal(storage, modules);
    if (!journal) return { recovered: false };
    return recoverJournal(journal, storage, modules);
  }
  function recoverPendingGearTransaction(storage, options = {}) {
    const modules = options.modules || resolveModules();
    return withTransactionLock(storage, options, () => recoverPendingGearTransactionUnlocked(storage, modules));
  }
  function enhanceStoredGearAtomicUnlocked({ transactionId, gearId, targetLevel, createdAtMs, storage }, modules) {
    nonEmptyString(transactionId, 'transactionId'); nonEmptyString(gearId, 'gearId'); safeInteger(createdAtMs, 'createdAtMs');
    if (!Number.isSafeInteger(targetLevel)) fail('INVALID_ENHANCEMENT_TARGET', 'target enhancement level must be a safe integer');
    if (rawRead(storage, GEAR_TRANSACTION_STORAGE_KEY, 'TRANSACTION_JOURNAL_READ_FAILED') !== null) fail('PENDING_TRANSACTION_EXISTS', 'recover the pending gear transaction before starting another');
    const gearState = modules.gearStorage.loadGearState(storage);
    const index = gearState.inventory.findIndex((entry) => entry.gear.gearId === gearId);
    if (index < 0) {
      const temporary = gearState.tempBox.some((entry) => entry.gear.gearId === gearId);
      if (temporary) fail('GEAR_NOT_IN_INVENTORY', 'TEMP BOX gear cannot be enhanced');
      const unclaimed = gearState.unclaimedRewards.some((reward) => reward.gears.some((entry) => entry.gearId === gearId));
      if (unclaimed) fail('GEAR_NOT_IN_INVENTORY', 'unclaimed reward gear cannot be enhanced');
      fail('GEAR_NOT_FOUND', 'gear was not found in inventory');
    }
    const gearBefore = modules.gear.validateGear(gearState.inventory[index].gear);
    if (targetLevel === gearBefore.enhancementLevel) return { noOp: true, duplicate: true, transactionId: null };
    if (targetLevel < gearBefore.enhancementLevel) fail('INVALID_ENHANCEMENT_TARGET', 'target enhancement level cannot go backward');
    const cost = modules.gear.calculateEnhancementCost(gearBefore.enhancementLevel, targetLevel);
    if (gearState.resources.powder < cost.powder) fail('INSUFFICIENT_POWDER', 'not enough powder');
    const foundationBefore = loadStrictFoundationState(storage, modules);
    if (foundationBefore.state.wallet.coins < cost.coins) fail('INSUFFICIENT_COINS', 'not enough coins');
    const gearAfter = modules.gear.enhanceGear(gearBefore, targetLevel);
    const coinAfter = foundationBefore.state.wallet.coins - cost.coins;
    const foundationRawAfter = foundationRawWithCoins(foundationBefore.state, coinAfter);
    const journal = {
      schemaVersion: GEAR_TRANSACTION_SCHEMA_VERSION, transactionId, kind: ENHANCE_KIND, createdAtMs,
      gearId, fromLevel: gearBefore.enhancementLevel, targetLevel,
      powderBefore: gearState.resources.powder, powderAfter: gearState.resources.powder - cost.powder,
      coinBefore: foundationBefore.state.wallet.coins, coinAfter,
      gearBefore, gearAfter,
      foundationRawBefore: foundationBefore.raw, foundationRawAfter,
    };
    saveJournalUnlocked(journal, storage, modules);
    return recoverJournal(journal, storage, modules);
  }
  function enhanceStoredGearAtomic({ transactionId, gearId, targetLevel, createdAtMs, storage, lockManager }) {
    const modules = resolveModules();
    return withTransactionLock(storage, { lockManager }, () => enhanceStoredGearAtomicUnlocked({ transactionId, gearId, targetLevel, createdAtMs, storage }, modules));
  }

  return Object.freeze({
    GearTransactionError,
    GEAR_TRANSACTION_STORAGE_KEY, GEAR_TRANSACTION_SCHEMA_VERSION, GEAR_MUTATION_LOCK_NAME, ENHANCE_KIND,
    loadStrictFoundationState, validateJournal, encodeJournal, loadJournal, saveJournal, journalSize,
    recoverPendingGearTransaction, enhanceStoredGearAtomic,
  });
});
