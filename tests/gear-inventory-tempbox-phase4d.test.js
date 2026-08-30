const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const storage = require('../shared/gear-storage.js');
const rewards = require('../shared/gear-rewards.js');
const cpuRewards = require('../shared/gear-cpu-rewards.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result?.then) pending.push(result.then(() => { passed += 1; console.log(`  ok ${name}`); }));
    else { passed += 1; console.log(`  ok ${name}`); }
  } catch (error) { console.error(`  NG ${name}`); throw error; }
}
function profile() { return { id: 'phase4d-quality', starWeights: [{ id: 4, weight: 1 }], rarityWeights: [{ id: 'epic', weight: 1 }] }; }
function makeGear(gearId, slotId = 'barrel') {
  return domain.createGear({ gearId, generationSeed: `g:${gearId}`, enhancementSeed: `e:${gearId}`, sourceId: 'cpu_battle', sourceDetail: { phase: '4d' }, acquiredAt: '2026-08-30T00:00:00Z', qualityProfile: profile(), setProfile: { id: 'phase4d-set', setWeights: [{ id: 'assault', weight: 1 }] }, slotId, setId: 'assault' });
}
class FakeStorage {
  constructor() { this.values = new Map(); this.setCount = 0; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.setCount += 1; this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
class LockManager {
  constructor() { this.requests = []; }
  request(name, options, callback) { this.requests.push({ name, options }); return callback({ name }); }
}
const expectCode = (code, fn) => assert.throws(fn, (error) => error?.code === code);

test('capacityとTTLはStorage定数を表示正本にする', () => {
  assert.match(html, /storage\.MAIN_INVENTORY_CAPACITY/); assert.match(html, /storage\.TEMP_BOX_CAPACITY/); assert.match(html, /storage\.UNCLAIMED_REWARD_CAPACITY/); assert.match(html, /view\.storage\.TEMP_BOX_TTL_MS/);
});
test('正式6部位とPhase 4Bのmini symbolをfilter/list/detailで再利用する', () => {
  assert.match(html, /gearModules\(\)\.domain\.SLOTS\.map/); assert.match(html, /gearSlotMiniHtml\(slot\.id\)/); assert.match(html, /gearSlotMiniHtml\(gear\.slotId\)/);
});
test('rarity・star・enhancement・recent・slot・set sortは表示だけで行う', () => {
  ['star', 'rarity', 'enhancement', 'recent', 'slot', 'set'].forEach((value) => assert.match(html, new RegExp(`value="${value}"`)));
  assert.match(html, /const entries = source\.map/); assert.doesNotMatch(html, /state\.(inventory|tempBox)\.sort/);
});
test('recent sortはproduction CPU rewardのepoch millisecondsとISO文字列を正しく扱う', () => {
  const source = html.match(/function gearAcquiredAtMs\(value\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(source); const acquiredAtMs = Function(`${source}; return gearAcquiredAtMs;`)();
  const older = cpuRewards.materializeCpuGearReward(cpuRewards.createCpuSettlementIntent({ runId: 'phase4d-recent-old', peakStreak: 3, outcome: 'defeat', settlementCreatedAtMs: 1770000000000 })).gears[0];
  const newer = cpuRewards.materializeCpuGearReward(cpuRewards.createCpuSettlementIntent({ runId: 'phase4d-recent-new', peakStreak: 3, outcome: 'defeat', settlementCreatedAtMs: 1770000005000 })).gears[0];
  assert.equal(acquiredAtMs(older.acquisition.acquiredAt), 1770000000000); assert.equal(acquiredAtMs(newer.acquisition.acquiredAt), 1770000005000);
  assert.deepEqual([older, newer].sort((a, b) => acquiredAtMs(b.acquisition.acquiredAt) - acquiredAtMs(a.acquisition.acquiredAt)).map((gear) => gear.gearId), [newer.gearId, older.gearId]);
  assert.equal(acquiredAtMs('2026-08-30T00:00:00Z'), Date.parse('2026-08-30T00:00:00Z')); assert.equal(acquiredAtMs('invalid'), 0);
});
test('favorite filterとlocked/favorite状態を画面へ出す', () => {
  assert.match(html, /gearStorageUi\.favoriteOnly/); assert.match(html, /entry\.favorite/); assert.match(html, /entry\.locked/); assert.match(html, /aria-pressed/);
});
test('metadata pure writerはGear objectとschemaを変えずInventoryだけを更新する', () => {
  const state = storage.createDefaultGearStorageState(); const gear = makeGear('metadata-inventory'); state.inventory.push({ gear, locked: false, favorite: false }); const beforeGear = JSON.stringify(gear);
  const result = rewards.setStoredGearMetadata(state, gear.gearId, { favorite: true });
  assert.equal(result.location, 'inventory'); assert.equal(result.favorite, true); assert.equal(result.locked, false); assert.equal(JSON.stringify(result.nextState.inventory[0].gear), beforeGear); assert.equal(state.inventory[0].favorite, false); assert.deepEqual(Object.keys(result.nextState).sort(), Object.keys(state).sort());
});
test('metadata pure writerはTEMP BOXのenteredAtMsを維持する', () => {
  const state = storage.createDefaultGearStorageState(); const gear = makeGear('metadata-temp', 'engine'); state.tempBox.push({ gear, locked: false, favorite: true, enteredAtMs: 123 });
  const result = rewards.setStoredGearMetadata(state, gear.gearId, { locked: true });
  assert.equal(result.location, 'tempBox'); assert.equal(result.nextState.tempBox[0].enteredAtMs, 123); assert.equal(result.nextState.tempBox[0].favorite, true); assert.equal(result.nextState.tempBox[0].locked, true);
});
test('metadata patchはfavorite/lockedのstrict booleanだけを許可する', () => {
  const state = storage.createDefaultGearStorageState(); state.inventory.push({ gear: makeGear('metadata-strict'), locked: false, favorite: false });
  expectCode('INVALID_GEAR_METADATA_PATCH', () => rewards.setStoredGearMetadata(state, 'metadata-strict', {})); expectCode('INVALID_GEAR_METADATA_PATCH', () => rewards.setStoredGearMetadata(state, 'metadata-strict', { favorite: 1 })); expectCode('INVALID_GEAR_METADATA_PATCH', () => rewards.setStoredGearMetadata(state, 'metadata-strict', { other: true }));
});
test('metadata persistenceは共有exclusive lockでexactly once保存・read-backする', async () => {
  const target = new FakeStorage(); const lockManager = new LockManager(); const state = storage.createDefaultGearStorageState(); state.inventory.push({ gear: makeGear('metadata-persist'), locked: false, favorite: false }); storage.saveGearState(state, target); const beforeWrites = target.setCount;
  const result = await rewards.persistSetGearEntryMetadata('metadata-persist', { favorite: true, locked: true }, target, { lockManager });
  assert.equal(target.setCount, beforeWrites + 1); assert.deepEqual(lockManager.requests, [{ name: rewards.GEAR_MUTATION_LOCK_NAME, options: { mode: 'exclusive' } }]); assert.equal(result.favorite, true); assert.equal(storage.loadGearState(target).inventory[0].locked, true);
});
test('WAL pending中はmetadataをfail closedしGear Storageを変更しない', async () => {
  const target = new FakeStorage(); const state = storage.createDefaultGearStorageState(); state.inventory.push({ gear: makeGear('metadata-wal'), locked: false, favorite: false }); storage.saveGearState(state, target); const before = target.getItem(storage.GEAR_STORAGE_KEY); target.setItem(rewards.GEAR_TRANSACTION_STORAGE_KEY, '{pending');
  await assert.rejects(() => rewards.persistSetGearEntryMetadata('metadata-wal', { locked: true }, target, { lockManager: new LockManager() }), (error) => error?.code === 'PENDING_GEAR_TRANSACTION_EXISTS'); assert.equal(target.getItem(storage.GEAR_STORAGE_KEY), before);
});
test('TEMP countdownはenteredAtMsとcanonical TTLだけから表示する', () => { assert.match(html, /entry\.enteredAtMs \+ ttlMs - nowMs/); assert.match(html, /残り\$\{hours\}時間/); assert.match(html, /hours <= 6/); });
test('TEMP BOXはlockedでも期限保護を示さずlock toggleを出さない', () => {
  assert.match(html, /保護設定に関係なく、期限を過ぎたGearは自動分解されます/); assert.match(html, /gearStorageUi\.tab === 'inventory' \? `<button[^`]+data-gear-storage-lock/); assert.match(html, /' · 期限保護なし'/);
  assert.match(html, /rewards\.persistStorageMaintenance/); assert.doesNotMatch(html, /entry\.locked[^\n]+TEMP_BOX_TTL_MS|TEMP_BOX_TTL_MS[^\n]+entry\.locked/);
});
test('装備中はcurrent character/presetだけで他presetを区別する', () => {
  const source = html.match(/function gearStoragePresetUsage\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(source, /gearUi\.characterId/); assert.match(source, /gearUi\.presetId/); assert.match(source, /presets\.resolvePreset/);
  assert.match(html, /<span class="gearStorageBadge">装備中<\/span>/); assert.match(html, /<span class="gearStorageBadge">プリセット登録<\/span>/);
  assert.doesNotMatch(source, /return ids/);
});
test('maintenanceは既存persistStorageMaintenanceだけを呼び返却resultを表示する', () => {
  assert.match(html, /rewards\.persistStorageMaintenance\(Date\.now\(\), localStorage\)/); ['movedGearIds', 'expiredGearIds', 'powderGained', 'blueprintShardsGained'].forEach((key) => assert.match(html, new RegExp(`result\\.${key}`)));
  assert.doesNotMatch(html, /function gearStorageRunMaintenance[\s\S]*?calculateDismantleYield/);
});
test('Workbench導線はInventory gearIdをfocusするが自動装備しない', () => {
  const source = html.match(/function openGearWorkshopForGear\(gearId\) \{[\s\S]*?return true;\r?\n  \}/)?.[0] || '';
  assert.ok(source);
  assert.match(source, /gearUi\.comparisonGearId = entry\.gear\.gearId/);
  assert.doesNotMatch(source, /gearMutateSlot/);
});
test('未受取はPhase 4CのpresentFirstPendingGearRewardを再利用する', () => {
  const handler = html.match(/gearStoragePendingEl\.addEventListener\([^\r\n]+/)?.[0] || '';
  assert.match(handler, /presentFirstPendingGearReward\(\)/);
  assert.doesNotMatch(handler, /persistClaimReward/);
});
test('ONLINE中はGear Storageを開かず既存Workbench方針と一致する', () => { assert.match(html, /async function openGearStorage\(\) \{\r?\n    if \(isOnline\?\.\(\)\) return false/); });
test('手動分解・強化・TEMP手動移動をPhase 4D UIへ追加しない', () => { const section = html.match(/\/\/ ===== Gear Storage \/ TEMP BOX =====[\s\S]*?globalThis\.KatamonGearStorageUi/)[0]; assert.doesNotMatch(section, /dismantleStoredGear|enhanceStoredGear|manualMove|moveTemp/); });

Promise.all(pending).then(() => console.log(`gear-inventory-tempbox-phase4d: ${passed}/${18} passed`)).catch((error) => { console.error(error); process.exitCode = 1; });
