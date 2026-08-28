const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const combat = require('../shared/gear-combat.js');
const snapshot = require('../shared/gear-battle-snapshot.js');
const online = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const start = require('../shared/gear-online-battle-start.js');
const rng = require('../shared/gear-online-battle-rng.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const slots = domain.SLOT_IDS;
const roomId = 'A2BC3DEF';
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode: online.GEAR_MODE_PRIVATE_TRUSTED_V1 });
const cases = [];
let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n?/g, '\n');

function fixture() {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: roomId,
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1', currentRoundId: roundId,
    visibility: 'private', settings: { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1, gearCapability: capability },
    slots: { p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null, battleGearShieldStateByUnit: null,
    battleGearRuntimeEffectsStateByUnit: null, battleGearActiveAttackRuntime: null, pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu', localAction: null, remoteAction: null
  };
}

function gear(prefix, slotId, setId = 'last_stand') {
  return domain.createGear({ gearId: `${prefix}:${slotId}`, generationSeed: `${prefix}:${slotId}:g`, enhancementSeed: `${prefix}:${slotId}:e`,
    sourceId: 'cpu_battle', sourceDetail: { fixture: '3d7a' }, acquiredAt: '2026-08-28T00:00:00Z',
    qualityProfile: { id: 'fixed', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: setId, setWeights: [{ id: setId, weight: 1 }] }, slotId });
}
function last(count) { return ['barrel', 'armor', 'core', 'engine'].slice(0, count).map((id) => gear(`last-${count}`, id)); }
function reveal(seat, characterId, gears) {
  const trustedContext = wiring.trustedContext(seat, characterId);
  const loadoutSlots = Object.fromEntries(slots.map((id) => [id, null]));
  for (const value of gears) loadoutSlots[value.slotId] = value;
  const value = snapshot.createBattleGearSnapshot({ resolvedLoadout: { characterId, presetId: 'preset1', gearIds: gears.map((item) => item.gearId), slots: loadoutSlots }, baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel });
  return Object.freeze({ trustedContext, revealedCommitment: online.createLoadoutCommitment({ battleGearSnapshot: value, roundId, trustedContext }) });
}
function install({ p1 = [], e1 = [] } = {}) {
  const current = fixture(); h.setOnlineForLogTest(current); kt.setMatchFormatForTest('1v1'); kt.setCharactersForTest('kyoryu', 'iwa'); h.resetMatchForTest(); kt.setCharactersForTest('kyoryu', 'iwa');
  const reveals = [reveal('p1', 'kyoryu', p1), reveal('e1', 'iwa', e1)];
  const manifest = lobby.createStartGearManifest({ roundId, commitments: reveals.map((entry) => entry.revealedCommitment), participantReveals: reveals });
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry])); current.verifiedStartGearManifest = manifest;
  const state = start.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals }); wiring.applyBattleStartState(state);
  return { current, state, manifest };
}

test('fresh p1/e1 runtime is zero, static snapshot stays static, and Rescue4 remains inert', () => {
  install({ p1: last(4), e1: last(4) });
  assert.deepEqual(wiring.runtimeEffectsState(), { p1: combat.createRuntimeEffectsState(), e1: combat.createRuntimeEffectsState() });
  for (const value of Object.values(wiring.state().battleGearSnapshotsByUnit)) assert.equal('currentShield' in value.derivedStats, false);
});

test('Last Stand2 captures exact 50% Attack once, and Last Stand4 overwrites +10 with +15 after actual HP damage', () => {
  const { state } = install({ p1: last(4), e1: last(4) });
  const p1 = kt.unitById('p1'); const e1 = kt.unitById('e1');
  kt.setUnitHpForTest('p1', p1.maxHp / 2); assert.equal(wiring.beginLastStandAttack('p1'), true);
  const active = wiring.activeAttackRuntime();
  assert.equal(active.attackMultiplier, combat.resolveAttackMultiplier({ combat: state.battleGearSnapshotsByUnit.p1.derivedStats, runtimeAttackPctBp: 1000 }));
  kt.setUnitHpForTest('p1', p1.maxHp); assert.deepEqual(wiring.activeAttackRuntime(), active);
  wiring.completeLastStandAttack('p1');
  kt.setUnitHpForTest('p1', p1.maxHp * .6); wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 1, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, state.battleGearSnapshotsByUnit.p1.derivedStats.conditional.lastStandNextAttackDamageBp);
  kt.setUnitHpForTest('p1', p1.maxHp * .5); wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 1, damageType: 'normal_blast', fromEnemyAttackAction: true });
  assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, state.battleGearSnapshotsByUnit.p1.derivedStats.conditional.lastStandLowHpNextAttackDamageBp);
  assert.equal(e1.hp > 0, true);
});

test('Shield/Barrier-equivalent zero actual damage and non-offensive provenance never grant Last Stand', () => {
  install({ p1: last(4) }); const p1 = kt.unitById('p1');
  wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 0, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 3, damageType: 'environmental', fromEnemyAttackAction: false });
  assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, 0);
});

test('captured Last Stand4 is action-wide, composes in the modifier bucket, and consumes only on completion', () => {
  const { state } = install({ p1: last(4) }); const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp * .5);
  wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 1, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  wiring.beginLastStandAttack('p1'); const active = wiring.activeAttackRuntime();
  wiring.setCritActionForTest('p1');
  assert.equal(active.actionDamageBp, state.battleGearSnapshotsByUnit.p1.derivedStats.conditional.lastStandLowHpNextAttackDamageBp);
  assert.equal(wiring.requestedDamage('p1', 'e1', 'direct_projectile', 20, { gearDamageProfile: 'normal_cannonball', directTargetId: 'e1' }),
    Math.round(combat.calculateDamagePipeline({ baseDamage: 20, attackMultiplier: active.attackMultiplier, modifierBp: active.actionDamageBp, isCrit: false, critDamageMultiplier: 1.5, defenseMultiplier: 1, damageReductionBp: 0, numericShield: 0, hp: kt.unitById('e1').hp }).hpDamage));
  assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, active.actionDamageBp);
  wiring.completeLastStandAttack('p1'); assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, 0);
});

test('Scorpion Rail uses only the captured Last Stand4 action modifier, then consumes it', () => {
  const { state } = install({ p1: last(4) });
  const p1 = kt.unitById('p1');
  kt.setUnitHpForTest('p1', p1.maxHp * .5);
  wiring.recordLastStandDamage({ ownerId: 'e1', target: p1, actualDamage: 1, damageType: 'direct_projectile', fromEnemyAttackAction: true });
  wiring.beginLastStandAttack('p1');
  const base = 24 * (kt.unitById('e1').character === 'iwa' ? 1 : 1);
  const expected = wiring.actionDamageRequested('p1', base);
  assert.equal(expected, Math.round(base * 1.15), 'Rail must receive Last Stand4, not Last Stand2 Attack');
  const resolved = wiring.resolveScorpionRailImpact('p1', 'e1');
  assert.equal(resolved.actualDamage, expected, 'actual Scorpion Rail production resolver must receive the action modifier');
  wiring.completeLastStandAttack('p1');
  assert.equal(wiring.runtimeEffectsState().p1.lastStandNextAttackDamageBp, 0);
  assert.equal(state.battleGearSnapshotsByUnit.p1.derivedStats.conditional.lastStand2, true);
});

test('ONLINE 1v1 rejects an injected Rescue4 runtime value before an attack starts', () => {
  install({ p1: last(4) });
  const state = wiring.runtimeEffectsState();
  wiring.setRuntimeEffectsStateRawForTest(Object.freeze({
    p1: Object.freeze({ ...state.p1, rescueNextAttackDamageBp: 1000 }),
    e1: Object.freeze(state.e1)
  }));
  assert.throws(() => wiring.beginLastStandAttack('p1'), (error) => error?.code === 'ONLINE_GEAR_RUNTIME_EFFECTS_STATE_INVALID');
  assert.equal(wiring.activeAttackRuntime(), null);
});

test('offensive production routes retain the shared action boundary while Barrier stays outside it', () => {
  const index = read('index.html');
  const block = name => index.slice(index.indexOf(`function ${name}(`), index.indexOf('\n  function ', index.indexOf(`function ${name}(`) + 1));
  assert.match(block('emitEmp'), /battleGearActionDamageRequested\(owner,/);
  assert.match(block('fireworkShardExplode'), /battleGearActionDamageRequested\(p\.owner,/);
  assert.match(index, /subweaponId === 'impact' \|\| subweaponId === 'drill'/);
  assert.match(index, /beginBattleGearAttackAction\(unit\)/);
  assert.match(block('endTurn'), /completeBattleGearAttackAction\(acting\)/);
  assert.match(block('launchSubweaponShot'), /subweaponId === 'barrier'/);
});

test('p1/e1 symmetry, Gearless identity, and cancel preservation hold', () => {
  install({ p1: last(4), e1: last(4) });
  for (const id of ['p1', 'e1']) { const unit = kt.unitById(id); kt.setUnitHpForTest(id, unit.maxHp * .5); wiring.beginLastStandAttack(id); assert.equal(wiring.activeAttackRuntime().ownerId, id); wiring.cancelLastStandAttack(id); assert.equal(wiring.activeAttackRuntime(), null); }
  install(); assert.equal(wiring.beginLastStandAttack('p1'), true); assert.equal(wiring.activeAttackRuntime().actionDamageBp, 0); wiring.completeLastStandAttack('p1');
});

test('runtime Shield wire v2, Firebase Rules, RNG and manifest v4 fence remain isolated', () => {
  const index = read('index.html'); const rules = read('database.rules.json'); const runtime = read('shared', 'gear-online-battle-runtime-state.js');
  assert.equal(lobby.ONLINE_GEAR_LOBBY_PROTOCOL_VERSION, 4); assert.equal(online.ONLINE_GEAR_PROTOCOL_VERSION, 1);
  assert.match(runtime, /shieldByUnit/); assert.doesNotMatch(runtime, /lastStandNextAttackDamageBp/);
  assert.doesNotMatch(rules, /lastStandNextAttackDamageBp|battleGearRuntimeEffects/);
  const action = rng.createOnlineGearActionIdentity({ version: 1, roomId, roundId, turnOrdinal: 7, sourceUnitId: 'p1' });
  assert.equal(rng.rollBasisPoints(rng.createCritRollIdentity({ actionIdentity: action, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0 })), 5220);
  const { manifest } = install({ p1: last(4), e1: last(4) });
  const v2 = structuredClone(manifest); v2.version = 2;
  assert.throws(() => lobby.validateStartGearManifest(v2, { participantReveals: Object.values(wiring.state().participantGearReveals) }),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_START_MANIFEST');
});

async function main() {
  for (const [name, fn] of cases) { h.setOnlineForLogTest(null); try { await fn(); passed += 1; console.log(`  ok ${name}`); } finally { h.setOnlineForLogTest(null); kt.setMatchFormatForTest('1v1'); localStorage.clear(); } }
  console.log(`gear-online-battle-last-stand-phase3d7a: ${passed}/${cases.length} passed`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
