const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const wire = require('../shared/gear-online-firebase-wire.js');

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, (error) => error?.code === code);
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const slots = ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary'];
const trusted = (seatId = 'p1', unitId = 'p1', overrides = {}) => ({
  expectedOwnerUid: `firebase-${seatId}`, expectedSeatId: seatId, expectedUnitId: unitId,
  expectedCharacterId: 'kyoryu', expectedRoundId: roundId, baseHp: 100, baseFuel: 50, ...overrides
});
function makeGear(gearId, slotId = 'barrel') {
  return domain.createGear({
    gearId, generationSeed: `generation:${gearId}`, enhancementSeed: `enhancement:${gearId}`,
    sourceId: 'coop_boss', sourceDetail: { difficulty: 'normal' }, acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: 'test-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'mythic', weight: 1 }] },
    setProfile: { id: 'test-set', setWeights: [{ id: 'assault', weight: 1 }] }, slotId, setId: 'assault'
  });
}
function snapshotWith(items = [], characterId = 'kyoryu', presetId = 'preset1') {
  const loadout = { characterId, presetId, gearIds: [], slots: { barrel: null, armor: null, core: null, engine: null, sight: null, auxiliary: null } };
  items.forEach((item) => { loadout.slots[item.slotId] = item; loadout.gearIds.push(item.gearId); });
  return battleSnapshot.createBattleGearSnapshot({ resolvedLoadout: loadout, baseHp: 100, baseFuel: 50 });
}
function fullCommitment(seatId = 'p1', unitId = 'p1', items = [makeGear(`gear-${seatId}`)], overrides = {}, presetId = 'preset1') {
  const context = trusted(seatId, unitId, overrides);
  return online.createLoadoutCommitment({ battleGearSnapshot: snapshotWith(items, context.expectedCharacterId, presetId), roundId, trustedContext: context });
}
function revealFor(seatId, unitId, items, overrides, presetId) {
  const trustedContext = trusted(seatId, unitId, overrides);
  return { trustedContext, revealedCommitment: fullCommitment(seatId, unitId, items, overrides, presetId) };
}
function manifestFor(entries) {
  const participantReveals = entries.map(([seatId, unitId, items]) => revealFor(seatId, unitId, items));
  return {
    participantReveals,
    manifest: lobby.createStartGearManifest({ roundId, commitments: participantReveals.map((entry) => entry.revealedCommitment), participantReveals })
  };
}
function maxItems(prefix) {
  return slots.map((slot) => domain.enhanceGear(makeGear(`${prefix}-${slot}`, slot), 12));
}
function reverseObject(value) {
  const result = {};
  Object.keys(value).reverse().forEach((key) => { result[key] = value[key]; });
  return result;
}

test('wire constants are v1 and use bounded primitive JSON strings', () => {
  assert.equal(wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, 1);
  assert.equal(wire.MAX_REVEAL_GEAR_JSON_CHARS, 65536);
  assert.equal(wire.MAX_START_GEAR_MANIFEST_JSON_CHARS, 262144);
});

test('Gearless reveal roundtrip preserves all six explicit null slot keys', () => {
  const context = trusted(); const commitment = fullCommitment('p1', 'p1', []);
  const text = wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context });
  const restored = wire.decodeRevealGearCommitment(text, context);
  assert.equal(typeof text, 'string'); assert.deepEqual(restored, commitment);
  assert.deepEqual(Object.keys(restored.canonicalLoadout.slots).sort(), [...slots].sort());
  for (const slot of slots) assert.equal(restored.canonicalLoadout.slots[slot], null);
});

test('partial loadout roundtrip preserves the five empty slots', () => {
  const context = trusted(); const commitment = fullCommitment('p1', 'p1', [makeGear('partial', 'armor')]);
  const restored = wire.decodeRevealGearCommitment(wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context }), context);
  assert.equal(restored.canonicalLoadout.slots.armor.gearId, 'partial');
  for (const slot of slots.filter((slot) => slot !== 'armor')) assert.equal(restored.canonicalLoadout.slots[slot], null);
});

test('empty materialized collections survive canonical string roundtrip', () => {
  const context = trusted(); const commitment = fullCommitment('p1', 'p1', [makeGear('empty-rolls')]);
  const source = commitment.canonicalLoadout.slots.barrel;
  assert.equal(source.subs.some((sub) => Array.isArray(sub.enhancementRollsBp) && sub.enhancementRollsBp.length === 0), true);
  const restored = wire.decodeRevealGearCommitment(wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context }), context);
  assert.deepEqual(restored.canonicalLoadout.slots.barrel.subs, source.subs);
});

test('fully enhanced six-slot loadout remains within reveal budget and roundtrips', () => {
  const context = trusted();
  const items = maxItems('max');
  const commitment = fullCommitment('p1', 'p1', items);
  const text = wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context });
  assert.ok(text.length < wire.MAX_REVEAL_GEAR_JSON_CHARS, `${text.length}`);
  assert.deepEqual(wire.decodeRevealGearCommitment(text, context), commitment);
  console.log(`    full reveal chars: ${text.length}`);
});

test('canonical encoder is deterministic despite input key insertion order', () => {
  const context = trusted(); const commitment = fullCommitment();
  const shuffled = reverseObject(structuredClone(commitment));
  shuffled.canonicalLoadout = reverseObject(shuffled.canonicalLoadout);
  shuffled.canonicalLoadout.slots = reverseObject(shuffled.canonicalLoadout.slots);
  const first = wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context });
  const second = wire.encodeRevealGearCommitment({ loadoutCommitment: shuffled, trustedContext: context });
  assert.equal(first, second);
});

test('decoder rejects noncanonical whitespace and key-order variants', () => {
  const context = trusted(); const text = wire.encodeRevealGearCommitment({ loadoutCommitment: fullCommitment(), trustedContext: context });
  fails('NON_CANONICAL_ONLINE_GEAR_WIRE_JSON', () => wire.decodeRevealGearCommitment(` ${text}`, context));
  const reordered = JSON.stringify(reverseObject(JSON.parse(text)));
  fails('NON_CANONICAL_ONLINE_GEAR_WIRE_JSON', () => wire.decodeRevealGearCommitment(reordered, context));
});

test('malformed and oversized wire payloads fail closed before semantic processing', () => {
  const context = trusted();
  fails('MALFORMED_ONLINE_GEAR_WIRE_JSON', () => wire.decodeRevealGearCommitment('{', context));
  fails('INVALID_ONLINE_GEAR_WIRE_PAYLOAD', () => wire.decodeRevealGearCommitment({}, context));
  fails('ONLINE_GEAR_WIRE_PAYLOAD_TOO_LARGE', () => wire.decodeRevealGearCommitment('x'.repeat(wire.MAX_REVEAL_GEAR_JSON_CHARS + 1), context));
  fails('ONLINE_GEAR_WIRE_PAYLOAD_TOO_LARGE', () => wire.decodeStartGearManifest('x'.repeat(wire.MAX_START_GEAR_MANIFEST_JSON_CHARS + 1), { participantReveals: [] }));
});

test('semantic tamper is rejected even after recomputing a canonical JSON string', () => {
  const context = trusted(); const commitment = structuredClone(fullCommitment());
  commitment.canonicalLoadout.slots.barrel.mainOp.value += 1;
  commitment.loadoutHash = online.calculateLoadoutHash(commitment);
  fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => wire.decodeRevealGearCommitment(domain.stableStringify(commitment), context));
});

test('wire JSON exposes only the Phase 3D-1 materialized commitment view', () => {
  const context = trusted(); const text = wire.encodeRevealGearCommitment({ loadoutCommitment: fullCommitment(), trustedContext: context });
  for (const privateKey of ['generationSeed', 'enhancementSeed', 'future', 'sourceDetail', 'acquiredAt', 'favorite', 'locked', 'derivedStats', 'runtime']) assert.equal(text.includes(privateKey), false, privateKey);
});

test('RTDB topology regression: nulls and empty arrays survive because codec output is one string', () => {
  const context = trusted(); const commitment = fullCommitment('p1', 'p1', []);
  assert.equal(commitment.canonicalLoadout.slots.barrel, null);
  const text = wire.encodeRevealGearCommitment({ loadoutCommitment: commitment, trustedContext: context });
  assert.equal(typeof text, 'string'); assert.equal(text.includes('"barrel":null'), true);
  assert.equal(wire.decodeRevealGearCommitment(text, context).canonicalLoadout.slots.barrel, null);
});

test('four-human manifest roundtrip keeps canonical Firebase seat order and exact reveal binding', () => {
  const input = manifestFor([['p1', 'p1', maxItems('p1')], ['e1', 'e1', maxItems('e1')], ['s1', 'p2', maxItems('s1')], ['s2', 'e2', maxItems('s2')]]);
  const text = wire.encodeStartGearManifest(input);
  const restored = wire.decodeStartGearManifest(text, { participantReveals: input.participantReveals });
  assert.deepEqual(restored.commitments.map((entry) => entry.seatId), ['p1', 'e1', 's1', 's2']);
  assert.deepEqual(restored, input.manifest); assert.ok(text.length < wire.MAX_START_GEAR_MANIFEST_JSON_CHARS, `${text.length}`);
  console.log(`    full four-human manifest chars: ${text.length}`);
});

test('Gearless human commitment remains distinct from an absent CPU-empty seat', () => {
  const input = manifestFor([['p1', 'p1', []], ['e1', 'e1'], ['s2', 'e2']]);
  const restored = wire.decodeStartGearManifest(wire.encodeStartGearManifest(input), { participantReveals: input.participantReveals });
  assert.deepEqual(restored.commitments.map((entry) => entry.seatId), ['p1', 'e1', 's2']);
  assert.equal(restored.commitments[0].canonicalLoadout.slots.barrel, null);
  assert.equal(restored.commitments.some((entry) => entry.seatId === 's1'), false);
});

test('manifest decoder rejects noncanonical serialization and reveals-bound Gear substitution', () => {
  const input = manifestFor([['p1', 'p1', [makeGear('gear-a')]], ['e1', 'e1']]);
  const text = wire.encodeStartGearManifest(input);
  fails('NON_CANONICAL_ONLINE_GEAR_WIRE_JSON', () => wire.decodeStartGearManifest(`\n${text}`, { participantReveals: input.participantReveals }));
  const tampered = structuredClone(input.manifest); tampered.commitments[0] = fullCommitment('p1', 'p1', [makeGear('gear-b')]);
  fails('ONLINE_GEAR_REVEAL_BINDING_MISMATCH', () => wire.decodeStartGearManifest(domain.stableStringify(tampered), { participantReveals: input.participantReveals }));
});

test('manifest wire privacy, immutability and no Ready Binding wire codec are preserved', () => {
  const input = manifestFor([['p1', 'p1'], ['e1', 'e1']]); const before = structuredClone(input);
  const text = wire.encodeStartGearManifest(input); const restored = wire.decodeStartGearManifest(text, { participantReveals: input.participantReveals });
  assert.deepEqual(input, before); assert.equal(Object.isFrozen(restored), true);
  for (const privateKey of ['generationSeed', 'enhancementSeed', 'sourceDetail', 'acquiredAt', 'future']) assert.equal(text.includes(privateKey), false, privateKey);
  assert.equal(typeof wire.encodeReadyGearBinding, 'undefined'); assert.equal(typeof wire.decodeReadyGearBinding, 'undefined');
});

console.log(`gear-online-firebase-wire: ${passed}/15 passed`);
