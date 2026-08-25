(function initKatamonGearDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearDomain() {
  'use strict';

  // Phase 1 is deliberately data-only. This module must stay independent from
  // DOM, localStorage, Firebase, battle state, system time and random devices.
  const GEAR_SCHEMA_VERSION = 1;
  const GEAR_GENERATION_VERSION = 1;
  const GEAR_ENHANCEMENT_VERSION = 1;
  const BALANCE_TUNING_VERSION = 1;
  const PRNG_ALGORITHM_VERSION = 1;
  const BP_PER_PERCENT = 100;
  const MAX_ENHANCEMENT_LEVEL = 12;
  const ENHANCEMENT_MILESTONES = Object.freeze([3, 6, 9, 12]);

  class GearDomainError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'GearDomainError';
      this.code = code;
    }
  }

  const fail = (code, message) => { throw new GearDomainError(code, message); };
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };
  const assertInteger = (value, min, max, name) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      fail('INVALID_INTEGER', `${name} must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  const assertNonNegativeInteger = (value, name) => {
    if (!Number.isInteger(value) || value < 0) fail('INVALID_INTEGER', `${name} must be a non-negative integer`);
    return value;
  };
  const assertString = (value, name) => {
    if (typeof value !== 'string' || value.length === 0) fail('INVALID_STRING', `${name} must be a non-empty string`);
    return value;
  };
  const roundDiv = (numerator, denominator) => {
    assertNonNegativeInteger(numerator, 'numerator');
    assertInteger(denominator, 1, Number.MAX_SAFE_INTEGER, 'denominator');
    return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
  };
  const cloneData = (value, path = 'value') => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('INVALID_DATA', `${path} must not contain NaN or Infinity`);
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => cloneData(entry, `${path}[${index}]`));
    if (isRecord(value)) {
      const result = {};
      Object.keys(value).sort().forEach((key) => { result[key] = cloneData(value[key], `${path}.${key}`); });
      return result;
    }
    fail('INVALID_DATA', `${path} must be JSON-like data`);
  };
  const stableStringify = (value) => JSON.stringify(cloneData(value));

  const SLOTS = deepFreeze([
    { id: 'barrel', labelJa: '砲身', mainKind: 'fixed', mainOpIds: ['flat_attack'] },
    { id: 'armor', labelJa: '装甲', mainKind: 'fixed', mainOpIds: ['flat_hp'] },
    { id: 'core', labelJa: 'コア', mainKind: 'fixed', mainOpIds: ['flat_defense'] },
    { id: 'engine', labelJa: '動力', mainKind: 'variable', mainOpIds: ['attack_pct', 'hp_pct', 'defense_pct', 'max_fuel', 'knockback_power', 'knockback_resistance'] },
    { id: 'sight', labelJa: '照準', mainKind: 'variable', mainOpIds: ['attack_pct', 'hp_pct', 'defense_pct', 'crit_rate', 'crit_damage'] },
    { id: 'auxiliary', labelJa: '補助機構', mainKind: 'variable', mainOpIds: ['attack_pct', 'hp_pct', 'defense_pct', 'blast_power', 'status_resistance', 'heal_power', 'shield_power'] },
  ]);
  const SLOT_IDS = deepFreeze(SLOTS.map((entry) => entry.id));
  const SLOT_BY_ID = new Map(SLOTS.map((entry) => [entry.id, entry]));

  const STARS = deepFreeze([1, 2, 3, 4, 5, 6]);
  const RARITIES = deepFreeze([
    { id: 'normal', labelJa: 'ノーマル', initialSubCount: 0 },
    { id: 'rare', labelJa: 'レア', initialSubCount: 1 },
    { id: 'epic', labelJa: 'エピック', initialSubCount: 2 },
    { id: 'legend', labelJa: 'レジェンド', initialSubCount: 3 },
    { id: 'mythic', labelJa: 'ミシック', initialSubCount: 4 },
  ]);
  const RARITY_IDS = deepFreeze(RARITIES.map((entry) => entry.id));
  const RARITY_BY_ID = new Map(RARITIES.map((entry) => [entry.id, entry]));

  const SUB_OPS = deepFreeze([
    { id: 'attack_pct', labelJa: '攻撃%', bucket: 'attackPctBp' },
    { id: 'hp_pct', labelJa: 'HP%', bucket: 'hpPctBp' },
    { id: 'defense_pct', labelJa: '防御%', bucket: 'defensePctBp' },
    { id: 'crit_rate', labelJa: '会心率', bucket: 'critRateBp' },
    { id: 'crit_damage', labelJa: '会心ダメージ', bucket: 'critDamageBp' },
    { id: 'blast_power', labelJa: '爆風威力', bucket: 'blastPowerBp' },
    { id: 'knockback_power', labelJa: 'ノックバック威力', bucket: 'knockbackPowerBp' },
    { id: 'knockback_resistance', labelJa: 'ノックバック耐性', bucket: 'knockbackResistanceBp' },
    { id: 'status_resistance', labelJa: '状態異常耐性', bucket: 'statusResistanceBp' },
    { id: 'heal_power', labelJa: '回復効果', bucket: 'healPowerBp' },
    { id: 'received_heal', labelJa: '被回復効果', bucket: 'receivedHealBp' },
    { id: 'shield_power', labelJa: 'シールド効果', bucket: 'shieldPowerBp' },
    { id: 'received_shield', labelJa: '被シールド効果', bucket: 'receivedShieldBp' },
  ]);
  const SUB_OP_IDS = deepFreeze(SUB_OPS.map((entry) => entry.id));
  const SUB_OP_BY_ID = new Map(SUB_OPS.map((entry) => [entry.id, entry]));
  // 最大燃料はサブOPではなく、動力メインだけに許される可変メインOP。
  const VARIABLE_MAIN_OPS = deepFreeze([...SUB_OPS, { id: 'max_fuel', labelJa: '最大燃料', bucket: 'maxFuelBp' }]);
  const VARIABLE_MAIN_OP_BY_ID = new Map(VARIABLE_MAIN_OPS.map((entry) => [entry.id, entry]));
  const FIXED_MAIN_OPS = deepFreeze([
    { id: 'flat_attack', labelJa: '攻撃＋固定値', bucket: 'flatAttack', unit: 'flat' },
    { id: 'flat_hp', labelJa: 'HP＋固定値', bucket: 'flatHp', unit: 'flat' },
    { id: 'flat_defense', labelJa: '防御＋固定値', bucket: 'flatDefense', unit: 'flat' },
  ]);
  const FIXED_MAIN_OP_BY_ID = new Map(FIXED_MAIN_OPS.map((entry) => [entry.id, entry]));

  const SUB_VALUE_RANGE_BP_BY_STAR = deepFreeze({
    1: { min: 100, max: 200 },
    2: { min: 100, max: 300 },
    3: { min: 200, max: 400 },
    4: { min: 300, max: 500 },
    5: { min: 400, max: 600 },
    6: { min: 500, max: 700 },
  });

  const makeUniformSetWeights = () => SET_IDS.map((id) => ({ id, weight: 1 }));
  const statEffect = (stats) => deepFreeze({ stats: deepFreeze(stats), conditionalEffects: deepFreeze([]) });
  const conditionalEffect = (effectId, trigger, valueBp, extra = {}) => deepFreeze({
    effectId, trigger, valueBp, ...extra,
  });

  const SETS = deepFreeze([
    {
      id: 'assault', labelJa: '猛攻',
      effects: {
        2: statEffect({ attackPctBp: 800 }),
        4: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('direct_hit_outgoing_damage', 'direct_hit', 1200)] }),
      },
    },
    {
      id: 'life', labelJa: '生命',
      effects: {
        2: statEffect({ hpPctBp: 1000 }),
        4: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('battle_start_max_hp_shield', 'battle_start', 800)] }),
      },
    },
    {
      id: 'fortify', labelJa: '堅守',
      effects: {
        2: statEffect({ defensePctBp: 1000 }),
        4: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('direct_hit_damage_taken_reduction', 'direct_hit_taken', 1200)] }),
      },
    },
    {
      id: 'critical', labelJa: '会心',
      effects: {
        2: statEffect({ critRateBp: 800 }),
        4: statEffect({ critDamageBp: 2000 }),
      },
    },
    {
      id: 'blast', labelJa: '爆砕',
      effects: {
        2: statEffect({ blastPowerBp: 800 }),
        4: statEffect({ blastRangeBp: 800 }),
      },
    },
    {
      id: 'impact', labelJa: '衝撃',
      effects: {
        2: statEffect({ knockbackPowerBp: 1000 }),
        4: statEffect({ knockbackPowerBp: 1000, knockbackResistanceBp: 1000 }),
      },
    },
    {
      id: 'rescue', labelJa: '救援',
      effects: {
        2: statEffect({ healPowerBp: 800, shieldPowerBp: 800 }),
        4: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('ally_recovery_next_attack', 'ally_recovery', 1000, { excludesSelf: true, requiresActualGain: true })] }),
      },
    },
    {
      id: 'last_stand', labelJa: '背水',
      effects: {
        2: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('low_hp_attack', 'hp_at_or_below_50', 1000)] }),
        4: deepFreeze({ stats: {}, conditionalEffects: [conditionalEffect('damage_taken_next_attack', 'enemy_attack_damage_taken', 1000, { lowHpValueBp: 1500, hpThresholdBp: 5000 })] }),
      },
    },
  ]);
  const SET_IDS = deepFreeze(SETS.map((entry) => entry.id));
  const SET_BY_ID = new Map(SETS.map((entry) => [entry.id, entry]));

  const qualityProfile = (id, starWeights, rarityWeights) => deepFreeze({
    id, starWeights: deepFreeze(starWeights), rarityWeights: deepFreeze(rarityWeights),
  });
  const setProfile = (id, setWeights) => deepFreeze({
    id, setWeights: deepFreeze(setWeights),
  });
  const starWeights = (values) => values.map((weight, index) => ({ id: index + 1, weight }));
  const rarityWeights = (values) => values.map((weight, index) => ({ id: RARITY_IDS[index], weight }));
  const FORTRESS_SET_WEIGHTS = deepFreeze([
    { id: 'fortify', weight: 80 }, { id: 'blast', weight: 80 }, { id: 'impact', weight: 80 },
    { id: 'assault', weight: 12 }, { id: 'life', weight: 12 }, { id: 'critical', weight: 12 }, { id: 'rescue', weight: 12 }, { id: 'last_stand', weight: 12 },
  ]);
  const COOP_BOSS_QUALITY_PROFILES = deepFreeze({
    normal: qualityProfile('coop-normal', starWeights([25, 35, 25, 15, 0, 0]), rarityWeights([40, 34, 20, 5, 1])),
    hard: qualityProfile('coop-hard', starWeights([0, 15, 30, 35, 20, 0]), rarityWeights([30, 30, 26, 11, 3])),
    extreme: qualityProfile('coop-extreme', starWeights([0, 0, 0, 20, 50, 30]), rarityWeights([30, 30, 22, 13, 5])),
  });
  const CPU_BATTLE_QUALITY_PROFILES = deepFreeze({
    streak3: qualityProfile('cpu-streak-3', starWeights([35, 35, 20, 10, 0, 0]), rarityWeights([40, 34, 20, 5, 1])),
    streak5: qualityProfile('cpu-streak-5', starWeights([15, 30, 30, 20, 5, 0]), rarityWeights([35, 32, 23, 8, 2])),
    streak8: qualityProfile('cpu-streak-8', starWeights([0, 10, 25, 35, 25, 5]), rarityWeights([30, 30, 26, 11, 3])),
    streak10: qualityProfile('cpu-streak-10', starWeights([0, 0, 10, 30, 45, 15]), rarityWeights([25, 29, 28, 14, 4])),
    streak15: qualityProfile('cpu-streak-15', starWeights([0, 0, 0, 0, 60, 40]), rarityWeights([25, 28, 25, 16, 6])),
  });
  const GEAR_SET_PROFILES = deepFreeze({
    uniform: setProfile('uniform', makeUniformSetWeights()),
    fortress: setProfile('fortress', FORTRESS_SET_WEIGHTS),
  });
  const QUALITY_PROFILES = deepFreeze({ ...COOP_BOSS_QUALITY_PROFILES, ...CPU_BATTLE_QUALITY_PROFILES });
  const QUALITY_PROFILE_BY_ID = new Map(Object.values(QUALITY_PROFILES).map((entry) => [entry.id, entry]));
  const SET_PROFILE_BY_ID = new Map(Object.values(GEAR_SET_PROFILES).map((entry) => [entry.id, entry]));
  const TARGETED_BOX_QUALITY_PROFILE_IDS = deepFreeze(Object.values(COOP_BOSS_QUALITY_PROFILES).map((entry) => entry.id));

  const ENHANCEMENT_COSTS = deepFreeze({
    1: { coins: 10, powder: 10 }, 2: { coins: 10, powder: 10 }, 3: { coins: 10, powder: 10 },
    4: { coins: 20, powder: 20 }, 5: { coins: 20, powder: 20 }, 6: { coins: 20, powder: 20 },
    7: { coins: 35, powder: 35 }, 8: { coins: 35, powder: 35 }, 9: { coins: 35, powder: 35 },
    10: { coins: 50, powder: 50 }, 11: { coins: 50, powder: 50 }, 12: { coins: 50, powder: 50 },
  });
  const DISMANTLE_BASE_POWDER_BY_STAR = deepFreeze({ 1: 8, 2: 12, 3: 18, 4: 25, 5: 35, 6: 50 });
  const BLUEPRINT_SHARD_BASE_BY_STAR = deepFreeze({ 1: 1, 2: 2, 3: 3, 4: 5, 5: 8, 6: 12 });
  const BLUEPRINT_SHARD_RARITY_MULTIPLIER = deepFreeze({
    normal: { numerator: 1, denominator: 1 }, rare: { numerator: 3, denominator: 2 }, epic: { numerator: 2, denominator: 1 }, legend: { numerator: 3, denominator: 1 }, mythic: { numerator: 5, denominator: 1 },
  });
  const TARGETED_BOX_COSTS = deepFreeze({ slot: 100, set: 100, slot_set: 300 });
  const SOFT_CAPS_BP = deepFreeze({
    crit_rate: 7000, crit_damage: 20000, status_resistance: 5000, blast_power: 5000,
    heal_power: 7000, shield_power: 7000, received_heal: 5000, received_shield: 5000,
  });
  const GS_CONSTANTS = deepFreeze({ rankMax: 20, rarityMax: 15, mainMax: 20, subMax: 45, star6MaxSubTotalBp: 5600, autoLockThreshold: 90 });

  // Fixed mains are a gear-number calibration only. They deliberately do not
  // define a battle Attack/Defense formula; Phase 3 owns that integration.
  // The same ★ table applies to barrel, armor and core. Keeping it in the
  // versioned production tuning makes a stored v1 gear replayable without a
  // caller having to inject test-only balance data.
  const BALANCE_TUNING = deepFreeze({
    version: BALANCE_TUNING_VERSION,
    mainStartRatio: { numerator: 1, denominator: 4 },
    variableMainFinalBpByStar: { 1: 800, 2: 1200, 3: 1600, 4: 2000, 5: 2400, 6: 2800 },
    fixedMainFinalBySlot: {
      barrel: { 1: 4, 2: 5, 3: 7, 4: 9, 5: 10, 6: 12 },
      armor: { 1: 4, 2: 5, 3: 7, 4: 9, 5: 10, 6: 12 },
      core: { 1: 4, 2: 5, 3: 7, 4: 9, 5: 10, 6: 12 },
    },
  });
  // New balance versions are added here instead of silently reinterpreting an
  // old gear item with whatever happens to be the latest tuning.
  const BALANCE_TUNING_BY_VERSION = deepFreeze({ [BALANCE_TUNING_VERSION]: BALANCE_TUNING });
  // Each independently stored version resolves to rules rather than an
  // implicit latest implementation. Later versions add entries here; they do
  // not overwrite v1, so persisted enhancementSeed outcomes remain replayable.
  const GEAR_SCHEMA_RULES_BY_VERSION = deepFreeze({
    [GEAR_SCHEMA_VERSION]: { version: GEAR_SCHEMA_VERSION },
  });
  const GENERATION_RULES_BY_VERSION = deepFreeze({
    [GEAR_GENERATION_VERSION]: { version: GEAR_GENERATION_VERSION, prngAlgorithmVersion: PRNG_ALGORITHM_VERSION },
  });
  const ENHANCEMENT_RULES_BY_VERSION = deepFreeze({
    [GEAR_ENHANCEMENT_VERSION]: { version: GEAR_ENHANCEMENT_VERSION, prngAlgorithmVersion: PRNG_ALGORITHM_VERSION, milestones: ENHANCEMENT_MILESTONES },
  });

  const EMPTY_STATS = () => ({
    flatAttack: 0, flatHp: 0, flatDefense: 0,
    attackPctBp: 0, hpPctBp: 0, defensePctBp: 0, maxFuelBp: 0,
    critRateBp: 0, critDamageBp: 0, blastPowerBp: 0, blastRangeBp: 0,
    knockbackPowerBp: 0, knockbackResistanceBp: 0, statusResistanceBp: 0,
    healPowerBp: 0, receivedHealBp: 0, shieldPowerBp: 0, receivedShieldBp: 0,
    outgoingDamageConditionalBp: 0, incomingDamageConditionalBp: 0,
  });

  function getSlot(slotId) {
    const slot = SLOT_BY_ID.get(slotId);
    if (!slot) fail('UNKNOWN_SLOT_ID', `Unknown slot id: ${slotId}`);
    return slot;
  }
  function getRarity(rarityId) {
    const rarity = RARITY_BY_ID.get(rarityId);
    if (!rarity) fail('UNKNOWN_RARITY_ID', `Unknown rarity id: ${rarityId}`);
    return rarity;
  }
  function getSet(setId) {
    const set = SET_BY_ID.get(setId);
    if (!set) fail('UNKNOWN_SET_ID', `Unknown set id: ${setId}`);
    return set;
  }
  function getSubOp(opId) {
    const subOp = SUB_OP_BY_ID.get(opId);
    if (!subOp) fail('UNKNOWN_SUB_OP_ID', `Unknown sub op id: ${opId}`);
    return subOp;
  }
  function getVariableMainOp(opId) {
    const mainOp = VARIABLE_MAIN_OP_BY_ID.get(opId);
    if (!mainOp) fail('UNKNOWN_MAIN_OP_ID', `Unknown variable main op id: ${opId}`);
    return mainOp;
  }
  function assertStar(star) { return assertInteger(star, 1, 6, 'star'); }
  function assertEnhancementLevel(level) { return assertInteger(level, 0, MAX_ENHANCEMENT_LEVEL, 'enhancementLevel'); }
  function assertSeed(seed, name) {
    // Empty is a valid, explicit deterministic seed. It is never replaced by
    // an implicit device or time source.
    if (typeof seed === 'string' && seed.length <= 512) return seed;
    if (Number.isInteger(seed)) return String(seed);
    fail('INVALID_SEED', `${name} must be a string up to 512 characters or integer`);
  }

  function validateWeightedTable(entries, allowedIds, name = 'weight table') {
    if (!Array.isArray(entries) || entries.length === 0) fail('INVALID_WEIGHT_TABLE', `${name} must not be empty`);
    const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds);
    const seen = new Set();
    let totalWeight = 0;
    const result = entries.map((entry, index) => {
      if (!isRecord(entry)) fail('INVALID_WEIGHT_TABLE', `${name}[${index}] must be an object`);
      const id = entry.id;
      if (!(typeof id === 'string' || Number.isInteger(id))) fail('INVALID_WEIGHT_TABLE', `${name}[${index}].id must be a string or integer`);
      if (!allowed.has(id)) fail('UNKNOWN_WEIGHT_ID', `${name} has unknown id: ${id}`);
      const idKey = `${typeof id}:${id}`;
      if (seen.has(idKey)) fail('DUPLICATE_WEIGHT_ID', `${name} repeats id: ${id}`);
      seen.add(idKey);
      const weight = entry.weight;
      if (!Number.isInteger(weight) || weight < 0) fail('INVALID_WEIGHT', `${name}.${id} must be a non-negative integer`);
      totalWeight += weight;
      if (!Number.isSafeInteger(totalWeight)) fail('INVALID_WEIGHT', `${name} total is too large`);
      return { id, weight };
    });
    if (totalWeight === 0) fail('EMPTY_WEIGHT_TABLE', `${name} total weight must be positive`);
    return { entries: result, totalWeight };
  }
  function chooseWeightedByRoll(entries, roll, allowedIds, name = 'weight table') {
    const table = validateWeightedTable(entries, allowedIds, name);
    assertInteger(roll, 0, table.totalWeight - 1, `${name} roll`);
    let cursor = 0;
    for (const entry of table.entries) {
      cursor += entry.weight;
      if (roll < cursor) return entry.id;
    }
    fail('WEIGHT_DRAW_FAILED', `${name} draw was outside the table`);
  }

  function fnv1a32(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function mulberry32(value) {
    let state = value >>> 0;
    state = (state + 0x6D2B79F5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return (result ^ (result >>> 14)) >>> 0;
  }
  function deriveDeterministicUint32({ seed, label, context = null, index = 0, algorithmVersion = PRNG_ALGORITHM_VERSION }) {
    const checkedSeed = assertSeed(seed, 'seed');
    const checkedLabel = assertString(label, 'label');
    assertNonNegativeInteger(index, 'index');
    assertInteger(algorithmVersion, 1, Number.MAX_SAFE_INTEGER, 'algorithmVersion');
    const payload = `${algorithmVersion}\u001f${checkedSeed}\u001f${checkedLabel}\u001f${stableStringify(context)}\u001f${index}`;
    return mulberry32(fnv1a32(payload));
  }
  const UINT32_SPACE = 0x100000000;
  const PRNG_REJECTION_LIMIT = 1024;
  function selectUniformIndexFromUint32(value, count) {
    assertInteger(value, 0, UINT32_SPACE - 1, 'uniform uint32 value');
    assertInteger(count, 1, UINT32_SPACE, 'uniform candidate count');
    const limit = Math.floor(UINT32_SPACE / count) * count;
    return value < limit ? value % count : null;
  }
  function drawUniformIndex(seed, label, count, context = null, algorithmVersion = PRNG_ALGORITHM_VERSION, index = 0) {
    assertNonNegativeInteger(index, 'uniform index');
    for (let attempt = 0; attempt < PRNG_REJECTION_LIMIT; attempt += 1) {
      const value = deriveDeterministicUint32({ seed, label, context, index: index + attempt, algorithmVersion });
      const selected = selectUniformIndexFromUint32(value, count);
      if (selected !== null) return { value: selected, nextIndex: index + attempt + 1 };
    }
    fail('PRNG_REJECTION_EXHAUSTED', `Unable to draw an unbiased value for ${label}`);
  }
  function uniformIndex(seed, label, count, context = null, algorithmVersion = PRNG_ALGORITHM_VERSION, index = 0) {
    return drawUniformIndex(seed, label, count, context, algorithmVersion, index).value;
  }
  function createLabeledPrng({ seed, label, context = null, algorithmVersion = PRNG_ALGORITHM_VERSION }) {
    let index = 0;
    return Object.freeze({
      nextUint32: () => deriveDeterministicUint32({ seed, label, context, index: index++, algorithmVersion }),
      integer: (min, max) => {
        assertInteger(min, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'minimum');
        assertInteger(max, min, Number.MAX_SAFE_INTEGER, 'maximum');
        const width = max - min + 1;
        const draw = drawUniformIndex(seed, label, width, context, algorithmVersion, index);
        index = draw.nextIndex;
        return min + draw.value;
      },
    });
  }
  function chooseWeighted(seed, label, entries, allowedIds, context, name, algorithmVersion = PRNG_ALGORITHM_VERSION) {
    const table = validateWeightedTable(entries, allowedIds, name);
    const roll = uniformIndex(seed, label, table.totalWeight, context, algorithmVersion);
    return chooseWeightedByRoll(table.entries, roll, allowedIds, name);
  }
  function chooseArray(seed, label, values, context, algorithmVersion = PRNG_ALGORITHM_VERSION) {
    if (!Array.isArray(values) || values.length === 0) fail('EMPTY_CANDIDATES', `${label} has no candidates`);
    return values[uniformIndex(seed, label, values.length, context, algorithmVersion)];
  }
  function randomInclusive(seed, label, min, max, context, algorithmVersion = PRNG_ALGORITHM_VERSION) {
    assertInteger(min, 0, Number.MAX_SAFE_INTEGER, 'minimum');
    assertInteger(max, min, Number.MAX_SAFE_INTEGER, 'maximum');
    return min + uniformIndex(seed, label, max - min + 1, context, algorithmVersion);
  }

  function validateBalanceTuning(tuning = BALANCE_TUNING) {
    if (!isRecord(tuning)) fail('INVALID_BALANCE_TUNING', 'balance tuning must be an object');
    assertInteger(tuning.version, 1, Number.MAX_SAFE_INTEGER, 'balance tuning version');
    const ratio = tuning.mainStartRatio;
    if (!isRecord(ratio)) fail('INVALID_BALANCE_TUNING', 'mainStartRatio is required');
    assertInteger(ratio.numerator, 0, Number.MAX_SAFE_INTEGER, 'mainStartRatio.numerator');
    assertInteger(ratio.denominator, 1, Number.MAX_SAFE_INTEGER, 'mainStartRatio.denominator');
    if (ratio.numerator > ratio.denominator) fail('INVALID_BALANCE_TUNING', 'mainStartRatio must not exceed 1');
    if (!isRecord(tuning.variableMainFinalBpByStar)) fail('INVALID_BALANCE_TUNING', 'variableMainFinalBpByStar is required');
    STARS.forEach((star) => assertInteger(tuning.variableMainFinalBpByStar[star], 1, Number.MAX_SAFE_INTEGER, `variable main star ${star}`));
    if (!isRecord(tuning.fixedMainFinalBySlot)) fail('INVALID_BALANCE_TUNING', 'fixedMainFinalBySlot is required');
    ['barrel', 'armor', 'core'].forEach((slotId) => {
      const table = tuning.fixedMainFinalBySlot[slotId];
      if (!isRecord(table)) fail('INVALID_BALANCE_TUNING', `fixed tuning for ${slotId} must be an object`);
      STARS.forEach((star) => assertInteger(table[star], 1, Number.MAX_SAFE_INTEGER, `fixed ${slotId} star ${star}`));
    });
    return tuning;
  }
  function resolveBalanceTuningForVersion(balanceTuningVersion, suppliedTuning) {
    assertInteger(balanceTuningVersion, 1, Number.MAX_SAFE_INTEGER, 'balance tuning version');
    const tuning = suppliedTuning || BALANCE_TUNING_BY_VERSION[balanceTuningVersion];
    if (!tuning) fail('UNSUPPORTED_BALANCE_VERSION', `No balance tuning is registered for version ${balanceTuningVersion}`);
    validateBalanceTuning(tuning);
    if (tuning.version !== balanceTuningVersion) fail('BALANCE_TUNING_VERSION_MISMATCH', 'Gear and supplied balance tuning versions differ');
    return tuning;
  }
  function resolveVersionedRules(registry, version, kind) {
    assertInteger(version, 1, Number.MAX_SAFE_INTEGER, `${kind} version`);
    const rules = registry[version];
    if (!rules) fail(`UNSUPPORTED_${kind.toUpperCase()}_VERSION`, `No ${kind} rules are registered for version ${version}`);
    return rules;
  }
  function resolveSchemaRules(version) { return resolveVersionedRules(GEAR_SCHEMA_RULES_BY_VERSION, version, 'schema'); }
  function resolveGenerationRules(version) { return resolveVersionedRules(GENERATION_RULES_BY_VERSION, version, 'generation'); }
  function resolveEnhancementRules(version) { return resolveVersionedRules(ENHANCEMENT_RULES_BY_VERSION, version, 'enhancement'); }
  function fixedMainFinalValue(slotId, star, tuning) {
    const checked = validateBalanceTuning(tuning);
    const table = checked.fixedMainFinalBySlot[slotId];
    return assertInteger(table[star], 1, Number.MAX_SAFE_INTEGER, `fixed ${slotId} star ${star}`);
  }
  function mainFinalValue(slotId, mainOpId, star, tuning = BALANCE_TUNING) {
    const slot = getSlot(slotId);
    assertStar(star);
    if (!slot.mainOpIds.includes(mainOpId)) fail('INVALID_MAIN_OP', `${mainOpId} is not valid for ${slotId}`);
    if (slot.mainKind === 'fixed') return fixedMainFinalValue(slotId, star, tuning);
    getVariableMainOp(mainOpId);
    return validateBalanceTuning(tuning).variableMainFinalBpByStar[star];
  }
  function mainValueAtLevel(slotId, mainOpId, star, enhancementLevel, tuning = BALANCE_TUNING) {
    const level = assertEnhancementLevel(enhancementLevel);
    const checked = validateBalanceTuning(tuning);
    const finalValue = mainFinalValue(slotId, mainOpId, star, checked);
    const initialValue = Math.floor((finalValue * checked.mainStartRatio.numerator) / checked.mainStartRatio.denominator);
    return initialValue + Math.floor(((finalValue - initialValue) * level) / MAX_ENHANCEMENT_LEVEL);
  }
  function mainUnit(slotId) { return getSlot(slotId).mainKind === 'fixed' ? 'flat' : 'bp'; }

  function validateQualityProfile(input) {
    const profileValue = typeof input === 'string' ? QUALITY_PROFILE_BY_ID.get(input) : input;
    if (!profileValue || !isRecord(profileValue)) fail('UNKNOWN_QUALITY_PROFILE', 'quality profile is unknown');
    if (hasOwn(profileValue, 'setWeights')) fail('MIXED_QUALITY_AND_SET_PROFILE', 'quality profiles must not define set weights');
    const id = assertString(profileValue.id, 'quality profile id');
    const stars = validateWeightedTable(profileValue.starWeights, new Set(STARS), `${id}.starWeights`);
    const rarities = validateWeightedTable(profileValue.rarityWeights, new Set(RARITY_IDS), `${id}.rarityWeights`);
    return { id, starWeights: stars.entries, rarityWeights: rarities.entries };
  }
  function resolveQualityProfile(input) {
    if (input === undefined || input === null) fail('MISSING_QUALITY_PROFILE', 'gear generation requires an explicit quality profile');
    return validateQualityProfile(input);
  }
  function validateSetProfile(input) {
    const profileValue = typeof input === 'string' ? SET_PROFILE_BY_ID.get(input) : input;
    if (!profileValue || !isRecord(profileValue)) fail('UNKNOWN_SET_PROFILE', 'set profile is unknown');
    if (hasOwn(profileValue, 'starWeights') || hasOwn(profileValue, 'rarityWeights')) fail('MIXED_QUALITY_AND_SET_PROFILE', 'set profiles must not define quality weights');
    const id = assertString(profileValue.id, 'set profile id');
    const sets = validateWeightedTable(profileValue.setWeights, new Set(SET_IDS), `${id}.setWeights`);
    return { id, setWeights: sets.entries };
  }
  function resolveSetProfile(input) {
    if (input === undefined || input === null) fail('MISSING_SET_PROFILE', 'gear generation requires an explicit set profile');
    return validateSetProfile(input);
  }
  function filterMinimumStar(entries, minStar) {
    if (minStar === undefined || minStar === null) return entries;
    assertStar(minStar);
    const filtered = entries.filter((entry) => entry.id >= minStar);
    validateWeightedTable(filtered, new Set(STARS), 'minimum star quality table');
    return filtered;
  }
  function subValueRange(star) {
    return SUB_VALUE_RANGE_BP_BY_STAR[assertStar(star)];
  }
  function rollSubValueBp(star, seed, label, context, algorithmVersion = PRNG_ALGORITHM_VERSION) {
    const range = subValueRange(star);
    return randomInclusive(seed, label, range.min, range.max, context, algorithmVersion);
  }
  function makeSubOp(opId, initialValueBp, enhancementValueBp = 0, enhancementCount = 0) {
    getSubOp(opId);
    assertNonNegativeInteger(initialValueBp, 'initial sub value');
    assertNonNegativeInteger(enhancementValueBp, 'sub enhancement value');
    assertNonNegativeInteger(enhancementCount, 'sub enhancement count');
    return {
      opId,
      initialValueBp,
      enhancementValueBp,
      enhancementCount,
      valueBp: initialValueBp + enhancementValueBp,
    };
  }
  function validateSubOps(subOps, name, star, expectedMaximum = 4) {
    if (!Array.isArray(subOps) || subOps.length > expectedMaximum) fail('INVALID_SUB_OPS', `${name} must contain at most ${expectedMaximum} entries`);
    const range = subValueRange(star);
    const seen = new Set();
    return subOps.map((sub, index) => {
      if (!isRecord(sub)) fail('INVALID_SUB_OPS', `${name}[${index}] must be an object`);
      const opId = assertString(sub.opId, `${name}[${index}].opId`);
      getSubOp(opId);
      if (seen.has(opId)) fail('DUPLICATE_SUB_OP', `${name} has duplicate ${opId}`);
      seen.add(opId);
      const initialValueBp = assertNonNegativeInteger(sub.initialValueBp, `${name}[${index}].initialValueBp`);
      const enhancementValueBp = assertNonNegativeInteger(hasOwn(sub, 'enhancementValueBp') ? sub.enhancementValueBp : 0, `${name}[${index}].enhancementValueBp`);
      const enhancementCount = assertNonNegativeInteger(hasOwn(sub, 'enhancementCount') ? sub.enhancementCount : 0, `${name}[${index}].enhancementCount`);
      if (initialValueBp < range.min || initialValueBp > range.max) fail('INVALID_SUB_VALUE', `${name}[${index}] initial value is outside the star range`);
      if (enhancementValueBp < enhancementCount * range.min || enhancementValueBp > enhancementCount * range.max) fail('INVALID_SUB_VALUE', `${name}[${index}] enhancement value is outside the star range`);
      if (hasOwn(sub, 'valueBp') && sub.valueBp !== initialValueBp + enhancementValueBp) fail('INVALID_SUB_VALUE', `${name}[${index}] total does not match its components`);
      return makeSubOp(opId, initialValueBp, enhancementValueBp, enhancementCount);
    });
  }
  // initialSubOps is the immutable acquisition-time record. Unlike the
  // materialized subOps, it must never carry an enhancement roll.
  function validateInitialSubOps(subOps, star) {
    const checked = validateSubOps(subOps, 'initialSubOps', star);
    for (const sub of checked) {
      if (sub.enhancementValueBp !== 0 || sub.enhancementCount !== 0 || sub.valueBp !== sub.initialValueBp) {
        fail('INVALID_INITIAL_SUB_STATE', 'initial sub ops must not contain enhancement rolls');
      }
    }
    return checked;
  }
  // Structural validation deliberately does not trust materialized values.
  // validateGear() below regenerates them from the enhancement seed before it
  // accepts an item for any public calculation.
  function normalizeGearStructure(gear) {
    if (!isRecord(gear)) fail('INVALID_GEAR', 'gear must be an object');
    resolveSchemaRules(gear.schemaVersion);
    resolveGenerationRules(gear.generationVersion);
    resolveEnhancementRules(gear.enhancementVersion);
    assertInteger(gear.balanceTuningVersion, 1, Number.MAX_SAFE_INTEGER, 'gear balance tuning version');
    const gearId = assertString(gear.gearId, 'gearId');
    const slot = getSlot(gear.slotId);
    const set = getSet(gear.setId);
    const star = assertStar(gear.star);
    const rarity = getRarity(gear.rarityId);
    const enhancementLevel = assertEnhancementLevel(gear.enhancementLevel);
    if (!isRecord(gear.mainOp)) fail('INVALID_MAIN_OP', 'mainOp must be an object');
    const mainOpId = assertString(gear.mainOp.opId, 'mainOp.opId');
    if (!slot.mainOpIds.includes(mainOpId)) fail('INVALID_MAIN_OP', `${mainOpId} is not valid for ${slot.id}`);
    if (gear.mainOp.unit !== mainUnit(slot.id)) fail('INVALID_MAIN_UNIT', 'main op unit does not match slot');
    const initialSubOps = validateInitialSubOps(gear.initialSubOps, star);
    if (initialSubOps.length !== rarity.initialSubCount) fail('INVALID_INITIAL_SUB_COUNT', 'rarity initial sub count does not match');
    const subOps = validateSubOps(gear.subOps, 'subOps', star);
    assertSeed(gear.enhancementSeed, 'enhancementSeed');
    if (!isRecord(gear.acquisition)) fail('INVALID_ACQUISITION', 'acquisition must be an object');
    assertString(gear.acquisition.sourceId, 'acquisition.sourceId');
    if (!hasOwn(gear.acquisition, 'acquiredAt')) fail('INVALID_ACQUISITION', 'acquisition.acquiredAt is required');
    cloneData(gear.acquisition.acquiredAt, 'acquisition.acquiredAt');
    cloneData(gear.acquisition.detail, 'acquisition.detail');
    return {
      schemaVersion: gear.schemaVersion,
      generationVersion: gear.generationVersion,
      enhancementVersion: gear.enhancementVersion,
      balanceTuningVersion: gear.balanceTuningVersion,
      gearId,
      slotId: slot.id,
      setId: set.id,
      star,
      rarityId: rarity.id,
      enhancementLevel,
      mainOp: { opId: mainOpId, unit: gear.mainOp.unit },
      initialSubOps,
      subOps,
      enhancementSeed: String(gear.enhancementSeed),
      acquisition: { sourceId: gear.acquisition.sourceId, detail: cloneData(gear.acquisition.detail), acquiredAt: cloneData(gear.acquisition.acquiredAt) },
    };
  }
  function initialSubOpsFor({ star, rarityId, generationSeed, context, algorithmVersion }) {
    const count = getRarity(rarityId).initialSubCount;
    const selected = [];
    for (let index = 0; index < count; index += 1) {
      const candidates = SUB_OP_IDS.filter((opId) => !selected.some((entry) => entry.opId === opId));
      const opId = chooseArray(generationSeed, `initial-sub:${index}`, candidates, context, algorithmVersion);
      const valueBp = rollSubValueBp(star, generationSeed, `initial-sub-value:${index}`, context, algorithmVersion);
      selected.push(makeSubOp(opId, valueBp));
    }
    return selected;
  }
  function createGear(options) {
    if (!isRecord(options)) fail('INVALID_GENERATION_INPUT', 'generation options must be an object');
    const gearId = assertString(options.gearId, 'gearId');
    const generationSeed = assertSeed(options.generationSeed, 'generationSeed');
    const enhancementSeed = assertSeed(options.enhancementSeed, 'enhancementSeed');
    const generationRules = resolveGenerationRules(GEAR_GENERATION_VERSION);
    const qualityProfile = resolveQualityProfile(options.qualityProfile);
    const setProfile = resolveSetProfile(options.setProfile);
    // gearId and acquisition metadata identify the individual, but never take
    // part in random generation. Only generationSeed plus declared generation
    // constraints determines the initial rolls.
    const context = {
      qualityProfileId: qualityProfile.id,
      requestedSlotId: options.slotId === undefined ? null : options.slotId,
      requestedSetId: options.setId === undefined ? null : options.setId,
      minimumStar: options.minimumStar === undefined ? null : options.minimumStar,
    };
    // Set affinity belongs only to the set roll. Keeping it out of the other
    // labeled contexts means a boss affinity can never alter star, rarity,
    // main-op, or sub-op results for an otherwise identical reward request.
    const setContext = { ...context, setProfileId: setProfile.id };
    const slotId = options.slotId === undefined ? chooseArray(generationSeed, 'slot', SLOT_IDS, context, generationRules.prngAlgorithmVersion) : getSlot(options.slotId).id;
    const setId = options.setId === undefined ? chooseWeighted(generationSeed, 'set', setProfile.setWeights, new Set(SET_IDS), setContext, 'setWeights', generationRules.prngAlgorithmVersion) : getSet(options.setId).id;
    const starEntries = filterMinimumStar(qualityProfile.starWeights, options.minimumStar);
    const star = chooseWeighted(generationSeed, 'star', starEntries, new Set(STARS), context, 'starWeights', generationRules.prngAlgorithmVersion);
    const rarityId = chooseWeighted(generationSeed, 'rarity', qualityProfile.rarityWeights, new Set(RARITY_IDS), context, 'rarityWeights', generationRules.prngAlgorithmVersion);
    const slot = getSlot(slotId);
    const mainOpId = slot.mainKind === 'fixed' ? slot.mainOpIds[0] : chooseArray(generationSeed, 'main', slot.mainOpIds, context, generationRules.prngAlgorithmVersion);
    const tuning = validateBalanceTuning(options.balanceTuning || BALANCE_TUNING);
    // Resolve during fixed-slot creation so malformed tuning never becomes a silent zero gear.
    mainFinalValue(slotId, mainOpId, star, tuning);
    const initialSubOps = initialSubOpsFor({ star, rarityId, generationSeed, context, algorithmVersion: generationRules.prngAlgorithmVersion });
    const mainOp = { opId: mainOpId, unit: mainUnit(slotId) };
    const gear = {
      schemaVersion: GEAR_SCHEMA_VERSION,
      generationVersion: GEAR_GENERATION_VERSION,
      enhancementVersion: GEAR_ENHANCEMENT_VERSION,
      balanceTuningVersion: tuning.version,
      gearId,
      slotId,
      setId,
      star,
      rarityId,
      enhancementLevel: 0,
      mainOp,
      initialSubOps,
      subOps: initialSubOps.map((sub) => ({ ...sub })),
      enhancementSeed,
      acquisition: {
        sourceId: assertString(options.sourceId, 'sourceId'),
        detail: cloneData(options.sourceDetail === undefined ? null : options.sourceDetail),
        acquiredAt: cloneData(options.acquiredAt),
      },
    };
    return materializeGear(gear, 0, tuning).gear;
  }
  function calculateMilestonePlanFromChecked(checked, targetLevel) {
    const target = assertEnhancementLevel(targetLevel);
    const enhancementRules = resolveEnhancementRules(checked.enhancementVersion);
    const current = checked.initialSubOps.map((sub) => ({ ...sub }));
    const events = [];
    for (const level of enhancementRules.milestones) {
      if (level > target) break;
      // enhancementSeed is intentionally the only per-gear random identity.
      // gearId is metadata and must not alter a fixed enhancement outcome.
      const context = { star: checked.star, level };
      if (current.length < 4) {
        const candidates = SUB_OP_IDS.filter((opId) => !current.some((sub) => sub.opId === opId));
        const opId = chooseArray(checked.enhancementSeed, `enhance:${level}:add`, candidates, context, enhancementRules.prngAlgorithmVersion);
        const valueBp = rollSubValueBp(checked.star, checked.enhancementSeed, `enhance:${level}:value`, context, enhancementRules.prngAlgorithmVersion);
        const added = makeSubOp(opId, valueBp);
        current.push(added);
        events.push({ level, kind: 'add', opId, valueBp, subIndex: current.length - 1 });
      } else {
        const subIndex = uniformIndex(checked.enhancementSeed, `enhance:${level}:target`, current.length, context, enhancementRules.prngAlgorithmVersion);
        const valueBp = rollSubValueBp(checked.star, checked.enhancementSeed, `enhance:${level}:value`, context, enhancementRules.prngAlgorithmVersion);
        const prior = current[subIndex];
        current[subIndex] = makeSubOp(prior.opId, prior.initialValueBp, prior.enhancementValueBp + valueBp, prior.enhancementCount + 1);
        events.push({ level, kind: 'upgrade', opId: prior.opId, valueBp, subIndex });
      }
    }
    return { subOps: current, milestones: events };
  }
  function materializeGearFromChecked(checked, targetLevel, tuning) {
    const target = assertEnhancementLevel(targetLevel);
    const plan = calculateMilestonePlanFromChecked(checked, target);
    const mainValue = mainValueAtLevel(checked.slotId, checked.mainOp.opId, checked.star, target, tuning);
    const materialized = {
      ...checked,
      enhancementLevel: target,
      mainOp: { ...checked.mainOp, value: mainValue, finalValue: mainFinalValue(checked.slotId, checked.mainOp.opId, checked.star, tuning) },
      initialSubOps: checked.initialSubOps.map((sub) => ({ ...sub })),
      subOps: plan.subOps.map((sub) => ({ ...sub })),
      acquisition: cloneData(checked.acquisition),
    };
    return { gear: materialized, milestones: plan.milestones };
  }
  function verifyMaterializedGear(rawGear, expectedGear) {
    if (!isRecord(rawGear.mainOp) || !hasOwn(rawGear.mainOp, 'value') || !hasOwn(rawGear.mainOp, 'finalValue')) {
      fail('GEAR_MATERIALIZATION_MISMATCH', 'main op must include regenerated current and final values');
    }
    assertNonNegativeInteger(rawGear.mainOp.value, 'mainOp.value');
    assertNonNegativeInteger(rawGear.mainOp.finalValue, 'mainOp.finalValue');
    if (rawGear.mainOp.value !== expectedGear.mainOp.value || rawGear.mainOp.finalValue !== expectedGear.mainOp.finalValue) {
      fail('GEAR_MATERIALIZATION_MISMATCH', 'main op values do not match the deterministic materialization');
    }
    if (stableStringify(rawGear.initialSubOps) !== stableStringify(expectedGear.initialSubOps)
      || stableStringify(rawGear.subOps) !== stableStringify(expectedGear.subOps)) {
      fail('GEAR_ENHANCEMENT_MISMATCH', 'sub ops do not match the deterministic enhancement plan');
    }
  }
  function validateGear(gear, options = {}) {
    const checked = normalizeGearStructure(gear);
    const tuning = resolveBalanceTuningForVersion(checked.balanceTuningVersion, options.balanceTuning);
    const materialized = materializeGearFromChecked(checked, checked.enhancementLevel, tuning);
    verifyMaterializedGear(gear, materialized.gear);
    return materialized.gear;
  }
  function calculateMilestonePlan(gear, targetLevel, options = {}) {
    const checked = validateGear(gear, options);
    return calculateMilestonePlanFromChecked(checked, targetLevel);
  }
  function materializeGear(gear, targetLevel, tuning = BALANCE_TUNING) {
    const checked = normalizeGearStructure(gear);
    const resolvedTuning = resolveBalanceTuningForVersion(checked.balanceTuningVersion, tuning);
    return materializeGearFromChecked(checked, targetLevel, resolvedTuning);
  }
  function previewEnhancement(gear, targetLevel, options = {}) {
    const checked = validateGear(gear, options);
    const tuning = resolveBalanceTuningForVersion(checked.balanceTuningVersion, options.balanceTuning);
    return materializeGearFromChecked(checked, targetLevel, tuning);
  }
  function enhanceGear(gear, targetLevel, options = {}) {
    return previewEnhancement(gear, targetLevel, options).gear;
  }

  function addStats(target, source) {
    Object.entries(source).forEach(([key, value]) => {
      if (!hasOwn(target, key)) fail('UNKNOWN_STAT_BUCKET', `Unknown stat bucket ${key}`);
      assertNonNegativeInteger(value, `stat ${key}`);
      target[key] += value;
    });
  }
  function addGearStats(stats, gear, tuning) {
    const mainValue = mainValueAtLevel(gear.slotId, gear.mainOp.opId, gear.star, gear.enhancementLevel, tuning);
    const fixed = FIXED_MAIN_OP_BY_ID.get(gear.mainOp.opId);
    if (fixed) stats[fixed.bucket] += mainValue;
    else stats[getVariableMainOp(gear.mainOp.opId).bucket] += mainValue;
    gear.subOps.forEach((sub) => { stats[getSubOp(sub.opId).bucket] += sub.valueBp; });
  }
  /**
   * Applies a gear-domain soft cap to an already combined integer bp value.
   * The caller supplies the total it wants capped (for example base crit damage
   * plus gear), while battle-stat composition remains outside Phase 1.
   */
  function applySoftCap(opId, equippedBp) {
    getSubOp(opId);
    assertNonNegativeInteger(equippedBp, 'equippedBp');
    const softCapBp = SOFT_CAPS_BP[opId] || null;
    if (softCapBp === null) return { opId, equippedBp, effectiveBp: equippedBp, normalRangeBp: equippedBp, overflowBp: 0, softCapBp: null, hardCapBp: null };
    const normalRangeBp = Math.min(equippedBp, softCapBp);
    const overflowBp = Math.max(0, equippedBp - softCapBp);
    return { opId, equippedBp, effectiveBp: normalRangeBp + Math.floor(overflowBp / 2), normalRangeBp, overflowBp, softCapBp, hardCapBp: null };
  }
  function normalizeLoadout(loadout, options = {}) {
    if (!Array.isArray(loadout) || loadout.length > SLOT_IDS.length) fail('INVALID_LOADOUT', 'loadout must be an array of up to six slots');
    const seenSlots = new Set();
    const seenGearIds = new Set();
    return loadout.filter((gear) => gear !== null && gear !== undefined).map((gear) => {
      const checked = validateGear(gear, options);
      if (seenSlots.has(checked.slotId)) fail('DUPLICATE_SLOT', `loadout repeats slot ${checked.slotId}`);
      if (seenGearIds.has(checked.gearId)) fail('DUPLICATE_GEAR_ID', `loadout repeats gear ${checked.gearId}`);
      seenSlots.add(checked.slotId);
      seenGearIds.add(checked.gearId);
      return checked;
    });
  }
  function aggregateLoadout(loadout, options = {}) {
    const tuning = options.balanceTuning || BALANCE_TUNING;
    const gears = normalizeLoadout(loadout, options);
    const stats = EMPTY_STATS();
    const setCounts = {};
    gears.forEach((gear) => {
      addGearStats(stats, gear, tuning);
      setCounts[gear.setId] = (setCounts[gear.setId] || 0) + 1;
    });
    const activeSetEffects = [];
    const conditionalEffects = [];
    SET_IDS.forEach((setId) => {
      const count = setCounts[setId] || 0;
      if (count < 2) return;
      const set = getSet(setId);
      [2, 4].forEach((threshold) => {
        if (count < threshold) return;
        const effect = set.effects[threshold];
        addStats(stats, effect.stats);
        const descriptors = effect.conditionalEffects.map((entry) => ({ setId, threshold, ...cloneData(entry) }));
        conditionalEffects.push(...descriptors);
        activeSetEffects.push({ setId, threshold, stats: cloneData(effect.stats), conditionalEffects: descriptors });
      });
    });
    const softCaps = {
      critRate: applySoftCap('crit_rate', stats.critRateBp), critDamage: applySoftCap('crit_damage', stats.critDamageBp),
      statusResistance: applySoftCap('status_resistance', stats.statusResistanceBp), blastPower: applySoftCap('blast_power', stats.blastPowerBp),
      healPower: applySoftCap('heal_power', stats.healPowerBp), shieldPower: applySoftCap('shield_power', stats.shieldPowerBp),
      receivedHeal: applySoftCap('received_heal', stats.receivedHealBp), receivedShield: applySoftCap('received_shield', stats.receivedShieldBp),
    };
    return {
      equippedSlotCount: gears.length,
      setCounts: Object.fromEntries(SET_IDS.map((setId) => [setId, setCounts[setId] || 0])),
      activeSetEffects,
      stats,
      softCaps,
      conditionalEffects,
    };
  }

  function gsBand(score) {
    assertInteger(score, 0, 100, 'gear score');
    if (score >= 90) return { id: 'divine', labelJa: '神級' };
    if (score >= 80) return { id: 'excellent', labelJa: '極上' };
    if (score >= 60) return { id: 'high_quality', labelJa: '高品質' };
    if (score >= 40) return { id: 'good', labelJa: '良品' };
    return { id: 'normal', labelJa: '通常' };
  }
  function cappedFraction(numerator, denominator, cap) {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    const maximum = BigInt(cap);
    return n > maximum * d ? { numerator: maximum, denominator: 1n } : { numerator: n, denominator: d };
  }
  function roundFraction(fraction) {
    return Number(((fraction.numerator * 2n) + fraction.denominator) / (fraction.denominator * 2n));
  }
  function scoreBreakdown(gear, mainValue, subTotalBp, tuning) {
    const denominator = mainFinalValue(gear.slotId, gear.mainOp.opId, 6, tuning);
    const fractions = {
      rank: cappedFraction(GS_CONSTANTS.rankMax * (gear.star - 1), 5, GS_CONSTANTS.rankMax),
      rarity: cappedFraction(GS_CONSTANTS.rarityMax * getRarity(gear.rarityId).initialSubCount, 4, GS_CONSTANTS.rarityMax),
      main: cappedFraction(GS_CONSTANTS.mainMax * mainValue, denominator, GS_CONSTANTS.mainMax),
      sub: cappedFraction(GS_CONSTANTS.subMax * Math.min(subTotalBp, GS_CONSTANTS.star6MaxSubTotalBp), GS_CONSTANTS.star6MaxSubTotalBp, GS_CONSTANTS.subMax),
    };
    const keys = ['rank', 'rarity', 'main', 'sub'];
    // Sum rational terms exactly, then round once as specified. We use the
    // product denominator only for this bounded four-term score calculation.
    const commonDenominator = keys.reduce((product, key) => product * fractions[key].denominator, 1n);
    const totalFraction = {
      numerator: keys.reduce((sum, key) => sum + (fractions[key].numerator * (commonDenominator / fractions[key].denominator)), 0n),
      denominator: commonDenominator,
    };
    const total = Math.min(100, roundFraction(totalFraction));
    const points = {};
    const remainders = keys.map((key, order) => {
      const floor = Number(fractions[key].numerator / fractions[key].denominator);
      points[key] = floor;
      return { key, order, numerator: fractions[key].numerator % fractions[key].denominator, denominator: fractions[key].denominator };
    });
    let remaining = total - keys.reduce((sum, key) => sum + points[key], 0);
    remainders.sort((left, right) => {
      const comparison = (right.numerator * left.denominator) - (left.numerator * right.denominator);
      if (comparison > 0n) return 1;
      if (comparison < 0n) return -1;
      return left.order - right.order;
    });
    for (let index = 0; index < remaining; index += 1) points[remainders[index % remainders.length].key] += 1;
    return {
      rank: points.rank,
      rarity: points.rarity,
      main: points.main,
      sub: points.sub,
      total,
      rawFractions: Object.fromEntries(keys.map((key) => [key, { numerator: fractions[key].numerator.toString(), denominator: fractions[key].denominator.toString() }])),
      rawTotal: { numerator: totalFraction.numerator.toString(), denominator: totalFraction.denominator.toString() },
    };
  }
  function calculateGearScore(gear, options = {}) {
    const checked = validateGear(gear, options);
    const tuning = resolveBalanceTuningForVersion(checked.balanceTuningVersion, options.balanceTuning);
    const currentMainValue = mainValueAtLevel(checked.slotId, checked.mainOp.opId, checked.star, checked.enhancementLevel, tuning);
    const currentSubTotalBp = checked.subOps.reduce((sum, sub) => sum + sub.valueBp, 0);
    const current = scoreBreakdown(checked, currentMainValue, currentSubTotalBp, tuning);
    const remainingMilestones = resolveEnhancementRules(checked.enhancementVersion).milestones.filter((level) => level > checked.enhancementLevel).length;
    const maxSubValueBp = subValueRange(checked.star).max;
    const theoreticalSubTotalBp = currentSubTotalBp + (remainingMilestones * maxSubValueBp);
    const maximum = scoreBreakdown(checked, mainFinalValue(checked.slotId, checked.mainOp.opId, checked.star, tuning), theoreticalSubTotalBp, tuning);
    return {
      currentGs: current.total,
      maxReachGs: maximum.total,
      currentBreakdown: current,
      maxReachBreakdown: maximum,
      currentBand: gsBand(current.total),
      maxReachBand: gsBand(maximum.total),
      shouldAutoLock: current.total >= GS_CONSTANTS.autoLockThreshold,
      futureRollCount: remainingMilestones,
      theoreticalSubTotalBp,
    };
  }

  function calculateEnhancementCost(fromLevel, toLevel) {
    const from = assertEnhancementLevel(fromLevel);
    const to = assertEnhancementLevel(toLevel);
    if (to < from) fail('INVALID_ENHANCEMENT_TARGET', 'target enhancement level cannot go backward');
    const levels = [];
    let coins = 0;
    let powder = 0;
    for (let level = from + 1; level <= to; level += 1) {
      const cost = ENHANCEMENT_COSTS[level];
      levels.push({ level, coins: cost.coins, powder: cost.powder });
      coins += cost.coins;
      powder += cost.powder;
    }
    return { fromLevel: from, toLevel: to, levels, coins, powder };
  }
  function calculateDismantleYield(gear, options = {}) {
    const checked = validateGear(gear, options);
    const invested = calculateEnhancementCost(0, checked.enhancementLevel);
    const basePowder = DISMANTLE_BASE_POWDER_BY_STAR[checked.star];
    const recoveredPowder = Math.floor((invested.powder * 2) / 5);
    const multiplier = BLUEPRINT_SHARD_RARITY_MULTIPLIER[checked.rarityId];
    const blueprintShards = roundDiv(BLUEPRINT_SHARD_BASE_BY_STAR[checked.star] * multiplier.numerator, multiplier.denominator);
    return {
      basePowder,
      investedPowder: invested.powder,
      recoveredPowder,
      powder: basePowder + recoveredPowder,
      blueprintShards,
      coinsReturned: 0,
    };
  }
  function getTargetedBoxQuote(kind, constraints = {}) {
    if (!hasOwn(TARGETED_BOX_COSTS, kind)) fail('UNKNOWN_TARGETED_BOX_KIND', `Unknown targeted box kind: ${kind}`);
    if (!isRecord(constraints)) fail('INVALID_TARGETED_BOX', 'constraints must be an object');
    if (!hasOwn(constraints, 'qualityProfileId') && !hasOwn(constraints, 'qualityProfile')) {
      fail('MISSING_TARGETED_BOX_QUALITY_PROFILE', 'targeted boxes require an explicit quality profile');
    }
    const qualityProfile = resolveQualityProfile(hasOwn(constraints, 'qualityProfileId') ? constraints.qualityProfileId : constraints.qualityProfile);
    if (!TARGETED_BOX_QUALITY_PROFILE_IDS.includes(qualityProfile.id)) {
      fail('TARGETED_BOX_QUALITY_PROFILE_NOT_ALLOWED', 'targeted boxes require a cooperative-boss difficulty quality profile');
    }
    const result = { kind, blueprintShards: TARGETED_BOX_COSTS[kind], constraints: { qualityProfileId: qualityProfile.id } };
    if (kind === 'slot' || kind === 'slot_set') result.constraints.slotId = getSlot(constraints.slotId).id;
    if (kind === 'set' || kind === 'slot_set') result.constraints.setId = getSet(constraints.setId).id;
    return result;
  }
  function toPublicGearView(gear, options = {}) {
    const checked = validateGear(gear, options);
    return {
      schemaVersion: checked.schemaVersion,
      generationVersion: checked.generationVersion,
      enhancementVersion: checked.enhancementVersion,
      balanceTuningVersion: checked.balanceTuningVersion,
      gearId: checked.gearId,
      slotId: checked.slotId,
      setId: checked.setId,
      star: checked.star,
      rarityId: checked.rarityId,
      enhancementLevel: checked.enhancementLevel,
      mainOp: cloneData(checked.mainOp),
      subOps: cloneData(checked.subOps),
      // Acquisition detail is intentionally internal: caller-defined detail
      // can itself contain seeds or future/private reward metadata.
      acquisition: { sourceId: checked.acquisition.sourceId, acquiredAt: cloneData(checked.acquisition.acquiredAt) },
    };
  }
  function buildBalanceBoundaryReport(loadout, options = {}) {
    const aggregate = aggregateLoadout(loadout, options);
    return {
      staticStats: aggregate.stats,
      softCaps: aggregate.softCaps,
      activeSetEffects: aggregate.activeSetEffects,
      conditionalEffects: aggregate.conditionalEffects,
      theoreticalGrowthBp: {
        attackPctBp: aggregate.stats.attackPctBp,
        hpPctBp: aggregate.stats.hpPctBp,
        defensePctBp: aggregate.stats.defensePctBp,
      },
    };
  }

  return deepFreeze({
    GearDomainError,
    GEAR_SCHEMA_VERSION, GEAR_GENERATION_VERSION, GEAR_ENHANCEMENT_VERSION, BALANCE_TUNING_VERSION, PRNG_ALGORITHM_VERSION,
    BP_PER_PERCENT, MAX_ENHANCEMENT_LEVEL, ENHANCEMENT_MILESTONES,
    SLOTS, SLOT_IDS, STARS, RARITIES, RARITY_IDS, SUB_OPS, SUB_OP_IDS, SETS, SET_IDS,
    SUB_VALUE_RANGE_BP_BY_STAR, COOP_BOSS_QUALITY_PROFILES, CPU_BATTLE_QUALITY_PROFILES, QUALITY_PROFILES, GEAR_SET_PROFILES, TARGETED_BOX_QUALITY_PROFILE_IDS,
    ENHANCEMENT_COSTS, DISMANTLE_BASE_POWDER_BY_STAR, BLUEPRINT_SHARD_BASE_BY_STAR, BLUEPRINT_SHARD_RARITY_MULTIPLIER, TARGETED_BOX_COSTS,
    SOFT_CAPS_BP, GS_CONSTANTS, BALANCE_TUNING, BALANCE_TUNING_BY_VERSION, GEAR_SCHEMA_RULES_BY_VERSION, GENERATION_RULES_BY_VERSION, ENHANCEMENT_RULES_BY_VERSION,
    stableStringify, validateWeightedTable, chooseWeightedByRoll, deriveDeterministicUint32, selectUniformIndexFromUint32, createLabeledPrng,
    validateBalanceTuning, resolveBalanceTuningForVersion, resolveSchemaRules, resolveGenerationRules, resolveEnhancementRules, validateQualityProfile, resolveQualityProfile, validateSetProfile, resolveSetProfile, validateInitialSubOps, mainFinalValue, mainValueAtLevel, subValueRange,
    validateGear, createGear, calculateMilestonePlan, previewEnhancement, enhanceGear,
    applySoftCap, aggregateLoadout, calculateGearScore, calculateEnhancementCost, calculateDismantleYield, getTargetedBoxQuote,
    toPublicGearView, buildBalanceBoundaryReport,
  });
});
