const assert = require('node:assert/strict');
const {kt} = require('./seatharness.js');
const battle = globalThis.KatamonCoopBattle = require('../coop-mvp-battle.js');
const bridge = globalThis.KatamonCoopBridge;
let now = 100000, checks=0;
function check(value,message){assert.ok(value,message);checks++;}
function step(frames=1){for(let i=0;i<frames;i++){now+=1000/60;kt().step(1/60);}}
function start(){battle.startSoloBrowser({bridge,characters:bridge.getBattleCharacters(),character:'kyoryu',bossId:'storm-dragon-02'});kt().salvoTest.clock(()=>now);step(240);}
start();
let state=bridge.getNormalBattleState();
check(state.inputReady,'human can aim while all AI prepare');
const aiBefore=state.units.filter(u=>u.id!=='p1'&&u.id!=='boss1').map(u=>u.x);
step(180);state=bridge.getNormalBattleState();
check(state.salvo.ready===3,'all AI ready without waiting for human');
check(state.inputReady,'AI ready never takes away local input');
check(state.projectiles.length===0,'no shot before all ready or deadline');
check(kt().salvoTest.ready(),'human commits');
check(!kt().salvoTest.ready(),'duplicate ready rejected');
step(1);state=bridge.getNormalBattleState();
check(state.salvo.launchTicks.length===4&&state.salvo.launchTicks.every(n=>n===0),'all four fire on tick zero');
for(let i=0;i<1800&&!bridge.getNormalBattleState().inputReady;i++)step();
state=bridge.getNormalBattleState();
check(state.inputReady&&state.turnCount>=5,'boss resolves then next shared round opens');
start(); step(180);const prior=bridge.getNormalBattleState().turnCount;
now+=31000;kt().salvoTest.menu(true);step(1);state=bridge.getNormalBattleState();
check(state.salvo.phase==='resolving','menu does not pause common deadline');
check(state.salvo.launchTicks.length===3,'timeout fires only ready allies');
check(!kt().salvoTest.ready(),'late ready rejected');
kt().salvoTest.menu(false);
start(); kt().salvoTest.freezeAI();
const me=kt().unitById('p1');
const readyX=me.x;
check(kt().salvoTest.ready(),'ready before other members');
kt().salvoTest.move(1);step(60);
check(me.x===readyX,'ready locks movement while others prepare');
check(!kt().salvoTest.input(),'ready locks repeated input');
start(); kt().salvoTest.freezeAI();
kt().unitById('e1').hp=0;kt().unitById('p2').actionSkipTurns=1;kt().salvoTest.reopen();
check(bridge.getNormalBattleState().salvo.total===2,'down/stunned allies excluded from ready total');
check(!kt().salvoTest.ready('e1'),'down unit cannot commit');
check(!kt().salvoTest.ready('p2'),'stunned unit cannot commit');
// Every equipped support/subweapon remains selectable under the new collection phase.
for(const [kind,id] of [['coopItem','healing-kit'],['coopItem','debuff-grenade'],['subweapon','barrier']]){
 start();kt().salvoTest.freezeAI();const u=kt().unitById('p1');u[kind]=id;u[kind+'UsesLeft']=1;
 check(!kt().salvoTest.ready(undefined,{[kind+'Id']:id,useSpecial:true}),'combined action rejected');
 check(kt().salvoTest.ready(undefined,{[kind+'Id']:id}),id+' can be committed');
 now+=31000;step(2);
 check(u[kind+'UsesLeft']===0,id+' consumes exactly once on launch');
}
start();step(180);kt().unitById('boss1').hp=1;kt().salvoTest.ready();step(1);
const rect=kt().stormTest.rect();kt().stormTest.shootAt(rect.x+rect.width*.42,rect.y+rect.height*.62);step(5);
check(kt().unitById('boss1').hp===0&&!kt().stormTest.result().matchOver,'lethal hit waits for remaining simultaneous projectiles');
step(900);
check(kt().stormTest.result().matchOver&&bridge.getNormalBattleState().phase==='results','salvo victory reaches result once');
console.log('Coop simultaneous solo:',checks,'passed');
