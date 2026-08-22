(function attachCoopItems(root, factory) {
  const survivalApi = typeof module === 'object' && module.exports
    ? require('./coop-mvp-survival.js') : root?.KatamonCoopSurvival;
  const api = factory(survivalApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopItems = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopItems(survival) {
  'use strict';

  const HEALING_USES = 2;
  const HEALING_RATIO = 0.3;
  const DEBUFF_USES = 1;
  const DEBUFF_MULTIPLIER = 1.25;
  const DEBUFF_DURATION_ROUNDS = 1;
  const ITEM_PROJECTILES = Object.freeze({
    healing: Object.freeze({ ...survival.SUPPORT_PROJECTILE_PROFILE, guideColor: '#74d98b' }),
    debuff: Object.freeze({ ...survival.SUPPORT_PROJECTILE_PROFILE, guideColor: '#a873ff' }),
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function fireHealingShot(party, shooterSeat, impact, round, hitRadius = 28) {
    const next = clone(party);
    const shooter = next.players?.[shooterSeat];
    if (!shooter || !survival.canAct(shooter, round)) {
      return { party: next, consumed: false, healedSeat: null, healedAmount: 0, reason: 'cannot-act' };
    }
    if (shooter.itemUses.healing <= 0) {
      return { party: next, consumed: false, healedSeat: null, healedAmount: 0, reason: 'no-uses' };
    }
    shooter.itemUses.healing -= 1;
    const radius = Math.max(0, finite(hitRadius, 28));
    const x = finite(impact?.x, 0);
    const y = finite(impact?.y, 0);
    const candidates = Object.keys(next.players).filter((seat) => seat !== shooterSeat).map((seat) => {
      const player = next.players[seat];
      return { seat, player, distance: Math.hypot(player.x - x, player.y - y) };
    }).filter((entry) => entry.player.status === 'alive' && entry.player.hp > 0
      && entry.player.hp < entry.player.maxHp && entry.distance <= radius)
      .sort((left, right) => left.distance - right.distance || left.seat.localeCompare(right.seat));
    if (!candidates.length) {
      return { party: next, consumed: true, healedSeat: null, healedAmount: 0, reason: 'no-valid-ally' };
    }
    const target = candidates[0].player;
    const healedAmount = Math.min(target.maxHp - target.hp, target.maxHp * HEALING_RATIO);
    target.hp += healedAmount;
    return { party: next, consumed: true, healedSeat: candidates[0].seat, healedAmount, reason: 'healed' };
  }

  function createSupportState() {
    return {
      bossVulnerability: {
        active: false,
        multiplier: 1,
        beginsOnRound: null,
        endsOnRound: null,
      },
    };
  }

  function fireDebuffShot(party, support, shooterSeat, hitBoss, round) {
    const nextParty = clone(party);
    const nextSupport = clone(support || createSupportState());
    const shooter = nextParty.players?.[shooterSeat];
    if (!shooter || !survival.canAct(shooter, round)) {
      return { party: nextParty, support: nextSupport, consumed: false, applied: false, reason: 'cannot-act' };
    }
    if (shooter.itemUses.debuff <= 0) {
      return { party: nextParty, support: nextSupport, consumed: false, applied: false, reason: 'no-uses' };
    }
    shooter.itemUses.debuff -= 1;
    if (hitBoss !== true) {
      return { party: nextParty, support: nextSupport, consumed: true, applied: false, reason: 'missed' };
    }
    const begins = Math.max(1, Math.trunc(finite(round, 1)) + 1);
    nextSupport.bossVulnerability = {
      active: true,
      multiplier: DEBUFF_MULTIPLIER,
      beginsOnRound: begins,
      endsOnRound: begins + DEBUFF_DURATION_ROUNDS - 1,
    };
    return { party: nextParty, support: nextSupport, consumed: true, applied: true, reason: 'applied' };
  }

  function bossDamageMultiplier(support, round) {
    const effect = support?.bossVulnerability;
    const current = Number(round);
    return effect?.active && current >= effect.beginsOnRound && current <= effect.endsOnRound
      ? effect.multiplier : 1;
  }

  function scaleBossDamage(support, round, damage) {
    return Math.max(0, finite(damage, 0)) * bossDamageMultiplier(support, round);
  }

  function finishSupportRound(support, round) {
    const next = clone(support || createSupportState());
    if (next.bossVulnerability.active && Number(round) >= next.bossVulnerability.endsOnRound) {
      next.bossVulnerability = createSupportState().bossVulnerability;
    }
    return next;
  }

  function nonTargetImpactEffect() {
    return {
      selfEffect: 0,
      downedAllyEffect: 0,
      enemyEffect: 0,
      bossDamage: 0,
      terrainDamage: 0,
    };
  }

  return Object.freeze({
    HEALING_USES,
    HEALING_RATIO,
    DEBUFF_USES,
    DEBUFF_MULTIPLIER,
    DEBUFF_DURATION_ROUNDS,
    ITEM_PROJECTILES,
    fireHealingShot,
    createSupportState,
    fireDebuffShot,
    bossDamageMultiplier,
    scaleBossDamage,
    finishSupportRound,
    nonTargetImpactEffect,
  });
});
