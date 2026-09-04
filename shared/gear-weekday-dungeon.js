(function initKatamonGearWeekdayDungeon(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearWeekdayDungeon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearWeekdayDungeon(root) {
  'use strict';

  // This module is intentionally pure: callers supply the instant and aim.
  const WEEKDAY_DUNGEON_SCHEMA_VERSION = 1;
  const WEEKDAY_DUNGEON_RULES_VERSION = 1;
  const WEEKDAY_DUNGEON_SOURCE_ID = 'weekday_dungeon';
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const PLAYFIELD = Object.freeze({ width: 540, height: 720, originX: 96, originY: 636 });
  const AIM_LIMITS = Object.freeze({ angleMin: 10, angleMax: 80, powerMin: 28, powerMax: 120 });
  const HIT_RADIUS = 66;
  const WEEKDAY_SLOT_IDS = Object.freeze(['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  const DAY_SLOT_IDS = Object.freeze(['auxiliary', 'barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  const WEEKDAY_DUNGEON_QUALITY_PROFILE = Object.freeze({
    id: 'weekday-dungeon-v1',
    starWeights: Object.freeze([Object.freeze({ id: 1, weight: 35 }), Object.freeze({ id: 2, weight: 35 }), Object.freeze({ id: 3, weight: 20 }), Object.freeze({ id: 4, weight: 10 }), Object.freeze({ id: 5, weight: 0 }), Object.freeze({ id: 6, weight: 0 })]),
    rarityWeights: Object.freeze([Object.freeze({ id: 'normal', weight: 40 }), Object.freeze({ id: 'rare', weight: 34 }), Object.freeze({ id: 'epic', weight: 20 }), Object.freeze({ id: 'legend', weight: 5 }), Object.freeze({ id: 'mythic', weight: 1 })]),
  });

  class GearWeekdayDungeonError extends Error {
    constructor(code, message, cause) { super(message || code); this.name = 'GearWeekdayDungeonError'; this.code = code; if (cause !== undefined) this.cause = cause; }
  }
  const fail = (code, message, cause) => { throw new GearWeekdayDungeonError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function assertExactKeys(value, keys, path) {
    if (!isPlainRecord(value)) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path}.${key} must be an enumerable data property`);
    }
    const actual = Object.keys(value).sort(); const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail('UNKNOWN_WEEKDAY_DUNGEON_FIELD', `${path} has unknown or missing fields`);
  }
  function assertSafeInteger(value, min, path) {
    if (!Number.isSafeInteger(value) || value < min) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must be a safe integer >= ${min}`);
    return value;
  }
  function assertSlotId(slotId) {
    if (typeof slotId !== 'string' || !WEEKDAY_SLOT_IDS.includes(slotId)) fail('INVALID_WEEKDAY_DUNGEON_SLOT', 'slotId must be a known Gear slot');
    return slotId;
  }
  function hash32(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function dayKeyForDayIndex(dayIndex) {
    assertSafeInteger(dayIndex, 0, 'dayIndex');
    const date = new Date(dayIndex * DAY_MS);
    const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function getDayInfo(input) {
    assertExactKeys(input, ['nowMs'], 'day info input');
    const nowMs = assertSafeInteger(input.nowMs, 0, 'nowMs');
    const dayIndex = Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS);
    // The weekday of a JST civil day equals the UTC weekday of its day index.
    const weekday = new Date(dayIndex * DAY_MS).getUTCDay();
    const dayKey = dayKeyForDayIndex(dayIndex);
    const fixedSlotId = weekday === 0 ? null : DAY_SLOT_IDS[weekday];
    return Object.freeze({ dayKey, dayIndex, weekday, fixedSlotId, isSunday: weekday === 0, jstStartMs: dayIndex * DAY_MS - JST_OFFSET_MS });
  }
  function assertDayKey(dayKey, dayIndex) {
    if (typeof dayKey !== 'string' || dayKey !== dayKeyForDayIndex(dayIndex)) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'dayKey must match dayIndex');
    return dayKey;
  }
  function canonicalAim(input) {
    assertExactKeys(input, ['angle', 'power'], 'aim');
    const angle = assertSafeInteger(input.angle, AIM_LIMITS.angleMin, 'aim.angle');
    const power = assertSafeInteger(input.power, AIM_LIMITS.powerMin, 'aim.power');
    if (angle > AIM_LIMITS.angleMax || power > AIM_LIMITS.powerMax) fail('INVALID_WEEKDAY_DUNGEON_AIM', 'aim is outside the canonical range');
    return { angle, power };
  }
  function requiredSlotForDay(dayInfo, selectedSlotId) {
    if (!dayInfo.isSunday) {
      if (selectedSlotId !== dayInfo.fixedSlotId) fail('WEEKDAY_DUNGEON_SLOT_NOT_TODAY', 'this weekday has a fixed slot');
      return dayInfo.fixedSlotId;
    }
    return assertSlotId(selectedSlotId);
  }
  function createAttempt(input) {
    assertExactKeys(input, ['dayInfo', 'slotId', 'aim'], 'attempt input');
    const dayInfo = input.dayInfo;
    assertExactKeys(dayInfo, ['dayKey', 'dayIndex', 'weekday', 'fixedSlotId', 'isSunday', 'jstStartMs'], 'attempt input.dayInfo');
    const expectedInfo = getDayInfo({ nowMs: assertSafeInteger(dayInfo.jstStartMs, 0, 'dayInfo.jstStartMs') });
    if (JSON.stringify(dayInfo) !== JSON.stringify(expectedInfo)) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'dayInfo is not canonical');
    const slotId = requiredSlotForDay(expectedInfo, input.slotId);
    const aim = canonicalAim(input.aim);
    const identity = `weekday-dungeon:${expectedInfo.dayKey}:${slotId}`;
    return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_SCHEMA_VERSION, rulesVersion: WEEKDAY_DUNGEON_RULES_VERSION,
      attemptId: `${identity}:attempt`, rewardId: `${identity}:reward`, dayKey: expectedInfo.dayKey, dayIndex: expectedInfo.dayIndex,
      slotId, phase: 'fired', angle: aim.angle, power: aim.power, createdAtMs: expectedInfo.jstStartMs });
  }
  function validateAttempt(rawAttempt) {
    assertExactKeys(rawAttempt, ['schemaVersion', 'rulesVersion', 'attemptId', 'rewardId', 'dayKey', 'dayIndex', 'slotId', 'phase', 'angle', 'power', 'createdAtMs'], 'attempt');
    if (Number.isSafeInteger(rawAttempt.schemaVersion) && rawAttempt.schemaVersion > WEEKDAY_DUNGEON_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_VERSION', 'attempt is newer than this client');
    if (rawAttempt.schemaVersion !== WEEKDAY_DUNGEON_SCHEMA_VERSION || rawAttempt.rulesVersion !== WEEKDAY_DUNGEON_RULES_VERSION) fail('UNSUPPORTED_WEEKDAY_DUNGEON_VERSION', 'attempt version is unsupported');
    const dayIndex = assertSafeInteger(rawAttempt.dayIndex, 0, 'attempt.dayIndex');
    const dayKey = assertDayKey(rawAttempt.dayKey, dayIndex);
    const dayInfo = getDayInfo({ nowMs: dayIndex * DAY_MS - JST_OFFSET_MS });
    const slotId = requiredSlotForDay(dayInfo, rawAttempt.slotId);
    const aim = canonicalAim({ angle: rawAttempt.angle, power: rawAttempt.power });
    if (rawAttempt.phase !== 'fired' && rawAttempt.phase !== 'queued') fail('INVALID_WEEKDAY_DUNGEON_PHASE', 'attempt phase must be fired or queued');
    const identity = `weekday-dungeon:${dayKey}:${slotId}`;
    if (rawAttempt.attemptId !== `${identity}:attempt` || rawAttempt.rewardId !== `${identity}:reward`) fail('WEEKDAY_DUNGEON_ID_MISMATCH', 'attempt identity must match day and slot');
    const createdAtMs = assertSafeInteger(rawAttempt.createdAtMs, 0, 'attempt.createdAtMs');
    if (createdAtMs !== dayInfo.jstStartMs) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'attempt createdAtMs must equal JST day start');
    return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_SCHEMA_VERSION, rulesVersion: WEEKDAY_DUNGEON_RULES_VERSION, attemptId: rawAttempt.attemptId, rewardId: rawAttempt.rewardId, dayKey, dayIndex, slotId, phase: rawAttempt.phase, angle: aim.angle, power: aim.power, createdAtMs });
  }
  function targetForAttempt(attempt) {
    const checked = validateAttempt(attempt); const seed = hash32(`${checked.dayKey}:${checked.slotId}:target:v1`);
    return Object.freeze({ x: 266 + (seed % 210), y: 190 + (Math.floor(seed / 256) % 265), radius: HIT_RADIUS });
  }
  function simulateAttempt(rawAttempt) {
    const attempt = validateAttempt(rawAttempt); const target = targetForAttempt(attempt);
    const radians = attempt.angle * Math.PI / 180; const vx = attempt.power * 4 * Math.cos(radians); const vy = attempt.power * 4 * Math.sin(radians); const gravity = 210;
    const trajectory = []; let closest = { distance: Infinity, timeMs: 0, x: PLAYFIELD.originX, y: PLAYFIELD.originY };
    for (let timeMs = 0; timeMs <= 3200; timeMs += 40) {
      const seconds = timeMs / 1000; const x = PLAYFIELD.originX + vx * seconds; const y = PLAYFIELD.originY - vy * seconds + gravity * seconds * seconds / 2;
      const distance = Math.hypot(x - target.x, y - target.y);
      trajectory.push(Object.freeze({ timeMs, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
      if (distance < closest.distance) closest = { distance, timeMs, x, y };
      if (x > PLAYFIELD.width + 80 || y > PLAYFIELD.height + 80) break;
    }
    const hit = closest.distance <= target.radius;
    return Object.freeze({ attempt, target, trajectory: Object.freeze(trajectory), hit, resultTimeMs: closest.timeMs,
      impact: Object.freeze({ x: Math.round(closest.x * 100) / 100, y: Math.round(closest.y * 100) / 100, distance: Math.round(closest.distance * 100) / 100 }) });
  }
  const resolveAttempt = simulateAttempt;
  function resolveDomain(explicitDomain) {
    if (explicitDomain && typeof explicitDomain.createGear === 'function') return explicitDomain;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js');
    if (root && root.KatamonGearDomain) return root.KatamonGearDomain;
    fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be loaded before reward materialization');
  }
  function materializeReward(rawAttempt, explicitDomain) {
    const result = resolveAttempt(rawAttempt); const attempt = result.attempt;
    if (!result.hit) return Object.freeze({ rewardId: attempt.rewardId, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail: { attemptId: attempt.attemptId, dayKey: attempt.dayKey, slotId: attempt.slotId, hit: false }, createdAtMs: attempt.createdAtMs, gears: [], powder: 3, blueprintShards: 0 });
    const domain = resolveDomain(explicitDomain); const gearId = `weekday-dungeon:${attempt.dayKey}:${attempt.slotId}:gear:0`;
    let gear;
    try { gear = domain.createGear({ gearId, generationSeed: `${gearId}:generation:v1`, enhancementSeed: `${gearId}:enhancement:v1`, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail: { attemptId: attempt.attemptId, rewardId: attempt.rewardId, dayKey: attempt.dayKey, slotId: attempt.slotId, hit: true, gearIndex: 0 }, acquiredAt: attempt.createdAtMs, slotId: attempt.slotId, qualityProfile: WEEKDAY_DUNGEON_QUALITY_PROFILE, setProfile: domain.GEAR_SET_PROFILES.uniform }); }
    catch (error) { fail(error && error.code ? error.code : 'WEEKDAY_DUNGEON_GEAR_MATERIALIZATION_FAILED', 'could not materialize weekday dungeon Gear', error); }
    return Object.freeze({ rewardId: attempt.rewardId, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail: { attemptId: attempt.attemptId, dayKey: attempt.dayKey, slotId: attempt.slotId, hit: true }, createdAtMs: attempt.createdAtMs, gears: [gear], powder: 0, blueprintShards: 0 });
  }
  function getDayStatus(input) {
    assertExactKeys(input, ['dayInfo', 'state'], 'day status input');
    const dayInfo = input.dayInfo; const state = input.state;
    if (!state || !Number.isSafeInteger(state.maxConsumedDayIndex)) fail('INVALID_WEEKDAY_DUNGEON_STATE', 'state must be validated by weekday dungeon storage');
    return Object.freeze({ dayInfo, available: dayInfo.dayIndex > state.maxConsumedDayIndex && !(state.activeAttempt && state.activeAttempt.phase === 'fired'), activeAttempt: state.activeAttempt || null });
  }
  return Object.freeze({ GearWeekdayDungeonError, WEEKDAY_DUNGEON_SCHEMA_VERSION, WEEKDAY_DUNGEON_RULES_VERSION, WEEKDAY_DUNGEON_SOURCE_ID, JST_OFFSET_MS, DAY_MS, PLAYFIELD, AIM_LIMITS, HIT_RADIUS, WEEKDAY_SLOT_IDS, WEEKDAY_DUNGEON_QUALITY_PROFILE, getDayInfo, getDayStatus, createAttempt, validateAttempt, targetForAttempt, simulateAttempt, resolveAttempt, materializeReward });
});
