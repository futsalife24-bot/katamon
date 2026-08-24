const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const boss = require('../coop-mvp-boss.js');

assert.equal(boss.BOSS_ID, 'siege-fortress-01');
assert.equal(boss.BOSS_NAME, '超大型要塞戦車');
assert.equal(boss.BOSS_ASSET_PATH, 'assets/bosses/runtime/fortress-tank.webp');
assert.equal(boss.BOSS_PHASE2_ASSET_PATH, 'assets/bosses/runtime/fortress-tank-phase2.webp');
assert.deepEqual(boss.PART_DURABILITY, {
  twinCannon: 0.8,
  mainCannon: 1,
  frontArmor: 1.4,
  missilePod: 0.9,
});

const stageA = boss.createFortressStage();
const stageB = boss.createFortressStage();
assert.deepEqual(stageA, stageB, 'ボス専用ステージはランダム要素なし');
assert.equal(stageA.stageWidth, 1440);
assert.equal(stageA.stageHeight, 660);
assert.equal(stageA.segments.length, 480);
assert.equal(stageA.materialSegments.length, 480);
assert.equal(stageA.boss.movable, false);
assert.ok(stageA.boss.x >= 800, 'ボスは右寄り固定');
assert.deepEqual(Object.keys(stageA.spawnMap), ['p1', 'e1', 's1', 's2']);
assert.ok(Object.values(stageA.spawnMap).every((spawn) => spawn.x < stageA.boss.x));
assert.ok(new Set(Object.values(stageA.spawnMap).map((spawn) => spawn.y)).size >= 3, '4席は左の高低差へ固定');
assert.equal(stageA.rescuePlatform.material, 'steel');
assert.equal(stageA.rescuePlatform.destructible, false);
assert.ok(stageA.rescuePlatform.x >= 0 && stageA.rescuePlatform.x + stageA.rescuePlatform.width <= stageA.stageWidth);
const rescueColumns = stageA.materialSegments.filter((column) => column.some((segment) => segment[2] === 'steel'));
assert.ok(rescueColumns.length > 0, 'DEAD LINE救済用の鋼鉄地形がある');

let state = boss.createBossState({ bodyHp: 5000, partUnitHp: 500 });
assert.equal(state.body.hp, 5000);
assert.equal(state.parts.twinCannon.hp, 400);
assert.equal(state.parts.mainCannon.hp, 500);
assert.equal(state.parts.frontArmor.hp, 700);
assert.equal(state.parts.missilePod.hp, 450);
assert.equal(state.parts.missilePod.active, false, 'ミサイルポッドはPhase2まで閉じる');

const placement = stageA.boss;
const mainPoint = boss.partCenter(placement, 'mainCannon');
let target = boss.resolveImpactTarget(state, placement, mainPoint, 44);
assert.equal(target.kind, 'part');
assert.equal(target.partId, 'mainCannon', '部位判定を本体より優先');

let result = boss.applyBossDamage(state, target, 100);
state = result.state;
assert.equal(state.parts.mainCannon.hp, 400);
assert.equal(state.body.hp, 4960, '未破壊部位は本体へ40%');
assert.equal(result.bodyDamage, 40);

result = boss.applyBossDamage(state, target, 999);
state = result.state;
assert.equal(state.parts.mainCannon.hp, 0);
assert.equal(state.parts.mainCannon.destroyed, true);
assert.equal(result.notification, 'MAIN CANNON DESTROYED');
assert.equal(result.bodyDamage, 399.6, '破壊時も追加本体ダメージなし');

target = boss.resolveImpactTarget(state, placement, mainPoint, 44);
assert.equal(target.kind, 'body', '破壊跡は本体100%判定');
result = boss.applyBossDamage(state, target, 100);
assert.equal(result.bodyDamage, 100);

const overlapPoint = {
  x: (boss.partCenter(placement, 'twinCannon').x + boss.partCenter(placement, 'frontArmor').x) / 2,
  y: (boss.partCenter(placement, 'twinCannon').y + boss.partCenter(placement, 'frontArmor').y) / 2,
};
target = boss.resolveImpactTarget(state, placement, overlapPoint, 220);
assert.equal(target.kind, 'part');
assert.ok(['twinCannon', 'frontArmor'].includes(target.partId), '爆風内で最も近い1部位だけ');

state = boss.activatePhase2(state);
assert.equal(state.phase, 2);
assert.equal(state.parts.missilePod.active, true);
const missilePoint = boss.partCenter(placement, 'missilePod');
assert.equal(boss.resolveImpactTarget(state, placement, missilePoint, 20).partId, 'missilePod');

const masterAsset = path.join(__dirname, '..', 'assets', 'bosses', 'master', 'fortress-tank.png');
const runtimeAsset = path.join(__dirname, '..', 'assets', 'bosses', 'runtime', 'fortress-tank.webp');
const phase2Asset = path.join(__dirname, '..', 'assets', 'bosses', 'runtime', 'fortress-tank-phase2.webp');
assert.ok(fs.existsSync(masterAsset));
assert.ok(fs.existsSync(runtimeAsset));
assert.ok(fs.existsSync(phase2Asset));
assert.ok(fs.statSync(runtimeAsset).size < fs.statSync(masterAsset).size / 5, '実行用素材をモバイル向けに軽量化');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const roomSource = fs.readFileSync(path.join(__dirname, '..', 'coop-mvp-room.js'), 'utf8');
assert.ok(html.indexOf('coop-mvp-boss.js') < html.indexOf('coop-mvp-engine.js'));
assert.match(sw, /assets\/bosses\/runtime\/fortress-tank\.webp/);
assert.match(sw, /assets\/bosses\/runtime\/fortress-tank-phase2\.webp/);
assert.match(sw, /coop-mvp-boss\.js/);
assert.match(roomSource, /超大型要塞戦車/);
assert.match(roomSource, /coop-boss-card/);

console.log('協力ボス本体・固定ステージ・部位優先判定（42/42 passed）');
