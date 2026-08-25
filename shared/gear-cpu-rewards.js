(function initKatamonGearCpuRewards(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearCpuRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearCpuRewards(root) {
  'use strict';

  // CPU reward calculation is intentionally data-only.  Run identity and
  // settlement timestamps are supplied by the integration layer; this module
  // must never create them from a clock or random device.
  const CPU_REWARD_RULES_VERSION = 1;
  const CPU_REWARD_SOURCE_ID = 'cpu_battle';
  const CPU_SETTLEMENT_OUTCOMES = Object.freeze(['voluntary', 'defeat', 'draw']);
  const CPU_REWARD_MILESTONES = Object.freeze([3, 5, 8, 10, 15, 20, 30, 50]);

  class GearCpuRewardsError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'GearCpuRewardsError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }
  const fail = (code, message, cause) => { throw new GearCpuRewardsError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  const assertExactKeys = (value, keys, path) => {
    if (!isPlainRecord(value)) fail('INVALID_CPU_REWARD_INPUT', `${path} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('INVALID_CPU_REWARD_INPUT', `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail('INVALID_CPU_REWARD_INPUT', `${path}.${key} must be an enumerable data property`);
      }
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      fail('INVALID_CPU_REWARD_INPUT', `${path} has unknown or missing fields`);
    }
  };
  const assertNonEmptyString = (value, path) => {
    if (typeof value !== 'string' || value.length === 0) fail('INVALID_CPU_REWARD_INPUT', `${path} must be a non-empty string`);
    return value;
  };
  const assertNonNegativeSafeInteger = (value, path) => {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_CPU_REWARD_INPUT', `${path} must be a non-negative safe integer`);
    return value;
  };
  const cloneJson = (value) => JSON.parse(JSON.stringify(value));

  function resolveDomain() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js');
    if (root && root.KatamonGearDomain) return root.KatamonGearDomain;
    fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be loaded before CPU reward rules');
  }
  function assertOutcome(value) {
    if (!CPU_SETTLEMENT_OUTCOMES.includes(value)) fail('INVALID_CPU_SETTLEMENT_OUTCOME', 'outcome must be voluntary, defeat, or draw');
    return value;
  }
  function qualityForPeak(peakStreak, outcome) {
    const peak = assertNonNegativeSafeInteger(peakStreak, 'peakStreak');
    const checkedOutcome = assertOutcome(outcome);
    if (peak >= 20) return { key: 'streak15', tier: 15, highestQualityLocked: true };
    if (peak >= 15) return checkedOutcome === 'voluntary'
      ? { key: 'streak15', tier: 15, highestQualityLocked: false }
      : { key: 'streak10', tier: 10, highestQualityLocked: false };
    if (peak >= 10) return { key: 'streak10', tier: 10, highestQualityLocked: false };
    if (peak >= 8) return { key: 'streak8', tier: 8, highestQualityLocked: false };
    if (peak >= 5) return { key: 'streak5', tier: 5, highestQualityLocked: false };
    return { key: 'streak3', tier: 3, highestQualityLocked: false };
  }
  function getCpuRewardGearCount(peakStreak) {
    const peak = assertNonNegativeSafeInteger(peakStreak, 'peakStreak');
    if (peak < 3) return 0;
    if (peak < 10) return 1;
    if (peak < 20) return 2;
    if (peak < 30) return 3;
    if (peak < 50) return 4;
    return 5;
  }
  function getCpuRewardBlueprintShards(peakStreak) {
    const peak = assertNonNegativeSafeInteger(peakStreak, 'peakStreak');
    if (peak < 20) return 0;
    if (peak < 30) return 30;
    if (peak < 50) return 80;
    return 180;
  }
  function getNextCpuRewardMilestone(peakStreak) {
    const peak = assertNonNegativeSafeInteger(peakStreak, 'peakStreak');
    const nextPeakStreak = CPU_REWARD_MILESTONES.find((milestone) => milestone > peak) || null;
    return nextPeakStreak === null ? null : { peakStreak: nextPeakStreak, winsRemaining: nextPeakStreak - peak };
  }
  function resolveCpuRewardQuality(peakStreak, outcome) {
    const resolved = qualityForPeak(peakStreak, outcome);
    const profile = resolveDomain().CPU_BATTLE_QUALITY_PROFILES[resolved.key];
    if (!profile) fail('CPU_QUALITY_PROFILE_UNAVAILABLE', `missing CPU quality profile ${resolved.key}`);
    return Object.freeze({ qualityProfileId: profile.id, qualityTier: resolved.tier, highestQualityLocked: resolved.highestQualityLocked });
  }
  function previewCpuSettlement(input) {
    assertExactKeys(input, ['peakStreak', 'outcome'], 'preview');
    const peakStreak = assertNonNegativeSafeInteger(input.peakStreak, 'peakStreak');
    const outcome = assertOutcome(input.outcome);
    const quality = resolveCpuRewardQuality(peakStreak, outcome);
    const gearCount = getCpuRewardGearCount(peakStreak);
    const blueprintShards = getCpuRewardBlueprintShards(peakStreak);
    return Object.freeze({
      peakStreak,
      outcome,
      ...quality,
      gearCount,
      blueprintShards,
      hasReward: gearCount > 0 || blueprintShards > 0,
      nextMilestone: getNextCpuRewardMilestone(peakStreak),
    });
  }
  function createCpuSettlementIntent(input) {
    assertExactKeys(input, ['runId', 'peakStreak', 'outcome', 'settlementCreatedAtMs'], 'settlement intent input');
    const runId = assertNonEmptyString(input.runId, 'runId');
    const settlementCreatedAtMs = assertNonNegativeSafeInteger(input.settlementCreatedAtMs, 'settlementCreatedAtMs');
    const preview = previewCpuSettlement({ peakStreak: input.peakStreak, outcome: input.outcome });
    return Object.freeze({
      rewardRulesVersion: CPU_REWARD_RULES_VERSION,
      runId,
      rewardId: `cpu:${runId}:settlement`,
      settlementCreatedAtMs,
      peakStreak: preview.peakStreak,
      outcome: preview.outcome,
      qualityProfileId: preview.qualityProfileId,
      gearCount: preview.gearCount,
      blueprintShards: preview.blueprintShards,
    });
  }
  function validateCpuSettlementIntent(rawIntent) {
    assertExactKeys(rawIntent, [
      'rewardRulesVersion', 'runId', 'rewardId', 'settlementCreatedAtMs', 'peakStreak', 'outcome', 'qualityProfileId', 'gearCount', 'blueprintShards',
    ], 'settlement intent');
    if (rawIntent.rewardRulesVersion !== CPU_REWARD_RULES_VERSION) {
      if (Number.isSafeInteger(rawIntent.rewardRulesVersion) && rawIntent.rewardRulesVersion > CPU_REWARD_RULES_VERSION) {
        fail('UNSUPPORTED_FUTURE_CPU_REWARD_RULES_VERSION', 'settlement intent uses a newer CPU reward rules version');
      }
      fail('UNSUPPORTED_CPU_REWARD_RULES_VERSION', 'settlement intent uses an unsupported CPU reward rules version');
    }
    const runId = assertNonEmptyString(rawIntent.runId, 'settlement intent.runId');
    const rewardId = assertNonEmptyString(rawIntent.rewardId, 'settlement intent.rewardId');
    const settlementCreatedAtMs = assertNonNegativeSafeInteger(rawIntent.settlementCreatedAtMs, 'settlement intent.settlementCreatedAtMs');
    const peakStreak = assertNonNegativeSafeInteger(rawIntent.peakStreak, 'settlement intent.peakStreak');
    const outcome = assertOutcome(rawIntent.outcome);
    const expected = createCpuSettlementIntent({ runId, peakStreak, outcome, settlementCreatedAtMs });
    if (rewardId !== expected.rewardId || rawIntent.qualityProfileId !== expected.qualityProfileId
      || rawIntent.gearCount !== expected.gearCount || rawIntent.blueprintShards !== expected.blueprintShards) {
      fail('CPU_SETTLEMENT_INTENT_MISMATCH', 'settlement intent does not match the immutable CPU reward rules');
    }
    return expected;
  }
  function materializeCpuGearReward(rawIntent) {
    const intent = validateCpuSettlementIntent(rawIntent);
    const domain = resolveDomain();
    const profile = Object.values(domain.CPU_BATTLE_QUALITY_PROFILES).find((candidate) => candidate.id === intent.qualityProfileId);
    if (!profile) fail('CPU_QUALITY_PROFILE_UNAVAILABLE', `unknown CPU quality profile ${intent.qualityProfileId}`);
    const sourceDetail = Object.freeze({
      runId: intent.runId,
      peakStreak: intent.peakStreak,
      outcome: intent.outcome,
      qualityProfileId: intent.qualityProfileId,
    });
    const gears = [];
    for (let index = 0; index < intent.gearCount; index += 1) {
      const identity = `cpu:${intent.runId}:gear:${index}`;
      try {
        gears.push(domain.createGear({
          gearId: identity,
          generationSeed: `${identity}:generation:v1`,
          enhancementSeed: `${identity}:enhancement:v1`,
          sourceId: CPU_REWARD_SOURCE_ID,
          sourceDetail: { ...sourceDetail, rewardId: intent.rewardId, gearIndex: index },
          acquiredAt: intent.settlementCreatedAtMs,
          qualityProfile: profile,
          setProfile: domain.GEAR_SET_PROFILES.uniform,
        }));
      } catch (error) {
        fail(error && error.code ? error.code : 'CPU_GEAR_MATERIALIZATION_FAILED', 'could not materialize CPU reward gear', error);
      }
    }
    return Object.freeze({
      rewardId: intent.rewardId,
      sourceId: CPU_REWARD_SOURCE_ID,
      sourceDetail: cloneJson(sourceDetail),
      createdAtMs: intent.settlementCreatedAtMs,
      // GearStorage intentionally rejects frozen/non-ordinary arrays while
      // validating persisted JSON shape.  Keep the envelope immutable at the
      // top level, but hand its collection to the Phase 2B queue as a normal
      // dense array rather than a frozen runtime-only container.
      gears,
      blueprintShards: intent.blueprintShards,
    });
  }

  return Object.freeze({
    GearCpuRewardsError,
    CPU_REWARD_RULES_VERSION, CPU_REWARD_SOURCE_ID, CPU_SETTLEMENT_OUTCOMES, CPU_REWARD_MILESTONES,
    resolveCpuRewardQuality, getCpuRewardGearCount, getCpuRewardBlueprintShards, getNextCpuRewardMilestone,
    previewCpuSettlement, createCpuSettlementIntent, validateCpuSettlementIntent, materializeCpuGearReward,
  });
});
