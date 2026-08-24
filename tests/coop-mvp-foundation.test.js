const assert = require('node:assert/strict');

const foundation = require('../coop-mvp-foundation.js');

const {
  STORAGE_KEY,
  SCHEMA_VERSION,
  COIN_CAP,
  DIFFICULTIES,
  COOP_ITEMS,
  SUBWEAPONS,
  COSMETICS,
  createDefaultState,
  normalizeState,
  isFeatureEnabled,
  grantCoins,
} = foundation;

assert.equal(STORAGE_KEY, 'katamon_coop_mvp_v1');
assert.equal(SCHEMA_VERSION, 1);
assert.equal(COIN_CAP, 9999);
assert.deepEqual(DIFFICULTIES.map(({ id, coreExposeRounds }) => ({ id, coreExposeRounds })), [
  { id: 'normal', coreExposeRounds: 2 },
  { id: 'hard', coreExposeRounds: 2 },
  { id: 'extreme', coreExposeRounds: 1 },
]);
assert.deepEqual(DIFFICULTIES.map(({ id, roundLimit }) => ({ id, roundLimit })), [
  { id: 'normal', roundLimit: 12 },
  { id: 'hard', roundLimit: 15 },
  { id: 'extreme', roundLimit: 12 },
]);
assert.deepEqual(COOP_ITEMS.map(({ id, usesPerMatch }) => ({ id, usesPerMatch })), [
  { id: 'rescue-kit', usesPerMatch: 1 },
  { id: 'healing-kit', usesPerMatch: 2 },
  { id: 'debuff-grenade', usesPerMatch: 1 },
]);
assert.deepEqual(SUBWEAPONS.map((entry) => entry.id), ['barrier', 'impact', 'drill']);
assert.equal(COSMETICS.length, 3);

const defaults = createDefaultState();
assert.equal(defaults.schemaVersion, SCHEMA_VERSION);
assert.equal(defaults.wallet.coins, 0);
assert.equal(defaults.equipment.coopItem, 'rescue-kit');
assert.equal(defaults.equipment.subweapon, null);
assert.equal(defaults.inventory['rescue-kit'], true);
assert.deepEqual(defaults.boss.unlockedDifficulties, ['normal']);

const sanitized = normalizeState({
  schemaVersion: -5,
  wallet: { coins: 50000 },
  inventory: { 'rescue-kit': false, barrier: true, unknown: true },
  equipment: { coopItem: 'unknown', subweapon: 'unknown', cosmetic: 'unknown' },
  boss: { unlockedDifficulties: ['normal', 'extreme', 'unknown', 'normal'] },
  rewardLedger: { alpha: true, bad: false },
});
assert.equal(sanitized.schemaVersion, SCHEMA_VERSION);
assert.equal(sanitized.wallet.coins, COIN_CAP);
assert.equal(sanitized.inventory['rescue-kit'], true, '救助キットは初期所持から外せない');
assert.equal(sanitized.inventory.barrier, true);
assert.equal(sanitized.inventory.unknown, undefined);
assert.equal(sanitized.equipment.coopItem, 'rescue-kit');
assert.equal(sanitized.equipment.subweapon, null);
assert.equal(sanitized.equipment.cosmetic, null);
assert.deepEqual(sanitized.boss.unlockedDifficulties, ['normal', 'extreme']);
assert.deepEqual(sanitized.rewardLedger, { alpha: true });

assert.equal(isFeatureEnabled({ hostname: 'futsalife24-bot.github.io', search: '' }, {}), true,
  '公開ホストでは協力ボスを標準で有効にする');
assert.equal(isFeatureEnabled({ hostname: 'futsalife24-bot.github.io', search: '?coopMvp=1' }, { coopBossMvp: false }), false,
  '公開後も明示フラグで緊急停止できる');
assert.equal(isFeatureEnabled({ hostname: '127.0.0.1', search: '' }, {}), true,
  '公開ON後は開発ホストでも標準で有効にする');
assert.equal(isFeatureEnabled({ hostname: '127.0.0.1', search: '?coopMvp=1' }, {}), true);
assert.equal(isFeatureEnabled({ hostname: '192.168.1.10', search: '' }, { coopBossMvp: true }), true);

const firstGrant = grantCoins(createDefaultState(), 12000, 'first-clear-normal');
assert.equal(firstGrant.state.wallet.coins, COIN_CAP);
assert.equal(firstGrant.credited, COIN_CAP);
assert.equal(firstGrant.duplicate, false);
const duplicateGrant = grantCoins(firstGrant.state, 500, 'first-clear-normal');
assert.equal(duplicateGrant.state.wallet.coins, COIN_CAP);
assert.equal(duplicateGrant.credited, 0);
assert.equal(duplicateGrant.duplicate, true);

console.log('協力ボスMVP基盤: 機能フラグ・保存形式・カタログ・報酬台帳（26/26 passed）');
