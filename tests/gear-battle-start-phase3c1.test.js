const assert = require('node:assert/strict');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const domain = globalThis.KatamonGearDomain;
const gearStorage = globalThis.KatamonGearStorage;
const presetDomain = globalThis.KatamonGearPresets;
const presetStorage = globalThis.KatamonGearPresetStorage;
const runStorage = globalThis.KatamonGearCpuRunStorage;

let passed = 0;
function test(name, fn) { try { fn(); passed += 1; console.log(`  ok ${name}`); } catch (error) { console.error(`  NG ${name}`); throw error; } }
const clone = (value) => JSON.parse(JSON.stringify(value));

function reset() {
  storage.clear();
  storage.gearMutationLockManager = globalThis.navigator.locks;
  kt.setHasSave(false);
  kt.setPhase('title');
}

function makeGear(id, slotId, setId = 'assault', requiredMainOp = null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const gear = domain.createGear({
    gearId: id,
    generationSeed: `phase3c1:${id}:generation:${attempt}`, enhancementSeed: `phase3c1:${id}:enhancement`,
    sourceId: 'cpu_battle', sourceDetail: { fixture: 'phase3c1' }, acquiredAt: '2026-08-26T00:00:00Z',
    qualityProfile: { id: 'phase3c1', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: 'phase3c1', setWeights: [{ id: setId, weight: 1 }] }, slotId,
  });
    if (requiredMainOp === null || gear.mainOp.opId === requiredMainOp) return gear;
  }
  throw new Error(`could not create ${slotId}/${requiredMainOp} test gear`);
}

function installPreset(characterId, gears) {
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory = gears.map((gear) => ({ gear, locked: false, favorite: false }));
  gearStorage.saveGearState(state, storage);
  let presets = presetStorage.load(storage, { characterIds: kt.chars() });
  for (const gear of gears) {
    presets = presetDomain.setPresetSlot(presets, {
      characterId, presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: kt.chars()
    });
  }
  presetStorage.save(presets, storage, { characterIds: kt.chars() });
}

test('empty cpu preset captures a Gearless snapshot and keeps the CPU baseline', () => {
  reset();
  const base = kt.cpuBattleBaseStatsForTest('kyoryu');
  assert.equal(kt.startBattle('kyoryu'), true);
  const player = kt.unitById('p1'); const cpu = kt.unitById('e1'); const snapshot = kt.cpuBattleGearSnapshotForTest();
  assert.equal(player.maxHp, base.baseHp); assert.equal(player.hp, base.baseHp);
  assert.equal(player.fuelMax, base.baseFuel); assert.equal(player.fuel, base.baseFuel);
  assert.equal(cpu.maxHp, kt.cpuBattleBaseStatsForTest(cpu.character).baseHp);
  assert.equal(snapshot.characterId, 'kyoryu'); assert.equal(snapshot.presetId, 'preset1');
  assert.equal(snapshot.derivedStats.attackMultiplier, 1, 'Attack remains only snapshot data in 3C-1');
});

test('CPU human applies only snapshot HP/Fuel while CPU remains Gearless', () => {
  reset();
  const armor = makeGear('phase3c1-armor', 'armor', 'life');
  const engine = makeGear('phase3c1-engine', 'engine', 'life', 'max_fuel');
  const sight = makeGear('phase3c1-sight', 'sight', 'life');
  const auxiliary = makeGear('phase3c1-auxiliary', 'auxiliary', 'life');
  const barrel = makeGear('phase3c1-barrel', 'barrel');
  installPreset('kyoryu', [armor, engine, sight, auxiliary, barrel]);
  const base = kt.cpuBattleBaseStatsForTest('kyoryu');
  assert.equal(kt.startBattle('kyoryu'), true);
  const snapshot = kt.cpuBattleGearSnapshotForTest(); const player = kt.unitById('p1'); const cpu = kt.unitById('e1');
  assert.equal(player.maxHp, snapshot.derivedStats.maxHp); assert.equal(player.hp, snapshot.derivedStats.maxHp);
  assert.equal(player.fuelMax, snapshot.derivedStats.maxFuel); assert.equal(player.fuel, snapshot.derivedStats.currentFuelAtBattleStart);
  assert(snapshot.derivedStats.maxHp > base.baseHp); assert(snapshot.slots.engine, 'engine is captured'); assert.notEqual(snapshot.derivedStats.maxFuel, base.baseFuel, `engine main must be reflected through the Phase 3B calculator (${snapshot.derivedStats.maxFuel}/${base.baseFuel}; ${JSON.stringify(snapshot.slots.engine.mainOp)})`);
  assert.equal(cpu.maxHp, kt.cpuBattleBaseStatsForTest(cpu.character).baseHp);
  assert.equal(player.damageMultiplier, undefined, '3C-1 does not wire attack into the unit');
  assert.equal(snapshot.derivedStats.conditional.lifeInitialShieldBp, 800, 'life4 capability may be snapshotted only');
  assert.equal(Object.hasOwn(player, 'numericGearShield'), false, 'life4 does not create the Phase 3C-3 numeric shield resource');
});

test('stale preset and pending WAL reject before CPU run or battle mutation', () => {
  reset();
  const missing = makeGear('phase3c1-missing', 'armor');
  let presets = presetStorage.load(storage, { characterIds: kt.chars() });
  presets = presetDomain.setPresetSlot(presets, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'armor', gearId: missing.gearId, characterIds: kt.chars() });
  presetStorage.save(presets, storage, { characterIds: kt.chars() });
  assert.equal(kt.startBattle('kyoryu'), false);
  assert.equal(kt.state().gamePhase, 'title'); assert.equal(storage.getItem(runStorage.CPU_GEAR_RUN_STORAGE_KEY), null);
  reset(); storage.setItem(presetStorage.WAL_KEY, '{}');
  assert.equal(kt.startBattle('kyoryu'), false);
  assert.equal(storage.getItem(runStorage.CPU_GEAR_RUN_STORAGE_KEY), null);
});

test('no Web Lock rejects before start, and post-start Gear/Presets changes cannot alter the live snapshot', () => {
  reset();
  const armor = makeGear('phase3c1-isolation-armor', 'armor'); const engine = makeGear('phase3c1-isolation-engine', 'engine', 'assault', 'max_fuel');
  installPreset('kyoryu', [armor, engine]); assert.equal(kt.startBattle('kyoryu'), true);
  const before = kt.cpuBattleGearSnapshotForTest(); const hp = kt.unitById('p1').maxHp; const fuel = kt.unitById('p1').fuelMax;
  gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), storage);
  let state = presetStorage.load(storage, { characterIds: kt.chars() });
  state = presetDomain.setPresetSlot(state, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'armor', gearId: null, characterIds: kt.chars() });
  presetStorage.save(state, storage, { characterIds: kt.chars() });
  assert.deepEqual(kt.cpuBattleGearSnapshotForTest(), before); assert.equal(kt.unitById('p1').maxHp, hp); assert.equal(kt.unitById('p1').fuelMax, fuel);
  reset(); const originalLocks = globalThis.navigator.locks; const originalManager = storage.gearMutationLockManager;
  globalThis.navigator.locks = undefined; delete storage.gearMutationLockManager;
  try { assert.equal(kt.startBattle('kyoryu'), false); assert.equal(storage.getItem(runStorage.CPU_GEAR_RUN_STORAGE_KEY), null); }
  finally { globalThis.navigator.locks = originalLocks; storage.gearMutationLockManager = originalManager; }
});

test('official suspend restores its original Gear snapshot and current HP/Fuel without recapture', () => {
  reset();
  const armor = makeGear('phase3c1-suspend-armor', 'armor'); const engine = makeGear('phase3c1-suspend-engine', 'engine', 'assault', 'max_fuel');
  installPreset('kyoryu', [armor, engine]); assert.equal(kt.startBattle('kyoryu'), true);
  const original = kt.cpuBattleGearSnapshotForTest(); const player = kt.unitById('p1');
  player.hp -= 17; player.fuel = Math.max(0, player.fuel - 4); const hp = player.hp; const fuel = player.fuel;
  assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true);
  gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), storage);
  kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true);
  assert.deepEqual(kt.cpuBattleGearSnapshotForTest(), original);
  assert.equal(kt.unitById('p1').maxHp, original.derivedStats.maxHp); assert.equal(kt.unitById('p1').hp, hp);
  assert.equal(kt.unitById('p1').fuelMax, original.derivedStats.maxFuel); assert.equal(kt.unitById('p1').fuel, fuel);
});

test('the next CPU round captures current storage afresh while the prior match stays frozen', () => {
  reset();
  const firstArmor = makeGear('phase3c1-next-first', 'armor'); installPreset('kyoryu', [firstArmor]);
  assert.equal(kt.startBattle('kyoryu'), true); const first = kt.cpuBattleGearSnapshotForTest(); const firstHp = kt.unitById('p1').maxHp;
  const secondArmor = makeGear('phase3c1-next-second', 'armor'); installPreset('kyoryu', [secondArmor]);
  assert.deepEqual(kt.cpuBattleGearSnapshotForTest(), first); assert.equal(kt.unitById('p1').maxHp, firstHp);
  assert.equal(kt.continueCpuGearRunAfterWinForTest(), true);
  const second = kt.cpuBattleGearSnapshotForTest(); assert.notEqual(second.slots.armor.gearId, first.slots.armor.gearId);
  assert.equal(kt.unitById('p1').maxHp, second.derivedStats.maxHp);
});

test('legacy Gearless suspend remains resumable, but a current malformed Gear field fails closed', () => {
  reset(); assert.equal(kt.startBattle('kyoryu'), true); const legacy = JSON.parse(storage.getItem('katamon_suspend_v1')); legacy.v = 4; delete legacy.cpuBattleGearSnapshot; delete legacy.cpuBattleGearSnapshotVersion; delete legacy.cpuGearCritState; delete legacy.cpuGearCritStateVersion; delete legacy.cpuGearStatusState; delete legacy.cpuGearStatusStateVersion; delete legacy.cpuGearShieldState; delete legacy.cpuGearShieldStateVersion;
  storage.setItem('katamon_suspend_v1', JSON.stringify(legacy)); kt.setPhase('title'); assert.equal(kt.resumeCpuSuspendForTest(), true); assert.equal(kt.cpuBattleGearSnapshotForTest(), null);
  reset(); assert.equal(kt.startBattle('kyoryu'), true); assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true); const malformed = JSON.parse(storage.getItem('katamon_suspend_v1')); malformed.cpuBattleGearSnapshot.derivedStats.maxHp += 1;
  storage.setItem('katamon_suspend_v1', JSON.stringify(malformed)); kt.setPhase('title');
  assert.equal(kt.resumeCpuSuspendForTest(), false, 'current malformed Gear data must not fall back to Gearless resume');
});

test('official Gear suspend binds outer HP/Fuel runtime values to the immutable snapshot', () => {
  reset();
  const armor = makeGear('phase3c1-runtime-armor', 'armor'); const engine = makeGear('phase3c1-runtime-engine', 'engine', 'assault', 'max_fuel');
  installPreset('kyoryu', [armor, engine]); assert.equal(kt.startBattle('kyoryu'), true); assert.equal(kt.saveCpuBattleAtTurnStartForTest(), true);
  const forged = JSON.parse(storage.getItem('katamon_suspend_v1')); const saved = forged.units.find((unit) => unit.id === 'p1');
  saved.maxHp = 9999; saved.hp = 9999; saved.fuelMax = 9999; saved.fuel = 9999;
  storage.setItem('katamon_suspend_v1', JSON.stringify(forged)); kt.setPhase('title');
  assert.doesNotThrow(() => assert.equal(kt.resumeCpuSuspendForTest(), false));
  assert.notEqual(kt.state().gamePhase, 'battle');
});

function normalProjectileEvidence(gears) {
  reset(); if (gears.length) installPreset('kyoryu', gears); assert.equal(kt.startBattle('kyoryu'), true);
  const cpu = kt.unitById('e1'); const beforeHp = cpu.hp; const beforeRandom = Math.random; let randomCalls = 0;
  Math.random = () => { randomCalls += 1; return 0.25; };
  try {
    kt.fireForTest(280, -170); const projectile = kt.projectileProfilesForTest()[0];
    kt.explodeAtForTest(cpu.x, cpu.y, 1, 'p1', false);
    const player = kt.unitById('p1'); const playerHpBefore = player.hp;
    kt.explodeAtForTest(player.x, player.y, 1, 'e1', false);
    return { damage: beforeHp - cpu.hp, incomingDamage: playerHpBefore - player.hp, randomCalls, projectile: { blastMul: projectile.blastMul, terrainBlastMul: projectile.terrainBlastMul, knockbackSpeed: projectile.knockbackSpeed } };
  } finally { Math.random = beforeRandom; }
}

test('Attack/Defense/Crit/Blast/Impact stay inert in CPU 3C-1 while HP/Fuel remain active', () => {
  const none = normalProjectileEvidence([]);
  const gears = [
    makeGear('phase3c1-inert-barrel', 'barrel', 'assault'), makeGear('phase3c1-inert-armor', 'armor', 'fortify'),
    makeGear('phase3c1-inert-sight', 'sight', 'critical'), makeGear('phase3c1-inert-aux', 'auxiliary', 'blast'),
    makeGear('phase3c1-inert-engine', 'engine', 'impact', 'max_fuel')
  ];
  const equipped = normalProjectileEvidence(gears);
  assert.equal(equipped.damage, none.damage, 'Attack/Defense are not connected to CPU damage yet');
  assert.equal(equipped.incomingDamage, none.incomingDamage, 'Defense Gear does not alter the player\'s received damage yet');
  assert.deepEqual(equipped.projectile, none.projectile, 'Blast/Impact do not alter normal projectile properties yet');
  assert.equal(equipped.randomCalls, none.randomCalls, 'Crit adds no random consumption in 3C-1');
});

console.log(`gear-battle-start-phase3c1: ${passed}/9 passed`);
