const assert = require('node:assert/strict');
const dungeon = require('../shared/gear-weekday-dungeon.js');
const storageApi = require('../shared/gear-weekday-dungeon-storage.js');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const gearRewards = require('../shared/gear-rewards.js');

// RED confirmation: before implementation these modules did not exist, so this
// focused test failed at require before any weekday-dungeon assertion could run.
let passed = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok   ${name}`); }); }
function expectCode(code, fn) { assert.throws(fn, (error) => error && error.code === code, `expected ${code}`); }
function memory(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem(key) { return map.has(key) ? map.get(key) : null; }, setItem(key, value) { map.set(key, String(value)); }, removeItem(key) { map.delete(key); }, raw(key) { return map.has(key) ? map.get(key) : null; } }; }
function locks() { let tail = Promise.resolve(); return { request(name, options, callback) { assert.equal(name, storageApi.WEEKDAY_DUNGEON_LOCK_NAME); assert.deepEqual(options, { mode: 'exclusive' }); const next = tail.then(() => callback({ name })); tail = next.catch(() => {}); return next; } }; }
function jst(y, m, d, h = 12, min = 0) { return Date.UTC(y, m - 1, d, h - 9, min); }
function attemptAt(nowMs, slotId, angle = 45, power = 80) { return dungeon.createAttempt({ dayInfo: dungeon.getDayInfo({ nowMs }), slotId, aim: { angle, power } }); }
function commit(attempt, store, lock, nowMs) { return storageApi.commitAttempt(attempt, store, { nowMs, lockManager: lock }); }
function persistReward(store, attempt) { const reward = dungeon.materializeReward(attempt, gear); const next = gearRewards.queueUnclaimedReward(gearStorage.createDefaultGearStorageState(), reward).nextState; gearStorage.saveGearState(next, store); }
function hitAndMiss(nowMs, slotId) { let hit = null; let miss = null; for (let angle = 10; angle <= 80; angle += 1) for (let power = 28; power <= 120; power += 1) { const attempt = attemptAt(nowMs, slotId, angle, power); if (dungeon.resolveAttempt(attempt).hit && !hit) hit = attempt; if (!dungeon.resolveAttempt(attempt).hit && !miss) miss = attempt; } assert.ok(hit && miss); return { hit, miss }; }

(async () => {
  await test('JST境界、全曜日、日曜選択を固定する', () => {
    assert.equal(dungeon.getDayInfo({ nowMs: jst(2026, 9, 7, 0, 0) - 1 }).dayKey, '2026-09-06');
    ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary'].forEach((slotId, offset) => assert.equal(dungeon.getDayInfo({ nowMs: jst(2026, 9, 7 + offset) }).fixedSlotId, slotId));
    assert.equal(dungeon.getDayInfo({ nowMs: jst(2026, 9, 13) }).isSunday, true);
    expectCode('WEEKDAY_DUNGEON_SLOT_NOT_TODAY', () => attemptAt(jst(2026, 9, 7), 'armor'));
    assert.equal(attemptAt(jst(2026, 9, 13), 'sight').slotId, 'sight');
  });

  await test('attempt、弾道、result time、targetは決定的でquality entriesもdeep freezeされる', () => {
    const attempt = attemptAt(jst(2026, 9, 7), 'barrel', 45, 80);
    assert.deepEqual(dungeon.resolveAttempt(attempt), dungeon.resolveAttempt(JSON.parse(JSON.stringify(attempt))));
    assert.equal(attempt.rewardId, 'weekday-dungeon:2026-09-07:barrel:reward'); assert.ok(dungeon.resolveAttempt(attempt).trajectory.length > 1);
    assert.equal(Object.isFrozen(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.starWeights[0]), true); assert.equal(Object.isFrozen(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.rarityWeights[0]), true);
    assert.equal(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.id, 'weekday-dungeon-v1');
    assert.deepEqual(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.starWeights, [
      { id: 1, weight: 35 }, { id: 2, weight: 35 }, { id: 3, weight: 20 },
      { id: 4, weight: 10 }, { id: 5, weight: 0 }, { id: 6, weight: 0 },
    ]);
    assert.deepEqual(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.rarityWeights, [
      { id: 'normal', weight: 40 }, { id: 'rare', weight: 34 }, { id: 'epic', weight: 20 },
      { id: 'legend', weight: 5 }, { id: 'mythic', weight: 1 },
    ]);
    expectCode('INVALID_WEEKDAY_DUNGEON_INPUT', () => dungeon.createAttempt({ dayInfo: dungeon.getDayInfo({ nowMs: jst(2026, 9, 7) }), slotId: 'barrel', aim: { angle: 45.5, power: 80 } }));
  });

  await test('hitはslot固定Gear 1個、missは粉末3個だけをidempotentに生成する', () => {
    const { hit, miss } = hitAndMiss(jst(2026, 9, 7), 'barrel'); const reward = dungeon.materializeReward(hit, gear);
    assert.deepEqual(dungeon.materializeReward(JSON.parse(JSON.stringify(hit)), gear), reward); assert.equal(reward.gears.length, 1); assert.equal(reward.gears[0].slotId, 'barrel'); assert.equal(reward.sourceId, 'weekday_dungeon');
    assert.equal(dungeon.materializeReward(miss, gear).powder, 3); assert.equal(dungeon.materializeReward(miss, gear).gears.length, 0);
  });

  await test('commitはlock内のJST fire dayを必須にし、同一IDでは保存済みaimを返す', async () => {
    const now = jst(2026, 9, 7, 23, 59); const store = memory(); const lock = locks(); const first = attemptAt(now, 'barrel', 45, 80); const changedAim = attemptAt(now, 'barrel', 46, 80);
    assert.equal((await commit(first, store, lock, now)).committed, true);
    const retry = await commit(changedAim, store, lock, now); assert.equal(retry.committed, false); assert.equal(retry.attempt.angle, 45, 'stored fired aim is authoritative');
    await assert.rejects(commit(first, store, lock, jst(2026, 9, 8, 0, 0)), (error) => error && error.code === 'WEEKDAY_DUNGEON_FIRE_DAY_MISMATCH');
    await assert.rejects(storageApi.commitAttempt(first, store, { lockManager: lock }), (error) => error && error.code === 'INVALID_WEEKDAY_DUNGEON_COMMIT_OPTIONS');
  });

  await test('前日firedは日付をまたいでもrecovery必須で、新規entry statusも閉じる', async () => {
    const mon2359 = jst(2026, 9, 7, 23, 59); const tue0000 = jst(2026, 9, 8, 0, 0); const store = memory(); const lock = locks(); const monday = attemptAt(mon2359, 'barrel');
    await commit(monday, store, lock, mon2359); const tuesday = attemptAt(tue0000, 'armor');
    const status = dungeon.getDayStatus({ dayInfo: dungeon.getDayInfo({ nowMs: tue0000 }), state: storageApi.loadWeekdayDungeonState(store) }); assert.equal(status.available, false);
    await assert.rejects(commit(tuesday, store, lock, tue0000), (error) => error && error.code === 'WEEKDAY_DUNGEON_RECOVERY_REQUIRED');
  });

  await test('markQueuedはGear pending/ledger確認前には遷移せず、durable後だけidempotent', async () => {
    const now = jst(2026, 9, 7); const store = memory(); const lock = locks(); const attempt = attemptAt(now, 'barrel'); await commit(attempt, store, lock, now);
    await assert.rejects(storageApi.markQueued(attempt, store, { lockManager: lock }), (error) => error && error.code === 'WEEKDAY_DUNGEON_REWARD_NOT_DURABLE');
    assert.equal(storageApi.loadWeekdayDungeonState(store).activeAttempt.phase, 'fired'); persistReward(store, attempt);
    assert.equal((await storageApi.markQueued(attempt, store, { lockManager: lock })).marked, true); assert.equal((await storageApi.markQueued(attempt, store, { lockManager: lock })).marked, false);
  });

  await test('Web Lockはobject callback、callback実行、request rejectionをそれぞれfail closedする', async () => {
    await assert.rejects(async () => storageApi.withWeekdayDungeonLock(() => true, { lockManager: { request(_n, _o, callback) { return Promise.resolve(callback(null)); } } }), (error) => error && error.code === 'WEEKDAY_DUNGEON_LOCK_INVALID_HANDLE');
    await assert.rejects(storageApi.withWeekdayDungeonLock(() => true, { lockManager: { request() { return Promise.resolve('without callback'); } } }), (error) => error && error.code === 'WEEKDAY_DUNGEON_LOCK_CALLBACK_NOT_EXECUTED');
    await assert.rejects(storageApi.withWeekdayDungeonLock(() => true, { lockManager: { request() { return Promise.reject(new Error('denied')); } } }), (error) => error && error.code === 'WEEKDAY_DUNGEON_LOCK_REQUEST_FAILED');
  });

  await test('read-back mismatch/failureは以前のrawへrollbackし、rollback不能はambiguous writeにする', () => {
    const old = storageApi.encodeWeekdayDungeonState(storageApi.createWeekdayDungeonState()); const next = { schemaVersion: 1, maxConsumedDayIndex: 1, activeAttempt: null };
    const mismatch = memory({ [storageApi.WEEKDAY_DUNGEON_STORAGE_KEY]: old }); let reads = 0; const mismatchGet = mismatch.getItem;
    mismatch.getItem = (key) => { if (key !== storageApi.WEEKDAY_DUNGEON_STORAGE_KEY) return mismatchGet(key); reads += 1; return reads === 2 ? 'wrong' : mismatchGet(key); };
    expectCode('WEEKDAY_DUNGEON_STORAGE_READ_BACK_MISMATCH', () => storageApi.saveWeekdayDungeonState(next, mismatch)); assert.equal(mismatch.raw(storageApi.WEEKDAY_DUNGEON_STORAGE_KEY), old);
    const readFailure = memory({ [storageApi.WEEKDAY_DUNGEON_STORAGE_KEY]: old }); let failureReads = 0; const failureGet = readFailure.getItem;
    readFailure.getItem = (key) => { if (key !== storageApi.WEEKDAY_DUNGEON_STORAGE_KEY) return failureGet(key); failureReads += 1; if (failureReads === 2) throw new Error('read blocked'); return failureGet(key); };
    expectCode('WEEKDAY_DUNGEON_STORAGE_READ_BACK_FAILED', () => storageApi.saveWeekdayDungeonState(next, readFailure)); assert.equal(readFailure.raw(storageApi.WEEKDAY_DUNGEON_STORAGE_KEY), old);
    const ambiguous = memory(); let ambiguousReads = 0;
    ambiguous.getItem = (key) => { if (key !== storageApi.WEEKDAY_DUNGEON_STORAGE_KEY) return null; ambiguousReads += 1; return ambiguousReads === 1 ? null : 'wrong'; };
    expectCode('WEEKDAY_DUNGEON_STORAGE_AMBIGUOUS_WRITE', () => storageApi.saveWeekdayDungeonState(next, ambiguous));
  });

  await test('unknown/accessor/prototype/malformed/future schemaを受理しない', () => {
    const attempt = attemptAt(jst(2026, 9, 7), 'barrel'); expectCode('UNKNOWN_WEEKDAY_DUNGEON_FIELD', () => dungeon.validateAttempt({ ...attempt, extra: true }));
    const accessor = { ...attempt }; Object.defineProperty(accessor, 'angle', { enumerable: true, get: () => 45 }); expectCode('INVALID_WEEKDAY_DUNGEON_INPUT', () => dungeon.validateAttempt(accessor));
    expectCode('INVALID_WEEKDAY_DUNGEON_INPUT', () => dungeon.validateAttempt(Object.assign(Object.create({}), attempt))); expectCode('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_VERSION', () => dungeon.validateAttempt({ ...attempt, schemaVersion: 2 }));
    expectCode('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_STORAGE_VERSION', () => storageApi.validateWeekdayDungeonState({ schemaVersion: 2, maxConsumedDayIndex: -1, activeAttempt: null }));
    expectCode('INVALID_WEEKDAY_DUNGEON_STORAGE', () => storageApi.loadWeekdayDungeonState(memory({ [storageApi.WEEKDAY_DUNGEON_STORAGE_KEY]: '{' })));
  });
  console.log(`gear-weekday-dungeon: ${passed}/${passed} passed`);
})().catch((error) => { console.error('  NG   weekday dungeon'); throw error; });
