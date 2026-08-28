(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KatamonFirebaseOnlineBattleRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIREBASE_BATTLE_RECOVERY_PLAN_VERSION = 1;
  const ROUND_STATUSES = Object.freeze(['lobby', 'revealing', 'playing', 'results']);
  function fail(code, details) { const error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) { if (Array.isArray(value)) return value.map(clone); if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])); return value; }
  function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
  function identity(packet) { return Object.freeze({ from: packet.from, actionId: packet.actionId, unitId: packet.unitId || null }); }
  function sameResult(a, b) { return a && b && a.packet.from === b.packet.from && a.packet.actionId === b.packet.actionId; }
  function actionMatches(packet, action, matches) {
    return typeof matches === 'function' ? matches(packet, action)
      : !!action && packet.from === action.from && packet.actionId === action.actionId && (!packet.unitId || !action.unitId || packet.unitId === action.unitId);
  }
  function assertInput(options) {
    if (!plain(options) || typeof options.roundId !== 'string' || !ROUND_STATUSES.includes(options.roundStatus)
        || !plain(options.messages) || typeof options.validatePacket !== 'function' || typeof options.isPushKey !== 'function') fail('FIREBASE_RECOVERY_INPUT_INVALID');
  }
  function entriesOf(messages, isPushKey) {
    const entries = Object.entries(messages).map(([key, packet]) => ({ key, packet }));
    for (const entry of entries) if (!isPushKey(entry.key) || !plain(entry.packet)) fail('FIREBASE_RECOVERY_LOG_INVALID', { key: entry.key });
    // Firebase push IDs use their binary/code-unit alphabet. Locale collation is not protocol authority.
    entries.sort((a, b) => a.key === b.key ? 0 : a.key < b.key ? -1 : 1);
    return entries;
  }
  function validatedEntries(entries, roundId, validatePacket) {
    return entries.map(entry => {
      let verdict;
      try { verdict = validatePacket(entry.packet); } catch (_) { fail('FIREBASE_RECOVERY_PACKET_INVALID', { key: entry.key }); }
      if (verdict === false || (verdict && verdict.ok === false)) fail('FIREBASE_RECOVERY_PACKET_INVALID', { key: entry.key, reason: verdict && verdict.reason });
      if (entry.packet.roundId !== roundId) fail('FIREBASE_RECOVERY_ROUND_MISMATCH', { key: entry.key });
      return Object.freeze({ key: entry.key, packet: clone(entry.packet) });
    });
  }
  function plan(kind, roundId, entries, start, extras) {
    const startIndex = start ? entries.indexOf(start) : -1;
    return freeze({
      version: FIREBASE_BATTLE_RECOVERY_PLAN_VERSION, kind, roundId,
      historicalMessageKeys: entries.map(entry => entry.key), orderedEntries: entries,
      orderedEntriesThroughStart: startIndex >= 0 ? entries.slice(0, startIndex + 1) : [], start: start || null,
      completedActionChain: [], lastCandidateBoundary: null, pendingAction: null, result: null,
      requiresBattleReplayValidation: kind !== 'lobby' && kind !== 'revealing' && kind !== 'wait_for_start', ...extras
    });
  }
  function buildRecoveryPlan(options) {
    assertInput(options);
    const entries = validatedEntries(entriesOf(options.messages, options.isPushKey), options.roundId, options.validatePacket);
    const starts = entries.filter(entry => entry.packet.t === 'start');
    const combatBeforeStart = entries.filter(entry => ['fire', 'state', 'result'].includes(entry.packet.t) && (!starts.length || entries.indexOf(entry) < entries.indexOf(starts[0])));
    if (combatBeforeStart.length) fail('FIREBASE_RECOVERY_COMBAT_BEFORE_START', { key: combatBeforeStart[0].key });
    if (options.roundStatus === 'lobby' || options.roundStatus === 'revealing') {
      if (starts.length) fail('FIREBASE_RECOVERY_START_UNEXPECTED');
      return plan(options.roundStatus, options.roundId, entries, null, {});
    }
    if (!starts.length) {
      if (options.roundStatus === 'playing') return plan('wait_for_start', options.roundId, entries, null, {});
      fail('FIREBASE_RECOVERY_START_MISSING');
    }
    if (starts.length !== 1) fail('FIREBASE_RECOVERY_START_CONFLICT');
    const start = starts[0];
    if (start.packet.seat !== 'p1' || (options.hostUid && start.packet.from !== options.hostUid)) fail('FIREBASE_RECOVERY_START_AUTHORITY_INVALID', { key: start.key });

    const chain = [];
    let active = null;
    let result = null;
    for (const entry of entries.slice(entries.indexOf(start) + 1)) {
      const packet = entry.packet;
      if (packet.t === 'start') fail('FIREBASE_RECOVERY_START_CONFLICT');
      if (packet.t === 'fire') {
        if (result) fail('FIREBASE_RECOVERY_ACTION_AFTER_RESULT', { key: entry.key });
        if (active) fail('FIREBASE_RECOVERY_ACTION_OVERLAP', { key: entry.key });
        active = Object.freeze({ entry, identity: identity(packet) });
        continue;
      }
      if (packet.t !== 'state' && packet.t !== 'result') continue;
      if (result && packet.t === 'result' && sameResult(result.terminal, entry)) continue; // normal double-send delivery
      if (result) fail('FIREBASE_RECOVERY_RESULT_CONFLICT', { key: entry.key });
      const conceded = packet.t === 'result' && typeof options.isConcededResult === 'function' && options.isConcededResult(packet);
      if (conceded) {
        if (active) fail('FIREBASE_RECOVERY_TERMINAL_MISMATCH', { key: entry.key });
        result = Object.freeze({ fire: null, terminal: entry, conceded: true });
        continue;
      }
      if (!active) fail('FIREBASE_RECOVERY_TERMINAL_BEFORE_ACTION', { key: entry.key });
      if (!actionMatches(packet, active.identity, options.actionMatches)) fail('FIREBASE_RECOVERY_TERMINAL_MISMATCH', { key: entry.key });
      const completed = Object.freeze({ fire: active.entry, terminal: entry });
      chain.push(completed);
      if (packet.t === 'result') result = Object.freeze({ fire: active.entry, terminal: entry, conceded: false });
      active = null;
    }
    const lastCandidateBoundary = [...chain].reverse().find(item => item.terminal.packet.t === 'state') || null;
    if (options.roundStatus === 'results') {
      if (!result) fail('FIREBASE_RECOVERY_RESULT_MISSING');
      if (active) fail('FIREBASE_RECOVERY_ACTIVE_TAIL', { key: active.entry.key });
      return plan('results_candidate', options.roundId, entries, start, { completedActionChain: chain, lastCandidateBoundary, result });
    }
    if (result) fail('FIREBASE_RECOVERY_RESULT_UNEXPECTED', { key: result.terminal.key });
    if (active) return plan('wait_for_turn_boundary', options.roundId, entries, start, { completedActionChain: chain, lastCandidateBoundary, pendingAction: active.identity });
    if (!lastCandidateBoundary) return plan('battle_start_candidate', options.roundId, entries, start, { completedActionChain: chain });
    return plan('candidate_turn_boundary', options.roundId, entries, start, { completedActionChain: chain, lastCandidateBoundary });
  }
  return freeze({ FIREBASE_BATTLE_RECOVERY_PLAN_VERSION, buildRecoveryPlan });
});
