(function initKatamonGearOnlineBattleDamage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleDamage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleDamage(root) {
  'use strict';

  const ONLINE_GEAR_STATIC_DAMAGE_TYPES = Object.freeze(['direct_projectile', 'normal_blast']);

  class GearOnlineBattleDamageError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineBattleDamageError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineBattleDamageError(code, message); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'unknown or missing fields');
  };

  function combatModule() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-combat.js');
    if (root?.KatamonGearCombat) return root.KatamonGearCombat;
    fail('GEAR_COMBAT_UNAVAILABLE');
  }

  function validateDamageInput(input, keys, code) {
    exact(input, keys, code);
    if (!ONLINE_GEAR_STATIC_DAMAGE_TYPES.includes(input.damageType)) fail('INVALID_ONLINE_GEAR_STATIC_DAMAGE_TYPE');
    if (input.attackerCombat !== null && !plain(input.attackerCombat)) fail('INVALID_ONLINE_GEAR_ATTACKER_COMBAT');
    if (input.defenderCombat !== null && !plain(input.defenderCombat)) fail('INVALID_ONLINE_GEAR_DEFENDER_COMBAT');
    if (!Number.isFinite(input.existingBaseDamage) || input.existingBaseDamage < 0
        || !Number.isFinite(input.targetHp) || input.targetHp < 0) fail(code);
  }

  function calculateRequestedDamage(input, options) {
    const combat = combatModule();
    const outgoing = input.attackerCombat
      ? combat.conditionalDamageModifiers({ combat: input.attackerCombat, damageType: input.damageType })
      : { outgoingDamageBp: 0 };
    const incoming = input.defenderCombat
      ? combat.conditionalDamageModifiers({ combat: input.defenderCombat, damageType: input.damageType })
      : { incomingDamageReductionBp: 0 };
    const resolved = combat.calculateDamagePipeline({
      baseDamage: input.existingBaseDamage,
      attackMultiplier: input.attackerCombat ? input.attackerCombat.attackMultiplier : 1,
      modifierBp: outgoing.outgoingDamageBp + (options.actionDamageBp || 0),
      isCrit: options.isCrit,
      critDamageMultiplier: input.attackerCombat ? input.attackerCombat.critDamageMultiplier : 1.5,
      defenseMultiplier: input.defenderCombat ? input.defenderCombat.defenseMultiplier : 1,
      damageReductionBp: incoming.incomingDamageReductionBp,
      numericShield: 0,
      hp: input.targetHp
    });
    // Preserve the one historic integer HP boundary used by the existing game.
    return Math.max(1, Math.round(resolved.hpDamage));
  }

  // Phase 3D-3B intentionally accepts only the already-reconstructed static
  // Battle Gear combat views. Crit/Blast/runtime state is not an input, so it
  // remains the compatibility API for callers that have not passed the
  // Phase 3D-4B deterministic Crit gate.
  function calculateOnlineGearStaticRequestedDamage(input) {
    validateDamageInput(input,
      ['attackerCombat', 'damageType', 'defenderCombat', 'existingBaseDamage', 'targetHp'],
      'INVALID_ONLINE_GEAR_STATIC_DAMAGE_INPUT');
    return calculateRequestedDamage(input, { isCrit: false });
  }

  // The caller may supply only the boolean outcome of the locally-derived
  // deterministic Crit roll. Crit Damage itself always comes from the
  // immutable reconstructed attacker combat view; Blast/runtime effects are
  // deliberately absent from this ONLINE Phase 3D-4B boundary.
  function calculateOnlineGearCritRequestedDamage(input) {
    validateDamageInput(input,
      ['attackerCombat', 'damageType', 'defenderCombat', 'existingBaseDamage', 'isCrit', 'targetHp'],
      'INVALID_ONLINE_GEAR_CRIT_DAMAGE_INPUT');
    if (typeof input.isCrit !== 'boolean') fail('INVALID_ONLINE_GEAR_CRIT_DAMAGE_INPUT');
    if (!input.attackerCombat) fail('INVALID_ONLINE_GEAR_ATTACKER_COMBAT');
    if (!Number.isFinite(input.attackerCombat.critDamageMultiplier)
        || input.attackerCombat.critDamageMultiplier < 0) fail('INVALID_ONLINE_GEAR_CRIT_DAMAGE_MULTIPLIER');
    return calculateRequestedDamage(input, { isCrit: input.isCrit });
  }

  // Phase 3D-4C keeps the earlier static and Crit APIs unchanged, then adds
  // Blast Power at its canonical position before Attack. Only a normal blast
  // receives the immutable attacker snapshot multiplier; direct projectile
  // damage deliberately remains identical to the Phase 3D-4B path.
  function calculateOnlineGearCritBlastRequestedDamage(input) {
    validateDamageInput(input,
      ['attackerCombat', 'damageType', 'defenderCombat', 'existingBaseDamage', 'isCrit', 'targetHp'],
      'INVALID_ONLINE_GEAR_CRIT_BLAST_DAMAGE_INPUT');
    if (typeof input.isCrit !== 'boolean') fail('INVALID_ONLINE_GEAR_CRIT_BLAST_DAMAGE_INPUT');
    if (!input.attackerCombat) fail('INVALID_ONLINE_GEAR_ATTACKER_COMBAT');
    if (!Number.isFinite(input.attackerCombat.critDamageMultiplier)
        || input.attackerCombat.critDamageMultiplier < 0) fail('INVALID_ONLINE_GEAR_CRIT_DAMAGE_MULTIPLIER');
    if (!Number.isFinite(input.attackerCombat.blastDamageMultiplier)
        || input.attackerCombat.blastDamageMultiplier <= 0) fail('INVALID_ONLINE_GEAR_BLAST_DAMAGE_MULTIPLIER');
    const blastAdjustedBaseDamage = input.damageType === 'normal_blast'
      ? input.existingBaseDamage * input.attackerCombat.blastDamageMultiplier
      : input.existingBaseDamage;
    return calculateRequestedDamage({ ...input, existingBaseDamage: blastAdjustedBaseDamage }, { isCrit: input.isCrit });
  }

  // Phase 3D-7A keeps the three completed compatibility APIs above intact.
  // The action-wide Last Stand bucket is supplied only by the locally captured
  // accepted action context and joins the existing outgoing modifier bucket
  // before Crit, never as a separate post-damage multiplier.
  function calculateOnlineGearRuntimeRequestedDamage(input) {
    validateDamageInput(input,
      ['actionDamageBp', 'attackerCombat', 'damageType', 'defenderCombat', 'existingBaseDamage', 'isCrit', 'targetHp', 'useBlastPower'],
      'INVALID_ONLINE_GEAR_RUNTIME_DAMAGE_INPUT');
    if (typeof input.isCrit !== 'boolean' || typeof input.useBlastPower !== 'boolean' || !Number.isSafeInteger(input.actionDamageBp)
        || input.actionDamageBp < 0 || input.actionDamageBp > 1500) fail('INVALID_ONLINE_GEAR_RUNTIME_DAMAGE_INPUT');
    const blastAdjustedBaseDamage = input.useBlastPower && input.damageType === 'normal_blast' && input.attackerCombat
      ? input.existingBaseDamage * input.attackerCombat.blastDamageMultiplier
      : input.existingBaseDamage;
    if (input.useBlastPower && input.damageType === 'normal_blast' && input.attackerCombat
        && (!Number.isFinite(input.attackerCombat.blastDamageMultiplier) || input.attackerCombat.blastDamageMultiplier <= 0)) {
      fail('INVALID_ONLINE_GEAR_BLAST_DAMAGE_MULTIPLIER');
    }
    return calculateRequestedDamage({ ...input, existingBaseDamage: blastAdjustedBaseDamage }, {
      isCrit: input.isCrit,
      actionDamageBp: input.actionDamageBp
    });
  }

  function isOnlineGearCriticalHit(input) {
    exact(input, ['critRateBp', 'rollBp'], 'INVALID_ONLINE_GEAR_CRIT_ROLL_INPUT');
    if (!Number.isSafeInteger(input.rollBp) || input.rollBp < 0 || input.rollBp >= 10000
        || !Number.isSafeInteger(input.critRateBp) || input.critRateBp < 0 || input.critRateBp > 10000) {
      fail('INVALID_ONLINE_GEAR_CRIT_ROLL_INPUT');
    }
    return input.rollBp < input.critRateBp;
  }

  return Object.freeze({
    ONLINE_GEAR_STATIC_DAMAGE_TYPES,
    GearOnlineBattleDamageError,
    calculateOnlineGearStaticRequestedDamage,
    calculateOnlineGearCritRequestedDamage,
    calculateOnlineGearCritBlastRequestedDamage,
    calculateOnlineGearRuntimeRequestedDamage,
    isOnlineGearCriticalHit
  });
});
