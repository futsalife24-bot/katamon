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
  m.loaded();
  check(m.locked(),'preparation locks '+bossId);
  const boss=kt().unitById('boss1'), before=JSON.stringify(boss.bossState);
  const point=bossId==='storm-dragon-02'?[.33,.075]:[.48,.18];
  const neutral=m.point(...point);
  m.bossTurn();m.advance(.6);
  check(!m.locked() && m.point(...point).y!==neutral.y && m.pose().frame>=0,'boss turn animates '+bossId);
  const seen=new Set();
  for(let i=0;i<8;i++){
    seen.add(m.pose().frame);
    const calls=m.draw();check(calls.length===1&&calls[0].length===9,'one source-cell draw per frame');
    check(calls[0][3]===calls[0][4]&&calls[0][7]===calls[0][8],'uniform aspect ratio, no frame stretching');
    m.advance(1/7);
  }
  check(seen.size===8,'all eight drawn frames are played');
  m.loaded(false);check(m.pose().frame===-1,'unavailable sheet falls back to canonical image');
  check(m.draw()[0].length===5,'unavailable atlas renders original static image');
  assert.deepEqual(m.point(...point),neutral);
  m.loaded();
  boss.phase=2;check(m.pose().sheet===(bossId==='storm-dragon-02'?'volteris':'fortressPhase2'),'phase2 uses correct atlas');boss.phase=1;
  check(JSON.stringify(boss.bossState)===before,'animation never mutates authoritative boss state');
  for(const phase of ['collecting','launch-cue','launching','special-aura','special-cutin','resolving']) {
    m.phase(phase); m.advance(1);
    assert.deepEqual(m.point(...point),neutral);
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
      assert.deepEqual(m.point(...point),neutral);check(m.pose().frame===-1,'allied actions use canonical sprite');frames++;
      if(state.salvo.phase==='resolving')sawResolving=true;
    } else if(m.pose().time>0) movingBoss=true;
    if(movingBoss && state.inputReady)break;
  }
  check(frames>60 && sawResolving && movingBoss,'full salvo freezes then boss motion resumes');
  check(bridge.getNormalBattleState().inputReady && m.locked(),'next allied round locks again');
}
console.log('PASS boss motion: '+checks+' assertions, both bosses, real special salvos and next rounds');
