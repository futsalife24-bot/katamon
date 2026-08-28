const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const onlineProtocol = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const harness = require('./seatharness.js');

const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const unitIds = ['p1', 'e1', 'p2', 'e2'];
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);
const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();

function makeSetGear(prefix, setId, slotId) {
  return domain.createGear({
    gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`,
    sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z',
    qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: setId, setWeights: [{ id: setId, weight: 1 }] }, slotId
  });
}

function fourSet(prefix, setId) {
  return ['barrel', 'armor', 'core', 'engine'].map(slotId => makeSetGear(prefix, setId, slotId));
}

function firebase2v2() {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'playing', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId,
    visibility: 'private', settingsAuthorityBlocked: false,
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '2v2', stageSize: 'standard', revision: 1, gearCapability: capability },
    slots: { p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: { uid: 'uid-s1', claimedAt: 1 }, s2: { uid: 'uid-s2', claimedAt: 1 } },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null,
    battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null, queue: [], pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: {}, seatVerified: {}, selfCharacter: 'kyoryu', localAction: null, remoteAction: null
  };
}

function install({ rescueSource = 'p1', lastStandTarget = false } = {}) {
  kt.setMatchFormatForTest('2v2');
  for (const [unitId, characterId] of [['p1', 'kyoryu'], ['e1', 'iwa'], ['p2', 'medama'], ['e2', 'kyoryu']]) {
    assert.equal(kt.setCharacterForUnitForTest(unitId, characterId), characterId);
  }
  assert.deepEqual(h.setTurnOrderForTest(unitIds), unitIds);
  const current = firebase2v2();
  h.setOnlineForLogTest(current);
  const unitBySeat = [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']];
  const rescueSeatByUnit = { p1: 'p1', e1: 'e1', p2: 's1', e2: 's2' };
  const gearBySeat = Object.fromEntries(['p1', 'e1', 's1', 's2'].map(seatId => [seatId, []]));
  if (rescueSource) gearBySeat[rescueSeatByUnit[rescueSource]] = fourSet(`${rescueSource}-rescue`, 'rescue');
  if (lastStandTarget) gearBySeat.s1 = fourSet('p2-last', 'last_stand');
  const reveals = unitBySeat.map(([seatId, unitId]) => {
    const characterId = kt.unitById(unitId).character;
    current.seatCharacter[seatId] = characterId;
    current.seatVerified[seatId] = true;
    const trustedContext = wiring.trustedContext(seatId, characterId);
    const gears = gearBySeat[seatId];
    const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
    for (const gear of gears) slots[gear.slotId] = gear;
    const snapshot = snapshots.createBattleGearSnapshot({
      resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(gear => gear.gearId), slots },
      baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel
    });
    return Object.freeze({ trustedContext, revealedCommitment: onlineProtocol.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
  });
  const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  current.participantGearReveals = Object.fromEntries(reveals.map(entry => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  assert.equal(wiring.applyBattleStartState(wiring.createBattleStartState(manifest)), true);
  return current;
}

function healAlly(sourceUnitId = 'p1', targetUnitId = 'p2', baseHealing = 20) {
  const target = kt.unitById(targetUnitId);
  kt.setUnitHpForTest(targetUnitId, Math.max(1, target.maxHp - 40));
  return wiring.applyHealing(sourceUnitId, targetUnitId, baseHealing);
}

test('Rescue4 source grants canonical +1000 only after actual ally Healing through the production boundary', () => {
  install();
  const result = healAlly();
  assert.ok(result.actualHealing > 0);
  assert.equal(wiring.runtimeEffectsState().p2.rescueNextAttackDamageBp, 1000);
});

test('source without Rescue4, self-heal, enemy Healing, and zero actual Healing never grant Rescue runtime', () => {
  install({ rescueSource: false });
  assert.ok(healAlly().actualHealing > 0);
  assert.equal(wiring.runtimeEffectsState().p2.rescueNextAttackDamageBp, 0);

  install();
  const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp - 20);
  assert.ok(wiring.applyHealing('p1', 'p1', 20).actualHealing > 0);
  assert.equal(wiring.runtimeEffectsState().p1.rescueNextAttackDamageBp, 0);
  fails('ONLINE_GEAR_HEALING_EVENT_UNSUPPORTED', () => wiring.applyHealing('p1', 'e1', 20));
  assert.equal(wiring.runtimeEffectsState().e1.rescueNextAttackDamageBp, 0);

  const p2 = kt.unitById('p2');
  kt.setUnitHpForTest('p2', p2.maxHp);
  assert.equal(wiring.applyHealing('p1', 'p2', 20).actualHealing, 0);
  assert.equal(wiring.runtimeEffectsState().p2.rescueNextAttackDamageBp, 0);
});

test('existing generated self-heal and drain self-heal remain self support and cannot self-grant Rescue4', () => {
  install();
  const p1 = kt.unitById('p1');
  const e1 = kt.unitById('e1');
  kt.setUnitHpForTest('p1', p1.maxHp - 30);
  assert.ok(kt.launchGeneratedSelfHealForTest('p1', 20).actualHealing > 0);
  assert.equal(wiring.runtimeEffectsState().p1.rescueNextAttackDamageBp, 0);
  kt.setUnitHpForTest('p1', 1);
  const before = p1.hp;
  kt.explodeDrainAtForTest(e1.x, e1.y, 1, 'p1', { gearDamageProfile: 'excluded', directTargetId: 'e1', radius: 5 });
  assert.ok(p1.hp > before, 'existing drain still heals its owner from actual HP damage');
  assert.equal(wiring.runtimeEffectsState().p1.rescueNextAttackDamageBp, 0);
});

test('actualShield support contract grants without mutating Numeric Shield and zero Shield is inert', () => {
  install();
  const shieldBefore = wiring.shieldState();
  assert.equal(wiring.recordSupportEvent({ sourceUnitId: 'p1', targetUnitId: 'p2', actualShield: 5 }), true);
  assert.equal(wiring.runtimeEffectsState().p2.rescueNextAttackDamageBp, 1000);
  assert.deepEqual(wiring.shieldState(), shieldBefore, 'support boundary does not invent a Shield gain');
  assert.equal(wiring.recordSupportEvent({ sourceUnitId: 'p1', targetUnitId: 'p2', actualShield: 0 }), false);
});

test('repeat ally support refreshes +1000, composes with Last Stand, applies action-wide, then consumes together', () => {
  install({ lastStandTarget: true });
  const before = wiring.runtimeEffectsState();
  wiring.setRuntimeEffectsStateRawForTest(Object.freeze({
    ...before,
    p2: Object.freeze({ ...before.p2, lastStandNextAttackDamageBp: 1500 })
  }));
  assert.ok(healAlly().actualHealing > 0);
  assert.ok(healAlly().actualHealing > 0);
  assert.deepEqual(wiring.runtimeEffectsState().p2, { rescueNextAttackDamageBp: 1000, lastStandNextAttackDamageBp: 1500 });
  h.setActiveUnitForTest('p2');
  assert.equal(wiring.beginLastStandAttack('p2'), true);
  assert.equal(wiring.activeAttackRuntime().actionDamageBp, 2500);
  assert.equal(wiring.actionDamageRequested('p2', 100), 125);
  assert.equal(wiring.actionDamageRequested('p2', 40), 50, 'same action keeps the modifier for later hits');
  assert.equal(wiring.completeLastStandAttack('p2'), true);
  assert.deepEqual(wiring.runtimeEffectsState().p2, { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 });
});

test('all four 2v2 directions are team-symmetric and Gearless targets keep the same target-side contract', () => {
  for (const [sourceUnitId, targetUnitId] of [['p1', 'p2'], ['p2', 'p1'], ['e1', 'e2'], ['e2', 'e1']]) {
    install({ rescueSource: sourceUnitId });
    const granted = wiring.recordSupportEvent({ sourceUnitId, targetUnitId, actualHealing: 1 });
    assert.equal(granted, true, `${sourceUnitId} -> ${targetUnitId}`);
    assert.equal(wiring.runtimeEffectsState()[targetUnitId].rescueNextAttackDamageBp, 1000);
  }
});

test('Rescue4 stays out of start/fire/result, Rules, and Firebase wire while turn checkpoints own it', () => {
  install();
  assert.ok(healAlly().actualHealing > 0);
  const turnSnap = wiring.turnSnapshotForTest();
  assert.equal(turnSnap.gearRuntimeState.version, 3);
  assert.deepEqual(Object.keys(turnSnap.gearRuntimeState).sort(), ['matchFormat', 'runtimeEffectsByUnit', 'shieldByUnit', 'version']);
  assert.equal(turnSnap.gearRuntimeState.runtimeEffectsByUnit.p2.rescueNextAttackDamageBp, 1000);
  wiring.setRuntimeEffectsStateRawForTest(null);
  const restored = wiring.prepareRuntimeState(turnSnap);
  assert.equal(restored.runtimeEffectsStateByUnit.p2.rescueNextAttackDamageBp, 1000);
  wiring.setRuntimeEffectsStateRawForTest(restored.runtimeEffectsStateByUnit);
  wiring.setShieldStateRawForTest(restored.shieldStateByUnit);
  assert.equal(wiring.beginLastStandAttack('p2'), true);
  assert.equal(wiring.activeAttackRuntime().actionDamageBp, 1000);
  assert.equal(wiring.completeLastStandAttack('p2'), true);
  assert.equal(wiring.runtimeState().runtimeEffectsByUnit.p2.rescueNextAttackDamageBp, 0);
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const wire = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-firebase-wire.js'), 'utf8');
  assert.match(index, /function recordFirebaseOnlineGearSupportEvent\(/);
  assert.match(index, /actualHealing: healing\.actualHealing/);
  assert.doesNotMatch(wire, /rescueNextAttackDamageBp|actualShield|actualHealing/);
  assert.doesNotMatch(rules, /rescueNextAttackDamageBp|actualShield|actualHealing/);
});

console.log(`gear-online-battle-rescue4-phase3d7b2: ${passed}/7 passed`);
