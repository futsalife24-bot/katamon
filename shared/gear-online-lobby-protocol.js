(function initKatamonGearOnlineLobbyProtocol(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineLobbyProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineLobbyProtocol(root) {
  'use strict';

  // v5 is the compatibility fence for owner-scoped 2v2 physical Gear conflicts.
  // The core commitment/wire/snapshot versions intentionally remain v1; a
  // mixed v4/v5 Gear battle must fail closed at start.
  const ONLINE_GEAR_LOBBY_PROTOCOL_VERSION = 5;
  const ONLINE_GEAR_READY_COMMITMENT_VERSION = 1;
  const ONLINE_VISIBILITY_PUBLIC = 'public';
  const ONLINE_VISIBILITY_PRIVATE = 'private';

  class GearOnlineLobbyProtocolError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineLobbyProtocolError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineLobbyProtocolError(code, message); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'unknown or missing fields');
  };
  const text = (value, code, max = 128) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(code, 'invalid text');
    return value;
  };
  function online() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-online-protocol.js');
    if (root?.KatamonGearOnlineProtocol) return root.KatamonGearOnlineProtocol;
    fail('ONLINE_GEAR_PROTOCOL_UNAVAILABLE');
  }
  function battleGearSnapshotVersion() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-battle-snapshot.js').GEAR_BATTLE_SNAPSHOT_VERSION;
    if (root?.KatamonGearBattleSnapshot) return root.KatamonGearBattleSnapshot.GEAR_BATTLE_SNAPSHOT_VERSION;
    fail('GEAR_BATTLE_SNAPSHOT_UNAVAILABLE');
  }
  function domain() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js');
    if (root?.KatamonGearDomain) return root.KatamonGearDomain;
    fail('GEAR_DOMAIN_UNAVAILABLE');
  }
  const seatIndex = (seatId) => online().ONLINE_GEAR_SEAT_IDS.indexOf(seatId);
  const assertVisibility = (value) => {
    if (value !== ONLINE_VISIBILITY_PUBLIC && value !== ONLINE_VISIBILITY_PRIVATE) fail('INVALID_ONLINE_GEAR_CAPABILITY');
    return value;
  };
  const assertRoundId = (value, code = 'INVALID_ONLINE_GEAR_START_MANIFEST') => {
    if (typeof value !== 'string' || !/^[0-9a-f]{48}$/.test(value)) fail(code, 'invalid roundId');
    return value;
  };
  const hashRe = () => new RegExp(`^${online().ONLINE_GEAR_LOADOUT_HASH_ALGORITHM}:[0-9a-f]{16}$`);
  const capabilityKeys = ['battleGearSnapshotVersion', 'gearMode', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel'];
  const bindingKeys = ['battleGearSnapshotVersion', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'loadoutHash', 'version'];
  const manifestKeys = ['battleGearSnapshotVersion', 'commitments', 'gearMode', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'roundId', 'version'];

  function canonicalCapability() {
    const p = online();
    return freeze({
      gearMode: p.GEAR_MODE_PRIVATE_TRUSTED_V1,
      gearProtocolVersion: p.ONLINE_GEAR_PROTOCOL_VERSION,
      gearRulesVersion: p.ONLINE_GEAR_RULES_VERSION,
      battleGearSnapshotVersion: battleGearSnapshotVersion(),
      gearTrustModel: p.ONLINE_GEAR_TRUST_MODEL
    });
  }
  function validateRoomGearCapability(rawCapability, context) {
    exact(context, ['visibility'], 'INVALID_ONLINE_GEAR_CAPABILITY');
    const visibility = assertVisibility(context.visibility);
    if (rawCapability === null || rawCapability === undefined) return null;
    exact(rawCapability, capabilityKeys, 'INVALID_ONLINE_GEAR_CAPABILITY');
    const expected = canonicalCapability();
    for (const key of capabilityKeys) if (rawCapability[key] !== expected[key]) fail('UNSUPPORTED_ONLINE_GEAR_CAPABILITY');
    if (visibility !== ONLINE_VISIBILITY_PRIVATE) fail('PUBLIC_ROOM_GEAR_NOT_ALLOWED');
    return expected;
  }
  function createRoomGearCapability(input) {
    exact(input, ['gearMode', 'visibility'], 'INVALID_ONLINE_GEAR_CAPABILITY');
    const visibility = assertVisibility(input.visibility);
    if (input.gearMode === online().GEAR_MODE_OFF) return null;
    if (input.gearMode !== online().GEAR_MODE_PRIVATE_TRUSTED_V1) fail('INVALID_ONLINE_GEAR_CAPABILITY');
    return validateRoomGearCapability(canonicalCapability(), { visibility });
  }
  // Local-only material. 3D-2B must include this stable serialization inside
  // the existing nonce-sealed character SHA-256 commit; never send it as READY wire data.
  function validateReadyGearBinding(value) {
    exact(value, bindingKeys, 'INVALID_ONLINE_GEAR_READY_BINDING');
    const p = online();
    if (value.version !== ONLINE_GEAR_READY_COMMITMENT_VERSION
      || value.gearProtocolVersion !== p.ONLINE_GEAR_PROTOCOL_VERSION
      || value.gearRulesVersion !== p.ONLINE_GEAR_RULES_VERSION
      || value.battleGearSnapshotVersion !== battleGearSnapshotVersion()
      || value.gearTrustModel !== p.ONLINE_GEAR_TRUST_MODEL
      || typeof value.loadoutHash !== 'string' || !hashRe().test(value.loadoutHash)) fail('INVALID_ONLINE_GEAR_READY_BINDING');
    return freeze(clone(value));
  }
  function createReadyGearBinding(input) {
    exact(input, ['loadoutCommitment', 'trustedContext'], 'INVALID_ONLINE_GEAR_READY_BINDING');
    const full = online().validateLoadoutCommitment(input.loadoutCommitment, input.trustedContext);
    return validateReadyGearBinding({
      version: ONLINE_GEAR_READY_COMMITMENT_VERSION,
      gearProtocolVersion: full.gearProtocolVersion,
      gearRulesVersion: full.gearRulesVersion,
      battleGearSnapshotVersion: full.battleGearSnapshotVersion,
      gearTrustModel: full.gearTrustModel,
      loadoutHash: full.loadoutHash
    });
  }
  function stableSerializeReadyGearBinding(value) { return domain().stableStringify(validateReadyGearBinding(value)); }
  function validateRevealedGearCommitment(input) {
    exact(input, ['loadoutCommitment', 'readyBinding', 'trustedContext'], 'INVALID_ONLINE_GEAR_REVEAL');
    const ready = validateReadyGearBinding(input.readyBinding);
    const full = online().validateLoadoutCommitment(input.loadoutCommitment, input.trustedContext);
    for (const key of ['gearProtocolVersion', 'gearRulesVersion', 'battleGearSnapshotVersion', 'gearTrustModel']) {
      if (ready[key] !== full[key]) fail('GEAR_READY_VERSION_MISMATCH');
    }
    if (ready.loadoutHash !== full.loadoutHash) fail('GEAR_READY_HASH_MISMATCH');
    return full;
  }
  function revealsBySeat(participantReveals, roundId) {
    if (!Array.isArray(participantReveals) || participantReveals.length === 0 || participantReveals.length > online().ONLINE_GEAR_SEAT_IDS.length) fail('INVALID_ONLINE_GEAR_START_PARTICIPANTS');
    const result = new Map();
    for (const entry of participantReveals) {
      exact(entry, ['revealedCommitment', 'trustedContext'], 'INVALID_ONLINE_GEAR_START_PARTICIPANTS');
      const commitment = online().validateLoadoutCommitment(entry.revealedCommitment, entry.trustedContext);
      if (commitment.roundId !== roundId || result.has(commitment.seatId)) fail('INVALID_ONLINE_GEAR_START_PARTICIPANTS');
      result.set(commitment.seatId, freeze({ trustedContext: clone(entry.trustedContext), revealedCommitment: commitment }));
    }
    return result;
  }
  function validateStartGearManifest(value, context) {
    exact(context, ['participantReveals'], 'INVALID_ONLINE_GEAR_START_PARTICIPANTS');
    exact(value, manifestKeys, 'INVALID_ONLINE_GEAR_START_MANIFEST');
    const p = online();
    if (value.version !== ONLINE_GEAR_LOBBY_PROTOCOL_VERSION || value.gearMode !== p.GEAR_MODE_PRIVATE_TRUSTED_V1
      || value.gearProtocolVersion !== p.ONLINE_GEAR_PROTOCOL_VERSION || value.gearRulesVersion !== p.ONLINE_GEAR_RULES_VERSION
      || value.battleGearSnapshotVersion !== battleGearSnapshotVersion() || value.gearTrustModel !== p.ONLINE_GEAR_TRUST_MODEL) fail('INVALID_ONLINE_GEAR_START_MANIFEST');
    const roundId = assertRoundId(value.roundId);
    const expected = revealsBySeat(context.participantReveals, roundId);
    if (!Array.isArray(value.commitments) || value.commitments.length < expected.size) fail('MISSING_ONLINE_GEAR_COMMITMENT');
    if (value.commitments.length > expected.size) fail('UNEXPECTED_ONLINE_GEAR_COMMITMENT');
    const received = new Map();
    for (const rawCommitment of value.commitments) {
      if (!plain(rawCommitment) || typeof rawCommitment.seatId !== 'string' || !expected.has(rawCommitment.seatId) || received.has(rawCommitment.seatId)) fail('UNEXPECTED_ONLINE_GEAR_COMMITMENT');
      const reveal = expected.get(rawCommitment.seatId);
      const commitment = online().validateLoadoutCommitment(rawCommitment, reveal.trustedContext);
      if (online().stableSerializeCommitment(commitment, reveal.trustedContext) !== online().stableSerializeCommitment(reveal.revealedCommitment, reveal.trustedContext)) fail('ONLINE_GEAR_REVEAL_BINDING_MISMATCH');
      received.set(commitment.seatId, commitment);
    }
    if (received.size !== expected.size) fail('MISSING_ONLINE_GEAR_COMMITMENT');
    const commitments = [...received.values()].sort((left, right) => seatIndex(left.seatId) - seatIndex(right.seatId));
    return freeze({
      version: ONLINE_GEAR_LOBBY_PROTOCOL_VERSION,
      gearMode: p.GEAR_MODE_PRIVATE_TRUSTED_V1,
      gearProtocolVersion: p.ONLINE_GEAR_PROTOCOL_VERSION,
      gearRulesVersion: p.ONLINE_GEAR_RULES_VERSION,
      battleGearSnapshotVersion: battleGearSnapshotVersion(),
      gearTrustModel: p.ONLINE_GEAR_TRUST_MODEL,
      roundId,
      commitments
    });
  }
  function createStartGearManifest(input) {
    exact(input, ['commitments', 'participantReveals', 'roundId'], 'INVALID_ONLINE_GEAR_START_MANIFEST');
    const p = online();
    const value = {
      version: ONLINE_GEAR_LOBBY_PROTOCOL_VERSION,
      gearMode: p.GEAR_MODE_PRIVATE_TRUSTED_V1,
      gearProtocolVersion: p.ONLINE_GEAR_PROTOCOL_VERSION,
      gearRulesVersion: p.ONLINE_GEAR_RULES_VERSION,
      battleGearSnapshotVersion: battleGearSnapshotVersion(),
      gearTrustModel: p.ONLINE_GEAR_TRUST_MODEL,
      roundId: input.roundId,
      commitments: clone(input.commitments)
    };
    return validateStartGearManifest(value, { participantReveals: input.participantReveals });
  }

  return freeze({
    ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, ONLINE_GEAR_READY_COMMITMENT_VERSION,
    ONLINE_VISIBILITY_PUBLIC, ONLINE_VISIBILITY_PRIVATE,
    GearOnlineLobbyProtocolError,
    createRoomGearCapability, validateRoomGearCapability,
    createReadyGearBinding, validateReadyGearBinding, stableSerializeReadyGearBinding, validateRevealedGearCommitment,
    createStartGearManifest, validateStartGearManifest
  });
});
