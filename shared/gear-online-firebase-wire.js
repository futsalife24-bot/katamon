(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./gear-domain.js') : root.KatamonGearDomain,
    typeof module === 'object' && module.exports ? require('./gear-online-protocol.js') : root.KatamonGearOnlineProtocol,
    typeof module === 'object' && module.exports ? require('./gear-online-lobby-protocol.js') : root.KatamonGearOnlineLobbyProtocol
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineFirebaseWire = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (domain, onlineProtocol, lobbyProtocol) {
  'use strict';

  if (!domain || !onlineProtocol || !lobbyProtocol) throw new Error('Katamon Gear ONLINE Firebase wire dependencies are unavailable');

  const ONLINE_GEAR_FIREBASE_WIRE_VERSION = 1;
  const MAX_REVEAL_GEAR_JSON_CHARS = 65536;
  const MAX_START_GEAR_MANIFEST_JSON_CHARS = 262144;

  class GearOnlineFirebaseWireError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'GearOnlineFirebaseWireError';
      this.code = code;
    }
  }

  function fail(code, message) { throw new GearOnlineFirebaseWireError(code, message); }

  function assertWireString(payload, maximumLength) {
    if (typeof payload !== 'string') fail('INVALID_ONLINE_GEAR_WIRE_PAYLOAD', 'ONLINE Gear wire payload must be a primitive string');
    if (payload.length > maximumLength) fail('ONLINE_GEAR_WIRE_PAYLOAD_TOO_LARGE', 'ONLINE Gear wire payload exceeds its canonical size budget');
    return payload;
  }

  function parseWireJson(payload, maximumLength) {
    const text = assertWireString(payload, maximumLength);
    try {
      return { text, value: JSON.parse(text) };
    } catch (error) {
      fail('MALFORMED_ONLINE_GEAR_WIRE_JSON', 'ONLINE Gear wire payload is not valid JSON');
    }
  }

  function assertWithinBudget(serialized, maximumLength) {
    if (serialized.length > maximumLength) fail('ONLINE_GEAR_WIRE_PAYLOAD_TOO_LARGE', 'ONLINE Gear wire payload exceeds its canonical size budget');
    return serialized;
  }

  function encodeRevealGearCommitment(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ONLINE_GEAR_WIRE_PAYLOAD', 'Reveal encoder input must be an object');
    const commitment = onlineProtocol.validateLoadoutCommitment(input.loadoutCommitment, input.trustedContext);
    return assertWithinBudget(onlineProtocol.stableSerializeCommitment(commitment, input.trustedContext), MAX_REVEAL_GEAR_JSON_CHARS);
  }

  function decodeRevealGearCommitment(payload, trustedContext) {
    const parsed = parseWireJson(payload, MAX_REVEAL_GEAR_JSON_CHARS);
    const commitment = onlineProtocol.validateLoadoutCommitment(parsed.value, trustedContext);
    const canonical = onlineProtocol.stableSerializeCommitment(commitment, trustedContext);
    if (canonical !== parsed.text) fail('NON_CANONICAL_ONLINE_GEAR_WIRE_JSON', 'ONLINE Gear reveal wire JSON must use canonical serialization');
    return commitment;
  }

  function encodeStartGearManifest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ONLINE_GEAR_WIRE_PAYLOAD', 'Start manifest encoder input must be an object');
    const manifest = lobbyProtocol.validateStartGearManifest(input.manifest, { participantReveals: input.participantReveals });
    return assertWithinBudget(domain.stableStringify(manifest), MAX_START_GEAR_MANIFEST_JSON_CHARS);
  }

  function decodeStartGearManifest(payload, options) {
    const parsed = parseWireJson(payload, MAX_START_GEAR_MANIFEST_JSON_CHARS);
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_ONLINE_GEAR_WIRE_PAYLOAD', 'Start manifest decoder options must be an object');
    const manifest = lobbyProtocol.validateStartGearManifest(parsed.value, { participantReveals: options.participantReveals });
    const canonical = domain.stableStringify(manifest);
    if (canonical !== parsed.text) fail('NON_CANONICAL_ONLINE_GEAR_WIRE_JSON', 'ONLINE Gear start manifest wire JSON must use canonical serialization');
    return manifest;
  }

  return Object.freeze({
    ONLINE_GEAR_FIREBASE_WIRE_VERSION,
    MAX_REVEAL_GEAR_JSON_CHARS,
    MAX_START_GEAR_MANIFEST_JSON_CHARS,
    GearOnlineFirebaseWireError,
    encodeRevealGearCommitment,
    decodeRevealGearCommitment,
    encodeStartGearManifest,
    decodeStartGearManifest
  });
}));
