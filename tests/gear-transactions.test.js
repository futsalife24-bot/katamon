const assert = require('node:assert/strict');
const fs = require('node:fs');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const rewards = require('../shared/gear-rewards.js');
const foundation = require('../coop-mvp-foundation.js');
const transactions = require('../shared/gear-transactions.js');

let passed = 0;
const queuedTests = [];
function test(name, fn) { queuedTests.push({ name, fn }); }
async function expectCode(code, fn) {
  try { await fn(); } catch (error) { assert.equal(error && error.code, code, `expected ${code}`); return; }
  assert.fail(`expected ${code}`);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createTestLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      return previous.then(async () => {
        try { return await callback({ name: transactions.GEAR_MUTATION_LOCK_NAME, mode: 'exclusive' }); } finally { release(); }
      });
    },
  };
}
const TEST_LOCK_MANAGER = createTestLockManager();

class FakeStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); this.gearMutationLockManager = TEST_LOCK_MANAGER; this.throwGet = null; this.throwSet = null; this.throwRemove = null; this.readBack = new Map(); this.readBackAfterSet = new Map(); this.readSequence = new Map(); }
  getItem(key) { if (this.throwGet) throw this.throwGet; const sequence = this.readSequence.get(key); if (sequence && sequence.length) return sequence.shift(); return this.readBack.has(key) ? this.readBack.get(key) : (this.values.has(key) ? this.values.get(key) : null); }
  setItem(key, value) { if (this.throwSet) throw this.throwSet; this.values.set(key, value); if (this.readBackAfterSet.has(key)) this.readBack.set(key, this.readBackAfterSet.get(key)); }
  removeItem(key) { if (this.throwRemove) throw this.throwRemove; this.values.delete(key); }
}
function makeGear(id = 'transaction-gear') {
  return gear.createGear({
    gearId: id, generationSeed: `create-${id}`, enhancementSeed: `enhance-${id}`, sourceId: 'test', sourceDetail: { source: 'test' }, acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'mythic', weight: 1 }] },
    setProfile: { id: 's', setWeights: [{ id: 'assault', weight: 1 }] }, slotId: 'engine',
  });
}
function stateWithGear(id = 'transaction-gear', powder = 999) {
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory.push({ gear: makeGear(id), locked: false, favorite: false });
  state.resources.powder = powder;
  return state;
}
function foundationRaw(coins = 999, extra = {}) { return JSON.stringify({ ...foundation.createDefaultState(), ...extra, wallet: { coins, futureWalletFlag: true } }); }
function seededStorage(options = {}) {
  const state = stateWithGear(options.id, options.powder);
  const initial = { [gearStorage.GEAR_STORAGE_KEY]: gearStorage.encodeGearStorageState(state) };
  if (!options.absentFoundation) initial[foundation.STORAGE_KEY] = foundationRaw(options.coins === undefined ? 999 : options.coins, { futureRoot: { preserved: true }, achievements: { progress: { a: 2 }, completed: {}, claimed: {} } });
  return new FakeStorage(initial);
}
function journalFor(storage, target = 3) {
  const beforeGear = gearStorage.loadGearState(storage).inventory[0].gear;
  const beforeFoundation = transactions.loadStrictFoundationState(storage);
  const cost = gear.calculateEnhancementCost(beforeGear.enhancementLevel, target);
  const afterFoundation = clone(beforeFoundation.state); afterFoundation.wallet.coins -= cost.coins;
  return {
    schemaVersion: 1, transactionId: 'journal-1', kind: 'enhance_gear', createdAtMs: 100,
    gearId: beforeGear.gearId, fromLevel: beforeGear.enhancementLevel, targetLevel: target,
    powderBefore: gearStorage.loadGearState(storage).resources.powder, powderAfter: gearStorage.loadGearState(storage).resources.powder - cost.powder,
    coinBefore: beforeFoundation.state.wallet.coins, coinAfter: beforeFoundation.state.wallet.coins - cost.coins,
    gearBefore: beforeGear, gearAfter: gear.enhanceGear(beforeGear, target),
    foundationRawBefore: beforeFoundation.raw, foundationRawAfter: JSON.stringify(afterFoundation),
  };
}
function assertJournalCommittedOnce(storage, journal) {
  const state = gearStorage.loadGearState(storage);
  assert.equal(state.inventory[0].gear.enhancementLevel, journal.targetLevel);
  assert.equal(state.resources.powder, journal.powderAfter);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, journal.coinAfter);
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
}
async function mutateFoundationCoins(storage, amount = 1) {
  return foundation.mutateStateLocked((state) => {
    state.wallet.coins += amount;
    return { state, amount };
  }, { storage, lockManager: storage.gearMutationLockManager });
}
function addExpiredTempGear(storage, gearId) {
  const state = gearStorage.loadGearState(storage);
  const temporaryGear = makeGear(gearId);
  state.tempBox.push({ gear: temporaryGear, locked: false, favorite: false, enteredAtMs: 0 });
  gearStorage.saveGearState(state, storage);
  return temporaryGear;
}
function unclaimedGearStorage() {
  const state = gearStorage.createDefaultGearStorageState();
  state.resources.powder = 999;
  state.unclaimedRewards.push({ rewardId: 'pending-reward', sourceId: 'cpu_battle', sourceDetail: { run: 1 }, createdAtMs: 1, gears: [makeGear('unclaimed-gear')], blueprintShards: 0 });
  return new FakeStorage({ [gearStorage.GEAR_STORAGE_KEY]: gearStorage.encodeGearStorageState(state), [foundation.STORAGE_KEY]: foundationRaw(999) });
}

test('strict bridge defaults only when foundation key is absent and preserves unknown fields', async () => {
  const absent = seededStorage({ absentFoundation: true });
  assert.equal(transactions.loadStrictFoundationState(absent).state.wallet.coins, 0);
  const storage = seededStorage();
  const raw = transactions.loadStrictFoundationState(storage);
  assert.equal(raw.state.futureRoot.preserved, true);
  assert.equal(raw.state.wallet.futureWalletFlag, true);
});
test('strict bridge rejects malformed, future, and invalid coin foundation data', async () => {
  const invalids = [
    ['{', 'FOUNDATION_JSON_PARSE_FAILED'],
    [JSON.stringify({ schemaVersion: 99, wallet: { coins: 1 } }), 'UNSUPPORTED_FUTURE_FOUNDATION_SCHEMA_VERSION'],
    [JSON.stringify({ schemaVersion: 1, wallet: { coins: -1 } }), 'INVALID_FOUNDATION_COINS'],
  ];
  for (const [raw, code] of invalids) await expectCode(code, () => transactions.loadStrictFoundationState(new FakeStorage({ [foundation.STORAGE_KEY]: raw })));
});
test('strict bridge rejects unknown numeric values that JSON cannot round-trip and preserves Unicode data', async () => {
  const unsafeNumbers = [
    '{"schemaVersion":1,"wallet":{"coins":1},"future":9007199254740993}',
    '{"schemaVersion":1,"wallet":{"coins":1},"future":1e400}',
    '{"schemaVersion":1,"wallet":{"coins":1},"future":1e-400}',
    '{"schemaVersion":1,"wallet":{"coins":1},"future":-0}',
    '{"schemaVersion":1,"wallet":{"coins":1},"future":0.1234567890123456789012345}',
  ];
  for (const raw of unsafeNumbers) await expectCode('UNSAFE_FOUNDATION_JSON_NUMBER', () => transactions.loadStrictFoundationState(new FakeStorage({ [foundation.STORAGE_KEY]: raw })));
  const preciseRaw = '{"schemaVersion":1,"wallet":{"coins":999},"future":0.1234567890123456789012345}';
  const rejectedStorage = seededStorage();
  rejectedStorage.values.set(foundation.STORAGE_KEY, preciseRaw);
  const rejectedGearId = gearStorage.loadGearState(rejectedStorage).inventory[0].gear.gearId;
  await expectCode('UNSAFE_FOUNDATION_JSON_NUMBER', () => transactions.enhanceStoredGearAtomic({
    transactionId: 'unsafe-decimal', gearId: rejectedGearId, targetLevel: 3, createdAtMs: 1, storage: rejectedStorage,
  }));
  assert.equal(rejectedStorage.getItem(foundation.STORAGE_KEY), preciseRaw, 'unknown decimal rejection keeps foundation raw byte-identical');
  assert.equal(rejectedStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null, 'unsafe foundation raw is rejected before WAL creation');
  const raw = '{"schemaVersion":1,"wallet":{"coins":999},"message":"\u96ea\u2603\ud83d\ude80"}';
  const storage = seededStorage(); storage.values.set(foundation.STORAGE_KEY, raw);
  const id = gearStorage.loadGearState(storage).inventory[0].gear.gearId;
  await transactions.enhanceStoredGearAtomic({ transactionId: 'unicode', gearId: id, targetLevel: 3, createdAtMs: 1, storage });
  assert.equal(transactions.loadStrictFoundationState(storage).state.message, '雪☃🚀');
});
test('exclusive lock is mandatory and concurrent public starts serialize without a second charge', async () => {
  assert.equal(transactions.GEAR_MUTATION_LOCK_NAME, 'katamon_gear_v1:mutation');
  assert.equal(foundation.GEAR_TRANSACTION_STORAGE_KEY, transactions.GEAR_TRANSACTION_STORAGE_KEY);
  assert.equal(rewards.GEAR_TRANSACTION_STORAGE_KEY, transactions.GEAR_TRANSACTION_STORAGE_KEY);
  const unavailable = seededStorage(); unavailable.gearMutationLockManager = null;
  const unavailableId = gearStorage.loadGearState(unavailable).inventory[0].gear.gearId;
  await expectCode('TRANSACTION_LOCK_UNAVAILABLE', () => transactions.enhanceStoredGearAtomic({ transactionId: 'no-lock', gearId: unavailableId, targetLevel: 3, createdAtMs: 1, storage: unavailable }));
  const refused = seededStorage(); refused.gearMutationLockManager = { request(_name, _options, callback) { return callback(null); } };
  const refusedId = gearStorage.loadGearState(refused).inventory[0].gear.gearId;
  await expectCode('TRANSACTION_LOCK_NOT_ACQUIRED', () => transactions.enhanceStoredGearAtomic({ transactionId: 'refused-lock', gearId: refusedId, targetLevel: 3, createdAtMs: 1, storage: refused }));
  const skipped = seededStorage(); skipped.gearMutationLockManager = { request() { return undefined; } };
  const skippedId = gearStorage.loadGearState(skipped).inventory[0].gear.gearId;
  const skippedGearRaw = skipped.getItem(gearStorage.GEAR_STORAGE_KEY);
  await expectCode('TRANSACTION_LOCK_NOT_ACQUIRED', () => transactions.enhanceStoredGearAtomic({ transactionId: 'skipped-callback', gearId: skippedId, targetLevel: 3, createdAtMs: 1, storage: skipped }));
  assert.equal(skipped.getItem(gearStorage.GEAR_STORAGE_KEY), skippedGearRaw);
  assert.equal(skipped.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
  const rejected = seededStorage(); rejected.gearMutationLockManager = { request() { return Promise.reject(new Error('lock service failed')); } };
  const rejectedId = gearStorage.loadGearState(rejected).inventory[0].gear.gearId;
  await expectCode('TRANSACTION_LOCK_FAILED', () => transactions.enhanceStoredGearAtomic({ transactionId: 'rejected-lock', gearId: rejectedId, targetLevel: 3, createdAtMs: 1, storage: rejected }));
  const storage = seededStorage(); const id = gearStorage.loadGearState(storage).inventory[0].gear.gearId; const cost = gear.calculateEnhancementCost(0, 3);
  const [first, second] = await Promise.all([
    transactions.enhanceStoredGearAtomic({ transactionId: 'parallel-a', gearId: id, targetLevel: 3, createdAtMs: 1, storage }),
    transactions.enhanceStoredGearAtomic({ transactionId: 'parallel-b', gearId: id, targetLevel: 3, createdAtMs: 2, storage }),
  ]);
  assert.equal([first.noOp, second.noOp].filter(Boolean).length, 1);
  assert.equal(gearStorage.loadGearState(storage).resources.powder, 999 - cost.powder);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, 999 - cost.coins);

  const mixed = seededStorage(); const mixedId = gearStorage.loadGearState(mixed).inventory[0].gear.gearId;
  await Promise.all([
    transactions.enhanceStoredGearAtomic({ transactionId: 'mixed-enhance', gearId: mixedId, targetLevel: 3, createdAtMs: 3, storage: mixed }),
    rewards.persistQueueReward({ rewardId: 'mixed-reward', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 3, gears: [], blueprintShards: 1 }, mixed),
  ]);
  const mixedState = gearStorage.loadGearState(mixed);
  assert.equal(mixedState.inventory[0].gear.enhancementLevel, 3);
  assert.equal(mixedState.unclaimedRewards.some((entry) => entry.rewardId === 'mixed-reward'), true);
});
test('enhancement atomically changes inventory gear, powder and coins, preserving foundation extras', async () => {
  const storage = seededStorage(); const before = gearStorage.loadGearState(storage); const cost = gear.calculateEnhancementCost(0, 3);
  const result = await transactions.enhanceStoredGearAtomic({ transactionId: 'tx-ok', gearId: before.inventory[0].gear.gearId, targetLevel: 3, createdAtMs: 1, storage });
  assert.equal(result.recovered, true);
  const after = gearStorage.loadGearState(storage);
  assert.equal(after.inventory[0].gear.enhancementLevel, 3);
  assert.deepEqual(after.inventory[0].gear, gear.enhanceGear(before.inventory[0].gear, 3), 'enhancementSeed materialization is delegated unchanged to GearDomain');
  assert.equal(after.resources.powder, before.resources.powder - cost.powder);
  const raw = transactions.loadStrictFoundationState(storage);
  assert.equal(raw.state.wallet.coins, 999 - cost.coins);
  assert.equal(raw.state.futureRoot.preserved, true);
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
});
test('same target is no-op, lower target and TEMP gear are rejected', async () => {
  const storage = seededStorage(); const id = gearStorage.loadGearState(storage).inventory[0].gear.gearId;
  assert.equal((await transactions.enhanceStoredGearAtomic({ transactionId: 'noop', gearId: id, targetLevel: 0, createdAtMs: 1, storage })).noOp, true);
  await expectCode('INVALID_ENHANCEMENT_TARGET', () => transactions.enhanceStoredGearAtomic({ transactionId: 'low', gearId: id, targetLevel: -1, createdAtMs: 1, storage }));
  const temp = gearStorage.createDefaultGearStorageState(); temp.tempBox.push({ gear: makeGear('temp'), locked: false, favorite: false, enteredAtMs: 1 }); temp.resources.powder = 999;
  const tempStorage = new FakeStorage({ [gearStorage.GEAR_STORAGE_KEY]: gearStorage.encodeGearStorageState(temp), [foundation.STORAGE_KEY]: foundationRaw(999) });
  await expectCode('GEAR_NOT_IN_INVENTORY', () => transactions.enhanceStoredGearAtomic({ transactionId: 'temp', gearId: 'temp', targetLevel: 3, createdAtMs: 1, storage: tempStorage }));
  await expectCode('GEAR_NOT_IN_INVENTORY', () => transactions.enhanceStoredGearAtomic({ transactionId: 'unclaimed', gearId: 'unclaimed-gear', targetLevel: 3, createdAtMs: 1, storage: unclaimedGearStorage() }));
});
test('insufficient resources, pending journal, and journal write failure leave targets unchanged', async () => {
  const poorCoin = seededStorage({ coins: 0 }); const id = gearStorage.loadGearState(poorCoin).inventory[0].gear.gearId;
  await expectCode('INSUFFICIENT_COINS', () => transactions.enhanceStoredGearAtomic({ transactionId: 'coin', gearId: id, targetLevel: 3, createdAtMs: 1, storage: poorCoin }));
  const poorPowder = seededStorage({ powder: 0 }); await expectCode('INSUFFICIENT_POWDER', () => transactions.enhanceStoredGearAtomic({ transactionId: 'powder', gearId: id, targetLevel: 3, createdAtMs: 1, storage: poorPowder }));
  const storage = seededStorage(); const before = storage.getItem(gearStorage.GEAR_STORAGE_KEY); storage.throwSet = new Error('full');
  await expectCode('TRANSACTION_JOURNAL_WRITE_FAILED', () => transactions.enhanceStoredGearAtomic({ transactionId: 'write', gearId: id, targetLevel: 3, createdAtMs: 1, storage }));
  assert.equal(storage.getItem(gearStorage.GEAR_STORAGE_KEY), before);
  storage.throwSet = null; storage.values.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, JSON.stringify(journalFor(storage)));
  await expectCode('PENDING_TRANSACTION_EXISTS', () => transactions.enhanceStoredGearAtomic({ transactionId: 'blocked', gearId: id, targetLevel: 3, createdAtMs: 1, storage }));
});
test('journal only recovery is forward and crash points never double-charge', async () => {
  const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage);
  assert.equal((await transactions.recoverPendingGearTransaction(storage)).recovered, true);
  const firstGear = gearStorage.loadGearState(storage); const firstCoin = transactions.loadStrictFoundationState(storage).state.wallet.coins;
  assert.equal((await transactions.recoverPendingGearTransaction(storage)).recovered, false);
  assert.equal(gearStorage.loadGearState(storage).resources.powder, firstGear.resources.powder);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, firstCoin);
});
test('WAL-only state blocks foundation writers until forward recovery completes', async () => {
  const storage = seededStorage(); const journal = journalFor(storage);
  await transactions.saveJournal(journal, storage);
  const foundationBefore = storage.getItem(foundation.STORAGE_KEY);
  const gearBefore = storage.getItem(gearStorage.GEAR_STORAGE_KEY);
  const walBefore = storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY);
  await expectCode('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateFoundationCoins(storage));
  assert.equal(storage.getItem(foundation.STORAGE_KEY), foundationBefore);
  assert.equal(storage.getItem(gearStorage.GEAR_STORAGE_KEY), gearBefore);
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), walBefore);
  await transactions.recoverPendingGearTransaction(storage);
  assertJournalCommittedOnce(storage, journal);
  const resumed = await mutateFoundationCoins(storage, 1);
  assert.equal(resumed.amount, 1);
  assert.equal(foundation.loadState(storage).wallet.coins, journal.coinAfter + 1);
});
test('gear-side pending WAL blocks maintenance, then permits exactly one expiry after recovery', async () => {
  const storage = seededStorage(); const expiredGear = addExpiredTempGear(storage, 'pending-maintenance-expired');
  const dismantle = gear.calculateDismantleYield(expiredGear); const journal = journalFor(storage);
  await transactions.saveJournal(journal, storage);
  const gearSide = gearStorage.loadGearState(storage);
  gearSide.inventory[0].gear = clone(journal.gearAfter);
  gearSide.resources.powder = journal.powderAfter;
  gearStorage.saveGearState(gearSide, storage);
  const blockedGearRaw = storage.getItem(gearStorage.GEAR_STORAGE_KEY);
  const walRaw = storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY);
  await expectCode('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistStorageMaintenance(gearStorage.TEMP_BOX_TTL_MS, storage));
  assert.equal(storage.getItem(gearStorage.GEAR_STORAGE_KEY), blockedGearRaw, 'blocked maintenance does not change powder or TEMP');
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), walRaw);
  await transactions.recoverPendingGearTransaction(storage);
  const maintained = await rewards.persistStorageMaintenance(gearStorage.TEMP_BOX_TTL_MS, storage);
  assert.deepEqual(maintained.expiredGearIds, [expiredGear.gearId]);
  const finalState = gearStorage.loadGearState(storage);
  assert.equal(finalState.resources.powder, journal.powderAfter + dismantle.powder);
  assert.equal(finalState.tempBox.length, 0);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, journal.coinAfter);
});
test('public read-back ambiguity blocks both writer families until recovery, then resumes once', async () => {
  const storage = seededStorage(); const expiredGear = addExpiredTempGear(storage, 'ambiguous-expired');
  const dismantle = gear.calculateDismantleYield(expiredGear);
  const before = gearStorage.loadGearState(storage); const targetId = before.inventory[0].gear.gearId;
  const cost = gear.calculateEnhancementCost(before.inventory[0].gear.enhancementLevel, 3);
  storage.readBackAfterSet.set(gearStorage.GEAR_STORAGE_KEY, 'ambiguous-read-back');
  await expectCode('STORAGE_READ_BACK_MISMATCH', () => transactions.enhanceStoredGearAtomic({
    transactionId: 'ambiguous-public', gearId: targetId, targetLevel: 3, createdAtMs: 1, storage,
  }));
  assert.notEqual(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null, 'ambiguous write retains WAL');
  await expectCode('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateFoundationCoins(storage));
  await expectCode('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistStorageMaintenance(gearStorage.TEMP_BOX_TTL_MS, storage));
  storage.readBack.delete(gearStorage.GEAR_STORAGE_KEY);
  storage.readBackAfterSet.delete(gearStorage.GEAR_STORAGE_KEY);
  await transactions.recoverPendingGearTransaction(storage);
  const committed = gearStorage.loadGearState(storage);
  assert.equal(committed.inventory[0].gear.enhancementLevel, 3);
  assert.equal(committed.resources.powder, before.resources.powder - cost.powder);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, 999 - cost.coins);
  await mutateFoundationCoins(storage, 1);
  await rewards.persistStorageMaintenance(gearStorage.TEMP_BOX_TTL_MS, storage);
  const finalState = gearStorage.loadGearState(storage);
  assert.equal(finalState.resources.powder, before.resources.powder - cost.powder + dismantle.powder);
  assert.equal(finalState.tempBox.length, 0);
  assert.equal(foundation.loadState(storage).wallet.coins, 999 - cost.coins + 1);
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
});
test('committed cleanup failure blocks other mutations until cleanup recovery succeeds', async () => {
  const storage = seededStorage(); const id = gearStorage.loadGearState(storage).inventory[0].gear.gearId;
  storage.throwRemove = new Error('cleanup unavailable');
  await expectCode('TRANSACTION_COMMITTED_CLEANUP_FAILED', () => transactions.enhanceStoredGearAtomic({
    transactionId: 'cleanup-block', gearId: id, targetLevel: 3, createdAtMs: 1, storage,
  }));
  assert.notEqual(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
  await expectCode('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateFoundationCoins(storage));
  await expectCode('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistQueueReward({
    rewardId: 'cleanup-blocked-reward', sourceId: 'cpu_battle', sourceDetail: null,
    createdAtMs: 2, gears: [], blueprintShards: 1,
  }, storage));
  storage.throwRemove = null;
  await transactions.recoverPendingGearTransaction(storage);
  await mutateFoundationCoins(storage, 1);
  const queued = await rewards.persistQueueReward({
    rewardId: 'cleanup-resumed-reward', sourceId: 'cpu_battle', sourceDetail: null,
    createdAtMs: 3, gears: [], blueprintShards: 1,
  }, storage);
  assert.equal(queued.queued, true);
  assert.equal(storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), null);
});
test('gear side done, coin side done, and cleanup retry recover safely', async () => {
  const storage = seededStorage(); const journal = journalFor(storage);
  const state = gearStorage.loadGearState(storage); state.inventory[0].gear = clone(journal.gearAfter); state.resources.powder = journal.powderAfter; gearStorage.saveGearState(state, storage);
  await transactions.saveJournal(journal, storage); assert.equal((await transactions.recoverPendingGearTransaction(storage)).coinApplied, true);
  const storage2 = seededStorage(); const journal2 = journalFor(storage2);
  const state2 = gearStorage.loadGearState(storage2); state2.inventory[0].gear = clone(journal2.gearAfter); state2.resources.powder = journal2.powderAfter; gearStorage.saveGearState(state2, storage2); storage2.values.set(foundation.STORAGE_KEY, journal2.foundationRawAfter); await transactions.saveJournal(journal2, storage2);
  storage2.throwRemove = new Error('remove'); await expectCode('TRANSACTION_COMMITTED_CLEANUP_FAILED', () => transactions.recoverPendingGearTransaction(storage2));
  storage2.throwRemove = null; assert.equal((await transactions.recoverPendingGearTransaction(storage2)).recovered, true);
});
test('read-back ambiguous leaves WAL for later recovery and journal stays small', async () => {
  const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage);
  storage.readBackAfterSet.set(gearStorage.GEAR_STORAGE_KEY, 'different');
  await expectCode('STORAGE_READ_BACK_MISMATCH', () => transactions.recoverPendingGearTransaction(storage));
  storage.readBack.delete(gearStorage.GEAR_STORAGE_KEY);
  assert.equal((await transactions.recoverPendingGearTransaction(storage)).recovered, true);
  const size = transactions.journalSize(journal);
  console.log(`  info journal-fixture chars=${size.chars} utf16Bytes=${size.utf16Bytes}`);
  assert.ok(size.chars < 20000); assert.equal(transactions.encodeJournal(journal).includes('gearRawBefore'), false);
});
test('conflicts never overwrite changed target gear, powder, or foundation raw', async () => {
  for (const [, mutate] of [['gear', (state) => { state.inventory[0].gear = makeGear('other'); }], ['powder', (state) => { state.resources.powder -= 1; }]]) {
    const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); const state = gearStorage.loadGearState(storage); mutate(state); gearStorage.saveGearState(state, storage);
    await expectCode('TRANSACTION_CONFLICT', () => transactions.recoverPendingGearTransaction(storage));
  }
  const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); storage.values.set(foundation.STORAGE_KEY, foundationRaw(500));
  await expectCode('TRANSACTION_CONFLICT', () => transactions.recoverPendingGearTransaction(storage));
});
test('journal and coin read-back ambiguity retain the WAL and recover exactly once', async () => {
  const storage = seededStorage(); const journal = journalFor(storage);
  const untouchedGearRaw = storage.getItem(gearStorage.GEAR_STORAGE_KEY);
  storage.readBackAfterSet.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, 'different');
  await expectCode('TRANSACTION_JOURNAL_READ_BACK_MISMATCH', () => transactions.saveJournal(journal, storage));
  assert.equal(storage.getItem(gearStorage.GEAR_STORAGE_KEY), untouchedGearRaw);
  storage.readBack.delete(transactions.GEAR_TRANSACTION_STORAGE_KEY); storage.readBackAfterSet.delete(transactions.GEAR_TRANSACTION_STORAGE_KEY);
  // The ambiguous journal write did commit in this fake, so normal forward
  // recovery is safe; it must not create a second charge.
  storage.readBackAfterSet.set(foundation.STORAGE_KEY, 'different');
  await expectCode('FOUNDATION_READ_BACK_MISMATCH', () => transactions.recoverPendingGearTransaction(storage));
  storage.readBack.delete(foundation.STORAGE_KEY); storage.readBackAfterSet.delete(foundation.STORAGE_KEY);
  assert.equal((await transactions.recoverPendingGearTransaction(storage)).recovered, true);
  assert.equal(gearStorage.loadGearState(storage).inventory[0].gear.enhancementLevel, 3);
  assert.equal(transactions.loadStrictFoundationState(storage).state.wallet.coins, journal.coinAfter);
});
test('journal removal read-back mismatch is committed cleanup failure and is retryable', async () => {
  const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage);
  const originalRemove = storage.removeItem.bind(storage);
  storage.removeItem = (key) => { originalRemove(key); storage.readBack.set(key, 'still-here'); };
  await expectCode('TRANSACTION_COMMITTED_CLEANUP_FAILED', () => transactions.recoverPendingGearTransaction(storage));
  storage.readBack.delete(transactions.GEAR_TRANSACTION_STORAGE_KEY); storage.removeItem = originalRemove;
  // Even if a journal-like stale value is injected after an ambiguous read,
  // its already-committed sides are recognized rather than charged again.
  await transactions.saveJournal(journal, storage);
  assert.equal((await transactions.recoverPendingGearTransaction(storage)).recovered, true);
});
test('each crash boundary forward-recovers with one gear enhancement and one charge', async () => {
  // (76) WAL only; no side has been written yet.
  { const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (77) gear write completed, process died before coin write.
  { const storage = seededStorage(); const journal = journalFor(storage); const state = gearStorage.loadGearState(storage); state.inventory[0].gear = clone(journal.gearAfter); state.resources.powder = journal.powderAfter; gearStorage.saveGearState(state, storage); await transactions.saveJournal(journal, storage); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (78) gear write actually reached storage but its read-back was unavailable.
  { const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); storage.readBackAfterSet.set(gearStorage.GEAR_STORAGE_KEY, 'different'); await expectCode('STORAGE_READ_BACK_MISMATCH', () => transactions.recoverPendingGearTransaction(storage)); storage.readBack.delete(gearStorage.GEAR_STORAGE_KEY); storage.readBackAfterSet.delete(gearStorage.GEAR_STORAGE_KEY); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (79) coin write completed, process died before journal cleanup.
  { const storage = seededStorage(); const journal = journalFor(storage); const state = gearStorage.loadGearState(storage); state.inventory[0].gear = clone(journal.gearAfter); state.resources.powder = journal.powderAfter; gearStorage.saveGearState(state, storage); storage.values.set(foundation.STORAGE_KEY, journal.foundationRawAfter); await transactions.saveJournal(journal, storage); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (80) coin write reached storage but read-back was ambiguous.
  { const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); storage.readBackAfterSet.set(foundation.STORAGE_KEY, 'different'); await expectCode('FOUNDATION_READ_BACK_MISMATCH', () => transactions.recoverPendingGearTransaction(storage)); storage.readBack.delete(foundation.STORAGE_KEY); storage.readBackAfterSet.delete(foundation.STORAGE_KEY); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (81) both writes completed, process died before cleanup.
  { const storage = seededStorage(); const journal = journalFor(storage); const state = gearStorage.loadGearState(storage); state.inventory[0].gear = clone(journal.gearAfter); state.resources.powder = journal.powderAfter; gearStorage.saveGearState(state, storage); storage.values.set(foundation.STORAGE_KEY, journal.foundationRawAfter); await transactions.saveJournal(journal, storage); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  // (82) and (83) cleanup remove / verification failures do not roll back.
  { const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); storage.throwRemove = new Error('remove'); await expectCode('TRANSACTION_COMMITTED_CLEANUP_FAILED', () => transactions.recoverPendingGearTransaction(storage)); storage.throwRemove = null; await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
  { const storage = seededStorage(); const journal = journalFor(storage); await transactions.saveJournal(journal, storage); const remove = storage.removeItem.bind(storage); storage.removeItem = (key) => { remove(key); storage.readBack.set(key, 'stale'); }; await expectCode('TRANSACTION_COMMITTED_CLEANUP_FAILED', () => transactions.recoverPendingGearTransaction(storage)); storage.readBack.delete(transactions.GEAR_TRANSACTION_STORAGE_KEY); storage.removeItem = remove; await transactions.saveJournal(journal, storage); await transactions.recoverPendingGearTransaction(storage); assertJournalCommittedOnce(storage, journal); }
});
test('direct in-memory journal traps symbols, accessors, hidden fields, foreign prototypes and sparse arrays', async () => {
  const storage = seededStorage(); const journal = journalFor(storage);
  const variants = [];
  const symbol = clone(journal); symbol[Symbol('x')] = true; variants.push(symbol);
  const hidden = clone(journal); Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false }); variants.push(hidden);
  const accessor = clone(journal); Object.defineProperty(accessor, 'transactionId', { enumerable: true, get() { return 'getter'; } }); variants.push(accessor);
  const foreign = Object.create({ inherited: true }); Object.assign(foreign, clone(journal)); variants.push(foreign);
  const sparseGear = clone(journal); sparseGear.gearBefore.subOps = new Array(1); variants.push(sparseGear);
  variants.forEach((value) => assert.throws(() => transactions.validateJournal(value), (error) => error && /^INVALID_TRANSACTION/.test(error.code)));
});
test('journal is one entry, excludes whole gear storage, and transaction source never calls unsafe foundation helpers', async () => {
  const storage = seededStorage(); const journal = journalFor(storage); const encoded = transactions.encodeJournal(journal);
  assert.deepEqual(Object.keys(JSON.parse(encoded)).sort(), [
    'coinAfter', 'coinBefore', 'createdAtMs', 'foundationRawAfter', 'foundationRawBefore', 'fromLevel', 'gearAfter', 'gearBefore', 'gearId', 'kind', 'powderAfter', 'powderBefore', 'schemaVersion', 'targetLevel', 'transactionId',
  ]);
  assert.equal(encoded.includes('gearRawBefore'), false); assert.equal(encoded.includes('gearRawAfter'), false);
  assert.equal(encoded.includes('unclaimedRewards'), false); assert.equal(encoded.includes('tempBox'), false);
  const source = fs.readFileSync(require.resolve('../shared/gear-transactions.js'), 'utf8');
  assert.doesNotMatch(source, /foundation\.(?:loadState|saveState|normalizeState)\s*\(/);
});
test('public journal save refuses overwrite and recovery never cleans up a different journal', async () => {
  const firstStorage = seededStorage(); const first = journalFor(firstStorage); const second = { ...clone(first), transactionId: 'journal-2' };
  await transactions.saveJournal(first, firstStorage);
  const firstRaw = firstStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY);
  await expectCode('PENDING_TRANSACTION_EXISTS', () => transactions.saveJournal(second, firstStorage));
  assert.equal(firstStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), firstRaw);

  // A different tab changes the WAL after recovery loaded it but before it
  // starts applying sides: no side is touched and neither journal is removed.
  const earlyStorage = seededStorage(); const early = journalFor(earlyStorage); const earlyRaw = transactions.encodeJournal(early); const otherRaw = transactions.encodeJournal({ ...clone(early), transactionId: 'other-early' });
  await transactions.saveJournal(early, earlyStorage);
  earlyStorage.readSequence.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, [earlyRaw, otherRaw]);
  await expectCode('TRANSACTION_CONFLICT', () => transactions.recoverPendingGearTransaction(earlyStorage));
  assert.equal(gearStorage.loadGearState(earlyStorage).inventory[0].gear.enhancementLevel, 0);
  assert.equal(earlyStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), earlyRaw);

  // A different WAL arriving just before cleanup is also retained.  The
  // committed sides remain forward-only and the original WAL can be cleaned
  // on a subsequent normal recovery.
  const lateStorage = seededStorage(); const late = journalFor(lateStorage); const lateRaw = transactions.encodeJournal(late); const lateOtherRaw = transactions.encodeJournal({ ...clone(late), transactionId: 'other-late' });
  await transactions.saveJournal(late, lateStorage);
  lateStorage.readSequence.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, [lateRaw, lateRaw, lateOtherRaw]);
  await expectCode('TRANSACTION_CONFLICT', () => transactions.recoverPendingGearTransaction(lateStorage));
  assert.equal(lateStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY), lateRaw);
  assert.equal(gearStorage.loadGearState(lateStorage).inventory[0].gear.enhancementLevel, 3);
  assert.equal(transactions.loadStrictFoundationState(lateStorage).state.wallet.coins, late.coinAfter);
  assert.equal((await transactions.recoverPendingGearTransaction(lateStorage)).recovered, true);
});
test('future and malformed journals fail closed', async () => {
  const storage = seededStorage(); const journal = journalFor(storage);
  storage.values.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, JSON.stringify({ ...journal, schemaVersion: 2 }));
  await expectCode('UNSUPPORTED_FUTURE_TRANSACTION_VERSION', () => transactions.recoverPendingGearTransaction(storage));
  storage.values.set(transactions.GEAR_TRANSACTION_STORAGE_KEY, '{'); await expectCode('TRANSACTION_JOURNAL_JSON_PARSE_FAILED', () => transactions.recoverPendingGearTransaction(storage));
});

(async () => {
  for (const entry of queuedTests) {
    try { await entry.fn(); passed += 1; console.log(`  ok   ${entry.name}`); } catch (error) { console.error(`  NG   ${entry.name}`); throw error; }
  }
  console.log(`gear transactions: ${passed}/${queuedTests.length} passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
