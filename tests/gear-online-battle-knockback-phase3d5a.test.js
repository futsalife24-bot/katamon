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
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const capability = lobbyProtocol.createRoomGearCapability({
  visibility: 'private', gearMode: onlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1
});
const slotIds = domain.SLOT_IDS;
const cases = [];
let passed = 0;
const test = (name, fn) => cases.push([name, fn]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const assertClose = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9,
  `${actual} is not close to ${expected}`);

function onlineFixture() {
  return {
    kind: 'firebase', role: 'host', participantRole: 'player', phase: 'battle', room: 'A2BC3DEF',
    auth: { uid: 'uid-p1', idToken: 'test-token' }, clientId: 'uid-p1', seat: 'p1', peerSeat: 'e1',
    currentRoundId: roundId, visibility: 'private', settingsAuthorityBlocked: false,
    settings: {
      terrain: 'random', wind: 'random', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1,
      gearCapability: capability
    },
    slots: {
      p1: { uid: 'uid-p1', claimedAt: 1 }, e1: { uid: 'uid-e1', claimedAt: 1 }, s1: null, s2: null
    },
    participantGearReveals: {}, verifiedStartGearManifest: null, battleGearSnapshotsByUnit: null,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(),
    seatCharacter: { e1: 'iwa' }, seatVerified: { e1: true }, selfCharacter: 'kyoryu',
    localAction: null, remoteAction: null
  };
}

function createGear(prefix, slotId, setId, accept = () => true) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const gear = domain.createGear({
      gearId: `${prefix}-${slotId}-${attempt}`,
      generationSeed: `3d5a:${prefix}:${slotId}:${attempt}:generation`,
      enhancementSeed: `3d5a:${prefix}:${slotId}:${attempt}:enhancement`,
      sourceId: 'cpu_battle',
      sourceDetail: { fixture: '3d5a' },
      acquiredAt: '2026-08-27T00:00:00Z',
      qualityProfile: { id: '3d5a-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: '3d5a-set', setWeights: [{ id: setId, weight: 1 }] },
      slotId
    });
    if (accept(gear)) return gear;
  }
  throw new Error(`could not create ${setId} fixture for ${slotId}`);
}

const hasKnockbackOp = (gear) => ['knockback_power', 'knockback_resistance'].includes(gear.mainOp.opId)
  || gear.subOps.some((sub) => ['knockback_power', 'knockback_resistance'].includes(sub.opId));
const impactGears = (prefix, slots) => slots.map((slotId) =>
  createGear(prefix, slotId, 'impact', (gear) => !hasKnockbackOp(gear)));
const setGearsWithoutKnockback = (prefix, setId, slots) => slots.map((slotId) =>
  createGear(prefix, slotId, setId, (gear) => !hasKnockbackOp(gear)));

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

function installBattle({ p1Gears = [], e1Gears = [] } = {}) {
  const current = onlineFixture();
  h.setOnlineForLogTest(current);
  const reveals = [createReveal('p1', 'kyoryu', p1Gears), createReveal('e1', 'iwa', e1Gears)];
  const manifest = lobbyProtocol.createStartGearManifest({
    roundId,
    commitments: reveals.map((entry) => entry.revealedCommitment),
    participantReveals: reveals
  });
  current.participantGearReveals = Object.fromEntries(reveals.map((entry) => [entry.revealedCommitment.seatId, entry]));
  current.verifiedStartGearManifest = manifest;
  const state = battleStart.createOnlineGearBattleStartState({ matchFormat: '1v1', manifest, participantReveals: reveals });
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setCharactersForTest('kyoryu', 'iwa');
  wiring.applyBattleStartState(state);
  return { current, state };
}

function installAction(ownerId, turn = 0) {
  kt.setTurnCountForTest(turn);
  return wiring.setCritActionForTest(ownerId, ownerId === 'p1' ? 'local' : 'remote');
}

function projectile({ ownerId = 'p1', directTargetId = 'e1', knockbackSpeed = 0,
  profile = 'normal_cannonball' } = {}) {
  return { owner: ownerId, gearDamageProfile: profile, directTargetId, radius: 5, knockbackSpeed };
}

function clearVelocity(id) {
  const unit = kt.unitById(id);
  unit.knockbackVx = 0;
  unit.vy = 0;
  unit.grounded = true;
}

function impactAt(ownerId, targetId, options = {}) {
  const target = kt.unitById(targetId);
  clearVelocity(targetId);
  const p = projectile({ ownerId, directTargetId: targetId, ...options });
  if (p.gearDamageProfile === 'normal_cannonball' && ownerId !== targetId) installAction(ownerId, options.turn || 0);
  const before = target.hp;
  kt.explodeAtForTest(target.x, target.y, options.blastMul || 1, ownerId, true, p);
  return {
    damage: before - target.hp,
    velocity: { vx: target.knockbackVx, vy: target.vy, grounded: target.grounded }
  };
}

function critTurn(ownerId, targetId, damageType, combat, shouldCrit) {
  for (let turn = 0; turn < 50000; turn += 1) {
    const actionIdentity = onlineRng.createOnlineGearActionIdentity({
      version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
      roomId: 'A2BC3DEF', roundId, turnOrdinal: turn, sourceUnitId: ownerId
    });
    const identity = onlineRng.createCritRollIdentity({ actionIdentity, targetUnitId: targetId, damageType, hitOrdinal: 0 });
    if ((onlineRng.rollBasisPoints(identity) < combat.critRateBp) === shouldCrit) return turn;
  }
  throw new Error('Crit fixture not found');
}

test('Impact2 and Impact4 values come once from immutable Battle Gear Snapshots', () => {
  const two = installBattle({ p1Gears: impactGears('impact2', ['barrel', 'armor']) })
    .state.battleGearSnapshotsByUnit.p1.derivedStats;
  const four = installBattle({ p1Gears: impactGears('impact4', ['barrel', 'armor', 'core', 'engine']) })
    .state.battleGearSnapshotsByUnit.p1.derivedStats;
  assert.equal(two.setCounts.impact, 2);
  assert.equal(two.knockbackPowerBp, 1000);
  assert.equal(two.knockbackResistanceBp, 0);
  assert.equal(four.setCounts.impact, 4);
  assert.equal(four.knockbackPowerBp, 2000);
  assert.equal(four.knockbackResistanceBp, 1000);
});

test('ONLINE policy uses the shared pure formula and cloned host/guest inputs agree', () => {
  const { state } = installBattle({
    p1Gears: impactGears('policy-p1', ['barrel', 'armor', 'core', 'engine']),
    e1Gears: impactGears('policy-e1', ['barrel', 'armor', 'core', 'engine'])
  });
  const p = projectile({ ownerId: 'p1', directTargetId: 'e1' });
  const runtime = wiring.knockbackPolicy('p1', 'e1', 'direct_projectile', p, 0);
  const host = gearCombat.knockbackPolicy({
    hitKind: 'direct_hit', baseKnockback: 60,
    knockbackPowerBp: state.battleGearSnapshotsByUnit.p1.derivedStats.knockbackPowerBp,
    knockbackResistanceBp: state.battleGearSnapshotsByUnit.e1.derivedStats.knockbackResistanceBp
  });
  const guest = gearCombat.knockbackPolicy({
    hitKind: 'direct_hit', baseKnockback: 60,
    knockbackPowerBp: clone(state.battleGearSnapshotsByUnit.p1.derivedStats).knockbackPowerBp,
    knockbackResistanceBp: clone(state.battleGearSnapshotsByUnit.e1.derivedStats).knockbackResistanceBp
  });
  assert.deepEqual(runtime, host);
  assert.deepEqual(guest, host);
});

test('Gearless normal cannon adds no Knockback while legacy special speed stays identical', () => {
  installBattle();
  const direct = impactAt('p1', 'e1');
  assert.equal(direct.damage > 0, true);
  assert.equal(direct.velocity.vx, 0);
  assert.equal(direct.velocity.vy, 0);
  installBattle();
  const special = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 80 });
  assert.equal(Math.abs(special.velocity.vx), 80);
  assert.equal(special.velocity.vy, -88);
});

test('normal direct applies Impact4 popup once from p1 to e1', () => {
  installBattle({ p1Gears: impactGears('direct-p1', ['barrel', 'armor', 'core', 'engine']) });
  const result = impactAt('p1', 'e1');
  assertClose(Math.abs(result.velocity.vx), 3);
  assertClose(result.velocity.vy, -12);
});

test('normal direct applies Impact4 popup once from e1 to p1', () => {
  installBattle({ e1Gears: impactGears('direct-e1', ['barrel', 'armor', 'core', 'engine']) });
  const result = impactAt('e1', 'p1');
  assertClose(Math.abs(result.velocity.vx), 3);
  assertClose(result.velocity.vy, -12);
});

test('normal blast applies Impact4 radial Knockback in both directions and keeps owner-side centering', () => {
  installBattle({ p1Gears: impactGears('blast-p1', ['barrel', 'armor', 'core', 'engine']) });
  let target = kt.unitById('e1');
  kt.setUnitPositionForTest('p1', target.x + 100, kt.unitById('p1').y);
  let result = impactAt('p1', 'e1', { directTargetId: 'other' });
  assertClose(Math.abs(result.velocity.vx), 12);
  assertClose(result.velocity.vy, -13.2);
  assert(result.velocity.vx < 0);

  installBattle({ e1Gears: impactGears('blast-e1', ['barrel', 'armor', 'core', 'engine']) });
  target = kt.unitById('p1');
  kt.setUnitPositionForTest('e1', target.x - 100, kt.unitById('e1').y);
  result = impactAt('e1', 'p1', { directTargetId: 'other' });
  assertClose(Math.abs(result.velocity.vx), 12);
  assertClose(result.velocity.vy, -13.2);
  assert(result.velocity.vx > 0);
});

test('existing special Knockback composes attacker Power and defender Resistance exactly once', () => {
  installBattle({ e1Gears: impactGears('resist-only', ['barrel', 'armor', 'core', 'engine']) });
  let result = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 80 });
  assertClose(Math.abs(result.velocity.vx), 80 / 1.1);
  assertClose(result.velocity.vy, -(80 / 1.1) * 1.1);

  installBattle({
    p1Gears: impactGears('special-power', ['barrel', 'armor', 'core', 'engine']),
    e1Gears: impactGears('special-resist', ['barrel', 'armor', 'core', 'engine'])
  });
  result = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 80 });
  const expected = 80 * 1.2 / 1.1;
  assertClose(Math.abs(result.velocity.vx), expected);
  assertClose(result.velocity.vy, -expected * 1.1);
});

test('excluded special with no legacy speed gains no new Knockback', () => {
  installBattle({ p1Gears: impactGears('special-zero', ['barrel', 'armor', 'core', 'engine']) });
  const result = impactAt('p1', 'e1', { profile: 'excluded', knockbackSpeed: 0 });
  assert.equal(result.damage > 0, true);
  assert.equal(result.velocity.vx, 0);
  assert.equal(result.velocity.vy, 0);
});

test('post-damage gate blocks zero damage and allows the same valid hit after HP damage', () => {
  installBattle({ p1Gears: impactGears('actual-damage', ['barrel', 'armor', 'core', 'engine']) });
  const target = kt.unitById('e1');
  const p = projectile({ ownerId: 'p1', directTargetId: 'e1' });
  clearVelocity('e1');
  assert.equal(wiring.applyKnockbackAfterDamage({
    actualDamage: 0, targetId: 'e1', blastX: target.x, ownerId: 'p1',
    damageType: 'direct_projectile', projectile: p
  }), false);
  assert.equal(target.knockbackVx, 0);
  assert.equal(target.vy, 0);
  assert.equal(wiring.applyKnockbackAfterDamage({
    actualDamage: 1, targetId: 'e1', blastX: target.x, ownerId: 'p1',
    damageType: 'direct_projectile', projectile: p
  }), true);
  assertClose(Math.abs(target.knockbackVx), 3);
  assertClose(target.vy, -12);
});

test('outside combat reach cannot create Gear Knockback', () => {
  installBattle({ p1Gears: impactGears('outside', ['barrel', 'armor', 'core', 'engine']) });
  installAction('p1', 5);
  const target = kt.unitById('e1');
  clearVelocity('e1');
  const before = target.hp;
  kt.explodeAtForTest(target.x + 500, target.y, 1, 'p1', true,
    projectile({ ownerId: 'p1', directTargetId: 'other' }));
  assert.equal(target.hp, before);
  assert.equal(target.knockbackVx, 0);
  assert.equal(target.vy, 0);
});

test('Blast Range can expose a target to blast-only KB without creating a Knockback range', () => {
  const gears = [
    ...impactGears('range-impact2', ['barrel', 'armor']),
    ...setGearsWithoutKnockback('range-blast4', 'blast', ['core', 'engine', 'sight', 'auxiliary'])
  ];
  installBattle({ p1Gears: gears });
  installAction('p1', 7);
  const target = kt.unitById('e1');
  clearVelocity('e1');
  const before = target.hp;
  kt.explodeAtForTest(target.x - 105, target.y, 1, 'p1', true,
    projectile({ ownerId: 'p1', directTargetId: 'other' }));
  assert(before - target.hp > 0);
  assertClose(Math.abs(target.knockbackVx), 6);
});

test('Crit and Blast change damage but never make Knockback damage-proportional', () => {
  const p1Gears = [
    ...impactGears('compose-impact2', ['barrel', 'armor']),
    ...setGearsWithoutKnockback('compose-blast2', 'blast', ['core', 'engine']),
    ...setGearsWithoutKnockback('compose-critical2', 'critical', ['sight', 'auxiliary'])
  ];
  let installed = installBattle({ p1Gears });
  let combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  const nonCrit = critTurn('p1', 'e1', 'normal_blast', combat, false);
  let result = impactAt('p1', 'e1', { directTargetId: 'other', turn: nonCrit });
  const nonCritDamage = result.damage;
  assertClose(Math.abs(result.velocity.vx), 6);

  installed = installBattle({ p1Gears });
  combat = installed.state.battleGearSnapshotsByUnit.p1.derivedStats;
  const crit = critTurn('p1', 'e1', 'normal_blast', combat, true);
  result = impactAt('p1', 'e1', { directTargetId: 'other', turn: crit });
  assert(result.damage > nonCritDamage);
  assertClose(Math.abs(result.velocity.vx), 6);
});

test('self normal blast follows current CPU parity instead of inheriting Crit self exclusion', () => {
  const { state } = installBattle({ p1Gears: impactGears('self', ['barrel', 'armor', 'core', 'engine']) });
  const combat = state.battleGearSnapshotsByUnit.p1.derivedStats;
  const result = impactAt('p1', 'p1', { directTargetId: 'other' });
  const expected = gearCombat.knockbackPolicy({
    hitKind: 'blast_only', baseKnockback: 60,
    knockbackPowerBp: combat.knockbackPowerBp,
    knockbackResistanceBp: combat.knockbackResistanceBp
  }).normalProjectileAdditional.radial;
  assertClose(Math.abs(result.velocity.vx), expected);
});

test('Knockback adds no Math.random calls', () => {
  const randomCalls = (gears) => {
    installBattle({ p1Gears: gears });
    installAction('p1', 9);
    const target = kt.unitById('e1');
    const original = Math.random;
    let calls = 0;
    Math.random = () => { calls += 1; return 0.25; };
    try {
      kt.explodeAtForTest(target.x, target.y, 1, 'p1', true,
        projectile({ ownerId: 'p1', directTargetId: 'e1' }));
      return calls;
    } finally { Math.random = original; }
  };
  assert.equal(randomCalls(impactGears('random-impact4', ['barrel', 'armor', 'core', 'engine'])), randomCalls([]));

});

test('No Knockback wire or RNG field is introduced', () => {
  installBattle({ p1Gears: impactGears('two-v-two', ['barrel', 'armor']) });
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8');
  const rngSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-rng.js'), 'utf8');
  assert.doesNotMatch(rules, /knockbackPower|knockbackResistance|knockbackVx|knockbackVy|gearKnockback/);
  assert.doesNotMatch(rngSource, /knockback/i);
});

test('source contract keeps ONLINE snapshot selection, post-damage gating, and CPU fallback narrow', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const policyStart = index.indexOf('function battleGearKnockbackPolicyForCombat(');
  const policyEnd = index.indexOf('\n  function restoreCpuBattleGearSnapshot', policyStart);
  const policyBlock = index.slice(policyStart, policyEnd);
  assert.match(policyBlock, /onlineGearStaticCombatForUnit\(unitById\(ownerId\)\)/);
  assert.match(policyBlock, /onlineGearStaticCombatForUnit\(target\)/);
  assert.match(policyBlock, /return cpuGearKnockbackPolicy\(/);
  assert.match(policyBlock, /KatamonGearCombat/);
  assert.match(policyBlock, /combat\.knockbackPolicy\(/);
  assert.doesNotMatch(policyBlock, /statusResistanceBp|Math\.random|localStorage|participantGearReveals/);

  const applyStart = index.indexOf('function applyBattleGearKnockbackAfterDamage(');
  const applyEnd = index.indexOf('\n  function explodeAt(', applyStart);
  const applyBlock = index.slice(applyStart, applyEnd);
  assert.match(applyBlock, /if \(!\(actualDamage > 0\)\) return false/);
  assert.match(applyBlock, /battleGearKnockbackPolicy\(/);
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
  console.log(`gear-online-battle-knockback-phase3d5a: ${passed}/${cases.length} passed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
