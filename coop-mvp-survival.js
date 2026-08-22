(function attachCoopSurvival(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopSurvival = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopSurvival() {
  'use strict';

  const RESCUE_USES = 1;
  const REVIVE_RATIO = 0.3;
  const UNIT_RADIUS = 18;
  const SUPPORT_PROJECTILE_PROFILE = Object.freeze({
    gravity: 650,
    velocityScale: 7.8,
    affectedByWind: true,
    guide: 'normal',
    terrainCollision: true,
    terrainDamage: 0,
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function initialUses(coopItem) {
    return {
      rescue: coopItem === 'rescue-kit' ? RESCUE_USES : 0,
      healing: coopItem === 'healing-kit' ? 2 : 0,
      debuff: coopItem === 'debuff-grenade' ? 1 : 0,
    };
  }

  function createParty(seats, round = 1) {
    const players = {};
    Object.keys(seats || {}).forEach((seat) => {
      const source = seats[seat] || {};
      const maxHp = Math.max(1, finite(source.maxHp, 300));
      const coopItem = source.coopItem || 'rescue-kit';
      players[seat] = {
        seat,
        maxHp,
        hp: Math.max(0, Math.min(maxHp, finite(source.hp, maxHp))),
        status: source.status === 'down' || finite(source.hp, maxHp) <= 0 ? 'down' : 'alive',
        x: finite(source.x, 0),
        y: finite(source.y, 0),
        coopItem,
        itemUses: initialUses(coopItem),
        revivedOnRound: null,
      };
      if (players[seat].status === 'down') players[seat].hp = 0;
    });
    return { round: Math.max(1, Math.trunc(finite(round, 1))), players };
  }

  function canAct(player, round) {
    if (!player || player.status !== 'alive' || player.hp <= 0) return false;
    return player.revivedOnRound == null || Number(round) > player.revivedOnRound;
  }

  function normalizeKnockback(knockback) {
    return {
      x: finite(knockback?.x, 0),
      y: finite(knockback?.y, 0),
    };
  }

  function applyPlayerDamage(party, seat, effect = {}) {
    const next = clone(party);
    const player = next.players?.[seat];
    if (!player) return { party: next, hpDamage: 0, knockback: normalizeKnockback(effect.knockback), downedNow: false };
    const knockback = normalizeKnockback(effect.knockback);
    player.x += knockback.x;
    player.y += knockback.y;
    if (player.status === 'down') return { party: next, hpDamage: 0, knockback, downedNow: false };
    const requested = Math.max(0, finite(effect.damage, 0));
    const hpDamage = Math.min(player.hp, requested);
    player.hp = Math.max(0, player.hp - hpDamage);
    const downedNow = player.hp === 0;
    if (downedNow) {
      player.status = 'down';
      player.revivedOnRound = null;
    }
    return { party: next, hpDamage, knockback, downedNow };
  }

  function normalBossTargets(party) {
    return Object.keys(party?.players || {}).filter((seat) => party.players[seat].status === 'alive');
  }

  function areaBossTargets(party) {
    return Object.keys(party?.players || {});
  }

  function isAllDownDefeat(party) {
    const players = Object.values(party?.players || {});
    return players.length > 0 && players.every((player) => player.status === 'down' || player.hp <= 0);
  }

  function landingAtColumn(stage, column, unitRadius) {
    const columns = stage?.segments;
    const width = Math.max(1, finite(stage?.columnWidth, 3));
    if (!Array.isArray(columns) || column < 0 || column >= columns.length) return null;
    const candidateX = column * width + width / 2;
    const bossPlacement = stage?.boss;
    if (bossPlacement && candidateX + unitRadius >= bossPlacement.x
      && candidateX - unitRadius <= bossPlacement.x + bossPlacement.width) return null;
    const segment = columns[column]?.[0];
    if (!segment || !Number.isFinite(segment[0])) return null;
    const top = segment[0];
    const halfColumns = Math.max(1, Math.ceil(unitRadius / width));
    for (let offset = -halfColumns; offset <= halfColumns; offset += 1) {
      const nearby = columns[column + offset]?.[0];
      if (!nearby || Math.abs(nearby[0] - top) > unitRadius) return null;
    }
    return { x: candidateX, y: top - unitRadius };
  }

  function nearestSafeLanding(stage, x, unitRadius = UNIT_RADIUS) {
    const columns = stage?.segments;
    if (!Array.isArray(columns) || !columns.length) return null;
    const width = Math.max(1, finite(stage.columnWidth, 3));
    const origin = Math.max(0, Math.min(columns.length - 1, Math.round(finite(x, 0) / width)));
    for (let distance = 0; distance < columns.length; distance += 1) {
      const candidates = distance === 0 ? [origin] : [origin - distance, origin + distance];
      for (const column of candidates) {
        const landing = landingAtColumn(stage, column, unitRadius);
        if (landing) return landing;
      }
    }
    return null;
  }

  function relocateFromDeadLine(party, seat, stage) {
    const next = clone(party);
    const player = next.players?.[seat];
    if (!player || player.y < finite(stage?.terrainBottom, 636)) {
      return { party: next, relocated: false, usedFallback: false };
    }
    const safe = nearestSafeLanding(stage, player.x, UNIT_RADIUS);
    let landing = safe;
    let usedFallback = false;
    if (!landing) {
      const fallback = stage?.rescuePlatform;
      landing = {
        x: finite(fallback?.x, 0) + finite(fallback?.width, 120) / 2,
        y: finite(fallback?.y, finite(stage?.terrainBottom, 636) - 48) - UNIT_RADIUS,
      };
      usedFallback = true;
    }
    player.x = landing.x;
    player.y = landing.y;
    player.hp = 0;
    player.status = 'down';
    return { party: next, relocated: true, usedFallback };
  }

  function fireRescueShot(party, shooterSeat, impact, round, rescueRadius = 48) {
    const next = clone(party);
    const shooter = next.players?.[shooterSeat];
    if (!shooter || !canAct(shooter, round)) return { party: next, consumed: false, rescuedSeat: null, reason: 'cannot-act' };
    if (shooter.itemUses.rescue <= 0) return { party: next, consumed: false, rescuedSeat: null, reason: 'no-uses' };
    shooter.itemUses.rescue -= 1;
    const radius = Math.max(0, finite(rescueRadius, 48));
    const candidates = Object.keys(next.players).filter((seat) => seat !== shooterSeat).map((seat) => {
      const player = next.players[seat];
      return { seat, player, distance: Math.hypot(player.x - finite(impact?.x, 0), player.y - finite(impact?.y, 0)) };
    }).filter((entry) => entry.player.status === 'down' && entry.distance <= radius)
      .sort((left, right) => left.distance - right.distance || left.seat.localeCompare(right.seat));
    if (!candidates.length) return { party: next, consumed: true, rescuedSeat: null, reason: 'no-downed-ally' };
    const target = candidates[0].player;
    target.hp = target.maxHp * REVIVE_RATIO;
    target.status = 'alive';
    target.revivedOnRound = Number(round);
    return { party: next, consumed: true, rescuedSeat: candidates[0].seat, reason: 'rescued' };
  }

  function supportImpactEffect() {
    return { bossDamage: 0, enemyDamage: 0, terrainDamage: 0 };
  }

  function startRound(party, round) {
    const next = clone(party);
    next.round = Math.max(1, Math.trunc(finite(round, next.round || 1)));
    return next;
  }

  return Object.freeze({
    RESCUE_USES,
    REVIVE_RATIO,
    UNIT_RADIUS,
    SUPPORT_PROJECTILE_PROFILE,
    createParty,
    canAct,
    applyPlayerDamage,
    normalBossTargets,
    areaBossTargets,
    isAllDownDefeat,
    nearestSafeLanding,
    relocateFromDeadLine,
    fireRescueShot,
    supportImpactEffect,
    startRound,
  });
});
