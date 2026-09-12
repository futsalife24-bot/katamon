const assert = require('node:assert/strict');
const { kt } = require('./seatharness.js');
const boss = require('../coop-storm-boss.js');
const battle = globalThis.KatamonCoopBattle = require('../coop-mvp-battle.js');
const bridge = globalThis.KatamonCoopBridge;
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; }
function step(frames = 300) { for (let i = 0; i < frames; i++) kt().step(1 / 60); }
function start(id = boss.BOSS_ID) {
  return battle.startSoloBrowser({ bridge, characters: bridge.getBattleCharacters(), character: 'kyoryu', bossId: id, difficulty: 'normal' });
}
check('real solo entry starts without authentication/network', start());
step(240);
let state = bridge.getNormalBattleState();
check('storm is selected and uses dedicated large stage', state.bossId === boss.BOSS_ID && state.terrainPattern === 'stormAltar'
  && state.stageW === 2160 && state.stageH === 960);
check('all four allies and floating dragon exist', state.units.length === 5 && state.units.filter(u => u.team === 'player').length === 4);
const dragon = kt().unitById('boss1');
const initial = kt().snapshot();
const chars = bridge.getBattleCharacters();
const slots = { p1: { uid: 'local-solo', character: 'kyoryu', coopItem: 'rescue-kit' } };
const roster = battle.activeRoster(slots, true, chars);
const config = { bossId: boss.BOSS_ID, difficulty: 'normal', bossMaxHp: dragon.maxHp, registeredProtocol: 2 };
check('actual starting snapshot passes transport validation', battle.normalSnapshotLooksSafe(initial, roster, config, true));
check('storm entry also validates without registered content', battle.normalSnapshotLooksSafe(initial, roster, { ...config, registeredProtocol: null }, true));
const badTerrain = JSON.parse(JSON.stringify(initial)); badTerrain.segments[0][0][1] = 936;
check('storm terrain cannot choose its own bottom limit', !battle.normalSnapshotLooksSafe(badTerrain, roster, { ...config, registeredProtocol: null }, true));
const turnSnapshot=JSON.parse(JSON.stringify(initial));
delete turnSnapshot.segments;delete turnSnapshot.pattern;delete turnSnapshot.terrainMaterialSegments;
turnSnapshot.craters=[{x:500,y:500,r:52}];
check('destroyed altar platform permits next network turn', battle.normalSnapshotLooksSafe(turnSnapshot,roster,{...config,registeredProtocol:null},false));
turnSnapshot.craters[0].r=601;
check('oversized destruction rejected', !battle.normalSnapshotLooksSafe(turnSnapshot,roster,config,false));
turnSnapshot.craters=[{x:0,y:0,r:NaN}];
check('nonfinite destruction rejected', !battle.normalSnapshotLooksSafe(turnSnapshot,roster,config,false));
turnSnapshot.craters=Array.from({length:401},()=>({x:0,y:0,r:1}));
check('unbounded destruction rejected', !battle.normalSnapshotLooksSafe(turnSnapshot,roster,config,false));
check('storm snapshot cannot enter fortress room', !battle.normalSnapshotLooksSafe(initial, roster, { ...config, bossId: 'siege-fortress-01' }, true));
const bad = JSON.parse(JSON.stringify(initial)); bad.units[4].bossState.parts.thunderHorn.hp = -1;
check('forged parts rejected at transport boundary', !battle.normalSnapshotLooksSafe(bad, roster, config, true));
let rect = kt().stormTest.rect();
check('boss physically hovers clear of ground', rect.y + rect.height < dragon.y - 100);
for (const id of boss.PART_ORDER) {
  const part = boss.PART_DEFS[id], x = rect.x + rect.width * part.x, y = rect.y + rect.height * part.y;
  check(`${id} art circle and collision agree`, kt().stormTest.target(x, y).partId === id && kt().stormTest.bodyDistance(x, y) === 0);
}
check('alpha margin does not collide', kt().stormTest.bodyDistance(rect.x, rect.y) > 10);
const horn = boss.PART_DEFS.thunderHorn;
const beforeHp = dragon.hp, beforePart = dragon.bossState.parts.thunderHorn.hp;
kt().stormTest.shootAt(rect.x + rect.width * horn.x, rect.y + rect.height * horn.y);
step(20);
check('real projectile reduces targeted part and body only on impact', dragon.hp < beforeHp && dragon.bossState.parts.thunderHorn.hp < beforePart);

start(); step(240); kt().stormTest.setRound(1);
let shots = kt().stormTest.launchBoss();
check('crystal barrage spawns three real projectiles', shots.length === 3 && shots.every(p => p.owner === 'boss1'));
start(); step(240); kt().stormTest.setRound(2);
const hpBeforeCharge = kt().units.filter(u => u.team === 'player').map(u => u.hp);
shots = kt().stormTest.launchBoss();
check('charging uses a zero damage action', shots.length === 1 && shots[0].damageMul === 0);
step(300);
check('charging damages no ally', kt().units.filter(u => u.team === 'player').every((u,i) => u.hp === hpBeforeCharge[i]));
check('charging resolves to next ally and exposed heart', kt().unitById('boss1').bossState.core.exposed && bridge.getNormalBattleState().activeUnitId === 'p1');
start(); step(240); kt().stormTest.setRound(3);
shots = kt().stormTest.launchBoss();
check('lightning falls vertically at advertised fixed lanes', shots.length === 3 && shots.every((p,i) => p.x === [ .13,.29,.45 ][i]*2160 && p.vx === 0 && p.vy > 0 && p.stormLightning));
step(360);
check('lightning resolves and returns control', bridge.getNormalBattleState().activeUnitId === 'p1');
start(); step(240); kt().unitById('boss1').hp = 1;
rect = kt().stormTest.rect();
kt().stormTest.shootAt(rect.x + rect.width * .42, rect.y + rect.height * .62);
step(480);
check('real final hit reaches victory/result boundary', kt().stormTest.result().matchOver && kt().unitById('boss1').hp === 0);
start('siege-fortress-01'); step(240);
state = bridge.getNormalBattleState();
check('switching back restores fortress name, stage and four original parts', state.bossId === 'siege-fortress-01' && state.terrainPattern === 'coopSteel'
  && state.units[4].bossState.parts.mainCannon && state.units[4].bossState.parts.missilePod);
check('unknown boss is rejected', !start('unknown'));
console.log(`Storm runtime: ${checks}/${checks} passed`);
