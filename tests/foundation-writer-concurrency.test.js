const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../coop-mvp-foundation.js');
const rewards = require('../coop-mvp-rewards.js');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const transactions = require('../shared/gear-transactions.js');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// This is intentionally source extraction rather than a reimplementation: a
// change to either title-screen writer must be exercised exactly as shipped.
function extractNamedFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} must remain in index.html`);
  const start = source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `${name} must have a function body`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === '\'' || character === '"' || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} body was not closed`);
}

const cycleSource = extractNamedFunction(indexSource, 'cycleSelectedSubweapon');
const ownedSubweaponsSource = extractNamedFunction(indexSource, 'ownedSubweapons');
const applyRewardSource = extractNamedFunction(indexSource, 'applyMvpRewardUpdate');

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

class FakeSharedStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.beforeSet = null;
    this.gearMutationLockManager = null;
  }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }

  setItem(key, value) {
    // The hook deliberately fires before the write.  For gear enhancement it
    // is armed only after its WAL is already durable, so an unlocked title
    // writer reads the stale foundation snapshot and is then overwritten by
    // the transaction commit.  A shared lock queues it behind the commit.
    this.beforeSet?.(key, String(value), this);
    this.values.set(key, String(value));
  }

  removeItem(key) { this.values.delete(key); }
}

function makeGear(id) {
  return gear.createGear({
    gearId: id,
    generationSeed: `create-${id}`,
    enhancementSeed: `enhance-${id}`,
    sourceId: 'foundation-writer-race',
    sourceDetail: { test: true },
    acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile: { id: 'fixed-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'mythic', weight: 1 }] },
    setProfile: { id: 'fixed-set', setWeights: [{ id: 'assault', weight: 1 }] },
    slotId: 'engine',
  });
}

function createInitialFoundation(coins = 100) {
  const state = foundation.createDefaultState();
  state.wallet.coins = coins;
  state.inventory.barrier = true;
  state.inventory.impact = true;
  state.inventory.drill = true;
  state.equipment.subweapon = 'barrier';
  state.rewardLedger.preexisting = true;
  return state;
}

function createSharedFixture({ coins = 100, withGear = false } = {}) {
  const lockManager = createQueuedLockManager();
  const initial = { [foundation.STORAGE_KEY]: JSON.stringify(createInitialFoundation(coins)) };
  if (withGear) {
    const gearState = gearStorage.createDefaultGearStorageState();
    gearState.resources.powder = 100;
    gearState.inventory.push({ gear: makeGear('race-gear'), locked: false, favorite: false });
    initial[gearStorage.GEAR_STORAGE_KEY] = gearStorage.encodeGearStorageState(gearState);
  }
  const storage = new FakeSharedStorage(initial);
  storage.gearMutationLockManager = lockManager;
  return { storage, lockManager };
}

function createFoundationFacade(storage, lockManager) {
  return Object.freeze({
    ...foundation,
    loadState() { return foundation.loadState(storage); },
    saveState(state) { return foundation.saveState(state, storage); },
    mutateStateLocked(mutator) {
      return foundation.mutateStateLocked(mutator, { storage, lockManager });
    },
  });
}

function compileCycleWriter(storage, lockManager) {
  const root = { KatamonCoopMvp: createFoundationFacade(storage, lockManager) };
  return Function('globalThis', `
    let selectedSubweapon = null;
    let subweaponCycleInFlight = false;
    function showTitleNotice() {}
    ${ownedSubweaponsSource}
    ${cycleSource}
    return cycleSelectedSubweapon;
  `)(root);
}

function compileRewardWriter(storage, lockManager, notifications) {
  const root = {
    KatamonCoopMvp: createFoundationFacade(storage, lockManager),
    KatamonCoopRewards: rewards,
    KatamonMvpShop: { notifyAchievements(ids) { notifications.push([...ids]); } },
  };
  return Function('globalThis', `
    const COOP_MVP_FEATURE_ENABLED = true;
    ${applyRewardSource}
    return applyMvpRewardUpdate;
  `)(root);
}

function assertSharedExclusiveLock(lockManager, expectedRequests) {
  assert.equal(lockManager.requests.length, expectedRequests);
  assert.ok(lockManager.requests.every(({ name, options }) => (
    name === foundation.STATE_MUTATION_LOCK_NAME && options.mode === 'exclusive'
  )), 'gear transaction and title writers must request one shared exclusive lock');
}

async function testEnhancementVersusCycle() {
  const { storage, lockManager } = createSharedFixture({ coins: 100, withGear: true });
  const cycle = compileCycleWriter(storage, lockManager);
  let cyclePromise;
  let barrierReached = false;
  storage.beforeSet = (key) => {
    if (!barrierReached
      && key === foundation.STORAGE_KEY
      && storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY) !== null) {
      barrierReached = true;
      cyclePromise = cycle();
    }
  };

  const enhancement = transactions.enhanceStoredGearAtomic({
    transactionId: 'enhancement-vs-cycle', gearId: 'race-gear', targetLevel: 3, createdAtMs: 1, storage,
  });
  await enhancement;
  await cyclePromise;

  const progress = foundation.loadState(storage);
  const gearState = gearStorage.loadGearState(storage);
  assert.equal(barrierReached, true, 'barrier must run after WAL creation and before its foundation commit');
  assert.equal(gearState.inventory[0].gear.enhancementLevel, 3, 'gear is enhanced once');
  assert.equal(gearState.resources.powder, 70, 'powder is charged once');
  assert.equal(progress.wallet.coins, 70, 'wallet is not rolled back by the stale cycle snapshot');
  assert.equal(progress.equipment.subweapon, 'impact', 'cycle survives the gear transaction commit');
  assert.equal(progress.inventory.drill, true, 'unrelated subweapon ownership survives');
  assertSharedExclusiveLock(lockManager, 2);
}

async function testEnhancementVersusRewardUpdate() {
  const { storage, lockManager } = createSharedFixture({ coins: 100, withGear: true });
  const notifications = [];
  const applyRewardUpdate = compileRewardWriter(storage, lockManager, notifications);
  let rewardPromise;
  let barrierReached = false;
  storage.beforeSet = (key) => {
    if (!barrierReached
      && key === foundation.STORAGE_KEY
      && storage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY) !== null) {
      barrierReached = true;
      rewardPromise = applyRewardUpdate((rewardApi, state) => rewardApi.recordEvent(state, {
        id: 'enhancement-race-win', type: 'pvp-result', outcome: 'win', hpRatio: 1,
      }));
    }
  };

  await transactions.enhanceStoredGearAtomic({
    transactionId: 'enhancement-vs-reward', gearId: 'race-gear', targetLevel: 3, createdAtMs: 2, storage,
  });
  await rewardPromise;

  const progress = foundation.loadState(storage);
  const gearState = gearStorage.loadGearState(storage);
  assert.equal(barrierReached, true);
  assert.equal(gearState.inventory[0].gear.enhancementLevel, 3);
  assert.equal(gearState.resources.powder, 70);
  assert.equal(progress.wallet.coins, 100, 'gear cost (-30) and pvp/achievement reward (+30) both remain');
  assert.equal(progress.rewardLedger['event:enhancement-race-win'], true);
  assert.equal(progress.rewardLedger['pvp-win:enhancement-race-win'], true);
  assert.equal(progress.achievements.completed['first-victory'], true);
  assert.equal(progress.achievements.claimed['first-victory'], true);
  assert.deepEqual(notifications, [['first-victory']]);
  assertSharedExclusiveLock(lockManager, 2);
}

async function testCycleVersusCycleAcrossTabs() {
  const { storage, lockManager } = createSharedFixture();
  const firstTabCycle = compileCycleWriter(storage, lockManager);
  const secondTabCycle = compileCycleWriter(storage, lockManager);
  let secondCycle;
  storage.beforeSet = (key) => {
    if (!secondCycle && key === foundation.STORAGE_KEY) secondCycle = secondTabCycle();
  };

  await firstTabCycle();
  await secondCycle;

  const progress = foundation.loadState(storage);
  assert.equal(progress.equipment.subweapon, 'drill', 'the second tab sees impact and advances again instead of overwriting with impact');
  assert.equal(progress.wallet.coins, 100);
  assert.equal(progress.rewardLedger.preexisting, true, 'whole-state fields outside the writer remain');
  assertSharedExclusiveLock(lockManager, 2);
}

async function testRewardUpdatesAcrossTabs() {
  const { storage, lockManager } = createSharedFixture();
  const notifications = [];
  const firstTabApply = compileRewardWriter(storage, lockManager, notifications);
  const secondTabApply = compileRewardWriter(storage, lockManager, notifications);
  let secondUpdate;
  storage.beforeSet = (key) => {
    if (!secondUpdate && key === foundation.STORAGE_KEY) {
      secondUpdate = secondTabApply((rewardApi, state) => rewardApi.recordEvent(state, {
        id: 'parallel-win-b', type: 'pvp-result', outcome: 'win', hpRatio: 1,
      }));
    }
  };

  await firstTabApply((rewardApi, state) => rewardApi.recordEvent(state, {
    id: 'parallel-win-a', type: 'pvp-result', outcome: 'win', hpRatio: 1,
  }));
  await secondUpdate;
  const duplicate = await firstTabApply((rewardApi, state) => rewardApi.recordEvent(state, {
    id: 'parallel-win-a', type: 'pvp-result', outcome: 'win', hpRatio: 1,
  }));

  const progress = foundation.loadState(storage);
  assert.equal(progress.wallet.coins, 140, 'two distinct wins pay exactly once each (10 + 20 achievement + 10)');
  assert.equal(progress.achievements.progress.pvpWins, 2, 'both tab updates remain');
  assert.equal(progress.rewardLedger['event:parallel-win-a'], true);
  assert.equal(progress.rewardLedger['event:parallel-win-b'], true);
  assert.equal(progress.rewardLedger['pvp-win:parallel-win-a'], true);
  assert.equal(progress.rewardLedger['pvp-win:parallel-win-b'], true);
  assert.equal(progress.achievements.completed['first-victory'], true);
  assert.equal(progress.inventory.drill, true, 'unrelated foundation state is not dropped');
  assert.deepEqual(notifications, [['first-victory']], 'only the first achievement completion is notified');
  assert.equal(duplicate.duplicate, true, 'a repeated event cannot issue a second reward');
  assertSharedExclusiveLock(lockManager, 3);
}

(async () => {
  await testEnhancementVersusCycle();
  await testEnhancementVersusRewardUpdate();
  await testCycleVersusCycleAcrossTabs();
  await testRewardUpdatesAcrossTabs();
  console.log('foundation writer concurrency: 4/4 passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
