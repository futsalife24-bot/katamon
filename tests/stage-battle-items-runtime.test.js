const assert = require('node:assert/strict');
const test = require('node:test');
const harness = require('./seatharness.js');

const kt = harness.kt();
const storage = globalThis.localStorage;
const runStorage = globalThis.KatamonGearCpuRunStorage;

function resetCpuMatch() {
  storage.clear();
  kt.setHasSave(false);
  kt.setPhase('title');
  assert.equal(kt.startBattle(), true);
  assert.ok(kt.stageBattleItemsForTest(), 'eligible CPU 1v1 must initialize stage items');
}

test('turn timing, runtime pickup paths, durable resource escrow, and snapshot replay are integrated', async () => {
  resetCpuMatch();

  kt.setTurnCountForTest(1);
  assert.equal(kt.stageBattleItemTurnStartForTest(), false);
  assert.equal(kt.stageBattleItemsForTest().activeItem, null);
  kt.setTurnCountForTest(2);
  const spawnedAtFirstEligibleTurn = kt.stageBattleItemTurnStartForTest();
  const firstAttempt = kt.stageBattleItemsForTest();
  assert.equal(firstAttempt.nextSpawnOrdinal, 1, 'turn 2 must make the first deterministic spawn attempt');
  if (!spawnedAtFirstEligibleTurn) {
    assert.equal(firstAttempt.lastResolvedTurn, 2, 'a stage without a fair point must enter the normal cooldown');
    kt.forceStageBattleItemForTest('healing', kt.unitById('p1').x + 120, null);
  }
  assert.ok(kt.stageBattleItemsForTest().activeItem, 'snapshot fixture needs one active item');
  const spawnedSnapshot = kt.snapshot();
  assert.ok(spawnedSnapshot.stageBattleItems, 'local CPU suspend snapshot must include item state');
  assert.equal(Object.hasOwn(kt.stageBattleItemWireSnapshotForTest(), 'stageBattleItems'), false,
    'shared ONLINE/loopback snapshots must never carry local CPU stage item state');
  const forgedOrdinal = JSON.parse(JSON.stringify(spawnedSnapshot));
  forgedOrdinal.stageBattleItems.activeItem.spawnOrdinal += 1;
  assert.throws(() => kt.apply(forgedOrdinal), /STAGE_BATTLE_ITEMS_SNAPSHOT_MISMATCH|INVALID_BATTLE_ITEM_SPAWN_STATE/);
  const futureResolution = JSON.parse(JSON.stringify(spawnedSnapshot));
  futureResolution.stageBattleItems.lastResolvedTurn = futureResolution.turnCount + 1;
  assert.throws(() => kt.apply(futureResolution), /STAGE_BATTLE_ITEMS_SNAPSHOT_MISMATCH/);

  resetCpuMatch();
  const player = kt.unitById('p1');
  player.hp = player.maxHp - 40;
  const healing = kt.forceStageBattleItemForTest('healing', player.x + 80, player.y);
  assert.equal(healing.activeItem.kind, 'healing');
  const beforeHp = player.hp;
  assert.equal(kt.collectStageBattleItemByProjectileForTest(
    'p1',
    { x: player.x, y: player.y },
    { x: player.x + 160, y: player.y }
  ), true);
  assert.ok(player.hp > beforeHp && player.hp <= player.maxHp);
  assert.equal(kt.stageBattleItemsForTest().activeItem, null);

  const fullHealing = kt.forceStageBattleItemForTest('healing', player.x, player.y);
  assert.ok(fullHealing);
  player.hp = player.maxHp;
  player.grounded = true;
  assert.equal(kt.collectStageBattleItemByUnitForTest('p1'), false, 'full HP must not consume healing');
  assert.equal(kt.stageBattleItemsForTest().activeItem.kind, 'healing');

  resetCpuMatch();
  const chargePlayer = kt.unitById('p1');
  chargePlayer.specialCharge = 0;
  chargePlayer.grounded = true;
  kt.forceStageBattleItemForTest('special_charge', chargePlayer.x, chargePlayer.y);
  assert.equal(kt.collectStageBattleItemByUnitForTest('p1'), true);
  assert.equal(chargePlayer.specialCharge, 1);
  assert.equal(kt.stageBattleItemsForTest().activeItem, null);

  resetCpuMatch();
  const jumpPlayer = kt.unitById('p1');
  jumpPlayer.specialCharge = 0;
  const jumpItemX = Math.round((jumpPlayer.x + kt.unitById('e1').x) / 2);
  kt.forceStageBattleItemForTest('special_charge', jumpItemX, null);
  const jumpLanding = kt.landJumpOnStageBattleItemForTest('p1');
  assert.equal(jumpLanding.grounded, true);
  assert.equal(jumpLanding.collected, true, 'teleport jump landing must use the production pickup hook');
  assert.equal(jumpPlayer.specialCharge, 1);

  resetCpuMatch();
  const resourcePlayer = kt.unitById('p1');
  resourcePlayer.grounded = true;
  kt.forceStageBattleItemForTest('gear_resource', resourcePlayer.x, resourcePlayer.y, { spawnOrdinal: 0 });
  const beforePickupSnapshot = kt.snapshot();
  assert.equal(kt.collectStageBattleItemByUnitForTest('p1'), true);
  assert.deepEqual(kt.stageBattleItemPendingForTest(), { itemId: null, promise: false });
  const runAfterPickup = kt.cpuGearRunStateForTest();
  assert.equal(runAfterPickup.stageItemEscrow.powder, 3);
  assert.ok(runAfterPickup.stageItemEscrow.blueprintShards === 0
    || runAfterPickup.stageItemEscrow.blueprintShards === 1);
  assert.equal(runAfterPickup.stageItemEscrow.claimedMask, 1);

  kt.apply(beforePickupSnapshot);
  assert.equal(kt.stageBattleItemsForTest().activeItem, null,
    'replaying a pre-pickup snapshot must reconcile the durable claimed mask');
  assert.equal(kt.cpuGearRunStateForTest().stageItemEscrow.powder, 3);

  await kt.prepareCpuGearSettlementForTerminalOutcomeForTest('defeat');
  const pending = kt.cpuGearRunStateForTest();
  assert.equal(pending.state, 'settlement_pending');
  assert.equal(pending.settlementIntent.stageItemPowder, 3);
  assert.equal(
    pending.settlementIntent.stageItemBlueprintShards,
    runAfterPickup.stageItemEscrow.blueprintShards
  );
});

test('resource save failure stays retryable and blocks terminal settlement until the same pickup is durable', async () => {
  resetCpuMatch();
  const player = kt.unitById('p1');
  player.grounded = true;
  kt.forceStageBattleItemForTest('gear_resource', player.x, player.y, { spawnOrdinal: 0 });

  const originalSetItem = storage.setItem;
  let failOnce = true;
  storage.setItem = (key, value) => {
    if (failOnce && key === runStorage.CPU_GEAR_RUN_STORAGE_KEY) {
      failOnce = false;
      throw new Error('fixture stage resource write failure');
    }
    return originalSetItem(key, value);
  };
  try {
    assert.equal(kt.collectStageBattleItemByUnitForTest('p1'), false);
  } finally {
    storage.setItem = originalSetItem;
  }

  assert.equal(kt.cpuGearRunStateForTest().stageItemEscrow.powder, 0);
  assert.equal(kt.stageBattleItemsForTest().activeItem.kind, 'gear_resource');
  assert.deepEqual(kt.stageBattleItemRetryForTest(), {
    pending: true,
    error: 'STAGE_BATTLE_ITEM_PICKUP_NOT_DURABLE',
  });

  assert.equal(await kt.prepareCpuGearSettlementForTerminalOutcomeForTest('defeat'), true);
  const pending = kt.cpuGearRunStateForTest();
  assert.equal(pending.state, 'settlement_pending');
  assert.equal(pending.stageItemEscrow.powder, 3);
  assert.equal(pending.settlementIntent.stageItemPowder, 3);
  assert.deepEqual(kt.stageBattleItemRetryForTest(), { pending: false, error: null });
});

test('snapshot run fencing rejects a foreign run while fieldless legacy snapshots stay resumable', () => {
  resetCpuMatch();
  const foreignSnapshot = kt.snapshot();
  const foreignRunId = foreignSnapshot.stageBattleItems.runId;

  resetCpuMatch();
  const currentSnapshot = kt.snapshot();
  assert.notEqual(currentSnapshot.stageBattleItems.runId, foreignRunId);
  assert.throws(() => kt.apply(foreignSnapshot), /STAGE_BATTLE_ITEMS_SNAPSHOT_MISMATCH/);

  const legacySnapshot = kt.snapshot();
  delete legacySnapshot.stageBattleItems;
  assert.doesNotThrow(() => kt.apply(legacySnapshot));
  assert.equal(kt.stageBattleItemsForTest(), null,
    'a pre-feature suspend must finish without retroactively enabling item rolls');
});
