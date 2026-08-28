const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const start = require('../shared/gear-online-battle-start.js');
const runtime = require('../shared/gear-online-battle-runtime-state.js');
const rng = require('../shared/gear-online-battle-rng.js');

const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);

function context(seatId, unitId, ownerUid = `uid-${seatId}`) {
  return { expectedOwnerUid: ownerUid, expectedSeatId: seatId, expectedUnitId: unitId,
    expectedCharacterId: 'kyoryu', expectedRoundId: roundId, baseHp: 100, baseFuel: 50 };
}
function reveal(seatId, unitId, ownerUid) {
  const trustedContext = context(seatId, unitId, ownerUid);
  const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
  const snapshot = snapshots.createBattleGearSnapshot({
    resolvedLoadout: { characterId: 'kyoryu', presetId: 'preset1', gearIds: [], slots },
    baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel
  });
  return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
}
function fourReveals(ownerBySeat = {}) {
  return [['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]
    .map(([seatId, unitId]) => reveal(seatId, unitId, ownerBySeat[seatId]));
}
function stateFor(reveals) {
  const manifest = lobby.createStartGearManifest({
    roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals
  });
  return start.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest, participantReveals: reveals });
}

test('2v2 Battle Start reconstructs exactly p1/e1/p2/e2 from the canonical seat map', () => {
  const state = stateFor(fourReveals());
  assert.equal(state.matchFormat, '2v2');
  assert.deepEqual(Object.keys(state.battleGearSnapshotsByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.deepEqual(Object.keys(state.hpFuelByUnit).sort(), ['e1', 'e2', 'p1', 'p2']);
  assert.equal(Object.isFrozen(state), true);
  for (const unitId of ['p1', 'e1', 'p2', 'e2']) {
    assert.equal(state.hpFuelByUnit[unitId].hp, 100);
    assert.equal(state.hpFuelByUnit[unitId].fuel, 50);
    assert.equal(Object.isFrozen(state.battleGearSnapshotsByUnit[unitId]), true);
  }
});

test('2v2 Start rejects incomplete, non-canonical, and same-owner participant sets', () => {
  const complete = fourReveals();
  const manifest = lobby.createStartGearManifest({ roundId, commitments: complete.map(entry => entry.revealedCommitment), participantReveals: complete });
  const incomplete = complete.slice(0, 3);
  const incompleteManifest = lobby.createStartGearManifest({ roundId, commitments: incomplete.map(entry => entry.revealedCommitment), participantReveals: incomplete });
  fails('MISSING_ONLINE_GEAR_BATTLE_REVEAL', () => start.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest: incompleteManifest, participantReveals: incomplete }));
  const sharedOwner = fourReveals({ p1: 'uid-shared', s1: 'uid-shared' });
  fails('ONLINE_GEAR_2V2_SAME_OWNER_UNSUPPORTED', () => stateFor(sharedOwner));
});

test('runtime Shield v2 is exact per match format and rejects v1 or a p2/e2 key mismatch', () => {
  const state = stateFor(fourReveals());
  const shieldState = Object.fromEntries(['p1', 'e1', 'p2', 'e2'].map(unitId => [unitId, { currentShield: 0 }]));
  const valid = runtime.createRuntimeState({ shieldStateByUnit: shieldState, snapshots: state.battleGearSnapshotsByUnit, matchFormat: '2v2' });
  assert.deepEqual(valid, { version: 2, matchFormat: '2v2', shieldByUnit: shieldState });
  assert.equal(Object.isFrozen(valid), true);
  const old = structuredClone(valid); old.version = 1;
  fails('UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(old, { snapshots: state.battleGearSnapshotsByUnit }));
  const mismatched = structuredClone(valid); delete mismatched.shieldByUnit.e2;
  fails('INVALID_ONLINE_GEAR_RUNTIME_STATE', () => runtime.validateRuntimeState(mismatched, { snapshots: state.battleGearSnapshotsByUnit }));
});

test('p2/e2 use the established deterministic RNG identity without changing the 1v1 Crit fixture', () => {
  const action = rng.createOnlineGearActionIdentity({ version: 1, roomId: 'A2BC3DEF', roundId, turnOrdinal: 7, sourceUnitId: 'p2' });
  const crit = rng.createCritRollIdentity({ actionIdentity: action, targetUnitId: 'e2', damageType: 'direct_projectile', hitOrdinal: 0 });
  assert.equal(rng.rollBasisPoints(crit), rng.rollBasisPoints(structuredClone(crit)));
  const legacyAction = rng.createOnlineGearActionIdentity({ version: 1, roomId: 'A2BC3DEF', roundId, turnOrdinal: 7, sourceUnitId: 'p1' });
  assert.equal(rng.rollBasisPoints(rng.createCritRollIdentity({ actionIdentity: legacyAction, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0 })), 5220);
});

test('2v2 source boundaries are format-aware while Rescue remains inert and legacy wire versions stay unchanged', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const stateModule = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-runtime-state.js'), 'utf8');
  assert.match(index, /function firebaseOnlineGearBattleUnitIds\(/);
  assert.match(index, /rescueNextAttackDamageBp !== 0/);
  assert.match(stateModule, /ONLINE_GEAR_RUNTIME_STATE_VERSION = 2/);
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 4);
  assert.equal(online.ONLINE_GEAR_PROTOCOL_VERSION, 1);
  assert.equal(snapshots.GEAR_BATTLE_SNAPSHOT_VERSION, 1);
  assert.equal(require('../shared/gear-online-firebase-wire.js').ONLINE_GEAR_FIREBASE_WIRE_VERSION, 1);
});

console.log(`gear-online-battle-2v2-foundation-phase3d7b1: ${passed}/5 passed`);
