const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const start = require('../shared/gear-online-battle-start.js');
const runtime = require('../shared/gear-online-battle-runtime-state.js');
const harness = require('./seatharness.js');

const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);
const kt = harness.kt(); const h = kt.stage3(); const wiring = h.firebaseGearLobbyForTest();

function gear(prefix, setId, slotId) {
  return domain.createGear({ gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`, sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z', qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: setId, setWeights: [{ id: setId, weight: 1 }] }, slotId });
}
const fourSet = (prefix, setId) => ['barrel', 'armor', 'core', 'engine'].map(slotId => gear(prefix, setId, slotId));
function fixture() {
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: online.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  return { kind: 'firebase', role: 'host', participantRole: 'player', phase: 'playing', room: 'A2BC3DEF', auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false, settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, gearCapability: capability }, slots: { p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null }, participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null, queue: [], pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu', peerCharacter: 'iwa', localAction: null, remoteAction: null };
}
function install({ p1 = [], e1 = [] } = {}) {
  const current = fixture(); h.setOnlineForLogTest(current); kt.setMatchFormatForTest('1v1'); kt.setCharactersForTest('kyoryu', 'iwa'); h.resetMatchForTest(); kt.setCharactersForTest('kyoryu', 'iwa');
  const reveal = (seat, characterId, gears) => {
    const trustedContext = wiring.trustedContext(seat, characterId); const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null])); gears.forEach(item => { slots[item.slotId] = item; });
    const snapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
    return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
  };
  const reveals = [reveal('p1', 'kyoryu', p1), reveal('e1', 'iwa', e1)]; const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  current.participantGearReveals = Object.fromEntries(reveals.map(entry => [entry.revealedCommitment.seatId, entry])); current.verifiedStartGearManifest = manifest;
  assert.equal(wiring.applyBattleStartState(start.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals })), true);
}

test('v3 has exact Shield and next-action effect maps, rejects v2, format/unit mismatches, and active fields', () => {
  install({ p1: fourSet('last', 'last_stand') }); const state = wiring.runtimeState(); const snapshotsByUnit = wiring.battleSnapshotsForRuntimeTest();
  assert.deepEqual(Object.keys(state).sort(), ['matchFormat', 'runtimeEffectsByUnit', 'shieldByUnit', 'version']); assert.equal(state.version, 3);
  assert.deepEqual(state.runtimeEffectsByUnit, { p1: { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 }, e1: { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 } });
  const v2 = structuredClone(state); v2.version = 2; fails('UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(v2, { snapshots: snapshotsByUnit }));
  const extra = structuredClone(state); extra.activeAction = {}; fails('INVALID_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(extra, { snapshots: snapshotsByUnit }));
  const missing = structuredClone(state); delete missing.runtimeEffectsByUnit.e1; fails('INVALID_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(missing, { snapshots: snapshotsByUnit }));
});

test('canonical Last Stand and target-side Rescue values restore separately, while invalid ownership values fail closed', () => {
  install({ p1: fourSet('last', 'last_stand') }); const snapshotsByUnit = wiring.battleSnapshotsForRuntimeTest(); const state = wiring.runtimeState();
  state.runtimeEffectsByUnit.p1.lastStandNextAttackDamageBp = 1500; state.runtimeEffectsByUnit.e1.rescueNextAttackDamageBp = 1000;
  const restored = runtime.restoreRuntimeState(state, { snapshots: snapshotsByUnit, expectedMatchFormat: '1v1' });
  assert.deepEqual(restored.runtimeEffectsStateByUnit.p1, { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 1500 });
  assert.deepEqual(restored.runtimeEffectsStateByUnit.e1, { rescueNextAttackDamageBp: 1000, lastStandNextAttackDamageBp: 0 });
  const invalid = structuredClone(state); invalid.runtimeEffectsByUnit.e1.lastStandNextAttackDamageBp = 1500;
  fails('INVALID_RUNTIME_EFFECTS_STATE', () => runtime.validateRuntimeState(invalid, { snapshots: snapshotsByUnit }));
});

test('production Last Stand checkpoint restores only from a null local effect state and consumes to explicit zeroes', () => {
  install({ p1: fourSet('last', 'last_stand') });
  kt.setUnitHpForTest('p1', kt.unitById('p1').maxHp * .5);
  wiring.recordLastStandDamage({ ownerId: 'e1', target: kt.unitById('p1'), actualDamage: 1, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  const checkpoint = wiring.runtimeState(); assert.equal(checkpoint.runtimeEffectsByUnit.p1.lastStandNextAttackDamageBp, 1500);
  wiring.setRuntimeEffectsStateRawForTest(null); const restored = wiring.prepareRuntimeState({ gearRuntimeState: checkpoint });
  assert.equal(restored.runtimeEffectsStateByUnit.p1.lastStandNextAttackDamageBp, 1500);
  wiring.setRuntimeEffectsStateRawForTest(restored.runtimeEffectsStateByUnit); wiring.setShieldStateRawForTest(restored.shieldStateByUnit);
  assert.equal(wiring.beginLastStandAttack('p1'), true); assert.equal(wiring.activeAttackRuntime().actionDamageBp, 1500); assert.equal(wiring.completeLastStandAttack('p1'), true);
  assert.deepEqual(wiring.runtimeState().runtimeEffectsByUnit.p1, { rescueNextAttackDamageBp: 0, lastStandNextAttackDamageBp: 0 });
});

test('live local effects must exactly match an incoming checkpoint, and null state restores without Shield mutation', () => {
  install({ p1: fourSet('last', 'last_stand') }); const checkpoint = wiring.runtimeState(); const beforeShield = wiring.shieldState();
  const mismatch = structuredClone(checkpoint); mismatch.runtimeEffectsByUnit.p1.lastStandNextAttackDamageBp = 1500;
  fails('ONLINE_GEAR_RUNTIME_EFFECTS_MISMATCH', () => wiring.prepareRuntimeState({ gearRuntimeState: mismatch })); assert.deepEqual(wiring.shieldState(), beforeShield);
  wiring.setRuntimeEffectsStateRawForTest(null); assert.deepEqual(wiring.prepareRuntimeState({ gearRuntimeState: checkpoint }).runtimeEffectsStateByUnit, checkpoint.runtimeEffectsByUnit);
});

test('checkpoint remains turn-state-only: Gear OFF, start, fire, result and Battle Snapshot receive no runtime field', () => {
  install(); const snap = wiring.turnSnapshotForTest(); assert.equal(snap.gearRuntimeState.version, 3); assert.equal(Object.hasOwn(wiring.state().battleGearSnapshotsByUnit.p1, 'runtimeEffectsByUnit'), false);
  const index = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
  assert.match(index, /start\.gearRuntimeStateUnexpected/); assert.doesNotMatch(index, /t: 'fire'[\s\S]{0,500}gearRuntimeState/); assert.doesNotMatch(index, /t: 'result'[\s\S]{0,500}gearRuntimeState/);
});

console.log(`gear-online-battle-runtime-checkpoint-phase3d8b1: ${passed}/5 passed`);
