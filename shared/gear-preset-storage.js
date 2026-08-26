(function initKatamonGearPresetStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearPresetStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearPresetStorage(root) {
  'use strict';
  const STORAGE_KEY = 'katamon_gear_presets_v1'; const SCHEMA_VERSION = 1; const WAL_KEY = 'katamon_gear_txn_v1'; const LOCK_NAME = 'katamon_gear_v1:mutation';
  class GearPresetStorageError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearPresetStorageError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearPresetStorageError(code, message, cause); };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function presets() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-presets.js'); if (root?.KatamonGearPresets) return root.KatamonGearPresets; fail('PRESET_DOMAIN_UNAVAILABLE', 'gear preset domain is unavailable'); }
  function gearStorage() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-storage.js'); if (root?.KatamonGearStorage) return root.KatamonGearStorage; fail('GEAR_STORAGE_UNAVAILABLE', 'gear storage is unavailable'); }
  function gearDomain() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js'); if (root?.KatamonGearDomain) return root.KatamonGearDomain; fail('GEAR_DOMAIN_UNAVAILABLE', 'gear domain is unavailable'); }
  function resolveStorage(target, method) { const storage = target === undefined ? root?.localStorage : target; if (!storage || typeof storage[method] !== 'function') fail('STORAGE_UNAVAILABLE', `storage.${method} is unavailable`); return storage; }
  function resolveLock(storage, options = {}) { const injected = options.lockManager || storage?.gearMutationLockManager; const browser = root?.window === root ? root.navigator?.locks : null; const manager = injected || browser; if (!manager || typeof manager.request !== 'function') fail('STORAGE_LOCK_UNAVAILABLE', 'a Web Locks compatible lock manager is required'); return manager; }
  function canonical(value, characterIds) { try { return presets().validateState(value, { characterIds }); } catch (error) { if (error?.name === 'GearPresetError') fail(error.code, error.message, error); throw error; } }
  function load(target, options = {}) { const storage = resolveStorage(target, 'getItem'); let raw; try { raw = storage.getItem(STORAGE_KEY); } catch (error) { fail('STORAGE_READ_FAILED', 'could not read gear presets', error); } if (raw === null) return presets().createInitialState(options.characterIds); try { return canonical(JSON.parse(raw), options.characterIds); } catch (error) { if (error instanceof GearPresetStorageError) throw error; fail('PRESET_STORAGE_PARSE_FAILED', 'gear preset storage is malformed', error); } }
  // This low-level strict persistence primitive intentionally has no lock or WAL guard.
  // Production/UI mutations must use mutateGearPresetsLocked(), never call save() directly.
  function save(state, target, options = {}) { const checked = canonical(state, options.characterIds); const encoded = JSON.stringify(checked); const storage = resolveStorage(target, 'setItem'); if (typeof storage.getItem !== 'function') fail('STORAGE_UNAVAILABLE', 'storage.getItem is required for read-back verification'); try { storage.setItem(STORAGE_KEY, encoded); if (storage.getItem(STORAGE_KEY) !== encoded) fail('STORAGE_READ_BACK_MISMATCH', 'could not verify gear preset storage'); } catch (error) { if (error instanceof GearPresetStorageError) throw error; fail('STORAGE_WRITE_FAILED', 'could not save gear presets', error); } return checked; }
  function assertNoWal(storage) { let raw; try { raw = storage.getItem(WAL_KEY); } catch (error) { fail('STORAGE_READ_FAILED', 'could not inspect the pending gear transaction', error); } if (raw !== null) fail('PENDING_GEAR_TRANSACTION_EXISTS', 'recover the pending gear transaction before mutating or capturing presets'); }
  // Browser Web Locks always complete asynchronously, but a strict compatible
  // manager may complete synchronously (notably the deterministic test
  // harness). Preserve either shape so callers can keep an atomic start path
  // without bypassing this lock/WAL boundary.
  function withLock(target, options, operation) {
    const storage = resolveStorage(target, 'getItem'); const manager = resolveLock(storage, options); let invoked = false;
    const callback = (lock) => { invoked = true; if (lock == null) fail('STORAGE_LOCK_NOT_ACQUIRED', 'exclusive gear mutation lock was not acquired'); assertNoWal(storage); return operation(storage); };
    const verify = (result) => { if (!invoked) fail('STORAGE_LOCK_NOT_ACQUIRED', 'exclusive gear mutation lock callback was not invoked'); return result; };
    const handle = (error) => { if (error instanceof GearPresetStorageError || (error && typeof error.code === 'string')) throw error; fail('STORAGE_LOCK_FAILED', 'could not acquire or run the gear mutation lock', error); };
    try {
      const result = manager.request(LOCK_NAME, { mode: 'exclusive' }, callback);
      return result && typeof result.then === 'function' ? result.then(verify, handle) : verify(result);
    } catch (error) { return handle(error); }
  }
  function publicFailure(error, options) { if (options?.throwSync === true) throw error; return Promise.reject(error); }
  function publicResult(result, options) { return options?.throwSync === true ? result : Promise.resolve(result); }
  function mutateGearPresetsLocked(mutator, target, options = {}) { try { if (typeof mutator !== 'function') fail('INVALID_PRESET_MUTATOR', 'mutator must be a function'); return publicResult(withLock(target, options, (storage) => { const before = load(storage, options); const candidate = mutator(clone(before)); const next = candidate === undefined ? before : candidate; return save(next, storage, options); }), options); } catch (error) { return publicFailure(error, options); } }
  function captureResolvedPresetForBattle(input, target, options = {}) { try { if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CAPTURE_INPUT', 'capture input must be an object'); const hasMode = Object.prototype.hasOwnProperty.call(input, 'mode'); const hasPresetId = Object.prototype.hasOwnProperty.call(input, 'presetId'); if (hasMode === hasPresetId) fail('INVALID_CAPTURE_INPUT', 'capture requires exactly one of mode or presetId'); const allowed = hasMode ? ['characterId', 'mode'] : ['characterId', 'presetId']; if (Object.keys(input).length !== allowed.length || Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_CAPTURE_INPUT', 'capture input has unknown fields'); return publicResult(withLock(target, options, (storage) => { const presetState = load(storage, options); const gearState = gearStorage().loadGearState(storage); const characterIds = options.characterIds; const validateGear = gearDomain().validateGear; return hasPresetId ? presets().resolvePresetLoadout({ presetState, gearState, characterId: input.characterId, presetId: input.presetId, characterIds, validateGear }) : presets().resolveDefaultLoadout({ presetState, gearState, characterId: input.characterId, mode: input.mode, characterIds, validateGear }); }), options); } catch (error) { return publicFailure(error, options); } }
  return Object.freeze({ GearPresetStorageError, STORAGE_KEY, SCHEMA_VERSION, WAL_KEY, LOCK_NAME, load, save, mutateGearPresetsLocked, captureResolvedPresetForBattle });
});
