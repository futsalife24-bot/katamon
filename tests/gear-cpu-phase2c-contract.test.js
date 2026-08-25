const assert = require('node:assert/strict');

const gear = require('../shared/gear-domain.js');
const cpu = require('../shared/gear-cpu-rewards.js');
const run = require('../shared/gear-cpu-run-storage.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.error(`  NG   ${name}`); throw error; }
}
function expectCode(code, fn) {
  assert.throws(fn, (error) => error && error.code === code, `expected ${code}`);
}
function runId(index) {
  return `cpu-run:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('legacy CPU suspend snapshot migration contract retains its current streak as the durable peak exactly once', () => {
  const legacySnapshot = Object.freeze({ battleMode: 'normal', matchFormat: '1v1', winStreak: 14 });
  const storage = createMemoryStorage();
  const first = run.loadCpuGearRunState(storage)
    || run.saveCpuGearRunState(run.createActiveCpuGearRun(runId(1), legacySnapshot.winStreak), storage);
  // A reload/resume must read the already persisted identity instead of minting
  // another run ID from the old legacy snapshot.
  const second = run.loadCpuGearRunState(storage)
    || run.saveCpuGearRunState(run.createActiveCpuGearRun(runId(2), legacySnapshot.winStreak), storage);
  assert.deepEqual(second, first);
  assert.equal(second.peakStreak, 14);
  assert.equal(second.runId, runId(1));
});

test('peak is monotonic across a legacy-style resume and produces the loss downgrade only at 15–19', () => {
  const state = run.createActiveCpuGearRun(runId(3), 14);
  const afterWin = run.withPeakStreak(state, 15);
  assert.equal(run.withPeakStreak(afterWin, 0).peakStreak, 15);
  const defeat = cpu.createCpuSettlementIntent({
    runId: afterWin.runId, peakStreak: afterWin.peakStreak, outcome: 'defeat', settlementCreatedAtMs: 700,
  });
  assert.equal(defeat.qualityProfileId, 'cpu-streak-10');
  assert.equal(defeat.gearCount, 2);
  const locked = run.withSettlementIntent(afterWin, defeat);
  assert.equal(locked.state, run.SETTLEMENT_PENDING);
  assert.equal(locked.peakStreak, 15);
});

test('saved settlement intent is immutable across retry timestamps and retry outcomes', () => {
  const state = run.createActiveCpuGearRun(runId(4), 20);
  const firstIntent = cpu.createCpuSettlementIntent({
    runId: state.runId, peakStreak: 20, outcome: 'defeat', settlementCreatedAtMs: 1234,
  });
  const pending = run.withSettlementIntent(state, firstIntent);
  assert.deepEqual(run.withSettlementIntent(pending, JSON.parse(JSON.stringify(firstIntent))), pending);
  const changedTimestamp = cpu.createCpuSettlementIntent({
    runId: state.runId, peakStreak: 20, outcome: 'defeat', settlementCreatedAtMs: 1235,
  });
  const changedOutcome = cpu.createCpuSettlementIntent({
    runId: state.runId, peakStreak: 20, outcome: 'voluntary', settlementCreatedAtMs: 1234,
  });
  expectCode('CPU_GEAR_SETTLEMENT_CONFLICT', () => run.withSettlementIntent(pending, changedTimestamp));
  // At 20 the quality is locked, but outcome is still part of the immutable
  // entitlement and must not be silently substituted on retry.
  expectCode('CPU_GEAR_SETTLEMENT_CONFLICT', () => run.withSettlementIntent(pending, changedOutcome));
});

test('an intent survives JSON storage round-trip and materializes byte-for-byte deterministic gear identities', () => {
  const state = run.createActiveCpuGearRun(runId(5), 50);
  const pending = run.withSettlementIntent(state, cpu.createCpuSettlementIntent({
    runId: state.runId, peakStreak: 50, outcome: 'defeat', settlementCreatedAtMs: 987654,
  }));
  const storage = createMemoryStorage();
  run.saveCpuGearRunState(pending, storage);
  const restored = run.loadCpuGearRunState(storage);
  const one = cpu.materializeCpuGearReward(restored.settlementIntent);
  const two = cpu.materializeCpuGearReward(JSON.parse(JSON.stringify(restored.settlementIntent)));
  assert.deepEqual(two, one);
  assert.equal(one.gears.length, 5);
  one.gears.forEach((item, index) => {
    assert.equal(item.gearId, `cpu:${state.runId}:gear:${index}`);
    assert.equal(item.generationSeed, undefined, 'generationSeed must not enter persisted Gear objects');
    assert.equal(item.enhancementSeed, `cpu:${state.runId}:gear:${index}:enhancement:v1`);
    assert.equal(item.acquisition.acquiredAt, 987654);
  });
});

test('fixed deterministic CPU intent vectors eventually materialize all six production slots without test-only tuning', () => {
  const found = new Set();
  for (let index = 1; index <= 160 && found.size < gear.SLOT_IDS.length; index += 1) {
    const reward = cpu.materializeCpuGearReward(cpu.createCpuSettlementIntent({
      runId: runId(index + 100), peakStreak: 50, outcome: 'voluntary', settlementCreatedAtMs: 1,
    }));
    reward.gears.forEach((item) => {
      found.add(item.slotId);
      assert.doesNotThrow(() => gear.validateGear(item));
      if (['barrel', 'armor', 'core'].includes(item.slotId)) assert.ok(item.mainOp.value > 0);
    });
  }
  assert.deepEqual([...found].sort(), [...gear.SLOT_IDS].sort());
});

test('0–2 intent is preserved for retry/cleanup but does not materialize a meaningless queue envelope', () => {
  const state = run.createActiveCpuGearRun(runId(6), 2);
  const pending = run.withSettlementIntent(state, cpu.createCpuSettlementIntent({
    runId: state.runId, peakStreak: 2, outcome: 'voluntary', settlementCreatedAtMs: 0,
  }));
  const reward = cpu.materializeCpuGearReward(pending.settlementIntent);
  assert.equal(reward.gears.length, 0);
  assert.equal(reward.blueprintShards, 0);
  assert.equal(cpu.previewCpuSettlement({ peakStreak: 2, outcome: 'voluntary' }).hasReward, false);
});

console.log(`gear-cpu-phase2c-contract: ${passed}/${passed} passed`);
