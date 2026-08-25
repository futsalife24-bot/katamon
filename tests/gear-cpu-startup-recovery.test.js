// Phase 2C startup must recover a pending enhancement WAL before the CPU
// shell becomes ready.  Each case runs in a fresh Node process: seatharness
// consumes __KATAMON_TEST_INITIAL_STORAGE__ before evaluating index.html, so
// these assertions exercise the real bootstrap ordering rather than a
// post-startup test hook.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const gear = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const foundation = require('../coop-mvp-foundation.js');
const transactions = require('../shared/gear-transactions.js');

const RESULT_PREFIX = 'PHASE2C_STARTUP_RESULT=';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeGear(id) {
  return gear.createGear({
    gearId: id,
    generationSeed: `startup:${id}:generation`,
    enhancementSeed: `startup:${id}:enhancement`,
    sourceId: 'startup-recovery-test',
    sourceDetail: { fixture: 'startup-recovery' },
    acquiredAt: '2026-08-26T00:00:00.000Z',
    qualityProfile: {
      id: 'startup-quality',
      starWeights: [{ id: 6, weight: 1 }],
      rarityWeights: [{ id: 'mythic', weight: 1 }],
    },
    setProfile: { id: 'startup-set', setWeights: [{ id: 'assault', weight: 1 }] },
    slotId: 'engine',
  });
}

function makeFoundationRaw(coins) {
  const state = foundation.createDefaultState();
  state.wallet.coins = coins;
  state.startupFixture = { preserved: true };
  return JSON.stringify(state);
}

function makePendingJournal() {
  const beforeGear = makeGear('startup-wal-gear');
  const targetLevel = 3;
  const beforePowder = 999;
  const beforeCoins = 999;
  const cost = gear.calculateEnhancementCost(beforeGear.enhancementLevel, targetLevel);
  const foundationRawBefore = makeFoundationRaw(beforeCoins);
  const afterFoundation = JSON.parse(foundationRawBefore);
  afterFoundation.wallet.coins -= cost.coins;
  const journal = {
    schemaVersion: transactions.GEAR_TRANSACTION_SCHEMA_VERSION,
    transactionId: 'startup-wal-transaction',
    kind: transactions.ENHANCE_KIND,
    createdAtMs: 123456,
    gearId: beforeGear.gearId,
    fromLevel: beforeGear.enhancementLevel,
    targetLevel,
    powderBefore: beforePowder,
    powderAfter: beforePowder - cost.powder,
    coinBefore: beforeCoins,
    coinAfter: beforeCoins - cost.coins,
    gearBefore: beforeGear,
    gearAfter: gear.enhanceGear(beforeGear, targetLevel),
    foundationRawBefore,
    foundationRawAfter: JSON.stringify(afterFoundation),
  };
  return { beforeGear, journal, cost };
}

function makeInitialStorage(kind) {
  if (kind === 'malformed') {
    return {
      [transactions.GEAR_TRANSACTION_STORAGE_KEY]: '{',
      'startup-sentinel': 'unchanged',
    };
  }

  const { beforeGear, journal } = makePendingJournal();
  const state = gearStorage.createDefaultGearStorageState();
  state.inventory.push({ gear: beforeGear, locked: false, favorite: false });
  state.resources.powder = kind === 'conflict' ? journal.powderBefore + 1 : journal.powderBefore;
  return {
    [gearStorage.GEAR_STORAGE_KEY]: gearStorage.encodeGearStorageState(state),
    [foundation.STORAGE_KEY]: journal.foundationRawBefore,
    [transactions.GEAR_TRANSACTION_STORAGE_KEY]: transactions.encodeJournal(journal),
    'startup-sentinel': 'unchanged',
  };
}

async function runChildScenario(kind) {
  globalThis.__KATAMON_TEST_INITIAL_STORAGE__ = makeInitialStorage(kind);
  const { kt } = require('./seatharness.js');
  const before = {
    gear: globalThis.localStorage.getItem(gearStorage.GEAR_STORAGE_KEY),
    foundation: globalThis.localStorage.getItem(foundation.STORAGE_KEY),
    wal: globalThis.localStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY),
  };
  let recoveryError = null;
  try {
    await kt().cpuGearRecoveryPromiseForTest();
  } catch (error) {
    recoveryError = error && error.code ? error.code : String(error);
  }
  const after = {
    gear: globalThis.localStorage.getItem(gearStorage.GEAR_STORAGE_KEY),
    foundation: globalThis.localStorage.getItem(foundation.STORAGE_KEY),
    wal: globalThis.localStorage.getItem(transactions.GEAR_TRANSACTION_STORAGE_KEY),
    sentinel: globalThis.localStorage.getItem('startup-sentinel'),
  };
  const result = {
    kind,
    recoveryError,
    persistence: kt().cpuGearPersistenceForTest(),
    before,
    after,
  };
  if (kind === 'valid') {
    const state = gearStorage.loadGearState(globalThis.localStorage);
    result.gearLevel = state.inventory[0].gear.enhancementLevel;
    result.powder = state.resources.powder;
    result.coins = transactions.loadStrictFoundationState(globalThis.localStorage).state.wallet.coins;
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

function spawnScenario(kind) {
  const child = spawnSync(process.execPath, [__filename, '--child', kind], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, `${kind} child failed:\n${child.stdout}\n${child.stderr}`);
  const line = child.stdout.split(/\r?\n/).find((value) => value.startsWith(RESULT_PREFIX));
  assert.ok(line, `${kind} result marker missing:\n${child.stdout}`);
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

function expectValidRecovery() {
  const result = spawnScenario('valid');
  const { journal } = makePendingJournal();
  assert.equal(result.recoveryError, null);
  assert.equal(result.persistence.state, 'ready');
  assert.equal(result.after.wal, null, 'successful startup recovery removes the WAL');
  assert.equal(result.gearLevel, journal.targetLevel);
  assert.equal(result.powder, journal.powderAfter);
  assert.equal(result.coins, journal.coinAfter);
  assert.equal(result.after.sentinel, 'unchanged');
}

function expectMalformedBarrier() {
  const result = spawnScenario('malformed');
  assert.equal(result.recoveryError, 'TRANSACTION_JOURNAL_JSON_PARSE_FAILED');
  assert.equal(result.persistence.state, 'blocked');
  assert.equal(result.after.wal, result.before.wal, 'malformed WAL is retained for explicit recovery');
  assert.equal(result.after.gear, result.before.gear);
  assert.equal(result.after.foundation, result.before.foundation);
  assert.equal(result.after.sentinel, 'unchanged');
}

function expectConflictBarrier() {
  const result = spawnScenario('conflict');
  assert.equal(result.recoveryError, 'TRANSACTION_CONFLICT');
  assert.equal(result.persistence.state, 'blocked');
  assert.equal(result.after.wal, result.before.wal, 'conflicting WAL is never deleted at startup');
  assert.equal(result.after.gear, result.before.gear, 'startup conflict must not rewrite the Gear side');
  assert.equal(result.after.foundation, result.before.foundation, 'startup conflict must not rewrite the coin side');
  assert.equal(result.after.sentinel, 'unchanged');
}

if (process.argv[2] === '--child') {
  runChildScenario(process.argv[3]).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
} else {
  expectValidRecovery();
  expectMalformedBarrier();
  expectConflictBarrier();
  console.log('Phase 2C startup WAL recovery: 3/3 passed');
}
