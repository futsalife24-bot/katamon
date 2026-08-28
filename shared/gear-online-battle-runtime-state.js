(function initKatamonGearOnlineBattleRuntimeState(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleRuntimeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleRuntimeState(root) {
  'use strict';

  const ONLINE_GEAR_RUNTIME_STATE_VERSION = 3;
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
  function immutableSnapshot(snapshot, unitId) {
    if (!snapshot || !Object.isFrozen(snapshot) || !snapshot.derivedStats || !Object.isFrozen(snapshot.derivedStats)) fail('ONLINE_GEAR_RUNTIME_STATE_SNAPSHOT_INVALID', `${unitId} snapshot`);
    return snapshot;
  }
  function maximumLegalCurrentShieldForRuntimeV3(snapshot, unitId) {
    const initial = combat().initialShieldFromSets(immutableSnapshot(snapshot, unitId).derivedStats);
    if (!initial || !Number.isFinite(initial.shieldAfter) || initial.shieldAfter < 0) fail('ONLINE_GEAR_RUNTIME_STATE_SNAPSHOT_INVALID', `${unitId} initialShield`);
    // v3 still has no Shield-gain producer. Its ceiling is the canonical
    // initial remainder, never the generic 35%-of-HP cap.
    return initial.shieldAfter;
  }
  function validateShieldByUnit(value, { snapshots, unitIds, localShieldState }) {
    exact(value, unitIds, 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
    const shieldByUnit = {};
    for (const unitId of unitIds) {
      const entry = value[unitId]; exact(entry, ['currentShield'], 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
      const currentShield = entry.currentShield;
      const ceiling = maximumLegalCurrentShieldForRuntimeV3(snapshots[unitId], unitId);
      if (!Number.isFinite(currentShield) || currentShield < 0 || currentShield > ceiling + EPSILON) fail('INVALID_ONLINE_GEAR_RUNTIME_STATE', `${unitId} currentShield`);
      if (localShieldState && currentShield > localShieldState[unitId]?.currentShield + EPSILON) fail('ONLINE_GEAR_RUNTIME_STATE_ROLLBACK', `${unitId} currentShield`);
      shieldByUnit[unitId] = { currentShield };
    }
    return freeze(shieldByUnit);
  }
  function validateRuntimeEffectsByUnit(value, { snapshots, unitIds }) {
    exact(value, unitIds, 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
    const runtimeEffectsByUnit = {};
    for (const unitId of unitIds) {
      const snapshot = immutableSnapshot(snapshots[unitId], unitId);
      // resolveRuntimeEffects validates through the canonical private
      // runtimeState() helper without creating a damage event.
      runtimeEffectsByUnit[unitId] = combat().resolveRuntimeEffects({
        combat: snapshot.derivedStats,
        state: value[unitId],
        currentHp: snapshot.derivedStats.maxHp
      }).state;
    }
    return freeze(runtimeEffectsByUnit);
  }
  function assertEffectsExactlyMatch(incoming, local, unitIds) {
    if (!local) return;
    for (const unitId of unitIds) {
      const next = incoming[unitId]; const current = local[unitId];
      if (!current || next.rescueNextAttackDamageBp !== current.rescueNextAttackDamageBp || next.lastStandNextAttackDamageBp !== current.lastStandNextAttackDamageBp) fail('ONLINE_GEAR_RUNTIME_EFFECTS_MISMATCH', unitId);
    }
  }
  function validateRuntimeState(value, { snapshots, localShieldState = null, localRuntimeEffectsState = null, expectedMatchFormat = null } = {}) {
    exact(value, ['matchFormat', 'runtimeEffectsByUnit', 'shieldByUnit', 'version'], 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
    if (value.version !== ONLINE_GEAR_RUNTIME_STATE_VERSION) fail('UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE');
    if (expectedMatchFormat !== null && value.matchFormat !== expectedMatchFormat) fail('ONLINE_GEAR_RUNTIME_STATE_FORMAT_MISMATCH');
    const unitIds = UNIT_IDS_BY_FORMAT[value.matchFormat];
    if (!unitIds || !snapshots || !Object.isFrozen(snapshots)) fail('INVALID_ONLINE_GEAR_RUNTIME_STATE');
    // The local value is a security boundary too. Validate it before using it
    // as a monotonic fence; malformed local state must not weaken rollback
    // detection by producing an implicit undefined/NaN comparison.
    const localShield = localShieldState !== null && localShieldState !== undefined
      ? validateShieldByUnit(localShieldState, { snapshots, unitIds, localShieldState: null })
      : null;
    const shieldByUnit = validateShieldByUnit(value.shieldByUnit, { snapshots, unitIds, localShieldState: localShield });
    const runtimeEffectsByUnit = validateRuntimeEffectsByUnit(value.runtimeEffectsByUnit, { snapshots, unitIds });
    if (localRuntimeEffectsState !== null && localRuntimeEffectsState !== undefined) {
      const local = validateRuntimeEffectsByUnit(localRuntimeEffectsState, { snapshots, unitIds });
      assertEffectsExactlyMatch(runtimeEffectsByUnit, local, unitIds);
    }
    return freeze({ version: ONLINE_GEAR_RUNTIME_STATE_VERSION, matchFormat: value.matchFormat, shieldByUnit, runtimeEffectsByUnit });
  }
  function createRuntimeState({ shieldStateByUnit, runtimeEffectsStateByUnit, snapshots, matchFormat }) {
    const unitIds = UNIT_IDS_BY_FORMAT[matchFormat];
    if (!unitIds || !shieldStateByUnit || !runtimeEffectsStateByUnit) fail('INVALID_ONLINE_GEAR_RUNTIME_STATE');
    return validateRuntimeState({
      version: ONLINE_GEAR_RUNTIME_STATE_VERSION,
      matchFormat,
      shieldByUnit: Object.fromEntries(unitIds.map(unitId => [unitId, { currentShield: shieldStateByUnit[unitId]?.currentShield }])),
      runtimeEffectsByUnit: Object.fromEntries(unitIds.map(unitId => [unitId, runtimeEffectsStateByUnit[unitId]]))
    }, { snapshots, expectedMatchFormat: matchFormat });
  }
  function restoreRuntimeState(runtimeState, context) {
    const checked = validateRuntimeState(runtimeState, context);
    return freeze({ shieldStateByUnit: checked.shieldByUnit, runtimeEffectsStateByUnit: checked.runtimeEffectsByUnit });
  }
  return freeze({ ONLINE_GEAR_RUNTIME_STATE_VERSION, validateRuntimeState, createRuntimeState, restoreRuntimeState });
});
