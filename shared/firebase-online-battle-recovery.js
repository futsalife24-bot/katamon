(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KatamonFirebaseOnlineBattleRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIREBASE_BATTLE_RECOVERY_PLAN_VERSION = 1;
  const ROUND_STATUSES = Object.freeze(['lobby', 'revealing', 'playing', 'results']);

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  function actionIdentity(packet) {
    return Object.freeze({ from: packet.from, actionId: packet.actionId, unitId: packet.unitId || null });
  }
  function actionMatches(packet, action, matches) {
    return typeof matches === 'function'
      ? matches(packet, action)
      : !!action && packet.from === action.from && packet.actionId === action.actionId
        && (!packet.unitId || !action.unitId || packet.unitId === action.unitId);
  }
  function validateOptions(options) {
    if (!plain(options) || typeof options.roundId !== 'string' || !ROUND_STATUSES.includes(options.roundStatus)
      || !plain(options.messages) || typeof options.validatePacket !== 'function' || typeof options.isPushKey !== 'function') {
      fail('FIREBASE_RECOVERY_INPUT_INVALID');
    }
  }
  function orderedEntries(messages, isPushKey) {
    const entries = Object.entries(messages).map(([key, packet]) => ({ key, packet }));
    for (const entry of entries) {
      if (!isPushKey(entry.key) || !plain(entry.packet)) fail('FIREBASE_RECOVERY_LOG_INVALID', { key: entry.key });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }
  function validateEntries(entries, roundId, validatePacket) {
    return entries.map(entry => {
      let verdict;
      try { verdict = validatePacket(entry.packet); }
      catch (_) { fail('FIREBASE_RECOVERY_PACKET_INVALID', { key: entry.key }); }
      if (verdict === false || (verdict && verdict.ok === false)) {
        fail('FIREBASE_RECOVERY_PACKET_INVALID', { key: entry.key, reason: verdict && verdict.reason });
      }
      if (entry.packet.roundId !== roundId) fail('FIREBASE_RECOVERY_ROUND_MISMATCH', { key: entry.key });
      return Object.freeze({ key: entry.key, packet: entry.packet });
    });
  }
  function planBase(kind, roundId, entries, start, extras) {
    return freeze({
      version: FIREBASE_BATTLE_RECOVERY_PLAN_VERSION,
      kind,
      roundId,
      historicalMessageKeys: entries.map(entry => entry.key),
      orderedEntries: entries,
      orderedEntriesThroughStart: start ? entries.slice(0, entries.indexOf(start) + 1) : [],
      start: start || null,
      ...extras
    });
  }

  function buildRecoveryPlan(options) {
    validateOptions(options);
    const entries = validateEntries(orderedEntries(options.messages, options.isPushKey), options.roundId, options.validatePacket);
    const starts = entries.filter(entry => entry.packet.t === 'start');
    const inactive = options.roundStatus === 'lobby' || options.roundStatus === 'revealing';
    if (inactive) {
      if (starts.length) fail('FIREBASE_RECOVERY_START_UNEXPECTED');
      return planBase(options.roundStatus, options.roundId, entries, null, { lastStableBoundary: null, pendingAction: null, result: null });
    }
    if (!starts.length) fail('FIREBASE_RECOVERY_START_MISSING');
    if (starts.length !== 1) fail('FIREBASE_RECOVERY_START_CONFLICT');
    const start = starts[0];
    if (start.packet.seat !== 'p1' || (options.hostUid && start.packet.from !== options.hostUid)) {
      fail('FIREBASE_RECOVERY_START_AUTHORITY_INVALID', { key: start.key });
    }

    let active = null;
    let earlyTerminal = null;
    let lastStableBoundary = null;
    let result = null;
    const later = entries.slice(entries.indexOf(start) + 1);
    for (const entry of later) {
      const packet = entry.packet;
      if (packet.t === 'start') fail('FIREBASE_RECOVERY_START_CONFLICT');
      if (packet.t === 'fire') {
        if (active) fail('FIREBASE_RECOVERY_ACTION_OVERLAP', { key: entry.key });
        active = Object.freeze({ entry, identity: actionIdentity(packet) });
        if (earlyTerminal) {
          if (!actionMatches(earlyTerminal.packet, active.identity, options.actionMatches)) {
            fail('FIREBASE_RECOVERY_TERMINAL_MISMATCH', { key: earlyTerminal.key });
          }
          if (earlyTerminal.packet.t === 'state') lastStableBoundary = Object.freeze({ fire: active.entry, state: earlyTerminal });
          else result = Object.freeze({ fire: active.entry, terminal: earlyTerminal, conceded: false });
          active = null;
          earlyTerminal = null;
        }
        continue;
      }
      if (packet.t !== 'state' && packet.t !== 'result') continue;
      const conceded = packet.t === 'result' && typeof options.isConcededResult === 'function' && options.isConcededResult(packet);
      if (conceded) {
        if (result) fail('FIREBASE_RECOVERY_RESULT_CONFLICT', { key: entry.key });
        result = Object.freeze({ fire: null, terminal: entry, conceded: true });
        continue;
      }
      if (active) {
        if (!actionMatches(packet, active.identity, options.actionMatches)) {
          fail('FIREBASE_RECOVERY_TERMINAL_MISMATCH', { key: entry.key });
        }
        if (packet.t === 'state') lastStableBoundary = Object.freeze({ fire: active.entry, state: entry });
        else result = Object.freeze({ fire: active.entry, terminal: entry, conceded: false });
        active = null;
      } else if (!earlyTerminal) {
        earlyTerminal = entry;
      } else if (earlyTerminal.packet.t === 'result' && packet.t === 'result'
          && earlyTerminal.packet.actionId === packet.actionId && earlyTerminal.packet.from === packet.from) {
        // The live transport intentionally treats repeated result delivery as harmless.
      } else {
        fail('FIREBASE_RECOVERY_TERMINAL_CONFLICT', { key: entry.key });
      }
    }
    if (earlyTerminal) fail('FIREBASE_RECOVERY_TERMINAL_ORPHAN', { key: earlyTerminal.key });
    if (options.roundStatus === 'results') {
      if (!result) fail('FIREBASE_RECOVERY_RESULT_MISSING');
      if (active) fail('FIREBASE_RECOVERY_ACTIVE_TAIL', { key: active.entry.key });
      return planBase('results', options.roundId, entries, start, { lastStableBoundary, pendingAction: null, result });
    }
    if (result) fail('FIREBASE_RECOVERY_RESULT_UNEXPECTED', { key: result.terminal.key });
    if (active) {
      return planBase('wait_for_turn_boundary', options.roundId, entries, start, {
        lastStableBoundary,
        pendingAction: active.identity,
        result: null
      });
    }
    if (!lastStableBoundary) {
      return planBase('battle_start_boundary', options.roundId, entries, start, { lastStableBoundary: null, pendingAction: null, result: null });
    }
    return planBase('stable_turn_boundary', options.roundId, entries, start, { lastStableBoundary, pendingAction: null, result: null });
  }

  return freeze({ FIREBASE_BATTLE_RECOVERY_PLAN_VERSION, buildRecoveryPlan });
});
