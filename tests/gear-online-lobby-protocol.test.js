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
function snapshotWith(items = [], characterId = 'kyoryu') {
  const loadout = { characterId, presetId: 'preset1', gearIds: [], slots: { barrel: null, armor: null, core: null, engine: null, sight: null, auxiliary: null } };
  items.forEach((item) => { loadout.slots[item.slotId] = item; loadout.gearIds.push(item.gearId); });
  return battleSnapshot.createBattleGearSnapshot({ resolvedLoadout: loadout, baseHp: 100, baseFuel: 50 });
}
function fullCommitment(seatId = 'p1', unitId = 'p1', items = [makeGear(`gear-${seatId}`)], overrides = {}) {
  const context = trusted(seatId, unitId, overrides);
  return online.createLoadoutCommitment({ battleGearSnapshot: snapshotWith(items, context.expectedCharacterId), roundId, trustedContext: context });
}
function participantContexts(entries) { return entries.map(([seatId, unitId]) => trusted(seatId, unitId)); }
function createManifest(entries) {
  const contexts = participantContexts(entries);
  const commitments = entries.map(([seatId, unitId]) => fullCommitment(seatId, unitId));
  return lobby.createStartGearManifest({ roundId, commitments, participantContexts: contexts });
}

test('legacy missing capability and private Gear OFF both serialize as Gear OFF', () => {
  assert.equal(lobby.validateRoomGearCapability(undefined, { visibility: 'public' }), null);
  assert.equal(lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'off' }), null);
});

test('private private_trusted_v1 capability is canonical while public Gear ON rejects', () => {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'private_trusted_v1' });
  assert.deepEqual(capability, {
    gearMode: 'private_trusted_v1', gearProtocolVersion: 1, gearRulesVersion: 1,
    battleGearSnapshotVersion: 1, gearTrustModel: 'client_canonical'
  });
  assert.equal(Object.isFrozen(capability), true);
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

test('READY precommit exposes only versioned trust metadata and loadoutHash', () => {
  const full = fullCommitment();
  const ready = lobby.createReadyGearCommitment({ loadoutCommitment: full, trustedContext: trusted() });
  assert.deepEqual(Object.keys(ready).sort(), ['battleGearSnapshotVersion', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'loadoutHash', 'version']);
  const serialized = JSON.stringify(ready);
  for (const privateKey of ['characterId', 'canonicalLoadout', 'gearId', 'slotId', 'ownerUid', 'seatId', 'unitId', 'roundId', 'derivedStats', 'runtime']) assert.equal(serialized.includes(privateKey), false, privateKey);
  assert.equal(Object.isFrozen(ready), true);
});

test('same full commitment yields the same READY hash and a matching reveal succeeds for Gear and Gearless', () => {
  for (const full of [fullCommitment(), fullCommitment('p1', 'p1', [])]) {
    const context = trusted();
    const ready = lobby.createReadyGearCommitment({ loadoutCommitment: full, trustedContext: context });
    assert.equal(lobby.createReadyGearCommitment({ loadoutCommitment: full, trustedContext: context }).loadoutHash, ready.loadoutHash);
    assert.equal(lobby.validateRevealedGearCommitment({ readyCommitment: ready, loadoutCommitment: full, trustedContext: context }).loadoutHash, full.loadoutHash);
  }
});

test('READY hash rejects materialized Gear, preset/loadout and character mutations at reveal', () => {
  const base = fullCommitment(); const context = trusted();
  const ready = lobby.createReadyGearCommitment({ loadoutCommitment: base, trustedContext: context });
  const upgraded = fullCommitment('p1', 'p1', [domain.enhanceGear(makeGear('gear-p1'), 3)]);
  fails('GEAR_READY_HASH_MISMATCH', () => lobby.validateRevealedGearCommitment({ readyCommitment: ready, loadoutCommitment: upgraded, trustedContext: context }));
  const preset = structuredClone(base); preset.canonicalLoadout.presetId = 'preset2'; preset.loadoutHash = online.calculateLoadoutHash(preset);
  fails('GEAR_READY_HASH_MISMATCH', () => lobby.validateRevealedGearCommitment({ readyCommitment: ready, loadoutCommitment: preset, trustedContext: context }));
  const changedCharacterContext = trusted('p1', 'p1', { expectedCharacterId: 'medama' });
  const changedCharacter = online.createLoadoutCommitment({ battleGearSnapshot: snapshotWith([], 'medama'), roundId, trustedContext: changedCharacterContext });
  fails('GEAR_READY_HASH_MISMATCH', () => lobby.validateRevealedGearCommitment({ readyCommitment: ready, loadoutCommitment: changedCharacter, trustedContext: changedCharacterContext }));
});

test('READY precommit schema and versions fail closed', () => {
  const full = fullCommitment();
  const ready = lobby.createReadyGearCommitment({ loadoutCommitment: full, trustedContext: trusted() });
  for (const [key, value] of [['version', 2], ['gearProtocolVersion', 2], ['gearRulesVersion', 2], ['battleGearSnapshotVersion', 2], ['gearTrustModel', 'server_inventory_v1']]) {
    const copy = structuredClone(ready); copy[key] = value;
    fails('INVALID_ONLINE_GEAR_READY_COMMITMENT', () => lobby.validateReadyGearCommitment(copy));
  }
  const unknown = structuredClone(ready); unknown.characterId = 'kyoryu';
  fails('INVALID_ONLINE_GEAR_READY_COMMITMENT', () => lobby.validateReadyGearCommitment(unknown));
});

test('READY reveal rejects a tampered hash and a mismatched full-commitment version', () => {
  const full = fullCommitment(); const context = trusted();
  const ready = lobby.createReadyGearCommitment({ loadoutCommitment: full, trustedContext: context });
  const hash = structuredClone(ready); hash.loadoutHash = 'fnv1a64-v1:0000000000000000';
  fails('GEAR_READY_HASH_MISMATCH', () => lobby.validateRevealedGearCommitment({ readyCommitment: hash, loadoutCommitment: full, trustedContext: context }));
  const version = structuredClone(ready); version.gearRulesVersion = 2;
  fails('INVALID_ONLINE_GEAR_READY_COMMITMENT', () => lobby.validateRevealedGearCommitment({ readyCommitment: version, loadoutCommitment: full, trustedContext: context }));
});

test('1v1 manifest requires p1/e1 commitments and uses canonical Firebase seat ordering', () => {
  const manifest = createManifest([['e1', 'e1'], ['p1', 'p1']]);
  assert.deepEqual(manifest.commitments.map((entry) => entry.seatId), ['p1', 'e1']);
  assert.equal(manifest.roundId, roundId);
  assert.equal(Object.isFrozen(manifest), true);
});

test('2v2 manifest accepts all four canonical Firebase seats and Battle unit mappings', () => {
  const manifest = createManifest([['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);
  assert.deepEqual(manifest.commitments.map((entry) => [entry.seatId, entry.unitId]), [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);
});

test('CPU-empty seats have no manifest commitment while Gearless human commitments remain required', () => {
  const contexts = participantContexts([['p1', 'p1'], ['e1', 'e1'], ['s2', 'e2']]);
  const commitments = [fullCommitment('p1', 'p1'), fullCommitment('e1', 'e1'), fullCommitment('s2', 'e2', [])];
  const manifest = lobby.createStartGearManifest({ roundId, commitments, participantContexts: contexts });
  assert.deepEqual(manifest.commitments.map((entry) => entry.seatId), ['p1', 'e1', 's2']);
  assert.equal(manifest.commitments.find((entry) => entry.seatId === 's2').canonicalLoadout.slots.barrel, null);
});

test('missing expected human and extra unoccupied CPU commitments fail closed', () => {
  const contexts = participantContexts([['p1', 'p1'], ['e1', 'e1'], ['s2', 'e2']]);
  const p1 = fullCommitment('p1', 'p1'); const e1 = fullCommitment('e1', 'e1'); const s1 = fullCommitment('s1', 'p2');
  fails('MISSING_ONLINE_GEAR_COMMITMENT', () => lobby.createStartGearManifest({ roundId, commitments: [p1, e1], participantContexts: contexts }));
  fails('UNEXPECTED_ONLINE_GEAR_COMMITMENT', () => lobby.createStartGearManifest({ roundId, commitments: [p1, e1, s1], participantContexts: contexts }));
});

test('manifest reuses strict 3D-1 identity and semantic tamper validation', () => {
  const contexts = participantContexts([['p1', 'p1'], ['e1', 'e1']]);
  const p1 = fullCommitment('p1', 'p1'); const e1 = fullCommitment('e1', 'e1');
  const wrongOwner = structuredClone(p1); wrongOwner.ownerUid = 'other';
  fails('INVALID_ONLINE_GEAR_IDENTITY', () => lobby.createStartGearManifest({ roundId, commitments: [wrongOwner, e1], participantContexts: contexts }));
  const wrongRound = structuredClone(p1); wrongRound.roundId = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef';
  fails('INVALID_ONLINE_GEAR_IDENTITY', () => lobby.createStartGearManifest({ roundId, commitments: [wrongRound, e1], participantContexts: contexts }));
  const wrongMapping = structuredClone(p1); wrongMapping.unitId = 'e1';
  fails('INVALID_ONLINE_GEAR_IDENTITY', () => lobby.createStartGearManifest({ roundId, commitments: [wrongMapping, e1], participantContexts: contexts }));
  const wrongCharacter = structuredClone(p1); wrongCharacter.characterId = 'medama';
  fails('INVALID_ONLINE_GEAR_IDENTITY', () => lobby.createStartGearManifest({ roundId, commitments: [wrongCharacter, e1], participantContexts: contexts }));
  const tampered = structuredClone(p1); tampered.canonicalLoadout.slots.barrel.mainOp.value += 1; tampered.loadoutHash = online.calculateLoadoutHash(tampered);
  fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => lobby.createStartGearManifest({ roundId, commitments: [tampered, e1], participantContexts: contexts }));
});

test('manifest schema, duplicate seats and impossible mapping fail closed without input mutation', () => {
  const input = { roundId, commitments: [fullCommitment('p1', 'p1'), fullCommitment('e1', 'e1')], participantContexts: participantContexts([['p1', 'p1'], ['e1', 'e1']]) };
  const before = structuredClone(input); lobby.createStartGearManifest(input); assert.deepEqual(input, before);
  const duplicate = structuredClone(input); duplicate.commitments.push(structuredClone(duplicate.commitments[0]));
  fails('MISSING_ONLINE_GEAR_COMMITMENT', () => lobby.createStartGearManifest(duplicate));
  const mapped = structuredClone(input); mapped.commitments[0].unitId = 'e1';
  fails('INVALID_ONLINE_GEAR_IDENTITY', () => lobby.createStartGearManifest(mapped));
  const valid = lobby.createStartGearManifest(input); const unknown = structuredClone(valid); unknown.extra = true;
  fails('INVALID_ONLINE_GEAR_START_MANIFEST', () => lobby.validateStartGearManifest(unknown, { participantContexts: input.participantContexts }));
  const future = structuredClone(valid); future.version = 2;
  fails('INVALID_ONLINE_GEAR_START_MANIFEST', () => lobby.validateStartGearManifest(future, { participantContexts: input.participantContexts }));
});

test('manifest rejects a recomputed-hash tamper and an unsupported full commitment version', () => {
  const contexts = participantContexts([['p1', 'p1'], ['e1', 'e1']]);
  const p1 = fullCommitment('p1', 'p1'); const e1 = fullCommitment('e1', 'e1');
  const hash = structuredClone(p1); hash.loadoutHash = 'fnv1a64-v1:0000000000000000';
  fails('INVALID_ONLINE_GEAR_LOADOUT_HASH', () => lobby.createStartGearManifest({ roundId, commitments: [hash, e1], participantContexts: contexts }));
  const version = structuredClone(p1); version.gearProtocolVersion = 2;
  fails('UNSUPPORTED_FUTURE_ONLINE_GEAR_PROTOCOL', () => lobby.createStartGearManifest({ roundId, commitments: [version, e1], participantContexts: contexts }));
});

test('validated lobby outputs are recursively frozen', () => {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: 'private_trusted_v1' });
  const ready = lobby.createReadyGearCommitment({ loadoutCommitment: fullCommitment(), trustedContext: trusted() });
  const manifest = createManifest([['p1', 'p1'], ['e1', 'e1']]);
  assert.equal(Object.isFrozen(capability), true); assert.equal(Object.isFrozen(ready), true);
  assert.equal(Object.isFrozen(manifest), true); assert.equal(Object.isFrozen(manifest.commitments), true);
  assert.equal(Object.isFrozen(manifest.commitments[0]), true); assert.equal(Object.isFrozen(manifest.commitments[0].canonicalLoadout), true);
});

console.log(`gear-online-lobby-protocol: ${passed}/16 passed`);
