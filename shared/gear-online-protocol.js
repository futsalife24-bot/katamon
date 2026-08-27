(function initKatamonGearOnlineProtocol(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineProtocol(root) {
  'use strict';

  // Trusted Private Gear PvP validates canonical equality and battle semantics.
  // It deliberately does not prove that the owner legitimately obtained Gear.
  const ONLINE_GEAR_PROTOCOL_VERSION = 1;
  const ONLINE_GEAR_RULES_VERSION = 1;
  const ONLINE_GEAR_TRUST_MODEL = 'client_canonical';
  const GEAR_MODE_OFF = 'off';
  const GEAR_MODE_PRIVATE_TRUSTED_V1 = 'private_trusted_v1';
  const ONLINE_GEAR_LOADOUT_HASH_ALGORITHM = 'fnv1a64-v1';
  const ONLINE_GEAR_LOADOUT_HASH_PREFIX = `${ONLINE_GEAR_LOADOUT_HASH_ALGORITHM}:`;
  const ROUND_ID_RE = /^[0-9a-f]{48}$/;
  const HASH_RE = /^fnv1a64-v1:[0-9a-f]{16}$/;

  class GearOnlineProtocolError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineProtocolError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineProtocolError(code, message); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  // Firebase seats and Battle unit IDs are intentionally distinct in 2v2.
  // Existing ONLINE maps p1/e1/s1/s2 to p1/e1/p2/e2 respectively.
  const ONLINE_GEAR_SEAT_IDS = freeze(['p1', 'e1', 's1', 's2']);
  const ONLINE_GEAR_UNIT_IDS = freeze(['p1', 'e1', 'p2', 'e2']);
  const ONLINE_GEAR_SEAT_UNIT_MAP = freeze({ p1: 'p1', e1: 'e1', s1: 'p2', s2: 'e2' });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'unknown or missing fields');
  };
  const text = (value, name, max = 128) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) fail('INVALID_ONLINE_GEAR_IDENTITY', `${name} is invalid`);
    return value;
  };
  function domain() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js'); if (root?.KatamonGearDomain) return root.KatamonGearDomain; fail('GEAR_DOMAIN_UNAVAILABLE'); }
  function battleSnapshot() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-battle-snapshot.js'); if (root?.KatamonGearBattleSnapshot) return root.KatamonGearBattleSnapshot; fail('GEAR_BATTLE_SNAPSHOT_UNAVAILABLE'); }
  function combat() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-combat.js'); if (root?.KatamonGearCombat) return root.KatamonGearCombat; fail('GEAR_COMBAT_UNAVAILABLE'); }

  function trustedContext(context) {
    exact(context, ['baseFuel', 'baseHp', 'expectedCharacterId', 'expectedOwnerUid', 'expectedRoundId', 'expectedSeatId', 'expectedUnitId'], 'INVALID_ONLINE_GEAR_TRUSTED_CONTEXT');
    if (!Number.isFinite(context.baseHp) || context.baseHp < 0 || !Number.isFinite(context.baseFuel) || context.baseFuel < 0) fail('INVALID_ONLINE_GEAR_TRUSTED_CONTEXT');
    text(context.expectedOwnerUid, 'expectedOwnerUid');
    assertSeat(context.expectedSeatId, 'expectedSeatId');
    assertUnit(context.expectedUnitId, 'expectedUnitId');
    assertSeatUnitPair(context.expectedSeatId, context.expectedUnitId, 'INVALID_ONLINE_GEAR_TRUSTED_CONTEXT');
    text(context.expectedCharacterId, 'expectedCharacterId');
    assertRoundId(context.expectedRoundId);
    return context;
  }
  function assertSeat(value, name) {
    if (!ONLINE_GEAR_SEAT_IDS.includes(value)) fail('INVALID_ONLINE_GEAR_IDENTITY', `${name} is invalid`);
    return value;
  }
  function assertUnit(value, name) {
    if (!ONLINE_GEAR_UNIT_IDS.includes(value)) fail('INVALID_ONLINE_GEAR_IDENTITY', `${name} is invalid`);
    return value;
  }
  function assertSeatUnitPair(seatId, unitId, code = 'INVALID_ONLINE_GEAR_IDENTITY') {
    if (ONLINE_GEAR_SEAT_UNIT_MAP[seatId] !== unitId) fail(code, 'seatId and unitId do not match the ONLINE mapping');
  }
  function assertRoundId(value) {
    if (typeof value !== 'string' || !ROUND_ID_RE.test(value)) fail('INVALID_ONLINE_GEAR_IDENTITY', 'roundId is invalid');
    return value;
  }
  function assertVersions(value) {
    if (value.gearProtocolVersion !== ONLINE_GEAR_PROTOCOL_VERSION) fail(value.gearProtocolVersion > ONLINE_GEAR_PROTOCOL_VERSION ? 'UNSUPPORTED_FUTURE_ONLINE_GEAR_PROTOCOL' : 'UNSUPPORTED_ONLINE_GEAR_PROTOCOL');
    if (value.gearRulesVersion !== ONLINE_GEAR_RULES_VERSION) fail('UNSUPPORTED_ONLINE_GEAR_RULES');
    if (value.battleGearSnapshotVersion !== battleSnapshot().GEAR_BATTLE_SNAPSHOT_VERSION) fail('UNSUPPORTED_ONLINE_GEAR_BATTLE_SNAPSHOT');
    if (value.gearTrustModel !== ONLINE_GEAR_TRUST_MODEL) fail('INVALID_ONLINE_GEAR_TRUST_MODEL');
  }
  function canonicalLoadout(value) {
    exact(value, ['presetId', 'slots'], 'INVALID_ONLINE_GEAR_LOADOUT');
    const d = domain();
    if (typeof value.presetId !== 'string' || !value.presetId) fail('INVALID_ONLINE_GEAR_LOADOUT');
    exact(value.slots, d.SLOT_IDS, 'INVALID_ONLINE_GEAR_LOADOUT');
    return clone(value);
  }
  // FNV-1a 64 is applied to canonical UTF-8 bytes, not JS UTF-16 code units.
  function utf8Bytes(textValue) {
    const bytes = [];
    for (let index = 0; index < textValue.length; index += 1) {
      let codePoint = textValue.charCodeAt(index);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
        const low = textValue.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { codePoint = 0x10000 + ((codePoint - 0xd800) * 0x400) + (low - 0xdc00); index += 1; }
        else codePoint = 0xfffd;
      } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) codePoint = 0xfffd;
      if (codePoint <= 0x7f) bytes.push(codePoint);
      else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
      else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
    return bytes;
  }
  function hash64(textValue) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (const byte of utf8Bytes(textValue)) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
  }
  function calculateLoadoutHash({ gearRulesVersion, battleGearSnapshotVersion, characterId, canonicalLoadout: value }) {
    try {
      canonicalLoadout(value);
      if (gearRulesVersion !== ONLINE_GEAR_RULES_VERSION || battleGearSnapshotVersion !== battleSnapshot().GEAR_BATTLE_SNAPSHOT_VERSION || typeof characterId !== 'string' || !characterId) fail('INVALID_ONLINE_GEAR_HASH_INPUT');
      const payload = { algorithm: ONLINE_GEAR_LOADOUT_HASH_ALGORITHM, battleGearSnapshotVersion, canonicalLoadout: value, characterId, gearRulesVersion };
      return `${ONLINE_GEAR_LOADOUT_HASH_PREFIX}${hash64(domain().stableStringify(payload))}`;
    } catch (error) {
      if (error instanceof GearOnlineProtocolError) throw error;
      fail('INVALID_ONLINE_GEAR_HASH_INPUT');
    }
  }
  function projectCanonicalLoadout(snapshot) {
    return freeze({ presetId: snapshot.presetId, slots: clone(snapshot.slots) });
  }
  function rebuildSnapshot(value, context) {
    const trusted = trustedContext(context);
    try {
      const loadout = canonicalLoadout(value.canonicalLoadout);
      if (value.characterId !== trusted.expectedCharacterId) fail('INVALID_ONLINE_GEAR_IDENTITY');
      const candidate = {
        version: value.battleGearSnapshotVersion,
        characterId: value.characterId,
        presetId: loadout.presetId,
        slots: loadout.slots,
        derivedStats: combat().calculateBattleGearCombat({ battleGears: domain().SLOT_IDS.map((slot) => loadout.slots[slot]), baseHp: trusted.baseHp, baseFuel: trusted.baseFuel }),
        activeSets: null,
        initialRuntimeState: clone(combat().createRuntimeEffectsState())
      };
      candidate.activeSets = clone(candidate.derivedStats.activeSets);
      return battleSnapshot().validateBattleGearSnapshot(candidate, { baseHp: trusted.baseHp, baseFuel: trusted.baseFuel, expectedCharacterId: trusted.expectedCharacterId });
    } catch (error) {
      if (error instanceof GearOnlineProtocolError) throw error;
      fail('TAMPERED_ONLINE_GEAR_LOADOUT');
    }
  }
  function validateLoadoutCommitment(value, context) {
    const trusted = trustedContext(context);
    exact(value, ['battleGearSnapshotVersion', 'canonicalLoadout', 'characterId', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'loadoutHash', 'ownerUid', 'roundId', 'seatId', 'unitId'], 'INVALID_ONLINE_GEAR_COMMITMENT');
    assertVersions(value);
    text(value.ownerUid, 'ownerUid'); assertSeat(value.seatId, 'seatId'); assertUnit(value.unitId, 'unitId'); assertSeatUnitPair(value.seatId, value.unitId); assertRoundId(value.roundId); text(value.characterId, 'characterId');
    if (value.ownerUid !== trusted.expectedOwnerUid || value.seatId !== trusted.expectedSeatId || value.unitId !== trusted.expectedUnitId || value.characterId !== trusted.expectedCharacterId || value.roundId !== trusted.expectedRoundId) fail('INVALID_ONLINE_GEAR_IDENTITY');
    canonicalLoadout(value.canonicalLoadout);
    if (typeof value.loadoutHash !== 'string' || !HASH_RE.test(value.loadoutHash)) fail('INVALID_ONLINE_GEAR_LOADOUT_HASH');
    const expectedHash = calculateLoadoutHash(value);
    if (value.loadoutHash !== expectedHash) fail('INVALID_ONLINE_GEAR_LOADOUT_HASH');
    rebuildSnapshot(value, trusted);
    return freeze(clone(value));
  }
  function reconstructBattleGearSnapshot(value, context) {
    const checked = validateLoadoutCommitment(value, context);
    return rebuildSnapshot(checked, context);
  }
  function createLoadoutCommitment(input) {
    exact(input, ['battleGearSnapshot', 'roundId', 'trustedContext'], 'INVALID_ONLINE_GEAR_CREATE_INPUT');
    const trusted = trustedContext(input.trustedContext);
    const snapshot = (() => {
      try {
        return battleSnapshot().validateBattleGearSnapshot(input.battleGearSnapshot, { baseHp: trusted.baseHp, baseFuel: trusted.baseFuel, expectedCharacterId: trusted.expectedCharacterId });
      } catch (_) { fail('INVALID_ONLINE_GEAR_BATTLE_SNAPSHOT'); }
    })();
    assertRoundId(input.roundId);
    if (input.roundId !== trusted.expectedRoundId || snapshot.characterId !== trusted.expectedCharacterId) fail('INVALID_ONLINE_GEAR_IDENTITY');
    const value = {
      gearProtocolVersion: ONLINE_GEAR_PROTOCOL_VERSION,
      gearRulesVersion: ONLINE_GEAR_RULES_VERSION,
      battleGearSnapshotVersion: battleSnapshot().GEAR_BATTLE_SNAPSHOT_VERSION,
      gearTrustModel: ONLINE_GEAR_TRUST_MODEL,
      ownerUid: trusted.expectedOwnerUid,
      seatId: trusted.expectedSeatId,
      unitId: trusted.expectedUnitId,
      characterId: snapshot.characterId,
      roundId: input.roundId,
      canonicalLoadout: projectCanonicalLoadout(snapshot),
      loadoutHash: ''
    };
    value.loadoutHash = calculateLoadoutHash(value);
    return validateLoadoutCommitment(value, trusted);
  }
  function stableSerializeCommitment(value, context) { return domain().stableStringify(validateLoadoutCommitment(value, context)); }

  return freeze({
    ONLINE_GEAR_PROTOCOL_VERSION, ONLINE_GEAR_RULES_VERSION, ONLINE_GEAR_TRUST_MODEL,
    GEAR_MODE_OFF, GEAR_MODE_PRIVATE_TRUSTED_V1, ONLINE_GEAR_SEAT_IDS, ONLINE_GEAR_UNIT_IDS, ONLINE_GEAR_SEAT_UNIT_MAP,
    ONLINE_GEAR_LOADOUT_HASH_ALGORITHM, GearOnlineProtocolError,
    createLoadoutCommitment, validateLoadoutCommitment, reconstructBattleGearSnapshot,
    stableSerializeCommitment, calculateLoadoutHash
  });
});
