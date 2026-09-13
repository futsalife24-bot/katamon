const { chromium } = require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),base=process.env.COOP_MOTION_BASE_URL||'http://127.0.0.1:4191';
const evidence=path.join(root,'docs/tasks/2026-09-13-boss-sprites-evidence',process.env.COOP_MOTION_BASE_URL?'published':'');
const hook=`globalThis.__motionQA={
 state:()=>({...coopNormalBattleState(),pose:coopBossMotionPose(coopBossUnit),locked:coopBossMotionLocked(coopBossUnit)}),
 focus:()=>{cameraZoom=.38;cameraX=coopBossUnit.x-visibleWorldWidth()/2;cameraY=coopBossRect(coopBossUnit).y-(480-cameraStageScreenTop())/cameraZoom;cameraTargetX=null;cameraTargetY=null;},
 sample:t=>{coopSalvoState=null;activeIndex=turnOrder.indexOf('boss1');coopBossMotionTime=t;cpuThinkTimer=1000;menuOpen=false;},
 phase:n=>{coopBossUnit.phase=n;ensureCoopBossImages();},
 ready:()=>{const image=coopBossSpriteImages[coopBossSpriteKey(coopBossUnit)];return image?.complete&&image.naturalWidth===2560&&image.naturalHeight===1280;},
 points:()=>{const rect=coopBossRect(coopBossUnit),pose=coopBossMotionPose(coopBossUnit);return Object.fromEntries(Object.entries(coopBossLiveApi().PART_DEFS).map(([id,p])=>[id,coopBossVisualPoint(rect,p.x,p.y,pose)]));},
 };\n`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.mp4':'video/mp4','.mp3':'audio/mpeg','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 let body=fs.readFileSync(file);
 if(name==='/index.html')body=body.toString().replace('  globalThis.KatamonCoopBridge = Object.freeze({',hook+'  globalThis.KatamonCoopBridge = Object.freeze({');
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);
});
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});await new Promise(r=>server.listen(4191,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),results=[];
 try{for(const boss of ['siege-fortress-01','storm-dragon-02']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(process.env.COOP_MOTION_BASE_URL)await page.route('**/index.html*',async route=>{
   const response=await route.fetch(),body=await response.text();
   assert.equal(body.replaceAll('\r\n','\n'),fs.readFileSync(path.join(root,'index.html'),'utf8').replaceAll('\r\n','\n'),'published HTML equals reviewed source');
   await route.fulfill({response,body:body.replace('  globalThis.KatamonCoopBridge = Object.freeze({',hook+'  globalThis.KatamonCoopBridge = Object.freeze({')});
  });
  await page.goto(base+'/index.html?coopMvp=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='press');
  await page.locator('#game').click();await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='title');
  await page.evaluate(()=>KatamonCoopRoom.openLobby());await page.locator('#coopBossTarget').selectOption(boss);await page.locator('#coopSoloStart').click();
  await page.waitForFunction(()=>__motionQA.state().inputReady);
  await page.waitForFunction(()=>__motionQA.ready());
  assert.equal((await page.evaluate(()=>__motionQA.state())).pose.frame,-1,'allied preparation uses canonical image');
  const frozen=await page.evaluate(()=>__motionQA.points());await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(()=>__motionQA.points()),frozen);
  // Real human input, all projectiles and the boss turn use the normal game clock.
  const box=await page.locator('#game').boundingBox(),pt=(x,y)=>({x:box.x+x/540*box.width,y:box.y+y/960*box.height});
  const a=pt(270,810),b=pt(178,860);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();
  await page.waitForFunction(()=>__motionQA.state().pose.time>.2,null,{timeout:45000});
  assert.notDeepEqual(await page.evaluate(()=>__motionQA.points()),frozen);
  await page.waitForFunction(()=>__motionQA.state().turnCount>=5&&__motionQA.state().inputReady,null,{timeout:45000});
  assert.deepEqual(await page.evaluate(()=>__motionQA.points()),frozen);
  await page.evaluate(()=>__motionQA.focus());await page.screenshot({path:path.join(evidence,boss+'-fixed.png')});
  // Deterministic close-up poses, test-only injection; no hooks are shipped in the game.
  const frames=[];
  for(const [label,t] of Array.from({length:8},(_,i)=>['frame-'+i,(i+.1)/7])){
   await page.evaluate(t=>{__motionQA.sample(t);__motionQA.focus();},t);await page.waitForTimeout(50);
   frames.push((await page.evaluate(()=>__motionQA.state())).pose.frame);
   await page.screenshot({path:path.join(evidence,boss+'-'+label+'.png')});
  }
  assert.equal(new Set(frames).size,8,'all eight frames render');
  await page.evaluate(()=>__motionQA.phase(2));await page.waitForFunction(()=>__motionQA.ready());
  await page.evaluate(()=>{__motionQA.sample(.6);__motionQA.focus();});await page.waitForTimeout(50);
  assert.equal((await page.evaluate(()=>__motionQA.state())).pose.sheet,boss==='storm-dragon-02'?'volteris':'fortressPhase2');
  await page.screenshot({path:path.join(evidence,boss+'-phase2.png')});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>__motionQA.focus());await page.waitForTimeout(100);
  await page.screenshot({path:path.join(evidence,boss+'-mobile.png')});
  assert.deepEqual(errors,[]);results.push({boss,realSalvo:true,neutralPoseRestored:true,frames,phase2:true,errors});await context.close();
 }}finally{await browser.close();server.close();}
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(results,null,2));console.log('PASS browser: both bosses, actual salvo, moving boss turn, next preparation, desktop/mobile poses');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
