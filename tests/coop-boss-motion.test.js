const assert = require('node:assert/strict');
const {kt} = require('./seatharness.js');
const battle = globalThis.KatamonCoopBattle = require('../coop-mvp-battle.js');
const bridge = globalThis.KatamonCoopBridge;
let checks=0, now=100000;
function check(value,label){assert.ok(value,label);checks++;}
function step(n=1){for(let i=0;i<n;i++){now+=1000/60;kt().step(1/60);}}
for(const bossId of ['siege-fortress-01','storm-dragon-02']) {
  battle.startSoloBrowser({bridge,characters:bridge.getBattleCharacters(),character:'kyoryu',bossId});
  kt().salvoTest.clock(()=>now);step(240);
  const m=kt().bossMotionTest;
  check(m.locked(),'preparation locks '+bossId);
  const boss=kt().unitById('boss1'), before=JSON.stringify(boss.bossState);
  const neutral=m.point(.33,.075);
  m.bossTurn();m.advance(.6);
  check(!m.locked() && m.point(.33,.075).y!==neutral.y,'boss turn animates '+bossId);
  check(JSON.stringify(boss.bossState)===before,'animation never mutates authoritative boss state');
  for(const phase of ['collecting','launch-cue','launching','special-aura','special-cutin','resolving']) {
    m.phase(phase); m.advance(1);
    assert.deepEqual(m.point(.33,.075),neutral);
    check(m.locked() && m.pose().time===0,phase+' locks even with boss active');
  }
  m.phase('complete');m.advance(.6);
  check(!m.locked() && m.pose().time>0,'only completed resolution permits motion');
  // Real special salvo: no pose movement through cue, aura, cut-in and all projectiles.
  battle.startSoloBrowser({bridge,characters:bridge.getBattleCharacters(),character:'kyoryu',bossId});
  kt().salvoTest.clock(()=>now);step(420);kt().fillCharges();
  check(kt().salvoTest.ready(undefined,{useSpecial:true}),'special salvo accepted');
  let frames=0, movingBoss=false, sawResolving=false;
  for(let i=0;i<2400;i++) {
    step();const state=bridge.getNormalBattleState();
    if(state.salvo?.phase && state.salvo.phase!=='complete') {
      check(m.locked(),'actual allied phase remains frozen');
      assert.deepEqual(m.point(.33,.075),neutral);frames++;
      if(state.salvo.phase==='resolving')sawResolving=true;
    } else if(m.pose().time>0) movingBoss=true;
    if(movingBoss && state.inputReady)break;
  }
  check(frames>60 && sawResolving && movingBoss,'full salvo freezes then boss motion resumes');
  check(bridge.getNormalBattleState().inputReady && m.locked(),'next allied round locks again');
}
console.log('PASS boss motion: '+checks+' assertions, both bosses, real special salvos and next rounds');
