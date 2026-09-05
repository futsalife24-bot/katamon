// Executes identical seeded simulations in separate processes, with only the visual layer toggled.
const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
if(process.env.MOTION_SIMULATION_CHILD){
 let seed=48271,calls=0;Math.random=()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const k=require('./seatharness').kt();k.motionTest.enable(process.env.MOTION_SIMULATION_CHILD==='on');
 const results=[];
 for(const format of ['1v1','2v2']){
  k.motionTest.setup(format);
  k.motionTest.move(1,.05);k.motionTest.move(0,.05);
  k.fireForTest(190,-220);
  for(let i=0;i<180;i++)k.step(1/60);
  k.motionTest.damage('e1',17);
  const snapshot=k.motionTest.snapshot();results.push(snapshot);k.apply(snapshot);k.motionTest.reset();
 }
 process.stdout.write('\nMOTION_RESULT='+JSON.stringify({results,calls,seed})+'\n');
}else{
 for(const seat of ['p1','e1']){
  const run=(enabled)=>{const p=spawnSync(process.execPath,[__filename,seat],{encoding:'utf8',env:{...process.env,MOTION_SIMULATION_CHILD:enabled},maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stderr+p.stdout);return JSON.parse(p.stdout.match(/MOTION_RESULT=(.*)/)[1]);};
  assert.deepEqual(run('on'),run('off'),seat+' state, terrain, HP, fuel, projectiles, turn and RNG invariant');
 }
 const k=require('./seatharness').kt();k.motionTest.enable(true);k.motionTest.setup();
 k.fireForTest(190,-220);assert.equal(k.motionTest.event('p1'),'fire');
 k.motionTest.damage('e1',17);assert.equal(k.motionTest.event('e1'),'hit');
 k.motionTest.reset();assert.equal(k.motionTest.event('p1'),null);assert.equal(k.motionTest.event('e1'),null);
 k.motionTest.damage('e1',5,true);assert.equal(k.motionTest.event('e1'),null);k.motionTest.confirm();assert.equal(k.motionTest.event('e1'),'hit');k.motionTest.reset();k.motionTest.confirm();assert.equal(k.motionTest.event('e1'),null);
 k.motionTest.land('p1');assert.equal(k.motionTest.event('p1'),'land');
 k.motionTest.reset();k.fireForTest(190,-220,{useJump:true});assert.notEqual(k.motionTest.event('p1'),'fire');
 k.motionTest.setup();k.motionTest.reset();k.motionTest.follow('p1');assert.equal(k.motionTest.event('p1'),null);
 k.unitById('p1').fuel=0;k.motionTest.move(1,.05);assert.ok(!k.motionTest.walk('p1')?.active);
 k.motionTest.remoteWalk('e1',-10);assert.equal(k.motionTest.walk('e1')?.clip,'move-forward');
 k.motionTest.remoteWalk('e1',0);assert.ok(!k.motionTest.walk('e1')?.active);
 k.motionTest.damage('p1',5,true);k.unitById('p1').hp+=5;k.motionTest.confirm();assert.equal(k.motionTest.event('p1'),null);
 k.motionTest.reset();k.motionTest.damage('p1',5,true);k.motionTest.replay(k.motionTest.snapshot());k.motionTest.confirm();assert.equal(k.motionTest.event('p1'),'hit');
 k.motionTest.setup('2v2');k.motionTest.reset();k.unitById('p1').hp=1;k.motionTest.flame('p1');assert.equal(k.unitById('p1').hp,0);k.unitById('p1').hp=1;k.motionTest.confirm();assert.equal(k.motionTest.event('p1'),null,'rejected lethal remote flame must not animate a hit');
 console.log('motion-game: 2 seeded seat comparisons (1v1/2v2) and event/reset assertions including rejected lethal flame passed');
}
