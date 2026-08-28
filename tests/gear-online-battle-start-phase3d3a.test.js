const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const protocol = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const battleStart = require('../shared/gear-online-battle-start.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const slotIds = domain.SLOT_IDS;
const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: protocol.GEAR_MODE_PRIVATE_TRUSTED_V1 });
let passed = 0;
const cases = [];
const test = (name, fn) => { cases.push([name, fn]); };
const clone = (value) => JSON.parse(JSON.stringify(value));

function onlineFixture({ format = '1v1', gear = true } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'lobby', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1,
      ...(gear ? { gearCapability: capability } : {})
    },
    slots: {
      p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 },
      s1: null, s2: null
    },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu'
  };
}

function makeGear(gearId, slotId, requiredMainOp = null) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const gear = domain.createGear({
      gearId,
      generationSeed: `3d3a:${gearId}:${attempt}`,
      enhancementSeed: `3d3a:${gearId}:enhancement`,
      sourceId: 'cpu_battle', sourceDetail: { fixture: '3d3a' }, acquiredAt: '2026-08-27T00:00:00Z',
      qualityProfile: { id: '3d3a-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: '3d3a-set', setWeights: [{ id: 'life', weight: 1 }] },
      slotId
    });
    if (requiredMainOp === null || gear.mainOp.opId === requiredMainOp) return gear;
  }
  throw new Error(`could not create ${slotId}/${requiredMainOp}`);
}

function createReveal(seat, characterId, gears = [], presetId = 'preset1') {
  const trustedContext = wiring.trustedContext(seat, characterId);
  const slots = Object.fromEntries(slotIds.map((slotId) => [slotId, null]));
  for (const gear of gears) slots[gear.slotId] = gear;
  const snapshot = battleSnapshot.createBattleGearSnapshot({
    resolvedLoadout: { characterId, presetId, gearIds: gears.map((gear) => gear.gearId), slots },
    baseHp: trustedContext.baseHp,
    baseFuel: trustedContext.baseFuel
  });
  const revealedCommitment = protocol.createLoadoutCommitment({ battleGearSnapshot: snapshot, roundId, trustedContext });
  return Object.freeze({ trustedContext, revealedCommitment });
}

function installReveals(reveals) {
  const current = onlineFixture();
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry]));
  h.setOnlineForLogTest(current);
  const manifest = lobby.createStartGearManifest({
    roundId,
    commitments: reveals.map((entry) => entry.revealedCommitment),
    participantReveals: reveals
  });
  current.verifiedStartGearManifest = manifest;
  return { current, manifest };
}

function setupGearless() {
  h.setOnlineForLogTest(onlineFixture());
  const reveals = [createReveal('p1', 'kyoryu'), createReveal('e1', 'iwa')];
  return { reveals, ...installReveals(reveals) };
}

function setupEquipped() {
  h.setOnlineForLogTest(onlineFixture());
  const p1Gears = [makeGear('3d3a-p1-armor', 'armor'), makeGear('3d3a-p1-engine', 'engine', 'max_fuel')];
  const e1Gears = [makeGear('3d3a-e1-armor', 'armor'), makeGear('3d3a-e1-engine', 'engine', 'max_fuel')];
  const reveals = [createReveal('p1', 'kyoryu', p1Gears), createReveal('e1', 'iwa', e1Gears)];
  return { reveals, ...installReveals(reveals) };
}

function prepareUnits() {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
}

test('Gearless p1/e1 reconstruct immutable Battle snapshots with canonical base HP/Fuel', () => {
  const { manifest, reveals } = setupGearless();
  const state = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  assert.deepEqual(Object.keys(state.battleGearSnapshotsByUnit), ['p1', 'e1']);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.battleGearSnapshotsByUnit.p1), true);
  for (const entry of reveals) {
    const id = entry.revealedCommitment.unitId;
    assert.equal(state.hpFuelByUnit[id].maxHp, entry.trustedContext.baseHp);
    assert.equal(state.hpFuelByUnit[id].fuelMax, entry.trustedContext.baseFuel);
  }
});

test('equipped p1/e1 are recomputed locally and two independent clients produce identical HP/Fuel', () => {
  const { manifest, reveals } = setupEquipped();
  const host = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  const guest = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest: clone(manifest), participantReveals: clone(reveals) });
  assert.deepEqual(guest.hpFuelByUnit, host.hpFuelByUnit);
  assert(host.hpFuelByUnit.p1.maxHp > reveals[0].trustedContext.baseHp);
  assert(host.hpFuelByUnit.e1.maxHp > reveals[1].trustedContext.baseHp);
  assert.notEqual(host.hpFuelByUnit.p1.fuelMax, reveals[0].trustedContext.baseFuel);
  assert.notEqual(host.hpFuelByUnit.e1.fuelMax, reveals[1].trustedContext.baseFuel);
});

test('host applies only reconstructed HP/Fuel after reset and buildSnapshot sees both units', () => {
  const { manifest } = setupEquipped();
  const state = wiring.createBattleStartState(manifest);
  prepareUnits();
  let randomCalls = 0;
  const beforeRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0.5; };
  try { assert.equal(wiring.applyBattleStartState(state), true); } finally { Math.random = beforeRandom; }
  const snap = kt.buildSnapshotForTest();
  for (const unitId of ['p1', 'e1']) {
    const actual = snap.units.find((unit) => unit.id === unitId);
    assert.deepEqual({ character: actual.character, maxHp: actual.maxHp, hp: actual.hp, fuelMax: actual.fuelMax, fuel: actual.fuel }, state.hpFuelByUnit[unitId]);
  }
  assert.equal(randomCalls, 0, 'HP/Fuel application must not consume RNG');
  assert.deepEqual(wiring.battleSnapshotFreeze(), { map: true, units: { p1: true, e1: true } });
});

test('valid guest start applies the exact host HP/Fuel snapshot', () => {
  const { manifest } = setupEquipped();
  const state = wiring.createBattleStartState(manifest);
  prepareUnits();
  wiring.applyBattleStartState(state);
  const hostSnap = kt.buildSnapshotForTest();
  prepareUnits();
  assert.equal(wiring.applyVerifiedStartSnapshot(hostSnap, state), true);
  assert.deepEqual(kt.buildSnapshotForTest().units.map(({ id, hp, maxHp, fuel, fuelMax }) => ({ id, hp, maxHp, fuel, fuelMax })),
    hostSnap.units.map(({ id, hp, maxHp, fuel, fuelMax }) => ({ id, hp, maxHp, fuel, fuelMax })));
});

test('legal manifest cannot authorize forged maxHp/hp/fuelMax/fuel and rejection precedes applySnapshot', () => {
  const { manifest } = setupEquipped();
  const state = wiring.createBattleStartState(manifest);
  prepareUnits();
  wiring.applyBattleStartState(state);
  const valid = kt.buildSnapshotForTest();
  const casesByField = [
    ['maxHp', 'ONLINE_GEAR_START_MAX_HP_MISMATCH'],
    ['hp', 'ONLINE_GEAR_START_HP_MISMATCH'],
    ['fuelMax', 'ONLINE_GEAR_START_FUEL_MAX_MISMATCH'],
    ['fuel', 'ONLINE_GEAR_START_FUEL_MISMATCH']
  ];
  for (const [field, code] of casesByField) {
    prepareUnits();
    const before = kt.buildSnapshotForTest();
    const forged = clone(valid);
    forged.units[0][field] += 1;
    assert.throws(() => wiring.applyVerifiedStartSnapshot(forged, state), (error) => error?.code === code);
    assert.deepEqual(kt.buildSnapshotForTest(), before, `${field} rejection must happen before applySnapshot`);
  }
});

test('start manifest remains exact-bound to locally verified reveals', () => {
  const { manifest, reveals } = setupEquipped();
  h.setOnlineForLogTest(onlineFixture());
  const alternate = createReveal('p1', 'kyoryu', [makeGear('3d3a-alternate-armor', 'armor')], 'preset2');
  const substituted = clone(manifest);
  substituted.commitments[0] = alternate.revealedCommitment;
  assert.throws(() => battleStart.createOnlineGearBattleStartState({
    matchFormat: '1v1', manifest: substituted, participantReveals: reveals
  }), (error) => error?.code === 'ONLINE_GEAR_REVEAL_BINDING_MISMATCH');
});

test('incomplete Gear ON 2v2 fails closed while Gear OFF 1v1/2v2 returns the legacy no-op state', () => {
  const { manifest, reveals } = setupGearless();
  assert.throws(() => battleStart.createOnlineGearBattleStartState({ matchFormat: '2v2', manifest, participantReveals: reveals }),
    (error) => error?.code === 'MISSING_ONLINE_GEAR_BATTLE_REVEAL');
  h.setOnlineForLogTest(onlineFixture({ format: '1v1', gear: false }));
  assert.equal(wiring.createBattleStartState(null), null);
  h.setOnlineForLogTest(onlineFixture({ format: '2v2', gear: false }));
  assert.equal(wiring.createBattleStartState(null), null);
});

test('turn-boundary baseline preserves Gear maxHp/fuelMax and rejects either baseline mutation', () => {
  const { manifest } = setupEquipped();
  const state = wiring.createBattleStartState(manifest);
  prepareUnits();
  wiring.applyBattleStartState(state);
  const baseline = kt.buildSnapshotForTest();
  assert.equal(h.stateSnapshotMismatchReason(clone(baseline), baseline), '');
  const maxHp = clone(baseline); maxHp.units[0].maxHp -= 1;
  assert.equal(h.stateSnapshotMismatchReason(maxHp, baseline), 'maxHp');
  const fuelMax = clone(baseline); fuelMax.units[0].fuelMax -= 1;
  assert.equal(h.stateSnapshotMismatchReason(fuelMax, baseline), 'fuelMax');
});

test('start applies HP/Fuel to units while later mutable Shield state remains outside the Battle snapshot', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const block = /function applyFirebaseOnlineGearBattleStartState\([\s\S]*?\n  function validateFirebaseOnlineGearStartSnapshot/.exec(index)?.[0] || '';
  assert.match(block, /unit\.maxHp = expected\.maxHp/);
  assert.match(block, /unit\.hp = expected\.hp/);
  assert.match(block, /unit\.fuelMax = expected\.fuelMax/);
  assert.match(block, /unit\.fuel = expected\.fuel/);
  assert.match(block, /battleGearShieldStateByUnit = createFirebaseOnlineGearShieldStateByUnit/);
  assert.doesNotMatch(block, /unit\.(?:attack|defense|crit|blast|knockback|status|shield|healing|lastStand|rescue)\s*=|calculateBattleGearCombat|Math\.random/i);
});

test('browser and APP_SHELL load the Battle-start module after its protocol dependencies', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const lobbyAt = index.indexOf('shared/gear-online-lobby-protocol.js');
  const startAt = index.indexOf('shared/gear-online-battle-start.js');
  assert.ok(lobbyAt >= 0 && lobbyAt < startAt);
  assert.equal(worker.includes("'./shared/gear-online-battle-start.js'"), true);
});

test('host, guest and spectator production seams enforce the intended start ordering', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const host = /async function maybeStartFirebaseMatch\([\s\S]*?\n  async function applyFirebaseStart/.exec(index)?.[0] || '';
  assert.ok(host.indexOf('resetMatch(false)') >= 0);
  assert.ok(host.indexOf('resetMatch(false)') < host.indexOf('applyFirebaseOnlineGearBattleStartState(gearBattleStartState)'));
  assert.ok(host.indexOf('applyFirebaseOnlineGearBattleStartState(gearBattleStartState)') < host.indexOf('const snap = buildSnapshot()'));
  const guest = /async function applyFirebaseStart\([\s\S]*?\n  function buildFirebaseSeatRow/.exec(index)?.[0] || '';
  assert.ok(guest.indexOf('createFirebaseOnlineGearBattleStartState(gearManifest)') >= 0);
  assert.ok(guest.indexOf('applyVerifiedFirebaseStartSnapshot(msg.snap, gearBattleStartState)') >= 0);
  const apply = /function applyVerifiedFirebaseStartSnapshot\([\s\S]*?\n  async function maybeStartFirebaseMatch/.exec(index)?.[0] || '';
  assert.ok(apply.indexOf('validateFirebaseOnlineGearStartSnapshot') < apply.indexOf('applySnapshot'));
  const spectator = /async function applyFirebaseSpectatorStart\([\s\S]*?\n  function receiveFirebaseSpectatorResult/.exec(index)?.[0] || '';
  assert.match(spectator, /createFirebaseOnlineGearBattleStartState\(gearManifest\)/);
  assert.match(spectator, /applyFirebaseSpectatorSnapshot\(msg, gearBattleStartState\)/);
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
      localStorage.clear();
    }
  }
  console.log(`gear-online-battle-start-phase3d3a: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
