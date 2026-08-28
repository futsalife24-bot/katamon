(function initKatamonGearOnlineBattleRuntimeState(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleRuntimeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleRuntimeState(root) {
  'use strict';

  const ONLINE_GEAR_RUNTIME_STATE_VERSION = 2;
  const UNIT_IDS_BY_FORMAT = Object.freeze({ '1v1': Object.freeze(['p1', 'e1']), '2v2': Object.freeze(['p1', 'e1', 'p2', 'e2']) });
  const EPSILON = 1e-9;
  class GearOnlineBattleRuntimeStateError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineBattleRuntimeStateError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineBattleRuntimeStateError(code, message); };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code);
  };
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  function combat() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-combat.js');
    if (root?.KatamonGearCombat) return root.KatamonGearCombat;
    fail('ONLINE_GEAR_RUNTIME_STATE_MODULE_MISSING');
  }
  function maximumLegalCurrentShieldForRuntimeV2(snapshot, unitId) {
    if (!snapshot || !Object.isFrozen(snapshot) || !snapshot.derivedStats || !Object.isFrozen(snapshot.derivedStats)) {
      fail('ONLINE_GEAR_RUNTIME_STATE_SNAPSHOT_INVALID', `${unitId} snapshot`);
    }
    const initial = combat().initialShieldFromSets(snapshot.derivedStats);
    // Runtime v2 has no Shield-gain event.  The legal ceiling is therefore
    // the actual canonical start remainder, not the generic 35%-of-HP cap
    // that a future Shield gain could theoretically reach.
    if (!initial || !Number.isFinite(initial.shieldAfter) || initial.shieldAfter < 0) fail('ONLINE_GEAR_RUNTIME_STATE_SNAPSHOT_INVALID', `${unitId} initialShield`);
    return initial.shieldAfter;
  }
  function validateRuntimeState(value, { snapshots, localState = null } = {}) {
    exact(value, ['matchFormat', 'shieldByUnit', 'version'], 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
    if (value.version !== ONLINE_GEAR_RUNTIME_STATE_VERSION) fail('UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE');
    const unitIds = UNIT_IDS_BY_FORMAT[value.matchFormat];
    if (!unitIds) fail('INVALID_ONLINE_GEAR_RUNTIME_STATE');
    exact(value.shieldByUnit, unitIds, 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
    if (!snapshots || !Object.isFrozen(snapshots)) fail('ONLINE_GEAR_RUNTIME_STATE_SNAPSHOT_INVALID');
    const localRuntimeState = localState && !Object.prototype.hasOwnProperty.call(localState, 'shieldByUnit')
      ? { version: ONLINE_GEAR_RUNTIME_STATE_VERSION, matchFormat: value.matchFormat, shieldByUnit: localState }
      : localState;
    if (localRuntimeState !== null && localRuntimeState !== undefined) {
      // Validate the local representation too: accepting an arbitrary mutable
      // local value would make the monotonic fence meaningless.
      validateRuntimeState(localRuntimeState, { snapshots, localState: null });
    }
    const shieldByUnit = {};
    for (const unitId of unitIds) {
      const entry = value.shieldByUnit[unitId];
      exact(entry, ['currentShield'], 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
      const currentShield = entry.currentShield;
      const maximumLegalCurrentShield = maximumLegalCurrentShieldForRuntimeV2(snapshots[unitId], unitId);
      if (!Number.isFinite(currentShield) || currentShield < 0 || currentShield > maximumLegalCurrentShield + EPSILON) {
        fail('INVALID_ONLINE_GEAR_RUNTIME_STATE', `${unitId} currentShield`);
      }
      if (localRuntimeState && currentShield > localRuntimeState.shieldByUnit[unitId].currentShield + EPSILON) {
        fail('ONLINE_GEAR_RUNTIME_STATE_ROLLBACK', `${unitId} currentShield`);
      }
      shieldByUnit[unitId] = { currentShield };
    }
    return freeze({ version: ONLINE_GEAR_RUNTIME_STATE_VERSION, matchFormat: value.matchFormat, shieldByUnit });
  }
  function createRuntimeState({ shieldStateByUnit, snapshots, matchFormat }) {
    if (!shieldStateByUnit || typeof shieldStateByUnit !== 'object') fail('INVALID_ONLINE_GEAR_RUNTIME_STATE');
    const unitIds = UNIT_IDS_BY_FORMAT[matchFormat];
    if (!unitIds) fail('INVALID_ONLINE_GEAR_RUNTIME_STATE');
    const raw = {
      version: ONLINE_GEAR_RUNTIME_STATE_VERSION,
      matchFormat,
      shieldByUnit: Object.fromEntries(unitIds.map(unitId => [unitId, { currentShield: shieldStateByUnit[unitId]?.currentShield }]))
    };
    return validateRuntimeState(raw, { snapshots });
  }
  function restoreShieldState(runtimeState, context) {
    const checked = validateRuntimeState(runtimeState, context);
    return freeze(Object.fromEntries(UNIT_IDS_BY_FORMAT[checked.matchFormat].map(unitId => [unitId, freeze({ currentShield: checked.shieldByUnit[unitId].currentShield })])));
  }
  return freeze({ ONLINE_GEAR_RUNTIME_STATE_VERSION, validateRuntimeState, createRuntimeState, restoreShieldState });
});
