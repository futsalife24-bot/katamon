const assert = require('node:assert/strict');
const fs = require('node:fs');
const gear = require('../shared/gear-domain.js');
const storageApi = require('../shared/gear-storage.js');
const rewards = require('../shared/gear-rewards.js');

let passed = 0;
const pendingTests = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingTests.push(Promise.resolve(result).then(() => { passed += 1; console.log(`  ok   ${name}`); }, (error) => { console.error(`  NG   ${name}`); throw error; }));
    } else { passed += 1; console.log(`  ok   ${name}`); }
  } catch (error) { console.error(`  NG   ${name}`); throw error; }
}
function expectCode(code, fn) { assert.throws(fn, (error) => error && error.code === code, `expected ${code}`); }
async function expectCodeAsync(code, fn) {
  await assert.rejects(fn, (error) => error && error.code === code, `expected ${code}`);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
class FakeStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
}
class ExclusiveLockManager {
  constructor() { this.tail = Promise.resolve(); this.requests = []; }
  request(name, options, callback) {
    this.requests.push({ name, options });
    const prior = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    return prior.then(async () => {
      try { return await callback({ name }); } finally { release(); }
    });
  }
}
function profile(star = 4, rarityId = 'rare') {
  return { id: `rewards-${star}-${rarityId}`, starWeights: [{ id: star, weight: 1 }], rarityWeights: [{ id: rarityId, weight: 1 }] };
}
const setProfile = { id: 'rewards-set', setWeights: [{ id: 'assault', weight: 1 }] };
function makeGear(gearId, options = {}) {
  return gear.createGear({
    gearId, generationSeed: `gen-${gearId}`, enhancementSeed: `enh-${gearId}`,
    sourceId: options.sourceId || 'cpu_battle', sourceDetail: { test: true }, acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile: profile(options.star, options.rarityId), setProfile, slotId: options.slotId || 'engine',
  });
}
function state() { return storageApi.createDefaultGearStorageState(); }
function reward(rewardId, options = {}) {
  const count = options.count === undefined ? 1 : options.count;
  return {
    rewardId, sourceId: options.sourceId || 'cpu_battle', sourceDetail: options.sourceDetail === undefined ? { case: rewardId } : options.sourceDetail,
    createdAtMs: options.createdAtMs === undefined ? 100 : options.createdAtMs,
    gears: Array.from({ length: count }, (_unused, index) => makeGear(`${rewardId}-gear-${index}`, options)),
    blueprintShards: options.blueprintShards || 0,
  };
}
function fullEntries(prefix, count, temporary = false) {
  return Array.from({ length: count }, (_unused, index) => {
    const value = { gear: makeGear(`${prefix}-${index}`), locked: false, favorite: false };
    if (temporary) value.enteredAtMs = index;
    return value;
  });
}

test('new reward queues immutably and duplicate pending compares canonical whole reward', () => {
  const initial = state(); const value = reward('queue-a', { sourceDetail: { z: [1], a: true } }); const before = clone(initial);
  const first = rewards.queueUnclaimedReward(initial, value);
  assert.equal(first.queued, true); assert.equal(first.nextState.unclaimedRewards.length, 1); assert.deepEqual(initial, before);
  const retry = rewards.queueUnclaimedReward(first.nextState, { ...clone(value), sourceDetail: { a: true, z: [1] } });
  assert.equal(retry.duplicatePending, true); assert.deepEqual(retry.nextState, first.nextState);
  const conflict = clone(value); conflict.blueprintShards = 1;
  expectCode('REWARD_ID_CONFLICT', () => rewards.queueUnclaimedReward(first.nextState, conflict));
});
test('processed ledger duplicate is a no-op and pending capacity/gear collision fail closed', () => {
  const initial = state(); initial.rewardLedger['done-a'] = true;
  assert.equal(rewards.queueUnclaimedReward(initial, reward('done-a')).duplicateProcessed, true);
  const full = state(); full.unclaimedRewards = Array.from({ length: 10 }, (_unused, index) => reward(`full-${index}`, { count: 0 }));
  expectCode('UNCLAIMED_REWARD_CAPACITY_EXCEEDED', () => rewards.queueUnclaimedReward(full, reward('overflow', { count: 0 })));
  const collision = state(); collision.inventory.push({ gear: makeGear('collision-gear'), locked: false, favorite: false });
  const conflicting = reward('collision'); conflicting.gears[0] = clone(collision.inventory[0].gear);
  expectCode('DUPLICATE_GEAR_ID', () => rewards.queueUnclaimedReward(collision, conflicting));
});
test('claim routes reward gears inventory first then TEMP in original reward order', () => {
  const initial = state(); initial.inventory = fullEntries('inv', 499); initial.unclaimedRewards = [reward('claim-route', { count: 3, blueprintShards: 7 })];
  const result = rewards.claimUnclaimedReward(initial, 'claim-route', 777);
  assert.equal(result.claimed, true); assert.deepEqual(result.placedInventoryGearIds, ['claim-route-gear-0']);
  assert.deepEqual(result.placedTempGearIds, ['claim-route-gear-1', 'claim-route-gear-2']);
  assert.equal(result.nextState.tempBox[0].enteredAtMs, 777); assert.equal(result.nextState.tempBox[0].locked, false); assert.equal(result.nextState.resources.blueprintShards, 7);
  assert.equal(result.nextState.unclaimedRewards.length, 0); assert.equal(result.nextState.rewardLedger['claim-route'], true);
});
test('claim is duplicate-safe, differentiates unknown id, and supports shard-only reward', () => {
  const initial = state(); initial.unclaimedRewards = [reward('shards', { count: 0, blueprintShards: 12 })];
  const first = rewards.claimUnclaimedReward(initial, 'shards', 2);
  assert.equal(first.nextState.resources.blueprintShards, 12);
  assert.equal(rewards.claimUnclaimedReward(first.nextState, 'shards', 3).duplicate, true);
  expectCode('REWARD_NOT_FOUND', () => rewards.claimUnclaimedReward(first.nextState, 'unknown', 3));
});
test('claim capacity rejection returns before any observable input mutation', () => {
  const initial = state(); initial.inventory = fullEntries('inv-full', 500); initial.tempBox = fullEntries('temp-full', 50, true); initial.unclaimedRewards = [reward('no-space')]; const before = clone(initial);
  expectCode('CLAIM_CAPACITY_EXCEEDED', () => rewards.claimUnclaimedReward(initial, 'no-space', 1000));
  assert.deepEqual(initial, before);
});
test('claim can use capacity opened by maintenance before deciding all-or-nothing placement', () => {
  const initial = state(); initial.inventory = fullEntries('opened-inv', 500); initial.tempBox = fullEntries('opened-temp', 49, true); initial.tempBox.forEach((entry) => { entry.enteredAtMs = 1000; });
  initial.tempBox.push({ gear: makeGear('opened-expired'), locked: false, favorite: false, enteredAtMs: 0 });
  initial.unclaimedRewards = [reward('opened-claim')];
  const result = rewards.claimUnclaimedReward(initial, 'opened-claim', storageApi.TEMP_BOX_TTL_MS);
  assert.equal(result.claimed, true); assert.deepEqual(result.expiredGearIds, ['opened-expired']);
  assert.deepEqual(result.placedTempGearIds, ['opened-claim-gear-0']);
});
test('claim rejects invalid times and resource addition overflows without changing caller state', () => {
  const initial = state(); initial.unclaimedRewards = [reward('overflow-shards', { count: 0, blueprintShards: 1 })]; initial.resources.blueprintShards = Number.MAX_SAFE_INTEGER;
  const before = clone(initial); expectCode('INTEGER_OVERFLOW', () => rewards.claimUnclaimedReward(initial, 'overflow-shards', 1)); assert.deepEqual(initial, before);
  expectCode('INVALID_NOW_MS', () => rewards.claimUnclaimedReward(state(), 'missing', -1));
});
test('maintenance expires at exactly seven days, ignores clock rollback, yields no coin, and is idempotent', () => {
  const initial = state(); const item = gear.enhanceGear(makeGear('expire'), 3);
  initial.tempBox = [{ gear: item, locked: true, favorite: true, enteredAtMs: 100 }];
  const justBefore = rewards.runStorageMaintenance(initial, 100 + storageApi.TEMP_BOX_TTL_MS - 1);
  assert.equal(justBefore.expiredGearIds.length, 0); assert.equal(rewards.runStorageMaintenance(initial, 99).expiredGearIds.length, 0);
  const expired = rewards.runStorageMaintenance(initial, 100 + storageApi.TEMP_BOX_TTL_MS);
  const yieldValue = gear.calculateDismantleYield(item);
  assert.deepEqual(expired.expiredGearIds, ['expire']); assert.equal(expired.powderGained, yieldValue.powder); assert.equal(expired.blueprintShardsGained, yieldValue.blueprintShards);
  assert.equal(expired.nextState.tempBox.length, 0); assert.equal(rewards.runStorageMaintenance(expired.nextState, 100 + storageApi.TEMP_BOX_TTL_MS).powderGained, 0);
});
test('maintenance promotes old TEMP first, tie-breaks original order, and preserves metadata', () => {
  const initial = state(); initial.inventory = fullEntries('inv-near', 498);
  initial.tempBox = [
    { gear: makeGear('newer'), locked: false, favorite: true, enteredAtMs: 90 },
    { gear: makeGear('tie-a'), locked: true, favorite: false, enteredAtMs: 10 },
    { gear: makeGear('tie-b'), locked: false, favorite: true, enteredAtMs: 10 },
  ];
  const result = rewards.runStorageMaintenance(initial, 100);
  assert.deepEqual(result.movedGearIds, ['tie-a', 'tie-b']);
  assert.equal(result.nextState.inventory[498].locked, true); assert.equal(result.nextState.inventory[499].favorite, true);
  assert.deepEqual(result.nextState.tempBox.map((entry) => entry.gear.gearId), ['newer']);
});
test('maintenance performs expiry before promotion', () => {
  const initial = state(); initial.inventory = fullEntries('inv-priority', 499);
  initial.tempBox = [
    { gear: makeGear('old-expired'), locked: false, favorite: false, enteredAtMs: 0 },
    { gear: makeGear('survivor'), locked: false, favorite: false, enteredAtMs: 100 },
  ];
  const result = rewards.runStorageMaintenance(initial, storageApi.TEMP_BOX_TTL_MS);
  assert.deepEqual(result.expiredGearIds, ['old-expired']); assert.deepEqual(result.movedGearIds, ['survivor']);
});
test('maintenance resource overflow fails before returning a partial state', () => {
  const initial = state(); initial.resources.powder = Number.MAX_SAFE_INTEGER;
  initial.tempBox = [{ gear: makeGear('overflow-expire'), locked: false, favorite: false, enteredAtMs: 0 }];
  expectCode('INTEGER_OVERFLOW', () => rewards.runStorageMaintenance(initial, storageApi.TEMP_BOX_TTL_MS));
});
test('claim runs maintenance before placement and keeps maintenance atomic with claim', () => {
  const initial = state(); initial.inventory = fullEntries('inv-claim-maint', 499);
  initial.tempBox = [{ gear: makeGear('old-temp'), locked: false, favorite: false, enteredAtMs: 0 }];
  initial.unclaimedRewards = [reward('after-maint', { count: 2 })];
  const result = rewards.claimUnclaimedReward(initial, 'after-maint', storageApi.TEMP_BOX_TTL_MS);
  assert.deepEqual(result.expiredGearIds, ['old-temp']); assert.deepEqual(result.placedInventoryGearIds, ['after-maint-gear-0']); assert.deepEqual(result.placedTempGearIds, ['after-maint-gear-1']);
});
test('reward gate has machine-readable independent reasons', () => {
  assert.deepEqual(rewards.getGearRewardGate(state()), { allowed: true, reasons: [] });
  const pending = state(); pending.unclaimedRewards = Array.from({ length: 10 }, (_unused, index) => reward(`p-${index}`, { count: 0 }));
  assert.deepEqual(rewards.getGearRewardGate(pending), { allowed: false, reasons: ['unclaimed_full'] });
  const physical = state(); physical.inventory = fullEntries('gate-inv', 500); physical.tempBox = fullEntries('gate-temp', 50, true);
  assert.deepEqual(rewards.getGearRewardGate(physical), { allowed: false, reasons: ['physical_storage_full'] });
  physical.unclaimedRewards = pending.unclaimedRewards;
  assert.deepEqual(rewards.getGearRewardGate(physical), { allowed: false, reasons: ['unclaimed_full', 'physical_storage_full'] });
  physical.tempBox.pop(); assert.deepEqual(rewards.getGearRewardGate(physical), { allowed: false, reasons: ['unclaimed_full'] });
});
test('processed duplicate does not need a valid stale retry body beyond a safe reward id', () => {
  const initial = state(); initial.rewardLedger['already-done'] = true;
  const result = rewards.queueUnclaimedReward(initial, { rewardId: 'already-done' });
  assert.equal(result.duplicateProcessed, true); assert.deepEqual(result.nextState, initial);
});
test('canonical queue comparison includes source, detail, time, gears, and shards', () => {
  const initial = rewards.queueUnclaimedReward(state(), reward('canonical-fields')).nextState;
  ['sourceId', 'createdAtMs', 'blueprintShards'].forEach((field) => {
    const changed = clone(initial.unclaimedRewards[0]); changed[field] = field === 'sourceId' ? 'coop_boss' : changed[field] + 1;
    expectCode('REWARD_ID_CONFLICT', () => rewards.queueUnclaimedReward(initial, changed));
  });
  const changedGear = clone(initial.unclaimedRewards[0]); changedGear.gears = []; expectCode('REWARD_ID_CONFLICT', () => rewards.queueUnclaimedReward(initial, changedGear));
  const changedDetail = clone(initial.unclaimedRewards[0]); changedDetail.sourceDetail = { changed: true }; expectCode('REWARD_ID_CONFLICT', () => rewards.queueUnclaimedReward(initial, changedDetail));
});
test('persistence wrappers use one injected exclusive lock and save successful state', async () => {
  const fake = new FakeStorage(); const locks = new ExclusiveLockManager(); const options = { lockManager: locks };
  assert.equal(rewards.GEAR_MUTATION_LOCK_NAME, 'katamon_gear_v1:mutation');
  const queued = await rewards.persistQueueReward(reward('persist', { count: 0, blueprintShards: 2 }), fake, options);
  assert.equal(queued.queued, true); assert.ok(fake.getItem(storageApi.GEAR_STORAGE_KEY));
  const claimed = await rewards.persistClaimReward('persist', 50, fake, options); assert.equal(claimed.claimed, true);
  assert.equal(storageApi.loadGearState(fake).resources.blueprintShards, 2);
  assert.equal((await rewards.persistStorageMaintenance(51, fake, options)).expiredGearIds.length, 0);
  assert.deepEqual(locks.requests.map((entry) => entry.name), [rewards.GEAR_MUTATION_LOCK_NAME, rewards.GEAR_MUTATION_LOCK_NAME, rewards.GEAR_MUTATION_LOCK_NAME]);
  assert.ok(locks.requests.every((entry) => entry.options.mode === 'exclusive'));
});
test('persistence checks the raw pending WAL after lock acquisition and performs no mutation', async () => {
  const fake = new FakeStorage();
  let operationLockEntered = false;
  const injectingLockManager = {
    request(name, options, callback) {
      assert.equal(name, rewards.GEAR_MUTATION_LOCK_NAME);
      assert.equal(options.mode, 'exclusive');
      operationLockEntered = true;
      fake.setItem(rewards.GEAR_TRANSACTION_STORAGE_KEY, '{malformed-wal');
      return callback({ name });
    },
  };
  await expectCodeAsync('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistQueueReward(
    reward('blocked-after-lock', { count: 0 }), fake, { lockManager: injectingLockManager },
  ));
  assert.equal(operationLockEntered, true);
  assert.equal(fake.getItem(storageApi.GEAR_STORAGE_KEY), null, 'pending中はGear Storageを書かない');
  assert.equal(fake.getItem(rewards.GEAR_TRANSACTION_STORAGE_KEY), '{malformed-wal', 'guardはWALをparse・repair・deleteしない');
  fake.values.delete(rewards.GEAR_TRANSACTION_STORAGE_KEY);
  const resumed = await rewards.persistQueueReward(
    reward('resumed-after-recovery', { count: 0 }), fake, { lockManager: new ExclusiveLockManager() },
  );
  assert.equal(resumed.queued, true, 'WAL解消後は通常writerを再開できる');
});
test('persistence refuses to run load-save without an explicit Node lock manager', async () => {
  const fake = new FakeStorage();
  await expectCodeAsync('STORAGE_LOCK_UNAVAILABLE', () => rewards.persistQueueReward(reward('no-lock', { count: 0 }), fake));
  assert.equal(fake.getItem(storageApi.GEAR_STORAGE_KEY), null);
});
test('persistence preserves storage errors and accepts the shared storage lock manager', async () => {
  const fake = new FakeStorage();
  fake.gearMutationLockManager = new ExclusiveLockManager();
  const originalGetItem = fake.getItem.bind(fake);
  fake.getItem = () => { throw new Error('read failed'); };
  await expectCodeAsync('STORAGE_READ_FAILED', () => rewards.persistQueueReward(reward('storage-read-error', { count: 0 }), fake));
  fake.getItem = originalGetItem;
  await rewards.persistQueueReward(reward('storage-manager', { count: 0 }), fake);
  assert.equal(storageApi.loadGearState(fake).unclaimedRewards[0].rewardId, 'storage-manager');
});
test('explicit lock refusal is surfaced and performs no write', async () => {
  const fake = new FakeStorage();
  const refusing = { request: async (_name, _options, callback) => callback(null) };
  await expectCodeAsync('STORAGE_LOCK_NOT_ACQUIRED', () => rewards.persistQueueReward(reward('refused', { count: 0 }), fake, { lockManager: refusing }));
  const skipped = { request: async () => undefined };
  const beforeSkipped = fake.getItem(storageApi.GEAR_STORAGE_KEY);
  await expectCodeAsync('STORAGE_LOCK_NOT_ACQUIRED', () => rewards.persistQueueReward(reward('skipped', { count: 0 }), fake, { lockManager: skipped }));
  assert.equal(fake.getItem(storageApi.GEAR_STORAGE_KEY), beforeSkipped);
  assert.equal(fake.getItem(storageApi.GEAR_STORAGE_KEY), null);
});
test('two concurrent queue actors retain both rewards through the same storage lock', async () => {
  const fake = new FakeStorage(); const options = { lockManager: new ExclusiveLockManager() };
  const [left, right] = await Promise.all([
    rewards.persistQueueReward(reward('actor-left', { count: 0 }), fake, options),
    rewards.persistQueueReward(reward('actor-right', { count: 0 }), fake, options),
  ]);
  assert.equal(left.queued, true); assert.equal(right.queued, true);
  assert.deepEqual(storageApi.loadGearState(fake).unclaimedRewards.map((entry) => entry.rewardId), ['actor-left', 'actor-right']);
});
test('concurrent claim and maintenance serialize without rolling back either result', async () => {
  const initial = state(); initial.tempBox = [{ gear: makeGear('locked-expire'), locked: false, favorite: false, enteredAtMs: 0 }]; initial.unclaimedRewards = [reward('locked-claim', { count: 0, blueprintShards: 5 })];
  const fake = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: storageApi.encodeGearStorageState(initial) });
  const options = { lockManager: new ExclusiveLockManager() };
  await Promise.all([
    rewards.persistClaimReward('locked-claim', storageApi.TEMP_BOX_TTL_MS, fake, options),
    rewards.persistStorageMaintenance(storageApi.TEMP_BOX_TTL_MS, fake, options),
  ]);
  const finalState = storageApi.loadGearState(fake);
  assert.equal(finalState.rewardLedger['locked-claim'], true); assert.equal(finalState.unclaimedRewards.length, 0); assert.equal(finalState.tempBox.length, 0);
  assert.equal(finalState.resources.blueprintShards, 5 + gear.calculateDismantleYield(initial.tempBox[0].gear).blueprintShards);
});
test('reward module is pure: no Date.now, random, or DOM coupling while Phase 2C connects its browser script', () => {
  const source = fs.readFileSync(require.resolve('../shared/gear-rewards.js'), 'utf8');
  assert.equal(source.includes('Date.now'), false); assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('document.'), false); assert.equal(fs.readFileSync(require.resolve('../index.html'), 'utf8').includes('shared/gear-rewards.js'), true);
});

Promise.all(pendingTests).then(() => {
  console.log(`gear-rewards: ${passed}/${passed} passed`);
}).catch((error) => {
  process.exitCode = 1;
  console.error(error);
});
