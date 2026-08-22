const assert = require('node:assert/strict');

const boss = require('../coop-mvp-boss.js');
const survival = require('../coop-mvp-survival.js');

assert.equal(survival.RESCUE_USES, 2);
assert.equal(survival.REVIVE_RATIO, 0.3);
assert.deepEqual(survival.SUPPORT_PROJECTILE_PROFILE, {
  gravity: 650,
  velocityScale: 7.8,
  affectedByWind: true,
  guide: 'normal',
  terrainCollision: true,
  terrainDamage: 0,
});

let party = survival.createParty({
  p1: { maxHp: 400, x: 180, y: 500 },
  e1: { maxHp: 360, x: 330, y: 460 },
  s1: { maxHp: 300, x: 480, y: 520 },
}, 1);
assert.deepEqual(Object.keys(party.players), ['p1', 'e1', 's1']);
assert.equal(party.players.p1.itemUses.rescue, 2);
assert.equal(survival.canAct(party.players.p1, 1), true);

let hit = survival.applyPlayerDamage(party, 'e1', { damage: 500, knockback: { x: -30, y: -12 } });
party = hit.party;
assert.equal(party.players.e1.hp, 0);
assert.equal(party.players.e1.status, 'down');
assert.equal(hit.downedNow, true);
assert.equal(survival.canAct(party.players.e1, 1), false);
assert.deepEqual(survival.normalBossTargets(party), ['p1', 's1'], '通常攻撃はダウン者を狙わない');
assert.deepEqual(survival.areaBossTargets(party), ['p1', 'e1', 's1'], '広範囲攻撃はダウン者も巻き込む');

const downHp = party.players.e1.hp;
hit = survival.applyPlayerDamage(party, 'e1', { damage: 99, knockback: { x: 44, y: -20 } });
party = hit.party;
assert.equal(hit.hpDamage, 0, 'ダウン中は追加ダメージなし');
assert.equal(party.players.e1.hp, downHp);
assert.deepEqual(hit.knockback, { x: 44, y: -20 }, 'ダウン中もノックバックあり');

const stage = boss.createFortressStage();
party.players.e1.x = 900;
party.players.e1.y = stage.terrainBottom + 30;
let relocation = survival.relocateFromDeadLine(party, 'e1', stage);
party = relocation.party;
assert.equal(relocation.relocated, true);
assert.equal(relocation.usedFallback, false);
assert.ok(party.players.e1.y < stage.terrainBottom);
assert.equal(party.players.e1.status, 'down');
assert.equal(party.players.e1.hp, 0, 'DEAD LINE救済は復活ではない');

const destroyedStage = { ...stage, segments: stage.segments.map(() => []) };
party.players.e1.y = stage.terrainBottom + 30;
relocation = survival.relocateFromDeadLine(party, 'e1', destroyedStage);
party = relocation.party;
assert.equal(relocation.usedFallback, true);
assert.equal(party.players.e1.x, stage.rescuePlatform.x + stage.rescuePlatform.width / 2);
assert.equal(party.players.e1.status, 'down');

party.players.e1.x = 330;
party.players.e1.y = 460;
let shot = survival.fireRescueShot(party, 'p1', { x: 332, y: 459 }, 2, 48);
party = shot.party;
assert.equal(shot.consumed, true);
assert.equal(shot.rescuedSeat, 'e1');
assert.equal(party.players.p1.itemUses.rescue, 1);
assert.equal(party.players.e1.status, 'alive');
assert.equal(party.players.e1.hp, 108, '最大HPの30%で復活');
assert.equal(survival.canAct(party.players.e1, 2), false, '復活ラウンドは攻撃しない');
assert.equal(survival.canAct(party.players.e1, 3), true, '次ラウンドから行動');

shot = survival.fireRescueShot(party, 'p1', { x: 332, y: 459 }, 2, 48);
party = shot.party;
assert.equal(shot.consumed, true, '重なった後続救助弾も回数を消費');
assert.equal(shot.rescuedSeat, null, '最初の有効弾だけが復活させる');
assert.equal(party.players.p1.itemUses.rescue, 0);
assert.equal(party.players.e1.hp, 108);

shot = survival.fireRescueShot(party, 'p1', { x: 480, y: 520 }, 3, 48);
assert.equal(shot.consumed, false, '使用回数0なら発射不可');
assert.equal(shot.reason, 'no-uses');

let defeatParty = survival.createParty({
  p1: { maxHp: 100, x: 100, y: 500 },
  e1: { maxHp: 100, x: 200, y: 500 },
}, 1);
assert.equal(survival.isAllDownDefeat(defeatParty), false);
defeatParty = survival.applyPlayerDamage(defeatParty, 'p1', { damage: 100 }).party;
assert.equal(survival.isAllDownDefeat(defeatParty), false);
defeatParty = survival.applyPlayerDamage(defeatParty, 'e1', { damage: 100 }).party;
assert.equal(survival.isAllDownDefeat(defeatParty), true, '全員同時ダウンで敗北');

const harmless = survival.supportImpactEffect();
assert.deepEqual(harmless, { bossDamage: 0, enemyDamage: 0, terrainDamage: 0 });

console.log('協力戦ダウン・DEAD LINE救済・救助弾（46/46 passed）');
