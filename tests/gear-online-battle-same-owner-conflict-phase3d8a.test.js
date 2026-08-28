const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const snapshots = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const start = require('../shared/gear-online-battle-start.js');
const wire = require('../shared/gear-online-firebase-wire.js');
const harness = require('./seatharness.js');

const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const seats = Object.freeze([['p1', 'p1'], ['e1', 'e1'], ['s1', 'p2'], ['s2', 'e2']]);
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok ${name}`); };
const fails = (code, fn) => assert.throws(fn, error => error?.code === code);

function gear(gearId, slotId = 'barrel') {
  return domain.createGear({ gearId, generationSeed: `${gearId}:g`, enhancementSeed: `${gearId}:e`, sourceId: 'cpu_battle', sourceDetail: {}, acquiredAt: '2026-08-28T00:00:00Z', qualityProfile: { id: 'q', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: 'life', setWeights: [{ id: 'life', weight: 1 }] }, slotId });
}
function context(seatId, unitId, ownerUid) { return { expectedOwnerUid: ownerUid, expectedSeatId: seatId, expectedUnitId: unitId, expectedCharacterId: 'kyoryu', expectedRoundId: roundId, baseHp: 100, baseFuel: 50 }; }
function reveal(seatId, unitId, ownerUid, gears = []) {
  const trustedContext = context(seatId, unitId, ownerUid); const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null]));
  gears.forEach(item => { slots[item.slotId] = item; });
  const snapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId: 'kyoryu', presetId: 'preset1', gearIds: gears.map(item => item.gearId), slots }, baseHp: 100, baseFuel: 50 });
  return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
}
function stateFor({ owners = {}, gearsBySeat = {}, matchFormat = '2v2' } = {}) {
  const selectedSeats = matchFormat === '1v1' ? seats.slice(0, 2) : seats;
  const reveals = selectedSeats.map(([seatId, unitId]) => reveal(seatId, unitId, owners[seatId] || `uid-${seatId}`, gearsBySeat[seatId] || []));
  const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals });
  return { reveals, manifest, state: start.createOnlineGearBattleStartState({ matchFormat, manifest, participantReveals: reveals }) };
}

test('owner-scoped resolver accepts Gearless and distinct physical Gear loadouts, including matching IDs across owners', () => {
  const shared = { p1: 'owner-a', s1: 'owner-a' };
  assert.equal(stateFor({ owners: shared }).state.matchFormat, '2v2');
  assert.equal(stateFor({ owners: shared, gearsBySeat: { p1: [gear('a-1')], s1: [gear('a-2')] } }).state.matchFormat, '2v2');
  assert.equal(stateFor({ owners: { p1: 'owner-a', s1: 'owner-b' }, gearsBySeat: { p1: [gear('same-id')], s1: [gear('same-id')] } }).state.matchFormat, '2v2');
});

test('owner-scoped resolver rejects only a repeated physical Gear and preserves conflict identity', () => {
  const sharedGear = gear('owner-a:shared'); const input = { owners: { p1: 'owner-a', s1: 'owner-a' }, gearsBySeat: { p1: [sharedGear], s1: [sharedGear] } };
  assert.throws(() => stateFor(input), error => {
    assert.equal(error?.code, 'ONLINE_GEAR_2V2_SAME_OWNER_GEAR_CONFLICT');
    assert.deepEqual(error.detail, { gearId: 'owner-a:shared', firstCharacterId: 'kyoryu', firstPresetId: 'preset1', secondCharacterId: 'kyoryu', secondPresetId: 'preset1' });
    assert.equal(error.cause?.code, 'SIMULTANEOUS_GEAR_CONFLICT'); return true;
  });
});

test('three and four same-owner units are checked as one owner group while 1v1 remains unchanged', () => {
  const allOwner = { p1: 'owner-a', e1: 'owner-a', s1: 'owner-a', s2: 'owner-a' };
  assert.equal(stateFor({ owners: allOwner, gearsBySeat: { p1: [gear('one')], e1: [gear('two')], s1: [gear('three')], s2: [gear('four')] } }).state.matchFormat, '2v2');
  fails('ONLINE_GEAR_2V2_SAME_OWNER_GEAR_CONFLICT', () => stateFor({ owners: allOwner, gearsBySeat: { p1: [gear('repeat')], e1: [gear('two')], s1: [gear('repeat')], s2: [gear('four')] } }));
  assert.equal(stateFor({ owners: { p1: 'owner-a', e1: 'owner-a' }, gearsBySeat: { p1: [gear('legacy-repeat')], e1: [gear('legacy-repeat')] }, matchFormat: '1v1' }).state.matchFormat, '1v1');
});

test('production Firebase 2v2 start accepts same-owner distinct Gear and rejects a conflict before Battle mutation', () => {
  const kt = harness.kt(); const h = kt.stage3(); const wiring = h.firebaseGearLobbyForTest(); kt.setMatchFormatForTest('2v2'); h.setTurnOrderForTest(['p1', 'e1', 'p2', 'e2']);
  for (const unitId of ['p1', 'e1', 'p2', 'e2']) kt.setCharacterForUnitForTest(unitId, 'kyoryu');
  const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: online.GEAR_MODE_PRIVATE_TRUSTED_V1 });
  const current = { kind: 'firebase', role: 'host', participantRole: 'player', phase: 'playing', room: 'A2BC3DEF', auth: { uid: 'owner-a', idToken: 'test-token' }, clientId: 'owner-a', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false, settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '2v2', stageSize: 'standard', revision: 1, gearCapability: capability }, slots: { p1: { uid: 'owner-a', claimedAt: 1 }, e1: { uid: 'owner-e1', claimedAt: 1 }, s1: { uid: 'owner-a', claimedAt: 1 }, s2: { uid: 'owner-e2', claimedAt: 1 } }, participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null, battleGearRuntimeEffectsStateByUnit: null, queue: [], pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), seatCharacter: {}, seatVerified: {}, selfCharacter: 'kyoryu', localAction: null, remoteAction: null };
  h.setOnlineForLogTest(current);
  const build = (sameGear) => {
    const gearBySeat = { p1: [gear('production-p1')], e1: [], s1: [gear(sameGear ? 'production-p1' : 'production-p2')], s2: [] };
    const reveals = seats.map(([seatId, unitId]) => {
      current.seatCharacter[seatId] = 'kyoryu'; current.seatVerified[seatId] = true; const trustedContext = wiring.trustedContext(seatId, 'kyoryu'); const items = gearBySeat[seatId]; const slots = Object.fromEntries(domain.SLOT_IDS.map(slotId => [slotId, null])); items.forEach(item => { slots[item.slotId] = item; });
      const snapshot = snapshots.createBattleGearSnapshot({ resolvedLoadout: { characterId: 'kyoryu', presetId: 'preset1', gearIds: items.map(item => item.gearId), slots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
      return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext }) });
    });
    const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map(entry => entry.revealedCommitment), participantReveals: reveals }); current.participantGearReveals = Object.fromEntries(reveals.map(entry => [entry.revealedCommitment.seatId, entry])); current.verifiedStartGearManifest = manifest; return manifest;
  };
  const accepted = wiring.createBattleStartState(build(false)); assert.equal(wiring.applyBattleStartState(accepted), true); assert.deepEqual(Object.keys(wiring.battleSnapshotsForRuntimeTest()).sort(), ['e1', 'e2', 'p1', 'p2']);
  const before = kt.snapshot(); fails('ONLINE_GEAR_2V2_SAME_OWNER_GEAR_CONFLICT', () => wiring.createBattleStartState(build(true))); assert.deepEqual(kt.snapshot(), before, 'conflict rejects before HP/Fuel or runtime mutation');
});

test('manifest v6 fences v5 while core, snapshot and Firebase wire remain unchanged', () => {
  const { reveals, manifest } = stateFor(); const previous = structuredClone(manifest); previous.version = 4; fails('INVALID_ONLINE_GEAR_START_MANIFEST', () => lobby.validateStartGearManifest(previous, { participantReveals: reveals }));
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 6); assert.equal(online.ONLINE_GEAR_PROTOCOL_VERSION, 1); assert.equal(snapshots.GEAR_BATTLE_SNAPSHOT_VERSION, 1); assert.equal(wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, 1);
});

console.log(`gear-online-battle-same-owner-conflict-phase3d8a: ${passed}/5 passed`);
