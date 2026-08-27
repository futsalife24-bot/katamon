(function initKatamonGearOnlineBattleRng(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleRng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleRng() {
  'use strict';

  const ONLINE_GEAR_BATTLE_RNG_VERSION = 1;
  const ONLINE_GEAR_RNG_HASH_ALGORITHM = 'fnv1a64-ascii-v1';
  const ONLINE_GEAR_CRIT_RNG_NAMESPACE = 'online-gear-crit:v1';
  const ONLINE_GEAR_STATUS_RNG_NAMESPACE = 'online-gear-status:v1';
  const ONLINE_GEAR_RNG_UNIT_IDS = Object.freeze(['p1', 'e1']);
  const ONLINE_GEAR_RNG_DAMAGE_TYPES = Object.freeze(['direct_projectile', 'normal_blast']);
  const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  const ROUND_RE = /^[0-9a-f]{48}$/;
  const STATUS_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

  class GearOnlineBattleRngError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineBattleRngError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineBattleRngError(code, message); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'unknown or missing fields');
  };
  const ordinal = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 0) fail(`INVALID_ONLINE_GEAR_${name}`);
    return value;
  };
  const unitId = (value, name) => {
    if (!ONLINE_GEAR_RNG_UNIT_IDS.includes(value)) fail(`INVALID_ONLINE_GEAR_${name}`);
    return value;
  };
  function assertVersion(value) {
    if (value !== ONLINE_GEAR_BATTLE_RNG_VERSION) fail('UNSUPPORTED_ONLINE_GEAR_BATTLE_RNG_VERSION');
  }
  function assertRoomRound(roomId, roundId) {
    if (!ROOM_RE.test(roomId || '')) fail('INVALID_ONLINE_GEAR_RNG_ROOM_ID');
    if (!ROUND_RE.test(roundId || '')) fail('INVALID_ONLINE_GEAR_RNG_ROUND_ID');
  }

  // Firebase ONLINE v3 accepts exactly one fire action for the current 1v1
  // turn. Both peers advance turnCount only after that action resolves, so
  // the accepted fire's authoritative action ordinal is the pre-fire turn
  // ordinal. actionId remains only a duplicate/replay correlation token.
  function deriveAuthoritativeActionOrdinal(input) {
    exact(input, ['turnOrdinal'], 'INVALID_ONLINE_GEAR_ACTION_ORDINAL_INPUT');
    return ordinal(input.turnOrdinal, 'RNG_TURN_ORDINAL');
  }

  function createOnlineGearActionIdentity(input) {
    exact(input, ['roomId', 'roundId', 'sourceUnitId', 'turnOrdinal', 'version'], 'INVALID_ONLINE_GEAR_ACTION_IDENTITY_INPUT');
    assertVersion(input.version);
    assertRoomRound(input.roomId, input.roundId);
    const turnOrdinal = ordinal(input.turnOrdinal, 'RNG_TURN_ORDINAL');
    return Object.freeze({
      version: ONLINE_GEAR_BATTLE_RNG_VERSION,
      roomId: input.roomId,
      roundId: input.roundId,
      turnOrdinal,
      authoritativeActionOrdinal: deriveAuthoritativeActionOrdinal({ turnOrdinal }),
      sourceUnitId: unitId(input.sourceUnitId, 'RNG_SOURCE_UNIT_ID')
    });
  }

  function validateCommonRollIdentity(input) {
    assertVersion(input.version);
    assertRoomRound(input.roomId, input.roundId);
    const turnOrdinal = ordinal(input.turnOrdinal, 'RNG_TURN_ORDINAL');
    const actionOrdinal = ordinal(input.authoritativeActionOrdinal, 'RNG_ACTION_ORDINAL');
    const sourceUnitId = unitId(input.sourceUnitId, 'RNG_SOURCE_UNIT_ID');
    const targetUnitId = unitId(input.targetUnitId, 'RNG_TARGET_UNIT_ID');
    if (sourceUnitId === targetUnitId) fail('INVALID_ONLINE_GEAR_RNG_SELF_TARGET');
    return { turnOrdinal, actionOrdinal, sourceUnitId, targetUnitId, hitOrdinal: ordinal(input.hitOrdinal, 'RNG_HIT_ORDINAL') };
  }

  function canonicalOnlineGearRngKey(input) {
    if (!plain(input)) fail('INVALID_ONLINE_GEAR_RNG_INPUT');
    const crit = input.namespace === ONLINE_GEAR_CRIT_RNG_NAMESPACE;
    const status = input.namespace === ONLINE_GEAR_STATUS_RNG_NAMESPACE;
    if (!crit && !status) fail('INVALID_ONLINE_GEAR_RNG_NAMESPACE');
    exact(input, crit
      ? ['authoritativeActionOrdinal', 'damageType', 'effectKind', 'hitOrdinal', 'namespace', 'roomId', 'roundId', 'sourceUnitId', 'targetUnitId', 'turnOrdinal', 'version']
      : ['authoritativeActionOrdinal', 'effectKind', 'hitOrdinal', 'namespace', 'roomId', 'roundId', 'sourceUnitId', 'statusId', 'targetUnitId', 'turnOrdinal', 'version'],
    'INVALID_ONLINE_GEAR_RNG_INPUT');
    const common = validateCommonRollIdentity(input);
    let detailName;
    let detailValue;
    if (crit) {
      if (input.effectKind !== 'crit') fail('INVALID_ONLINE_GEAR_RNG_EFFECT_KIND');
      if (!ONLINE_GEAR_RNG_DAMAGE_TYPES.includes(input.damageType)) fail('INVALID_ONLINE_GEAR_RNG_DAMAGE_TYPE');
      detailName = 'damageType';
      detailValue = input.damageType;
    } else {
      if (input.effectKind !== 'status') fail('INVALID_ONLINE_GEAR_RNG_EFFECT_KIND');
      if (!STATUS_ID_RE.test(input.statusId || '')) fail('INVALID_ONLINE_GEAR_RNG_STATUS_ID');
      detailName = 'statusId';
      detailValue = input.statusId;
    }
    return [
      ONLINE_GEAR_RNG_HASH_ALGORITHM,
      `version=${input.version}`,
      `namespace=${input.namespace}`,
      `room=${input.roomId}`,
      `round=${input.roundId}`,
      `turn=${common.turnOrdinal}`,
      `action=${common.actionOrdinal}`,
      `source=${common.sourceUnitId}`,
      `target=${common.targetUnitId}`,
      `effect=${input.effectKind}`,
      `${detailName}=${detailValue}`,
      `hit=${common.hitOrdinal}`
    ].join('|');
  }

  function fnv1a64Ascii(text) {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code > 0x7f) fail('INVALID_ONLINE_GEAR_RNG_NON_ASCII_KEY');
      hash ^= BigInt(code);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash;
  }

  function rollBasisPoints(input) {
    return Number(fnv1a64Ascii(canonicalOnlineGearRngKey(input)) % 10000n);
  }

  function createCritRollIdentity(input) {
    exact(input, ['actionIdentity', 'damageType', 'hitOrdinal', 'targetUnitId'], 'INVALID_ONLINE_GEAR_CRIT_IDENTITY_INPUT');
    const action = input.actionIdentity;
    exact(action, ['authoritativeActionOrdinal', 'roomId', 'roundId', 'sourceUnitId', 'turnOrdinal', 'version'], 'INVALID_ONLINE_GEAR_ACTION_IDENTITY_INPUT');
    const identity = {
      version: action.version,
      namespace: ONLINE_GEAR_CRIT_RNG_NAMESPACE,
      roomId: action.roomId,
      roundId: action.roundId,
      turnOrdinal: action.turnOrdinal,
      authoritativeActionOrdinal: action.authoritativeActionOrdinal,
      sourceUnitId: action.sourceUnitId,
      targetUnitId: input.targetUnitId,
      effectKind: 'crit',
      damageType: input.damageType,
      hitOrdinal: input.hitOrdinal
    };
    canonicalOnlineGearRngKey(identity);
    return Object.freeze(identity);
  }

  return Object.freeze({
    ONLINE_GEAR_BATTLE_RNG_VERSION,
    ONLINE_GEAR_RNG_HASH_ALGORITHM,
    ONLINE_GEAR_CRIT_RNG_NAMESPACE,
    ONLINE_GEAR_STATUS_RNG_NAMESPACE,
    ONLINE_GEAR_RNG_UNIT_IDS,
    ONLINE_GEAR_RNG_DAMAGE_TYPES,
    GearOnlineBattleRngError,
    deriveAuthoritativeActionOrdinal,
    createOnlineGearActionIdentity,
    createCritRollIdentity,
    canonicalOnlineGearRngKey,
    rollBasisPoints
  });
});
