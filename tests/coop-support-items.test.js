const assert = require('node:assert/strict');

const foundation = require('../coop-mvp-foundation.js');
const survival = require('../coop-mvp-survival.js');
const items = require('../coop-mvp-items.js');

assert.equal(items.HEALING_USES, 2);
assert.equal(items.HEALING_RATIO, 0.3);
assert.equal(items.DEBUFF_USES, 1);
assert.equal(items.DEBUFF_MULTIPLIER, 1.25);
assert.equal(items.DEBUFF_DURATION_ROUNDS, 1);
assert.deepEqual(items.ITEM_PROJECTILES.healing, {
  ...survival.SUPPORT_PROJECTILE_PROFILE,
  guideColor: '#74d98b',
});
assert.deepEqual(items.ITEM_PROJECTILES.debuff, {
  ...survival.SUPPORT_PROJECTILE_PROFILE,
  guideColor: '#a873ff',
});

const healingCatalog = foundation.COOP_ITEMS.find((entry) => entry.id === 'healing-kit');
const debuffCatalog = foundation.COOP_ITEMS.find((entry) => entry.id === 'debuff-grenade');
assert.equal(healingCatalog.price, 100);
assert.equal(debuffCatalog.price, 200);

let party = survival.createParty({
  p1: { maxHp: 400, hp: 300, x: 100, y: 400, coopItem: 'healing-kit' },
  e1: { maxHp: 360, hp: 100, x: 220, y: 400, coopItem: 'rescue-kit' },
  s1: { maxHp: 300, hp: 0, status: 'down', x: 300, y: 400, coopItem: 'rescue-kit' },
}, 2);
assert.equal(party.players.p1.itemUses.healing, 2);

let healing = items.fireHealingShot(party, 'p1', { x: 101, y: 401 }, 2, 28);
party = healing.party;
assert.equal(healing.consumed, true);
assert.equal(healing.healedSeat, null, '自分には使用不可');
assert.equal(party.players.p1.hp, 300);
assert.equal(party.players.p1.itemUses.healing, 1);

healing = items.fireHealingShot(party, 'p1', { x: 220, y: 400 }, 2, 28);
party = healing.party;
assert.equal(healing.healedSeat, 'e1');
assert.equal(healing.healedAmount, 108);
assert.equal(party.players.e1.hp, 208, '最大HPの30%を回復');
assert.equal(party.players.p1.itemUses.healing, 0);

healing = items.fireHealingShot(party, 'p1', { x: 220, y: 400 }, 2, 28);
assert.equal(healing.consumed, false);
assert.equal(healing.reason, 'no-uses');

let downParty = survival.createParty({
  p1: { maxHp: 400, x: 100, y: 400, coopItem: 'healing-kit' },
  e1: { maxHp: 360, hp: 0, status: 'down', x: 220, y: 400 },
}, 1);
healing = items.fireHealingShot(downParty, 'p1', { x: 220, y: 400 }, 1, 28);
assert.equal(healing.consumed, true);
assert.equal(healing.healedSeat, null, 'ダウン者には効果なし');
assert.equal(healing.party.players.e1.hp, 0);

let debuffParty = survival.createParty({
  p1: { maxHp: 400, x: 100, y: 400, coopItem: 'debuff-grenade' },
  e1: { maxHp: 360, x: 220, y: 400, coopItem: 'debuff-grenade' },
}, 3);
let support = items.createSupportState();
let debuff = items.fireDebuffShot(debuffParty, support, 'p1', false, 3);
debuffParty = debuff.party;
support = debuff.support;
assert.equal(debuff.consumed, true);
assert.equal(debuff.applied, false, '外れた弱体化弾は効果なし');
assert.equal(debuffParty.players.p1.itemUses.debuff, 0);

debuff = items.fireDebuffShot(debuffParty, support, 'e1', true, 3);
debuffParty = debuff.party;
support = debuff.support;
assert.equal(debuff.applied, true);
assert.equal(support.bossVulnerability.beginsOnRound, 4);
assert.equal(items.bossDamageMultiplier(support, 3), 1, '命中ラウンドには乗らない');
assert.equal(items.bossDamageMultiplier(support, 4), 1.25, '次の1ラウンドだけ全員1.25倍');
assert.equal(items.bossDamageMultiplier(support, 5), 1);
assert.equal(items.scaleBossDamage(support, 4, 80, { kind: 'body' }), 100);
assert.equal(items.scaleBossDamage(support, 4, 80, { kind: 'part', partId: 'mainCannon' }), 100,
  '本体・部位どちらにも有効');

support = items.finishSupportRound(support, 4);
assert.equal(support.bossVulnerability.active, false);
assert.equal(items.bossDamageMultiplier(support, 4), 1);

assert.deepEqual(items.nonTargetImpactEffect(), {
  selfEffect: 0,
  downedAllyEffect: 0,
  enemyEffect: 0,
  bossDamage: 0,
  terrainDamage: 0,
});

console.log('協力アイテム回復弾・弱体化弾（44/44 passed）');
