const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, (error) => error?.code === code);
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
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
function createManifest(entries) {
  const participantReveals = entries.map(([seatId, unitId]) => revealFor(seatId, unitId));
  return lobby.createStartGearManifest({ roundId, commitments: participantReveals.map((entry) => entry.revealedCommitment), participantReveals });
}

test('legacy missing capability and private Gear OFF both serialize as Gear OFF', () => {
  assert.equal(lobby.validateRoomGearCapability(undefined, { visibility: 'public' }), null);
  assert.equal(lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'off' }), null);
});

test('private private_trusted_v1 capability is canonical while public Gear ON rejects', () => {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'private_trusted_v1' });
  assert.deepEqual(capability, { gearMode: 'private_trusted_v1', gearProtocolVersion: 1, gearRulesVersion: 1, battleGearSnapshotVersion: 1, gearTrustModel: 'client_canonical' });
  fails('PUBLIC_ROOM_GEAR_NOT_ALLOWED', () => lobby.createRoomGearCapability({ visibility: 'public', gearMode: 'private_trusted_v1' }));
});

test('capability versions, trust and unknown fields fail closed', () => {
  const valid = lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'private_trusted_v1' });
  for (const [key, value] of [['gearProtocolVersion', 2], ['gearRulesVersion', 2], ['battleGearSnapshotVersion', 2], ['gearTrustModel', 'server_inventory_v1']]) {
    const copy = structuredClone(valid); copy[key] = value;
    fails('UNSUPPORTED_ONLINE_GEAR_CAPABILITY', () => lobby.validateRoomGearCapability(copy, { visibility: 'private' }));
  }
  const unknown = structuredClone(valid); unknown.extra = true;
  fails('INVALID_ONLINE_GEAR_CAPABILITY', () => lobby.validateRoomGearCapability(unknown, { visibility: 'private' }));
});

test('Ready Gear Binding is local-only and no ReadyGearCommitment wire API is exported', () => {
  const full = fullCommitment();
  const binding = lobby.createReadyGearBinding({ loadoutCommitment: full, trustedContext: trusted() });
  assert.deepEqual(Object.keys(binding).sort(), ['battleGearSnapshotVersion', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'loadoutHash', 'version']);
  assert.equal(typeof lobby.createReadyGearCommitment, 'undefined');
  assert.equal(typeof lobby.validateReadyGearCommitment, 'undefined');
  const serialized = JSON.stringify(binding);
  for (const privateKey of ['characterId', 'canonicalLoadout', 'gearId', 'slotId', 'ownerUid', 'seatId', 'unitId', 'roundId', 'derivedStats', 'runtime']) assert.equal(serialized.includes(privateKey), false, privateKey);
});

test('Ready Gear Binding is deterministic, stable-serializable, immutable and does not mutate input', () => {
  const full = fullCommitment(); const input = { loadoutCommitment: full, trustedContext: trusted() }; const before = structuredClone(input);
  const first = lobby.createReadyGearBinding(input); const second = lobby.createReadyGearBinding(input);
  assert.equal(lobby.stableSerializeReadyGearBinding(first), lobby.stableSerializeReadyGearBinding(second));
  assert.equal(Object.isFrozen(first), true); assert.deepEqual(input, before);
});

test('Ready Gear Binding changes for Gear, enhancement, preset and character mutations', () => {
  const base = fullCommitment(); const baseBinding = lobby.createReadyGearBinding({ loadoutCommitment: base, trustedContext: trusted() });
  const enhanced = fullCommitment('p1', 'p1', [domain.enhanceGear(makeGear('gear-p1'), 3)]);
  const preset = fullCommitment('p1', 'p1', [makeGear('gear-p1')], {}, 'preset2');
  const characterContext = trusted('p1', 'p1', { expectedCharacterId: 'medama' });
  const character = online.createLoadoutCommitment({ battleGearSnapshot: snapshotWith([makeGear('gear-p1')], 'medama'), roundId, trustedContext: characterContext });
  for (const [commitment, context] of [[enhanced, trusted()], [preset, trusted()], [character, characterContext]]) assert.notEqual(lobby.createReadyGearBinding({ loadoutCommitment: commitment, trustedContext: context }).loadoutHash, baseBinding.loadoutHash);
});

test('Gearless Ready Gear Binding is legal but never a READY wire payload', () => {
  const full = fullCommitment('p1', 'p1', []);
  const binding = lobby.createReadyGearBinding({ loadoutCommitment: full, trustedContext: trusted() });
  assert.match(binding.loadoutHash, /^fnv1a64-v1:[0-9a-f]{16}$/);
  assert.equal(typeof lobby.stableSerializeReadyGearBinding, 'function');
});

test('revealed full commitment must exactly match its local Ready Gear Binding', () => {
  const full = fullCommitment(); const readyBinding = lobby.createReadyGearBinding({ loadoutCommitment: full, trustedContext: trusted() });
  assert.equal(lobby.validateRevealedGearCommitment({ readyBinding, loadoutCommitment: full, trustedContext: trusted() }).loadoutHash, full.loadoutHash);
  const changed = fullCommitment('p1', 'p1', [domain.enhanceGear(makeGear('gear-p1'), 3)]);
  fails('GEAR_READY_HASH_MISMATCH', () => lobby.validateRevealedGearCommitment({ readyBinding, loadoutCommitment: changed, trustedContext: trusted() }));
});

test('1v1 manifest binds exact verified reveals and canonical p1/e1 ordering', () => {
  const manifest = createManifest([['e1', 'e1'], ['p1', 'p1']]);
  assert.deepEqual(manifest.commitments.map((entry) => entry.seatId), ['p1', 'e1']);
  assert.equal(Object.isFrozen(manifest), true); assert.equal(Object.isFrozen(manifest.commitments), true);
});

test('2v2 manifest accepts all four canonical Firebase seat to Battle unit mappings', () => {
  const manifest = createManifest([['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);
  assert.deepEqual(manifest.commitments.map((entry) => [entry.seatId, entry.unitId]), [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);
});

test('CPU-empty seats are absent while Gearless human reveal and manifest commitment are required', () => {
  const p1 = revealFor('p1', 'p1'); const e1 = revealFor('e1', 'e1'); const s2 = revealFor('s2', 'e2', []);
  const manifest = lobby.createStartGearManifest({ roundId, commitments: [p1.revealedCommitment, e1.revealedCommitment, s2.revealedCommitment], participantReveals: [p1, e1, s2] });
  assert.deepEqual(manifest.commitments.map((entry) => entry.seatId), ['p1', 'e1', 's2']);
  assert.equal(manifest.commitments.find((entry) => entry.seatId === 's2').canonicalLoadout.slots.barrel, null);
});

test('manifest rejects substitution of a different legal Gear after reveal', () => {
  const p1 = revealFor('p1', 'p1', [makeGear('gear-a')]); const e1 = revealFor('e1', 'e1');
  const gearB = fullCommitment('p1', 'p1', [makeGear('gear-b')]);
  fails('ONLINE_GEAR_REVEAL_BINDING_MISMATCH', () => lobby.createStartGearManifest({ roundId, commitments: [gearB, e1.revealedCommitment], participantReveals: [p1, e1] }));
});

test('manifest rejects enhancement and preset substitution after reveal', () => {
  const p1 = revealFor('p1', 'p1', [makeGear('gear-p1')]); const e1 = revealFor('e1', 'e1');
  const enhanced = fullCommitment('p1', 'p1', [domain.enhanceGear(makeGear('gear-p1'), 3)]);
  const preset = fullCommitment('p1', 'p1', [makeGear('gear-p1')], {}, 'preset2');
  for (const changed of [enhanced, preset]) fails('ONLINE_GEAR_REVEAL_BINDING_MISMATCH', () => lobby.createStartGearManifest({ roundId, commitments: [changed, e1.revealedCommitment], participantReveals: [p1, e1] }));
});

test('manifest rejects Gear substitution for a Gearless human reveal', () => {
  const p1 = revealFor('p1', 'p1', []); const e1 = revealFor('e1', 'e1');
  const equipped = fullCommitment('p1', 'p1', [makeGear('gear-p1')]);
  fails('ONLINE_GEAR_REVEAL_BINDING_MISMATCH', () => lobby.createStartGearManifest({ roundId, commitments: [equipped, e1.revealedCommitment], participantReveals: [p1, e1] }));
});

test('participant reveal input rejects missing, extra, duplicate and malformed identities', () => {
  const p1 = revealFor('p1', 'p1'); const e1 = revealFor('e1', 'e1'); const s1 = revealFor('s1', 'p2');
  fails('MISSING_ONLINE_GEAR_COMMITMENT', () => lobby.createStartGearManifest({ roundId, commitments: [p1.revealedCommitment], participantReveals: [p1, e1] }));
  fails('UNEXPECTED_ONLINE_GEAR_COMMITMENT', () => lobby.createStartGearManifest({ roundId, commitments: [p1.revealedCommitment, e1.revealedCommitment, s1.revealedCommitment], participantReveals: [p1, e1] }));
  fails('INVALID_ONLINE_GEAR_START_PARTICIPANTS', () => lobby.createStartGearManifest({ roundId, commitments: [p1.revealedCommitment, e1.revealedCommitment], participantReveals: [p1, structuredClone(p1)] }));
  const wrong = structuredClone(p1); wrong.trustedContext.expectedUnitId = 'e1';
  fails('INVALID_ONLINE_GEAR_TRUSTED_CONTEXT', () => lobby.createStartGearManifest({ roundId, commitments: [p1.revealedCommitment, e1.revealedCommitment], participantReveals: [wrong, e1] }));
});

test('manifest schemas, version/hash tamper and caller inputs fail closed without mutation', () => {
  const p1 = revealFor('p1', 'p1'); const e1 = revealFor('e1', 'e1');
  const input = { roundId, commitments: [p1.revealedCommitment, e1.revealedCommitment], participantReveals: [p1, e1] }; const before = structuredClone(input);
  const manifest = lobby.createStartGearManifest(input); assert.deepEqual(input, before);
  const hash = structuredClone(manifest); hash.commitments[0].loadoutHash = 'fnv1a64-v1:0000000000000000';
  fails('INVALID_ONLINE_GEAR_LOADOUT_HASH', () => lobby.validateStartGearManifest(hash, { participantReveals: input.participantReveals }));
  const version = structuredClone(manifest); version.version = 1;
  fails('INVALID_ONLINE_GEAR_START_MANIFEST', () => lobby.validateStartGearManifest(version, { participantReveals: input.participantReveals }));
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 2, 'runtime-state-aware manifests must fence old Gear clients');
  const unknown = structuredClone(manifest); unknown.extra = true;
  fails('INVALID_ONLINE_GEAR_START_MANIFEST', () => lobby.validateStartGearManifest(unknown, { participantReveals: input.participantReveals }));
});

console.log(`gear-online-lobby-protocol: ${passed}/16 passed`);
