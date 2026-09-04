'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const items = require('../shared/stage-battle-items.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const identity = (overrides = {}) => ({
  runId: 'cpu-run:11111111-1111-4111-8111-111111111111',
  matchOrdinal: 3,
  spawnOrdinal: 2,
  ...overrides
});
const counts = (overrides = {}) => ({ healing: 0, special_charge: 0, gear_resource: 0, ...overrides });
const eligibleFlags = (overrides = {}) => ({
  offline: true,
  normalCpu: true,
  oneVsOne: true,
  officialStage: true,
  boss: false,
  online: false,
  twoVsTwo: false,
  free: false,
  tutorial: false,
  demo: false,
  custom: false,
  ...overrides
});

test('v1 schema, immutable kinds, weights, caps, timing, geometry, and resource rules are fixed', () => {
  assert.equal(items.SPAWN_STATE_SCHEMA_VERSION, 1);
  assert.deepEqual(items.ITEM_KINDS, ['healing', 'special_charge', 'gear_resource']);
  assert.deepEqual(items.ITEM_WEIGHTS, { healing: 45, special_charge: 30, gear_resource: 25 });
  assert.deepEqual(items.MATCH_CAPS, { healing: 2, special_charge: 1, gear_resource: 1 });
  assert.deepEqual(items.SPAWN_RULES, {
    initialTurn: 2, lifetimeTurns: 6, cooldownTurns: 4, maxActive: 1, maxPerMatch: 3,
    cutoffTurn: 20, pickupRadius: 32, edgeMargin: 80,
    unitClearance: 120, fairnessTolerance: 96
  });
  assert.deepEqual(items.RESOURCE_RULES, { powderPerBox: 3, shardChanceBasisPoints: 500, maxBoxesPerRun: 10, maxShardsPerRun: 1 });
  for (const value of [items.ITEM_KINDS, items.ITEM_WEIGHTS, items.MATCH_CAPS, items.SPAWN_RULES, items.RESOURCE_RULES]) assert.equal(Object.isFrozen(value), true);
});

test('CommonJS and browser UMD expose the same pure API without DOM or storage', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'stage-battle-items.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'stage-battle-items.js' });
  assert.equal(typeof sandbox.globalThis.KatamonStageBattleItems.selectItemKind, 'function');
  assert.equal(sandbox.globalThis.KatamonStageBattleItems.SPAWN_STATE_SCHEMA_VERSION, items.SPAWN_STATE_SCHEMA_VERSION);
  assert.doesNotMatch(source, /\b(?:document|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(source, /Math\.random/);
});

test('labeled rolls and item ids are repeatable, bounded, label-separated, and keyed by all ordinals', () => {
  const input = { ...identity(), label: 'kind' };
  const a = items.rollBasisPoints(input);
  assert.equal(a, items.rollBasisPoints(input));
  assert(a >= 0 && a < 10000);
  assert.notEqual(a, items.rollBasisPoints({ ...input, label: 'position' }));
  assert.notEqual(a, items.rollBasisPoints({ ...input, runId: 'cpu-run:other' }));
  assert.notEqual(a, items.rollBasisPoints({ ...input, matchOrdinal: 4 }));
  assert.notEqual(a, items.rollBasisPoints({ ...input, spawnOrdinal: 3 }));
  assert.equal(items.createItemId({ ...identity(), kind: 'healing' }), items.createItemId({ ...identity(), kind: 'healing' }));
  assert.notEqual(items.createItemId({ ...identity(), kind: 'healing' }), items.createItemId({ ...identity(), kind: 'special_charge' }));
});

test('all operations leave global Math.random untouched and never call it', () => {
  const original = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('Math.random must not be called'); };
  try {
    items.rollBasisPoints({ ...identity(), label: 'kind' });
    items.selectItemKind({ ...identity(), currentStreak: 2, spawnedCounts: counts() });
    items.chooseSpawnPoint({ ...identity(), stageWidth: 1000, candidates: [{ x: 500, y: 300 }], unitPositions: [{ x: 200, y: 300 }, { x: 800, y: 300 }] });
    items.applyPickupEffect({ ...identity(), kind: 'gear_resource', collectorType: 'player', unit: { hp: 50, maxHp: 100, specialCharge: 0 }, resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } });
    assert.equal(calls, 0);
    assert.equal(Math.random, Math.random);
  } finally { Math.random = original; }
  assert.equal(Math.random, original);
});

test('only offline normal CPU 1v1 on an official non-boss stage is eligible', () => {
  assert.equal(items.isEligibleBattleMode(eligibleFlags()), true);
  for (const [key, value] of [['offline', false], ['normalCpu', false], ['oneVsOne', false], ['officialStage', false], ['boss', true], ['online', true], ['twoVsTwo', true], ['free', true], ['tutorial', true], ['demo', true], ['custom', true]]) {
    assert.equal(items.isEligibleBattleMode(eligibleFlags({ [key]: value })), false, key);
  }
  assert.throws(() => items.isEligibleBattleMode({ ...eligibleFlags(), future: true }), /INVALID_BATTLE_ITEM_MODE_FLAGS/);
});

test('kind selection follows 45/30/25 boundaries when every kind is eligible', () => {
  assert.equal(items.selectItemKindForRoll(0, 2, counts()), 'healing');
  assert.equal(items.selectItemKindForRoll(4499, 2, counts()), 'healing');
  assert.equal(items.selectItemKindForRoll(4500, 2, counts()), 'special_charge');
  assert.equal(items.selectItemKindForRoll(7499, 2, counts()), 'special_charge');
  assert.equal(items.selectItemKindForRoll(7500, 2, counts()), 'gear_resource');
  assert.equal(items.selectItemKindForRoll(9999, 2, counts()), 'gear_resource');
});

test('resource is unavailable below streak 2 and per-match caps remove exhausted kinds', () => {
  for (const roll of [0, 4499, 4500, 7499, 7500, 9999]) assert.notEqual(items.selectItemKindForRoll(roll, 1, counts()), 'gear_resource');
  assert.equal(items.selectItemKindForRoll(0, 2, counts({ healing: 2 })), 'special_charge');
  assert.equal(items.selectItemKindForRoll(9999, 2, counts({ healing: 2, special_charge: 1 })), 'gear_resource');
  assert.equal(items.selectItemKindForRoll(5000, 2, counts({ healing: 2, special_charge: 1, gear_resource: 1 })), null);
  assert.throws(() => items.selectItemKindForRoll(10000, 2, counts()), /INVALID_BATTLE_ITEM_ROLL/);
});

test('spawn timing starts at turn 2, applies lifetime/cooldown/max-active, and cuts off after turn 20', () => {
  assert.equal(items.canAttemptSpawn({ turn: 1, activeCount: 0, spawnedCount: 0, lastResolvedTurn: null }), false);
  assert.equal(items.canAttemptSpawn({ turn: 2, activeCount: 0, spawnedCount: 0, lastResolvedTurn: null }), true);
  assert.equal(items.canAttemptSpawn({ turn: 5, activeCount: 0, spawnedCount: 1, lastResolvedTurn: 2 }), false);
  assert.equal(items.canAttemptSpawn({ turn: 6, activeCount: 0, spawnedCount: 1, lastResolvedTurn: 2 }), true);
  assert.equal(items.canAttemptSpawn({ turn: 19, activeCount: 0, spawnedCount: 2, lastResolvedTurn: 15 }), true);
  assert.equal(items.canAttemptSpawn({ turn: 20, activeCount: 0, spawnedCount: 2, lastResolvedTurn: 16 }), false);
  assert.equal(items.canAttemptSpawn({ turn: 6, activeCount: 1, spawnedCount: 1, lastResolvedTurn: 2 }), false);
  assert.equal(items.canAttemptSpawn({ turn: 10, activeCount: 0, spawnedCount: 3, lastResolvedTurn: 6 }), false);
});

test('fair point selection filters edges, both-unit clearance, and distance imbalance before deterministic choice', () => {
  const input = {
    ...identity(), stageWidth: 1000,
    candidates: [
      { x: 79, y: 300 },
      { x: 205, y: 300 },
      { x: 452, y: 300 },
      { x: 500, y: 300 },
      { x: 548, y: 300 },
      { x: 921, y: 300 }
    ],
    unitPositions: [{ x: 200, y: 300 }, { x: 800, y: 300 }]
  };
  const eligible = items.eligibleSpawnPoints(input);
  assert.deepEqual(eligible, [{ x: 452, y: 300 }, { x: 500, y: 300 }, { x: 548, y: 300 }]);
  const chosen = items.chooseSpawnPoint(input);
  assert(eligible.some((point) => point.x === chosen.x && point.y === chosen.y));
  assert.deepEqual(chosen, items.chooseSpawnPoint(input));
  assert.equal(items.chooseSpawnPoint({ ...input, candidates: [{ x: 10, y: 0 }] }), null);
});

test('segment-circle sweep catches high-speed crossings, tangency, starts-inside, and misses', () => {
  assert.equal(items.segmentCircleSweep({ from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, center: { x: 500, y: 0 }, radius: 32 }).hit, true);
  assert.equal(items.segmentCircleSweep({ from: { x: 0, y: 32 }, to: { x: 1000, y: 32 }, center: { x: 500, y: 0 }, radius: 32 }).hit, true);
  assert.equal(items.segmentCircleSweep({ from: { x: 500, y: 0 }, to: { x: 1000, y: 0 }, center: { x: 500, y: 0 }, radius: 32 }).time, 0);
  assert.deepEqual(items.segmentCircleSweep({ from: { x: 0, y: 33 }, to: { x: 1000, y: 33 }, center: { x: 500, y: 0 }, radius: 32 }), { hit: false, time: null, point: null });
});

test('spawn state validates, freezes, and round-trips with computed id and six-turn expiry', () => {
  const state = items.createSpawnState({ ...identity(), kind: 'healing', x: 500, y: 300, spawnTurn: 2 });
  assert.deepEqual(state, {
    schemaVersion: 1,
    itemId: items.createItemId({ ...identity(), kind: 'healing' }),
    runId: identity().runId,
    matchOrdinal: 3,
    spawnOrdinal: 2,
    kind: 'healing',
    x: 500,
    y: 300,
    spawnTurn: 2,
    expiresTurn: 8
  });
  assert.equal(Object.isFrozen(state), true);
  assert.deepEqual(items.parseSpawnState(items.serializeSpawnState(state)), state);
});

test('spawn state fails closed on unknown/missing keys, unsafe integers, forged ids, prototypes, accessors, and future versions', () => {
  const valid = items.createSpawnState({ ...identity(), kind: 'healing', x: 500, y: 300, spawnTurn: 2 });
  for (const raw of [{ ...valid, future: 1 }, (({ itemId, ...rest }) => rest)(valid), { ...valid, x: 1.5 }, { ...valid, spawnOrdinal: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, expiresTurn: 9 }, { ...valid, itemId: 'battle-item:forged' }]) {
    assert.throws(() => items.validateSpawnState(raw), /INVALID_BATTLE_ITEM_SPAWN_STATE/);
  }
  assert.throws(() => items.validateSpawnState({ ...valid, schemaVersion: 2 }), /UNSUPPORTED_FUTURE_BATTLE_ITEM_SPAWN_STATE_VERSION/);
  const polluted = Object.create({ inherited: true }); Object.assign(polluted, valid);
  assert.throws(() => items.validateSpawnState(polluted), /INVALID_BATTLE_ITEM_SPAWN_STATE/);
  const hidden = { ...valid }; Object.defineProperty(hidden, 'future', { value: true, enumerable: false });
  assert.throws(() => items.validateSpawnState(hidden), /INVALID_BATTLE_ITEM_SPAWN_STATE/);
  const accessor = { ...valid }; Object.defineProperty(accessor, 'x', { enumerable: true, get() { throw new Error('accessor executed'); } });
  assert.throws(() => items.validateSpawnState(accessor), /INVALID_BATTLE_ITEM_SPAWN_STATE/);
  assert.throws(() => items.parseSpawnState('{"__proto__":{},"schemaVersion":1}'), /INVALID_BATTLE_ITEM_SPAWN_STATE/);
});

test('healing restores ceil(maxHp*20%), caps at max, and never consumes on KO or full health', () => {
  const base = { ...identity(), kind: 'healing', collectorType: 'player', resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } };
  let result = items.applyPickupEffect({ ...base, unit: { hp: 1, maxHp: 101, specialCharge: 0 } });
  assert.equal(result.consumed, true); assert.equal(result.healed, 21); assert.equal(result.unit.hp, 22);
  result = items.applyPickupEffect({ ...base, unit: { hp: 95, maxHp: 101, specialCharge: 0 } });
  assert.equal(result.healed, 6); assert.equal(result.unit.hp, 101);
  result = items.applyPickupEffect({ ...base, unit: { hp: 0, maxHp: 101, specialCharge: 0 } });
  assert.equal(result.consumed, false); assert.equal(result.reason, 'knocked-out');
  result = items.applyPickupEffect({ ...base, unit: { hp: 101, maxHp: 101, specialCharge: 0 } });
  assert.equal(result.consumed, false); assert.equal(result.reason, 'full-health');
});

test('special charge adds one up to four and does not consume while full', () => {
  const base = { ...identity(), kind: 'special_charge', collectorType: 'player', resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } };
  let result = items.applyPickupEffect({ ...base, unit: { hp: 50, maxHp: 100, specialCharge: 3 } });
  assert.equal(result.consumed, true); assert.equal(result.unit.specialCharge, 4); assert.equal(result.chargeAdded, 1);
  result = items.applyPickupEffect({ ...base, unit: { hp: 50, maxHp: 100, specialCharge: 4 } });
  assert.equal(result.consumed, false); assert.equal(result.reason, 'full-charge');
});

test('resource pickup grants powder 3, uses an independent deterministic 5% shard roll, and enforces run caps', () => {
  const base = { ...identity(), kind: 'gear_resource', collectorType: 'player', unit: { hp: 50, maxHp: 100, specialCharge: 0 } };
  const first = items.applyPickupEffect({ ...base, resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } });
  const again = items.applyPickupEffect({ ...base, resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } });
  assert.deepEqual(first, again);
  assert.equal(first.consumed, true); assert.equal(first.powderGranted, 3); assert.equal(first.resources.boxesCollected, 1); assert.equal(first.resources.powder, 3);
  assert.equal(first.shardGranted, items.rollBasisPoints({ ...identity(), label: items.RESOURCE_SHARD_RNG_LABEL }) < 500 ? 1 : 0);
  const luckyIdentity = { runId: 'shard-fixture', matchOrdinal: 0, spawnOrdinal: 6 };
  assert.equal(items.rollBasisPoints({ ...luckyIdentity, label: items.RESOURCE_SHARD_RNG_LABEL }), 141);
  const lucky = items.applyPickupEffect({ ...base, ...luckyIdentity, resources: { boxesCollected: 0, powder: 0, blueprintShards: 0 } });
  assert.equal(lucky.shardGranted, 1); assert.equal(lucky.resources.blueprintShards, 1);
  const capped = items.applyPickupEffect({ ...base, resources: { boxesCollected: 10, powder: 30, blueprintShards: 1 } });
  assert.equal(capped.consumed, true); assert.equal(capped.powderGranted, 0); assert.equal(capped.shardGranted, 0); assert.deepEqual(capped.resources, { boxesCollected: 10, powder: 30, blueprintShards: 1 });
  const shardCapped = items.applyPickupEffect({ ...base, resources: { boxesCollected: 9, powder: 27, blueprintShards: 1 } });
  assert.equal(shardCapped.powderGranted, 3); assert.equal(shardCapped.shardGranted, 0); assert.equal(shardCapped.resources.boxesCollected, 10);
});

test('CPU collector consumes a resource box but receives no run resource', () => {
  const result = items.applyPickupEffect({ ...identity(), kind: 'gear_resource', collectorType: 'cpu', unit: { hp: 50, maxHp: 100, specialCharge: 0 }, resources: { boxesCollected: 2, powder: 6, blueprintShards: 0 } });
  assert.equal(result.consumed, true); assert.equal(result.reason, 'cpu-collected'); assert.equal(result.powderGranted, 0); assert.equal(result.shardGranted, 0);
  assert.deepEqual(result.resources, { boxesCollected: 2, powder: 6, blueprintShards: 0 });
});

for (const [name, fn] of cases) {
  fn(); passed += 1; console.log(`  ok ${name}`);
}
console.log(`stage-battle-items: ${passed}/${cases.length} passed`);
