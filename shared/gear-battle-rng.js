(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KatamonGearBattleRng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GEAR_BATTLE_RNG_VERSION = 1;
  const GEAR_CRIT_RNG_NAMESPACE = 'gear-crit:v1';
  function fail(code) { throw Object.assign(new Error(code), { code }); }
  function text(value, name) { if (typeof value !== 'string' || !value) fail(`INVALID_${name}`); return value; }
  function nonNegative(value, name) { if (!Number.isSafeInteger(value) || value < 0) fail(`INVALID_${name}`); return value; }
  function hash32(value) { let hash = 0x811c9dc5; for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); } return hash >>> 0; }
  function rollBasisPoints(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'actionOrdinal,damageType,hitOrdinal,matchOrdinal,namespace,runId,targetUnitId,version') fail('INVALID_GEAR_BATTLE_RNG_INPUT');
    if (input.version !== GEAR_BATTLE_RNG_VERSION) fail('UNSUPPORTED_GEAR_BATTLE_RNG_VERSION');
    const key = [text(input.namespace, 'RNG_NAMESPACE'), text(input.runId, 'RNG_RUN_ID'), nonNegative(input.matchOrdinal, 'RNG_MATCH_ORDINAL'), nonNegative(input.actionOrdinal, 'RNG_ACTION_ORDINAL'), text(input.targetUnitId, 'RNG_TARGET'), text(input.damageType, 'RNG_DAMAGE_TYPE'), nonNegative(input.hitOrdinal, 'RNG_HIT_ORDINAL'), input.version].join('|');
    return hash32(key) % 10000;
  }
  return Object.freeze({ GEAR_BATTLE_RNG_VERSION, GEAR_CRIT_RNG_NAMESPACE, rollBasisPoints });
});
