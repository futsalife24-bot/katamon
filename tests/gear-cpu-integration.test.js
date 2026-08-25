const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const canvas = harness.canvas;
const win = globalThis.window;
const storage = globalThis.localStorage;
const gearDomain = globalThis.KatamonGearDomain;
const gearStorage = globalThis.KatamonGearStorage;
const runStorage = globalThis.KatamonGearCpuRunStorage;
const transactions = globalThis.KatamonGearTransactions;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.error(`  NG   ${name}`); throw error; }
}

function resetFixture() {
  storage.clear();
  kt.setHasSave(false);
  kt.setPhase('title');
}

function settleEndPause() {
  let ticks = 0;
  while (kt.endPause() > 0 && ticks++ < 600) kt.step(1 / 60);
  assert.ok(ticks < 600, 'result end pause must finish');
}

function finishByDefeat(unitId) {
  kt.setUnitHpForTest(unitId, 0);
  kt.checkMatchEndForTest();
  settleEndPause();
  return kt.state().winner;
}

function installImmediateWebLocks() {
  const previous = globalThis.navigator.locks;
  const manager = {
    request: (name, options, callback) => {
      assert.ok(
        name === 'katamon_gear_v1:mutation' || name === runStorage.CPU_GEAR_RUN_LOCK_NAME,
        `unexpected lock ${name}`
      );
      assert.deepEqual(options, { mode: 'exclusive' });
      return callback({ name });
    },
  };
  const previousStorageManager = storage.gearMutationLockManager;
  globalThis.navigator.locks = manager;
  // The Node harness is deliberately not a browser window, so the production
  // module requires an explicit injected manager just like its other Node
  // tests.  Browser production resolves navigator.locks directly.
  storage.gearMutationLockManager = manager;
  return () => {
    globalThis.navigator.locks = previous;
    if (previousStorageManager === undefined) delete storage.gearMutationLockManager;
    else storage.gearMutationLockManager = previousStorageManager;
  };
}

function installDeferredCpuRunLocks() {
  const previous = globalThis.navigator.locks;
  const queue = [];
  globalThis.navigator.locks = {
    request(name, options, callback) {
      assert.equal(name, runStorage.CPU_GEAR_RUN_LOCK_NAME);
      assert.deepEqual(options, { mode: 'exclusive' });
      return new Promise((resolve, reject) => queue.push({ callback, resolve, reject }));
    },
  };
  return {
    pendingCount: () => queue.length,
    async grantNext() {
      const entry = queue.shift();
      assert.ok(entry, 'a queued CPU Gear lifecycle write is required');
      try { entry.resolve(await entry.callback({ name: runStorage.CPU_GEAR_RUN_LOCK_NAME })); }
      catch (error) { entry.reject(error); }
      await Promise.resolve();
      await Promise.resolve();
    },
    restore() { globalThis.navigator.locks = previous; },
  };
}

function installDeferredGearWriterLock() {
  const previousStorageManager = storage.gearMutationLockManager;
  let pending = null;
  storage.gearMutationLockManager = {
    request(name, options, callback) {
      assert.equal(name, 'katamon_gear_v1:mutation');
      assert.deepEqual(options, { mode: 'exclusive' });
      return new Promise((resolve, reject) => {
        assert.equal(pending, null, 'this fixture expects exactly one queued Gear writer');
        pending = { callback, resolve, reject };
      });
    },
  };
  return {
    pending: () => pending !== null,
    async grant() {
      const entry = pending;
      assert.ok(entry, 'a Gear writer must be waiting');
      pending = null;
      try {
        entry.resolve(await entry.callback({ name: 'katamon_gear_v1:mutation' }));
      } catch (error) {
        entry.reject(error);
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    restore() {
      if (previousStorageManager === undefined) delete storage.gearMutationLockManager;
      else storage.gearMutationLockManager = previousStorageManager;
    },
  };
}

async function settleAndFlush(outcome) {
  const result = await kt.requestCpuGearSettlementForTest(outcome);
  await Promise.resolve();
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeGateFixtureGear(gearId) {
  return gearDomain.createGear({
    gearId,
    generationSeed: `cpu-gate:${gearId}:generation`,
    enhancementSeed: `cpu-gate:${gearId}:enhancement`,
    sourceId: 'cpu_battle',
    sourceDetail: { fixture: 'phase2c-gate' },
    acquiredAt: '2026-08-26T00:00:00.000Z',
    qualityProfile: { id: 'cpu-gate-quality', starWeights: [{ id: 4, weight: 1 }], rarityWeights: [{ id: 'rare', weight: 1 }] },
    setProfile: { id: 'cpu-gate-uniform', setWeights: [{ id: 'assault', weight: 1 }] },
    slotId: 'engine',
  });
}

let fullPhysicalGateStateCache = null;
function createFullPhysicalGateState() {
  if (!fullPhysicalGateStateCache) {
    const state = gearStorage.createDefaultGearStorageState();
    state.inventory = Array.from({ length: 500 }, (_unused, index) => ({
      gear: makeGateFixtureGear(`gate-inventory-${index}`), locked: false, favorite: false,
    }));
    state.tempBox = Array.from({ length: 50 }, (_unused, index) => ({
      gear: makeGateFixtureGear(`gate-temp-${index}`), locked: false, favorite: false, enteredAtMs: index,
    }));
    fullPhysicalGateStateCache = state;
  }
  return clone(fullPhysicalGateStateCache);
}

function createUnclaimedFullGateState() {
  const state = gearStorage.createDefaultGearStorageState();
  state.unclaimedRewards = Array.from({ length: 10 }, (_unused, index) => ({
    rewardId: `phase2c-gate-pending-${index}`,
    sourceId: 'cpu_battle',
    sourceDetail: { fixture: 'unclaimed-full', index },
    createdAtMs: index,
    gears: [],
    blueprintShards: 0,
  }));
  return state;
}

(async () => {
  await test('新規CPU 1v1はcrypto runIdを直ちに永続化し、Gearを事前生成しない', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    const run = kt.cpuGearRunStateForTest();
    assert.equal(run.state, 'active');
    assert.match(run.runId, /^cpu-run:[0-9a-f-]{36}$/i);
    assert.equal(run.peakStreak, 0);
    assert.equal(run.settlementIntent, null);
    const state = gearStorage.loadGearState(storage);
    assert.equal(state.unclaimedRewards.length, 0);
    assert.equal(state.inventory.length, 0);
  });

  await test('Gear対象CPU runではRキーが中盤・勝利結果の旧reset経路を迂回しない', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    const midRun = kt.cpuGearRunStateForTest();
    const midRaw = storage.getItem('katamon_suspend_v1');
    win.__fire('keydown', { key: 'r' });
    assert.equal(kt.state().matchOver, false);
    assert.deepEqual(kt.cpuGearRunStateForTest(), midRun);
    assert.equal(storage.getItem('katamon_suspend_v1'), midRaw);

    assert.equal(finishByDefeat('e1'), 'player');
    const resultRun = kt.cpuGearRunStateForTest();
    win.__fire('keydown', { key: 'R' });
    assert.equal(kt.state().matchOver, true, 'result R must not bypass guarded continue');
    assert.deepEqual(kt.cpuGearRunStateForTest(), resultRun);
  });

  await test('開始直後のlegacy suspend保存失敗はactive runを安全にcleanupし、次の出撃を妨げない', () => {
    resetFixture();
    const originalSet = storage.setItem;
    let failOnce = true;
    storage.setItem = (key, value) => {
      if (failOnce && key === 'katamon_suspend_v1') {
        failOnce = false;
        throw new Error('initial legacy suspend write failed');
      }
      return originalSet(key, value);
    };
    try {
      assert.equal(kt.startBattle(), false);
    } finally {
      storage.setItem = originalSet;
    }
    assert.equal(kt.cpuGearRunStateForTest(), null, 'a proven-unstarted run must be removed');
    assert.equal(kt.suspendedSavePresentForTest(), false);
    assert.equal(kt.startBattle(), true, 'retry starts one new durable CPU run');
    assert.equal(kt.cpuGearRunStateForTest().state, 'active');
  });

  await test('initial suspend cleanup ambiguity never auto-overwrites an orphan; a later explicit retry may replace only that unstarted run', () => {
    resetFixture();
    const originalSet = storage.setItem;
    const originalRemove = storage.removeItem;
    let failSuspend = true;
    let failRunCleanup = true;
    storage.setItem = (key, value) => {
      if (failSuspend && key === 'katamon_suspend_v1') {
        failSuspend = false;
        throw new Error('initial legacy suspend write failed');
      }
      return originalSet(key, value);
    };
    storage.removeItem = (key) => {
      if (failRunCleanup && key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) {
        failRunCleanup = false;
        throw new Error('run cleanup ambiguous');
      }
      return originalRemove(key);
    };
    try {
      assert.equal(kt.startBattle(), false);
    } finally {
      storage.setItem = originalSet;
      storage.removeItem = originalRemove;
    }
    const orphan = kt.cpuGearRunStateForTest();
    assert.equal(orphan.state, 'active');
    assert.equal(orphan.peakStreak, 0);
    assert.equal(kt.suspendedSavePresentForTest(), false);
    // First later tap only records the explicit acknowledgement and exposes
    // the orphan status; it does not silently overwrite a state of unknown
    // cleanup outcome.
    assert.equal(kt.startBattle(), false);
    assert.deepEqual(kt.cpuGearRunStateForTest(), orphan);
    // The following explicit retry is now allowed to replace precisely this
    // no-snapshot, peak-zero state with a fresh run identity.
    assert.equal(kt.startBattle(), true);
    const fresh = kt.cpuGearRunStateForTest();
    assert.equal(fresh.state, 'active');
    assert.notEqual(fresh.runId, orphan.runId);
    assert.ok(kt.suspendedSavePresentForTest());
  });

  await test('勝利はpeakを更新し、通常のsuspend/reloadで同じrunIdを維持する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(14);
    assert.equal(finishByDefeat('e1'), 'player');
    const before = kt.cpuGearRunStateForTest();
    assert.equal(before.state, 'active');
    assert.equal(before.peakStreak, 15);
    const legacy = kt.buildSnapshotForTest();
    assert.equal(legacy.winStreak, 15);
    assert.equal(kt.save(), true);
    kt.resumeCpuSuspendForTest();
    const restored = kt.cpuGearRunStateForTest();
    assert.equal(restored.state, 'active');
    assert.equal(restored.peakStreak, 15);
    assert.equal(restored.runId, before.runId);
    const sameAfterReload = kt.cpuGearRunStateForTest();
    assert.deepEqual(sameAfterReload, restored);
  });

  await test('旧legacy suspendにrun stateが無い時だけ、現行streakからrunIdを一度だけ移行する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(14);
    assert.equal(finishByDefeat('e1'), 'player');
    assert.equal(kt.save(), true);
    // Pre-owner-fencing legacy suspends had no ownership hint at all.  A
    // modern owned snapshot without its run state is intentionally rejected
    // instead of recreating a potentially stale branch.
    const legacyRaw = JSON.parse(storage.getItem('katamon_suspend_v1'));
    delete legacyRaw.cpuGearOwnerSessionId;
    storage.setItem('katamon_suspend_v1', JSON.stringify(legacyRaw));
    assert.equal(kt.clearCpuGearRunForTest(), true);
    kt.resumeCpuSuspendForTest();
    const migrated = kt.cpuGearRunStateForTest();
    assert.equal(migrated.state, 'active');
    assert.equal(migrated.peakStreak, 15);
    const afterRead = kt.cpuGearRunStateForTest();
    assert.deepEqual(afterRead, migrated);
  });

  await test('敗北はGear未生成のsettlement intentだけを残し、新runを遮断する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(15);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const run = kt.cpuGearRunStateForTest();
    assert.equal(run.state, 'settlement_pending');
    assert.equal(run.peakStreak, 15);
    assert.equal(run.settlementIntent.outcome, 'defeat');
    assert.equal(run.settlementIntent.qualityProfileId, 'cpu-streak-10');
    assert.equal(run.settlementIntent.gearCount, 2);
    assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
    assert.equal(kt.startBattle(), false);
    const layout = kt.cpuGearResultLayoutForTest();
    assert.equal(layout.pending, true);
    assert.equal(layout.preview.qualityProfileId, 'cpu-streak-10');
    assert.equal(layout.preview.gearCount, 2);
  });

  await test('タイトルへ戻ったpending entitlementはCPU入口から最小精算画面へ復帰できる', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(15);
    assert.equal(finishByDefeat('p1'), 'cpu');
    // 結果画面を閉じてもintentは消えず、タイトルのCPU入口が新runではなく
    // pending settlement screenを選ぶ。画面は最小テキストだけでGear UIを作らない。
    kt.setPhase('title');
    assert.equal(kt.activateTitleCpuForTest(), true);
    assert.equal(kt.phase(), 'cpuGearSettlement');
    const layout = kt.cpuGearPendingSettlementLayoutForTest();
    assert.equal(layout.preview.peakStreak, 15);
    assert.equal(layout.preview.qualityProfileId, 'cpu-streak-10');
    kt.resetDrawnText();
    kt.render();
    assert.ok(kt.drawnText().includes('未精算のCPU BATTLE報酬'));
    assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
  });

  await test('terminal intent保存失敗は連勝・ranking確定を保留し、結果画面で同じ権利を再試行できる', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(15);
    const originalSet = storage.setItem;
    let failOnce = true;
    storage.setItem = (key, value) => {
      if (failOnce && key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) {
        failOnce = false;
        throw new Error('intent write failed once');
      }
      return originalSet(key, value);
    };
    try {
      assert.equal(finishByDefeat('p1'), 'cpu');
    } finally {
      storage.setItem = originalSet;
    }
    // No intent means no queue and no destructive terminal bookkeeping yet.
    assert.equal(kt.streak(), 15);
    assert.equal(kt.cpuGearRunStateForTest().state, 'active');
    assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
    const retry = kt.cpuGearTerminalSettlementRetryLayoutForTest();
    assert.equal(retry.outcome, 'defeat');
    assert.equal(retry.preview.qualityProfileId, 'cpu-streak-10');
    assert.equal(kt.retryCpuGearTerminalSettlementPreparationForTest(), true);
    assert.equal(kt.streak(), 0);
    assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
    assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
  });

  await test('pending intentのread失敗は旧結果ボタンへfallthroughせず、no-write再確認を要求する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const originalGet = storage.getItem;
    storage.getItem = (key) => {
      if (key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) throw new Error('run storage temporarily unreadable');
      return originalGet(key);
    };
    try {
      assert.equal(kt.cpuGearResultLayoutForTest(), null);
      assert.ok(kt.cpuGearTerminalSettlementReadErrorLayoutForTest());
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
    } finally {
      storage.getItem = originalGet;
    }
    assert.equal(kt.retryCpuGearTerminalSettlementReadForTest(), true);
    assert.equal(kt.cpuGearResultLayoutForTest().pending, true);
  });

  await test('勝利結果でもrun state読取不能なら旧「次のバトルへ」へfallthroughせずretry-onlyになる', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    assert.equal(finishByDefeat('e1'), 'player');
    const originalGet = storage.getItem;
    storage.getItem = (key) => {
      if (key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) throw new Error('run storage temporarily unreadable');
      return originalGet(key);
    };
    try {
      assert.equal(kt.cpuGearResultLayoutForTest(), null);
      assert.ok(kt.cpuGearTerminalSettlementReadErrorLayoutForTest());
      const legacyContinue = kt.continueBtn();
      canvas.__fire('pointerdown', {
        pointerId: 731, clientX: legacyContinue.x, clientY: legacyContinue.y + legacyContinue.shift,
        pointerType: 'mouse', button: 0, timeStamp: 731,
      });
      assert.equal(kt.state().matchOver, true, 'unreadable run state must never begin the old generic rematch');
    } finally {
      storage.getItem = originalGet;
    }
    assert.equal(kt.retryCpuGearTerminalSettlementReadForTest(), true);
    assert.ok(kt.cpuGearResultLayoutForTest()?.voluntary);
  });

  await test('run stateの一度だけの読取失敗でも同じ入力中に再読せず旧continueへfallthroughしない', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    assert.equal(finishByDefeat('e1'), 'player');
    let cutInTicks = 0;
    while (kt.hasCutIn() && cutInTicks++ < 600) kt.step(1 / 60);
    assert.ok(cutInTicks < 600, 'the result input test must wait for the existing start cut-in');
    const originalGet = storage.getItem;
    let runReads = 0;
    storage.getItem = (key) => {
      if (key === runStorage.CPU_GEAR_RUN_STORAGE_KEY && runReads++ === 0) {
        throw new Error('run storage transient one-shot read failure');
      }
      return originalGet(key);
    };
    try {
      const legacyContinue = kt.continueBtn();
      canvas.__fire('pointerdown', {
        pointerId: 732, clientX: legacyContinue.x, clientY: legacyContinue.y + legacyContinue.shift,
        pointerType: 'mouse', button: 0, timeStamp: 732,
      });
      assert.equal(runReads, 1, 'the result input must not retry the same state read before choosing retry-only UI');
      assert.equal(kt.state().matchOver, true, 'one-shot read failure must still block the old generic rematch');
    } finally {
      storage.getItem = originalGet;
    }
    assert.ok(kt.cpuGearResultLayoutForTest()?.voluntary);
  });

  await test('引き分けはCPU normal 1v1だけdefeat側intentへ確定し、連勝を終了する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(15);
    kt.setUnitHpForTest('p1', 0);
    assert.equal(finishByDefeat('e1'), 'draw');
    const run = kt.cpuGearRunStateForTest();
    assert.equal(run.state, 'settlement_pending');
    assert.equal(run.settlementIntent.outcome, 'draw');
    assert.equal(run.settlementIntent.qualityProfileId, 'cpu-streak-10');
    assert.equal(kt.streak(), 0);
    assert.equal(kt.keepsRunOnExit(), false);
    assert.equal(kt.pendingScoreForTest(), null, 'terminal Gear draw must not change existing ranking submission behavior');
  });

  await test('勝利結果のpreviewはGearを生成せず、自主精算品質と次戦敗北時品質を併記する', () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(14);
    assert.equal(finishByDefeat('e1'), 'player');
    const layout = kt.cpuGearResultLayoutForTest();
    assert.equal(layout.voluntary, true);
    assert.equal(layout.preview.peakStreak, 15);
    assert.equal(layout.preview.qualityProfileId, 'cpu-streak-15');
    assert.equal(layout.lossPreview.qualityProfileId, 'cpu-streak-10');
    assert.equal(layout.lossPreview.qualityTier, 10);
    assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
    kt.resetDrawnText();
    kt.render();
    assert.ok(kt.drawnText().includes('いま負けた場合: 品質10'));
  });

  await test('勝利直後にタイトルへ戻ってもnative CPU lock待ちのpeakと次戦suspendが確定してから遷移する', async () => {
    resetFixture();
    const restoreImmediate = installImmediateWebLocks();
    try { assert.equal(kt.startBattle(), true); }
    finally { restoreImmediate(); }
    const initialRun = kt.cpuGearRunStateForTest();
    const deferred = installDeferredCpuRunLocks();
    try {
      assert.equal(finishByDefeat('e1'), 'player');
      assert.equal(deferred.pendingCount(), 1, 'the just-won peak must be queued first');
      const suspend = kt.suspendRunToTitleForTest();
      assert.ok(suspend && typeof suspend.then === 'function');
      assert.equal(deferred.pendingCount(), 2, 'title suspend must queue behind the peak write');
      assert.equal(kt.phase(), 'battle', 'the result must stay active until both durable writes finish');

      await deferred.grantNext();
      assert.equal(kt.phase(), 'battle');
      assert.equal(kt.cpuGearRunStateForTest().peakStreak, 1);
      await deferred.grantNext();
      assert.equal(await suspend, true);

      const resumed = kt.loadSuspendedForTest();
      assert.equal(kt.phase(), 'title');
      assert.ok(resumed, 'the next-round legacy suspend must exist before title transition');
      assert.equal(resumed.winStreak, 1);
      assert.equal(kt.cpuGearRunStateForTest().runId, initialRun.runId);
      assert.equal(kt.cpuGearRunStateForTest().peakStreak, 1);
    } finally { deferred.restore(); }
  });

  await test('自主精算はqueue成功後だけrunを終了し、CPU 20到達の満額を一度だけ保存する', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(19);
    assert.equal(finishByDefeat('e1'), 'player');
    const restoreLocks = installImmediateWebLocks();
    try {
      const result = await settleAndFlush('voluntary');
      assert.equal(result.intent.peakStreak, 20);
      assert.equal(result.intent.qualityProfileId, 'cpu-streak-15');
      assert.equal(result.reward.gears.length, 3);
      assert.equal(result.reward.blueprintShards, 30);
      assert.equal(kt.cpuGearRunStateForTest(), null);
      const state = gearStorage.loadGearState(storage);
      assert.equal(state.unclaimedRewards.length, 1);
      assert.equal(state.unclaimedRewards[0].rewardId, result.intent.rewardId);
      assert.equal(state.unclaimedRewards[0].gears.length, 3);
      assert.equal(state.unclaimedRewards[0].blueprintShards, 30);
    } finally { restoreLocks(); }
  });

  await test('0〜2連勝の自主精算は空rewardとledgerを作らず、runだけを安全に終了する', async () => {
    const restoreLocks = installImmediateWebLocks();
    try {
      for (const peakStreak of [0, 1, 2]) {
        resetFixture();
        assert.equal(kt.startBattle(), true);
        kt.setStreak(peakStreak);
        const result = await settleAndFlush('voluntary');
        assert.equal(result.intent.peakStreak, peakStreak);
        assert.equal(result.intent.gearCount, 0);
        assert.equal(result.intent.blueprintShards, 0);
        assert.equal(result.reward.gears.length, 0);
        assert.equal(result.reward.blueprintShards, 0);
        assert.equal(result.queueResult.skippedEmptyReward, true);
        assert.equal(kt.cpuGearRunStateForTest(), null);
        const state = gearStorage.loadGearState(storage);
        assert.equal(state.unclaimedRewards.length, 0);
        assert.deepEqual(state.rewardLedger, {});
      }
    } finally { restoreLocks(); }
  });

  await test('自主精算のGear queue中は次戦開始を遮断し、pending intentを持つrunを壊さない', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(14);
    assert.equal(finishByDefeat('e1'), 'player');
    const restoreLocks = installImmediateWebLocks();
    const deferredGearWriter = installDeferredGearWriterLock();
    try {
      const settlement = kt.requestCpuGearSettlementForTest('voluntary');
      assert.ok(settlement && typeof settlement.then === 'function');
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(deferredGearWriter.pending(), 'Phase B queue must be in flight while the result remains actionable');
      const pending = kt.cpuGearRunStateForTest();
      assert.equal(pending.state, 'settlement_pending');
      assert.equal(kt.cpuGearResultActionBusyForTest(), true);

      assert.equal(kt.continueCpuGearRunAfterWinForTest(), false, 'continue must not reset into a new battle during Phase B');
      assert.deepEqual(kt.cpuGearRunStateForTest(), pending, 'the durable entitlement remains unchanged');
      assert.equal(kt.state().matchOver, true, 'the result view must remain until queue/cleanup succeeds');

      await deferredGearWriter.grant();
      await settlement;
      await Promise.resolve();
      assert.equal(kt.cpuGearRunStateForTest(), null);
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 1);
      assert.equal(kt.phase(), 'title');
    } finally {
      deferredGearWriter.restore();
      restoreLocks();
    }
  });

  await test('queue read-back ambiguous後も同一intentでretryし、Gearを二重queueしない', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(10);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const restoreLocks = installImmediateWebLocks();
    const originalGet = storage.getItem;
    const originalSet = storage.setItem;
    let mismatch = false;
    storage.setItem = (key, value) => {
      originalSet(key, value);
      if (key === gearStorage.GEAR_STORAGE_KEY) mismatch = true;
    };
    storage.getItem = (key) => (mismatch && key === gearStorage.GEAR_STORAGE_KEY
      ? `${originalGet(key)}#mismatch`
      : originalGet(key));
    try {
      await assert.rejects(() => settleAndFlush('defeat'));
      assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
    } finally {
      storage.setItem = originalSet;
      storage.getItem = originalGet;
    }
    try {
      await settleAndFlush('defeat');
      const state = gearStorage.loadGearState(storage);
      assert.equal(state.unclaimedRewards.length, 1);
      assert.equal(state.unclaimedRewards[0].gears.length, 2);
      assert.equal(kt.cpuGearRunStateForTest(), null);
    } finally { restoreLocks(); }
  });

  await test('queue後のrun cleanup失敗はpendingを残し、retryでduplicateを安全にcleanupする', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const restoreLocks = installImmediateWebLocks();
    const originalRemove = storage.removeItem;
    let failOnce = true;
    storage.removeItem = (key) => {
      if (failOnce && key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) {
        failOnce = false;
        throw new Error('cleanup failed once');
      }
      return originalRemove(key);
    };
    try {
      await assert.rejects(() => settleAndFlush('defeat'));
      assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 1);
    } finally { storage.removeItem = originalRemove; }
    try {
      await settleAndFlush('defeat');
      assert.equal(kt.cpuGearRunStateForTest(), null);
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 1);
    } finally { restoreLocks(); }
  });

  await test('pending WALはCPU queueを遮断し、recovery後の同一intent retryだけを許す', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const restoreLocks = installImmediateWebLocks();
    storage.setItem(transactions.GEAR_TRANSACTION_STORAGE_KEY, '{malformed-pending-wal');
    try {
      await assert.rejects(() => settleAndFlush('defeat'), (error) => error && error.code === 'PENDING_GEAR_TRANSACTION_EXISTS');
      assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 0);
    } finally { storage.removeItem(transactions.GEAR_TRANSACTION_STORAGE_KEY); }
    try {
      await settleAndFlush('defeat');
      assert.equal(kt.cpuGearRunStateForTest(), null);
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 1);
    } finally { restoreLocks(); }
  });

  await test('未受取10件満杯ではCPU精算intentを残し、空き後の同一rewardId retryだけを許す', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const intent = kt.cpuGearRunStateForTest().settlementIntent;
    gearStorage.saveGearState(createUnclaimedFullGateState(), storage);
    const restoreLocks = installImmediateWebLocks();
    try {
      await assert.rejects(() => settleAndFlush('defeat'), (error) => error && error.code === 'CPU_GEAR_REWARD_GATE_BLOCKED');
      assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
      assert.equal(gearStorage.loadGearState(storage).unclaimedRewards.length, 10);

      const opened = gearStorage.loadGearState(storage);
      opened.unclaimedRewards.pop();
      gearStorage.saveGearState(opened, storage);

      const result = await settleAndFlush('defeat');
      assert.equal(result.intent.rewardId, intent.rewardId);
      const after = gearStorage.loadGearState(storage);
      assert.equal(after.unclaimedRewards.length, 10);
      assert.equal(after.unclaimedRewards.filter((reward) => reward.rewardId === intent.rewardId).length, 1);
      assert.equal(kt.cpuGearRunStateForTest(), null);
    } finally { restoreLocks(); }
  });

  await test('inventory500かつTEMP50満杯ではCPU精算intentを残し、物理空き後だけqueueする', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(finishByDefeat('p1'), 'cpu');
    const intent = kt.cpuGearRunStateForTest().settlementIntent;
    gearStorage.saveGearState(createFullPhysicalGateState(), storage);
    const restoreLocks = installImmediateWebLocks();
    try {
      await assert.rejects(() => settleAndFlush('defeat'), (error) => error && error.code === 'CPU_GEAR_REWARD_GATE_BLOCKED');
      assert.equal(kt.cpuGearRunStateForTest().state, 'settlement_pending');
      const full = gearStorage.loadGearState(storage);
      assert.equal(full.inventory.length, 500);
      assert.equal(full.tempBox.length, 50);

      full.tempBox.pop();
      gearStorage.saveGearState(full, storage);

      const result = await settleAndFlush('defeat');
      assert.equal(result.intent.rewardId, intent.rewardId);
      const after = gearStorage.loadGearState(storage);
      assert.equal(after.unclaimedRewards.filter((reward) => reward.rewardId === intent.rewardId).length, 1);
      assert.equal(kt.cpuGearRunStateForTest(), null);
    } finally { restoreLocks(); }
  });

  await test('free trainingはCPU Gear runを作らない', () => {
    resetFixture();
    kt.startFree();
    assert.equal(kt.cpuGearRunStateForTest(), null);
  });

  await test('CPU Gear対象はnormal CPU 1v1だけで、free/tutorial/demo/2v2/online/coopを明示除外する', () => {
    resetFixture();
    kt.setBattleModeForTest('normal');
    kt.setMatchFormatForTest('1v1');
    kt.setOnlineForCpuGearEligibilityForTest(null);
    assert.equal(kt.cpuGearEligibleForTest(), true);

    for (const mode of ['free', 'tutorial', 'demo', 'coop']) {
      kt.setBattleModeForTest(mode);
      assert.equal(kt.cpuGearEligibleForTest(), false, `${mode} must never enter the CPU Gear lifecycle`);
    }
    kt.setBattleModeForTest('normal');
    kt.setMatchFormatForTest('2v2');
    assert.equal(kt.cpuGearEligibleForTest(), false, '2v2 must never enter the CPU Gear lifecycle');
    kt.setMatchFormatForTest('1v1');
    kt.setOnlineForCpuGearEligibilityForTest({ kind: 'firebase', role: 'host', phase: 'battle' });
    assert.equal(kt.cpuGearEligibleForTest(), false, 'online must never enter the CPU Gear lifecycle');
    kt.setOnlineForCpuGearEligibilityForTest(null);
    kt.setBattleModeForTest('normal');
  });

  console.log(`gear-cpu-integration: ${passed}/${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
