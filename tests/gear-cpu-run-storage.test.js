const assert = require('node:assert/strict');
const cpu = require('../shared/gear-cpu-rewards.js');
const run = require('../shared/gear-cpu-run-storage.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.error(`  NG   ${name}`); throw error; }
}
function expectCode(code, fn) { assert.throws(fn, (error) => error && error.code === code, `expected ${code}`); }
function validRunId(suffix = '00000000-0000-4000-8000-000000000001') { return `cpu-run:${suffix}`; }
function validOwnerId(suffix = '00000000-0000-4000-8000-000000000001') { return `cpu-session:${suffix}`; }
function active(peakStreak = 0, suffix, ownerSessionId = null) { return run.createActiveCpuGearRun(validRunId(suffix), peakStreak, ownerSessionId); }
function intent(state, outcome = 'voluntary', at = 100, stageItemPowder = 0, stageItemBlueprintShards = 0) {
  return cpu.createCpuSettlementIntent({ runId: state.runId, peakStreak: state.peakStreak, outcome, settlementCreatedAtMs: at, stageItemPowder, stageItemBlueprintShards });
}
function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    raw(key) { return values.has(key) ? values.get(key) : null; },
  };
}

test('新規active runはcrypto UUID・peak・null intentの厳格形を持つ', () => {
  const state = active(3);
  assert.equal(state.schemaVersion, 2); assert.equal(state.state, run.ACTIVE);
  assert.equal(state.peakStreak, 3); assert.equal(state.settlementIntent, null);
  assert.equal(state.ownerSessionId, null);
  assert.deepEqual(state.stageItemEscrow, { powder: 0, blueprintShards: 0, matchOrdinal: null, claimedMask: 0 });
  assert.match(state.runId, /^cpu-run:/);
});
test('公開済みv1は旧schemaを厳格検証してからv2 zero escrowへin-memory migrationする', () => {
  const v1 = {
    schemaVersion: 1, runId: validRunId(), state: run.ACTIVE, peakStreak: 8,
    ownerSessionId: null, resumeClaim: null, settlementIntent: null,
  };
  const migrated = run.validateCpuGearRunState(v1);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.stageItemEscrow, { powder: 0, blueprintShards: 0, matchOrdinal: null, claimedMask: 0 });
  const encodedV1 = JSON.stringify(v1);
  const storage = createStorage({ [run.CPU_GEAR_RUN_STORAGE_KEY]: encodedV1 });
  assert.deepEqual(run.loadCpuGearRunState(storage), migrated);
  assert.equal(storage.raw(run.CPU_GEAR_RUN_STORAGE_KEY), encodedV1, 'load migration must not rewrite persisted bytes');
  expectCode('UNKNOWN_CPU_GEAR_RUN_FIELD', () => run.validateCpuGearRunState({ ...v1, surprise: true }));
  const legacyIntent = {
    rewardRulesVersion: 1, runId: v1.runId, rewardId: `cpu:${v1.runId}:settlement`, settlementCreatedAtMs: 10,
    peakStreak: 8, outcome: 'voluntary', qualityProfileId: 'cpu-streak-8', gearCount: 1, blueprintShards: 0,
  };
  const pending = run.validateCpuGearRunState({ ...v1, state: run.SETTLEMENT_PENDING, settlementIntent: legacyIntent });
  assert.deepEqual(pending.settlementIntent, legacyIntent);
  assert.deepEqual(pending.stageItemEscrow, { powder: 0, blueprintShards: 0, matchOrdinal: null, claimedMask: 0 });
  const v2Intent = {
    rewardRulesVersion: 2, runId: v1.runId, rewardId: `cpu:${v1.runId}:settlement`, settlementCreatedAtMs: 11,
    peakStreak: 8, outcome: 'voluntary', qualityProfileId: 'cpu-streak-8', gearCount: 1, powder: 30, blueprintShards: 15,
  };
  assert.deepEqual(run.validateCpuGearRunState({ ...v1, state: run.SETTLEMENT_PENDING, settlementIntent: v2Intent }).settlementIntent, v2Intent);
});
test('crypto.randomUUIDが無い環境は弱いfallbackを使わずfail closedする', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    expectCode('CPU_RUN_ID_UNAVAILABLE', () => run.createCryptoRunId());
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});
test('owner sessionはrun/reward identityと分離され、strict transitionでのみ差し替える', () => {
  const state = active(8, undefined, validOwnerId());
  const transferred = run.withOwnerSessionId(state, validOwnerId('00000000-0000-4000-8000-000000000002'));
  assert.equal(transferred.runId, state.runId);
  assert.equal(transferred.peakStreak, state.peakStreak);
  assert.equal(transferred.ownerSessionId, validOwnerId('00000000-0000-4000-8000-000000000002'));
  const pending = run.withSettlementIntent(transferred, intent(transferred));
  assert.equal(run.withOwnerSessionId(pending, validOwnerId('00000000-0000-4000-8000-000000000003')).settlementIntent.rewardId, pending.settlementIntent.rewardId);
  expectCode('INVALID_CPU_GEAR_OWNER_SESSION_ID', () => run.withOwnerSessionId(state, 'tab-a'));
  expectCode('INVALID_CPU_GEAR_OWNER_SESSION_ID', () => run.validateCpuGearRunState({ ...state, ownerSessionId: 1 }));
});
test('owner crypto UUIDもweak fallback無しでfail closedする', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    expectCode('CPU_OWNER_SESSION_UNAVAILABLE', () => run.createCryptoOwnerSessionId());
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});
test('resume markerは小さいsnapshot identityだけを保持し、owner切替をforward completionできる', () => {
  const source = validOwnerId('00000000-0000-4000-8000-000000000010');
  const target = validOwnerId('00000000-0000-4000-8000-000000000011');
  const snapshotId = 'cpu-snapshot:00000000-0000-4000-8000-000000000012';
  const targetSnapshotId = 'cpu-snapshot:00000000-0000-4000-8000-000000000013';
  const state = active(8, undefined, source);
  const marked = run.withResumeClaim(state, { sourceOwnerSessionId: source, targetOwnerSessionId: target, snapshotId, targetSnapshotId });
  assert.deepEqual(marked.resumeClaim, { sourceOwnerSessionId: source, targetOwnerSessionId: target, snapshotId, targetSnapshotId });
  const fenced = run.withResumeClaimOwner(marked, target);
  const complete = run.completeResumeClaim(fenced, target);
  assert.equal(complete.ownerSessionId, target);
  assert.equal(complete.resumeClaim, null);
  expectCode('INVALID_CPU_GEAR_RESUME_CLAIM', () => run.withResumeClaim(state, { sourceOwnerSessionId: source, targetOwnerSessionId: null, snapshotId, targetSnapshotId }));
  expectCode('INVALID_CPU_GEAR_SNAPSHOT_ID', () => run.withResumeClaim(state, { sourceOwnerSessionId: source, targetOwnerSessionId: target, snapshotId: 'weak', targetSnapshotId }));
});
test('snapshot crypto UUIDもweak fallback無しでfail closedする', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    expectCode('CPU_SNAPSHOT_ID_UNAVAILABLE', () => run.createCryptoSnapshotId());
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});
test('runIdは生成後にstrict save/read-backし、reloadしても同一のまま', () => {
  const storage = createStorage();
  const saved = run.saveCpuGearRunState(active(5), storage);
  assert.deepEqual(run.loadCpuGearRunState(storage), saved);
  assert.equal(run.withPeakStreak(saved, 4).peakStreak, 5);
  assert.equal(run.withPeakStreak(saved, 8).peakStreak, 8);
});
test('settlement pendingは同一intent retryだけを許し、新run/peak上書きを拒否する', () => {
  const state = active(15);
  const pending = run.withSettlementIntent(state, intent(state, 'defeat'));
  assert.equal(pending.state, run.SETTLEMENT_PENDING);
  assert.deepEqual(run.withSettlementIntent(pending, pending.settlementIntent), pending);
  expectCode('CPU_GEAR_SETTLEMENT_PENDING', () => run.withPeakStreak(pending, 16));
  expectCode('CPU_GEAR_SETTLEMENT_CONFLICT', () => run.withSettlementIntent(pending, intent(state, 'voluntary')));
});
test('stage item escrowはordinalごとにmaskを更新し、同一item retryとCPU取得を二重加算しない', () => {
  let state = active(3);
  let pickup = run.recordStageItemPickup(state, { matchOrdinal: 3, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: 0 });
  assert.equal(pickup.modified, true); assert.equal(pickup.credited, true);
  state = pickup.state;
  assert.deepEqual(state.stageItemEscrow, { powder: 3, blueprintShards: 0, matchOrdinal: 3, claimedMask: 1 });
  pickup = run.recordStageItemPickup(state, { matchOrdinal: 3, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: 0 });
  assert.equal(pickup.modified, false); assert.equal(pickup.credited, false); assert.deepEqual(pickup.state, state);
  pickup = run.recordStageItemPickup(active(3), { matchOrdinal: 3, itemIndex: 0, resourceBoxCount: 1, collector: 'cpu', powder: 0, blueprintShards: 0 });
  assert.equal(pickup.modified, true); assert.equal(pickup.credited, false);
  assert.deepEqual(pickup.state.stageItemEscrow, { powder: 0, blueprintShards: 0, matchOrdinal: 3, claimedMask: 1 });
});
test('次ordinalはmaskだけresetして累計を保持し、stale/future/11箱目/不正付与を拒否する', () => {
  let state = run.recordStageItemPickup(active(4), { matchOrdinal: 4, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: 1 }).state;
  state = run.withPeakStreak(state, 5);
  const advanced = run.reconcileStageItemEscrow(state, 5);
  assert.equal(advanced.modified, true);
  state = advanced.state;
  assert.deepEqual(state.stageItemEscrow, { powder: 3, blueprintShards: 1, matchOrdinal: 5, claimedMask: 0 });
  assert.equal(run.reconcileStageItemEscrow(state, 5).modified, false);
  expectCode('STALE_CPU_STAGE_ITEM_MATCH', () => run.reconcileStageItemEscrow(state, 4));
  expectCode('FUTURE_CPU_STAGE_ITEM_MATCH', () => run.reconcileStageItemEscrow(state, 6));
  expectCode('INVALID_CPU_STAGE_ITEM_PICKUP', () => run.recordStageItemPickup(state, { matchOrdinal: 5, itemIndex: 1, resourceBoxCount: 2, collector: 'player', powder: 3, blueprintShards: 0 }));
  expectCode('INVALID_CPU_STAGE_ITEM_PICKUP', () => run.recordStageItemPickup(state, { matchOrdinal: 5, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 1, blueprintShards: 0 }));
  let capped = active(0);
  for (let matchOrdinal = 0; matchOrdinal < run.MAX_STAGE_RESOURCE_BOXES; matchOrdinal += 1) {
    if (matchOrdinal > 0) capped = run.withPeakStreak(capped, matchOrdinal);
    capped = run.recordStageItemPickup(capped, { matchOrdinal, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: matchOrdinal === 0 ? 1 : 0 }).state;
  }
  assert.equal(capped.stageItemEscrow.powder, run.MAX_STAGE_ITEM_POWDER);
  capped = run.withPeakStreak(capped, run.MAX_STAGE_RESOURCE_BOXES);
  expectCode('CPU_STAGE_ITEM_ESCROW_LIMIT', () => run.recordStageItemPickup(capped, { matchOrdinal: run.MAX_STAGE_RESOURCE_BOXES, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: 0 }));
  const pending = run.withSettlementIntent(state, intent(state, 'voluntary', 100, 3, 1));
  expectCode('CPU_STAGE_ITEM_RUN_NOT_ACTIVE', () => run.reconcileStageItemEscrow(pending, 5));
});
test('v2 escrowはexact plain data schema、pending intentとの素材一致をfail closedで守る', () => {
  const state = active(5);
  expectCode('UNKNOWN_CPU_GEAR_RUN_FIELD', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: { ...state.stageItemEscrow, surprise: 1 } }));
  expectCode('INVALID_CPU_GEAR_RUN_STATE', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: Object.create({ powder: 0, blueprintShards: 0, matchOrdinal: null, claimedMask: 0 }) }));
  const accessor = { powder: 0, blueprintShards: 0, matchOrdinal: null };
  Object.defineProperty(accessor, 'claimedMask', { enumerable: true, get: () => 0 });
  expectCode('INVALID_CPU_GEAR_RUN_STATE', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: accessor }));
  expectCode('INVALID_CPU_GEAR_RUN_STATE', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: { ...state.stageItemEscrow, powder: 1 } }));
  expectCode('INVALID_CPU_GEAR_RUN_STATE', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: { ...state.stageItemEscrow, powder: 33 } }));
  expectCode('INVALID_CPU_GEAR_RUN_STATE', () => run.validateCpuGearRunState({ ...state, stageItemEscrow: { ...state.stageItemEscrow, blueprintShards: 2 } }));
  expectCode('UNSUPPORTED_FUTURE_CPU_GEAR_RUN_VERSION', () => run.validateCpuGearRunState({ ...state, schemaVersion: 3 }));
  const collected = run.recordStageItemPickup(state, { matchOrdinal: 5, itemIndex: 0, resourceBoxCount: 1, collector: 'player', powder: 3, blueprintShards: 1 }).state;
  const oldV2 = { rewardRulesVersion: 2, runId: collected.runId, rewardId: `cpu:${collected.runId}:settlement`, settlementCreatedAtMs: 1, peakStreak: 5, outcome: 'voluntary', qualityProfileId: 'cpu-streak-5', gearCount: 1, powder: 20, blueprintShards: 10 };
  expectCode('CPU_GEAR_RUN_INTENT_MISMATCH', () => run.validateCpuGearRunState({ ...collected, state: run.SETTLEMENT_PENDING, settlementIntent: oldV2 }));
  expectCode('CPU_GEAR_RUN_INTENT_MISMATCH', () => run.withSettlementIntent(collected, intent(collected, 'voluntary', 1, 3, 0)));
  assert.equal(run.withSettlementIntent(collected, intent(collected, 'voluntary', 1, 3, 1)).state, run.SETTLEMENT_PENDING);
});
test('intent/run/peakの不一致、未知field、future schema、malformed rawはfail closedする', () => {
  const state = active(10);
  const pending = run.withSettlementIntent(state, intent(state));
  expectCode('CPU_GEAR_RUN_INTENT_MISMATCH', () => run.validateCpuGearRunState({ ...pending, peakStreak: 11 }));
  expectCode('UNKNOWN_CPU_GEAR_RUN_FIELD', () => run.validateCpuGearRunState({ ...state, surprise: true }));
  expectCode('UNSUPPORTED_FUTURE_CPU_GEAR_RUN_VERSION', () => run.validateCpuGearRunState({ ...state, schemaVersion: 3 }));
  const storage = createStorage({ [run.CPU_GEAR_RUN_STORAGE_KEY]: '{' });
  expectCode('CPU_GEAR_RUN_JSON_PARSE_FAILED', () => run.loadCpuGearRunState(storage));
  assert.equal(storage.raw(run.CPU_GEAR_RUN_STORAGE_KEY), '{');
});
test('key不存在だけはrunなしとしてnull、削除はread-back検証する', () => {
  const storage = createStorage();
  assert.equal(run.loadCpuGearRunState(storage), null);
  run.saveCpuGearRunState(active(3), storage);
  assert.equal(run.removeCpuGearRunState(storage), true);
  assert.equal(storage.raw(run.CPU_GEAR_RUN_STORAGE_KEY), null);
});
test('read-back失敗・cleanup失敗はrun entitlementを勝手に消さない', () => {
  const storage = createStorage();
  const state = active(20);
  const originalGet = storage.getItem.bind(storage);
  storage.getItem = (key) => key === run.CPU_GEAR_RUN_STORAGE_KEY ? 'different' : originalGet(key);
  expectCode('CPU_GEAR_RUN_STORAGE_READ_BACK_MISMATCH', () => run.saveCpuGearRunState(state, storage));
  storage.getItem = originalGet;
  run.saveCpuGearRunState(state, storage);
  const before = storage.raw(run.CPU_GEAR_RUN_STORAGE_KEY);
  storage.removeItem = () => { throw new Error('blocked'); };
  expectCode('CPU_GEAR_RUN_STORAGE_CLEANUP_FAILED', () => run.removeCpuGearRunState(storage));
  assert.equal(storage.raw(run.CPU_GEAR_RUN_STORAGE_KEY), before);
});
test('module has no time/random/localStorage side effect and browser crypto remains explicit', () => {
  const source = require('node:fs').readFileSync(require.resolve('../shared/gear-cpu-run-storage.js'), 'utf8');
  ['Date.now', 'Math.random', 'performance.now'].forEach((forbidden) => assert.equal(source.includes(forbidden), false, forbidden));
  assert.equal(source.includes('localStorage.setItem'), false);
});

console.log(`gear-cpu-run-storage: ${passed}/${passed} passed`);
