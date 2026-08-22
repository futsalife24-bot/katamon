(function attachCoopMvpEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopMvpEngine() {
  'use strict';

  const INPUT_TIME_MS = 30000;
  const VOLLEY_INTERVAL_MS = 150;
  const MOVE_SYNC_INTERVAL_MS = 250;
  const MOVE_SYNC_MIN_DISTANCE = 8;
  const AI_FINALIZE_WINDOW_MS = 5000;
  const VOLLEY_ORDER = Object.freeze(['p1', 'e1', 's1', 's2']);
  const SEAT_SET = new Set(VOLLEY_ORDER);
  const WEAPON_KINDS = new Set(['normal', 'special', 'subweapon', 'coopItem']);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function assertRound(round) {
    if (!round || typeof round !== 'object' || round.phase !== 'input') {
      throw new Error('round is not accepting input');
    }
  }

  function assertSeat(round, seat) {
    if (!SEAT_SET.has(seat) || !round.seats[seat]) throw new Error('unknown seat');
  }

  function sanitizeWind(wind) {
    return {
      direction: Math.max(-1, Math.min(1, finiteNumber(wind?.direction, 0))),
      strength: Math.max(0, Math.min(10, finiteNumber(wind?.strength, 0))),
    };
  }

  function defaultDraft() {
    return {
      x: 0,
      fuelSpent: 0,
      aim: { x: 0, y: 0 },
      weapon: { kind: 'normal', id: 'normal' },
      updatedAt: 0,
    };
  }

  function sanitizeWeapon(value, fallback) {
    if (!value || !WEAPON_KINDS.has(value.kind) || typeof value.id !== 'string' || !value.id) {
      return clone(fallback);
    }
    return { kind: value.kind, id: value.id.slice(0, 40) };
  }

  function sanitizeDraft(previous, patch, now) {
    const prior = previous || defaultDraft();
    const next = clone(prior);
    if (Object.prototype.hasOwnProperty.call(patch, 'x')) {
      next.x = Math.max(-1000, Math.min(2440, finiteNumber(patch.x, prior.x)));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fuelSpent')) {
      const requested = Math.max(0, Math.min(10000, finiteNumber(patch.fuelSpent, prior.fuelSpent)));
      next.fuelSpent = Math.max(prior.fuelSpent, requested);
    }
    if (patch.aim && typeof patch.aim === 'object') {
      next.aim = {
        x: Math.max(-1000, Math.min(2440, finiteNumber(patch.aim.x, prior.aim.x))),
        y: Math.max(-1000, Math.min(1960, finiteNumber(patch.aim.y, prior.aim.y))),
      };
    }
    if (patch.weapon) next.weapon = sanitizeWeapon(patch.weapon, prior.weapon);
    next.updatedAt = finiteNumber(now, prior.updatedAt);
    return next;
  }

  function createInputRound({ id, seats, wind, nextWind, startedAt }) {
    if (typeof id !== 'string' || !/^[0-9a-f]{48}$/.test(id)) throw new Error('invalid round id');
    if (!seats || typeof seats !== 'object' || !seats.p1) throw new Error('p1 seat is required');
    const acceptedSeats = {};
    VOLLEY_ORDER.forEach((seat) => {
      if (seats[seat]) acceptedSeats[seat] = clone(seats[seat]);
    });
    const start = finiteNumber(startedAt, 0);
    return {
      id,
      phase: 'input',
      startedAt: start,
      deadlineAt: start + INPUT_TIME_MS,
      seats: acceptedSeats,
      wind: sanitizeWind(wind),
      nextWind: sanitizeWind(nextWind),
      drafts: {},
      commits: {},
    };
  }

  function updateDraft(round, seat, patch, now) {
    assertRound(round);
    assertSeat(round, seat);
    if (round.commits[seat]) throw new Error('seat already committed');
    if (finiteNumber(now, 0) >= round.deadlineAt) throw new Error('input deadline passed');
    const next = clone(round);
    next.drafts[seat] = sanitizeDraft(next.drafts[seat], patch || {}, now);
    return next;
  }

  function commitAction(round, seat, now, auto = false) {
    assertRound(round);
    assertSeat(round, seat);
    if (round.commits[seat]) return clone(round);
    const next = clone(round);
    const draft = sanitizeDraft(next.drafts[seat], {}, now);
    next.drafts[seat] = draft;
    next.commits[seat] = {
      x: draft.x,
      fuelSpent: draft.fuelSpent,
      aim: clone(draft.aim),
      weapon: clone(draft.weapon),
      committedAt: finiteNumber(now, round.deadlineAt),
      auto: auto === true,
    };
    return next;
  }

  function requiredSeats(round) {
    return VOLLEY_ORDER.filter((seat) => Boolean(round.seats[seat]));
  }

  function allRequiredReady(round) {
    return requiredSeats(round).every((seat) => Boolean(round.commits[seat]));
  }

  function humansReady(round) {
    return requiredSeats(round)
      .filter((seat) => round.seats[seat].ai !== true)
      .every((seat) => Boolean(round.commits[seat]));
  }

  function shouldFinalizeAi(round, now) {
    const pendingAi = requiredSeats(round).some((seat) => round.seats[seat].ai === true && !round.commits[seat]);
    if (!pendingAi) return false;
    return humansReady(round) || round.deadlineAt - finiteNumber(now, 0) <= AI_FINALIZE_WINDOW_MS;
  }

  function autoCommitExpired(round, now) {
    if (finiteNumber(now, 0) < round.deadlineAt) return clone(round);
    let next = clone(round);
    requiredSeats(next).forEach((seat) => {
      if (!next.commits[seat]) next = commitAction(next, seat, now, true);
    });
    return next;
  }

  function buildVolley(round, startedAt) {
    if (!allRequiredReady(round)) throw new Error('all required seats must be committed');
    const base = finiteNumber(startedAt, 0);
    return {
      roundId: round.id,
      phase: 'volley',
      startedAt: base,
      wind: clone(round.wind),
      nextWind: clone(round.nextWind),
      projectilesCollide: false,
      actions: requiredSeats(round).map((seat, index) => ({
        seat,
        scheduledAt: base + index * VOLLEY_INTERVAL_MS,
        wind: clone(round.wind),
        ...clone(round.commits[seat]),
      })),
    };
  }

  function shouldSyncMove(previous, current, now, finalSync) {
    if (finalSync === true) return true;
    if (!previous || !current) return true;
    const elapsed = finiteNumber(now, 0) - finiteNumber(previous.sentAt, 0);
    const distance = Math.abs(finiteNumber(current.x, 0) - finiteNumber(previous.x, 0));
    return elapsed >= MOVE_SYNC_INTERVAL_MS && distance >= MOVE_SYNC_MIN_DISTANCE;
  }

  function friendlyFireEffect({ damage, knockback, terrainRadius }) {
    return {
      damage: finiteNumber(damage, 0) * 0.5,
      knockback: finiteNumber(knockback, 0),
      terrainRadius: finiteNumber(terrainRadius, 0),
    };
  }

  function supportFireEffect() {
    return { damage: 0, knockback: 0, hostile: false };
  }

  function advanceWind(volley, nextWind) {
    if (!volley || !volley.nextWind) throw new Error('volley wind is missing');
    return { wind: sanitizeWind(volley.nextWind), nextWind: sanitizeWind(nextWind) };
  }

  return Object.freeze({
    INPUT_TIME_MS,
    VOLLEY_INTERVAL_MS,
    MOVE_SYNC_INTERVAL_MS,
    MOVE_SYNC_MIN_DISTANCE,
    AI_FINALIZE_WINDOW_MS,
    VOLLEY_ORDER,
    createInputRound,
    updateDraft,
    commitAction,
    allRequiredReady,
    humansReady,
    shouldFinalizeAi,
    autoCommitExpired,
    buildVolley,
    shouldSyncMove,
    friendlyFireEffect,
    supportFireEffect,
    advanceWind,
  });
});
