const assert = require('node:assert/strict');
const foundation = require('../coop-mvp-foundation.js');
const coopRewards = require('../coop-mvp-rewards.js');
const storageApi = require('../shared/gear-storage.js');
const gearRewards = require('../shared/gear-rewards.js');
const coopGear = require('../shared/gear-coop-rewards.js');
const settlement = require('../shared/gear-coop-settlement-storage.js');
const recovery = require('../shared/gear-coop-recovery.js');
const battle = require('../coop-mvp-battle.js');
const session = require('../coop-mvp-session.js');

let passed = 0;
function check(message, condition) { assert.ok(condition, message); passed += 1; }
function memory() { const values = new Map(); return { getItem: (k) => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }; }
function serialLocks() { let tail = Promise.resolve(); return { request(_name, _options, callback) { const run = tail.then(() => callback({})); tail = run.catch(() => {}); return run; } }; }
function matchId(label) { return Array.from({ length: 48 }, (_, index) => ((label.charCodeAt(index % label.length) + index) & 15).toString(16)).join(''); }
function event(label, difficulty = 'normal') { const id = matchId(label); return { id: `${id}:result`, type: 'coop-result', outcome: 'victory', difficulty, rescues: 0, partsDestroyed: 4, totalParts: 4, bossHpRemainingRatio: 0, playerCount: 1, aiCount: 3, allPartsDestroyed: true, noDown: true, deadLineWin: false }; }
function pending(label, difficulty = 'normal', firstClear = true) { const foundationEvent = event(label, difficulty); const id = foundationEvent.id.slice(0, 48); return settlement.create({ matchId: id, eventId: foundationEvent.id, difficulty, outcome: 'victory', firstClear, foundationEvent, createdAtMs: 100 }); }
function queued(store) { return storageApi.loadGearState(store).unclaimedRewards; }
async function recordFoundation(store, value, lockManager) { return foundation.mutateStateLocked((state) => ({ state: coopRewards.recordEvent(state, value.foundationEvent).state }), { storage: store, lockManager }); }
function victoryRuntime(label, difficulty = 'normal') { const id = matchId(label); return session.createRuntime({ id, bossId: 'fortress-tank', difficulty, stageId: 'fortress-fixed', seats: { p1: { uid: 'host', name: 'H', battle: { hp: 100, fuel: 30 } }, e1: { name: 'AI', battle: { hp: 100, fuel: 30 } }, s1: { name: 'AI', battle: { hp: 100, fuel: 30 } }, s2: { name: 'AI', battle: { hp: 100, fuel: 30 } } } }); }
function victoryBattleState(runtime) { const state = battle.createBattleState({ matchId: runtime.id, difficulty: runtime.difficulty, slots: runtime.seats, aiFill: true, characters: {} }); state.outcome = 'victory'; state.encounter.boss.body.hp = 0; return state; }

(async () => {
  const locks = serialLocks();
  const ordinary = memory(); settlement.save(pending('ordinary', 'normal', false), ordinary);
  await foundation.mutateStateLocked((state) => { state.boss.firstClears.normal = true; return { state }; }, { storage: ordinary, lockManager: locks });
  await recovery.recoverPendingCoopGearSettlement(ordinary, { storage: ordinary, lockManager: locks });
  check('通常勝利はGear 2個', queued(ordinary)[0].gears.length === 2);
  for (const [difficulty, minimum] of [['normal', 3], ['hard', 4], ['extreme', 6]]) {
    const store = memory(); settlement.save(pending(`first-${difficulty}`, difficulty), store);
    const result = await recovery.recoverPendingCoopGearSettlement(store, { storage: store, lockManager: locks });
    const reward = queued(store)[0];
    check(`${difficulty}初回はroomなしで復旧`, result.status === 'recovered' && settlement.load(store) === null);
    check(`${difficulty}初回はGear 3個・bonus星保証`, reward.gears.length === 3 && reward.gears[2].star >= minimum);
    check(`${difficulty}初回はFoundation firstClearを一度だけ確定`, foundation.loadState(store).boss.firstClears[difficulty] === true);
  }

  const crashA = memory(); const a = pending('crash-a'); settlement.save(a, crashA);
  await recovery.recoverPendingCoopGearSettlement(crashA, { storage: crashA, lockManager: locks });
  check('crash AはfirstClear・Gear 3・cleanupを完遂', foundation.loadState(crashA).rewardLedger[`event:${a.eventId}`] === true && queued(crashA)[0].gears.length === 3 && settlement.load(crashA) === null);

  const crashB = memory(); const b = pending('crash-b', 'hard'); settlement.save(b, crashB); await recordFoundation(crashB, b, locks);
  const coinsBeforeB = foundation.loadState(crashB).wallet.coins;
  await recovery.recoverPendingCoopGearSettlement(crashB, { storage: crashB, lockManager: locks });
  check('crash BはFoundation二重付与なしでqueue', foundation.loadState(crashB).wallet.coins === coinsBeforeB && queued(crashB).length === 1 && queued(crashB)[0].gears.length === 3);

  const crashC = memory(); const c = pending('crash-c'); settlement.save(c, crashC); await recordFoundation(crashC, c, locks); await gearRewards.persistQueueReward(c.reward, crashC, { lockManager: locks });
  const cBefore = JSON.stringify(queued(crashC));
  await recovery.recoverPendingCoopGearSettlement(crashC, { storage: crashC, lockManager: locks });
  check('crash Cはduplicate確認だけでcleanupしGearを増やさない', JSON.stringify(queued(crashC)) === cBefore && settlement.load(crashC) === null);

  const crashD = memory(); const d = pending('crash-d'); settlement.save(d, crashD); crashD.setItem('katamon.coopResult.cached', JSON.stringify({ stale: true }));
  await recovery.recoverPendingCoopGearSettlement(crashD, { storage: crashD, lockManager: locks });
  check('crash Dはcached resultがあってもgeneric recoveryする', queued(crashD).length === 1 && settlement.load(crashD) === null);
  const old = memory(); old.setItem('katamon.coopResult.old', JSON.stringify({ matchId: 'old' }));
  check('旧cached resultだけではretroactive Gearを付与しない', (await recovery.recoverPendingCoopGearSettlement(old, { storage: old, lockManager: locks })).status === 'nothing_pending' && queued(old).length === 0);

  const full = memory(); const fullPending = pending('full'); settlement.save(fullPending, full);
  const fullState = storageApi.loadGearState(full); fullState.unclaimedRewards = Array.from({ length: 10 }, (_, index) => { const id = matchId(`full-${index}`); return { ...coopGear.materializeCoopGearReward({ matchId: id, eventId: `${id}:result`, difficulty: 'normal', outcome: 'victory', firstClear: false, createdAtMs: 1 }), rewardId: `cpu:full-${index}` }; }); storageApi.saveGearState(fullState, full);
  const blocked = await recovery.recoverPendingCoopGearSettlement(full, { storage: full, lockManager: locks });
  check('unclaimed満杯でもFoundationは確定しsettlementを保持', blocked.status === 'capacity_blocked' && foundation.loadState(full).rewardLedger[`event:${fullPending.eventId}`] === true && settlement.load(full) !== null);
  const freed = storageApi.loadGearState(full); freed.unclaimedRewards.pop(); storageApi.saveGearState(freed, full);
  await recovery.recoverPendingCoopGearSettlement(full, { storage: full, lockManager: locks });
  check('unclaimed空き後は同一rewardを一度だけqueueしてcleanup', queued(full).some((reward) => reward.rewardId === fullPending.reward.rewardId) && settlement.load(full) === null);

  const physical = memory(); const physicalPending = pending('physical'); settlement.save(physicalPending, physical);
  const physicalState = storageApi.loadGearState(physical); const fillGears = [];
  for (let index = 0; index < 275; index += 1) { const id = matchId(`physical-${index}`); fillGears.push(...coopGear.materializeCoopGearReward({ matchId: id, eventId: `${id}:result`, difficulty: 'normal', outcome: 'victory', firstClear: false, createdAtMs: 1 }).gears); }
  physicalState.inventory = fillGears.slice(0, 500).map((gear) => ({ gear, locked: false, favorite: false })); physicalState.tempBox = fillGears.slice(500, 550).map((gear, index) => ({ gear, locked: false, favorite: false, enteredAtMs: index })); storageApi.saveGearState(physicalState, physical);
  const physicalBlocked = await recovery.recoverPendingCoopGearSettlement(physical, { storage: physical, lockManager: locks });
  check('inventory500+TEMP50ならphysical満杯でsettlementを保持', physicalBlocked.status === 'capacity_blocked' && settlement.load(physical) !== null);
  const physicalFreed = storageApi.loadGearState(physical); physicalFreed.tempBox.pop(); storageApi.saveGearState(physicalFreed, physical);
  await recovery.recoverPendingCoopGearSettlement(physical, { storage: physical, lockManager: locks });
  check('physical空き後も同一full rewardだけをqueue', queued(physical).filter((reward) => reward.rewardId === physicalPending.reward.rewardId).length === 1 && settlement.load(physical) === null);

  const alreadyQueued = memory(); const q = pending('already-queued'); settlement.save(q, alreadyQueued); await recordFoundation(alreadyQueued, q, locks); await gearRewards.persistQueueReward(q.reward, alreadyQueued, { lockManager: locks });
  const stateWithTen = storageApi.loadGearState(alreadyQueued); while (stateWithTen.unclaimedRewards.length < 10) { const index = stateWithTen.unclaimedRewards.length; const id = matchId(`fill-${index}`); stateWithTen.unclaimedRewards.push(coopGear.materializeCoopGearReward({ matchId: id, eventId: `${id}:result`, difficulty: 'normal', outcome: 'victory', firstClear: false, createdAtMs: 1 })); } storageApi.saveGearState(stateWithTen, alreadyQueued);
  await recovery.recoverPendingCoopGearSettlement(alreadyQueued, { storage: alreadyQueued, lockManager: locks });
  check('既queue済みなら満杯でもcapacityに止めずcleanup', settlement.load(alreadyQueued) === null && queued(alreadyQueued).filter((reward) => reward.rewardId === q.reward.rewardId).length === 1);

  const cleanupFailBase = memory(); const cleanupFail = { getItem: cleanupFailBase.getItem, setItem: cleanupFailBase.setItem, removeItem() { throw new Error('injected cleanup failure'); } }; const cleanupPending = pending('cleanup'); settlement.save(cleanupPending, cleanupFail);
  await assert.rejects(() => recovery.recoverPendingCoopGearSettlement(cleanupFail, { storage: cleanupFail, lockManager: locks }));
  check('cleanup read-back障害ではFoundation/Gearをrollbackせずsettlementを残す', foundation.loadState(cleanupFail).rewardLedger[`event:${cleanupPending.eventId}`] === true && queued(cleanupFail).length === 1 && settlement.load(cleanupFail) !== null);
  await recovery.recoverPendingCoopGearSettlement(cleanupFailBase, { storage: cleanupFailBase, lockManager: locks });
  check('cleanup再試行はduplicate後にだけ完了し二重Gearなし', settlement.load(cleanupFailBase) === null && queued(cleanupFailBase).length === 1);

  const wal = memory(); const walPending = pending('wal'); settlement.save(walPending, wal); wal.setItem('katamon_gear_txn_v1', '{}');
  await assert.rejects(() => recovery.recoverPendingCoopGearSettlement(wal, { storage: wal, lockManager: locks }));
  check('raw WALはFoundation/queue前にfail closedしsettlementを残す', settlement.load(wal) !== null && queued(wal).length === 0);

  const foundationBase = memory(); const foundationPending = pending('foundation-readback'); settlement.save(foundationPending, foundationBase); let foundationReads = 0;
  const foundationAmbiguous = { setItem: foundationBase.setItem, removeItem: foundationBase.removeItem, getItem(key) { if (key === 'katamon_coop_mvp_v1' && ++foundationReads === 2) throw new Error('injected Foundation read-back ambiguity'); return foundationBase.getItem(key); } };
  const foundationOutcome = await recovery.recoverPendingCoopGearSettlement(foundationAmbiguous, { storage: foundationAmbiguous, lockManager: locks });
  assert.equal(foundationOutcome.status, 'foundation_unverified');
  check('Foundation read-back ambiguityはqueueせずsettlementを保持', queued(foundationBase).length === 0 && settlement.load(foundationBase) !== null);
  await recovery.recoverPendingCoopGearSettlement(foundationBase, { storage: foundationBase, lockManager: locks });
  check('Foundation ambiguity復旧後はduplicate安全に同一rewardをqueue', queued(foundationBase).length === 1 && settlement.load(foundationBase) === null);

  const gearBase = memory(); const gearPending = pending('gear-readback'); settlement.save(gearPending, gearBase); let gearReads = 0;
  const gearAmbiguous = { setItem: gearBase.setItem, removeItem: gearBase.removeItem, getItem(key) { if (key === storageApi.GEAR_STORAGE_KEY && ++gearReads === 4) throw new Error('injected Gear read-back ambiguity'); return gearBase.getItem(key); } };
  await assert.rejects(() => recovery.recoverPendingCoopGearSettlement(gearAmbiguous, { storage: gearAmbiguous, lockManager: locks }));
  check('Gear read-back ambiguityはsettlementを保持しwrite済みrewardをrollbackしない', queued(gearBase).length === 1 && settlement.load(gearBase) !== null);
  await recovery.recoverPendingCoopGearSettlement(gearBase, { storage: gearBase, lockManager: locks });
  check('Gear ambiguity復旧後は同一rewardのduplicate確認だけでcleanup', queued(gearBase).length === 1 && settlement.load(gearBase) === null);

  const firstClearConflict = memory(); const fc = pending('first-clear-conflict'); settlement.save(fc, firstClearConflict);
  await foundation.mutateStateLocked((state) => { state.boss.firstClears.normal = true; return { state }; }, { storage: firstClearConflict, lockManager: locks });
  await assert.rejects(() => recovery.recoverPendingCoopGearSettlement(firstClearConflict, { storage: firstClearConflict, lockManager: locks }));
  check('event未処理のfirstClear矛盾はFoundation/Gearを動かさずfail closed', foundation.loadState(firstClearConflict).rewardLedger[`event:${fc.eventId}`] !== true && queued(firstClearConflict).length === 0 && settlement.load(firstClearConflict) !== null);

  const bodyConflict = memory(); const conflictPending = pending('body-conflict'); settlement.save(conflictPending, bodyConflict); await recordFoundation(bodyConflict, conflictPending, locks);
  await gearRewards.persistQueueReward({ ...conflictPending.reward, sourceId: 'cpu_battle' }, bodyConflict, { lockManager: locks });
  await assert.rejects(() => recovery.recoverPendingCoopGearSettlement(bodyConflict, { storage: bodyConflict, lockManager: locks }));
  check('同rewardIdでbodyが異なる既queue報酬はcleanupせずfail closed', settlement.load(bodyConflict) !== null && queued(bodyConflict).length === 1);

  for (const outcome of ['defeat', 'aborted']) { const id = matchId(`no-${outcome}`); assert.throws(() => coopGear.createCoopSettlementIntent({ matchId: id, eventId: `${id}:result`, difficulty: 'normal', outcome, firstClear: false, createdAtMs: 1 })); }
  check('defeat/abortedはGear settlementを生成しない', true);
  const matchA = pending('match-a'); const matchB = pending('match-b'); const overwrite = memory(); settlement.save(matchA, overwrite); assert.throws(() => settlement.save(matchB, overwrite));
  check('別match pendingは保存層で上書き禁止', settlement.load(overwrite).matchId === matchA.matchId);

  const productionConflict = memory(); const runtimeA = victoryRuntime('production-a'); const runtimeB = victoryRuntime('production-b'); const stateB = victoryBattleState(runtimeB);
  const summaryA = session.resultSummary(runtimeA, { outcome: 'victory', partsDestroyed: 4, totalParts: 4, playerCount: 1, aiCount: 3, allPartsDestroyed: true, noDown: true }); const eventA = session.rewardEvent(summaryA);
  const pendingA = settlement.create({ matchId: runtimeA.id, eventId: eventA.id, difficulty: 'normal', outcome: 'victory', firstClear: true, foundationEvent: eventA, createdAtMs: 100 }); settlement.save(pendingA, productionConflict);
  await assert.rejects(() => battle.recordResultLocked(foundation, runtimeB, stateB, { storage: productionConflict, lockManager: locks }));
  check('production recordResultLockedはpending A中のmatch B Foundation処理を完全block', foundation.loadState(productionConflict).rewardLedger[`event:${runtimeB.id}:result`] !== true && settlement.load(productionConflict).eventId === pendingA.eventId && queued(productionConflict).length === 0);
  await recovery.recoverPendingCoopGearSettlement(productionConflict, { storage: productionConflict, lockManager: locks });
  const afterA = await battle.recordResultLocked(foundation, runtimeB, stateB, { storage: productionConflict, lockManager: locks });
  check('firstClear competitionはAだけ3個、A復旧後のBは再クリア2個', foundation.loadState(productionConflict).boss.firstClears.normal === true && afterA.resultSummary.firstClear === false && queued(productionConflict).some((reward) => reward.gears.length === 3) && queued(productionConflict).some((reward) => reward.gears.length === 2));

  const currentCapacity = memory(); const capacityState = storageApi.loadGearState(currentCapacity); capacityState.unclaimedRewards = Array.from({ length: 10 }, (_, index) => { const id = matchId(`current-capacity-${index}`); return coopGear.materializeCoopGearReward({ matchId: id, eventId: `${id}:result`, difficulty: 'normal', outcome: 'victory', firstClear: false, createdAtMs: 1 }); }); storageApi.saveGearState(capacityState, currentCapacity);
  const currentRuntime = victoryRuntime('current-capacity-result'); const currentRecorded = await battle.recordResultLocked(foundation, currentRuntime, victoryBattleState(currentRuntime), { storage: currentCapacity, lockManager: locks });
  check('今回の結果でcapacity blockならcallerへgearRecoveryを返しsettlementを保持', currentRecorded.gearRecovery.status === 'capacity_blocked' && settlement.load(currentCapacity) !== null);

  const shared = memory(); const sharedPending = pending('multi-tab'); settlement.save(sharedPending, shared); const sharedLocks = serialLocks();
  const both = await Promise.all([recovery.recoverPendingCoopGearSettlement(shared, { storage: shared, lockManager: sharedLocks }), recovery.recoverPendingCoopGearSettlement(shared, { storage: shared, lockManager: sharedLocks })]);
  check('multi-tab同時recoveryはevent/Gear各1件でno-opも成功', queued(shared).filter((reward) => reward.rewardId === sharedPending.reward.rewardId).length === 1 && foundation.loadState(shared).rewardLedger[`event:${sharedPending.eventId}`] === true && settlement.load(shared) === null && both.every((result) => ['recovered', 'nothing_pending'].includes(result.status)));

  const integrity = pending('integrity', 'hard'); const rematerialized = coopGear.materializeCoopGearReward({ matchId: integrity.matchId, eventId: integrity.eventId, difficulty: integrity.difficulty, outcome: integrity.outcome, firstClear: integrity.firstClear, createdAtMs: integrity.reward.createdAtMs });
  assert.deepEqual(integrity.reward, rematerialized); check('stored full rewardは同じmatch retryでdeepEqual', true);
  for (const mutate of [
    (value) => { value.eventId = 'wrong:result'; }, (value) => { value.foundationEvent.id = 'wrong'; },
    (value) => { value.foundationEvent.difficulty = 'normal'; }, (value) => { value.reward.rewardId = 'wrong'; },
    (value) => { value.reward.sourceId = 'cpu_battle'; }, (value) => { value.firstClear = false; },
    (value) => { value.extra = true; }, (value) => { value.schemaVersion = 2; },
  ]) { const value = JSON.parse(JSON.stringify(integrity)); mutate(value); assert.throws(() => settlement.validate(value)); }
  check('strict settlement validationはcanonical不一致・unknown・future schemaをfail closed', true);
  console.log(`gear-coop-phase2d: ${passed}/${passed} passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
