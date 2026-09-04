const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const storageApi = require('../shared/gear-storage.js');
const rewards = require('../shared/gear-rewards.js');
const foundation = require('../coop-mvp-foundation.js');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(Promise.resolve(result).then(() => { passed += 1; console.log(`  ok ${name}`); }));
    } else { passed += 1; console.log(`  ok ${name}`); }
  } catch (error) { console.error(`  NG ${name}`); throw error; }
}
function expectCode(code, fn) { assert.throws(fn, (error) => error?.code === code, `expected ${code}`); }
async function expectCodeAsync(code, fn) { await assert.rejects(fn, (error) => error?.code === code, `expected ${code}`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function request(requestId, kind = 'slot', extra = {}) { return { requestId, kind, slotId: 'engine', createdAtMs: 100, ...extra }; }
function selection(kind = 'slot', extra = {}) { return { kind, slotId: 'engine', createdAtMs: 100, ...extra }; }
function open(rawState, rawRequest, quality = 'coop-normal', entropy = `entropy:${rawRequest.requestId}`) {
  return rewards.openTargetedBox(rawState, rawRequest, quality, entropy);
}
function state(shards = 1000) { const value = storageApi.createDefaultGearStorageState(); value.resources.blueprintShards = shards; return value; }
class FakeStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
}
class AmbiguousReadbackStorage extends FakeStorage {
  constructor(initial) { super(initial); this.armed = false; this.failRead = false; }
  arm() { this.armed = true; }
  setItem(key, value) { super.setItem(key, value); if (this.armed && key === storageApi.GEAR_STORAGE_KEY) { this.armed = false; this.failRead = true; } }
  getItem(key) { if (this.failRead && key === storageApi.GEAR_STORAGE_KEY) { this.failRead = false; throw new Error('ambiguous read-back'); } return super.getItem(key); }
}
class ExclusiveLockManager {
  constructor() { this.tail = Promise.resolve(); this.requests = []; }
  request(name, options, callback) {
    this.requests.push({ name, options }); const prior = this.tail; let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    return prior.then(async () => { try { return await callback({ name }); } finally { release(); } });
  }
}

test('部位・set・部位+set箱はcanonical quoteだけを使い設計片をexactly once消費する', () => {
  const slot = open(state(100), request('slot-a'));
  assert.equal(slot.opened, true); assert.equal(slot.spentBlueprintShards, 100); assert.equal(slot.nextState.resources.blueprintShards, 0);
  assert.equal(slot.reward.gears[0].slotId, 'engine'); assert.equal(slot.reward.sourceId, rewards.TARGETED_BOX_SOURCE_ID);
  assert.equal(slot.reward.sourceDetail.qualityProfileId, 'coop-normal');

  const setRequest = { requestId: 'set-a', kind: 'set', setId: 'rescue', createdAtMs: 101 };
  const setResult = open(state(100), setRequest, 'coop-hard');
  assert.equal(setResult.reward.gears[0].setId, 'rescue'); assert.equal(setResult.reward.sourceDetail.qualityProfileId, 'coop-hard');

  const both = open(state(300), request('both-a', 'slot_set', { setId: 'last_stand' }), 'coop-extreme');
  assert.equal(both.spentBlueprintShards, 300); assert.equal(both.reward.gears[0].slotId, 'engine'); assert.equal(both.reward.gears[0].setId, 'last_stand');
});

test('同じrequest retryはpending/claimedのどちらでも二重消費・二重生成しない', () => {
  const first = open(state(200), request('retry-a'));
  const pendingRetry = open(first.nextState, request('retry-a'), 'coop-normal', 'different-retry-entropy');
  assert.equal(pendingRetry.duplicate, true); assert.equal(pendingRetry.spentBlueprintShards, 0);
  assert.deepEqual(pendingRetry.nextState, first.nextState);
  const claimed = rewards.claimUnclaimedReward(first.nextState, first.reward.rewardId, 200);
  const claimedRetry = open(claimed.nextState, request('retry-a'), 'coop-normal', 'different-claimed-entropy');
  assert.equal(claimedRetry.duplicate, true); assert.equal(claimedRetry.nextState.inventory.length, 1);
  assert.equal(claimedRetry.nextState.resources.blueprintShards, 100);
});

test('本番抽選seedはcaller requestIdから派生せずwriter内部CSPRNGだけで決まる', () => {
  const source = fs.readFileSync(path.join(__dirname, '../shared/gear-rewards.js'), 'utf8');
  assert.match(source, /secureTargetedBoxToken\('roll'\)/);
  assert.match(source, /generationSeed: `targeted-box:\$\{entropySeed\}:generation`/);
  assert.doesNotMatch(source, /generationSeed: `targeted-box:\$\{request\.requestId\}/);
  const left = open(state(100), request('same-request'), 'coop-normal', 'entropy-left');
  const right = open(state(100), request('same-request'), 'coop-normal', 'entropy-right');
  assert.notDeepEqual(left.reward.gears[0], right.reward.gears[0]);
});

test('不足・容量・invalid requestはstateを変更せずfail closedする', () => {
  const insufficient = state(99); const before = clone(insufficient);
  expectCode('INSUFFICIENT_BLUEPRINT_SHARDS', () => open(insufficient, request('poor-a')));
  assert.deepEqual(insufficient, before);
  const full = state(1000);
  full.unclaimedRewards = Array.from({ length: storageApi.UNCLAIMED_REWARD_CAPACITY }, (_entry, index) => ({
    rewardId: `pending-${index}`, sourceId: 'cpu_battle', sourceDetail: {}, createdAtMs: index, gears: [], powder: 0, blueprintShards: 0,
  }));
  expectCode('TARGETED_BOX_REWARD_GATE_BLOCKED', () => open(full, request('full-a')));
  const physicalFull = state(1000);
  const filler = domain.createGear({ gearId: 'filler', generationSeed: 'filler:g', enhancementSeed: 'filler:e', sourceId: 'test', sourceDetail: {}, acquiredAt: 1, qualityProfile: domain.COOP_BOSS_QUALITY_PROFILES.normal, setProfile: domain.GEAR_SET_PROFILES.uniform });
  physicalFull.inventory = Array.from({ length: storageApi.MAIN_INVENTORY_CAPACITY }, (_entry, index) => ({ gear: { ...filler, gearId: `inventory-${index}` }, locked: false, favorite: false }));
  physicalFull.tempBox = Array.from({ length: storageApi.TEMP_BOX_CAPACITY }, (_entry, index) => ({ gear: { ...filler, gearId: `temp-${index}` }, locked: false, favorite: false, enteredAtMs: index }));
  expectCode('TARGETED_BOX_REWARD_GATE_BLOCKED', () => open(physicalFull, request('physical-full')));
  expectCode('INVALID_TARGETED_BOX_REQUEST', () => open(state(), { ...request('bad-a'), surprise: true }));
  expectCode('TARGETED_BOX_QUALITY_PROFILE_NOT_ALLOWED', () => open(state(), request('quality-a'), 'cpu-streak-15'));
});

test('品質はFoundationの到達済み最高協力難易度だけから決まる', () => {
  const base = foundation.createDefaultState();
  assert.equal(rewards.highestTargetedBoxQualityProfileId(base), 'coop-normal');
  base.boss.unlockedDifficulties.push('hard');
  assert.equal(rewards.highestTargetedBoxQualityProfileId(base), 'coop-hard');
  base.boss.unlockedDifficulties.push('extreme');
  assert.equal(rewards.highestTargetedBoxQualityProfileId(base), 'coop-extreme');
  expectCode('INVALID_FOUNDATION_GEAR_ENTITLEMENT', () => rewards.highestTargetedBoxQualityProfileId({}));
});

test('persistenceはshared lock・WAL guard・strict Foundation読取で保存する', async () => {
  const initial = state(400);
  const target = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: storageApi.encodeGearStorageState(initial) });
  const foundationState = foundation.createDefaultState(); foundationState.boss.unlockedDifficulties.push('hard'); foundation.saveState(foundationState, target);
  const lockManager = new ExclusiveLockManager();
  const persistOptions = { lockManager, testEntropySeed: 'persist-entropy' };
  const persistRequest = selection('slot_set', { requestId: 'persist-a', setId: 'impact' });
  const opened = await rewards.persistOpenTargetedBox(persistRequest, target, persistOptions);
  assert.equal(opened.opened, true); assert.equal(opened.reward.sourceDetail.qualityProfileId, 'coop-hard');
  assert.equal(storageApi.loadGearState(target).resources.blueprintShards, 100);
  const retry = await rewards.persistOpenTargetedBox(persistRequest, target, { ...persistOptions, testEntropySeed: 'different-entropy' });
  assert.equal(retry.duplicate, true); assert.equal(storageApi.loadGearState(target).unclaimedRewards.length, 1);
  assert.ok(lockManager.requests.every((entry) => entry.name === rewards.GEAR_MUTATION_LOCK_NAME && entry.options.mode === 'exclusive'));
  target.setItem(rewards.GEAR_TRANSACTION_STORAGE_KEY, '{pending');
  await expectCodeAsync('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistOpenTargetedBox(selection('slot', { requestId: 'blocked-a' }), target, { lockManager, testEntropySeed: 'blocked-entropy' }));
});

test('同時double tapは1回だけ課金しpending rewardを1件だけ作る', async () => {
  const target = new FakeStorage({ [storageApi.GEAR_STORAGE_KEY]: storageApi.encodeGearStorageState(state(200)) });
  foundation.saveState(foundation.createDefaultState(), target);
  const options = { lockManager: new ExclusiveLockManager(), testEntropySeed: 'double-entropy' };
  const doubleRequest = selection('slot', { requestId: 'double-a' });
  const [left, right] = await Promise.all([
    rewards.persistOpenTargetedBox(doubleRequest, target, options),
    rewards.persistOpenTargetedBox(doubleRequest, target, options),
  ]);
  assert.equal(Number(left.opened) + Number(right.opened), 1);
  const stored = storageApi.loadGearState(target);
  assert.equal(stored.resources.blueprintShards, 100); assert.equal(stored.unclaimedRewards.length, 1);
});

test('保存後read-backが曖昧でも同じrequest retryは二重課金しない', async () => {
  const target = new AmbiguousReadbackStorage({ [storageApi.GEAR_STORAGE_KEY]: storageApi.encodeGearStorageState(state(100)) });
  foundation.saveState(foundation.createDefaultState(), target);
  const requestValue = selection('slot', { requestId: 'ambiguous-a' });
  const options = { lockManager: new ExclusiveLockManager(), testEntropySeed: 'ambiguous-entropy' };
  target.arm();
  await assert.rejects(() => rewards.persistOpenTargetedBox(requestValue, target, options));
  const afterAmbiguous = storageApi.loadGearState(target);
  assert.equal(afterAmbiguous.resources.blueprintShards, 0); assert.equal(afterAmbiguous.unclaimedRewards.length, 1);
  const retry = await rewards.persistOpenTargetedBox(requestValue, target, { ...options, testEntropySeed: 'new-entropy-ignored' });
  assert.equal(retry.duplicate, true);
  const finalState = storageApi.loadGearState(target);
  assert.equal(finalState.resources.blueprintShards, 0); assert.equal(finalState.unclaimedRewards.length, 1);
});

Promise.all(pending).then(() => console.log(`gear-targeted-box: ${passed}/8 passed`));
