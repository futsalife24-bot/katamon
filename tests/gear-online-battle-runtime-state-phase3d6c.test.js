const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const onlineProtocol = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const battleStart = require('../shared/gear-online-battle-start.js');
const runtime = require('../shared/gear-online-battle-runtime-state.js');
const harness = require('./seatharness.js');

const kt = harness.kt(); const h = kt.stage3(); const wiring = h.firebaseGearLobbyForTest();
const roomId = 'A2BC3DEF';
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
const cases = []; let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n?/g, '\n');
function fixture({ gear = true } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'playing', room: roomId,
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId,
    visibility: 'private', settingsAuthorityBlocked: false,
    settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, ...(gear ? { gearCapability: capability } : {}) },
    slots: { p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null,
    queue: [], pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu', peerCharacter: 'iwa', localAction: null, remoteAction: null
  };
}
function gear(prefix, slotId) {
  return domain.createGear({ gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:g`, enhancementSeed: `${prefix}:e`, sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z', qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: 'life', setWeights: [{ id: 'life', weight: 1 }] }, slotId });
}
function reveal(seat, characterId, gears = []) {
  const ctx = wiring.trustedContext(seat, characterId); const slots = Object.fromEntries(domain.SLOT_IDS.map(id => [id, null]));
  for (const item of gears) slots[item.slotId] = item;
  const snapshot = battleSnapshot.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: ctx.baseHp, baseFuel: ctx.baseFuel });
  return Object.freeze({ trustedContext: ctx, revealedCommitment: onlineProtocol.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext: ctx }) });
}
function install({ p1 = [], e1 = [], gearOn = true } = {}) {
  const online = fixture({ gear: gearOn }); h.setOnlineForLogTest(online); kt.setMatchFormatForTest('1v1'); kt.setCharactersForTest('kyoryu', 'iwa'); h.resetMatchForTest(); kt.setCharactersForTest('kyoryu', 'iwa');
  if (!gearOn) { wiring.applyBattleStartState(null); return online; }
  const reveals = [reveal('p1', 'kyoryu', p1), reveal('e1', 'iwa', e1)];
  const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(value => value.revealedCommitment), participantReveals: reveals });
  online.participantGearReveals = Object.fromEntries(reveals.map(value => [value.revealedCommitment.seatId, value])); online.verifiedStartGearManifest = manifest;
  wiring.applyBattleStartState(battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals }));
  return online;
}
const life4 = prefix => ['barrel', 'armor', 'core', 'engine'].map(slot => gear(prefix, slot));
const remoteActionId = 'a'.repeat(48);
function remoteFire(actionId = remoteActionId) {
  return {
    v: 3, from: 'uid-e1', seat: 'e1', roundId, t: 'fire', sentAt: 1,
    actionId, unitId: 'e1', x: 1224, y: 512, anchor: { x: 1224, y: 512 },
    vx0: -320, vy0: -460, useSpecial: false, useJump: false
  };
}
function remoteState(snap, actionId = remoteActionId, stateRoundId = roundId) {
  return { v: 3, from: 'uid-e1', seat: 'e1', roundId: stateRoundId, t: 'state', sentAt: 2, actionId, unitId: 'e1', snap };
}
function setRemoteTurnAndBuildTerminalSnapshot() {
  assert.equal(h.setUnitControlForTest('p1', 'local'), true); assert.equal(h.setUnitControlForTest('e1', 'remote'), true);
  const local = kt.snapshot(); local.activeIndex = local.turnOrder.indexOf('e1'); kt.applySnapshotForTest(local);
  const terminal = wiring.turnSnapshotForTest(); terminal.activeIndex = terminal.turnOrder.indexOf('p1');
  const remote = terminal.units.find(unit => unit.id === 'e1'); remote.x = 1224; remote.y = 512;
  for (const key of ['segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey', 'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments', 'customStage', 'customStageIdentity']) delete terminal[key];
  return terminal;
}

test('pure v1 runtime state is exact, frozen, p1/e1-only and validates canonical caps', () => {
  install({ p1: life4('p1') }); const snapshots = wiring.battleSnapshotsForRuntimeTest();
  const state = wiring.runtimeState(); assert.equal(state.version, 1); assert.deepEqual(Object.keys(state.shieldByUnit), ['p1', 'e1']);
  assert.equal(Object.isFrozen(runtime.validateRuntimeState(state, { snapshots })), true);
  const bad = structuredClone(state); bad.shieldByUnit.p1.currentShield = -1;
  assert.throws(() => runtime.validateRuntimeState(bad, { snapshots }), error => error?.code === 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
  const future = structuredClone(state); future.version = 2;
  assert.throws(() => runtime.validateRuntimeState(future, { snapshots }), error => error?.code === 'UNSUPPORTED_ONLINE_GEAR_RUNTIME_STATE');
});

test('Gearless Gear ON serializes explicit zero runtime Shield while Gear OFF keeps the legacy state shape', () => {
  install(); assert.deepEqual(wiring.runtimeState().shieldByUnit, { p1: { currentShield: 0 }, e1: { currentShield: 0 } });
  install({ gearOn: false }); assert.equal(wiring.runtimeState(), null); assert.equal(Object.hasOwn(wiring.turnSnapshotForTest(), 'gearRuntimeState'), false);
});

test('outgoing turn snapshot carries only current Shield runtime state, never start/fire state', () => {
  install({ p1: life4('outgoing') }); wiring.setShieldForTest('p1', 3.5); const snap = wiring.turnSnapshotForTest();
  assert.equal(snap.gearRuntimeState.shieldByUnit.p1.currentShield, 3.5);
  assert.equal(Object.hasOwn(wiring.buildStartEnvelope ? wiring.buildStartEnvelope() : {}, 'gearRuntimeState'), false);
  const index = read('index.html');
  assert.match(index, /const runtimeState = createFirebaseOnlineGearRuntimeState\(\);[\s\S]*snap\.gearRuntimeState = runtimeState/);
  assert.match(index, /start\.gearRuntimeStateUnexpected/); assert.doesNotMatch(index, /t: 'fire'[\s\S]{0,500}gearRuntimeState/);
});

test('accepted-state preparation restores null local Shield and permits only monotonic decreases', () => {
  install({ p1: life4('recovery') }); wiring.setShieldForTest('p1', 4); const incoming = wiring.turnSnapshotForTest(); incoming.gearRuntimeState.shieldByUnit.p1.currentShield = 2;
  wiring.setShieldStateRawForTest(null); const restored = wiring.prepareRuntimeState(incoming); assert.equal(restored.p1.currentShield, 2);
  wiring.setShieldStateRawForTest(restored); assert.equal(wiring.prepareRuntimeState(incoming).p1.currentShield, 2);
  incoming.gearRuntimeState.shieldByUnit.p1.currentShield = 3;
  assert.throws(() => wiring.prepareRuntimeState(incoming), error => error?.code === 'ONLINE_GEAR_RUNTIME_STATE_ROLLBACK');
});

test('recovery cannot mint Shield: Gearless accepts only zero and Life4 accepts only its canonical initial remainder', () => {
  install(); const gearlessSnapshots = wiring.battleSnapshotsForRuntimeTest(); const forgedGearless = wiring.runtimeState();
  wiring.setShieldStateRawForTest(null); forgedGearless.shieldByUnit.p1.currentShield = 0.1;
  assert.throws(() => runtime.restoreShieldState(forgedGearless, { snapshots: gearlessSnapshots, localState: null }), error => error?.code === 'INVALID_ONLINE_GEAR_RUNTIME_STATE');

  install({ p1: life4('upper') }); const snapshots = wiring.battleSnapshotsForRuntimeTest(); const legal = wiring.runtimeState();
  const initial = require('../shared/gear-combat.js').initialShieldFromSets(snapshots.p1.derivedStats).shieldAfter;
  assert.ok(initial < require('../shared/gear-combat.js').initialShieldFromSets(snapshots.p1.derivedStats).cap, 'fixture distinguishes initial Shield from generic cap');
  wiring.setShieldStateRawForTest(null); legal.shieldByUnit.p1.currentShield = initial;
  assert.equal(runtime.restoreShieldState(legal, { snapshots, localState: null }).p1.currentShield, initial);
  legal.shieldByUnit.p1.currentShield = initial + 0.1;
  assert.throws(() => runtime.restoreShieldState(legal, { snapshots, localState: null }), error => error?.code === 'INVALID_ONLINE_GEAR_RUNTIME_STATE');
});

test('production receive flow buffers early state and restores Shield only after matching fire resolves', () => {
  install({ p1: life4('receive') }); wiring.setShieldForTest('p1', 4); const snap = setRemoteTurnAndBuildTerminalSnapshot();
  snap.gearRuntimeState.shieldByUnit.p1.currentShield = 2;
  const before = wiring.state(); h.receiveFirebaseForTest(remoteState(snap));
  assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 4, 'early state must not mutate Shield');
  assert.equal(wiring.state().pendingRemoteTerminals, undefined, 'state observation stays intentionally narrow');
  h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 4, 'fire acceptance alone must not restore Shield');
  assert.equal(h.resolveRemoteActionForTest(), true, 'accepted fire must establish the remote action'); assert.equal(h.drainOneNetworkMessageForTest(), true);
  assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 2, wiring.state().protocolError || 'only accepted terminal commits Shield');
  assert.equal(wiring.state().protocolError, ''); assert.notDeepEqual(wiring.state().battleGearShieldStateByUnit, before.battleGearShieldStateByUnit);
});

test('production accepted state restores a null local Shield but rejects forged Gearless or over-initial remainders', () => {
  install({ p1: life4('null-recovery') }); wiring.setShieldForTest('p1', 4); const valid = setRemoteTurnAndBuildTerminalSnapshot();
  valid.gearRuntimeState.shieldByUnit.p1.currentShield = 2; wiring.setShieldStateRawForTest(null);
  h.receiveFirebaseForTest(remoteState(valid)); h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(h.resolveRemoteActionForTest(), true); assert.equal(h.drainOneNetworkMessageForTest(), true);
  assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 2, 'accepted state restores missing local runtime only at the terminal');

  install(); const forgedGearless = setRemoteTurnAndBuildTerminalSnapshot(); forgedGearless.gearRuntimeState.shieldByUnit.p1.currentShield = 1;
  wiring.setShieldStateRawForTest(null); h.receiveFirebaseForTest(remoteState(forgedGearless)); h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(h.resolveRemoteActionForTest(), true); assert.equal(h.drainOneNetworkMessageForTest(), true);
  assert.equal(wiring.state().battleGearShieldStateByUnit, null, 'Gearless recovery cannot mint Shield');

  install({ p1: life4('over-initial') }); const overInitial = setRemoteTurnAndBuildTerminalSnapshot();
  const initial = require('../shared/gear-combat.js').initialShieldFromSets(wiring.battleSnapshotsForRuntimeTest().p1.derivedStats).shieldAfter;
  overInitial.gearRuntimeState.shieldByUnit.p1.currentShield = initial + 0.1; wiring.setShieldStateRawForTest(null);
  h.receiveFirebaseForTest(remoteState(overInitial)); h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(h.resolveRemoteActionForTest(), true); assert.equal(h.drainOneNetworkMessageForTest(), true);
  assert.equal(wiring.state().battleGearShieldStateByUnit, null, 'recovery rejects an amount above canonical initial Shield');
});

test('production terminal rejection is atomic for wrong action, round and malformed runtime state', () => {
  install({ p1: life4('atomic') }); wiring.setShieldForTest('p1', 4); const before = wiring.state(); const valid = setRemoteTurnAndBuildTerminalSnapshot();
  const wrongAction = structuredClone(valid); wrongAction.gearRuntimeState.shieldByUnit.p1.currentShield = 2;
  h.receiveFirebaseForTest(remoteState(wrongAction, 'b'.repeat(48))); h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(h.resolveRemoteActionForTest(), true);
  assert.equal(h.drainOneNetworkMessageForTest(), false, 'wrong action terminal is rejected before state apply');
  assert.deepEqual(wiring.state().battleGearShieldStateByUnit, before.battleGearShieldStateByUnit);

  install({ p1: life4('atomic-round') }); wiring.setShieldForTest('p1', 4); const stale = setRemoteTurnAndBuildTerminalSnapshot(); stale.gearRuntimeState.shieldByUnit.p1.currentShield = 2;
  h.receiveFirebaseForTest(remoteState(stale, remoteActionId, 'f'.repeat(48)));
  assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 4, 'wrong round is ignored before Shield mutation');

  install({ p1: life4('atomic-invalid') }); wiring.setShieldForTest('p1', 4); const malformed = setRemoteTurnAndBuildTerminalSnapshot(); malformed.gearRuntimeState.version = 2;
  h.receiveFirebaseForTest(remoteState(malformed)); h.receiveFirebaseForTest(remoteFire());
  assert.equal(h.drainOneNetworkMessageForTest(), true); assert.equal(h.resolveRemoteActionForTest(), true);
  assert.equal(h.drainOneNetworkMessageForTest(), true);
  assert.equal(wiring.state().battleGearShieldStateByUnit.p1.currentShield, 4, 'invalid runtime cannot partially commit Shield');
});

test('runtime state survives JSON/RTDB normalization and preserves explicit zeroes', () => {
  install(); const snap = wiring.turnSnapshotForTest(); const roundTrip = JSON.parse(JSON.stringify(snap));
  const normalized = h.normalizeFirebaseSnapshot(roundTrip);
  assert.deepEqual(normalized.gearRuntimeState, snap.gearRuntimeState);
  assert.equal(normalized.gearRuntimeState.shieldByUnit.p1.currentShield, 0);
  assert.equal(h.stableFirebaseJson(normalized.gearRuntimeState), h.stableFirebaseJson(snap.gearRuntimeState));
});

test('runtime state stays out of Battle Gear Snapshot, Healing, result and persistent storage', () => {
  install({ p1: life4('isolation') }); const state = wiring.state();
  assert.equal(Object.hasOwn(state.battleGearSnapshotsByUnit.p1, 'currentShield'), false);
  const index = read('index.html'); const rules = read('database.rules.json');
  assert.doesNotMatch(index, /gearRuntimeState[\s\S]{0,200}t: 'result'/); assert.doesNotMatch(index, /(?:requestedHealing|actualHealing).*gearRuntimeState/);
  assert.doesNotMatch(rules, /gearRuntimeState/);
});

test('manifest v2 fences old Gear clients while core protocol, snapshot and Firebase wire stay v1', () => {
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 3); assert.equal(onlineProtocol.ONLINE_GEAR_PROTOCOL_VERSION, 1);
  assert.equal(battleSnapshot.GEAR_BATTLE_SNAPSHOT_VERSION, 1); assert.equal(require('../shared/gear-online-firebase-wire.js').ONLINE_GEAR_FIREBASE_WIRE_VERSION, 1);
  install(); const manifest = wiring.state().verifiedStartGearManifest; const old = structuredClone(manifest); old.version = 1;
  assert.throws(() => lobby.validateStartGearManifest(old, { participantReveals: Object.values(wiring.state().participantGearReveals) }), error => error?.code === 'INVALID_ONLINE_GEAR_START_MANIFEST');
});

test('source contract keeps accepted-state commit after applySnapshot and leaves CPU/2v2/RNG untouched', () => {
  const index = read('index.html'); const sw = read('sw.js');
  assert.match(index, /applySnapshot\(msg\.snap, \{ preserveTerrain: true \}\);\s*if \(online\.kind === 'firebase' && acceptedGearRuntimeState\)/);
  assert.match(index, /ONLINE_GEAR_2V2_BATTLE_UNSUPPORTED/); assert.match(sw, /gear-online-battle-runtime-state\.js/);
  assert.doesNotMatch(index, /localStorage[\s\S]{0,120}gearRuntimeState/);
});

for (const [name, fn] of cases) {
  h.setOnlineForLogTest(null);
  try { fn(); passed += 1; console.log(`  ok ${name}`); }
  finally { h.setOnlineForLogTest(null); kt.setMatchFormatForTest('1v1'); localStorage.clear(); }
}
console.log(`gear-online-battle-runtime-state-phase3d6c: ${passed}/${cases.length} passed`);
