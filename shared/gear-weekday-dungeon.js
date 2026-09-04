(function initKatamonGearWeekdayDungeon(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearWeekdayDungeon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearWeekdayDungeon(root) {
  'use strict';

  const WEEKDAY_DUNGEON_SCHEMA_VERSION = 2;
  const WEEKDAY_DUNGEON_RULES_VERSION = 2;
  const LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION = 1;
  const LEGACY_WEEKDAY_DUNGEON_RULES_VERSION = 1;
  const WEEKDAY_DUNGEON_SOURCE_ID = 'weekday_dungeon';
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Named legacy exports: public v1 attempts must remain recoverable forever.
  const PLAYFIELD = Object.freeze({ width: 540, height: 720, originX: 96, originY: 636 });
  const AIM_LIMITS = Object.freeze({ angleMin: 10, angleMax: 80, powerMin: 28, powerMax: 120 });
  const HIT_RADIUS = 66;
  // Matches prepareDeterministicPreviewTerrain(): DEAD_LINE_Y - 126.
  const BATTLE_PLAYFIELD = Object.freeze({ width: 1440, height: 720, centerX: 720, groundY: 510, projectileStartAboveGround: 16, minX: -30, maxX: 1470 });
  const BATTLE_PHYSICS = Object.freeze({ fixedDt: 1 / 120, gravity: 650, velocityScale: 7.8, wind: 0 });
  // dragX/dragY are integer screen-space components. Values out of the
  // inclusive vector-length range are rejected rather than silently clamped.
  // The shared FIRE control reserves its inner 26px as the release-to-cancel
  // zone.  A durable attempt must therefore start at the first reachable
  // integer vector outside that zone, not at the guide-only 12px threshold.
  const SHOT_LIMITS = Object.freeze({ minDrag: 27, maxDrag: 130 });
  const WEEKDAY_SLOT_IDS = Object.freeze(['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  const DAY_SLOT_IDS = Object.freeze(['auxiliary', 'barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  const ZONE_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'left-far', side: 'left', range: 'far', distance: 640 }),
    Object.freeze({ id: 'left-mid', side: 'left', range: 'mid', distance: 420 }),
    Object.freeze({ id: 'left-near', side: 'left', range: 'near', distance: 200 }),
    Object.freeze({ id: 'right-near', side: 'right', range: 'near', distance: 200 }),
    Object.freeze({ id: 'right-mid', side: 'right', range: 'mid', distance: 420 }),
    Object.freeze({ id: 'right-far', side: 'right', range: 'far', distance: 640 }),
  ]);
  const ZONE_RADIUS = 85;
  const WEEKDAY_DUNGEON_QUALITY_PROFILE = Object.freeze({
    id: 'weekday-dungeon-v1',
    starWeights: Object.freeze([Object.freeze({ id: 1, weight: 35 }), Object.freeze({ id: 2, weight: 35 }), Object.freeze({ id: 3, weight: 20 }), Object.freeze({ id: 4, weight: 10 }), Object.freeze({ id: 5, weight: 0 }), Object.freeze({ id: 6, weight: 0 })]),
    rarityWeights: Object.freeze([Object.freeze({ id: 'normal', weight: 40 }), Object.freeze({ id: 'rare', weight: 34 }), Object.freeze({ id: 'epic', weight: 20 }), Object.freeze({ id: 'legend', weight: 5 }), Object.freeze({ id: 'mythic', weight: 1 })]),
  });

  class GearWeekdayDungeonError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearWeekdayDungeonError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearWeekdayDungeonError(code, message, cause); };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function assertDataRecord(value, path) {
    if (!isPlainRecord(value)) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path}.${key} must be an enumerable data property`);
    }
  }
  function assertExactKeys(value, keys, path) {
    assertDataRecord(value, path);
    const actual = Object.keys(value).sort(); const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail('UNKNOWN_WEEKDAY_DUNGEON_FIELD', `${path} has unknown or missing fields`);
  }
  function assertSafeInteger(value, min, path) { if (!Number.isSafeInteger(value) || value < min) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must be a safe integer >= ${min}`); return value; }
  function assertSignedSafeInteger(value, path) { if (!Number.isSafeInteger(value)) fail('INVALID_WEEKDAY_DUNGEON_INPUT', `${path} must be a safe integer`); return value; }
  function assertSlotId(slotId) { if (typeof slotId !== 'string' || !WEEKDAY_SLOT_IDS.includes(slotId)) fail('INVALID_WEEKDAY_DUNGEON_SLOT', 'slotId must be a known Gear slot'); return slotId; }
  function hash32(text) { let value = 2166136261; for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); } return value >>> 0; }
  function round2(value) { const rounded = Math.round(value * 100) / 100; return rounded === 0 ? 0 : rounded; }
  function dayKeyForDayIndex(dayIndex) { assertSafeInteger(dayIndex, 0, 'dayIndex'); const date = new Date(dayIndex * DAY_MS); return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; }
  function getDayInfo(input) {
    assertExactKeys(input, ['nowMs'], 'day info input'); const nowMs = assertSafeInteger(input.nowMs, 0, 'nowMs'); const dayIndex = Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS); const weekday = new Date(dayIndex * DAY_MS).getUTCDay(); const dayKey = dayKeyForDayIndex(dayIndex); const fixedSlotId = weekday === 0 ? null : DAY_SLOT_IDS[weekday];
    // Deliberately kept at this old six-key shape for day/storage compatibility.
    return Object.freeze({ dayKey, dayIndex, weekday, fixedSlotId, isSunday: weekday === 0, jstStartMs: dayIndex * DAY_MS - JST_OFFSET_MS });
  }
  function canonicalDayInfo(raw, path) {
    assertExactKeys(raw, ['dayKey', 'dayIndex', 'weekday', 'fixedSlotId', 'isSunday', 'jstStartMs'], path || 'dayInfo');
    const expected = getDayInfo({ nowMs: assertSafeInteger(raw.jstStartMs, 0, 'dayInfo.jstStartMs') });
    if (['dayKey', 'dayIndex', 'weekday', 'fixedSlotId', 'isSunday', 'jstStartMs'].some((key) => raw[key] !== expected[key])) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'dayInfo is not canonical');
    return expected;
  }
  function assertDayKey(dayKey, dayIndex) { if (typeof dayKey !== 'string' || dayKey !== dayKeyForDayIndex(dayIndex)) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'dayKey must match dayIndex'); return dayKey; }
  function canonicalAim(input) { assertExactKeys(input, ['angle', 'power'], 'aim'); const angle = assertSafeInteger(input.angle, AIM_LIMITS.angleMin, 'aim.angle'); const power = assertSafeInteger(input.power, AIM_LIMITS.powerMin, 'aim.power'); if (angle > AIM_LIMITS.angleMax || power > AIM_LIMITS.powerMax) fail('INVALID_WEEKDAY_DUNGEON_AIM', 'aim is outside the canonical range'); return Object.freeze({ angle, power }); }
  function requiredLegacySlotForDay(dayInfo, selectedSlotId) { if (!dayInfo.isSunday) { if (selectedSlotId !== dayInfo.fixedSlotId) fail('WEEKDAY_DUNGEON_SLOT_NOT_TODAY', 'this weekday has a fixed slot'); return dayInfo.fixedSlotId; } return assertSlotId(selectedSlotId); }

  function canonicalShot(input) {
    assertExactKeys(input, ['dragX', 'dragY'], 'shot'); const dragX = assertSignedSafeInteger(input.dragX, 'shot.dragX'); const dragY = assertSignedSafeInteger(input.dragY, 'shot.dragY'); const magnitude = Math.hypot(dragX, dragY);
    if (magnitude < SHOT_LIMITS.minDrag || magnitude > SHOT_LIMITS.maxDrag) fail('INVALID_WEEKDAY_DUNGEON_SHOT', 'shot drag magnitude must be within the canonical range');
    return Object.freeze({ dragX, dragY });
  }
  function getZoneLayout(rawDayInfo) {
    const dayInfo = canonicalDayInfo(rawDayInfo, 'zone layout dayInfo'); const rotation = dayInfo.dayIndex % WEEKDAY_SLOT_IDS.length;
    return Object.freeze(ZONE_DEFINITIONS.map((definition, index) => {
      const slotId = WEEKDAY_SLOT_IDS[(index - rotation + WEEKDAY_SLOT_IDS.length) % WEEKDAY_SLOT_IDS.length]; const x = BATTLE_PLAYFIELD.centerX + (definition.side === 'left' ? -definition.distance : definition.distance);
      return Object.freeze({ id: definition.id, zoneId: definition.id, side: definition.side, range: definition.range, slotId, x, y: BATTLE_PLAYFIELD.groundY, radius: ZONE_RADIUS });
    }));
  }
  function simulateBattleShot(rawShot) {
    const shot = canonicalShot(rawShot); const dt = BATTLE_PHYSICS.fixedDt; let x = BATTLE_PLAYFIELD.centerX; let y = BATTLE_PLAYFIELD.groundY - BATTLE_PLAYFIELD.projectileStartAboveGround; const vx = -shot.dragX * BATTLE_PHYSICS.velocityScale; const initialVy = -shot.dragY * BATTLE_PHYSICS.velocityScale; let vy = initialVy;
    const trajectory = [Object.freeze({ tick: 0, timeMs: 0, x: round2(x), y: round2(y) })];
    for (let tick = 1; tick <= 2400; tick += 1) {
      const beforeX = x; const beforeY = y; vy += BATTLE_PHYSICS.gravity * dt; x += vx * dt; y += vy * dt; const timeMs = round2(tick * dt * 1000);
      if (x < BATTLE_PLAYFIELD.minX || x > BATTLE_PLAYFIELD.maxX) { const impact = Object.freeze({ x: round2(x), y: round2(y), timeMs, termination: 'bounds' }); trajectory.push(Object.freeze({ tick, timeMs, x: impact.x, y: impact.y })); return Object.freeze({ shot, velocity: Object.freeze({ vx: round2(vx), vy: round2(initialVy) }), trajectory: Object.freeze(trajectory), impact }); }
      if (y >= BATTLE_PLAYFIELD.groundY) { const fraction = (BATTLE_PLAYFIELD.groundY - beforeY) / (y - beforeY); const impact = Object.freeze({ x: round2(beforeX + (x - beforeX) * fraction), y: BATTLE_PLAYFIELD.groundY, timeMs: round2(((tick - 1) + fraction) * dt * 1000), termination: 'ground' }); trajectory.push(Object.freeze({ tick, timeMs: impact.timeMs, x: impact.x, y: impact.y })); return Object.freeze({ shot, velocity: Object.freeze({ vx: round2(vx), vy: round2(initialVy) }), trajectory: Object.freeze(trajectory), impact }); }
      trajectory.push(Object.freeze({ tick, timeMs, x: round2(x), y: round2(y) }));
    }
    fail('WEEKDAY_DUNGEON_SIMULATION_LIMIT', 'battle shot did not terminate');
  }
  function deriveV2(dayInfo, shot) {
    const layout = getZoneLayout(dayInfo); const simulation = simulateBattleShot(shot); const zone = simulation.impact.termination === 'ground' ? layout.find((candidate) => Math.hypot(simulation.impact.x - candidate.x, simulation.impact.y - candidate.y) <= candidate.radius) || null : null;
    return Object.freeze({ layout, shot: simulation.shot, velocity: simulation.velocity, trajectory: simulation.trajectory, impact: simulation.impact, zone, zoneId: zone ? zone.id : null, slotId: zone ? zone.slotId : null, hit: zone !== null });
  }
  function createAttempt(input) {
    assertExactKeys(input, ['dayInfo', 'shot'], 'attempt input'); const dayInfo = canonicalDayInfo(input.dayInfo, 'attempt input.dayInfo'); const derived = deriveV2(dayInfo, canonicalShot(input.shot)); const identity = `weekday-dungeon:${dayInfo.dayKey}`;
    return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_SCHEMA_VERSION, rulesVersion: WEEKDAY_DUNGEON_RULES_VERSION, attemptId: `${identity}:attempt`, rewardId: `${identity}:reward`, dayKey: dayInfo.dayKey, dayIndex: dayInfo.dayIndex, phase: 'fired', shot: derived.shot, impact: derived.impact, zoneId: derived.zoneId, slotId: derived.slotId, createdAtMs: dayInfo.jstStartMs });
  }

  function legacyValidateAttempt(rawAttempt) {
    assertExactKeys(rawAttempt, ['schemaVersion', 'rulesVersion', 'attemptId', 'rewardId', 'dayKey', 'dayIndex', 'slotId', 'phase', 'angle', 'power', 'createdAtMs'], 'attempt');
    if (rawAttempt.schemaVersion !== LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION || rawAttempt.rulesVersion !== LEGACY_WEEKDAY_DUNGEON_RULES_VERSION) fail('UNSUPPORTED_WEEKDAY_DUNGEON_VERSION', 'attempt version is unsupported');
    const dayIndex = assertSafeInteger(rawAttempt.dayIndex, 0, 'attempt.dayIndex'); const dayKey = assertDayKey(rawAttempt.dayKey, dayIndex); const dayInfo = getDayInfo({ nowMs: dayIndex * DAY_MS - JST_OFFSET_MS }); const slotId = requiredLegacySlotForDay(dayInfo, rawAttempt.slotId); const aim = canonicalAim({ angle: rawAttempt.angle, power: rawAttempt.power });
    if (rawAttempt.phase !== 'fired' && rawAttempt.phase !== 'queued') fail('INVALID_WEEKDAY_DUNGEON_PHASE', 'attempt phase must be fired or queued'); const identity = `weekday-dungeon:${dayKey}:${slotId}`;
    if (rawAttempt.attemptId !== `${identity}:attempt` || rawAttempt.rewardId !== `${identity}:reward`) fail('WEEKDAY_DUNGEON_ID_MISMATCH', 'attempt identity must match day and slot'); const createdAtMs = assertSafeInteger(rawAttempt.createdAtMs, 0, 'attempt.createdAtMs'); if (createdAtMs !== dayInfo.jstStartMs) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'attempt createdAtMs must equal JST day start');
    return Object.freeze({ schemaVersion: LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION, rulesVersion: LEGACY_WEEKDAY_DUNGEON_RULES_VERSION, attemptId: rawAttempt.attemptId, rewardId: rawAttempt.rewardId, dayKey, dayIndex, slotId, phase: rawAttempt.phase, angle: aim.angle, power: aim.power, createdAtMs });
  }
  function validateV2Attempt(rawAttempt) {
    assertExactKeys(rawAttempt, ['schemaVersion', 'rulesVersion', 'attemptId', 'rewardId', 'dayKey', 'dayIndex', 'phase', 'shot', 'impact', 'zoneId', 'slotId', 'createdAtMs'], 'attempt');
    if (rawAttempt.schemaVersion !== WEEKDAY_DUNGEON_SCHEMA_VERSION || rawAttempt.rulesVersion !== WEEKDAY_DUNGEON_RULES_VERSION) fail('UNSUPPORTED_WEEKDAY_DUNGEON_VERSION', 'attempt version is unsupported'); const dayIndex = assertSafeInteger(rawAttempt.dayIndex, 0, 'attempt.dayIndex'); const dayKey = assertDayKey(rawAttempt.dayKey, dayIndex); const dayInfo = getDayInfo({ nowMs: dayIndex * DAY_MS - JST_OFFSET_MS }); const shot = canonicalShot(rawAttempt.shot);
    if (rawAttempt.phase !== 'fired' && rawAttempt.phase !== 'queued') fail('INVALID_WEEKDAY_DUNGEON_PHASE', 'attempt phase must be fired or queued'); const identity = `weekday-dungeon:${dayKey}`; if (rawAttempt.attemptId !== `${identity}:attempt` || rawAttempt.rewardId !== `${identity}:reward`) fail('WEEKDAY_DUNGEON_ID_MISMATCH', 'attempt identity must match the day'); const createdAtMs = assertSafeInteger(rawAttempt.createdAtMs, 0, 'attempt.createdAtMs'); if (createdAtMs !== dayInfo.jstStartMs) fail('WEEKDAY_DUNGEON_DAY_MISMATCH', 'attempt createdAtMs must equal JST day start');
    const derived = deriveV2(dayInfo, shot); assertExactKeys(rawAttempt.impact, ['x', 'y', 'timeMs', 'termination'], 'attempt.impact');
    if (rawAttempt.impact.x !== derived.impact.x || rawAttempt.impact.y !== derived.impact.y || rawAttempt.impact.timeMs !== derived.impact.timeMs || rawAttempt.impact.termination !== derived.impact.termination || rawAttempt.zoneId !== derived.zoneId || rawAttempt.slotId !== derived.slotId) fail('WEEKDAY_DUNGEON_DERIVATION_MISMATCH', 'attempt impact or lane result does not match the canonical shot');
    return Object.freeze({ schemaVersion: WEEKDAY_DUNGEON_SCHEMA_VERSION, rulesVersion: WEEKDAY_DUNGEON_RULES_VERSION, attemptId: rawAttempt.attemptId, rewardId: rawAttempt.rewardId, dayKey, dayIndex, phase: rawAttempt.phase, shot: derived.shot, impact: derived.impact, zoneId: derived.zoneId, slotId: derived.slotId, createdAtMs });
  }
  function validateAttempt(rawAttempt) { assertDataRecord(rawAttempt, 'attempt'); if (Number.isSafeInteger(rawAttempt.schemaVersion) && rawAttempt.schemaVersion > WEEKDAY_DUNGEON_SCHEMA_VERSION) fail('UNSUPPORTED_FUTURE_WEEKDAY_DUNGEON_VERSION', 'attempt is newer than this client'); if (rawAttempt.schemaVersion === LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION) return legacyValidateAttempt(rawAttempt); if (rawAttempt.schemaVersion === WEEKDAY_DUNGEON_SCHEMA_VERSION) return validateV2Attempt(rawAttempt); fail('UNSUPPORTED_WEEKDAY_DUNGEON_VERSION', 'attempt version is unsupported'); }
  function legacyTargetForAttempt(attempt) { const checked = legacyValidateAttempt(attempt); const seed = hash32(`${checked.dayKey}:${checked.slotId}:target:v1`); return Object.freeze({ x: 266 + (seed % 210), y: 190 + (Math.floor(seed / 256) % 265), radius: HIT_RADIUS }); }
  const targetForAttempt = legacyTargetForAttempt;
  function legacyResolveAttempt(rawAttempt) {
    const attempt = legacyValidateAttempt(rawAttempt); const target = legacyTargetForAttempt(attempt); const radians = attempt.angle * Math.PI / 180; const vx = attempt.power * 4 * Math.cos(radians); const vy = attempt.power * 4 * Math.sin(radians); const gravity = 210; const trajectory = []; let closest = { distance: Infinity, timeMs: 0, x: PLAYFIELD.originX, y: PLAYFIELD.originY };
    for (let timeMs = 0; timeMs <= 3200; timeMs += 40) { const seconds = timeMs / 1000; const x = PLAYFIELD.originX + vx * seconds; const y = PLAYFIELD.originY - vy * seconds + gravity * seconds * seconds / 2; const distance = Math.hypot(x - target.x, y - target.y); trajectory.push(Object.freeze({ timeMs, x: round2(x), y: round2(y) })); if (distance < closest.distance) closest = { distance, timeMs, x, y }; if (x > PLAYFIELD.width + 80 || y > PLAYFIELD.height + 80) break; }
    return Object.freeze({ attempt, target, trajectory: Object.freeze(trajectory), hit: closest.distance <= target.radius, resultTimeMs: closest.timeMs, impact: Object.freeze({ x: round2(closest.x), y: round2(closest.y), distance: round2(closest.distance) }) });
  }
  function resolveV2Attempt(rawAttempt) { const attempt = validateV2Attempt(rawAttempt); const derived = deriveV2(getDayInfo({ nowMs: attempt.createdAtMs }), attempt.shot); return Object.freeze({ attempt, hit: derived.hit, zone: derived.zone, slot: derived.slotId, zoneId: derived.zoneId, slotId: derived.slotId, impact: derived.impact, layout: derived.layout, trajectory: derived.trajectory, velocity: derived.velocity }); }
  function resolveAttempt(rawAttempt) { const attempt = validateAttempt(rawAttempt); return attempt.schemaVersion === LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION ? legacyResolveAttempt(attempt) : resolveV2Attempt(attempt); }
  const simulateAttempt = resolveAttempt;
  function resolveDomain(explicitDomain) { if (explicitDomain && typeof explicitDomain.createGear === 'function') return explicitDomain; if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js'); if (root && root.KatamonGearDomain) return root.KatamonGearDomain; fail('GEAR_DOMAIN_UNAVAILABLE', 'KatamonGearDomain must be loaded before reward materialization'); }
  function materializeReward(rawAttempt, explicitDomain) {
    const result = resolveAttempt(rawAttempt); const attempt = result.attempt;
    // v1 recorded its selected fixed weekday slot even on a miss.  Keep that
    // public reward shape untouched; v2 has no selected slot until a lane hits.
    const slotId = attempt.schemaVersion === LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION ? attempt.slotId : result.slotId;
    // Reward storage also serializes ordinary data records, so it owns the
    // mutable-clone boundary for these reward payload values.
    const sourceDetail = { attemptId: attempt.attemptId, dayKey: attempt.dayKey, slotId, hit: result.hit };
    // Gear reward storage intentionally requires ordinary (writable-length)
    // arrays, so these two arrays cannot be frozen at this boundary.
    if (!result.hit) return Object.freeze({ rewardId: attempt.rewardId, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail, createdAtMs: attempt.createdAtMs, gears: [], powder: 3, blueprintShards: 0 });
    const domain = resolveDomain(explicitDomain); const gearId = `weekday-dungeon:${attempt.dayKey}:${slotId}:gear:0`; let gear;
    try { gear = domain.createGear({ gearId, generationSeed: `${gearId}:generation:v1`, enhancementSeed: `${gearId}:enhancement:v1`, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail: { ...sourceDetail, rewardId: attempt.rewardId, gearIndex: 0 }, acquiredAt: attempt.createdAtMs, slotId, qualityProfile: WEEKDAY_DUNGEON_QUALITY_PROFILE, setProfile: domain.GEAR_SET_PROFILES.uniform }); } catch (error) { fail(error && error.code ? error.code : 'WEEKDAY_DUNGEON_GEAR_MATERIALIZATION_FAILED', 'could not materialize weekday dungeon Gear', error); }
    return Object.freeze({ rewardId: attempt.rewardId, sourceId: WEEKDAY_DUNGEON_SOURCE_ID, sourceDetail, createdAtMs: attempt.createdAtMs, gears: [gear], powder: 0, blueprintShards: 0 });
  }
  function getDayStatus(input) { assertExactKeys(input, ['dayInfo', 'state'], 'day status input'); const dayInfo = input.dayInfo; const state = input.state; if (!state || !Number.isSafeInteger(state.maxConsumedDayIndex)) fail('INVALID_WEEKDAY_DUNGEON_STATE', 'state must be validated by weekday dungeon storage'); return Object.freeze({ dayInfo, available: dayInfo.dayIndex > state.maxConsumedDayIndex && !(state.activeAttempt && state.activeAttempt.phase === 'fired'), activeAttempt: state.activeAttempt || null }); }
  return Object.freeze({ GearWeekdayDungeonError, WEEKDAY_DUNGEON_SCHEMA_VERSION, WEEKDAY_DUNGEON_RULES_VERSION, LEGACY_WEEKDAY_DUNGEON_SCHEMA_VERSION, LEGACY_WEEKDAY_DUNGEON_RULES_VERSION, WEEKDAY_DUNGEON_SOURCE_ID, JST_OFFSET_MS, DAY_MS, PLAYFIELD, AIM_LIMITS, HIT_RADIUS, BATTLE_PLAYFIELD, BATTLE_PHYSICS, SHOT_LIMITS, ZONE_DEFINITIONS, ZONE_RADIUS, WEEKDAY_SLOT_IDS, WEEKDAY_DUNGEON_QUALITY_PROFILE, getDayInfo, getDayStatus, canonicalShot, getZoneLayout, simulateBattleShot, createAttempt, validateAttempt, legacyValidateAttempt, targetForAttempt, legacyTargetForAttempt, simulateAttempt, legacyResolveAttempt, resolveAttempt, materializeReward });
});
