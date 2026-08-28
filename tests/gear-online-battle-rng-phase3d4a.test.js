const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gearCombat = require('../shared/gear-combat.js');
const onlineDamage = require('../shared/gear-online-battle-damage.js');
const onlineRng = require('../shared/gear-online-battle-rng.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const roomId = 'A2BC3DEF';
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const nextRoundId = '1123456789abcdef0123456789abcdef0123456789abcdef';
let passed = 0;
const cases = [];
const test = (name, fn) => { cases.push([name, fn]); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeEol = (text) => text.replace(/\r\n?/g, '\n');
const readIndexSource = () => normalizeEol(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));

function actionIdentity(overrides = {}) {
  return onlineRng.createOnlineGearActionIdentity({
    version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
    roomId,
    roundId,
    turnOrdinal: 7,
    sourceUnitId: 'p1',
    ...overrides
  });
}

function critIdentity(overrides = {}) {
  return {
    version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
    namespace: onlineRng.ONLINE_GEAR_CRIT_RNG_NAMESPACE,
    roomId,
    roundId,
    turnOrdinal: 7,
    authoritativeActionOrdinal: 7,
    sourceUnitId: 'p1',
    targetUnitId: 'e1',
    effectKind: 'crit',
    damageType: 'direct_projectile',
    hitOrdinal: 0,
    ...overrides
  };
}

function statusIdentity() {
  return {
    version: onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION,
    namespace: onlineRng.ONLINE_GEAR_STATUS_RNG_NAMESPACE,
    roomId,
    roundId,
    turnOrdinal: 7,
    authoritativeActionOrdinal: 7,
    sourceUnitId: 'p1',
    targetUnitId: 'e1',
    effectKind: 'status',
    statusId: 'burn',
    hitOrdinal: 0
  };
}

function frozenBattleMap() {
  const unit = () => Object.freeze({ derivedStats: Object.freeze({}) });
  return Object.freeze({ p1: unit(), e1: unit() });
}

function installRuntime({ gear = true, format = '1v1', role = 'host', turn = 7 } = {}) {
  kt.setMatchFormatForTest('1v1');
  kt.setCharactersForTest('kyoryu', 'iwa');
  h.resetMatchForTest();
  kt.setMatchFormatForTest(format);
  h.setActiveUnitForTest('p1');
  kt.setTurnCountForTest(turn);
  const online = {
    kind: 'firebase', role, phase: 'battle', room: roomId, currentRoundId: roundId,
    battleGearSnapshotsByUnit: gear ? frozenBattleMap() : null
  };
  h.setOnlineForLogTest(online);
  return online;
}

test('v1 constants, Crit/Status namespaces, unit/damage domains are fixed and frozen', () => {
  assert.equal(onlineRng.ONLINE_GEAR_BATTLE_RNG_VERSION, 1);
  assert.equal(onlineRng.ONLINE_GEAR_RNG_HASH_ALGORITHM, 'fnv1a64-ascii-v1');
  assert.notEqual(onlineRng.ONLINE_GEAR_CRIT_RNG_NAMESPACE, onlineRng.ONLINE_GEAR_STATUS_RNG_NAMESPACE);
  assert.deepEqual(onlineRng.ONLINE_GEAR_RNG_UNIT_IDS, ['p1', 'e1', 'p2', 'e2']);
  assert.deepEqual(onlineRng.ONLINE_GEAR_RNG_DAMAGE_TYPES, ['direct_projectile', 'normal_blast']);
  assert.equal(Object.isFrozen(onlineRng.ONLINE_GEAR_RNG_UNIT_IDS), true);
});

test('current Firebase 1v1 action identity derives the accepted action ordinal from the pre-fire turn', () => {
  const identity = actionIdentity();
  assert.deepEqual(identity, {
    version: 1, roomId, roundId, turnOrdinal: 7, authoritativeActionOrdinal: 7, sourceUnitId: 'p1'
  });
  assert.equal(onlineRng.deriveAuthoritativeActionOrdinal({ turnOrdinal: 7 }), 7);
  assert.equal(Object.isFrozen(identity), true);
});

test('canonical Crit key and basis-point roll are deterministic across host/guest clones', () => {
  const host = critIdentity();
  const guest = clone(host);
  const expectedKey = 'fnv1a64-ascii-v1|version=1|namespace=online-gear-crit:v1|room=A2BC3DEF|round=0123456789abcdef0123456789abcdef0123456789abcdef|turn=7|action=7|source=p1|target=e1|effect=crit|damageType=direct_projectile|hit=0';
  assert.equal(onlineRng.canonicalOnlineGearRngKey(host), expectedKey);
  assert.equal(onlineRng.canonicalOnlineGearRngKey(guest), expectedKey);
  assert.equal(onlineRng.rollBasisPoints(host), onlineRng.rollBasisPoints(guest));
  assert.equal(onlineRng.rollBasisPoints(host), 5220); // exact fixture updated only with an intentional algorithm/version change
  assert(onlineRng.rollBasisPoints(host) >= 0 && onlineRng.rollBasisPoints(host) < 10000);
});

test('every canonical identity dimension has a distinct key namespace', () => {
  const baseKey = onlineRng.canonicalOnlineGearRngKey(critIdentity());
  const variants = [
    critIdentity({ roomId: 'B2BC3DEF' }),
    critIdentity({ roundId: nextRoundId }),
    critIdentity({ turnOrdinal: 8 }),
    critIdentity({ authoritativeActionOrdinal: 8 }),
    critIdentity({ sourceUnitId: 'e1', targetUnitId: 'p1' }),
    critIdentity({ damageType: 'normal_blast' }),
    critIdentity({ hitOrdinal: 1 }),
    statusIdentity()
  ];
  for (const variant of variants) assert.notEqual(onlineRng.canonicalOnlineGearRngKey(variant), baseKey);
});

test('actionId is rejected as RNG input and sender nonce changes cannot affect canonical identity', () => {
  assert.throws(() => onlineRng.rollBasisPoints({ ...critIdentity(), actionId: 'sender-nonce-a' }),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_INPUT');
  const senderA = { actionId: 'sender-nonce-a', identity: critIdentity() };
  const senderB = { actionId: 'sender-nonce-b', identity: critIdentity() };
  assert.equal(onlineRng.canonicalOnlineGearRngKey(senderA.identity), onlineRng.canonicalOnlineGearRngKey(senderB.identity));
  assert.equal(onlineRng.rollBasisPoints(senderA.identity), onlineRng.rollBasisPoints(senderB.identity));
});

test('strict schema, identity formats, self target, and unsupported versions fail closed', () => {
  assert.throws(() => onlineRng.createOnlineGearActionIdentity({ ...clone(actionIdentity()), extra: true }),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_ACTION_IDENTITY_INPUT');
  assert.throws(() => onlineRng.rollBasisPoints(critIdentity({ version: 2 })),
    (error) => error?.code === 'UNSUPPORTED_ONLINE_GEAR_BATTLE_RNG_VERSION');
  assert.throws(() => onlineRng.rollBasisPoints(critIdentity({ roomId: 'bad-room' })),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_ROOM_ID');
  assert.throws(() => onlineRng.rollBasisPoints(critIdentity({ roundId: 'A'.repeat(48) })),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_ROUND_ID');
  assert.throws(() => onlineRng.rollBasisPoints(critIdentity({ targetUnitId: 'p1' })),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_SELF_TARGET');
  assert.throws(() => onlineRng.rollBasisPoints(critIdentity({ turnOrdinal: -1 })),
    (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_TURN_ORDINAL');
});

test('runtime host/guest derive identical action identity without mutation; next turn and rematch separate it', () => {
  installRuntime({ role: 'host', turn: 7 });
  const host = wiring.rngActionIdentity('p1');
  const duplicate = wiring.rngActionIdentity('p1');
  installRuntime({ role: 'guest', turn: 7 });
  const guest = wiring.rngActionIdentity('p1');
  assert.deepEqual(host, guest);
  assert.deepEqual(host, duplicate);

  installRuntime({ role: 'host', turn: 8 });
  assert.notDeepEqual(wiring.rngActionIdentity('p1'), host);
  const rematch = onlineRng.createOnlineGearActionIdentity({
    version: host.version, roomId: host.roomId, roundId: nextRoundId,
    turnOrdinal: host.turnOrdinal, sourceUnitId: host.sourceUnitId
  });
  assert.notDeepEqual(rematch, host);
});

test('runtime seam is inactive Gear OFF and rejects a non-active source', () => {
  installRuntime({ gear: false });
  assert.equal(wiring.rngActionIdentity('p1'), null);
  installRuntime();
  assert.throws(() => wiring.rngActionIdentity('e1'), (error) => error?.code === 'INVALID_ONLINE_GEAR_RNG_ACTION_SOURCE');
});

test('Phase 3D-4A does not activate Crit, Blast, runtime effects, shield, or Math.random', () => {
  const base = gearCombat.calculateBattleGearCombat({ battleGears: [], baseHp: 100, baseFuel: 100 });
  const highFutureStats = clone(base);
  highFutureStats.critRateBp = 10000;
  highFutureStats.critDamageMultiplier = 99;
  highFutureStats.blastDamageMultiplier = 99;
  highFutureStats.blastRangeMultiplier = 99;
  highFutureStats.conditional.lastStandLowHpAttackBp = 9999;
  highFutureStats.conditional.rescueNextAttackDamageBp = 9999;
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0; };
  try {
    const before = onlineDamage.calculateOnlineGearStaticRequestedDamage({
      existingBaseDamage: 45, damageType: 'normal_blast', attackerCombat: base, defenderCombat: base, targetHp: 100
    });
    const after = onlineDamage.calculateOnlineGearStaticRequestedDamage({
      existingBaseDamage: 45, damageType: 'normal_blast', attackerCombat: highFutureStats, defenderCombat: base, targetHp: 100
    });
    onlineRng.rollBasisPoints(critIdentity());
    assert.equal(after, before);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(randomCalls, 0);
});

test('local and accepted remote actions retain only local canonical RNG identity; Firebase packet schema is unchanged', () => {
  const index = readIndexSource();
  const localBlock = /function netSendFire\([\s\S]+?\n  }\n\n/.exec(index)?.[0] || '';
  assert.match(localBlock, /online\.localAction = \{[^\n]+gearRngActionIdentity/);
  assert.match(index, /online\.remoteAction = \{[\s\S]{0,300}gearRngActionIdentity/);
  assert.doesNotMatch(localBlock, /netSend\(\{[\s\S]{0,500}gearRngActionIdentity/);
  assert.match(index, /turnOrdinal: turnCount/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'), /gearRngActionIdentity|authoritativeActionOrdinal/);
});

test('fire lifecycle captures before transport nonce and does not advance ordinal on fire/state/result receipt', () => {
  const index = readIndexSource();
  const localStart = index.indexOf('function netSendFire(');
  const localEnd = index.indexOf('\n  function ', localStart + 20);
  const localBlock = index.slice(localStart, localEnd);
  assert(localBlock.indexOf('createFirebaseOnlineGearRngActionIdentity') < localBlock.indexOf('secureNonce()'));
  assert(localBlock.indexOf('secureNonce()') < localBlock.indexOf('netSend({'));

  const fireStart = index.indexOf("case 'fire': {");
  const fireEnd = index.indexOf("case 'move': {", fireStart);
  const terminalEnd = index.indexOf("case 'bye':", fireEnd);
  const acceptedActionBlock = index.slice(fireStart, terminalEnd);
  assert.match(acceptedActionBlock, /createFirebaseOnlineGearRngActionIdentity\(msg\.unitId\)/);
  assert.doesNotMatch(acceptedActionBlock, /turnCount\s*(?:\+\+|--|[+\-]=)/);
  assert.match(index, /function endTurn\([\s\S]+?turnCount\+\+/);
});

test('browser and APP_SHELL load the pure ONLINE RNG module after static damage without CPU RNG reuse', () => {
  const index = readIndexSource();
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert(index.indexOf('shared/gear-online-battle-damage.js') < index.indexOf('shared/gear-online-battle-rng.js'));
  assert.equal(sw.includes("'./shared/gear-online-battle-rng.js'"), true);
  const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gear-online-battle-rng.js'), 'utf8');
  assert.doesNotMatch(moduleSource, /runId|matchOrdinal|Math\.random|actionId\s*:/);
  assert.doesNotMatch(moduleSource, /require\(['"]\.\/gear-battle-rng\.js['"]\)/);
});

async function main() {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok ${name}`);
    } finally {
      h.setOnlineForLogTest(null);
      kt.setMatchFormatForTest('1v1');
    }
  }
  console.log(`Gear ONLINE Battle RNG Phase 3D-4A: ${passed}/${cases.length} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
