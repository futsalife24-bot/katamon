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
function intent(state, outcome = 'voluntary', at = 100) {
  return cpu.createCpuSettlementIntent({ runId: state.runId, peakStreak: state.peakStreak, outcome, settlementCreatedAtMs: at });
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
  assert.equal(state.schemaVersion, 1); assert.equal(state.state, run.ACTIVE);
  assert.equal(state.peakStreak, 3); assert.equal(state.settlementIntent, null);
  assert.equal(state.ownerSessionId, null);
  assert.match(state.runId, /^cpu-run:/);
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
test('intent/run/peakの不一致、未知field、future schema、malformed rawはfail closedする', () => {
  const state = active(10);
  const pending = run.withSettlementIntent(state, intent(state));
  expectCode('CPU_GEAR_RUN_INTENT_MISMATCH', () => run.validateCpuGearRunState({ ...pending, peakStreak: 11 }));
  expectCode('UNKNOWN_CPU_GEAR_RUN_FIELD', () => run.validateCpuGearRunState({ ...state, surprise: true }));
  expectCode('UNSUPPORTED_FUTURE_CPU_GEAR_RUN_VERSION', () => run.validateCpuGearRunState({ ...state, schemaVersion: 2 }));
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
