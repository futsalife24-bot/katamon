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
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

function onlineFixture({ gear = true, format = '1v1' } = {}) {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: roomId,
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1,
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

function lifeGear(prefix, slotId) {
  return domain.createGear({
    gearId: `${prefix}-${slotId}`,
    generationSeed: `3d6a:${prefix}:${slotId}:generation`,
    enhancementSeed: `3d6a:${prefix}:${slotId}:enhancement`,
    sourceId: 'cpu_battle', sourceDetail: { fixture: '3d6a' }, acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: '3d6a-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
    setProfile: { id: '3d6a-life', setWeights: [{ id: 'life', weight: 1 }] }, slotId
  });
}

function lifeSet(prefix, count) {
  return ['barrel', 'armor', 'core', 'engine'].slice(0, count).map((slotId) => lifeGear(prefix, slotId));
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

function prepareUnits() {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
}

function installBattle({ p1Gears = [], e1Gears = [], gear = true, format = '1v1' } = {}) {
  const current = onlineFixture({ gear, format });
  h.setOnlineForLogTest(current);
  prepareUnits();
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
  const state = battleStart.createOnlineGearBattleStartState({ matchFormat: format, manifest, participantReveals: reveals });
  wiring.applyBattleStartState(state);
  return { current, state };
}

function installAction(ownerId, turn = 7) {
  kt.setTurnCountForTest(turn);
  return wiring.setCritActionForTest(ownerId, ownerId === 'p1' ? 'local' : 'remote');
}

function cannonHit(ownerId, targetId, direct = true, turn = 7) {
  installAction(ownerId, turn);
  const target = kt.unitById(targetId);
  const before = target.hp;
  kt.explodeAtForTest(target.x, target.y, 1, ownerId, true, {
    gearDamageProfile: 'normal_cannonball', directTargetId: direct ? targetId : 'other', radius: 5
  });
  return before - target.hp;
}

test('Gearless and Life2 start at zero while Life4 initializes p1/e1 from the pure capped contract', () => {
  let installed = installBattle();
  assert.deepEqual(wiring.shieldState(), { p1: { currentShield: 0 }, e1: { currentShield: 0 } });
  installed = installBattle({ p1Gears: lifeSet('p1-life2', 2), e1Gears: lifeSet('e1-life2', 2) });
  assert.deepEqual(wiring.shieldState(), { p1: { currentShield: 0 }, e1: { currentShield: 0 } });
  installed = installBattle({ p1Gears: lifeSet('p1-life4', 4), e1Gears: lifeSet('e1-life4', 4) });
  const shield = wiring.shieldState();
  for (const id of ['p1', 'e1']) {
    const combat = installed.state.battleGearSnapshotsByUnit[id].derivedStats;
    close(shield[id].currentShield, gearCombat.initialShieldFromSets(combat).shieldAfter);
    assert(shield[id].currentShield > 0);
    assert(shield[id].currentShield <= combat.maxHp * 0.35);
  }
});

test('Shield/Received Shield multipliers apply once and runtime state stays outside immutable Battle snapshots', () => {
  const { state } = installBattle({ p1Gears: lifeSet('separation', 4) });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  close(wiring.shieldState().p1.currentShield, gearCombat.initialShieldFromSets(combat).shieldAfter);
  assert.equal(Object.isFrozen(state.battleGearSnapshotsByUnit), true);
  assert.equal(Object.isFrozen(state.battleGearSnapshotsByUnit.p1), true);
  assert.equal(Object.prototype.hasOwnProperty.call(state.battleGearSnapshotsByUnit.p1, 'currentShield'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(combat, 'currentShield'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state.battleGearSnapshotsByUnit.p1.initialRuntimeState, 'currentShield'), false);
});

test('normal direct and normal blast consume Numeric Shield for p1 and e1', () => {
  installBattle({ e1Gears: lifeSet('direct-e1', 4) });
  let before = wiring.shieldState().e1.currentShield;
  cannonHit('p1', 'e1', true, 3);
  assert(wiring.shieldState().e1.currentShield < before);
  installBattle({ p1Gears: lifeSet('blast-p1', 4) });
  before = wiring.shieldState().p1.currentShield;
  cannonHit('e1', 'p1', false, 4);
  assert(wiring.shieldState().p1.currentShield < before);
});

test('full absorb changes only Shield, preserves Barrier, and yields no Knockback actual-damage gate', () => {
  installBattle({ e1Gears: lifeSet('full', 4) });
  const target = kt.unitById('e1');
  const hp = target.hp;
  kt.setSubweaponBarrierForTest('e1', true);
  const result = wiring.applyResolvedDamage('p1', 'e1', 5, { damageType: 'direct_projectile' });
  assert.equal(result.actualDamage, 0);
  assert.equal(target.hp, hp);
  assert.equal(target.subweaponBarrierActive, true);
  assert.equal(wiring.applyKnockbackAfterDamage({
    actualDamage: result.actualDamage, targetId: 'e1', blastX: target.x, ownerId: 'p1',
    damageType: 'direct_projectile', projectile: { gearDamageProfile: 'normal_cannonball' }
  }), false);
  assert.equal(target.knockbackVx || 0, 0);
});

test('fractional Shield residual reaches Barrier before the one historic integer boundary', () => {
  installBattle({ e1Gears: lifeSet('fractional', 4) });
  wiring.setShieldForTest('e1', 0.5);
  kt.setSubweaponBarrierForTest('e1', true);
  const result = wiring.applyResolvedDamage('p1', 'e1', 45, { damageType: 'direct_projectile' });
  assert.equal(result.actualDamage, 22, 'round((45 - 0.5) * 0.5)');
  assert.equal(wiring.shieldState().e1.currentShield, 0);
  assert.equal(kt.unitById('e1').subweaponBarrierActive, false);
});

test('representative direct special passes through the common Shield boundary exactly once', () => {
  installBattle({ e1Gears: lifeSet('special', 4) });
  const before = wiring.shieldState().e1.currentShield;
  assert(kt.fireSpecialImmediateForUnitForTest('p1', 'coolKai', 220, -100) >= 0);
  assert.equal(kt.resolveProjectileUnitImpactForTest(0, 'e1'), true);
  assert(wiring.shieldState().e1.currentShield < before);
});

test('EMP, hostile ground flame, and hostile firework shards consume Shield without changing Status gating', () => {
  installBattle({ e1Gears: lifeSet('emp', 4) });
  installAction('p1', 11);
  let before = wiring.shieldState().e1.currentShield;
  const target = kt.unitById('e1');
  kt.emitEmpForTest(target.x, target.y, 20, 'p1', 2);
  assert(wiring.shieldState().e1.currentShield < before);
  assert.equal(kt.turnEffectForTest('e1').moveLockTurns, 2);
  installBattle({ e1Gears: lifeSet('flame', 4) });
  before = wiring.shieldState().e1.currentShield;
  kt.damageGroundFlameForTest(kt.unitById('e1').x, kt.unitById('e1').y, 'p1');
  assert(wiring.shieldState().e1.currentShield < before);
  installBattle({ e1Gears: lifeSet('firework', 4) });
  before = wiring.shieldState().e1.currentShield;
  kt.fireworkShardExplodeForTest(kt.unitById('e1').x, kt.unitById('e1').y, 'p1');
  assert(wiring.shieldState().e1.currentShield < before);
});

test('self, friendly, and unknown environmental damage never consume ONLINE Numeric Shield', () => {
  installBattle({ p1Gears: lifeSet('excluded', 4) });
  const initial = wiring.shieldState().p1.currentShield;
  wiring.applyResolvedDamage('p1', 'p1', 5, { damageType: 'fixed' });
  assert.equal(wiring.shieldState().p1.currentShield, initial);
  wiring.applyResolvedDamage(null, 'p1', 5, { damageType: 'fixed' });
  assert.equal(wiring.shieldState().p1.currentShield, initial);
});

test('drain exposes actual HP loss only to the isolated ONLINE Healing boundary', () => {
  installBattle({ e1Gears: lifeSet('drain-target', 4) });
  wiring.setShieldForTest('e1', 0.5);
  installAction('p1', 17);
  const owner = kt.unitById('p1');
  const target = kt.unitById('e1');
  owner.hp = owner.maxHp - 50;
  const ownerBefore = owner.hp;
  const targetBefore = target.hp;
  kt.explodeDrainAtForTest(target.x, target.y, 1, 'p1', {
    gearDamageProfile: 'normal_cannonball', directTargetId: 'e1', radius: 5
  });
  const actualHpDamage = targetBefore - target.hp;
  assert(actualHpDamage > 0);
  assert.equal(owner.hp - ownerBefore, actualHpDamage);
});

test('host and guest clones derive and consume identical runtime Shield sequences', () => {
  const sequence = () => {
    installBattle({ p1Gears: lifeSet('clone-p1', 4), e1Gears: lifeSet('clone-e1', 4) });
    const initial = wiring.shieldState();
    const first = wiring.applyResolvedDamage('p1', 'e1', 7, { damageType: 'direct_projectile' });
    const second = wiring.applyResolvedDamage('e1', 'p1', 11, { damageType: 'normal_blast' });
    return { initial, after: wiring.shieldState(), hp: [kt.unitById('p1').hp, kt.unitById('e1').hp], damage: [first.actualDamage, second.actualDamage] };
  };
  assert.deepEqual(sequence(), sequence());
});

test('Gearless Gear ON and Gear OFF preserve legacy damage while Gear OFF needs no Shield state', () => {
  installBattle();
  const gearOn = wiring.applyResolvedDamage('p1', 'e1', 45, { damageType: 'direct_projectile' }).actualDamage;
  assert.deepEqual(wiring.shieldState(), { p1: { currentShield: 0 }, e1: { currentShield: 0 } });
  installBattle({ gear: false });
  assert.equal(wiring.shieldState(), null);
  const gearOff = wiring.applyResolvedDamage('p1', 'e1', 45, { damageType: 'direct_projectile' }).actualDamage;
  assert.equal(gearOff, gearOn);
});

test('eligible hostile damage fails closed when ONLINE runtime Shield state is missing or malformed', () => {
  const { current } = installBattle({ e1Gears: lifeSet('invalid', 4) });
  current.battleGearShieldStateByUnit = null;
  assert.throws(() => wiring.applyResolvedDamage('p1', 'e1', 5), (error) => error?.code === 'ONLINE_GEAR_SHIELD_STATE_INVALID');
  current.battleGearShieldStateByUnit = Object.freeze({ p1: Object.freeze({ currentShield: 0 }), e1: Object.freeze({ currentShield: Infinity }) });
  assert.throws(() => wiring.applyResolvedDamage('p1', 'e1', 5), (error) => error?.code === 'ONLINE_GEAR_SHIELD_STATE_INVALID');
});

test('Shield introduces no RNG or Math.random consumption', () => {
  installBattle({ e1Gears: lifeSet('random', 4) });
  const actionIdentity = onlineRng.createOnlineGearActionIdentity({ version: 1, roomId, roundId, turnOrdinal: 7, sourceUnitId: 'p1' });
  const critIdentity = onlineRng.createCritRollIdentity({ actionIdentity, targetUnitId: 'e1', damageType: 'direct_projectile', hitOrdinal: 0 });
  assert.equal(onlineRng.rollBasisPoints(critIdentity), 5220);
  const original = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; return 0.5; };
  try { wiring.applyResolvedDamage('p1', 'e1', 5); } finally { Math.random = original; }
  assert.equal(calls, 0);
});

test('source contract covers all hostile routes while Firebase wire, Rules, and reconnect stay untouched', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const snapshotSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-battle-snapshot.js'), 'utf8');
  assert.equal((index.match(/\bapplyBattleGearNumericShieldToIncomingDamage\(/g) || []).length, 5,
    'definition + applyResolvedUnitDamage + EMP + ground flame + firework');
  assert.equal((index.match(/\bapplyCpuGearNumericShieldToIncomingDamage\(/g) || []).length, 2,
    'CPU definition + dispatcher fallback only');
  for (const marker of ['resolveProjectileUnitImpact', 'resolvePrismBeamUnitImpact', 'resolveCoolKaiOnigiriUnitImpact', 'resolveBarucopterBulletUnitImpact']) {
    const start = index.indexOf(`function ${marker}(`);
    const end = index.indexOf('\n  function ', start + 20);
    assert.match(index.slice(start, end), /applyResolvedUnitDamage\(/, marker);
  }
  assert.doesNotMatch(snapshotSource, /currentShield|gearShieldState|numericShield/);
  assert.doesNotMatch(rules, /currentShield|gearShieldState|numericShield/);
  assert.doesNotMatch(index, /netSend\(\{[^}]*\b(?:currentShield|gearShieldState|numericShield)\b/);
  assert.equal((index.match(/\bapplyBattleGearHealing\(/g) || []).length, 3,
    'Healing responsibility moved to its definition plus generated self-heal and drain only');
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
  console.log(`gear-online-battle-shield-phase3d6a: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
