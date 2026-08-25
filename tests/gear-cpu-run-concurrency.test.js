const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const runStorage = globalThis.KatamonGearCpuRunStorage;

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

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function createQueuedWebLocks() {
  const queue = [];
  return {
    request(name, options, callback) {
      assert.ok(
        name === runStorage.CPU_GEAR_RUN_LOCK_NAME,
        `CPU run lifecycle must use its one shared lock, got ${name}`
      );
      assert.deepEqual(options, { mode: 'exclusive' });
      return new Promise((resolve, reject) => queue.push({ name, callback, resolve, reject }));
    },
    pendingCount() { return queue.length; },
    async grantNext() {
      const entry = queue.shift();
      assert.ok(entry, 'a queued lock request is required');
      try {
        entry.resolve(await entry.callback({ name: entry.name }));
      } catch (error) {
        entry.reject(error);
      }
      // The browser-facing lifecycle deliberately observes native-lock
      // promises from pointer handlers.  Let those continuations settle.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function validRunId(suffix) {
  return `cpu-run:00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
}

function ownerSessionId(suffix) {
  return `cpu-session:00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
}

function installDeferredGearWriterLock() {
  const previous = storage.gearMutationLockManager;
  let pending = null;
  storage.gearMutationLockManager = {
    request(name, options, callback) {
      assert.equal(name, 'katamon_gear_v1:mutation');
      assert.deepEqual(options, { mode: 'exclusive' });
      return new Promise((resolve, reject) => { pending = { callback, resolve, reject }; });
    },
  };
  return {
    pending: () => pending !== null,
    async grant() {
      const entry = pending;
      assert.ok(entry, 'the Phase B Gear writer must be pending');
      pending = null;
      try { entry.resolve(await entry.callback({ name: 'katamon_gear_v1:mutation' })); }
      catch (error) { entry.reject(error); }
      await Promise.resolve();
      await Promise.resolve();
    },
    restore() {
      if (previous === undefined) delete storage.gearMutationLockManager;
      else storage.gearMutationLockManager = previous;
    },
  };
}

(async () => {
  await test('同一runのpeak更新はFIFO Web Lock内で直列化され、後続更新を失わない', async () => {
    const memory = createMemoryStorage();
    runStorage.saveCpuGearRunState(runStorage.createActiveCpuGearRun(validRunId(1), 0), memory);
    const locks = createQueuedWebLocks();

    const first = runStorage.withCpuGearRunLock(() => {
      const current = runStorage.loadCpuGearRunState(memory);
      return runStorage.saveCpuGearRunState(runStorage.withPeakStreak(current, 5), memory);
    }, { lockManager: locks });
    const second = runStorage.withCpuGearRunLock(() => {
      const current = runStorage.loadCpuGearRunState(memory);
      return runStorage.saveCpuGearRunState(runStorage.withPeakStreak(current, 8), memory);
    }, { lockManager: locks });

    assert.equal(locks.pendingCount(), 2);
    await locks.grantNext();
    assert.equal((await first).peakStreak, 5);
    assert.equal(runStorage.loadCpuGearRunState(memory).peakStreak, 5);
    await locks.grantNext();
    assert.equal((await second).peakStreak, 8);
    assert.equal(runStorage.loadCpuGearRunState(memory).peakStreak, 8);
  });

  await test('実際のCPU開始を同時に要求しても先行開始を共有し、run・suspend・battle画面を壊さない', async () => {
    resetFixture();
    const previousLocks = globalThis.navigator.locks;
    const locks = createQueuedWebLocks();
    globalThis.navigator.locks = locks;
    try {
      // Both taps happen while the first request is waiting for the CPU lock.
      // The second one must share the in-flight start rather than enqueue a
      // duplicate that later runs the old failure-to-title continuation.
      assert.equal(kt.startBattle(), true);
      assert.equal(kt.startBattle(), true);
      assert.equal(locks.pendingCount(), 1);

      await locks.grantNext();
      const firstRun = kt.cpuGearRunStateForTest();
      assert.equal(firstRun.state, 'active');
      assert.ok(kt.suspendedSavePresentForTest(), 'first start must preserve the existing suspend contract');
      assert.equal(kt.phase(), 'battle', 'the shared second tap must not send the successfully-started battle back to title');
      assert.deepEqual(kt.cpuGearRunStateForTest(), firstRun);
      assert.ok(kt.suspendedSavePresentForTest());
    } finally {
      globalThis.navigator.locks = previousLocks;
    }
  });

  await test('同一runtimeのresume二重tapは同じin-flight処理を共有し、snapshotを再適用しない', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    const originalRun = kt.cpuGearRunStateForTest();
    assert.ok(kt.suspendedSavePresentForTest());
    kt.setPhase('title');

    const previousLocks = globalThis.navigator.locks;
    const locks = createQueuedWebLocks();
    globalThis.navigator.locks = locks;
    try {
      // Both callbacks observe title before the first one owns the lock.  A
      // runtime-local promise must coalesce them, while a retained snapshot
      // remains available for a future crash/reload recovery.
      assert.equal(kt.resumeCpuSuspendForTest(), true);
      assert.equal(kt.resumeCpuSuspendForTest(), true);
      assert.equal(locks.pendingCount(), 1);

      await locks.grantNext();
      assert.equal(kt.phase(), 'battle');
      assert.equal(kt.suspendedSavePresentForTest(), true, 'first resume retains an owner-fenced recovery snapshot');
      assert.deepEqual(kt.cpuGearRunStateForTest(), originalRun);
      assert.equal(locks.pendingCount(), 0);
      assert.deepEqual(kt.cpuGearRunStateForTest(), originalRun, 'the second caller cannot mint/fork or replay a run');
    } finally {
      globalThis.navigator.locks = previousLocks;
    }
  });

  await test('別tabが同一legacy snapshotを観測しても、CAS rebind後は片方だけresumeできる', async () => {
    resetFixture();
    const ownerA = ownerSessionId(91);
    const ownerB = ownerSessionId(92);
    const ownerC = ownerSessionId(93);
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(kt.startBattle(), true);
    const observed = kt.captureCpuGearSuspendForTest();
    assert.ok(observed && observed.raw, 'both tabs begin from the same raw snapshot');
    kt.setPhase('title');

    kt.setCpuGearOwnerSessionForTest(ownerB);
    const first = await Promise.resolve(kt.claimCpuGearSuspendForTest(observed));
    assert.ok(first && first.cpuSnapshotClaimed);
    const rebound = JSON.parse(storage.getItem('katamon_suspend_v1'));
    assert.equal(rebound.cpuGearOwnerSessionId, ownerB);
    assert.notEqual(rebound.cpuGearSnapshotId, JSON.parse(observed.raw).cpuGearSnapshotId, 'successful rebind rotates the recovery snapshot token');

    kt.setCpuGearOwnerSessionForTest(ownerC);
    const stale = await Promise.resolve(kt.claimCpuGearSuspendForTest(observed));
    assert.equal(stale, null, 'the stale advisory bytes cannot take over the rebound snapshot');
    assert.equal(kt.cpuGearRunStateForTest().ownerSessionId, ownerB);
    assert.equal(storage.getItem('katamon_suspend_v1'), JSON.stringify(rebound));
  });

  await test('resume claim中に別tabのturn-start autosaveが新snapshotを書いた場合、古いsnapshotを復元も削除もしない', async () => {
    resetFixture();
    assert.equal(kt.startBattle(), true);
    const originalRun = kt.cpuGearRunStateForTest();
    const originalRaw = storage.getItem('katamon_suspend_v1');
    assert.ok(originalRaw, 'the resumable CPU snapshot must exist');
    const newerSnapshot = JSON.parse(originalRaw);
    newerSnapshot.turnCount = (Number.isSafeInteger(newerSnapshot.turnCount) ? newerSnapshot.turnCount : 0) + 1;
    const newerRaw = JSON.stringify(newerSnapshot);
    kt.setPhase('title');

    const previousLocks = globalThis.navigator.locks;
    const originalGet = storage.getItem;
    const originalSet = storage.setItem;
    const locks = createQueuedWebLocks();
    globalThis.navigator.locks = locks;
    let injectNewerAutosave = false;
    storage.getItem = (key) => {
      const value = originalGet(key);
      if (injectNewerAutosave && key === 'katamon_suspend_v1') {
        injectNewerAutosave = false;
        // Return raw A to the claim decoder, then emulate a turn-start writer
        // committing raw B before the compare-and-delete step.
        originalSet(key, newerRaw);
      }
      return value;
    };
    try {
      assert.equal(kt.resumeCpuSuspendForTest(), true);
      assert.equal(locks.pendingCount(), 1);
      injectNewerAutosave = true;
      await locks.grantNext();

      assert.equal(kt.phase(), 'title', 'the stale decoded snapshot must never be restored after a raw conflict');
      assert.equal(originalGet('katamon_suspend_v1'), newerRaw, 'the newer autosave remains the sole resumable snapshot');
      assert.deepEqual(kt.cpuGearRunStateForTest(), originalRun, 'the failed claim must not fork or replace run identity');
      assert.ok(kt.suspendedSavePresentForTest());
    } finally {
      storage.getItem = originalGet;
      storage.setItem = originalSet;
      globalThis.navigator.locks = previousLocks;
    }
  });

  await test('active runを別tabでresumeした後、古いownerはautosave・peak・continue・terminal intentを変更できない', async () => {
    resetFixture();
    const ownerA = ownerSessionId(101);
    const ownerB = ownerSessionId(102);
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(kt.startBattle(), true);
    const rawA = JSON.parse(storage.getItem('katamon_suspend_v1'));
    assert.equal(rawA.cpuGearOwnerSessionId, ownerA);
    kt.setPhase('title');

    // This is a separate browser runtime: it obtains a distinct volatile
    // owner session and explicitly claims the exact A-owned resume snapshot.
    kt.setCpuGearOwnerSessionForTest(ownerB);
    assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), true);
    assert.equal(kt.cpuGearRunStateForTest().ownerSessionId, ownerB);
    assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true);
    const rawB = storage.getItem('katamon_suspend_v1');
    assert.equal(JSON.parse(rawB).cpuGearOwnerSessionId, ownerB);

    // A late original tab must be fenced at every durable lifecycle boundary.
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(await Promise.resolve(kt.saveCpuBattleAtTurnStartForTest()), false);
    assert.equal(await Promise.resolve(kt.recordCpuGearPeakAfterWinForTest()), false);
    assert.equal(await Promise.resolve(kt.continueCpuGearRunAfterWinForTest()), false);
    assert.equal(await Promise.resolve(kt.prepareCpuGearSettlementForTerminalOutcomeForTest('defeat')), false);
    assert.equal(storage.getItem('katamon_suspend_v1'), rawB, 'late autosave must not erase or replace B snapshot');
    const retained = kt.cpuGearRunStateForTest();
    assert.equal(retained.state, 'active');
    assert.equal(retained.ownerSessionId, ownerB);
  });

  await test('Phase B中のpending settlementを新ownerがtakeoverすると旧owner cleanupは拒否され、新owner retryは1回だけ完了する', async () => {
    resetFixture();
    const ownerA = ownerSessionId(201);
    const ownerB = ownerSessionId(202);
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(kt.startBattle(), true);
    kt.setStreak(3);
    assert.equal(await Promise.resolve(kt.recordCpuGearPeakAfterWinForTest()), true);

    const writer = installDeferredGearWriterLock();
    try {
      const oldOwnerSettlement = kt.requestCpuGearSettlementForTest('voluntary');
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(writer.pending(), 'Phase B must be waiting on the Gear writer');
      const pending = kt.cpuGearRunStateForTest();
      assert.equal(pending.state, 'settlement_pending');
      assert.equal(pending.ownerSessionId, ownerA);

      // Model the explicit pending-settlement action from another tab.  It
      // changes only the fencing token, never the intent/reward identity.
      runStorage.saveCpuGearRunState(runStorage.withOwnerSessionId(pending, ownerB), storage);
      kt.setCpuGearOwnerSessionForTest(ownerB);
      await writer.grant();
      await assert.rejects(oldOwnerSettlement, (error) => error && error.code === 'CPU_GEAR_RUN_OWNERSHIP_LOST');
      assert.equal(kt.cpuGearRunStateForTest().ownerSessionId, ownerB);
    } finally {
      writer.restore();
    }

    await Promise.resolve();
    const completed = await kt.requestCpuGearSettlementForTest('voluntary');
    assert.equal(completed.reward.rewardId.includes('cpu:'), true);
    assert.equal(kt.cpuGearRunStateForTest(), null);
    const state = globalThis.KatamonGearStorage.loadGearState(storage);
    assert.equal(state.unclaimedRewards.length, 1, 'the retry queues one deterministic reward, not two');
    assert.equal(state.unclaimedRewards[0].rewardId, completed.intent.rewardId);
  });

  await test('active resumeのlegacy rebindがwrite前に失敗しても、resume markerから同じsnapshotだけforward recoveryする', async () => {
    resetFixture();
    const ownerA = ownerSessionId(301);
    const ownerB = ownerSessionId(302);
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(kt.startBattle(), true);
    const rawA = storage.getItem('katamon_suspend_v1');
    const initialRun = kt.cpuGearRunStateForTest();
    kt.setPhase('title');
    kt.setCpuGearOwnerSessionForTest(ownerB);

    const originalSet = storage.setItem;
    let failRebind = true;
    storage.setItem = (key, value) => {
      if (failRebind && key === 'katamon_suspend_v1') {
        failRebind = false;
        throw new Error('legacy rebind blocked before write');
      }
      return originalSet(key, value);
    };
    try {
      assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), false);
      const interrupted = kt.cpuGearRunStateForTest();
      assert.equal(interrupted.ownerSessionId, ownerB, 'old owner is fenced before the legacy raw transition');
      assert.ok(interrupted.resumeClaim, 'the small forward-recovery marker remains durable');
      assert.equal(storage.getItem('katamon_suspend_v1'), rawA, 'the old raw is retained, never silently deleted');
    } finally {
      storage.setItem = originalSet;
    }

    assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), true);
    const recovered = kt.cpuGearRunStateForTest();
    assert.equal(recovered.runId, initialRun.runId);
    assert.equal(recovered.ownerSessionId, ownerB);
    assert.equal(recovered.resumeClaim, null);
  });

  await test('ownerless legacy suspendのnew run作成後にrebindが失敗しても、一度だけ同じrunを復旧する', async () => {
    resetFixture();
    const ownerA = ownerSessionId(311);
    const ownerB = ownerSessionId(312);
    kt.setCpuGearOwnerSessionForTest(ownerA);
    assert.equal(kt.startBattle(), true);
    const legacy = JSON.parse(storage.getItem('katamon_suspend_v1'));
    delete legacy.cpuGearOwnerSessionId;
    delete legacy.cpuGearSnapshotId;
    storage.setItem('katamon_suspend_v1', JSON.stringify(legacy));
    assert.equal(kt.clearCpuGearRunForTest(), true);
    kt.setPhase('title');
    kt.setCpuGearOwnerSessionForTest(ownerB);

    const originalSet = storage.setItem;
    let failRebind = true;
    storage.setItem = (key, value) => {
      if (failRebind && key === 'katamon_suspend_v1') {
        failRebind = false;
        throw new Error('legacy migration rebind blocked');
      }
      return originalSet(key, value);
    };
    let interruptedRunId;
    try {
      assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), false);
      const interrupted = kt.cpuGearRunStateForTest();
      interruptedRunId = interrupted.runId;
      assert.equal(interrupted.ownerSessionId, ownerB);
      assert.ok(interrupted.resumeClaim);
    } finally {
      storage.setItem = originalSet;
    }

    assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), true);
    const recovered = kt.cpuGearRunStateForTest();
    assert.equal(recovered.runId, interruptedRunId, 'retry must not mint a second legacy runId');
    assert.equal(recovered.ownerSessionId, ownerB);
    assert.equal(recovered.resumeClaim, null);
  });

  await test('legacy rebindのwrite成功後read-back throw/mismatchもmarkerから同じsnapshotへ再試行できる', async () => {
    for (const mode of ['throw', 'mismatch']) {
      resetFixture();
      const ownerA = ownerSessionId(mode === 'throw' ? 321 : 331);
      const ownerB = ownerSessionId(mode === 'throw' ? 322 : 332);
      kt.setCpuGearOwnerSessionForTest(ownerA);
      assert.equal(kt.startBattle(), true);
      const initialRun = kt.cpuGearRunStateForTest();
      kt.setPhase('title');
      kt.setCpuGearOwnerSessionForTest(ownerB);

      const originalSet = storage.setItem;
      const originalGet = storage.getItem;
      let rebindWritten = false;
      let failReadBack = true;
      storage.setItem = (key, value) => {
        originalSet(key, value);
        if (key === 'katamon_suspend_v1') rebindWritten = true;
      };
      storage.getItem = (key) => {
        if (rebindWritten && failReadBack && key === 'katamon_suspend_v1') {
          failReadBack = false;
          if (mode === 'throw') throw new Error('legacy rebind read-back unavailable');
          return 'different-legacy-raw';
        }
        return originalGet(key);
      };
      try {
        assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), false, `${mode} read-back must leave a recoverable marker`);
        const interrupted = kt.cpuGearRunStateForTest();
        assert.equal(interrupted.ownerSessionId, ownerB);
        assert.ok(interrupted.resumeClaim);
      } finally {
        storage.setItem = originalSet;
        storage.getItem = originalGet;
      }

      assert.equal(await Promise.resolve(kt.resumeCpuSuspendForTest()), true, `${mode} recovery retry`);
      const recovered = kt.cpuGearRunStateForTest();
      assert.equal(recovered.runId, initialRun.runId);
      assert.equal(recovered.ownerSessionId, ownerB);
      assert.equal(recovered.resumeClaim, null);
    }
  });

  await test('Web Locks非対応では実CPU Gear開始をfail closedし、run/suspendを作らない', () => {
    resetFixture();
    const previousLocks = globalThis.navigator.locks;
    globalThis.navigator.locks = undefined;
    try {
      assert.equal(kt.startBattle(), false);
      assert.equal(kt.cpuGearRunStateForTest(), null);
      assert.equal(kt.suspendedSavePresentForTest(), false);
      assert.equal(kt.cpuGearPersistenceForTest().state, 'ready', 'lock non-support must not erase the completed startup recovery state');
    } finally {
      globalThis.navigator.locks = previousLocks;
    }
  });

  console.log(`gear-cpu-run-concurrency: ${passed}/${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
