(function initKatamonGearCoopSettlementStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearCoopSettlementStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearCoopSettlementStorage(root) {
  'use strict';
  const STORAGE_KEY = 'katamon_coop_gear_settlement_v1'; const SCHEMA_VERSION = 1;
  class GearCoopSettlementStorageError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearCoopSettlementStorageError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearCoopSettlementStorageError(code, message, cause); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const stableJson = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  function storage(target, method) { const resolved = target === undefined ? root?.localStorage : target; if (!resolved || typeof resolved[method] !== 'function') fail('STORAGE_UNAVAILABLE', `storage.${method} is unavailable`); return resolved; }
  function rewards() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-coop-rewards.js'); if (root?.KatamonGearCoopRewards) return root.KatamonGearCoopRewards; fail('COOP_REWARD_MODULE_UNAVAILABLE', 'cooperative reward rules are unavailable'); }
  function gearStorage() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-storage.js'); if (root?.KatamonGearStorage) return root.KatamonGearStorage; fail('GEAR_STORAGE_UNAVAILABLE', 'Gear storage is unavailable'); }
  function validate(raw) {
    if (!plain(raw) || Object.keys(raw).sort().join(',') !== 'difficulty,eventId,firstClear,foundationEvent,matchId,outcome,reward,schemaVersion'.split(',').sort().join(',')) fail('INVALID_COOP_SETTLEMENT', 'settlement has an invalid shape');
    if (raw.schemaVersion !== SCHEMA_VERSION) fail(raw.schemaVersion > SCHEMA_VERSION ? 'UNSUPPORTED_FUTURE_COOP_SETTLEMENT_VERSION' : 'UNSUPPORTED_COOP_SETTLEMENT_VERSION', 'unsupported cooperative settlement version');
    const intent = rewards().createCoopSettlementIntent({ matchId: raw.matchId, eventId: raw.eventId, difficulty: raw.difficulty, outcome: raw.outcome, firstClear: raw.firstClear, createdAtMs: raw.reward?.createdAtMs });
    const eventKeys = ['id', 'type', 'outcome', 'difficulty', 'rescues', 'partsDestroyed', 'totalParts', 'bossHpRemainingRatio', 'playerCount', 'aiCount', 'allPartsDestroyed', 'noDown', 'deadLineWin'];
    if (!plain(raw.foundationEvent) || Object.keys(raw.foundationEvent).sort().join(',') !== eventKeys.slice().sort().join(',')
      || raw.foundationEvent.id !== intent.eventId || raw.foundationEvent.type !== 'coop-result'
      || raw.foundationEvent.outcome !== intent.outcome || raw.foundationEvent.difficulty !== intent.difficulty
      || !Number.isSafeInteger(raw.foundationEvent.rescues) || raw.foundationEvent.rescues < 0
      || !Number.isSafeInteger(raw.foundationEvent.partsDestroyed) || raw.foundationEvent.partsDestroyed < 0
      || !Number.isSafeInteger(raw.foundationEvent.totalParts) || raw.foundationEvent.totalParts < 1
      || raw.foundationEvent.partsDestroyed > raw.foundationEvent.totalParts
      || typeof raw.foundationEvent.bossHpRemainingRatio !== 'number' || !Number.isFinite(raw.foundationEvent.bossHpRemainingRatio) || raw.foundationEvent.bossHpRemainingRatio < 0 || raw.foundationEvent.bossHpRemainingRatio > 1
      || !Number.isSafeInteger(raw.foundationEvent.playerCount) || raw.foundationEvent.playerCount < 1
      || !Number.isSafeInteger(raw.foundationEvent.aiCount) || raw.foundationEvent.aiCount < 0
      || typeof raw.foundationEvent.allPartsDestroyed !== 'boolean' || typeof raw.foundationEvent.noDown !== 'boolean' || typeof raw.foundationEvent.deadLineWin !== 'boolean') fail('INVALID_COOP_FOUNDATION_EVENT', 'settlement foundation event is invalid');
    const reward = gearStorage().decodeGearStorageState(JSON.stringify({ storageSchemaVersion: 2, inventory: [], tempBox: [], unclaimedRewards: [raw.reward], rewardLedger: {}, resources: { powder: 0, blueprintShards: 0 } })).unclaimedRewards[0];
    const expectedReward = rewards().materializeCoopGearReward(intent);
    if (!plain(raw.reward) || raw.reward.sourceId !== 'coop_boss' || raw.reward.blueprintShards !== 0 || stableJson(reward) !== stableJson(expectedReward)) fail('COOP_SETTLEMENT_REWARD_MISMATCH', 'settlement reward does not match immutable identity');
    return { schemaVersion: SCHEMA_VERSION, matchId: intent.matchId, eventId: intent.eventId, difficulty: intent.difficulty, outcome: intent.outcome, firstClear: intent.firstClear, foundationEvent: clone(raw.foundationEvent), reward };
  }
  function load(target) { const s = storage(target, 'getItem'); let raw; try { raw = s.getItem(STORAGE_KEY); } catch (error) { fail('STORAGE_READ_FAILED', 'could not read cooperative settlement', error); } if (raw === null) return null; try { return validate(JSON.parse(raw)); } catch (error) { if (error instanceof GearCoopSettlementStorageError) throw error; fail('COOP_SETTLEMENT_PARSE_FAILED', 'cooperative settlement is malformed', error); } }
  function save(value, target) { const checked = validate(value); const prior = load(target); if (prior && stableJson(prior) !== stableJson(checked)) fail('COOP_SETTLEMENT_ALREADY_PENDING', 'another cooperative settlement is pending'); const encoded = JSON.stringify(checked); const s = storage(target, 'setItem'); try { s.setItem(STORAGE_KEY, encoded); if (s.getItem(STORAGE_KEY) !== encoded) fail('STORAGE_READ_BACK_MISMATCH', 'could not verify cooperative settlement'); } catch (error) { if (error instanceof GearCoopSettlementStorageError) throw error; fail('STORAGE_WRITE_FAILED', 'could not save cooperative settlement', error); } return checked; }
  function clear(expected, target) {
    const checked = validate(expected); const current = load(target);
    if (!current) return false;
    if (stableJson(current) !== stableJson(checked)) fail('COOP_SETTLEMENT_CLEANUP_CONFLICT', 'a different cooperative settlement is pending');
    const s = storage(target, 'removeItem');
    try { s.removeItem(STORAGE_KEY); if (s.getItem(STORAGE_KEY) !== null) fail('STORAGE_CLEAR_FAILED', 'could not clear cooperative settlement'); } catch (error) { if (error instanceof GearCoopSettlementStorageError) throw error; fail('STORAGE_CLEAR_FAILED', 'could not clear cooperative settlement', error); } return true;
  }
  function create(input) { const intent = rewards().createCoopSettlementIntent({ matchId: input.matchId, eventId: input.eventId, difficulty: input.difficulty, outcome: input.outcome, firstClear: input.firstClear, createdAtMs: input.createdAtMs }); return validate({ schemaVersion: SCHEMA_VERSION, matchId: intent.matchId, eventId: intent.eventId, difficulty: intent.difficulty, outcome: intent.outcome, firstClear: intent.firstClear, foundationEvent: clone(input.foundationEvent), reward: rewards().materializeCoopGearReward(intent) }); }
  return Object.freeze({ GearCoopSettlementStorageError, STORAGE_KEY, SCHEMA_VERSION, load, save, clear, create, validate });
});
