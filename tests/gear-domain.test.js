const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Phase 1はゲーム本体に接続しない。ここでは純粋ドメインだけを直接読む。
const gear = require('../shared/gear-domain.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  NG   ${name}`);
    throw error;
  }
}
function expectCode(code, fn) {
  assert.throws(fn, (error) => error && error.code === code, `expected ${code}`);
}

// 未登録versionの境界検査だけに使う。値は本番v1と同一で、通常の
// 生成・強化・GS・保存テストはすべて本番BALANCE_TUNINGを通す。
const VERSION_2_TEST_TUNING = Object.freeze({ ...gear.BALANCE_TUNING, version: 2 });

function fixedProfile(id, star, rarityId) {
  return {
    id,
    starWeights: [{ id: star, weight: 1 }],
    rarityWeights: [{ id: rarityId, weight: 1 }],
  };
}
function fixedSetProfile(id, setId = 'assault') {
  return { id, setWeights: [{ id: setId, weight: 1 }] };
}
function makeGear({
  gearId = 'gear-a', slotId = 'engine', star = 6, rarityId = 'mythic', setId = 'assault',
  generationSeed = 'generation-seed-a', enhancementSeed = 'enhancement-seed-a', balanceTuning = gear.BALANCE_TUNING,
  qualityProfile = fixedProfile(`profile-${star}-${rarityId}-${setId}`, star, rarityId), setProfile = fixedSetProfile(`set-profile-${setId}`, setId), requestedSetId,
} = {}) {
  return gear.createGear({
    gearId,
    generationSeed,
    enhancementSeed,
    sourceId: 'coop_boss',
    sourceDetail: { difficulty: 'normal' },
    acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile,
    setProfile,
    slotId,
    ...(requestedSetId === undefined ? {} : { setId: requestedSetId }),
    balanceTuning,
  });
}
function makeLoadout(setIds) {
  return gear.SLOT_IDS.map((slotId, index) => makeGear({
    gearId: `loadout-${index}-${setIds[index]}`,
    slotId,
    setId: setIds[index],
    generationSeed: `loadout-generation-${index}`,
    enhancementSeed: `loadout-enhancement-${index}`,
  }));
}

test('独立した4バージョンとbp単位を公開する', () => {
  assert.equal(gear.GEAR_SCHEMA_VERSION, 1);
  assert.equal(gear.GEAR_GENERATION_VERSION, 1);
  assert.equal(gear.GEAR_ENHANCEMENT_VERSION, 1);
  assert.equal(gear.BALANCE_TUNING_VERSION, 1);
  assert.equal(gear.BP_PER_PERCENT, 100);
});
test('スキーマ・生成・強化・調整の各版は独立したルール表から解決する', () => {
  assert.equal(gear.resolveSchemaRules(1).version, 1);
  assert.equal(gear.resolveGenerationRules(1).prngAlgorithmVersion, 1);
  assert.deepEqual(gear.resolveEnhancementRules(1).milestones, [3, 6, 9, 12]);
  expectCode('UNSUPPORTED_GENERATION_VERSION', () => gear.resolveGenerationRules(2));
  const v2Gear = makeGear({ gearId: 'tuning-v2', balanceTuning: VERSION_2_TEST_TUNING });
  expectCode('UNSUPPORTED_BALANCE_VERSION', () => gear.validateGear(v2Gear));
  assert.equal(gear.validateGear(v2Gear, { balanceTuning: VERSION_2_TEST_TUNING }).balanceTuningVersion, 2);
  expectCode('BALANCE_TUNING_VERSION_MISMATCH', () => gear.validateGear(v2Gear, { balanceTuning: gear.BALANCE_TUNING }));
});
test('6部位・5レア度・13サブ・8セットが仕様どおり', () => {
  assert.deepEqual(gear.SLOT_IDS, ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  assert.equal(gear.RARITIES.length, 5);
  assert.deepEqual(gear.RARITIES.map((entry) => entry.initialSubCount), [0, 1, 2, 3, 4]);
  assert.equal(gear.SUB_OP_IDS.length, 13);
  assert.equal(gear.SET_IDS.length, 8);
  assert.deepEqual(gear.ENHANCEMENT_MILESTONES, [3, 6, 9, 12]);
});
test('協力ボスとCPU連勝の品質テーブルを整数weightで持つ', () => {
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.normal.starWeights.map((entry) => entry.weight), [25, 35, 25, 15, 0, 0]);
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.normal.rarityWeights.map((entry) => entry.weight), [40, 34, 20, 5, 1]);
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.hard.starWeights.map((entry) => entry.weight), [0, 15, 30, 35, 20, 0]);
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.hard.rarityWeights.map((entry) => entry.weight), [30, 30, 26, 11, 3]);
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.extreme.starWeights.map((entry) => entry.weight), [0, 0, 0, 20, 50, 30]);
  assert.deepEqual(gear.COOP_BOSS_QUALITY_PROFILES.extreme.rarityWeights.map((entry) => entry.weight), [30, 30, 22, 13, 5]);
  assert.deepEqual(gear.CPU_BATTLE_QUALITY_PROFILES.streak15.starWeights.map((entry) => entry.weight), [0, 0, 0, 0, 60, 40]);
  assert.deepEqual(gear.CPU_BATTLE_QUALITY_PROFILES.streak10.rarityWeights.map((entry) => entry.weight), [25, 29, 28, 14, 4]);
  assert.equal(Object.hasOwn(gear.COOP_BOSS_QUALITY_PROFILES, 'fortress'), false);
  assert.equal(Object.hasOwn(gear.COOP_BOSS_QUALITY_PROFILES.normal, 'setWeights'), false);
});
test('協力難易度品質と要塞セット偏りを別軸で扱う', () => {
  const fortressWeights = gear.GEAR_SET_PROFILES.fortress.setWeights;
  const mainIds = new Set(['fortify', 'blast', 'impact']);
  assert.equal(fortressWeights.filter((entry) => mainIds.has(entry.id)).reduce((total, entry) => total + entry.weight, 0), 240);
  assert.equal(fortressWeights.filter((entry) => !mainIds.has(entry.id)).reduce((total, entry) => total + entry.weight, 0), 60);
  assert.equal(fortressWeights.reduce((total, entry) => total + entry.weight, 0), 300);
  assert.deepEqual(gear.GEAR_SET_PROFILES.uniform.setWeights.map((entry) => entry.weight), Array(8).fill(1));

  for (const [difficulty, profile] of Object.entries(gear.COOP_BOSS_QUALITY_PROFILES)) {
    const base = {
      gearId: `fortress-${difficulty}`, slotId: 'engine',
      generationSeed: `fortress-${difficulty}`, enhancementSeed: `fortress-${difficulty}`,
      qualityProfile: profile,
    };
    const fortress = makeGear({ ...base, setProfile: gear.GEAR_SET_PROFILES.fortress });
    const uniform = makeGear({ ...base, setProfile: gear.GEAR_SET_PROFILES.uniform });
    const { setId: fortressSetId, ...fortressWithoutSet } = fortress;
    const { setId: uniformSetId, ...uniformWithoutSet } = uniform;
    assert.ok(gear.SET_IDS.includes(fortressSetId));
    assert.ok(gear.SET_IDS.includes(uniformSetId));
    assert.deepEqual(fortressWithoutSet, uniformWithoutSet, `${difficulty} quality must not be altered by fortress affinity`);
  }
  const cpuUniform = makeGear({
    gearId: 'cpu-uniform', slotId: 'engine', generationSeed: 'cpu-uniform', enhancementSeed: 'cpu-uniform',
    qualityProfile: gear.CPU_BATTLE_QUALITY_PROFILES.streak10, setProfile: gear.GEAR_SET_PROFILES.uniform,
  });
  assert.ok(gear.SET_IDS.includes(cpuUniform.setId));
});
test('生成は品質とセット分布の明示指定を要求し、混在プロファイルを拒否する', () => {
  const required = {
    gearId: 'missing-profile', generationSeed: 'missing-profile', enhancementSeed: 'missing-profile',
    sourceId: 'coop_boss', sourceDetail: {}, acquiredAt: '2026-08-25T00:00:00Z', slotId: 'engine', balanceTuning: gear.BALANCE_TUNING,
  };
  expectCode('MISSING_QUALITY_PROFILE', () => gear.createGear({ ...required, setProfile: gear.GEAR_SET_PROFILES.uniform }));
  expectCode('MISSING_SET_PROFILE', () => gear.createGear({ ...required, qualityProfile: gear.COOP_BOSS_QUALITY_PROFILES.normal }));
  expectCode('MIXED_QUALITY_AND_SET_PROFILE', () => gear.validateQualityProfile({
    id: 'mixed', starWeights: [{ id: 1, weight: 1 }], rarityWeights: [{ id: 'normal', weight: 1 }], setWeights: [{ id: 'assault', weight: 1 }],
  }));
});
test('固定SeedベクターはPRNGアルゴリズムごと固定される', () => {
  assert.equal(gear.deriveDeterministicUint32({ seed: 'seed-v1', label: 'slot', context: { a: 1 } }), 3623307144);
  assert.equal(gear.deriveDeterministicUint32({ seed: 'seed-v1', label: 'slot', context: { a: 1 } }), 3623307144);
  assert.notEqual(gear.deriveDeterministicUint32({ seed: 'seed-v1', label: 'rarity', context: { a: 1 } }), gear.deriveDeterministicUint32({ seed: 'seed-v1', label: 'slot', context: { a: 1 } }));
});
test('空文字・ASCII・日本語Seed、index、label、context正規化の固定ベクターを維持する', () => {
  assert.equal(gear.deriveDeterministicUint32({ seed: '', label: 'slot', context: { a: 1 }, index: 0 }), 1171478591);
  assert.equal(gear.deriveDeterministicUint32({ seed: 'ASCII-Seed_42', label: 'slot', context: { a: 1 }, index: 0 }), 3147504188);
  assert.equal(gear.deriveDeterministicUint32({ seed: '日本語シード', label: 'slot', context: { a: 1 }, index: 0 }), 2169864467);
  assert.equal(gear.deriveDeterministicUint32({ seed: 'ASCII-Seed_42', label: 'slot', context: { a: 1 }, index: 1 }), 2191684951);
  assert.equal(gear.deriveDeterministicUint32({ seed: 'ASCII-Seed_42', label: 'rarity', context: { a: 1 }, index: 0 }), 1148380975);
  assert.equal(
    gear.deriveDeterministicUint32({ seed: 'context-order', label: 'slot', context: { a: 1, nested: { x: 2, y: 3 } } }),
    gear.deriveDeterministicUint32({ seed: 'context-order', label: 'slot', context: { nested: { y: 3, x: 2 }, a: 1 } }),
  );
});
test('用途別ラベルは別工程を追加しても強化抽選を変えない', () => {
  const first = gear.deriveDeterministicUint32({ seed: 'enhance-seed', label: 'enhance:12:target', context: { gearId: 'x' } });
  const unrelated = gear.deriveDeterministicUint32({ seed: 'enhance-seed', label: 'new-future-step', context: { gearId: 'x' } });
  const second = gear.deriveDeterministicUint32({ seed: 'enhance-seed', label: 'enhance:12:target', context: { gearId: 'x' } });
  assert.notEqual(first, unrelated);
  assert.equal(first, second);
});
test('重み付き抽選の境界は厳密に決まる', () => {
  const table = [{ id: 'a', weight: 2 }, { id: 'b', weight: 3 }, { id: 'c', weight: 1 }];
  const ids = new Set(['a', 'b', 'c']);
  assert.equal(gear.chooseWeightedByRoll(table, 0, ids), 'a');
  assert.equal(gear.chooseWeightedByRoll(table, 1, ids), 'a');
  assert.equal(gear.chooseWeightedByRoll(table, 2, ids), 'b');
  assert.equal(gear.chooseWeightedByRoll(table, 4, ids), 'b');
  assert.equal(gear.chooseWeightedByRoll(table, 5, ids), 'c');
});
test('候補数で割り切れないuint32末尾はrejection samplingで再抽選する', () => {
  assert.equal(gear.selectUniformIndexFromUint32(0xffffffff, 1), 0);
  assert.equal(gear.selectUniformIndexFromUint32(0xfffffffe, 2), 0);
  assert.equal(gear.selectUniformIndexFromUint32(0xfffffffd, 3), 1);
  assert.equal(gear.selectUniformIndexFromUint32(0xffffffff, 3), null);
  assert.equal(gear.selectUniformIndexFromUint32(0, 13), 0);
  assert.equal(gear.selectUniformIndexFromUint32(12, 13), 12);
  assert.equal(gear.selectUniformIndexFromUint32(0xffffffff, 13), null);
  assert.equal(gear.selectUniformIndexFromUint32(0xffffffff, 6), null);
});
test('公開labeled PRNGはrejectionで消費したindexを次の抽選へ再利用しない', () => {
  const prng = gear.createLabeledPrng({ seed: 'seed-v1', label: 'slot', context: { a: 1 } });
  // 2^31 + 1 candidates makes index 0 reject (3623307144), then index 1 accept.
  assert.equal(prng.integer(0, 2147483648), 720923607);
  assert.equal(prng.integer(0, 2147483648), 1130599832);
});
test('不正重み、未知ID、NaN、Infinityをfail closedする', () => {
  expectCode('INVALID_WEIGHT', () => gear.validateWeightedTable([{ id: 'a', weight: -1 }], new Set(['a'])));
  expectCode('EMPTY_WEIGHT_TABLE', () => gear.validateWeightedTable([{ id: 'a', weight: 0 }], new Set(['a'])));
  expectCode('UNKNOWN_WEIGHT_ID', () => gear.validateWeightedTable([{ id: 'bad', weight: 1 }], new Set(['a'])));
  expectCode('INVALID_WEIGHT', () => gear.validateWeightedTable([{ id: 'a', weight: Number.NaN }], new Set(['a'])));
  expectCode('INVALID_WEIGHT', () => gear.validateWeightedTable([{ id: 'a', weight: Number.POSITIVE_INFINITY }], new Set(['a'])));
});
test('本番固定メインは全固定部位で承認済みの★完成値を使い、注入なしで生成・GS計算できる', () => {
  const expectedFinalByStar = [4, 5, 7, 9, 10, 12];
  ['barrel', 'armor', 'core'].forEach((slotId) => {
    assert.deepEqual(gear.BALANCE_TUNING.fixedMainFinalBySlot[slotId], { 1: 4, 2: 5, 3: 7, 4: 9, 5: 10, 6: 12 });
    gear.STARS.forEach((star, index) => {
      const item = makeGear({ slotId, star, gearId: `production-${slotId}-${star}` });
      assert.equal(item.mainOp.unit, 'flat');
      assert.equal(item.mainOp.value, [1, 1, 1, 2, 2, 3][index]);
      assert.equal(item.mainOp.finalValue, expectedFinalByStar[index]);
      assert.ok(gear.calculateGearScore(item).currentGs >= 0);
    });
  });
});
test('生成固定ベクターはgearIdとSeedを分離し完全再現する', () => {
  const source = makeGear({ gearId: 'gear-vector-01', slotId: 'engine', generationSeed: 'gen-vector-01', enhancementSeed: 'enh-vector-01' });
  assert.deepEqual(source.mainOp, { opId: 'knockback_resistance', unit: 'bp', value: 700, finalValue: 2800 });
  assert.deepEqual(source.initialSubOps.map(({ opId, initialValueBp }) => ({ opId, initialValueBp })), [
    { opId: 'defense_pct', initialValueBp: 643 }, { opId: 'hp_pct', initialValueBp: 602 },
    { opId: 'knockback_resistance', initialValueBp: 515 }, { opId: 'heal_power', initialValueBp: 652 },
  ]);
  const repeated = makeGear({ gearId: 'gear-vector-01', slotId: 'engine', generationSeed: 'gen-vector-01', enhancementSeed: 'enh-vector-01' });
  assert.deepEqual(repeated, source);
  assert.equal(source.gearId, 'gear-vector-01');
  assert.equal(Object.hasOwn(source, 'generationSeed'), false);
});
test('gearIdは生成Seed・強化Seedの代わりとして使われない', () => {
  const common = { slotId: 'engine', generationSeed: 'same-seed', enhancementSeed: 'same-enhancement', rarityId: 'mythic', star: 6 };
  const first = makeGear({ ...common, gearId: 'individual-a' });
  const second = makeGear({ ...common, gearId: 'individual-b' });
  assert.deepEqual({ ...first, gearId: 'same' }, { ...second, gearId: 'same' });
  const enhancedFirst = gear.enhanceGear(first, 12);
  const enhancedSecond = gear.enhanceGear(second, 12);
  assert.deepEqual({ ...enhancedFirst, gearId: 'same' }, { ...enhancedSecond, gearId: 'same' });
});
test('全部位、全★、全レア度で生成できる', () => {
  gear.SLOT_IDS.forEach((slotId) => assert.equal(makeGear({ slotId, gearId: `slot-${slotId}` }).slotId, slotId));
  gear.STARS.forEach((star) => assert.equal(makeGear({ star, rarityId: 'normal', gearId: `star-${star}` }).star, star));
  gear.RARITY_IDS.forEach((rarityId, expected) => assert.equal(makeGear({ rarityId, gearId: `rarity-${rarityId}` }).initialSubOps.length, expected));
});
test('初期サブは0〜4、完全等確率候補かつ重複なし', () => {
  gear.RARITY_IDS.forEach((rarityId, expected) => {
    const item = makeGear({ rarityId, gearId: `sub-count-${rarityId}`, generationSeed: `sub-count-${rarityId}` });
    assert.equal(item.subOps.length, expected);
    assert.equal(new Set(item.subOps.map((sub) => sub.opId)).size, item.subOps.length);
    item.subOps.forEach((sub) => assert.ok(gear.SUB_OP_IDS.includes(sub.opId)));
    item.initialSubOps.forEach((sub) => {
      assert.equal(sub.enhancementCount, 0);
      assert.equal(sub.enhancementValueBp, 0);
      assert.equal(sub.valueBp, sub.initialValueBp);
    });
  });
});
test('初期サブは架空の強化状態をfail closedし、正規強化後も未強化のまま保持する', () => {
  const base = makeGear({ gearId: 'initial-sub-invariant', rarityId: 'mythic', star: 6 });
  const forgedRoll = JSON.parse(JSON.stringify(base));
  forgedRoll.initialSubOps[0].enhancementCount = 1;
  forgedRoll.initialSubOps[0].enhancementValueBp = 500;
  forgedRoll.initialSubOps[0].valueBp += 500;
  expectCode('INVALID_INITIAL_SUB_STATE', () => gear.validateGear(forgedRoll));

  const forgedValueOnly = JSON.parse(JSON.stringify(base));
  forgedValueOnly.initialSubOps[0].enhancementValueBp = 500;
  forgedValueOnly.initialSubOps[0].valueBp += 500;
  assert.throws(() => gear.validateGear(forgedValueOnly));

  const forgedCountOnly = JSON.parse(JSON.stringify(base));
  forgedCountOnly.initialSubOps[0].enhancementCount = 1;
  assert.throws(() => gear.validateGear(forgedCountOnly));

  const enhanced = gear.enhanceGear(base, 12);
  const restored = JSON.parse(JSON.stringify(enhanced));
  assert.deepEqual(gear.validateGear(restored), enhanced);
  enhanced.initialSubOps.forEach((sub) => {
    assert.equal(sub.enhancementCount, 0);
    assert.equal(sub.enhancementValueBp, 0);
    assert.equal(sub.valueBp, sub.initialValueBp);
  });
  assert.ok(enhanced.subOps.some((sub) => sub.enhancementCount > 0 && sub.enhancementValueBp > 0));
});
test('メインと同種のサブは許可される', () => {
  const item = makeGear({ gearId: 'same-main-sub', generationSeed: 's1', enhancementSeed: 'e1', slotId: 'engine' });
  assert.equal(item.mainOp.opId, 'knockback_resistance');
  assert.ok(item.subOps.some((sub) => sub.opId === 'knockback_resistance'));
});
test('可変メイン候補は各部位の全候補に到達できる', () => {
  ['engine', 'sight', 'auxiliary'].forEach((slotId) => {
    const expected = gear.SLOTS.find((slot) => slot.id === slotId).mainOpIds.slice().sort();
    const found = new Set();
    for (let index = 0; index < 256 && found.size < expected.length; index += 1) found.add(makeGear({ slotId, gearId: `main-${slotId}-${index}`, generationSeed: `main-${slotId}-${index}` }).mainOp.opId);
    assert.deepEqual([...found].sort(), expected);
  });
});
test('未知IDと範囲外の★・強化値を受け入れない', () => {
  expectCode('UNKNOWN_SLOT_ID', () => makeGear({ slotId: 'unknown-slot' }));
  assert.equal(makeGear({ gearId: 'g'.repeat(gear.GEAR_ID_MAX_LENGTH) }).gearId.length, gear.GEAR_ID_MAX_LENGTH);
  expectCode('INVALID_GEAR_ID', () => makeGear({ gearId: 'g'.repeat(gear.GEAR_ID_MAX_LENGTH + 1) }));
  const overlongExistingGear = makeGear({ gearId: 'valid-boundary' }); overlongExistingGear.gearId = 'g'.repeat(gear.GEAR_ID_MAX_LENGTH + 1);
  expectCode('INVALID_GEAR_ID', () => gear.validateGear(overlongExistingGear));
  expectCode('UNKNOWN_WEIGHT_ID', () => gear.validateQualityProfile({ id: 'bad-star', starWeights: [{ id: 7, weight: 1 }], rarityWeights: [{ id: 'normal', weight: 1 }] }));
  expectCode('INVALID_INTEGER', () => gear.mainValueAtLevel('engine', 'attack_pct', 7, 0));
  expectCode('INVALID_INTEGER', () => gear.mainValueAtLevel('engine', 'attack_pct', 6, 13));
});
test('ギア内の不正サブ値・不整合値もfail closedする', () => {
  const item = makeGear({ gearId: 'corrupt-sub' });
  const outOfRange = JSON.parse(JSON.stringify(item));
  outOfRange.subOps[0].initialValueBp = 999999;
  outOfRange.subOps[0].valueBp = 999999;
  expectCode('INVALID_SUB_VALUE', () => gear.validateGear(outOfRange));
  const mismatched = JSON.parse(JSON.stringify(item));
  mismatched.subOps[0].valueBp += 1;
  expectCode('INVALID_SUB_VALUE', () => gear.validateGear(mismatched));
});
test('validateGearは全ての境界ID・範囲・サブ構造を黙って補正せず拒否する', () => {
  const base = makeGear({ gearId: 'validation-boundaries', rarityId: 'mythic' });
  const mutate = (field, value) => {
    const item = JSON.parse(JSON.stringify(base));
    item[field] = value;
    return item;
  };
  assert.throws(() => gear.validateGear(mutate('schemaVersion', 999)));
  assert.throws(() => gear.validateGear(mutate('generationVersion', 999)));
  assert.throws(() => gear.validateGear(mutate('enhancementVersion', 999)));
  assert.throws(() => gear.validateGear(mutate('slotId', 'missing-slot')));
  assert.throws(() => gear.validateGear(mutate('setId', 'missing-set')));
  assert.throws(() => gear.validateGear(mutate('rarityId', 'missing-rarity')));
  assert.throws(() => gear.validateGear(mutate('star', 0)));
  assert.throws(() => gear.validateGear(mutate('star', 7)));
  assert.throws(() => gear.validateGear(mutate('enhancementLevel', -1)));
  assert.throws(() => gear.validateGear(mutate('enhancementLevel', 13)));
  const badOp = JSON.parse(JSON.stringify(base));
  badOp.mainOp.opId = 'crit_rate';
  assert.throws(() => gear.validateGear(badOp));
  const decimal = JSON.parse(JSON.stringify(base));
  decimal.subOps[0].initialValueBp = 500.5;
  decimal.subOps[0].valueBp = 500.5;
  assert.throws(() => gear.validateGear(decimal));
  const nan = JSON.parse(JSON.stringify(base));
  nan.subOps[0].initialValueBp = Number.NaN;
  assert.throws(() => gear.validateGear(nan));
  const infinity = JSON.parse(JSON.stringify(base));
  infinity.subOps[0].initialValueBp = Number.POSITIVE_INFINITY;
  assert.throws(() => gear.validateGear(infinity));
  const duplicate = JSON.parse(JSON.stringify(base));
  duplicate.subOps[1].opId = duplicate.subOps[0].opId;
  assert.throws(() => gear.validateGear(duplicate));
  const tooMany = JSON.parse(JSON.stringify(base));
  tooMany.subOps.push({ ...tooMany.subOps[0], opId: 'attack_pct' });
  assert.throws(() => gear.validateGear(tooMany));
  const rareMismatch = JSON.parse(JSON.stringify(base));
  rareMismatch.rarityId = 'normal';
  assert.throws(() => gear.validateGear(rareMismatch));
  const fixed = makeGear({ gearId: 'fixed-invalid-main', slotId: 'barrel' });
  fixed.mainOp.opId = 'attack_pct';
  assert.throws(() => gear.validateGear(fixed));
});
test('強化値・メイン値・節目サブの改竄は決定論的照合でfail closedする', () => {
  const base = makeGear({ gearId: 'materialization-guard', rarityId: 'mythic' });
  const levelOnly = JSON.parse(JSON.stringify(base));
  levelOnly.enhancementLevel = 12;
  expectCode('GEAR_MATERIALIZATION_MISMATCH', () => gear.validateGear(levelOnly));
  const forgedMain = JSON.parse(JSON.stringify(base));
  forgedMain.mainOp.value += 1;
  expectCode('GEAR_MATERIALIZATION_MISMATCH', () => gear.validateGear(forgedMain));
  const enhanced = gear.enhanceGear(base, 12);
  const forgedSub = JSON.parse(JSON.stringify(enhanced));
  forgedSub.subOps[0].enhancementValueBp += 1;
  forgedSub.subOps[0].valueBp += 1;
  expectCode('GEAR_ENHANCEMENT_MISMATCH', () => gear.validateGear(forgedSub));
});
test('部位・セット指定と★最低保証だけが抽選制約になる', () => {
  const item = gear.createGear({
    gearId: 'minimum-star', generationSeed: 'minimum-star', enhancementSeed: 'minimum-star',
    sourceId: 'coop_boss', sourceDetail: { difficulty: 'hard' }, acquiredAt: '2026-08-25T00:00:00Z',
    qualityProfile: {
      id: 'mixed-stars', starWeights: [{ id: 1, weight: 99 }, { id: 5, weight: 1 }, { id: 6, weight: 1 }],
      rarityWeights: [{ id: 'normal', weight: 1 }, { id: 'mythic', weight: 1 }],
    },
    setProfile: { id: 'mixed-sets', setWeights: [{ id: 'assault', weight: 1 }, { id: 'life', weight: 1 }] },
    slotId: 'sight', setId: 'critical', minimumStar: 5,
  });
  assert.equal(item.slotId, 'sight');
  assert.equal(item.setId, 'critical');
  assert.ok(item.star >= 5);
  assert.ok(['normal', 'mythic'].includes(item.rarityId));
});
test('+0〜+12のメイン成長は全6部位・全★で単調、単位・端点・整数式に一致する', () => {
  gear.SLOTS.forEach((slot) => {
    const mainOpId = slot.mainOpIds[0];
    gear.STARS.forEach((star) => {
      const finalValue = gear.mainFinalValue(slot.id, mainOpId, star);
      const startValue = Math.floor(finalValue / 4);
      const values = Array.from({ length: 13 }, (_unused, level) => gear.mainValueAtLevel(slot.id, mainOpId, star, level));
      assert.equal(makeGear({ slotId: slot.id, star, gearId: `growth-unit-${slot.id}-${star}` }).mainOp.unit, slot.mainKind === 'fixed' ? 'flat' : 'bp');
      assert.equal(values[0], startValue, `${slot.id} ★${star} +0`);
      assert.equal(values[12], finalValue, `${slot.id} ★${star} +12`);
      values.forEach((value, level) => assert.equal(value, Math.floor(startValue + ((finalValue - startValue) * level) / 12), `${slot.id} ★${star} +${level}`));
      values.slice(1).forEach((value, level) => assert.ok(value >= values[level], `${slot.id} ★${star} +${level + 1}`));
    });
  });
});
test('+3/+6/+9/+12の未来結果は固定ベクターどおり', () => {
  const base = makeGear({ gearId: 'gear-vector-01', slotId: 'engine', generationSeed: 'gen-vector-01', enhancementSeed: 'enh-vector-01' });
  const preview = gear.previewEnhancement(base, 12);
  assert.deepEqual(preview.milestones, [
    { level: 3, kind: 'upgrade', opId: 'heal_power', valueBp: 542, subIndex: 3 },
    { level: 6, kind: 'upgrade', opId: 'heal_power', valueBp: 643, subIndex: 3 },
    { level: 9, kind: 'upgrade', opId: 'defense_pct', valueBp: 681, subIndex: 0 },
    { level: 12, kind: 'upgrade', opId: 'knockback_resistance', valueBp: 563, subIndex: 2 },
  ]);
  assert.equal(preview.gear.mainOp.value, 2800);
});
test('サブ4個未満では未所持を追加し、4個後は4択からのみ選ぶ', () => {
  const normal = makeGear({ rarityId: 'normal', gearId: 'normal-milestone', generationSeed: 'normal-milestone', enhancementSeed: 'normal-milestone' });
  const plan = gear.previewEnhancement(normal, 12);
  assert.deepEqual(plan.milestones.map((entry) => entry.kind), ['add', 'add', 'add', 'add']);
  assert.equal(plan.gear.subOps.length, 4);
  assert.equal(new Set(plan.gear.subOps.map((sub) => sub.opId)).size, 4);
  const mythic = makeGear({ rarityId: 'mythic', gearId: 'mythic-milestone', generationSeed: 'mythic-milestone', enhancementSeed: 'mythic-milestone' });
  assert.ok(gear.previewEnhancement(mythic, 12).milestones.every((entry) => entry.kind === 'upgrade'));
});
test('4サブ後の25%選択は固定境界で全indexを取り得る', () => {
  const seen = new Set();
  for (let index = 0; index < 128 && seen.size < 4; index += 1) {
    const item = makeGear({ gearId: `quarter-${index}`, generationSeed: `quarter-g-${index}`, enhancementSeed: `quarter-e-${index}` });
    seen.add(gear.calculateMilestonePlan(item, 3).milestones[0].subIndex);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});
test('直接+12、段階強化、JSON復元、プレビュー後適用が一致する', () => {
  const base = makeGear({ gearId: 'route-equality', generationSeed: 'route-generation', enhancementSeed: 'route-enhancement', rarityId: 'rare' });
  const direct = gear.enhanceGear(base, 12);
  const staged = [3, 6, 9, 12].reduce((item, level) => gear.enhanceGear(item, level), base);
  const restored = gear.enhanceGear(JSON.parse(JSON.stringify(gear.enhanceGear(base, 6))), 12);
  assert.deepEqual(staged, direct);
  assert.deepEqual(restored, direct);
  assert.deepEqual(gear.previewEnhancement(base, 12).gear, direct);
});
test('固定3部位は本番tuningで直接・段階・JSON復元の+12結果が一致する', () => {
  ['barrel', 'armor', 'core'].forEach((slotId) => {
    const base = makeGear({
      gearId: `fixed-route-${slotId}`, slotId, rarityId: 'rare',
      generationSeed: `fixed-route-generation-${slotId}`, enhancementSeed: `fixed-route-enhancement-${slotId}`,
    });
    const direct = gear.enhanceGear(base, 12);
    const staged = [3, 6, 9, 12].reduce((item, level) => gear.enhanceGear(item, level), base);
    const restored = gear.enhanceGear(JSON.parse(JSON.stringify(gear.enhanceGear(base, 6))), 12);
    assert.deepEqual(staged, direct, `${slotId} staged`);
    assert.deepEqual(restored, direct, `${slotId} JSON restore`);
    assert.deepEqual(gear.previewEnhancement(base, 12).gear, direct, `${slotId} preview`);
  });
});
test('生成・強化は入力オブジェクトを破壊しない', () => {
  const source = makeGear({ gearId: 'immutable', rarityId: 'rare' });
  const before = JSON.parse(JSON.stringify(source));
  gear.previewEnhancement(source, 12);
  gear.enhanceGear(source, 6);
  assert.deepEqual(source, before);
});
test('2セット・4セット・6セットは一度ずつだけ集計する', () => {
  const six = gear.aggregateLoadout(makeLoadout(['assault', 'assault', 'assault', 'assault', 'assault', 'assault']));
  assert.equal(six.setCounts.assault, 6);
  assert.deepEqual(six.activeSetEffects.filter((effect) => effect.setId === 'assault').map((effect) => effect.threshold), [2, 4]);
  assert.equal(six.stats.attackPctBp >= 800, true);
  assert.equal(six.conditionalEffects.filter((effect) => effect.effectId === 'direct_hit_outgoing_damage').length, 1);
});
test('4+2と2+2+2と空スロットを正しく集計する', () => {
  const fourTwo = gear.aggregateLoadout(makeLoadout(['assault', 'assault', 'assault', 'assault', 'life', 'life']));
  assert.deepEqual(fourTwo.activeSetEffects.map((entry) => `${entry.setId}:${entry.threshold}`), ['assault:2', 'assault:4', 'life:2']);
  const tripleTwo = gear.aggregateLoadout(makeLoadout(['assault', 'assault', 'life', 'life', 'critical', 'critical']));
  assert.deepEqual(tripleTwo.activeSetEffects.map((entry) => `${entry.setId}:${entry.threshold}`), ['assault:2', 'life:2', 'critical:2']);
  const empty = gear.aggregateLoadout([null, undefined]);
  assert.equal(empty.equippedSlotCount, 0);
  assert.equal(empty.activeSetEffects.length, 0);
});
test('出撃ロードアウトの重複部位・重複gearIdはfail closedする', () => {
  const first = makeGear({ slotId: 'engine', gearId: 'duplicate-one' });
  const second = makeGear({ slotId: 'engine', gearId: 'duplicate-two' });
  expectCode('DUPLICATE_SLOT', () => gear.aggregateLoadout([first, second]));
  const duplicateIdOne = makeGear({ slotId: 'engine', gearId: 'same-physical-gear' });
  const duplicateIdTwo = makeGear({ slotId: 'sight', gearId: 'same-physical-gear' });
  expectCode('DUPLICATE_GEAR_ID', () => gear.aggregateLoadout([duplicateIdOne, duplicateIdTwo]));
});
test('セットの静的bucketと条件付きeffect descriptorを分離する', () => {
  const loadout = gear.aggregateLoadout(makeLoadout(['critical', 'critical', 'rescue', 'rescue', 'rescue', 'rescue']));
  assert.equal(loadout.stats.critRateBp >= 800, true);
  assert.ok(loadout.conditionalEffects.some((effect) => effect.effectId === 'ally_recovery_next_attack' && effect.valueBp === 1000));
  assert.ok(loadout.conditionalEffects.every((effect) => typeof effect.effectId === 'string'));
});
test('ソフトキャップは等倍域と超過50%を整数で返す', () => {
  assert.deepEqual(gear.applySoftCap('crit_rate', 7000), { opId: 'crit_rate', equippedBp: 7000, effectiveBp: 7000, normalRangeBp: 7000, overflowBp: 0, softCapBp: 7000, hardCapBp: null });
  assert.equal(gear.applySoftCap('crit_rate', 7001).effectiveBp, 7000);
  assert.equal(gear.applySoftCap('crit_rate', 7200).effectiveBp, 7100);
  assert.equal(gear.applySoftCap('attack_pct', 12345).effectiveBp, 12345);
  // 150% base critical damage + 60% gear = 210%; only the 1% above
  // the 200% cap range gets half efficiency, so the result is 205%.
  assert.equal(gear.applySoftCap('crit_damage', 21000).effectiveBp, 20500);
});
test('現在GS・最大到達GS・表示帯・自動ロック判定を返す', () => {
  const base = makeGear({ gearId: 'gs-base', rarityId: 'normal', star: 1 });
  const result = gear.calculateGearScore(base);
  assert.equal(result.currentGs, 1);
  assert.equal(result.maxReachGs, 12);
  assert.equal(result.currentBand.id, 'normal');
  assert.equal(result.shouldAutoLock, false);
  assert.ok(result.maxReachGs >= result.currentGs);
});
test('GSは各内訳を先に丸めず、合算してから一度だけ四捨五入する', () => {
  const atEight = gear.enhanceGear(makeGear({ gearId: 'gs-rounding', generationSeed: '0', enhancementSeed: '0', star: 1, rarityId: 'normal' }), 8);
  const score = gear.calculateGearScore(atEight);
  assert.equal(score.currentGs, 7);
  assert.equal(score.currentBreakdown.rank + score.currentBreakdown.rarity + score.currentBreakdown.main + score.currentBreakdown.sub, score.currentGs);
  assert.equal(score.currentBreakdown.rawTotal.numerator.length > 0, true);
});
test('固定メインのGSは生分数を保持し、★6 +12のメイン点は中間丸めなしで20になる', () => {
  ['barrel', 'armor', 'core'].forEach((slotId) => {
    const base = makeGear({ gearId: `fixed-gs-${slotId}`, slotId, star: 6, rarityId: 'normal' });
    const scoreAtZero = gear.calculateGearScore(base);
    assert.deepEqual(scoreAtZero.currentBreakdown.rawFractions.main, { numerator: '60', denominator: '12' }, `${slotId} +0 raw main`);
    const completed = gear.enhanceGear(base, 12);
    const scoreAtTwelve = gear.calculateGearScore(completed);
    assert.deepEqual(scoreAtTwelve.currentBreakdown.rawFractions.main, { numerator: '240', denominator: '12' }, `${slotId} +12 raw main`);
    assert.equal(scoreAtTwelve.currentBreakdown.main, 20, `${slotId} +12 main points`);
  });
});
test('最大到達GSはenhancementSeedの未来を覗かない', () => {
  const common = { gearId: 'same-state', generationSeed: 'same-generation', enhancementSeed: 'first-enhancement', rarityId: 'epic', star: 6 };
  const first = makeGear(common);
  const second = makeGear({ ...common, enhancementSeed: 'second-enhancement' });
  assert.equal(gear.calculateGearScore(first).maxReachGs, gear.calculateGearScore(second).maxReachGs);
});
test('固定メインの最大到達GSもenhancementSeedに依存しない', () => {
  ['barrel', 'armor', 'core'].forEach((slotId) => {
    const shared = { slotId, gearId: `fixed-max-reach-${slotId}`, generationSeed: `fixed-max-generation-${slotId}`, rarityId: 'epic', star: 6 };
    const first = makeGear({ ...shared, enhancementSeed: `fixed-max-first-${slotId}` });
    const second = makeGear({ ...shared, enhancementSeed: `fixed-max-second-${slotId}` });
    assert.equal(gear.calculateGearScore(first).maxReachGs, gear.calculateGearScore(second).maxReachGs, slotId);
  });
});
test('★6ミシックの仕様上の理論最大は未来Seedを見ずGS100になる', () => {
  const item = makeGear({ gearId: 'theoretical-max', star: 6, rarityId: 'mythic' });
  const maximum = JSON.parse(JSON.stringify(item));
  maximum.initialSubOps = maximum.initialSubOps.map((sub) => ({ ...sub, initialValueBp: 700, enhancementValueBp: 0, enhancementCount: 0, valueBp: 700 }));
  maximum.subOps = maximum.initialSubOps.map((sub) => ({ ...sub }));
  const score = gear.calculateGearScore(maximum);
  assert.equal(score.maxReachGs, 100);
  assert.equal(score.maxReachBand.id, 'divine');
  assert.equal(score.shouldAutoLock, false);
});
test('強化費用は+0→+12で345/345、範囲外と逆戻りを拒否する', () => {
  assert.equal(gear.calculateEnhancementCost(0, 12).coins, 345);
  assert.equal(gear.calculateEnhancementCost(0, 12).powder, 345);
  assert.deepEqual(gear.calculateEnhancementCost(3, 4), { fromLevel: 3, toLevel: 4, levels: [{ level: 4, coins: 20, powder: 20 }], coins: 20, powder: 20 });
  expectCode('INVALID_ENHANCEMENT_TARGET', () => gear.calculateEnhancementCost(6, 3));
});
test('分解粉末40%は2/5、設計片は四捨五入で計算する', () => {
  const legend = gear.enhanceGear(makeGear({ gearId: 'dismantle-legend', star: 6, rarityId: 'legend' }), 12);
  assert.deepEqual(gear.calculateDismantleYield(legend), { basePowder: 50, investedPowder: 345, recoveredPowder: 138, powder: 188, blueprintShards: 36, coinsReturned: 0 });
  assert.equal(gear.calculateDismantleYield(makeGear({ gearId: 'dismantle-rare3', star: 3, rarityId: 'rare' })).blueprintShards, 5);
});
test('指定箱は費用と生成制約だけを返し、所持品を変更しない', () => {
  assert.deepEqual(gear.getTargetedBoxQuote('slot', { slotId: 'engine', qualityProfileId: 'coop-normal' }), { kind: 'slot', blueprintShards: 100, constraints: { qualityProfileId: 'coop-normal', slotId: 'engine' } });
  assert.deepEqual(gear.getTargetedBoxQuote('slot', { slotId: 'engine', qualityProfileId: 'coop-extreme' }), { kind: 'slot', blueprintShards: 100, constraints: { qualityProfileId: 'coop-extreme', slotId: 'engine' } });
  assert.deepEqual(gear.getTargetedBoxQuote('set', { setId: 'assault', qualityProfileId: 'coop-hard' }), { kind: 'set', blueprintShards: 100, constraints: { qualityProfileId: 'coop-hard', setId: 'assault' } });
  for (const profileId of ['cpu-streak-3', 'cpu-streak-5', 'cpu-streak-8', 'cpu-streak-10', 'cpu-streak-15']) {
    expectCode('TARGETED_BOX_QUALITY_PROFILE_NOT_ALLOWED', () => gear.getTargetedBoxQuote('slot_set', { slotId: 'sight', setId: 'critical', qualityProfileId: profileId }));
  }
  expectCode('UNKNOWN_TARGETED_BOX_KIND', () => gear.getTargetedBoxQuote('bad', {}));
  expectCode('MISSING_TARGETED_BOX_QUALITY_PROFILE', () => gear.getTargetedBoxQuote('slot', { slotId: 'engine' }));
  expectCode('UNKNOWN_QUALITY_PROFILE', () => gear.getTargetedBoxQuote('slot', { slotId: 'engine', qualityProfileId: 'missing' }));
  expectCode('UNKNOWN_QUALITY_PROFILE', () => gear.getTargetedBoxQuote('slot', { slotId: 'engine', qualityProfileId: 'fortress' }));
});
test('公開ビューはSeed・PRNG状態・未来結果を含まない', () => {
  const internal = makeGear({ gearId: 'public-view' });
  internal.acquisition.detail = { nested: { generationSeed: 'nested-generation', enhancementSeed: 'nested-enhancement' } };
  const publicView = gear.toPublicGearView({ ...internal, generationSeed: 'must-not-leak' });
  const text = JSON.stringify(publicView);
  assert.equal(Object.hasOwn(publicView, 'enhancementSeed'), false);
  assert.equal(Object.hasOwn(publicView, 'generationSeed'), false);
  assert.equal(text.includes('must-not-leak'), false);
  assert.equal(text.includes('enhancement-seed-a'), false);
  assert.equal(text.includes('nested-generation'), false);
  assert.equal(text.includes('nested-enhancement'), false);
  assert.deepEqual(publicView.acquisition, { sourceId: 'coop_boss', acquiredAt: '2026-08-25T00:00:00Z' });
});
test('純粋バランス境界レポートは戦闘式なしで5ケースを出せる', () => {
  const cases = [
    [],
    [gear.enhanceGear(makeGear({ gearId: 'case-4r6', star: 4, rarityId: 'rare' }), 6)],
    [gear.enhanceGear(makeGear({ gearId: 'case-5e9', star: 5, rarityId: 'epic' }), 9)],
    [gear.enhanceGear(makeGear({ gearId: 'case-6l12', star: 6, rarityId: 'legend' }), 12)],
    makeLoadout(['assault', 'assault', 'assault', 'assault', 'critical', 'critical']).map((item) => gear.enhanceGear(item, 12)),
  ];
  cases.forEach((loadout) => {
    const report = gear.buildBalanceBoundaryReport(loadout);
    assert.ok(report.staticStats);
    assert.ok(report.softCaps);
    assert.ok(Array.isArray(report.activeSetEffects));
    assert.ok(report.theoreticalGrowthBp);
  });
});
test('CPU報酬bridgeから接続してもドメインは乱数・時刻に依存しない', () => {
  const source = fs.readFileSync(require.resolve('../shared/gear-domain.js'), 'utf8');
  const game = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('Date.now'), false);
  assert.equal(source.includes('performance.now'), false);
  assert.equal(source.includes('crypto.getRandomValues'), false);
  assert.equal(game.includes('shared/gear-domain.js'), true);
});
test('CommonJSなしのブラウザ相当でも同じ公開APIを提供する', () => {
  const source = fs.readFileSync(require.resolve('../shared/gear-domain.js'), 'utf8');
  const browserGlobal = {};
  vm.runInNewContext(source, { globalThis: browserGlobal });
  assert.equal(browserGlobal.KatamonGearDomain.GEAR_SCHEMA_VERSION, gear.GEAR_SCHEMA_VERSION);
  assert.equal(typeof browserGlobal.KatamonGearDomain.createGear, 'function');
});

console.log(`gear-domain: ${passed}/${passed} passed`);
