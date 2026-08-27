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

  // Phase 3D-3B intentionally accepts only the already-reconstructed static
  // Battle Gear combat views. Crit/Blast/runtime state is not an input, so it
  // cannot be activated early by this ONLINE adapter.
  function calculateOnlineGearStaticRequestedDamage(input) {
    exact(input, ['attackerCombat', 'damageType', 'defenderCombat', 'existingBaseDamage', 'targetHp'], 'INVALID_ONLINE_GEAR_STATIC_DAMAGE_INPUT');
    if (!ONLINE_GEAR_STATIC_DAMAGE_TYPES.includes(input.damageType)) fail('INVALID_ONLINE_GEAR_STATIC_DAMAGE_TYPE');
    if (input.attackerCombat !== null && !plain(input.attackerCombat)) fail('INVALID_ONLINE_GEAR_ATTACKER_COMBAT');
    if (input.defenderCombat !== null && !plain(input.defenderCombat)) fail('INVALID_ONLINE_GEAR_DEFENDER_COMBAT');
    if (!Number.isFinite(input.existingBaseDamage) || input.existingBaseDamage < 0
        || !Number.isFinite(input.targetHp) || input.targetHp < 0) fail('INVALID_ONLINE_GEAR_STATIC_DAMAGE_INPUT');

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
      modifierBp: outgoing.outgoingDamageBp,
      isCrit: false,
      defenseMultiplier: input.defenderCombat ? input.defenderCombat.defenseMultiplier : 1,
      damageReductionBp: incoming.incomingDamageReductionBp,
      numericShield: 0,
      hp: input.targetHp
    });
    // Preserve the one historic integer HP boundary used by the existing game.
    return Math.max(1, Math.round(resolved.hpDamage));
  }

  return Object.freeze({
    ONLINE_GEAR_STATIC_DAMAGE_TYPES,
    GearOnlineBattleDamageError,
    calculateOnlineGearStaticRequestedDamage
  });
});
