const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const rewards = require('../shared/gear-rewards.js');
const presets = require('../shared/gear-presets.js');
const presetStorage = require('../shared/gear-preset-storage.js');
const transactions = require('../shared/gear-transactions.js');
const foundation = require('../coop-mvp-foundation.js');

const CHARACTER_IDS = ['kyoryu'];
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function reject(code, fn) { await assert.rejects(fn, (error) => error?.code === code); }
function makeGear(gearId, slotId = 'barrel', level = 0) {
  const item = domain.createGear({
    gearId, generationSeed: `g:${gearId}`, enhancementSeed: `e:${gearId}`,
    sourceId: 'cpu_battle', sourceDetail: { phase: '4e' }, acquiredAt: 1,
    qualityProfile: { id: 'phase4e-quality', starWeights: [{ id: 5, weight: 1 }], rarityWeights: [{ id: 'epic', weight: 1 }] },
    setProfile: { id: 'phase4e-set', setWeights: [{ id: 'assault', weight: 1 }] }, slotId,
  });
  return level ? domain.enhanceGear(item, level) : item;
}
function createQueuedLockManager() {
  let tail = Promise.resolve(); let active = 0; let peak = 0;
  return {
    request(name, options, callback) {
      assert.equal(name, rewards.GEAR_MUTATION_LOCK_NAME); assert.deepEqual(options, { mode: 'exclusive' });
      const before = tail; let release; tail = new Promise((resolve) => { release = resolve; });
      return before.then(async () => { active += 1; peak = Math.max(peak, active); try { return await callback({ name }); } finally { active -= 1; release(); } });
    },
    peak: () => peak,
  };
}
class FakeStorage {
  constructor(lockManager = createQueuedLockManager()) { this.values = new Map(); this.gearMutationLockManager = lockManager; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function seedStorage(entries, options = {}) {
  const lockManager = options.lockManager || createQueuedLockManager(); const target = new FakeStorage(lockManager);
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = entries.map((entry) => ({ gear: entry.gear, favorite: Boolean(entry.favorite), locked: Boolean(entry.locked) }));
  state.resources.powder = options.powder ?? 1000; state.resources.blueprintShards = options.blueprintShards ?? 25;
  if (options.tempGear) state.tempBox.push({ gear: options.tempGear, favorite: false, locked: false, enteredAtMs: 1 });
  gearStorage.saveGearState(state, target);
  const foundationState = foundation.createDefaultState(); foundationState.wallet.coins = options.coins ?? 1000; foundation.saveState(foundationState, target);
  presetStorage.save(presets.createInitialState(CHARACTER_IDS), target, { characterIds: CHARACTER_IDS });
  return target;
}
async function equip(target, gearId, presetId = 'preset1') {
  return presetStorage.setPresetSlotValidatedLocked({ characterId: 'kyoryu', presetId, slotId: 'barrel', gearId }, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager });
}

test('Domain preview/cost/milestonesとMAXをUI正本にする', () => {
  const item = makeGear('preview'); const preview = domain.previewEnhancement(item, 3); const cost = domain.calculateEnhancementCost(0, 3);
  assert.equal(preview.gear.enhancementLevel, 3); assert.deepEqual(preview.milestones.map((event) => event.level), [3]); assert.ok(cost.coins > 0 && cost.powder > 0);
  assert.match(html, /domain\.previewEnhancement/); assert.match(html, /domain\.calculateEnhancementCost/); assert.match(html, /domain\.MAX_ENHANCEMENT_LEVEL/); assert.match(html, /domain\.ENHANCEMENT_MILESTONES/);
});
test('Inventory manual dismantleはcanonical yieldだけをexact加算しCoinを変えない', async () => {
  const item = makeGear('dismantle-ok', 'barrel', 3); const other = makeGear('other', 'armor'); const target = seedStorage([{ gear: item, favorite: true }, { gear: other }]);
  const before = gearStorage.loadGearState(target); const coins = transactions.loadStrictFoundationState(target).state.wallet.coins; const expected = domain.calculateDismantleYield(item);
  const result = await rewards.persistDismantleInventoryGear(item.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager });
  const after = gearStorage.loadGearState(target); assert.deepEqual(result.yield, expected); assert.equal(after.inventory.some((entry) => entry.gear.gearId === item.gearId), false);
  assert.equal(after.inventory[0].gear.gearId, other.gearId); assert.equal(after.resources.powder, before.resources.powder + expected.powder); assert.equal(after.resources.blueprintShards, before.resources.blueprintShards + expected.blueprintShards);
  assert.equal(transactions.loadStrictFoundationState(target).state.wallet.coins, coins);
});
test('locked・TEMP・missing・WAL・overflowをauthorityでfail closed', async () => {
  const locked = makeGear('locked'); const temp = makeGear('temp'); const target = seedStorage([{ gear: locked, locked: true }], { tempGear: temp });
  const before = target.getItem(gearStorage.GEAR_STORAGE_KEY);
  await reject('GEAR_LOCKED', () => rewards.persistDismantleInventoryGear(locked.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager }));
  await reject('GEAR_NOT_IN_INVENTORY', () => rewards.persistDismantleInventoryGear(temp.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager }));
  await reject('GEAR_NOT_IN_INVENTORY', () => rewards.persistDismantleInventoryGear('missing', target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager }));
  assert.equal(target.getItem(gearStorage.GEAR_STORAGE_KEY), before);
  target.setItem(rewards.GEAR_TRANSACTION_STORAGE_KEY, '{}'); await reject('PENDING_GEAR_TRANSACTION_EXISTS', () => rewards.persistDismantleInventoryGear(locked.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager })); target.removeItem(rewards.GEAR_TRANSACTION_STORAGE_KEY);
  const overflowGear = makeGear('overflow'); const overflow = seedStorage([{ gear: overflowGear }]); const overflowState = gearStorage.loadGearState(overflow); overflowState.resources.powder = Number.MAX_SAFE_INTEGER; gearStorage.saveGearState(overflowState, overflow);
  await reject('INTEGER_OVERFLOW', () => rewards.persistDismantleInventoryGear(overflowGear.gearId, overflow, { characterIds: CHARACTER_IDS, lockManager: overflow.gearMutationLockManager }));
});
test('current/other preset参照Gearはどちらもmanual dismantleを拒否', async () => {
  for (const presetId of ['preset1', 'preset2']) {
    const item = makeGear(`referenced-${presetId}`); const target = seedStorage([{ gear: item }]); await equip(target, item.gearId, presetId);
    await reject('GEAR_REFERENCED_BY_PRESET', () => rewards.persistDismantleInventoryGear(item.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager }));
    assert.equal(gearStorage.loadGearState(target).inventory[0].gear.gearId, item.gearId);
  }
});
test('validated equipはlatest Inventoryとslotをlock内で検証しunequipを許可', async () => {
  const item = makeGear('validated-equip'); const wrong = makeGear('wrong-slot', 'armor'); const target = seedStorage([{ gear: item }, { gear: wrong }]);
  await equip(target, item.gearId); assert.equal(presetStorage.load(target, { characterIds: CHARACTER_IDS }).characters.kyoryu.presets[0].slots.barrel, item.gearId);
  await reject('GEAR_PRESET_SLOT_MISMATCH', () => equip(target, wrong.gearId));
  await equip(target, null); assert.equal(presetStorage.load(target, { characterIds: CHARACTER_IDS }).characters.kyoryu.presets[0].slots.barrel, null);
  await rewards.persistDismantleInventoryGear(item.gearId, target, { characterIds: CHARACTER_IDS, lockManager: target.gearMutationLockManager });
  await reject('GEAR_NOT_IN_INVENTORY', () => equip(target, item.gearId));
});
test('equip-firstとdismantle-firstは同じlockでmissing preset refを作らない', async () => {
  const firstManager = createQueuedLockManager(); const firstGear = makeGear('race-equip-first'); const first = seedStorage([{ gear: firstGear }], { lockManager: firstManager });
  const results = await Promise.allSettled([equip(first, firstGear.gearId), rewards.persistDismantleInventoryGear(firstGear.gearId, first, { characterIds: CHARACTER_IDS, lockManager: firstManager })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason?.code, 'GEAR_REFERENCED_BY_PRESET'); assert.equal(gearStorage.loadGearState(first).inventory.length, 1); assert.equal(firstManager.peak(), 1);
  const secondManager = createQueuedLockManager(); const secondGear = makeGear('race-dismantle-first'); const second = seedStorage([{ gear: secondGear }], { lockManager: secondManager });
  const reversed = await Promise.allSettled([rewards.persistDismantleInventoryGear(secondGear.gearId, second, { characterIds: CHARACTER_IDS, lockManager: secondManager }), equip(second, secondGear.gearId)]);
  assert.equal(reversed[0].status, 'fulfilled'); assert.equal(reversed[1].reason?.code, 'GEAR_NOT_IN_INVENTORY'); assert.equal(presetStorage.load(second, { characterIds: CHARACTER_IDS }).characters.kyoryu?.presets?.[0]?.slots?.barrel ?? null, null); assert.equal(secondManager.peak(), 1);
});
test('production UIはatomic enhancement/recovery・manual writer・validated equipだけを呼ぶ', () => {
  assert.match(html, /transactions\.enhanceStoredGearAtomic/); assert.match(html, /transactions\.recoverPendingGearTransaction/); assert.match(html, /rewards\.persistDismantleInventoryGear/); assert.match(html, /presetStorage\.setPresetSlotValidatedLocked/);
  assert.doesNotMatch(html, /Math\.random\(\)[^\n]*transaction/i);
});
test('TEMP BOXには強化・manual dismantleを出さずlocked Gearは強化対象のまま', () => {
  assert.match(html, /gearStorageUi\.tab === 'inventory'/); assert.match(html, /最大強化済み/); assert.match(html, /分解保護中/); assert.match(html, /TEMP BOXのGearは強化・手動分解できません/);
});

(async () => {
  for (const entry of tests) { await entry.fn(); passed += 1; console.log(`  ok ${entry.name}`); }
  console.log(`gear-enhance-dismantle-phase4e: ${passed}/${tests.length} passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
