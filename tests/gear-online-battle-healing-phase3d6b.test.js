const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const gearCombat = require('../shared/gear-combat.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const onlineProtocol = require('../shared/gear-online-protocol.js');
const lobbyProtocol = require('../shared/gear-online-lobby-protocol.js');
const battleStart = require('../shared/gear-online-battle-start.js');
const onlineRng = require('../shared/gear-online-battle-rng.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const roomId = 'A2BC3DEF';
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobbyProtocol.createRoomGearCapability({
  visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1
});
const slotIds = domain.SLOT_IDS;
const cases = [];
let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const readRepoText = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n?/g, '\n');

function onlineFixture({ gear = true } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: roomId,
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1,
      ...(gear ? { gearCapability: capability } : {})
    },
    slots: {
      p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null
    },
    participantGearReveals: {}, verifiedStartGearManifest: null,
    battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu',
    localAction: null, remoteAction: null
  };
}

function makeGear(prefix, slotId, options = {}) {
  const { setId = 'rescue', mainOpId = null, requiredSubId = null, forbiddenSubId = null } = options;
  for (let index = 0; index < 1000; index += 1) {
    const gear = domain.createGear({
      gearId: `${prefix}:${index}`,
      generationSeed: `3d6b:${prefix}:${index}:generation`,
      enhancementSeed: `3d6b:${prefix}:${index}:enhancement`,
      sourceId: 'cpu_battle', sourceDetail: { fixture: '3d6b' }, acquiredAt: '2026-08-28T00:00:00Z',
      qualityProfile: { id: '3d6b-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: `3d6b-${setId}`, setWeights: [{ id: setId, weight: 1 }] }, slotId
    });
    if ((!mainOpId || gear.mainOp.opId === mainOpId)
      && (!requiredSubId || gear.subOps.some((sub) => sub.opId === requiredSubId))
      && (!forbiddenSubId || !gear.subOps.some((sub) => sub.opId === forbiddenSubId))) return gear;
  }
  throw new Error(`could not create ${mainOpId || requiredSubId || setId} fixture`);
}

function lifeSet(prefix) {
  return ['barrel', 'armor', 'core', 'engine'].map((slotId) => makeGear(`${prefix}-${slotId}`, slotId, { setId: 'life' }));
}

function rescueSet(prefix, count = 2) {
  return ['barrel', 'armor', 'core', 'engine'].slice(0, count)
    .map((slotId) => makeGear(`${prefix}-${slotId}`, slotId, { setId: 'rescue' }));
}

function createReveal(seat, characterId, gears = []) {
  const trustedContext = wiring.trustedContext(seat, characterId);
  const slots = Object.fromEntries(slotIds.map((slotId) => [slotId, null]));
  for (const gear of gears) slots[gear.slotId] = gear;
  const snapshot = battleSnapshot.createBattleGearSnapshot({
    resolvedLoadout: {
      characterId, presetId: 'preset1',
      gearIds: slotIds.map((slotId) => slots[slotId]?.gearId).filter(Boolean), slots
    },
    baseHp: trustedContext.baseHp,
    baseFuel: trustedContext.baseFuel
  });
  return Object.freeze({
    trustedContext,
    revealedCommitment: onlineProtocol.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext })
  });
}

function installBattle({ p1Gears = [], e1Gears = [], gear = true } = {}) {
  const current = onlineFixture({ gear });
  h.setOnlineForLogTest(current);
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
  if (!gear) {
    wiring.applyBattleStartState(null);
    return { current, state: null };
  }
  const reveals = [createReveal('p1', 'kyoryu', p1Gears), createReveal('e1', 'iwa', e1Gears)];
  const manifest = lobbyProtocol.createStartGearManifest({
    roundId,
    commitments: reveals.map((entry) => entry.revealedCommitment),
    participantReveals: reveals
  });
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  const state = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  wiring.applyBattleStartState(state);
  return { current, state };
}

function heal(unitId, baseHealing) {
  return wiring.applyHealing(unitId, unitId, baseHealing);
}

function drain(ownerId, targetId) {
  const owner = kt.unitById(ownerId);
  const target = kt.unitById(targetId);
  const ownerBefore = owner.hp;
  const targetBefore = target.hp;
  kt.explodeDrainAtForTest(target.x, target.y, 1, ownerId, {
    gearDamageProfile: 'excluded', directTargetId: targetId, radius: 5
  });
  return { actualDamage: targetBefore - target.hp, actualHealing: owner.hp - ownerBefore };
}

test('Gearless ONLINE self-heal preserves requested/actual legacy semantics and max-HP cap', () => {
  installBattle();
  const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp - 30);
  assert.deepEqual(heal('p1', 20), { requestedHealing: 20, actualHealing: 20 });
  kt.setUnitHpForTest('p1', p1.maxHp - 3);
  assert.deepEqual(heal('p1', 20), { requestedHealing: 20, actualHealing: 3 });
  assert.deepEqual(heal('p1', 20), { requestedHealing: 20, actualHealing: 0 });
});

test('Healing Effect and Received Healing Effect independently apply exactly once', () => {
  const healGear = makeGear('heal-only', 'auxiliary', { mainOpId: 'heal_power', forbiddenSubId: 'received_heal' });
  let installed = installBattle({ p1Gears: [healGear] });
  let combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  kt.setUnitHpForTest('p1', 1);
  assert.equal(combat.receivedHealingMultiplier, 1);
  assert.equal(heal('p1', 20).requestedHealing, Math.round(gearCombat.finalHealing(20, combat.healingMultiplier, 1)));

  const receivedGear = makeGear('received-only', 'barrel', { requiredSubId: 'received_heal', forbiddenSubId: 'heal_power' });
  installed = installBattle({ p1Gears: [receivedGear] });
  combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  kt.setUnitHpForTest('p1', 1);
  assert.equal(combat.healingMultiplier, 1);
  assert.equal(heal('p1', 20).requestedHealing, Math.round(gearCombat.finalHealing(20, 1, combat.receivedHealingMultiplier)));
});

test('combined multipliers retain fractional precision and round once at the event boundary', () => {
  const both = makeGear('both', 'auxiliary', { mainOpId: 'heal_power', requiredSubId: 'received_heal' });
  const { state } = installBattle({ p1Gears: [both] });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  let baseHealing = 1;
  while (baseHealing < 100
      && Math.round(gearCombat.finalHealing(baseHealing, combat.healingMultiplier, combat.receivedHealingMultiplier))
        === Math.round(Math.round(baseHealing * combat.healingMultiplier) * combat.receivedHealingMultiplier)) baseHealing += 1;
  assert(baseHealing < 100, 'fixture must distinguish one final round from an intermediate round');
  kt.setUnitHpForTest('p1', 1);
  const expected = Math.round(gearCombat.finalHealing(baseHealing, combat.healingMultiplier, combat.receivedHealingMultiplier));
  assert.equal(heal('p1', baseHealing).requestedHealing, expected);
});

test('Rescue2 uses the snapshot static Healing bonus without runtime re-addition', () => {
  const { state } = installBattle({ p1Gears: rescueSet('rescue2') });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(combat.activeSets.some((set) => set.setId === 'rescue' && set.threshold === 2), true);
  kt.setUnitHpForTest('p1', 1);
  assert.equal(heal('p1', 20).requestedHealing,
    Math.round(gearCombat.finalHealing(20, combat.healingMultiplier, combat.receivedHealingMultiplier)));
});

test('generated self-heal applies immutable p1/e1 snapshot multipliers on both clients', () => {
  const p1Gear = makeGear('generated-p1', 'auxiliary', { mainOpId: 'heal_power' });
  const e1Gear = makeGear('generated-e1', 'auxiliary', { mainOpId: 'heal_power' });
  const run = () => {
    const { state } = installBattle({ p1Gears: [p1Gear], e1Gears: [e1Gear] });
    const results = {};
    for (const id of ['p1', 'e1']) {
      const unit = kt.unitById(id);
      kt.setUnitHpForTest(id, 1);
      const combat = state.battleGearSnapshotsByUnit[id].derivedStats;
      results[id] = {
        actual: kt.launchGeneratedSelfHealForTest(id, 20).actualHealing,
        expected: Math.round(gearCombat.finalHealing(20, combat.healingMultiplier, combat.receivedHealingMultiplier))
      };
    }
    return results;
  };
  const host = run();
  const guest = run();
  assert.deepEqual(host, guest);
  assert.equal(host.p1.actual, host.p1.expected);
  assert.equal(host.e1.actual, host.e1.expected);
});

test('Bloomtan drain uses actual HP damage and applies owner Healing in both directions', () => {
  const p1Gear = makeGear('drain-p1', 'auxiliary', { mainOpId: 'heal_power' });
  let installed = installBattle({ p1Gears: [p1Gear] });
  kt.setUnitHpForTest('p1', 1);
  let result = drain('p1', 'e1');
  let combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert(result.actualDamage > 0);
  assert.equal(result.actualHealing, Math.round(gearCombat.finalHealing(result.actualDamage, combat.healingMultiplier, combat.receivedHealingMultiplier)));

  const e1Gear = makeGear('drain-e1', 'auxiliary', { mainOpId: 'heal_power' });
  installed = installBattle({ e1Gears: [e1Gear] });
  kt.setUnitHpForTest('e1', 1);
  result = drain('e1', 'p1');
  combat = installed.state.battleGearSnapshotsByUnit.e1.derivedStats;
  assert(result.actualDamage > 0);
  assert.equal(result.actualHealing, Math.round(gearCombat.finalHealing(result.actualDamage, combat.healingMultiplier, combat.receivedHealingMultiplier)));
});

test('Shield absorption is excluded from drain base and full Shield absorb creates zero healing', () => {
  const sourceGear = makeGear('shield-drain-source', 'auxiliary', { mainOpId: 'heal_power' });
  let installed = installBattle({ p1Gears: [sourceGear], e1Gears: lifeSet('shield-drain-target') });
  kt.setUnitHpForTest('p1', 1);
  wiring.setShieldForTest('e1', 10);
  let result = drain('p1', 'e1');
  const combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert(result.actualDamage > 0);
  assert.equal(result.actualHealing, Math.round(gearCombat.finalHealing(result.actualDamage, combat.healingMultiplier, combat.receivedHealingMultiplier)));

  installed = installBattle({ p1Gears: [sourceGear], e1Gears: lifeSet('full-shield-target') });
  kt.setUnitHpForTest('p1', 1);
  const targetCombat = installed.state.battleGearSnapshotsByUnit.e1.derivedStats;
  wiring.setShieldForTest('e1', targetCombat.maxHp * 0.35);
  result = drain('p1', 'e1');
  assert.equal(result.actualDamage, 0);
  assert.equal(result.actualHealing, 0);
  assert.equal(kt.unitById('p1').hp, 1);
});

test('Subweapon Barrier prevention is excluded from drain base', () => {
  const sourceGear = makeGear('barrier-drain', 'auxiliary', { mainOpId: 'heal_power' });
  const { state } = installBattle({ p1Gears: [sourceGear] });
  kt.setUnitHpForTest('p1', 1);
  kt.setSubweaponBarrierForTest('e1', true);
  const result = drain('p1', 'e1');
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert(result.actualDamage > 0);
  assert.equal(result.actualHealing, Math.round(gearCombat.finalHealing(result.actualDamage, combat.healingMultiplier, combat.receivedHealingMultiplier)));
  assert.equal(kt.unitById('e1').subweaponBarrierActive, false);
});

test('Healing mutates only HP, leaving Numeric Shield, Barrier, Crit and Status state unchanged', () => {
  installBattle({ p1Gears: lifeSet('isolation') });
  const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp - 30);
  kt.setSubweaponBarrierForTest('p1', true);
  const shieldBefore = wiring.shieldState();
  const statusBefore = clone(kt.turnEffectForTest('p1'));
  const onlineBefore = wiring.state();
  heal('p1', 20);
  assert.deepEqual(wiring.shieldState(), shieldBefore);
  assert.equal(p1.subweaponBarrierActive, true);
  assert.deepEqual(kt.turnEffectForTest('p1'), statusBefore);
  assert.deepEqual(wiring.state().localAction, onlineBefore.localAction);
  assert.deepEqual(wiring.state().remoteAction, onlineBefore.remoteAction);
});

test('Gear OFF remains legacy and Gear ON fails closed without immutable Healing authority', () => {
  installBattle({ gear: false });
  const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp - 30);
  assert.deepEqual(heal('p1', 20), { requestedHealing: 20, actualHealing: 20 });

  const installed = installBattle();
  installed.current.battleGearSnapshotsByUnit = null;
  assert.throws(() => heal('p1', 20), (error) => error?.code === 'ONLINE_GEAR_HEALING_SNAPSHOT_MISSING');
});

test('ONLINE Healing accepts only existing self-heal events', () => {
  installBattle();
  assert.throws(() => wiring.applyHealing('p1', 'e1', 20), (error) => error?.code === 'ONLINE_GEAR_HEALING_EVENT_UNSUPPORTED');
});

test('Healing adds no RNG, preserves Crit fixture, and leaves Rescue4/Last Stand inert', () => {
  const { state } = installBattle({ p1Gears: rescueSet('rescue4', 4) });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(combat.activeSets.some((set) => set.setId === 'rescue' && set.threshold === 4), true);
  const actionIdentity = onlineRng.createOnlineGearActionIdentity({ version: 1, roomId, roundId, turnOrdinal: 7, sourceUnitId: 'p1' });
  const critIdentity = onlineRng.createCritRollIdentity({ actionIdentity, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0 });
  assert.equal(onlineRng.rollBasisPoints(critIdentity), 5220);
  const original = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; return 0.5; };
  try {
    kt.setUnitHpForTest('p1', 1);
    heal('p1', 20);
  } finally { Math.random = original; }
  assert.equal(calls, 0);
  assert.equal(wiring.state().localAction, null);
  assert.equal(wiring.state().remoteAction, null);
});

test('source contract limits ONLINE Gear Healing to generated self-heal and drain with no wire/reconnect fields', () => {
  const index = readRepoText('index.html');
  const rules = readRepoText('database.rules.json');
  const firebaseWire = readRepoText('shared', 'gear-online-firebase-wire.js');
  assert.equal((index.match(/\bapplyBattleGearHealing\(/g) || []).length, 3,
    'definition + generated self-heal + drain only');
  assert.equal((index.match(/\bapplyCpuGearHealing\(/g) || []).length, 2,
    'CPU definition + dispatcher fallback only');
  const generatedStart = index.indexOf('function launchGeneratedSpecial(');
  const generatedEnd = index.indexOf('\n  function ', generatedStart + 20);
  assert.match(index.slice(generatedStart, generatedEnd), /applyBattleGearHealing\(/);
  const explodeStart = index.indexOf('function explodeAt(');
  const explodeEnd = index.indexOf('\n  function explodeProjectileAt', explodeStart);
  assert.match(index.slice(explodeStart, explodeEnd), /drainedDamage[\s\S]*applyBattleGearHealing\(/);
  for (const source of [rules, firebaseWire]) {
    assert.doesNotMatch(source, /\b(?:requestedHealing|actualHealing|healingMultiplier|receivedHealingMultiplier)\s*:/);
    assert.doesNotMatch(source, /\bonline\.battleGearHealingState|\bcurrentHealing\b/);
  }
  assert.doesNotMatch(index, /netSend\(\{[^}]*\b(?:requestedHealing|actualHealing|healingMultiplier|receivedHealingMultiplier)\b/);
  assert.doesNotMatch(index, /\bonline\.battleGearHealingState|\bcurrentHealing\b/);
});

async function main() {
  for (const [name, fn] of cases) {
    h.setOnlineForLogTest(null);
    try {
      await fn();
      passed += 1;
      console.log(`  ok ${name}`);
    } finally {
      h.setOnlineForLogTest(null);
      kt.setMatchFormatForTest('1v1');
      localStorage.clear();
    }
  }
  console.log(`gear-online-battle-healing-phase3d6b: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
