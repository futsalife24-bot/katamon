const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const esbuild=require('../../tools/content-studio/node_modules/esbuild');
// This hook is inserted into the served test response only. No test route or API ships in index.html.
const hook=`
  let m1Time=0,m1Player,m1Map,m1State,m1Epoch;
  globalThis.__motionTest={
    start(mode='normal',format='2v2'){battleMode=mode;gamePhase='battle';battleMotionPhase='battle';setMatchFormat(format);for(const u of units)u.character='hamulton';resetMatch(false);cutIn=null;battleIntroPending=false;gamePhase='battle';for(const u of units){u.character='hamulton';u.hp=u.maxHp;u.grounded=true;}return units.map(u=>u.id);},
    actor(i){return units[i];},
    m1Begin(){globalThis.__motionTest.start('free','1v1');m1Time=0;battleMotion.clock=()=>m1Time;m1Player=battleMotion;m1Map=battleMotion.states;m1Epoch=battleMotion.cache.epoch;for(const clip of ['fire','land','move-forward','move-backward'])battleMotion.cache.request(CHARACTERS[units[0].character],clip);},
    m1Hit(){const u=units[0];applyResolvedUnitDamage(u,1,{});m1State=battleMotion.states.get(battleMotion.key(u));return globalThis.__motionTest.m1Record();},
    m1Failed(){return battleMotion.cache.entries.get(CHARACTERS[units[0].character].motionSheets.hit)?.state==='failed';},
    m1Move(){const u=units[0],before=u.x;m1Time+=80;battleMotion.beginStep();moveDir=unitFacesLeftInWorld(u)?-1:1;updateAfterPhysics(.05);moveDir=0;return {delta:u.x-before,...globalThis.__motionTest.m1Record()};},
    m1Fire(){const u=units[0],before=projectiles.length;launchShot(u,unitAnchor(u),190,-220,false,false,false);return {projectilesAdded:projectiles.length-before,...globalThis.__motionTest.m1Record()};},
    m1Frame(){m1Time+=80;return globalThis.__motionTest.m1Record();},
    m1Record(){const u=units[0],calls=[],original=ctx.drawImage;ctx.drawImage=function(image,...args){if(image instanceof ImageBitmap)calls.push(args);return original.call(this,image,...args);};try{drawUnit(u);}finally{ctx.drawImage=original;}const selected=battleMotion.select(u,CHARACTERS[u.character]);render();return {time:m1Time,clip:selected?.clip,frame:selected?.frame,calls,samePlayer:battleMotion===m1Player,sameMap:battleMotion.states===m1Map,sameState:battleMotion.states.get(battleMotion.key(u))===m1State,sameEpoch:battleMotion.cache.epoch===m1Epoch};},

    shot(i){const u=units[i];const count=projectiles.length;launchShot(u,unitAnchor(u),190,-220,false,false,false);return {control:u.control,added:projectiles.length-count,event:battleMotion.states.get(u.id+':'+u.character)?.event?.clip};},
    coop(){const roster=Object.fromEntries(Object.keys(COOP_SEAT_UNIT).map(seat=>[seat,{character:'hamulton',name:'Motion fixture',uid:seat==='p1'?'fixture-host':null,ai:seat!=='p1'}]));const started=startCoopNormalBattle({session:{role:'host',seat:'p1',auth:{uid:'fixture-host'}},roster,difficulty:'normal',wind:{direction:1,strength:0},nextWind:{direction:1,strength:0},transport:{send:async()=>true,onMessage(){},close(){}}});cutIn=null;battleIntroPending=false;return {started:Boolean(started),count:units.length,boss:unitById(COOP_BOSS_UNIT_ID).hp};},
    prepare(){for(const clip of ContentStudioMotion.CLIPS)battleMotion.cache.request(CHARACTERS['hamulton'],clip);},
    ready(){return [...battleMotion.cache.entries.values()].filter(e=>e.state==='ready').length;},
    draw(i,clip,ms,left,slope){const u=units[i];const saved=unitFacesLeftInWorld,oldSlope=groundSlopeAt;unitFacesLeftInWorld=()=>left;groundSlopeAt=()=>slope;let time=0;battleMotion.clock=()=>time;battleMotion.states.clear();if(clip?.startsWith('move'))battleMotion.walk(u,(clip==='move-forward')===left?-1:1,left);else if(clip)notifyBattleMotion(u,clip);if(clip?.startsWith('move')){for(let t=40;t<=ms;t+=40){time=t;battleMotion.walk(u,(clip==='move-forward')===left?-1:1,left);}}time=ms;const calls=[];const orig=ctx.drawImage;ctx.drawImage=function(image,...args){calls.push({motion:image instanceof ImageBitmap,args,matrix:Array.from([this.getTransform().a,this.getTransform().b,this.getTransform().c,this.getTransform().d,this.getTransform().e,this.getTransform().f])});return orig.call(this,image,...args);};try{drawUnit(u);}finally{ctx.drawImage=orig;unitFacesLeftInWorld=saved;groundSlopeAt=oldSlope;}const selected=battleMotion.select(u,CHARACTERS[u.character]);const img=charImages[u.character],crop=characterImageRect(u.character,img),h=SPRITE_SIZE*unitSpriteScale(u.character),w=h*crop.sw/crop.sh;const body=battleMotion.body(img,crop,{x:-w/2,y:UNIT_RADIUS-h+characterGroundOffsetY(u.character),width:w,height:h});return {body,metadata:selected?.asset.metadata,clip:selected?.clip,frame:selected?.frame,calls,stats:battleMotion.cache.stats()};},
    frame(ms){let time=0;battleMotion.clock=()=>time;battleMotion.states.clear();for(let i=0;i<units.length;i++){const u=units[i];if(i<2)battleMotion.walk(u,i===0?1:-1,false);else notifyBattleMotion(u,i===2?'fire':'hit');}for(let t=40;t<=ms;t+=40){time=t;for(let i=0;i<2;i++)battleMotion.walk(units[i],i===0?1:-1,false);}time=ms;render();return units.map(u=>{const s=battleMotion.select(u,CHARACTERS[u.character]);return {id:u.id,clip:s?.clip,frame:s?.frame};});},
    clear(){resetTransientBattleState();return battleMotion.cache.stats();},
    snapshot(){const before=JSON.stringify(units);applySnapshot(null);return {same:JSON.stringify(units)===before,states:battleMotion.states.size};}
  };
`;
const fixtures=new Map();
test.beforeAll(async({baseURL})=>{
  // Studio's supported generation environment is Chromium. Both playback engines consume identical real artifacts.
  const code=(await esbuild.build({entryPoints:[path.resolve('tests/fixtures/content-motion.ts')],bundle:true,format:'iife',write:false,logLevel:'silent'})).outputFiles[0].text;
  const generator=await chromium.launch();
  try { const page=await generator.newPage();await page.goto(baseURL+'/tools/content-studio/dist/');await page.addScriptTag({content:code});
    for(const width of [360,390,412])fixtures.set(width,await page.evaluate(async({size,facing})=>globalThis.makeMotionFixture(size,facing),{size:width===412?512:128,facing:width===390?'left':'right'}));
  } finally { await generator.close(); }
});
for(const width of [360,390,412])test(`real generated sheets → drawUnit ${width}px`,async({page,browserName},info)=>{
  test.setTimeout(180000);await page.setViewportSize({width,height:844});
  const fixture=fixtures.get(width);
  let failAssets=false;const requests=[];
  const files=new Map(fixture.files.map(f=>['/'+f.path,f]));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());const file=files.get(url.pathname);if(url.pathname==='/shared/content-studio-motion.js'&&process.env.CONTENT_MOTION_RUNTIME_FIXTURE)return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.CONTENT_MOTION_RUNTIME_FIXTURE,'utf8')});if(file){requests.push(url.pathname);if(failAssets && url.pathname.endsWith('/hit.png'))return route.fulfill({status:404,body:'missing fixture'});}if(file)return route.fulfill({status:200,contentType:file.mimeType,body:file.text??Buffer.from(file.base64,'base64')});if(url.pathname==='/index.html'){let html=fs.readFileSync('index.html','utf8');const end=html.lastIndexOf('})();');expect(end).toBeGreaterThan(0);html=html.slice(0,end)+hook+html.slice(end);return route.fulfill({contentType:'text/html',body:html});}return route.continue();});
  await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=(callback)=>raf(time=>{if(!window.__motionPauseRAF)callback(time);});});
  await page.goto('/index.html?motion-fixture=local');await expect.poll(()=>page.evaluate(()=>globalThis.KatamonCustomStageBridge?.getState?.().gamePhase),{timeout:30000}).toBe('press');await page.evaluate(()=>{window.__motionPauseRAF=true;globalThis.__motionTest.start();});
  await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready())).toBe(0); // no full-roster eager decode
  await page.evaluate(()=>globalThis.__motionTest.prepare());
  await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready()),{timeout:20000}).toBe(5);
  const evidence=[];
  for(const left of [false,true])for(const slope of [0,.12])for(const clip of ['move-forward','move-backward','fire','hit','land']){
    const first=await page.evaluate(x=>globalThis.__motionTest.draw(0,...x),[clip,0,left,slope]);
    const next=await page.evaluate(x=>globalThis.__motionTest.draw(0,...x),[clip,200,left,slope]);
    expect(first.clip).toBe(clip);expect(next.frame).toBeGreaterThan(first.frame);
    const a=first.calls.find(c=>c.motion),b=next.calls.find(c=>c.motion);expect(a).toBeTruthy();expect(b).toBeTruthy();expect(a.args.slice(4)).toEqual(b.args.slice(4));const r=first.metadata.rendering;expect(a.args[5]+r.ground.y*a.args[7]/first.metadata.frameHeight).toBeCloseTo(first.body.y+first.body.height,5);expect(r.restBounds.width*a.args[6]/first.metadata.frameWidth).toBeCloseTo(first.body.width,5);expect(a.matrix).toEqual(b.matrix);
    if(!clip.startsWith('move')){const end=await page.evaluate(x=>globalThis.__motionTest.draw(0,...x),[clip,2000,left,slope]);expect(end.calls.some(c=>c.motion)).toBe(false);}
    evidence.push({left,slope,clip,first,next});
  }
  // Sequential real canvas frames retain the alternate blue hit artwork, static switch, and multiple units.
  for(let frame=0;frame<5;frame++){const drawn=await page.evaluate(ms=>globalThis.__motionTest.frame(ms),frame*80);expect(drawn.filter(x=>x.clip).length).toBe(4);await page.screenshot({path:info.outputPath(`motion-${frame}.png`)});}
  expect((await page.evaluate(()=>globalThis.__motionTest.clear())).entries).toBe(0);failAssets=true;
  const fallback=await page.evaluate(()=>globalThis.__motionTest.draw(0,'hit',0,false,0));expect(fallback.calls.some(c=>c.motion)).toBe(false);await page.waitForTimeout(500);const failed=await page.evaluate(()=>globalThis.__motionTest.draw(0,'hit',100,false,0));expect(failed.calls.some(c=>c.motion)).toBe(false);const hits=requests.filter(p=>p.endsWith('/hit.png')).length;for(let i=0;i<5;i++)await page.evaluate(()=>globalThis.__motionTest.draw(0,'hit',100,false,0));expect(requests.filter(p=>p.endsWith('/hit.png')).length).toBe(hits);await page.screenshot({path:info.outputPath('fallback.png')});failAssets=false;await page.evaluate(()=>{globalThis.__motionTest.start();globalThis.__motionTest.draw(0,'fire',2000,false,0);});await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready())).toBe(1);const expired=await page.evaluate(()=>globalThis.__motionTest.draw(0,'fire',2000,false,0));expect(expired.calls.some(c=>c.motion)).toBe(false);
  // Android is the requested release target. Existing Windows WebKit co-op shell limitations remain separately reported.
  if(browserName==='chromium'){
    // M1: begin once, then retain the same Player, state Map, unit state and cache epoch.
    const m1RequestsBefore=requests.filter(p=>p.endsWith('/hit.png')).length;
    failAssets=true;await page.evaluate(()=>globalThis.__motionTest.m1Begin());
    await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready())).toBe(4);
    const sequence=[await page.evaluate(()=>globalThis.__motionTest.m1Hit())];
    await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.m1Failed())).toBe(true);
    await page.screenshot({path:info.outputPath('m1-hit-failed.png')});
    const failedRequests=requests.filter(p=>p.endsWith('/hit.png')).length;expect(failedRequests-m1RequestsBefore).toBe(1);
    for(let i=0;i<3;i++){
      const moved=await page.evaluate(()=>globalThis.__motionTest.m1Move());sequence.push(moved);expect(Math.abs(moved.delta)).toBeGreaterThan(0);expect(moved.clip).toBe('move-forward');expect(moved.calls.length).toBeGreaterThan(0);await page.screenshot({path:info.outputPath(`m1-walk-${i}.png`)});
    }
    const fired=await page.evaluate(()=>globalThis.__motionTest.m1Fire());sequence.push(fired);expect(fired.projectilesAdded).toBe(1);expect(fired.clip).toBe('fire');
    await page.screenshot({path:info.outputPath('m1-fire-0.png')});
    for(let i=1;i<3;i++){const frame=await page.evaluate(()=>globalThis.__motionTest.m1Frame());sequence.push(frame);expect(frame.clip).toBe('fire');expect(frame.calls.length).toBeGreaterThan(0);await page.screenshot({path:info.outputPath(`m1-fire-${i}.png`)});}
    expect(sequence[3].frame).toBeGreaterThan(sequence[1].frame);expect(sequence.at(-1).frame).toBeGreaterThan(fired.frame);
    for(const frame of sequence){expect(frame.samePlayer&&frame.sameMap&&frame.sameState&&frame.sameEpoch).toBe(true);expect(frame.time).toBeLessThan(1000);}
    expect(requests.filter(p=>p.endsWith('/hit.png')).length).toBe(failedRequests);
    await info.attach('M1-continuous-Player',{body:JSON.stringify({sequence,hitPNGRequests:failedRequests-m1RequestsBefore},null,2),contentType:'application/json'});failAssets=false;
    for(const [mode,format] of [['normal','1v1'],['free','1v1'],['free','2v2']]){
      await page.evaluate(([m,f])=>{globalThis.__motionTest.start(m,f);globalThis.__motionTest.prepare();},[mode,format]);
      await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready())).toBe(5);
      const shot=await page.evaluate(()=>globalThis.__motionTest.shot(1));expect(shot.control).toBe('cpu');expect(shot.added).toBe(1);expect(shot.event).toBe('fire');
      const drawn=await page.evaluate(()=>globalThis.__motionTest.draw(1,'fire',200,true,0));expect(drawn.calls.some(c=>c.motion)).toBe(true);
    }
    const coop=await page.evaluate(()=>globalThis.__motionTest.coop());expect(coop.started).toBe(true);expect(coop.count).toBe(5);
    await page.evaluate(()=>globalThis.__motionTest.prepare());await expect.poll(()=>page.evaluate(()=>globalThis.__motionTest.ready())).toBe(5);
    const players=await page.evaluate(()=>globalThis.__motionTest.frame(160));expect(players.filter(p=>p.clip).length).toBe(4);expect(players.find(p=>p.id==='boss1').clip).toBeUndefined();
    await page.screenshot({path:info.outputPath('coop-players.png')});
  }
  await info.attach('generated-draw-contract',{body:JSON.stringify({width,fixtureBundle:fixture.bundleId,evidence},null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
});
