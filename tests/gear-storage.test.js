const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gear = require('../shared/gear-domain.js');
const storageApi = require('../shared/gear-storage.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  NG   ${name}`);
    throw error;
  }
}
function expectCode(code, fn) {
  assert.throws(fn, (error) => error && error.code === code, `expected ${code}`);
}

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.getCalls = [];
    this.setCalls = [];
    this.throwOnGet = null;
    this.throwOnSet = null;
    this.readBackOverride = undefined;
  }
  getItem(key) {
    this.getCalls.push(key);
    if (this.throwOnGet) throw this.throwOnGet;
    if (this.readBackOverride !== undefined && key === storageApi.GEAR_STORAGE_KEY) return this.readBackOverride;
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.setCalls.push([key, value]);
    if (this.throwOnSet) throw this.throwOnSet;
    this.values.set(key, value);
  }
}

function fixedProfile(star = 6, rarityId = 'mythic') {
  return {
    id: `storage-${star}-${rarityId}`,
    starWeights: [{ id: star, weight: 1 }],
    rarityWeights: [{ id: rarityId, weight: 1 }],
  };
}
const SET_PROFILE = { id: 'storage-set', setWeights: [{ id: 'assault', weight: 1 }] };
function makeGear(gearId = 'gear-a', options = {}) {
  return gear.createGear({
    gearId,
    generationSeed: `generation-${gearId}`,
    enhancementSeed: `enhancement-${gearId}`,
    sourceId: 'coop_boss',
    sourceDetail: { difficulty: 'normal', nested: ['safe', 1] },
    acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile: fixedProfile(options.star || 6, options.rarityId || 'mythic'),
    setProfile: SET_PROFILE,
    slotId: options.slotId || 'engine',
  });
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validState() {
  const state = storageApi.createDefaultGearStorageState();
  state.inventory.push({ gear: makeGear('inventory-a'), locked: false, favorite: false });
  state.tempBox.push({ gear: makeGear('temp-a'), locked: true, favorite: false, enteredAtMs: 123456789 });
  state.unclaimedRewards.push({
    rewardId: 'reward-a', sourceId: 'coop_boss', sourceDetail: { bossId: 'fortress' }, createdAtMs: 123456790,
    gears: [makeGear('reward-a')], powder: 6, blueprintShards: 4,
  });
  state.resources = { powder: 12, blueprintShards: 34 };
  return state;
}
function validV1State() {
  const state = validState();
  state.storageSchemaVersion = 1;
  delete state.rewardLedger;
  state.unclaimedRewards.forEach((reward) => { delete reward.powder; });
  return state;
}
function validV2State() {
  const state = validState();
  state.storageSchemaVersion = 2;
  state.unclaimedRewards.forEach((reward) => { delete reward.powder; });
  return state;
}
function assertOtherKeysUnchanged(storage, before) {
  Object.entries(before).forEach(([key, value]) => assert.equal(storage.getItem(key), value, `${key} must remain untouched`));
}

test('main v3 and reveal v1 default states have exact independent shapes and fresh references', () => {
  const first = storageApi.createDefaultGearStorageState();
  const second = storageApi.createDefaultGearStorageState();
  assert.deepEqual(first, { storageSchemaVersion: 3, inventory: [], tempBox: [], unclaimedRewards: [], rewardLedger: {}, resources: { powder: 0, blueprintShards: 0 } });
  assert.notEqual(first, second);
  assert.notEqual(first.resources, second.resources);
  const revealFirst = storageApi.createDefaultRevealHistoryState();
  const revealSecond = storageApi.createDefaultRevealHistoryState();
  assert.deepEqual(revealFirst, { schemaVersion: 1, viewedThroughLevelByGearId: {} });
  assert.notEqual(revealFirst.viewedThroughLevelByGearId, revealSecond.viewedThroughLevelByGearId);
});
test('valid state encode/decode and storage round trips preserve canonical state', () => {
  const state = validState();
  const encoded = storageApi.encodeGearStorageState(state);
  assert.equal(encoded, storageApi.encodeGearStorageState(clone(state)));
  assert.deepEqual(storageApi.decodeGearStorageState(encoded), storageApi.migrateGearStorageState(state));
  const storage = new FakeStorage();
  assert.deepEqual(storageApi.saveGearState(state, storage), storageApi.loadGearState(storage));
  const reveal = { schemaVersion: 1, viewedThroughLevelByGearId: { 'old-gear': 3, 'new-gear': 12 } };
  assert.deepEqual(storageApi.loadRevealHistory((storageApi.saveRevealHistory(reveal, storage), storage)), reveal);
});
test('storage schema v3 round-trips production-calibrated fixed slots without injected tuning', () => {
  const state = storageApi.createDefaultGearStorageState();
  ['barrel', 'armor', 'core'].forEach((slotId, index) => {
    state.inventory.push({ gear: makeGear(`storage-fixed-${slotId}`, { slotId, star: index + 4, rarityId: 'rare' }), locked: false, favorite: false });
  });
  const restored = storageApi.decodeGearStorageState(storageApi.encodeGearStorageState(state));
  assert.equal(restored.storageSchemaVersion, 3);
  assert.deepEqual(restored.inventory.map((entry) => entry.gear.mainOp), [
    { opId: 'flat_attack', unit: 'flat', value: 2, finalValue: 9 },
    { opId: 'flat_hp', unit: 'flat', value: 2, finalValue: 10 },
    { opId: 'flat_defense', unit: 'flat', value: 3, finalValue: 12 },
  ]);
});
test('migration strictly validates v1/v2 before converting them to v3 and accepts canonical v3', () => {
  const state = validState();
  assert.equal(storageApi.migrateGearStorageState(state).storageSchemaVersion, 3);
  const v1 = validV1State();
  const migrated = storageApi.migrateGearStorageState(v1);
  assert.equal(migrated.storageSchemaVersion, 3);
  assert.deepEqual(migrated.rewardLedger, {});
  assert.deepEqual(migrated.inventory, v1.inventory);
  assert.deepEqual(migrated.tempBox, v1.tempBox);
  assert.deepEqual(migrated.unclaimedRewards, v1.unclaimedRewards.map((reward) => ({ ...reward, powder: 0 })));
  assert.deepEqual(migrated.resources, v1.resources);
  assert.deepEqual(v1, validV1State(), 'migration must not mutate v1 input');
  const v2 = validV2State();
  const migratedV2 = storageApi.migrateGearStorageState(v2);
  assert.equal(migratedV2.storageSchemaVersion, 3);
  assert.equal(migratedV2.unclaimedRewards[0].powder, 0);
  assert.deepEqual(v2, validV2State(), 'migration must not mutate v2 input');
  const invalidV1 = validV1State();
  invalidV1.resources.coins = 0;
  expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(invalidV1));
  expectCode('MISSING_STORAGE_SCHEMA_VERSION', () => storageApi.migrateGearStorageState({}));
  expectCode('UNSUPPORTED_STORAGE_VERSION', () => storageApi.migrateGearStorageState({ ...state, storageSchemaVersion: 0 }));
  expectCode('UNSUPPORTED_FUTURE_STORAGE_VERSION', () => storageApi.migrateGearStorageState({ ...state, storageSchemaVersion: 999 }));
  expectCode('MISSING_REVEAL_STORAGE_SCHEMA_VERSION', () => storageApi.migrateRevealHistoryState({}));
  expectCode('UNSUPPORTED_REVEAL_STORAGE_VERSION', () => storageApi.migrateRevealHistoryState({ schemaVersion: 0, viewedThroughLevelByGearId: {} }));
  expectCode('UNSUPPORTED_FUTURE_REVEAL_STORAGE_VERSION', () => storageApi.migrateRevealHistoryState({ schemaVersion: 999, viewedThroughLevelByGearId: {} }));
});
test('v1 migration accepts only reward shapes supported by v3 and preserves rejected raw bytes', () => {
  const rewardFor = (sourceId, count) => ({
    rewardId: `v1-${sourceId}-${count}`,
    sourceId,
    sourceDetail: null,
    createdAtMs: 1,
    gears: Array.from({ length: count }, (_unused, index) => makeGear(`v1-${sourceId}-${count}-${index}`)),
    blueprintShards: 0,
  });
  for (const [sourceId, maximum] of [['cpu_battle', 5], ['coop_boss', 3], ['future_source', 5]]) {
    for (let count = 0; count <= maximum; count += 1) {
      const value = validV1State();
      value.unclaimedRewards = [rewardFor(sourceId, count)];
      const migrated = storageApi.migrateGearStorageState(value);
      assert.equal(migrated.unclaimedRewards[0].gears.length, count);
      assert.equal(migrated.unclaimedRewards[0].sourceId, sourceId);
    }
  }
  for (const [sourceId, count] of [['cpu_battle', 6], ['coop_boss', 4], ['coop_boss', 5], ['future_source', 6]]) {
    const value = validV1State();
    value.unclaimedRewards = [rewardFor(sourceId, count)];
    const raw = JSON.stringify(value);
    const storage = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: raw });
    expectCode('UNSUPPORTED_V1_REWARD_SHAPE', () => storageApi.loadGearState(storage));
    assert.equal(storage.getItem(storageApi.GEAR_STORAGE_KEY), raw, 'unsupported pre-release v1 raw must remain byte-identical');
    assert.equal(storage.setCalls.length, 0, 'failed migration must not rewrite storage');
  }
});
test('first run alone returns default; malformed, null, array and empty/object values fail closed', () => {
  const storage = new FakeStorage();
  assert.deepEqual(storageApi.loadGearState(storage), storageApi.createDefaultGearStorageState());
  [['', 'STORAGE_JSON_PARSE_FAILED'], ['null', 'INVALID_STORAGE_STATE'], ['{', 'STORAGE_JSON_PARSE_FAILED'], ['[]', 'INVALID_STORAGE_STATE'], ['{}', 'MISSING_STORAGE_SCHEMA_VERSION']].forEach(([raw, code]) => {
    storage.values.set(storageApi.GEAR_STORAGE_KEY, raw);
    expectCode(code, () => storageApi.loadGearState(storage));
  });
  storage.values.set(storageApi.GEAR_STORAGE_KEY, JSON.stringify({ storageSchemaVersion: 999 }));
  expectCode('UNSUPPORTED_FUTURE_STORAGE_VERSION', () => storageApi.loadGearState(storage));
  assert.equal(storage.getItem(storageApi.GEAR_STORAGE_KEY), JSON.stringify({ storageSchemaVersion: 999 }), 'future data must remain raw and untouched');
});
test('loading valid v1 migrates in memory only and an explicit save persists the v3 envelope', () => {
  const rawV1 = JSON.stringify(validV1State());
  const storage = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: rawV1 });
  const loaded = storageApi.loadGearState(storage);
  assert.equal(loaded.storageSchemaVersion, 3);
  assert.deepEqual(loaded.rewardLedger, {});
  assert.equal(storage.getItem(storageApi.GEAR_STORAGE_KEY), rawV1);
  assert.equal(storage.setCalls.length, 0, 'load must not rewrite v1 data');
  storageApi.saveGearState(loaded, storage);
  assert.equal(JSON.parse(storage.getItem(storageApi.GEAR_STORAGE_KEY)).storageSchemaVersion, 3);
});
test('getItem errors and unavailable storage fail instead of pretending first run', () => {
  const storage = new FakeStorage();
  storage.throwOnGet = new Error('security');
  expectCode('STORAGE_READ_FAILED', () => storageApi.loadGearState(storage));
  expectCode('STORAGE_UNAVAILABLE', () => storageApi.loadGearState(null));
  expectCode('STORAGE_UNAVAILABLE', () => storageApi.saveGearState(storageApi.createDefaultGearStorageState(), {}));
});
test('save errors including quota keep previous gear value and validation happens before writes', () => {
  const oldRaw = storageApi.encodeGearStorageState(storageApi.createDefaultGearStorageState());
  const storage = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: oldRaw });
  storage.throwOnSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  expectCode('STORAGE_WRITE_FAILED', () => storageApi.saveGearState(validState(), storage));
  assert.equal(storage.getItem(storageApi.GEAR_STORAGE_KEY), oldRaw);
  const invalid = storageApi.createDefaultGearStorageState();
  invalid.inventory = 'bad';
  storage.throwOnSet = null;
  const writesBefore = storage.setCalls.length;
  expectCode('INVALID_INVENTORY', () => storageApi.saveGearState(invalid, storage));
  assert.equal(storage.setCalls.length, writesBefore);
});
test('write read-back mismatch and read-back exception are explicit failures', () => {
  const storage = new FakeStorage();
  storage.readBackOverride = 'different';
  expectCode('STORAGE_READ_BACK_MISMATCH', () => storageApi.saveGearState(storageApi.createDefaultGearStorageState(), storage));
  storage.readBackOverride = undefined;
  storage.getItem = function getItemOnce() { throw new Error('readback'); };
  expectCode('STORAGE_READ_BACK_FAILED', () => storageApi.saveGearState(storageApi.createDefaultGearStorageState(), storage));
});
test('capacity boundaries are strict for inventory, temp box and unclaimed rewards', () => {
  const state = storageApi.createDefaultGearStorageState();
  state.inventory = Array.from({ length: 500 }, (_, index) => ({ gear: makeGear(`inventory-${index}`), locked: false, favorite: false }));
  assert.equal(storageApi.migrateGearStorageState(state).inventory.length, 500);
  state.inventory.push({ gear: makeGear('inventory-501'), locked: false, favorite: false });
  expectCode('INVENTORY_CAPACITY_EXCEEDED', () => storageApi.migrateGearStorageState(state));
  const temp = storageApi.createDefaultGearStorageState();
  temp.tempBox = Array.from({ length: 50 }, (_, index) => ({ gear: makeGear(`temp-${index}`), locked: false, favorite: false, enteredAtMs: index }));
  assert.equal(storageApi.migrateGearStorageState(temp).tempBox.length, 50);
  temp.tempBox.push({ gear: makeGear('temp-51'), locked: false, favorite: false, enteredAtMs: 50 });
  expectCode('TEMP_BOX_CAPACITY_EXCEEDED', () => storageApi.migrateGearStorageState(temp));
  const rewards = storageApi.createDefaultGearStorageState();
  rewards.unclaimedRewards = Array.from({ length: 10 }, (_, index) => ({ rewardId: `reward-${index}`, sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: index, gears: [], powder: 0, blueprintShards: 0 }));
  assert.equal(storageApi.migrateGearStorageState(rewards).unclaimedRewards.length, 10);
  rewards.unclaimedRewards.push({ rewardId: 'reward-11', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 11, gears: [], powder: 0, blueprintShards: 0 });
  expectCode('UNCLAIMED_REWARD_CAPACITY_EXCEEDED', () => storageApi.migrateGearStorageState(rewards));
});
test('reward gear caps are strict: CPU and unknown sources allow five, coop boss allows three, and zero remains valid', () => {
  const makeReward = (sourceId, gearCount) => ({
    rewardId: `cap-${sourceId}-${gearCount}`,
    sourceId,
    sourceDetail: null,
    createdAtMs: 0,
    gears: Array.from({ length: gearCount }, (_, index) => makeGear(`cap-${sourceId}-${gearCount}-${index}`)),
    powder: 0, blueprintShards: 0,
  });
  [['cpu_battle', 5], ['future_source', 5], ['cpu_battle', 0]].forEach(([sourceId, gearCount]) => {
    const state = storageApi.createDefaultGearStorageState();
    state.unclaimedRewards = [makeReward(sourceId, gearCount)];
    assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].gears.length, gearCount);
  });
  const coop = storageApi.createDefaultGearStorageState();
  coop.unclaimedRewards = [makeReward('coop_boss', 3)];
  assert.equal(storageApi.migrateGearStorageState(coop).unclaimedRewards[0].gears.length, 3);
  [['cpu_battle', 6], ['future_source', 6], ['coop_boss', 4]].forEach(([sourceId, gearCount]) => {
    const state = storageApi.createDefaultGearStorageState();
    state.unclaimedRewards = [makeReward(sourceId, gearCount)];
    expectCode('REWARD_GEAR_CAP_EXCEEDED', () => storageApi.migrateGearStorageState(state));
  });
});
test('reward ledger is an exact true-only tombstone map and cannot overlap pending rewards', () => {
  const state = validState();
  state.rewardLedger = { 'already-claimed': true };
  assert.deepEqual(storageApi.migrateGearStorageState(state).rewardLedger, { 'already-claimed': true });
  [false, 0, 'true', null].forEach((value) => {
    const invalid = validState();
    invalid.rewardLedger = { claimed: value };
    expectCode('INVALID_REWARD_LEDGER_VALUE', () => storageApi.migrateGearStorageState(invalid));
  });
  const overlap = validState();
  overlap.rewardLedger = { 'reward-a': true };
  expectCode('REWARD_LEDGER_PENDING_CONFLICT', () => storageApi.migrateGearStorageState(overlap));
  const unknown = validState();
  unknown.rewardLedger = { claimed: true, extra: true };
  // Arbitrary non-empty keys are legitimate reward IDs; values are the only
  // ledger payload permitted, and no nested shape exists to normalize.
  assert.equal(storageApi.migrateGearStorageState(unknown).rewardLedger.extra, true);
  const special = validState();
  special.rewardLedger = JSON.parse('{"__proto__":true,"constructor":true,"prototype":true}');
  const checkedSpecial = storageApi.migrateGearStorageState(special).rewardLedger;
  assert.equal(Object.getPrototypeOf(checkedSpecial), Object.prototype);
  assert.equal(Object.hasOwn(checkedSpecial, '__proto__'), true);
  assert.equal(checkedSpecial.__proto__, true);
  const emptyId = validState();
  emptyId.rewardLedger = { '': true };
  expectCode('INVALID_STRING', () => storageApi.migrateGearStorageState(emptyId));
  const rootUnknown = validState();
  rootUnknown.ledgerSurprise = {};
  expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(rootUnknown));
});
test('gearId and rewardId are globally unique across every storage container', () => {
  const state = validState();
  state.tempBox[0].gear = clone(state.inventory[0].gear);
  expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(state));
  const rewardDuplicate = validState();
  rewardDuplicate.unclaimedRewards.push({ rewardId: 'reward-b', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 1, gears: [clone(rewardDuplicate.inventory[0].gear)], powder: 0, blueprintShards: 0 });
  expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(rewardDuplicate));
  const rewardIds = validState();
  rewardIds.unclaimedRewards.push({ rewardId: 'reward-a', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 1, gears: [], powder: 0, blueprintShards: 0 });
  expectCode('DUPLICATE_REWARD_ID', () => storageApi.migrateGearStorageState(rewardIds));
});
test('Phase 1 domain validation rejects forged gear, initial-sub corruption, future gear versions and added generation seed', () => {
  const forged = validState();
  forged.inventory[0].gear.star = 7;
  expectCode('INVALID_STORED_GEAR', () => storageApi.migrateGearStorageState(forged));
  const initial = validState();
  initial.inventory[0].gear.initialSubOps[0].enhancementCount = 1;
  initial.inventory[0].gear.initialSubOps[0].enhancementValueBp = 500;
  initial.inventory[0].gear.initialSubOps[0].valueBp += 500;
  expectCode('INVALID_STORED_GEAR', () => storageApi.migrateGearStorageState(initial));
  const future = validState();
  future.inventory[0].gear.schemaVersion = 999;
  expectCode('INVALID_STORED_GEAR', () => storageApi.migrateGearStorageState(future));
  const seed = validState();
  seed.inventory[0].gear.generationSeed = 'must-not-be-persisted';
  expectCode('FORBIDDEN_GENERATION_SEED', () => storageApi.migrateGearStorageState(seed));
});
test('resources, metadata, timestamps and source detail are strict JSON/safe-integer values', () => {
  const cases = [
    ['powder', -1], ['powder', 1.5], ['powder', NaN], ['blueprintShards', Infinity],
  ];
  cases.forEach(([key, value]) => { const state = validState(); state.resources[key] = value; expectCode('INVALID_NON_NEGATIVE_SAFE_INTEGER', () => storageApi.migrateGearStorageState(state)); });
  const locked = validState(); locked.inventory[0].locked = 'true'; expectCode('INVALID_BOOLEAN', () => storageApi.migrateGearStorageState(locked));
  const favorite = validState(); favorite.tempBox[0].favorite = 1; expectCode('INVALID_BOOLEAN', () => storageApi.migrateGearStorageState(favorite));
  const entered = validState(); entered.tempBox[0].enteredAtMs = -1; expectCode('INVALID_NON_NEGATIVE_SAFE_INTEGER', () => storageApi.migrateGearStorageState(entered));
  const created = validState(); created.unclaimedRewards[0].createdAtMs = Infinity; expectCode('INVALID_NON_NEGATIVE_SAFE_INTEGER', () => storageApi.migrateGearStorageState(created));
  [-1, 1.5, NaN, Infinity].forEach((value) => { const state = validState(); state.unclaimedRewards[0].powder = value; expectCode('INVALID_NON_NEGATIVE_SAFE_INTEGER', () => storageApi.migrateGearStorageState(state)); });
  const missingRewardPowder = validState(); delete missingRewardPowder.unclaimedRewards[0].powder; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(missingRewardPowder));
  const badDetail = validState(); badDetail.unclaimedRewards[0].sourceDetail = () => {}; expectCode('INVALID_JSON_DATA', () => storageApi.migrateGearStorageState(badDetail));
  const cyclic = validState(); cyclic.unclaimedRewards[0].sourceDetail = {}; cyclic.unclaimedRewards[0].sourceDetail.self = cyclic.unclaimedRewards[0].sourceDetail; expectCode('CYCLIC_JSON_DATA', () => storageApi.migrateGearStorageState(cyclic));
});
test('unknown root/nested fields and main-state reveal data are rejected without silent loss', () => {
  const root = validState(); root.surpriseField = {}; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(root));
  const nested = validState(); nested.inventory[0].extra = true; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(nested));
  const resources = validState(); resources.resources.coins = 0; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(resources));
  const revealInMain = validState(); revealInMain.revealHistory = {}; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(revealInMain));
});
test('parsed JSON special keys survive source detail and reveal-history round trips without prototype mutation', () => {
  const state = validState();
  state.unclaimedRewards[0].sourceDetail = JSON.parse('{"__proto__":{"safe":true},"constructor":"kept","prototype":7}');
  const checked = storageApi.decodeGearStorageState(storageApi.encodeGearStorageState(state));
  const detail = checked.unclaimedRewards[0].sourceDetail;
  assert.equal(Object.getPrototypeOf(detail), Object.prototype);
  assert.equal(Object.hasOwn(detail, '__proto__'), true);
  assert.deepEqual(detail.__proto__, { safe: true });
  assert.equal(detail.constructor, 'kept');
  assert.equal(detail.prototype, 7);
  const revealInput = JSON.parse('{"schemaVersion":1,"viewedThroughLevelByGearId":{"__proto__":3,"constructor":6,"prototype":9}}');
  const reveal = storageApi.decodeRevealHistoryState(storageApi.encodeRevealHistoryState(revealInput));
  const levels = reveal.viewedThroughLevelByGearId;
  assert.equal(Object.getPrototypeOf(levels), Object.prototype);
  assert.deepEqual(Object.keys(levels).sort(), ['__proto__', 'constructor', 'prototype']);
  assert.equal(levels.__proto__, 3);
  assert.equal(levels.constructor, 6);
  assert.equal(levels.prototype, 9);
});
test('strict schema rejects non-enumerable, symbol, and accessor root fields before reads', () => {
  const nonEnumerable = validState();
  Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
  expectCode('INVALID_STORAGE_PROPERTY', () => storageApi.migrateGearStorageState(nonEnumerable));
  const symbol = validState();
  symbol[Symbol('hidden')] = true;
  expectCode('INVALID_STORAGE_PROPERTY', () => storageApi.migrateGearStorageState(symbol));
  const accessor = validState();
  Object.defineProperty(accessor, 'inventory', { enumerable: true, configurable: true, get() { throw new Error('must not execute'); } });
  expectCode('INVALID_STORAGE_PROPERTY', () => storageApi.migrateGearStorageState(accessor));
});
test('all storage container arrays require ordinary dense data arrays', () => {
  const inventoryHole = validState(); inventoryHole.inventory = []; inventoryHole.inventory[1] = { gear: makeGear('inventory-hole'), locked: false, favorite: false };
  expectCode('INVALID_STORAGE_ARRAY', () => storageApi.migrateGearStorageState(inventoryHole));
  const tempExtra = validState(); tempExtra.tempBox.extra = true;
  expectCode('INVALID_STORAGE_ARRAY', () => storageApi.migrateGearStorageState(tempExtra));
  const rewardsSymbol = validState(); rewardsSymbol.unclaimedRewards[Symbol('extra')] = true;
  expectCode('INVALID_STORAGE_ARRAY', () => storageApi.migrateGearStorageState(rewardsSymbol));
  const rewardGearNonEnumerable = validState(); Object.defineProperty(rewardGearNonEnumerable.unclaimedRewards[0].gears, '0', { value: rewardGearNonEnumerable.unclaimedRewards[0].gears[0], enumerable: false, configurable: true, writable: true });
  expectCode('INVALID_STORAGE_ARRAY', () => storageApi.migrateGearStorageState(rewardGearNonEnumerable));
  const alteredPrototype = validState(); Object.setPrototypeOf(alteredPrototype.inventory, null);
  expectCode('INVALID_STORAGE_ARRAY', () => storageApi.migrateGearStorageState(alteredPrototype));
});
test('JSON-like arrays reject accessors, symbols, non-enumerable values, and altered prototypes', () => {
  const accessor = validState(); const accessorArray = []; Object.defineProperty(accessorArray, '0', { enumerable: true, configurable: true, get() { throw new Error('must not execute'); } }); accessorArray.length = 1; accessor.unclaimedRewards[0].sourceDetail = accessorArray;
  expectCode('INVALID_JSON_ARRAY', () => storageApi.migrateGearStorageState(accessor));
  const symbol = validState(); const symbolArray = [1]; symbolArray[Symbol('extra')] = true; symbol.unclaimedRewards[0].sourceDetail = symbolArray;
  expectCode('INVALID_JSON_ARRAY', () => storageApi.migrateGearStorageState(symbol));
  const nonEnumerable = validState(); const hiddenArray = [1]; Object.defineProperty(hiddenArray, '0', { value: 1, enumerable: false, configurable: true, writable: true }); nonEnumerable.unclaimedRewards[0].sourceDetail = hiddenArray;
  expectCode('INVALID_JSON_ARRAY', () => storageApi.migrateGearStorageState(nonEnumerable));
  const prototype = validState(); const nonOrdinary = [1]; Object.setPrototypeOf(nonOrdinary, null); prototype.unclaimedRewards[0].sourceDetail = nonOrdinary;
  expectCode('INVALID_JSON_ARRAY', () => storageApi.migrateGearStorageState(prototype));
});
test('reveal history permits only milestone levels, remains independent, and never touches main state', () => {
  [3, 6, 9, 12].forEach((level) => assert.equal(storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { 'old-gear': level } }).viewedThroughLevelByGearId['old-gear'], level));
  [0, 1, 4, 13].forEach((level) => expectCode('INVALID_REVEAL_LEVEL', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { gear: level } })));
  expectCode('INVALID_STRING', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { '': 3 } }));
  const existing = { katamon_coop_mvp_v1: '{"coins":123}', [storageApi.GEAR_STORAGE_KEY]: storageApi.encodeGearStorageState(validState()) };
  const storage = new FakeStorage(existing);
  storageApi.saveRevealHistory({ schemaVersion: 1, viewedThroughLevelByGearId: { 'dismantled-or-old': 12 } }, storage);
  assert.equal(storageApi.loadRevealHistory(storage).viewedThroughLevelByGearId['dismantled-or-old'], 12);
  assert.equal(storage.getItem(storageApi.GEAR_STORAGE_KEY), existing[storageApi.GEAR_STORAGE_KEY]);
  storageApi.saveGearState(validState(), storage);
  assert.equal(storageApi.loadRevealHistory(storage).viewedThroughLevelByGearId['dismantled-or-old'], 12);
});
test('gear storage only touches its two explicit keys and leaves existing game saves byte-identical', () => {
  const others = {
    katamon_coop_mvp_v1: '{"coins":777}', katamon_suspend_v1: '{"battle":"saved"}', katamon_custom_suspend_v1: '{"custom":true}',
  };
  const storage = new FakeStorage(others);
  storageApi.saveGearState(validState(), storage);
  storageApi.loadGearState(storage);
  storageApi.saveRevealHistory({ schemaVersion: 1, viewedThroughLevelByGearId: { any: 6 } }, storage);
  storageApi.loadRevealHistory(storage);
  assertOtherKeysUnchanged(storage, others);
  assert.ok(storage.setCalls.every(([key]) => key === storageApi.GEAR_STORAGE_KEY || key === storageApi.GEAR_REVEAL_STORAGE_KEY));
});
test('validation, encoding and save do not mutate caller data', () => {
  const state = validState();
  const before = clone(state);
  storageApi.migrateGearStorageState(state);
  storageApi.encodeGearStorageState(state);
  storageApi.saveGearState(state, new FakeStorage());
  assert.deepEqual(state, before);
});
test('module has no time/random calls or localStorage access at evaluation and exposes browser global', () => {
  const source = fs.readFileSync(require.resolve('../shared/gear-storage.js'), 'utf8');
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /performance\.now\s*\(/);
  assert.doesNotMatch(source, /crypto\.getRandomValues\s*\(/);
  const browserGlobal = { KatamonGearDomain: gear };
  vm.runInNewContext(source, { globalThis: browserGlobal });
  assert.equal(typeof browserGlobal.KatamonGearStorage.loadGearState, 'function');
  assert.equal(Object.hasOwn(browserGlobal, 'localStorage'), false);
});
test('maximum fixture with 500 inventory, 50 temp and 10 multi-gear rewards stays below conservative 2MiB UTF-16 estimate', () => {
  const state = storageApi.createDefaultGearStorageState();
  let id = 0;
  const nextGear = (prefix) => makeGear(`${prefix}-${id++}`);
  state.inventory = Array.from({ length: 500 }, () => ({ gear: nextGear('inventory'), locked: false, favorite: false }));
  state.tempBox = Array.from({ length: 50 }, (_, index) => ({ gear: nextGear('temp'), locked: index % 2 === 0, favorite: false, enteredAtMs: index }));
  state.unclaimedRewards = Array.from({ length: 10 }, (_, rewardIndex) => ({
    rewardId: `reward-${rewardIndex}`, sourceId: 'cpu_battle', sourceDetail: { index: rewardIndex }, createdAtMs: rewardIndex,
    gears: Array.from({ length: 5 }, (_, gearIndex) => nextGear(`reward-${rewardIndex}-${gearIndex}`)), powder: rewardIndex, blueprintShards: rewardIndex,
  }));
  state.resources = { powder: 999999, blueprintShards: 888888 };
  const serialized = storageApi.encodeGearStorageState(state);
  const size = storageApi.estimateSerializedSize(serialized);
  assert.equal(id, 600);
  assert.ok(size.chars > 0);
  assert.ok(size.utf16Bytes < 2 * 1024 * 1024, `${size.utf16Bytes} bytes is unexpectedly large`);
  console.log(`  info maximum-fixture gears=${id} chars=${size.chars} utf16Bytes=${size.utf16Bytes}`);
});

// Keep the fail-closed contract legible in CI: each of these is deliberately
// a separate boundary, rather than a single broad "bad input" assertion.
[
  ['storage constants expose the approved keys and capacities', () => {
    assert.equal(storageApi.GEAR_STORAGE_KEY, 'katamon_gear_v1'); assert.equal(storageApi.GEAR_REVEAL_STORAGE_KEY, 'katamon_gear_reveal_v1');
    assert.equal(storageApi.MAIN_INVENTORY_CAPACITY, 500); assert.equal(storageApi.TEMP_BOX_CAPACITY, 50); assert.equal(storageApi.UNCLAIMED_REWARD_CAPACITY, 10);
    assert.equal(storageApi.MAX_GEARS_PER_REWARD, 5); assert.equal(storageApi.COOP_BOSS_MAX_GEARS_PER_REWARD, 3);
  }],
  ['temp box TTL is exactly seven days and is only a constant', () => assert.equal(storageApi.TEMP_BOX_TTL_MS, 7 * 24 * 60 * 60 * 1000)],
  ['inventory accepts a strict true lock boolean', () => { const state = validState(); state.inventory[0].locked = true; assert.equal(storageApi.migrateGearStorageState(state).inventory[0].locked, true); }],
  ['temp box accepts a strict true favorite boolean', () => { const state = validState(); state.tempBox[0].favorite = true; assert.equal(storageApi.migrateGearStorageState(state).tempBox[0].favorite, true); }],
  ['temp box accepts the largest safe entered timestamp', () => { const state = validState(); state.tempBox[0].enteredAtMs = Number.MAX_SAFE_INTEGER; assert.equal(storageApi.migrateGearStorageState(state).tempBox[0].enteredAtMs, Number.MAX_SAFE_INTEGER); }],
  ['reward accepts the largest safe created timestamp', () => { const state = validState(); state.unclaimedRewards[0].createdAtMs = Number.MAX_SAFE_INTEGER; assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].createdAtMs, Number.MAX_SAFE_INTEGER); }],
  ['reward accepts the largest safe powder count', () => { const state = validState(); state.unclaimedRewards[0].powder = Number.MAX_SAFE_INTEGER; assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].powder, Number.MAX_SAFE_INTEGER); }],
  ['reward accepts the largest safe blueprint shards count', () => { const state = validState(); state.unclaimedRewards[0].blueprintShards = Number.MAX_SAFE_INTEGER; assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].blueprintShards, Number.MAX_SAFE_INTEGER); }],
  ['reward accepts null source detail', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = null; assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].sourceDetail, null); }],
  ['reward accepts scalar JSON source detail', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = 'normal'; assert.equal(storageApi.migrateGearStorageState(state).unclaimedRewards[0].sourceDetail, 'normal'); }],
  ['reward accepts array JSON source detail', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = [true, 7, { mode: 'hard' }]; assert.deepEqual(storageApi.migrateGearStorageState(state).unclaimedRewards[0].sourceDetail, [true, 7, { mode: 'hard' }]); }],
  ['reward rejects an empty reward id', () => { const state = validState(); state.unclaimedRewards[0].rewardId = ''; expectCode('INVALID_STRING', () => storageApi.migrateGearStorageState(state)); }],
  ['reward rejects an empty source id', () => { const state = validState(); state.unclaimedRewards[0].sourceId = ''; expectCode('INVALID_STRING', () => storageApi.migrateGearStorageState(state)); }],
  ['reward rejects an unknown nested field', () => { const state = validState(); state.unclaimedRewards[0].future = true; expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateGearStorageState(state)); }],
  ['inventory duplicate is rejected within inventory', () => { const state = validState(); state.inventory.push({ gear: clone(state.inventory[0].gear), locked: false, favorite: false }); expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(state)); }],
  ['temp box duplicate is rejected within temp box', () => { const state = validState(); state.tempBox.push({ gear: clone(state.tempBox[0].gear), locked: false, favorite: false, enteredAtMs: 0 }); expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(state)); }],
  ['reward duplicate is rejected inside one reward', () => { const state = validState(); state.unclaimedRewards[0].gears.push(clone(state.unclaimedRewards[0].gears[0])); expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(state)); }],
  ['reward duplicate is rejected across rewards', () => { const state = validState(); state.unclaimedRewards.push({ rewardId: 'reward-b', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 0, gears: [clone(state.unclaimedRewards[0].gears[0])], powder: 0, blueprintShards: 0 }); expectCode('DUPLICATE_GEAR_ID', () => storageApi.migrateGearStorageState(state)); }],
  ['reveal history accepts level 3', () => assert.equal(storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 3 } }).viewedThroughLevelByGearId.g, 3)],
  ['reveal history accepts level 6', () => assert.equal(storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 6 } }).viewedThroughLevelByGearId.g, 6)],
  ['reveal history accepts level 9', () => assert.equal(storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 9 } }).viewedThroughLevelByGearId.g, 9)],
  ['reveal history accepts level 12', () => assert.equal(storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 12 } }).viewedThroughLevelByGearId.g, 12)],
  ['reveal history rejects level zero', () => expectCode('INVALID_REVEAL_LEVEL', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 0 } }))],
  ['reveal history rejects level four', () => expectCode('INVALID_REVEAL_LEVEL', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 4 } }))],
  ['reveal history rejects level thirteen', () => expectCode('INVALID_REVEAL_LEVEL', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { g: 13 } }))],
  ['reveal history rejects unknown root fields', () => expectCode('UNKNOWN_STORAGE_FIELD', () => storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: {}, surprise: true }))],
  ['malformed empty raw value fails parsing', () => expectCode('STORAGE_JSON_PARSE_FAILED', () => storageApi.decodeGearStorageState(''))],
  ['JSON null raw value fails state validation', () => expectCode('INVALID_STORAGE_STATE', () => storageApi.decodeGearStorageState('null'))],
  ['JSON array raw value fails state validation', () => expectCode('INVALID_STORAGE_STATE', () => storageApi.decodeGearStorageState('[]'))],
  ['JSON object without version fails migration', () => expectCode('MISSING_STORAGE_SCHEMA_VERSION', () => storageApi.decodeGearStorageState('{}'))],
  ['first-run load never writes a storage key', () => { const storage = new FakeStorage(); storageApi.loadGearState(storage); assert.equal(storage.setCalls.length, 0); }],
  ['main save never writes reveal key', () => { const storage = new FakeStorage(); storageApi.saveGearState(storageApi.createDefaultGearStorageState(), storage); assert.deepEqual(storage.setCalls.map(([key]) => key), [storageApi.GEAR_STORAGE_KEY]); }],
  ['reveal save never writes main key', () => { const storage = new FakeStorage(); storageApi.saveRevealHistory(storageApi.createDefaultRevealHistoryState(), storage); assert.deepEqual(storage.setCalls.map(([key]) => key), [storageApi.GEAR_REVEAL_STORAGE_KEY]); }],
  ['save result is a detached state object', () => { const state = validState(); const saved = storageApi.saveGearState(state, new FakeStorage()); assert.notEqual(saved, state); assert.notEqual(saved.inventory, state.inventory); }],
  ['stored encoding does not contain generation seed', () => { const raw = storageApi.encodeGearStorageState(validState()); assert.doesNotMatch(raw, /generation-/); }],
  ['unknown gear fields are rejected rather than silently dropped by storage', () => { const state = validState(); state.inventory[0].gear.surprise = true; expectCode('NON_CANONICAL_STORED_GEAR', () => storageApi.migrateGearStorageState(state)); }],
  ['generic direct-save function source detail rejects symbols', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = Symbol('no'); expectCode('INVALID_JSON_DATA', () => storageApi.migrateGearStorageState(state)); }],
  ['generic direct-save source detail rejects dates', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = new Date(0); expectCode('INVALID_JSON_DATA', () => storageApi.migrateGearStorageState(state)); }],
  ['generic direct-save source detail rejects nested infinity', () => { const state = validState(); state.unclaimedRewards[0].sourceDetail = { value: Infinity }; expectCode('INVALID_JSON_DATA', () => storageApi.migrateGearStorageState(state)); }],
  ['arrays with holes reject instead of JSON coercion', () => { const state = validState(); const detail = []; detail[1] = 'hole'; state.unclaimedRewards[0].sourceDetail = detail; expectCode('INVALID_JSON_ARRAY', () => storageApi.migrateGearStorageState(state)); }],
  ['object with inherited prototype rejects instead of being normalized', () => { const state = validState(); state.resources = Object.create({ powder: 0, blueprintShards: 0 }); expectCode('INVALID_RECORD', () => storageApi.migrateGearStorageState(state)); }],
  ['storage source contains no removeItem repair operation', () => { const source = fs.readFileSync(require.resolve('../shared/gear-storage.js'), 'utf8'); assert.doesNotMatch(source, /\.removeItem\s*\(/); }],
  ['storage source contains no clear repair operation', () => { const source = fs.readFileSync(require.resolve('../shared/gear-storage.js'), 'utf8'); assert.doesNotMatch(source, /\.clear\s*\(/); }],
  ['estimate reports UTF-16 bytes exactly as twice the JSON character count', () => assert.deepEqual(storageApi.estimateSerializedSize('abc'), { chars: 3, utf16Bytes: 6 })],
  ['reveal state may retain a gear id not held by main state', () => { const history = storageApi.migrateRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { dismantled: 9 } }); assert.equal(history.viewedThroughLevelByGearId.dismantled, 9); }],
  ['storage version is distinct from gear schema version', () => { const state = storageApi.createDefaultGearStorageState(); assert.equal(state.storageSchemaVersion, 3); assert.equal(Object.hasOwn(state, 'schemaVersion'), false); }],
  ['reveal version is distinct from main storage schema version field', () => { const state = storageApi.createDefaultRevealHistoryState(); assert.equal(state.schemaVersion, 1); assert.equal(Object.hasOwn(state, 'storageSchemaVersion'), false); }],
  ['a valid zero-gear reward is preserved for CPU material rewards', () => { const state = storageApi.createDefaultGearStorageState(); state.unclaimedRewards.push({ rewardId: 'materials-only', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 0, gears: [], powder: 10, blueprintShards: 5 }); assert.deepEqual(storageApi.migrateGearStorageState(state).unclaimedRewards[0].gears, []); }],
  ['storage validation does not synthesize an expiresAt field', () => { const state = validState(); const checked = storageApi.migrateGearStorageState(state); assert.equal(Object.hasOwn(checked.tempBox[0], 'expiresAtMs'), false); }],
  ['storage validation does not duplicate existing game coin state', () => { const state = validState(); assert.equal(Object.hasOwn(storageApi.migrateGearStorageState(state).resources, 'coins'), false); }],
  ['reveal history encoding is stable across key insertion order', () => {
    const left = { schemaVersion: 1, viewedThroughLevelByGearId: { a: 3, b: 12 } };
    const right = { schemaVersion: 1, viewedThroughLevelByGearId: { b: 12, a: 3 } };
    assert.equal(storageApi.encodeRevealHistoryState(left), storageApi.encodeRevealHistoryState(right));
  }],
  ['main storage write preserves the independently stored reveal raw value', () => {
    const revealRaw = storageApi.encodeRevealHistoryState({ schemaVersion: 1, viewedThroughLevelByGearId: { retained: 6 } });
    const storage = new FakeStorage({ [storageApi.GEAR_REVEAL_STORAGE_KEY]: revealRaw });
    storageApi.saveGearState(validState(), storage);
    assert.equal(storage.getItem(storageApi.GEAR_REVEAL_STORAGE_KEY), revealRaw);
  }],
].forEach(([name, fn]) => test(name, fn));

console.log(`gear-storage: ${passed}/${passed} passed`);
