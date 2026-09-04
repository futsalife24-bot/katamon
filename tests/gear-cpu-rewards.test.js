const assert = require('node:assert/strict');
const fs = require('node:fs');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const gearRewards = require('../shared/gear-rewards.js');
const cpu = require('../shared/gear-cpu-rewards.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.error(`  NG   ${name}`); throw error; }
}
function expectCode(code, fn) { assert.throws(fn, (error) => error && error.code === code, `expected ${code}`); }
function intent(runId, peakStreak, outcome = 'voluntary', settlementCreatedAtMs = 123456) {
  return cpu.createCpuSettlementIntent({ runId, peakStreak, outcome, settlementCreatedAtMs });
}

test('品質・個数・設計片・次節目の全境界を固定する', () => {
  const cases = [
    [0, 'cpu-streak-3', 0, 0, 3, false], [1, 'cpu-streak-3', 0, 0, 3, false], [2, 'cpu-streak-3', 0, 0, 3, false],
    [3, 'cpu-streak-3', 1, 0, 5, false], [4, 'cpu-streak-3', 1, 0, 5, false],
    [5, 'cpu-streak-5', 1, 0, 8, false], [7, 'cpu-streak-5', 1, 0, 8, false],
    [8, 'cpu-streak-8', 1, 0, 10, false], [9, 'cpu-streak-8', 1, 0, 10, false],
    [10, 'cpu-streak-10', 2, 0, 15, false], [14, 'cpu-streak-10', 2, 0, 15, false],
    [15, 'cpu-streak-15', 2, 0, 20, false], [19, 'cpu-streak-15', 2, 0, 20, false],
    [20, 'cpu-streak-15', 3, 30, 30, true], [29, 'cpu-streak-15', 3, 30, 30, true],
    [30, 'cpu-streak-15', 4, 80, 50, true], [49, 'cpu-streak-15', 4, 80, 50, true],
    [50, 'cpu-streak-15', 5, 180, null, true], [100, 'cpu-streak-15', 5, 180, null, true],
  ];
  cases.forEach(([peak, qualityProfileId, gearCount, blueprintShards, next, locked]) => {
    const preview = cpu.previewCpuSettlement({ peakStreak: peak, outcome: 'voluntary' });
    assert.equal(preview.qualityProfileId, qualityProfileId, `peak ${peak}`);
    assert.equal(preview.gearCount, gearCount); assert.equal(preview.blueprintShards, blueprintShards);
    assert.equal(preview.highestQualityLocked, locked);
    assert.equal(preview.nextMilestone && preview.nextMilestone.peakStreak, next);
  });
});
test('敗北・引き分けは15〜19だけ品質を10へ下げ、20以降は最高品質を維持する', () => {
  [[14, 10, 2, 0], [15, 10, 2, 0], [19, 10, 2, 0], [20, 15, 3, 30], [30, 15, 4, 80], [50, 15, 5, 180]].forEach(([peak, tier, count, shards]) => {
    ['defeat', 'draw'].forEach((outcome) => {
      const preview = cpu.previewCpuSettlement({ peakStreak: peak, outcome });
      assert.equal(preview.qualityTier, tier); assert.equal(preview.gearCount, count); assert.equal(preview.blueprintShards, shards);
    });
  });
});
test('settlement intentはrunId・最初のtimestampから安定し、規則外改ざんを拒否する', () => {
  const value = intent('run-a', 15, 'defeat', 999);
  assert.deepEqual(value, {
    rewardRulesVersion: 1,
    runId: 'run-a', rewardId: 'cpu:run-a:settlement', settlementCreatedAtMs: 999,
    peakStreak: 15, outcome: 'defeat', qualityProfileId: 'cpu-streak-10', gearCount: 2, blueprintShards: 0,
  });
  assert.deepEqual(cpu.validateCpuSettlementIntent(JSON.parse(JSON.stringify(value))), value);
  expectCode('CPU_SETTLEMENT_INTENT_MISMATCH', () => cpu.validateCpuSettlementIntent({ ...value, gearCount: 5 }));
  expectCode('UNSUPPORTED_FUTURE_CPU_REWARD_RULES_VERSION', () => cpu.validateCpuSettlementIntent({ ...value, rewardRulesVersion: 2 }));
  expectCode('UNSUPPORTED_CPU_REWARD_RULES_VERSION', () => cpu.validateCpuSettlementIntent({ ...value, rewardRulesVersion: 0 }));
  expectCode('INVALID_CPU_SETTLEMENT_OUTCOME', () => cpu.previewCpuSettlement({ peakStreak: 1, outcome: 'win' }));
  expectCode('INVALID_CPU_REWARD_INPUT', () => cpu.createCpuSettlementIntent({ runId: '', peakStreak: 3, outcome: 'voluntary', settlementCreatedAtMs: 0 }));
});
test('symbol・accessor・non-enumerable fieldを静かに受理しない', () => {
  const symbolInput = { peakStreak: 3, outcome: 'voluntary' };
  symbolInput[Symbol('hidden')] = true;
  expectCode('INVALID_CPU_REWARD_INPUT', () => cpu.previewCpuSettlement(symbolInput));
  const accessorInput = { peakStreak: 3, outcome: 'voluntary' };
  Object.defineProperty(accessorInput, 'outcome', { enumerable: true, get: () => 'voluntary' });
  expectCode('INVALID_CPU_REWARD_INPUT', () => cpu.previewCpuSettlement(accessorInput));
  const nonEnumerableInput = { peakStreak: 3, outcome: 'voluntary' };
  Object.defineProperty(nonEnumerableInput, 'hidden', { enumerable: false, value: true });
  expectCode('INVALID_CPU_REWARD_INPUT', () => cpu.previewCpuSettlement(nonEnumerableInput));
});
test('同じintentは完全に同一のreward envelopeとGearを再生成する', () => {
  const value = intent('run-deterministic', 30, 'defeat', 777);
  const first = cpu.materializeCpuGearReward(value);
  const second = cpu.materializeCpuGearReward(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(second, first);
  assert.equal(first.rewardId, 'cpu:run-deterministic:settlement');
  assert.equal(first.sourceId, 'cpu_battle'); assert.equal(first.createdAtMs, 777);
  first.gears.forEach((item, index) => {
    assert.equal(item.gearId, `cpu:run-deterministic:gear:${index}`);
    assert.equal(item.enhancementSeed, `cpu:run-deterministic:gear:${index}:enhancement:v1`);
    assert.equal(item.acquisition.acquiredAt, 777);
    assert.equal(item.acquisition.detail.qualityProfileId, 'cpu-streak-15');
  });
  assert.notDeepEqual(cpu.materializeCpuGearReward(intent('run-other', 30, 'defeat', 777)), first);
});
test('代表CPU intent vectorはidentity・抽選結果・固定mainを固定する', () => {
  const runId = 'cpu-run:00000000-0000-4000-8000-000000000001';
  const reward = cpu.materializeCpuGearReward(intent(runId, 50, 'voluntary', 123456));
  assert.deepEqual(reward.gears.map((item) => ({
    gearId: item.gearId,
    slotId: item.slotId,
    setId: item.setId,
    star: item.star,
    rarityId: item.rarityId,
    main: item.mainOp,
    subOps: item.subOps.map((sub) => [sub.opId, sub.initialValueBp]),
    enhancementSeed: item.enhancementSeed,
    acquiredAt: item.acquisition.acquiredAt,
  })), [
    { gearId: `cpu:${runId}:gear:0`, slotId: 'core', setId: 'life', star: 5, rarityId: 'epic', main: { opId: 'flat_defense', unit: 'flat', value: 2, finalValue: 10 }, subOps: [['hp_pct', 516], ['shield_power', 518]], enhancementSeed: `cpu:${runId}:gear:0:enhancement:v1`, acquiredAt: 123456 },
    { gearId: `cpu:${runId}:gear:1`, slotId: 'armor', setId: 'rescue', star: 6, rarityId: 'rare', main: { opId: 'flat_hp', unit: 'flat', value: 3, finalValue: 12 }, subOps: [['crit_rate', 525]], enhancementSeed: `cpu:${runId}:gear:1:enhancement:v1`, acquiredAt: 123456 },
    { gearId: `cpu:${runId}:gear:2`, slotId: 'engine', setId: 'life', star: 5, rarityId: 'epic', main: { opId: 'knockback_power', unit: 'bp', value: 600, finalValue: 2400 }, subOps: [['knockback_power', 410], ['shield_power', 442]], enhancementSeed: `cpu:${runId}:gear:2:enhancement:v1`, acquiredAt: 123456 },
    { gearId: `cpu:${runId}:gear:3`, slotId: 'engine', setId: 'rescue', star: 5, rarityId: 'epic', main: { opId: 'knockback_power', unit: 'bp', value: 600, finalValue: 2400 }, subOps: [['defense_pct', 550], ['crit_rate', 589]], enhancementSeed: `cpu:${runId}:gear:3:enhancement:v1`, acquiredAt: 123456 },
    { gearId: `cpu:${runId}:gear:4`, slotId: 'armor', setId: 'assault', star: 5, rarityId: 'mythic', main: { opId: 'flat_hp', unit: 'flat', value: 2, finalValue: 10 }, subOps: [['knockback_power', 574], ['defense_pct', 408], ['received_shield', 417], ['attack_pct', 565]], enhancementSeed: `cpu:${runId}:gear:4:enhancement:v1`, acquiredAt: 123456 },
  ]);
});
test('CPU materialization uses the existing CPU quality tables and the exactly-uniform set profile', () => {
  const reward = cpu.materializeCpuGearReward(intent('quality-table', 10));
  reward.gears.forEach((item) => {
    assert.ok(gear.SLOT_IDS.includes(item.slotId)); assert.ok(gear.SET_IDS.includes(item.setId));
    assert.equal(item.acquisition.sourceId, 'cpu_battle');
  });
  assert.deepEqual(gear.GEAR_SET_PROFILES.uniform.setWeights.map((entry) => entry.weight), Array(8).fill(1));
  assert.equal(Object.hasOwn(gear.CPU_BATTLE_QUALITY_PROFILES.streak10, 'setWeights'), false);
});
test('materialized CPU envelopeはPhase 2Bのstrict queueへ通常JSON配列として渡せる', () => {
  const reward = cpu.materializeCpuGearReward(intent('queue-shape', 20, 'voluntary', 1));
  assert.equal(Object.getOwnPropertyDescriptor(reward.gears, 'length').writable, true);
  const queued = gearRewards.queueUnclaimedReward(gearStorage.createDefaultGearStorageState(), reward);
  assert.equal(queued.queued, true);
  assert.equal(queued.nextState.unclaimedRewards[0].gears.length, 3);
});
test('fixed deterministic CPU vectors cover all six slots and production fixed mains', () => {
  const found = new Map();
  for (let index = 0; index < 200 && found.size < gear.SLOT_IDS.length; index += 1) {
    const reward = cpu.materializeCpuGearReward(intent(`slot-vector-${index}`, 50, 'voluntary', 1));
    reward.gears.forEach((item) => { if (!found.has(item.slotId)) found.set(item.slotId, item); });
  }
  assert.deepEqual([...found.keys()].sort(), [...gear.SLOT_IDS].sort());
  ['barrel', 'armor', 'core'].forEach((slotId) => {
    const item = found.get(slotId);
    assert.ok(item); assert.ok(item.mainOp.value > 0); assert.doesNotThrow(() => gear.validateGear(item));
  });
});
test('0〜2の空精算もpure preview/intentは可能だがmaterialized envelopeは空のまま', () => {
  const value = intent('no-reward', 2, 'voluntary', 0);
  const reward = cpu.materializeCpuGearReward(value);
  assert.equal(reward.gears.length, 0); assert.equal(reward.blueprintShards, 0);
  assert.equal(cpu.previewCpuSettlement({ peakStreak: 2, outcome: 'voluntary' }).hasReward, false);
});
test('希少CPU個体は4戦目以降の非ボス戦だけをrunId+ordinalから5%で決め、別報酬を安定生成する', () => {
  const runId = 'rare-vector-20';
  assert.equal(cpu.createCpuRareEncounter({ runId, matchOrdinal: 2 }), null, 'third battle is too early');
  assert.equal(cpu.createCpuRareEncounter({ runId, matchOrdinal: 10 }), null, 'boss ordinal is always excluded');
  const encounter = cpu.createCpuRareEncounter({ runId, matchOrdinal: 3 });
  assert.deepEqual(encounter, { encounterId: 'cpu:rare-vector-20:rare:3', runId, matchOrdinal: 3 });
  assert.deepEqual(cpu.validateCpuRareEncounter(JSON.parse(JSON.stringify(encounter))), encounter);
  const first = cpu.materializeCpuRareGearReward({ encounter, createdAtMs: 3 });
  const second = cpu.materializeCpuRareGearReward({ encounter, createdAtMs: 3 });
  assert.deepEqual(second, first);
  assert.equal(first.rewardId, 'cpu:rare-vector-20:rare:3:reward');
  assert.equal(first.sourceId, 'cpu_rare_drop'); assert.equal(first.blueprintShards, 0);
  assert.equal(first.gears.length, 1); assert.equal(first.gears[0].gearId, 'cpu:rare-vector-20:rare:3:gear:0');
  assert.ok(first.gears[0].star >= 5); assert.ok(['epic', 'legend', 'mythic'].includes(first.gears[0].rarityId));
  assert.equal(first.gears[0].acquisition.sourceId, 'cpu_rare_drop');
  assert.equal(first.gears[0].acquisition.detail.matchOrdinal, 3);
  assert.deepEqual(cpu.CPU_RARE_QUALITY_PROFILE.starWeights, [{ id: 5, weight: 75 }, { id: 6, weight: 25 }]);
  assert.deepEqual(cpu.CPU_RARE_QUALITY_PROFILE.rarityWeights, [{ id: 'epic', weight: 70 }, { id: 'legend', weight: 25 }, { id: 'mythic', weight: 5 }]);
  assert.deepEqual(gear.GEAR_SET_PROFILES.uniform.setWeights.map((entry) => entry.weight), Array(8).fill(1));
  expectCode('CPU_RARE_ENCOUNTER_ID_MISMATCH', () => cpu.validateCpuRareEncounter({ ...encounter, encounterId: 'changed' }));
  expectCode('CPU_RARE_ENCOUNTER_NOT_ELIGIBLE', () => cpu.validateCpuRareEncounter({ encounterId: `cpu:${runId}:rare:10`, runId, matchOrdinal: 10 }));
});
test('pure module never reads time/random/storage/DOM or game entrypoints', () => {
  const source = fs.readFileSync(require.resolve('../shared/gear-cpu-rewards.js'), 'utf8');
  ['Date.now', 'Math.random', 'crypto.', 'localStorage', 'document.', 'index.html'].forEach((forbidden) => assert.equal(source.includes(forbidden), false, forbidden));
});

console.log(`gear-cpu-rewards: ${passed}/${passed} passed`);
