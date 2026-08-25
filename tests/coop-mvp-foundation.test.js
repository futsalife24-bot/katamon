const assert = require('node:assert/strict');

const foundation = require('../coop-mvp-foundation.js');

const {
  STORAGE_KEY,
  SCHEMA_VERSION,
  COIN_CAP,
  GEAR_TRANSACTION_STORAGE_KEY,
  STATE_MUTATION_LOCK_NAME,
  DIFFICULTIES,
  COOP_ITEMS,
  SUBWEAPONS,
  COSMETICS,
  createDefaultState,
  normalizeState,
  isFeatureEnabled,
  grantCoins,
  withStateMutationLock,
  mutateStateLocked,
} = foundation;

assert.equal(STORAGE_KEY, 'katamon_coop_mvp_v1');
assert.equal(SCHEMA_VERSION, 1);
assert.equal(COIN_CAP, 9999);
assert.equal(GEAR_TRANSACTION_STORAGE_KEY, 'katamon_gear_txn_v1');
assert.equal(STATE_MUTATION_LOCK_NAME, 'katamon_gear_v1:mutation');
assert.deepEqual(DIFFICULTIES.map(({ id, coreExposeRounds }) => ({ id, coreExposeRounds })), [
  { id: 'normal', coreExposeRounds: 2 },
  { id: 'hard', coreExposeRounds: 2 },
  { id: 'extreme', coreExposeRounds: 1 },
]);
assert.deepEqual(DIFFICULTIES.map(({ id, roundLimit }) => ({ id, roundLimit })), [
  { id: 'normal', roundLimit: 12 },
  { id: 'hard', roundLimit: 15 },
  { id: 'extreme', roundLimit: 12 },
]);
assert.deepEqual(COOP_ITEMS.map(({ id, usesPerMatch }) => ({ id, usesPerMatch })), [
  { id: 'rescue-kit', usesPerMatch: 1 },
  { id: 'healing-kit', usesPerMatch: 2 },
  { id: 'debuff-grenade', usesPerMatch: 1 },
]);
assert.deepEqual(SUBWEAPONS.map((entry) => entry.id), ['barrier', 'impact', 'drill']);
assert.equal(COSMETICS.length, 3);

const defaults = createDefaultState();
assert.equal(defaults.schemaVersion, SCHEMA_VERSION);
assert.equal(defaults.wallet.coins, 0);
assert.equal(defaults.equipment.coopItem, 'rescue-kit');
assert.equal(defaults.equipment.subweapon, null);
assert.equal(defaults.inventory['rescue-kit'], true);
assert.deepEqual(defaults.boss.unlockedDifficulties, ['normal']);

const sanitized = normalizeState({
  schemaVersion: -5,
  wallet: { coins: 50000 },
  inventory: { 'rescue-kit': false, barrier: true, unknown: true },
  equipment: { coopItem: 'unknown', subweapon: 'unknown', cosmetic: 'unknown' },
  boss: { unlockedDifficulties: ['normal', 'extreme', 'unknown', 'normal'] },
  rewardLedger: { alpha: true, bad: false },
});
assert.equal(sanitized.schemaVersion, SCHEMA_VERSION);
assert.equal(sanitized.wallet.coins, COIN_CAP);
assert.equal(sanitized.inventory['rescue-kit'], true, '救助キットは初期所持から外せない');
assert.equal(sanitized.inventory.barrier, true);
assert.equal(sanitized.inventory.unknown, undefined);
assert.equal(sanitized.equipment.coopItem, 'rescue-kit');
assert.equal(sanitized.equipment.subweapon, null);
assert.equal(sanitized.equipment.cosmetic, null);
assert.deepEqual(sanitized.boss.unlockedDifficulties, ['normal', 'extreme']);
assert.deepEqual(sanitized.rewardLedger, { alpha: true });

assert.equal(isFeatureEnabled({ hostname: 'futsalife24-bot.github.io', search: '' }, {}), true,
  '公開ホストでは協力ボスを標準で有効にする');
assert.equal(isFeatureEnabled({ hostname: 'futsalife24-bot.github.io', search: '?coopMvp=1' }, { coopBossMvp: false }), false,
  '公開後も明示フラグで緊急停止できる');
assert.equal(isFeatureEnabled({ hostname: '127.0.0.1', search: '' }, {}), true,
  '公開ON後は開発ホストでも標準で有効にする');
assert.equal(isFeatureEnabled({ hostname: '127.0.0.1', search: '?coopMvp=1' }, {}), true);
assert.equal(isFeatureEnabled({ hostname: '192.168.1.10', search: '' }, { coopBossMvp: true }), true);

const firstGrant = grantCoins(createDefaultState(), 12000, 'first-clear-normal');
assert.equal(firstGrant.state.wallet.coins, COIN_CAP);
assert.equal(firstGrant.credited, COIN_CAP);
assert.equal(firstGrant.duplicate, false);
const duplicateGrant = grantCoins(firstGrant.state, 500, 'first-clear-normal');
assert.equal(duplicateGrant.state.wallet.coins, COIN_CAP);
assert.equal(duplicateGrant.credited, 0);
assert.equal(duplicateGrant.duplicate, true);

class FakeStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writes = [];
  }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }

  setItem(key, value) {
    const encoded = String(value);
    this.values.set(key, encoded);
    this.writes.push([key, encoded]);
  }
}

function createQueuedLockManager() {
  let tail = Promise.resolve();
  const requests = [];
  return {
    requests,
    request(name, options, callback) {
      requests.push({ name, options });
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      return previous.then(async () => {
        try { return await callback({ name, mode: options.mode }); } finally { release(); }
      });
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function expectMutationError(code, operation) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function runLockedMutationTests() {
  const storage = new FakeStorage();
  const lockManager = createQueuedLockManager();
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const observedBalances = [];

  const first = mutateStateLocked(async (state) => {
    observedBalances.push(state.wallet.coins);
    firstEntered.resolve();
    await releaseFirst.promise;
    state.wallet.coins += 100;
    return { state, operation: 'first' };
  }, { storage, lockManager });
  await firstEntered.promise;
  const second = mutateStateLocked((state) => {
    observedBalances.push(state.wallet.coins);
    state.wallet.coins += 20;
    return { state, operation: 'second' };
  }, { storage, lockManager });

  await Promise.resolve();
  assert.deepEqual(observedBalances, [0], '後続mutationは先行lock解放前にstateを読まない');
  releaseFirst.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state.wallet.coins, 100);
  assert.equal(secondResult.state.wallet.coins, 120);
  assert.equal(secondResult.operation, 'second', 'mutatorの付加結果を保持する');
  assert.deepEqual(observedBalances, [0, 100], '各lock内で最新stateをloadする');
  assert.equal(foundation.loadState(storage).wallet.coins, 120);
  assert.equal(storage.writes.length, 2);
  assert.deepEqual(lockManager.requests.map(({ name }) => name), [STATE_MUTATION_LOCK_NAME, STATE_MUTATION_LOCK_NAME]);
  assert.ok(lockManager.requests.every(({ options }) => options.mode === 'exclusive'));

  const fallbackStorage = new FakeStorage();
  const fallback = await mutateStateLocked((state) => {
    state.wallet.coins = COIN_CAP + 45;
    return { state, fallback: true };
  }, { storage: fallbackStorage, lockManager: null });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.state.wallet.coins, COIN_CAP, '返却stateはsave時に正規化された値を使う');
  assert.equal(foundation.loadState(fallbackStorage).wallet.coins, COIN_CAP,
    'Web Locks未対応時は従来相当のload→mutation→saveを実行する');

  const fallbackRaceStorage = new FakeStorage();
  const fallbackFirst = mutateStateLocked(async (state) => {
    await Promise.resolve();
    state.rewardLedger.fallbackA = true;
    return { state };
  }, { storage: fallbackRaceStorage, lockManager: null });
  const fallbackSecond = mutateStateLocked((state) => {
    state.rewardLedger.fallbackB = true;
    return { state };
  }, { storage: fallbackRaceStorage, lockManager: null });
  await Promise.all([fallbackFirst, fallbackSecond]);
  assert.deepEqual(foundation.loadState(fallbackRaceStorage).rewardLedger, {
    fallbackA: true,
    fallbackB: true,
  }, 'Web Locks非対応時も同一タブの未await writerをFIFO直列化して更新欠落を防ぐ');

  const pendingFallbackStorage = new FakeStorage({ [GEAR_TRANSACTION_STORAGE_KEY]: '{malformed-wal' });
  let pendingFallbackMutatorCalled = false;
  await expectMutationError('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateStateLocked((state) => {
    pendingFallbackMutatorCalled = true;
    state.wallet.coins += 1;
    return { state };
  }, { storage: pendingFallbackStorage, lockManager: null }));
  assert.equal(pendingFallbackMutatorCalled, false, 'fallbackでも残留WAL中はmutatorを開始しない');
  assert.equal(pendingFallbackStorage.getItem(STORAGE_KEY), null, '残留WAL中はfoundation rawを書かない');
  assert.equal(pendingFallbackStorage.getItem(GEAR_TRANSACTION_STORAGE_KEY), '{malformed-wal', '壊れたWALも勝手に削除しない');

  const afterLockStorage = new FakeStorage();
  let afterLockMutatorCalled = false;
  const walInjectingLockManager = {
    request(name, options, callback) {
      afterLockStorage.setItem(GEAR_TRANSACTION_STORAGE_KEY, 'pending-after-lock');
      return callback({ name, mode: options.mode });
    },
  };
  await expectMutationError('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateStateLocked((state) => {
    afterLockMutatorCalled = true;
    state.wallet.coins += 1;
    return { state };
  }, { storage: afterLockStorage, lockManager: walInjectingLockManager }));
  assert.equal(afterLockMutatorCalled, false, 'WAL guardはlock callback内でmutatorより前に実行する');
  assert.equal(afterLockStorage.getItem(STORAGE_KEY), null);

  const hadGlobalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previousGlobalStorage = globalThis.localStorage;
  const globalStorage = new FakeStorage({ [GEAR_TRANSACTION_STORAGE_KEY]: 'pending-global-wal' });
  globalThis.localStorage = globalStorage;
  try {
    let nullStorageMutatorCalled = false;
    await expectMutationError('FOUNDATION_PENDING_GEAR_TRANSACTION', () => mutateStateLocked((state) => {
      nullStorageMutatorCalled = true;
      state.wallet.coins += 7;
      return { state };
    }, { storage: null, lockManager: null }));
    assert.equal(nullStorageMutatorCalled, false, 'storage:nullもload/saveと同じglobal storageのWALで遮断する');
    assert.equal(globalStorage.getItem(STORAGE_KEY), null, 'storage:nullのguard迂回でfoundationを書かない');
    globalStorage.values.delete(GEAR_TRANSACTION_STORAGE_KEY);
    const resumedGlobal = await mutateStateLocked((state) => {
      state.wallet.coins += 7;
      return { state };
    }, { storage: null, lockManager: null });
    assert.equal(resumedGlobal.state.wallet.coins, 7, 'global WAL解消後はstorage:null writerも再開できる');
  } finally {
    if (hadGlobalStorage) globalThis.localStorage = previousGlobalStorage;
    else delete globalThis.localStorage;
  }

  let fallbackCalled = false;
  const fallbackValue = await withStateMutationLock(() => {
    fallbackCalled = true;
    return 'fallback-ok';
  }, { lockManager: null });
  assert.equal(fallbackCalled, true);
  assert.equal(fallbackValue, 'fallback-ok');

  await expectMutationError('FOUNDATION_LOCK_NOT_ACQUIRED', () => withStateMutationLock(
    () => assert.fail('lock取得失敗時はoperationを実行しない'),
    { lockManager: { request(_name, _options, callback) { return callback(null); } } },
  ));
  await expectMutationError('FOUNDATION_LOCK_NOT_ACQUIRED', () => withStateMutationLock(
    () => assert.fail('callbackが呼ばれないlock APIでoperationを実行しない'),
    { lockManager: { request() { return null; } } },
  ));
  await expectMutationError('FOUNDATION_LOCK_FAILED', () => withStateMutationLock(
    () => assert.fail('lock request reject時はoperationを実行しない'),
    { lockManager: { request() { return Promise.reject(new Error('lock service failed')); } } },
  ));
  await expectMutationError('FOUNDATION_MUTATION_RESULT_INVALID', () => mutateStateLocked(
    () => undefined,
    { storage: new FakeStorage(), lockManager: null },
  ));

  console.log('協力ボスMVP基盤: 機能フラグ・保存形式・カタログ・報酬台帳・共通ロック（46/46 passed）');
}

runLockedMutationTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
