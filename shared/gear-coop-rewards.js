(function initKatamonGearCoopRewards(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearCoopRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearCoopRewards(root) {
  'use strict';

  const COOP_REWARD_RULES_VERSION = 1;
  const COOP_REWARD_SOURCE_ID = 'coop_boss';
  const DIFFICULTIES = Object.freeze(['normal', 'hard', 'extreme']);
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  class GearCoopRewardsError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearCoopRewardsError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearCoopRewardsError(code, message, cause); };
  const assertString = (value, path) => { if (typeof value !== 'string' || !value) fail('INVALID_COOP_REWARD_INPUT', `${path} must be a non-empty string`); return value; };
  const assertTime = (value, path) => { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_COOP_REWARD_INPUT', `${path} must be a non-negative safe integer`); return value; };
  function exact(value, keys, path) {
    if (!isPlainRecord(value)) fail('INVALID_COOP_REWARD_INPUT', `${path} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail('INVALID_COOP_REWARD_INPUT', `${path} contains an invalid property`); }
    const actual = Object.keys(value).sort(); const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail('INVALID_COOP_REWARD_INPUT', `${path} has unknown or missing fields`);
  }
  function domain() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js'); if (root?.KatamonGearDomain) return root.KatamonGearDomain; fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be available'); }
  function assertDifficulty(value) { if (!DIFFICULTIES.includes(value)) fail('INVALID_COOP_DIFFICULTY', 'difficulty must be normal, hard, or extreme'); return value; }
  function minimumStar(difficulty) { return ({ normal: 3, hard: 4, extreme: 6 })[difficulty]; }
  function createCoopSettlementIntent(input) {
    exact(input, ['matchId', 'eventId', 'difficulty', 'outcome', 'firstClear', 'createdAtMs'], 'settlement input');
    const matchId = assertString(input.matchId, 'matchId'); const eventId = assertString(input.eventId, 'eventId'); const difficulty = assertDifficulty(input.difficulty); const createdAtMs = assertTime(input.createdAtMs, 'createdAtMs');
    if (!/^[0-9a-f]{48}$/.test(matchId)) fail('INVALID_COOP_REWARD_INPUT', 'matchId must be lowercase 48-hex');
    if (eventId !== `${matchId}:result`) fail('INVALID_COOP_REWARD_INPUT', 'eventId must be the canonical cooperative result id');
    if (input.outcome !== 'victory') fail('INVALID_COOP_OUTCOME', 'only victory creates a cooperative Gear settlement');
    if (typeof input.firstClear !== 'boolean') fail('INVALID_COOP_REWARD_INPUT', 'firstClear must be a boolean');
    return Object.freeze({ rewardRulesVersion: COOP_REWARD_RULES_VERSION, matchId, eventId, difficulty, outcome: 'victory', firstClear: input.firstClear, createdAtMs, rewardId: `coop:${matchId}:gear`, gearCount: input.firstClear ? 3 : 2 });
  }
  function materializeCoopGearReward(rawIntent) {
    const intent = createCoopSettlementIntent({ matchId: rawIntent.matchId, eventId: rawIntent.eventId,
      difficulty: rawIntent.difficulty, outcome: rawIntent.outcome, firstClear: rawIntent.firstClear, createdAtMs: rawIntent.createdAtMs });
    const api = domain(); const qualityProfile = api.COOP_BOSS_QUALITY_PROFILES[intent.difficulty];
    if (!qualityProfile || !api.GEAR_SET_PROFILES.fortress) fail('COOP_PROFILE_UNAVAILABLE', 'cooperative Gear profiles are unavailable');
    const gears = [];
    for (let index = 0; index < intent.gearCount; index += 1) {
      const gearId = `coop:${intent.matchId}:gear:${index}`;
      try {
        gears.push(api.createGear({ gearId, generationSeed: `${gearId}:generation:v1`, enhancementSeed: `${gearId}:enhancement:v1`, sourceId: COOP_REWARD_SOURCE_ID,
          sourceDetail: { matchId: intent.matchId, eventId: intent.eventId, difficulty: intent.difficulty, firstClear: intent.firstClear, rewardId: intent.rewardId, gearIndex: index },
          acquiredAt: intent.createdAtMs, qualityProfile, setProfile: api.GEAR_SET_PROFILES.fortress, minimumStar: index === 2 ? minimumStar(intent.difficulty) : undefined }));
      } catch (error) { fail(error?.code || 'COOP_GEAR_MATERIALIZATION_FAILED', 'could not materialize cooperative Gear reward', error); }
    }
    return Object.freeze({ rewardId: intent.rewardId, sourceId: COOP_REWARD_SOURCE_ID, sourceDetail: { matchId: intent.matchId, eventId: intent.eventId, difficulty: intent.difficulty, firstClear: intent.firstClear }, createdAtMs: intent.createdAtMs, gears, powder: 0, blueprintShards: 0 });
  }
  return Object.freeze({ GearCoopRewardsError, COOP_REWARD_RULES_VERSION, COOP_REWARD_SOURCE_ID, DIFFICULTIES, minimumStar, createCoopSettlementIntent, materializeCoopGearReward });
});
