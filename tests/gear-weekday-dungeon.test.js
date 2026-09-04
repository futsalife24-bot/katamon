const assert = require('node:assert/strict');
const dungeon = require('../shared/gear-weekday-dungeon.js');
const storageApi = require('../shared/gear-weekday-dungeon-storage.js');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const gearRewards = require('../shared/gear-rewards.js');

let passed = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ok   ${name}`); }); }
function expectCode(code, fn) { assert.throws(fn, (error) => error && error.code === code, `expected ${code}`); }
function memory(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem(key) { return map.has(key) ? map.get(key) : null; }, setItem(key, value) { map.set(key, String(value)); }, removeItem(key) { map.delete(key); }, raw(key) { return map.has(key) ? map.get(key) : null; } }; }
function locks() { let tail = Promise.resolve(); return { request(name, options, callback) { assert.equal(name, storageApi.WEEKDAY_DUNGEON_LOCK_NAME); assert.deepEqual(options, { mode: 'exclusive' }); const next = tail.then(() => callback({ name })); tail = next.catch(() => {}); return next; } }; }
function jst(y, m, d, h = 12, min = 0) { return Date.UTC(y, m - 1, d, h - 9, min); }
function v2Attempt(nowMs, dragX, dragY) { return dungeon.createAttempt({ dayInfo: dungeon.getDayInfo({ nowMs }), shot: { dragX, dragY } }); }
function legacyAttempt(nowMs, slotId, angle = 45, power = 80) {
  const day = dungeon.getDayInfo({ nowMs }); const identity = `weekday-dungeon:${day.dayKey}:${slotId}`;
  return { schemaVersion: 1, rulesVersion: 1, attemptId: `${identity}:attempt`, rewardId: `${identity}:reward`, dayKey: day.dayKey, dayIndex: day.dayIndex, slotId, phase: 'fired', angle, power, createdAtMs: day.jstStartMs };
}
function persistReward(store, attempt) { const reward = dungeon.materializeReward(attempt, gear); const next = gearRewards.queueUnclaimedReward(gearStorage.createDefaultGearStorageState(), reward).nextState; gearStorage.saveGearState(next, store); }

(async () => {
  await test('v2は標準battle定数、中央発射、整数ドラッグを固定する', () => {
    assert.deepEqual(dungeon.BATTLE_PHYSICS, { fixedDt: 1 / 120, gravity: 650, velocityScale: 7.8, wind: 0 });
    assert.deepEqual(dungeon.SHOT_LIMITS, { minDrag: 27, maxDrag: 130 });
    const shot = dungeon.simulateBattleShot({ dragX: -130, dragY: 0 });
    assert.deepEqual(shot.velocity, { vx: 1014, vy: 0 });
    assert.deepEqual(shot.trajectory[0], { tick: 0, timeMs: 0, x: 720, y: 494 });
    assert.equal(shot.impact.termination, 'ground');
    expectCode('INVALID_WEEKDAY_DUNGEON_SHOT', () => dungeon.canonicalShot({ dragX: 11, dragY: 0 }));
    expectCode('INVALID_WEEKDAY_DUNGEON_SHOT', () => dungeon.canonicalShot({ dragX: 130, dragY: 1 }));
    expectCode('INVALID_WEEKDAY_DUNGEON_INPUT', () => dungeon.canonicalShot({ dragX: 12.5, dragY: 0 }));
  });

  await test('6 lanesは左右×近中遠で、6日ローテーション中に全slotが全zoneを一度ずつ通る', () => {
    const first = dungeon.getDayInfo({ nowMs: jst(2026, 9, 7) }); const firstLayout = dungeon.getZoneLayout(first);
    assert.deepEqual(firstLayout.map((zone) => zone.id), ['left-far', 'left-mid', 'left-near', 'right-near', 'right-mid', 'right-far']);
    assert.deepEqual(firstLayout.map((zone) => zone.x), [80, 300, 520, 920, 1140, 1360]);
    assert.ok(firstLayout.every((zone) => zone.y === 510 && zone.radius === 85));
    assert.equal(new Set(firstLayout.map((zone) => zone.slotId)).size, 6);
    for (const slotId of dungeon.WEEKDAY_SLOT_IDS) {
      const zones = new Set();
      for (let offset = 0; offset < 6; offset += 1) zones.add(dungeon.getZoneLayout(dungeon.getDayInfo({ nowMs: jst(2026, 9, 7 + offset) })).find((zone) => zone.slotId === slotId).id);
      assert.equal(zones.size, 6, `${slotId} must visit all six lanes`);
    }
    assert.deepEqual(Object.keys(first).sort(), ['dayIndex', 'dayKey', 'fixedSlotId', 'isSunday', 'jstStartMs', 'weekday']);
  });

  await test('v2 attemptは日単位identityで、派生lane/impactを保存・再計算検証する', () => {
    const now = jst(2026, 9, 7); const hit = v2Attempt(now, -130, 0); const changedDirection = v2Attempt(now, 130, 0); const result = dungeon.resolveAttempt(hit);
    assert.equal(hit.attemptId, 'weekday-dungeon:2026-09-07:attempt'); assert.equal(hit.rewardId, 'weekday-dungeon:2026-09-07:reward'); assert.equal(changedDirection.attemptId, hit.attemptId);
    assert.equal(result.hit, true); assert.equal(result.zone.id, 'right-near'); assert.equal(result.slot, hit.slotId); assert.equal(result.slotId, hit.slotId); assert.equal(result.layout.length, 6);
    assert.deepEqual(dungeon.resolveAttempt(JSON.parse(JSON.stringify(hit))), result);
    expectCode('WEEKDAY_DUNGEON_DERIVATION_MISMATCH', () => dungeon.validateAttempt({ ...hit, zoneId: 'left-near' }));
    expectCode('WEEKDAY_DUNGEON_DERIVATION_MISMATCH', () => dungeon.validateAttempt({ ...hit, impact: { ...hit.impact, x: hit.impact.x + 1 } }));
    const miss = v2Attempt(now, 60, 70); assert.equal(dungeon.resolveAttempt(miss).hit, false); assert.equal(miss.zoneId, null); assert.equal(miss.slotId, null);
  });

  await test('v2はhit slot Gear、miss powder 3を同じquality profileで決定的に生成する', () => {
    const now = jst(2026, 9, 7); const hit = v2Attempt(now, -130, 0); const miss = v2Attempt(now, 60, 70); const reward = dungeon.materializeReward(hit, gear);
    assert.equal(reward.gears.length, 1); assert.equal(reward.gears[0].slotId, dungeon.resolveAttempt(hit).slotId);
    assert.deepEqual(dungeon.materializeReward(JSON.parse(JSON.stringify(hit)), gear), reward);
    assert.deepEqual(dungeon.materializeReward(miss, gear).gears, []); assert.equal(dungeon.materializeReward(miss, gear).powder, 3);
    assert.equal(Object.isFrozen(dungeon.WEEKDAY_DUNGEON_QUALITY_PROFILE.starWeights[0]), true);
  });

  await test('v2の同日別方向は一つの永続entitlementへ収束し、queue/recovery契約を維持する', async () => {
    const now = jst(2026, 9, 7, 23, 59); const store = memory(); const lock = locks(); const first = v2Attempt(now, -130, 0); const otherDirection = v2Attempt(now, 130, 0);
    assert.equal((await storageApi.commitAttempt(first, store, { nowMs: now, lockManager: lock })).committed, true);
    const retry = await storageApi.commitAttempt(otherDirection, store, { nowMs: now, lockManager: lock }); assert.equal(retry.committed, false); assert.equal(retry.attempt.attemptId, first.attemptId); assert.deepEqual(retry.attempt.shot, first.shot);
    await assert.rejects(storageApi.commitAttempt(first, store, { nowMs: jst(2026, 9, 8), lockManager: lock }), (error) => error && error.code === 'WEEKDAY_DUNGEON_FIRE_DAY_MISMATCH');
    await assert.rejects(storageApi.markQueued(first, store, { lockManager: lock }), (error) => error && error.code === 'WEEKDAY_DUNGEON_REWARD_NOT_DURABLE');
    persistReward(store, first); assert.equal((await storageApi.markQueued(first, store, { lockManager: lock })).marked, true);
    assert.equal((await storageApi.markQueued(first, store, { lockManager: lock })).marked, false);
  });

  await test('公開済みv1 attemptは旧判定、固定曜日identity、reward/gear IDのまま復旧できる', async () => {
    const now = jst(2026, 9, 7); const legacy = legacyAttempt(now, 'barrel'); const checked = dungeon.validateAttempt(legacy); const result = dungeon.resolveAttempt(legacy); const reward = dungeon.materializeReward(legacy, gear);
    assert.equal(checked.schemaVersion, 1); assert.equal(checked.rulesVersion, 1); assert.equal(result.target.radius, dungeon.HIT_RADIUS); assert.equal(reward.rewardId, 'weekday-dungeon:2026-09-07:barrel:reward');
    if (result.hit) assert.equal(reward.gears[0].gearId, 'weekday-dungeon:2026-09-07:barrel:gear:0'); else assert.equal(reward.powder, 3);
    const store = memory(); const lock = locks(); await storageApi.commitAttempt(legacy, store, { nowMs: now, lockManager: lock }); persistReward(store, legacy); assert.equal((await storageApi.markQueued(legacy, store, { lockManager: lock })).marked, true);
    expectCode('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_VERSION', () => dungeon.validateAttempt({ ...v2Attempt(now, -130, 0), schemaVersion: 3 }));
    expectCode('UNKNOWN_WEEKDAY_DUNGEON_FIELD', () => dungeon.validateAttempt({ ...legacy, extra: true }));
    const accessor = { ...legacy }; Object.defineProperty(accessor, 'angle', { enumerable: true, get: () => 45 }); expectCode('INVALID_WEEKDAY_DUNGEON_INPUT', () => dungeon.validateAttempt(accessor));
  });
  console.log(`gear-weekday-dungeon: ${passed}/${passed} passed`);
})().catch((error) => { console.error('  NG   weekday dungeon'); throw error; });
