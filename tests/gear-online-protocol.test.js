const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const protocol = require('../shared/gear-online-protocol.js');

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, (error) => error?.code === code);
const emptyLoadout = (characterId = 'kyoryu') => ({
  characterId, presetId: 'preset1', gearIds: [],
  slots: { barrel: null, armor: null, core: null, engine: null, sight: null, auxiliary: null }
});
const trusted = (overrides = {}) => ({
  expectedOwnerUid: 'firebase-user-1', expectedSeatId: 'p1', expectedUnitId: 'p1', expectedCharacterId: 'kyoryu',
  expectedRoundId: '0123456789abcdef0123456789abcdef0123456789abcdef', baseHp: 100, baseFuel: 50,
  ...overrides
});
const createInput = (battleGearSnapshot, context = trusted()) => ({ battleGearSnapshot, roundId: context.expectedRoundId, trustedContext: context });
function makeGear(gearId, slotId = 'barrel', setId = 'assault') {
  return domain.createGear({
    gearId, generationSeed: `generation:${gearId}`, enhancementSeed: `enhancement:${gearId}`,
    sourceId: 'coop_boss', sourceDetail: { difficulty: 'normal' }, acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: 'test-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'mythic', weight: 1 }] },
    setProfile: { id: 'test-set', setWeights: [{ id: setId, weight: 1 }] }, slotId, setId
  });
}
function snapshotWith(...items) {
  const loadout = emptyLoadout();
  items.forEach((item) => { loadout.slots[item.slotId] = item; loadout.gearIds.push(item.gearId); });
  return battleSnapshot.createBattleGearSnapshot({ resolvedLoadout: loadout, baseHp: 100, baseFuel: 50 });
}
function commitmentWith(...items) { return protocol.createLoadoutCommitment(createInput(snapshotWith(...items))); }

test('protocol constants, modes, trust model and seat identities are v1-fixed', () => {
  assert.equal(protocol.ONLINE_GEAR_PROTOCOL_VERSION, 1);
  assert.equal(protocol.ONLINE_GEAR_RULES_VERSION, 1);
  assert.equal(protocol.ONLINE_GEAR_TRUST_MODEL, 'client_canonical');
  assert.equal(protocol.GEAR_MODE_OFF, 'off');
  assert.equal(protocol.GEAR_MODE_PRIVATE_TRUSTED_V1, 'private_trusted_v1');
  assert.deepEqual(protocol.ONLINE_GEAR_SEAT_IDS, ['p1', 'e1', 's1', 's2']);
  assert.deepEqual(protocol.ONLINE_GEAR_UNIT_IDS, ['p1', 'e1', 'p2', 'e2']);
  assert.deepEqual(protocol.ONLINE_GEAR_SEAT_UNIT_MAP, { p1: 'p1', e1: 'e1', s1: 'p2', s2: 'e2' });
  assert.equal(protocol.ONLINE_GEAR_LOADOUT_HASH_ALGORITHM, 'fnv1a64-v1');
});

test('validated Battle Gear Snapshot creates the exact immutable commitment shape', () => {
  const value = commitmentWith(makeGear('barrel'));
  assert.deepEqual(Object.keys(value).sort(), ['battleGearSnapshotVersion', 'canonicalLoadout', 'characterId', 'gearProtocolVersion', 'gearRulesVersion', 'gearTrustModel', 'loadoutHash', 'ownerUid', 'roundId', 'seatId', 'unitId']);
  assert.equal(value.ownerUid, 'firebase-user-1'); assert.equal(value.seatId, 'p1'); assert.equal(value.unitId, 'p1');
  assert.equal(value.characterId, 'kyoryu'); assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.canonicalLoadout), true);
});

test('canonical loadout omits private seeds, provenance, storage metadata and derived combat', () => {
  const value = commitmentWith(makeGear('private-fields'));
  const text = JSON.stringify(value.canonicalLoadout);
  for (const key of ['generationSeed', 'enhancementSeed', 'future', 'sourceDetail', 'acquiredAt', 'favorite', 'locked', 'derivedStats', 'maxHp', 'shield']) assert.equal(text.includes(key), false, key);
});

test('stable serialization and hash ignore insertion order and preserve materialized identity', () => {
  const value = commitmentWith(makeGear('stable'));
  const shuffled = { slots: {}, presetId: value.canonicalLoadout.presetId };
  [...domain.SLOT_IDS].reverse().forEach((slot) => { shuffled.slots[slot] = structuredClone(value.canonicalLoadout.slots[slot]); });
  const hash = protocol.calculateLoadoutHash({ gearRulesVersion: value.gearRulesVersion, battleGearSnapshotVersion: value.battleGearSnapshotVersion, characterId: value.characterId, canonicalLoadout: shuffled });
  assert.equal(hash, value.loadoutHash);
  assert.equal(protocol.stableSerializeCommitment(structuredClone(value), trusted()), protocol.stableSerializeCommitment(value, trusted()));
});

test('non-combat acquisition metadata never changes the materialized loadout identity', () => {
  const raw = makeGear('materialized'); const altered = structuredClone(raw);
  altered.acquiredAt = '2030-01-01T00:00:00Z'; altered.sourceDetail = { difficulty: 'extreme' };
  const first = protocol.createLoadoutCommitment(createInput(snapshotWith(raw)));
  const second = protocol.createLoadoutCommitment(createInput(snapshotWith(altered)));
  assert.equal(first.loadoutHash, second.loadoutHash);
  assert.deepEqual(first.canonicalLoadout, second.canonicalLoadout);
});

test('canonical hash has a fixed v1 fixture', () => {
  const value = commitmentWith(makeGear('hash-fixture'));
  assert.equal(value.loadoutHash, 'fnv1a64-v1:faf6ce071f25d275');
});

test('FNV-1a v1 hashes canonical UTF-8 bytes with a fixed Unicode fixture', () => {
  const value = commitmentWith(makeGear('unicode-猫🛡️'));
  const clone = structuredClone(value);
  assert.equal(value.loadoutHash, 'fnv1a64-v1:6172f79e6241e0cf');
  assert.equal(protocol.calculateLoadoutHash(clone), value.loadoutHash);
});

test('materialized stat or slot assignment changes the canonical hash', () => {
  const raw = makeGear('mutation');
  const before = commitmentWith(raw);
  const upgraded = domain.enhanceGear(raw, 3);
  const after = commitmentWith(upgraded);
  assert.notEqual(before.loadoutHash, after.loadoutHash);
  const reassigned = commitmentWith(makeGear('mutation', 'armor'));
  assert.notEqual(before.loadoutHash, reassigned.loadoutHash);
});

test('receiver reconstructs an equivalent semantically validated Battle Gear Snapshot', () => {
  const source = snapshotWith(domain.enhanceGear(makeGear('barrel'), 3), makeGear('armor', 'armor'));
  const value = protocol.createLoadoutCommitment(createInput(source));
  const rebuilt = protocol.reconstructBattleGearSnapshot(value, trusted());
  assert.deepEqual(rebuilt, source); assert.equal(Object.isFrozen(rebuilt), true);
});

test('Gearless commitment is legal and reconstructs Gearless combat', () => {
  const source = snapshotWith(); const value = protocol.createLoadoutCommitment(createInput(source));
  const rebuilt = protocol.reconstructBattleGearSnapshot(value, trusted());
  assert.deepEqual(value.canonicalLoadout.slots, emptyLoadout().slots);
  assert.equal(rebuilt.derivedStats.maxHp, 100); assert.equal(rebuilt.derivedStats.maxFuel, 50);
});

test('identity binds owner, seat, unit, character and round to trusted context', () => {
  const value = commitmentWith(makeGear('identity'));
  for (const [key, changed] of [['ownerUid', 'other-user'], ['seatId', 'e1'], ['unitId', 'e1'], ['characterId', 'medama'], ['roundId', 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef']]) {
    const copy = structuredClone(value); copy[key] = changed;
    fails('INVALID_ONLINE_GEAR_IDENTITY', () => protocol.validateLoadoutCommitment(copy, trusted()));
  }
  const mismatch = structuredClone(value); mismatch.unitId = 'e1';
  fails('INVALID_ONLINE_GEAR_TRUSTED_CONTEXT', () => protocol.validateLoadoutCommitment(mismatch, trusted({ expectedUnitId: 'e1', expectedSeatId: 'p1' })));
});

test('all canonical Firebase seat to Battle unit mappings create, validate and reconstruct', () => {
  for (const [seatId, unitId] of Object.entries({ p1: 'p1', e1: 'e1', s1: 'p2', s2: 'e2' })) {
    const context = trusted({ expectedSeatId: seatId, expectedUnitId: unitId });
    const value = protocol.createLoadoutCommitment(createInput(snapshotWith(makeGear(`seat-${seatId}`)), context));
    assert.equal(value.seatId, seatId); assert.equal(value.unitId, unitId);
    assert.equal(protocol.validateLoadoutCommitment(value, context).loadoutHash, value.loadoutHash);
    assert.equal(protocol.reconstructBattleGearSnapshot(value, context).characterId, 'kyoryu');
  }
});

test('invalid Firebase seat and Battle unit mappings fail closed', () => {
  const validS1 = protocol.createLoadoutCommitment(createInput(snapshotWith(makeGear('mapping')), trusted({ expectedSeatId: 's1', expectedUnitId: 'p2' })));
  for (const [seatId, unitId] of [['s1', 's1'], ['s1', 'e2'], ['s2', 'p2'], ['p2', 'p2'], ['e2', 'e2'], ['p1', 's1']]) {
    const copy = structuredClone(validS1); copy.seatId = seatId; copy.unitId = unitId;
    fails('INVALID_ONLINE_GEAR_IDENTITY', () => protocol.validateLoadoutCommitment(copy, trusted({ expectedSeatId: 's1', expectedUnitId: 'p2' })));
  }
});

test('protocol, rules, snapshot and trust model versions fail closed', () => {
  const value = commitmentWith(makeGear('versions'));
  for (const [key, changed, code] of [
    ['gearProtocolVersion', 2, 'UNSUPPORTED_FUTURE_ONLINE_GEAR_PROTOCOL'], ['gearProtocolVersion', 0, 'UNSUPPORTED_ONLINE_GEAR_PROTOCOL'],
    ['gearRulesVersion', 2, 'UNSUPPORTED_ONLINE_GEAR_RULES'], ['battleGearSnapshotVersion', 2, 'UNSUPPORTED_ONLINE_GEAR_BATTLE_SNAPSHOT'],
    ['gearTrustModel', 'server_inventory_v1', 'INVALID_ONLINE_GEAR_TRUST_MODEL']
  ]) { const copy = structuredClone(value); copy[key] = changed; fails(code, () => protocol.validateLoadoutCommitment(copy, trusted())); }
});

test('strict schemas reject unknown and missing commitment/loadout/slot fields', () => {
  const value = commitmentWith(makeGear('schema'));
  const unknown = structuredClone(value); unknown.derivedStats = {}; fails('INVALID_ONLINE_GEAR_COMMITMENT', () => protocol.validateLoadoutCommitment(unknown, trusted()));
  const missing = structuredClone(value); delete missing.ownerUid; fails('INVALID_ONLINE_GEAR_COMMITMENT', () => protocol.validateLoadoutCommitment(missing, trusted()));
  const loadout = structuredClone(value); loadout.canonicalLoadout.derivedStats = {}; fails('INVALID_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(loadout, trusted()));
  const slots = structuredClone(value); delete slots.canonicalLoadout.slots.engine; fails('INVALID_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(slots, trusted()));
});

test('tampered canonical loadout/hash and semantic Gear views fail closed', () => {
  const value = commitmentWith(domain.enhanceGear(makeGear('tamper'), 3));
  const loadout = structuredClone(value); loadout.canonicalLoadout.slots.barrel.mainOp.value += 1; fails('INVALID_ONLINE_GEAR_LOADOUT_HASH', () => protocol.validateLoadoutCommitment(loadout, trusted()));
  const hash = structuredClone(value); hash.loadoutHash = 'fnv1a64-v1:0000000000000000'; fails('INVALID_ONLINE_GEAR_LOADOUT_HASH', () => protocol.validateLoadoutCommitment(hash, trusted()));
  const semantic = structuredClone(value); semantic.canonicalLoadout.slots.barrel.mainOp.value += 1; semantic.loadoutHash = protocol.calculateLoadoutHash(semantic); fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(semantic, trusted()));
  const wrongSlot = structuredClone(value); wrongSlot.canonicalLoadout.slots.barrel.slotId = 'armor'; wrongSlot.loadoutHash = protocol.calculateLoadoutHash(wrongSlot); fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(wrongSlot, trusted()));
});

test('duplicate Gear IDs and malformed roll history fail semantic reconstruction', () => {
  const value = commitmentWith(makeGear('a'), makeGear('b', 'armor'));
  const duplicate = structuredClone(value); duplicate.canonicalLoadout.slots.armor.gearId = duplicate.canonicalLoadout.slots.barrel.gearId; duplicate.loadoutHash = protocol.calculateLoadoutHash(duplicate); fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(duplicate, trusted()));
  const rolls = commitmentWith(domain.enhanceGear(makeGear('rolls'), 3)); const malformed = structuredClone(rolls); const rolledSub = malformed.canonicalLoadout.slots.barrel.subs.find((sub) => sub.enhancementRollsBp.length > 0); rolledSub.enhancementRollsBp[0] += 1; malformed.loadoutHash = protocol.calculateLoadoutHash(malformed); fails('TAMPERED_ONLINE_GEAR_LOADOUT', () => protocol.validateLoadoutCommitment(malformed, trusted()));
});

test('creation rejects an invalid sender Battle Gear Snapshot and never mutates inputs', () => {
  const source = snapshotWith(makeGear('input')); const before = structuredClone(source); const input = createInput(source); const originalInput = structuredClone(input);
  protocol.createLoadoutCommitment(input); assert.deepEqual(source, before); assert.deepEqual(input, originalInput);
  const invalid = structuredClone(source); invalid.derivedStats.maxHp += 1; fails('INVALID_ONLINE_GEAR_BATTLE_SNAPSHOT', () => protocol.createLoadoutCommitment(createInput(invalid)));
});

console.log(`gear-online-protocol: ${passed}/18 passed`);
