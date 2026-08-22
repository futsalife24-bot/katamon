(function attachCoopSession(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopSession() {
  'use strict';

  const REMATCH_WINDOW_MS = 15000;
  const SEATS = Object.freeze(['p1', 'e1', 's1', 's2']);
  const ROUND_ID_RE = /^[0-9a-f]{48}$/;
  const OUTCOMES = new Set(['victory', 'defeat', 'aborted']);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function safeCount(value, maximum = 999999) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.trunc(number))) : 0;
  }

  function safeRatio(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }

  function assertRuntime(runtime) {
    if (!runtime || typeof runtime !== 'object' || !ROUND_ID_RE.test(runtime.id || '')) {
      throw new Error('invalid coop runtime');
    }
  }

  function normalizeSeat(raw, seat) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const uid = typeof source.uid === 'string' ? source.uid.slice(0, 128) : '';
    const human = uid.length > 0;
    return {
      ...clone(source),
      seat,
      uid,
      human,
      connected: human ? source.connected !== false : false,
      control: human && source.connected !== false ? 'human' : 'ai',
      reconnectable: source.reconnectable === true,
      resumeAtRoundId: ROUND_ID_RE.test(source.resumeAtRoundId || '') ? source.resumeAtRoundId : null,
      battle: clone(source.battle || {}),
    };
  }

  function createRuntime({ id, seats, bossId, difficulty, stageId, startedAt = 0 }) {
    if (!ROUND_ID_RE.test(id || '')) throw new Error('invalid coop match id');
    if (!seats?.p1?.uid) throw new Error('host seat is required');
    const normalizedSeats = {};
    SEATS.forEach((seat) => { normalizedSeats[seat] = normalizeSeat(seats[seat], seat); });
    return {
      id,
      phase: 'playing',
      hostSeat: 'p1',
      bossId: String(bossId || 'fortress-tank').slice(0, 40),
      difficulty: ['normal', 'hard', 'extreme'].includes(difficulty) ? difficulty : 'normal',
      stageId: String(stageId || 'fortress-fixed').slice(0, 40),
      startedAt: Number.isFinite(Number(startedAt)) ? Number(startedAt) : 0,
      rewardable: true,
      abortReason: '',
      seats: normalizedSeats,
      hostRecovery: null,
    };
  }

  function abortForHostDisconnect(runtime, now, reason = 'host-disconnected') {
    assertRuntime(runtime);
    const next = clone(runtime);
    next.phase = 'aborted';
    next.rewardable = false;
    next.abortReason = String(reason || 'host-disconnected').slice(0, 80);
    next.endedAt = Number.isFinite(Number(now)) ? Number(now) : 0;
    next.destination = 'lobby';
    next.hostRecovery = { state: 'failed', at: next.endedAt };
    return next;
  }

  function disconnectSeat(runtime, seat, now, options = {}) {
    assertRuntime(runtime);
    if (!SEATS.includes(seat) || !runtime.seats?.[seat]) throw new Error('unknown coop seat');
    if (runtime.phase !== 'playing') return clone(runtime);
    if (seat === runtime.hostSeat) {
      if (options.canContinue !== true) return abortForHostDisconnect(runtime, now);
      const next = clone(runtime);
      next.seats[seat].connected = false;
      // ホスト移譲はしない。現ホストの通信復旧中だけ試合状態を保持する。
      next.hostRecovery = { state: 'reconnecting', at: Number(now) || 0 };
      return next;
    }
    const next = clone(runtime);
    const target = next.seats[seat];
    if (!target.human) return next;
    target.connected = false;
    target.control = 'ai';
    target.reconnectable = true;
    target.resumeAtRoundId = null;
    target.disconnectedAt = Number.isFinite(Number(now)) ? Number(now) : 0;
    return next;
  }

  function requestReconnect(runtime, seat, uid, nextInputRoundId, now) {
    assertRuntime(runtime);
    if (!SEATS.includes(seat) || !runtime.seats?.[seat]) return { runtime: clone(runtime), accepted: false, reason: 'unknown-seat' };
    if (runtime.phase !== 'playing') return { runtime: clone(runtime), accepted: false, reason: 'match-ended' };
    if (!ROUND_ID_RE.test(nextInputRoundId || '')) return { runtime: clone(runtime), accepted: false, reason: 'invalid-round' };
    const current = runtime.seats[seat];
    if (!current.human || current.uid !== uid) return { runtime: clone(runtime), accepted: false, reason: 'identity-mismatch' };
    if (current.connected && current.control === 'human') return { runtime: clone(runtime), accepted: false, reason: 'already-active' };
    const next = clone(runtime);
    const target = next.seats[seat];
    target.connected = true;
    target.control = 'ai';
    target.reconnectable = true;
    target.resumeAtRoundId = nextInputRoundId;
    target.reconnectedAt = Number.isFinite(Number(now)) ? Number(now) : 0;
    if (seat === next.hostSeat) next.hostRecovery = { state: 'synchronized', at: target.reconnectedAt };
    return { runtime: next, accepted: true, reason: 'pending-next-input' };
  }

  function activateRoundControls(runtime, roundId) {
    assertRuntime(runtime);
    if (!ROUND_ID_RE.test(roundId || '')) throw new Error('invalid input round id');
    const next = clone(runtime);
    SEATS.forEach((seat) => {
      const target = next.seats[seat];
      if (target.human && target.connected && target.resumeAtRoundId === roundId) {
        target.control = 'human';
        target.reconnectable = false;
        target.resumeAtRoundId = null;
      }
    });
    if (next.hostRecovery?.state === 'synchronized' && next.seats[next.hostSeat].control === 'human') {
      next.hostRecovery = null;
    }
    return next;
  }

  function resultSummary(runtime, stats = {}) {
    assertRuntime(runtime);
    const outcome = runtime.phase === 'aborted' ? 'aborted' : (OUTCOMES.has(stats.outcome) ? stats.outcome : 'defeat');
    const rewardable = runtime.rewardable !== false && outcome !== 'aborted';
    const firstClear = rewardable && outcome === 'victory' && stats.firstClear === true;
    return {
      matchId: runtime.id,
      outcome,
      title: outcome === 'victory' ? 'VICTORY' : outcome === 'defeat' ? 'DEFEAT' : 'BATTLE ABORTED',
      difficulty: runtime.difficulty,
      bossId: runtime.bossId,
      stageId: runtime.stageId,
      rewardable,
      coins: rewardable ? safeCount(stats.coins, 9999) : 0,
      partsDestroyed: safeCount(stats.partsDestroyed, 99),
      totalParts: Math.max(1, safeCount(stats.totalParts, 99)),
      rescues: safeCount(stats.rescues, 99),
      firstClear,
      achievements: Array.from(new Set(Array.isArray(stats.achievements) ? stats.achievements.filter((id) => typeof id === 'string').map((id) => id.slice(0, 80)) : [])),
      bossHpRemainingRatio: safeRatio(stats.bossHpRemainingRatio, outcome === 'defeat' ? 1 : 0),
      playerCount: safeCount(stats.playerCount, 4),
      aiCount: safeCount(stats.aiCount, 4),
      allPartsDestroyed: stats.allPartsDestroyed === true,
      noDown: stats.noDown === true,
      deadLineWin: stats.deadLineWin === true,
      abortReason: outcome === 'aborted' ? String(runtime.abortReason || 'host-disconnected').slice(0, 80) : '',
    };
  }

  function rewardEvent(summary) {
    if (!summary?.rewardable || (summary.outcome !== 'victory' && summary.outcome !== 'defeat')) return null;
    return {
      id: `${summary.matchId}:result`,
      type: 'coop-result',
      outcome: summary.outcome,
      difficulty: summary.difficulty,
      rescues: summary.rescues,
      partsDestroyed: summary.partsDestroyed,
      totalParts: summary.totalParts,
      bossHpRemainingRatio: summary.bossHpRemainingRatio,
      playerCount: summary.playerCount,
      aiCount: summary.aiCount,
      allPartsDestroyed: summary.allPartsDestroyed,
      noDown: summary.noDown,
      deadLineWin: summary.deadLineWin,
    };
  }

  function openRematch(runtime, eligibleSeats, now) {
    assertRuntime(runtime);
    const eligible = Array.from(new Set((eligibleSeats || []).filter((seat) => {
      const player = runtime.seats?.[seat];
      return SEATS.includes(seat) && player?.human && player.connected;
    })));
    const openedAt = Number.isFinite(Number(now)) ? Number(now) : 0;
    return {
      matchId: runtime.id,
      hostSeat: runtime.hostSeat,
      openedAt,
      closesAt: openedAt + REMATCH_WINDOW_MS,
      eligibleSeats: eligible,
      votes: {},
      settings: { bossId: runtime.bossId, difficulty: runtime.difficulty, stageId: runtime.stageId },
      resolved: false,
      decision: null,
    };
  }

  function castRematchVote(window, seat, vote, now) {
    const next = clone(window);
    if (!next || next.resolved || !next.eligibleSeats?.includes(seat)) return { window: next, accepted: false, reason: 'not-eligible' };
    if (Number(now) > Number(next.closesAt)) return { window: next, accepted: false, reason: 'closed' };
    next.votes[seat] = vote === true;
    return { window: next, accepted: true, reason: vote === true ? 'yes' : 'no' };
  }

  function secondsRemaining(window, now) {
    return Math.max(0, Math.ceil((Number(window?.closesAt || 0) - Number(now || 0)) / 1000));
  }

  function resolveRematch(window, now, force = false) {
    const next = clone(window);
    if (!next) throw new Error('rematch window is required');
    if (next.resolved) return next;
    const allVoted = next.eligibleSeats.every((seat) => Object.prototype.hasOwnProperty.call(next.votes, seat));
    if (!force && Number(now) < Number(next.closesAt) && !allVoted) return { ...next, decision: 'waiting' };
    const yesSeats = next.eligibleSeats.filter((seat) => next.votes[seat] === true);
    // MVPではホスト移譲を新設しないため、2人以上に加えて現ホストの継続意思が必要。
    const canRematch = yesSeats.length >= 2 && yesSeats.includes(next.hostSeat);
    next.resolved = true;
    next.decision = canRematch ? 'rematch' : 'lobby';
    next.yesSeats = yesSeats;
    next.retainedSeats = canRematch ? yesSeats : [];
    next.missingSeats = SEATS.filter((seat) => !next.retainedSeats.includes(seat));
    return next;
  }

  return Object.freeze({
    REMATCH_WINDOW_MS,
    SEATS,
    createRuntime,
    disconnectSeat,
    abortForHostDisconnect,
    requestReconnect,
    activateRoundControls,
    resultSummary,
    rewardEvent,
    openRematch,
    castRematchVote,
    secondsRemaining,
    resolveRematch,
  });
});
