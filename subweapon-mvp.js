(function attachKatamonSubweapons(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonSubweapons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonSubweapons() {
  'use strict';

  const USES_PER_MATCH = 1;
  const GUIDE_COLOR = '#f29a38';
  const BARRIER_DAMAGE_RATIO = 0.5;
  const IMPACT_DAMAGE = 25;
  const IMPACT_KNOCKBACK_SPEED = 160;
  const DRILL_DAMAGE = 15;
  const DRILL_TERRAIN_RADIUS = 88;
  const SUBWEAPON_IDS = Object.freeze(['barrier', 'impact', 'drill']);
  const PROJECTILE_PHYSICS = Object.freeze({
    gravity: 650,
    velocityScale: 7.8,
    affectedByWind: true,
    guide: 'normal',
  });
  const PROJECTILES = Object.freeze({
    impact: Object.freeze({
      ...PROJECTILE_PHYSICS,
      guideColor: GUIDE_COLOR,
      damage: IMPACT_DAMAGE,
      knockbackSpeed: IMPACT_KNOCKBACK_SPEED,
      terrainRadius: 0,
    }),
    drill: Object.freeze({
      ...PROJECTILE_PHYSICS,
      guideColor: GUIDE_COLOR,
      damage: DRILL_DAMAGE,
      knockbackSpeed: 0,
      terrainRadius: DRILL_TERRAIN_RADIUS,
    }),
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function validId(id) {
    return SUBWEAPON_IDS.includes(id);
  }

  function createMatchState(equipment) {
    const players = {};
    Object.entries(equipment || {}).forEach(([seat, id]) => {
      players[seat] = {
        equipped: validId(id) ? id : null,
        usesLeft: validId(id) ? USES_PER_MATCH : 0,
        barrierActive: false,
      };
    });
    return { players };
  }

  function canUse(state, seat, requestedId) {
    const player = state?.players?.[seat];
    return !!player && player.equipped === requestedId && player.usesLeft > 0;
  }

  function activateBarrier(state, seat) {
    const next = clone(state);
    const player = next.players?.[seat];
    if (!canUse(next, seat, 'barrier')) {
      return { state: next, consumed: false, activated: false, reason: 'unavailable' };
    }
    player.usesLeft -= 1;
    player.barrierActive = true;
    return { state: next, consumed: true, activated: true, reason: 'activated' };
  }

  function applyIncomingDamage(state, seat, damage) {
    const next = clone(state);
    const player = next.players?.[seat];
    const requested = Math.max(0, finite(damage, 0));
    if (!player?.barrierActive || requested <= 0) {
      return { state: next, damage: requested, blocked: 0, barrierConsumed: false };
    }
    const reduced = requested * BARRIER_DAMAGE_RATIO;
    player.barrierActive = false;
    return {
      state: next,
      damage: reduced,
      blocked: requested - reduced,
      barrierConsumed: true,
    };
  }

  function fireProjectile(state, seat, id) {
    const next = clone(state);
    const player = next.players?.[seat];
    if ((id !== 'impact' && id !== 'drill') || !canUse(next, seat, id)) {
      return { state: next, consumed: false, projectile: null, reason: 'unavailable' };
    }
    player.usesLeft -= 1;
    return { state: next, consumed: true, projectile: PROJECTILES[id], reason: 'fired' };
  }

  function equipmentChangedAfterReady(previous, next) {
    const before = validId(previous) ? previous : null;
    const after = validId(next) ? next : null;
    return before !== after;
  }

  return Object.freeze({
    USES_PER_MATCH,
    GUIDE_COLOR,
    BARRIER_DAMAGE_RATIO,
    IMPACT_DAMAGE,
    IMPACT_KNOCKBACK_SPEED,
    DRILL_DAMAGE,
    DRILL_TERRAIN_RADIUS,
    SUBWEAPON_IDS,
    PROJECTILES,
    createMatchState,
    canUse,
    activateBarrier,
    applyIncomingDamage,
    fireProjectile,
    equipmentChangedAfterReady,
  });
});
