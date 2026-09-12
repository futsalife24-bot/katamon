// Browser QA: production input handlers and renderer; hooks exist only in intercepted test HTML.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),evidence=path.join(root,'docs/tasks/2026-09-12-coop-simultaneous-evidence');
fs.mkdirSync(evidence,{recursive:true});
const hook=`globalThis.__salvoQa={
 state:()=>({...coopNormalBattleState(),error:online?.protocolError,matchOver,ready:coopSalvoState?.started}),
 clock:()=>{coopNormalSession.serverNow=()=>Date.now()+31000;},
};\n`;
(async()=>{
 const browser=await chromium.launch({headless:true});const errors=[];let lastPage;
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage();lastPage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/index.html*',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8').replace('  globalThis.KatamonCoopBridge = Object.freeze({',hook+'  globalThis.KatamonCoopBridge = Object.freeze({')}));
  await page.goto((process.env.COOP_BASE_URL||'http://127.0.0.1:4181')+'/index.html?coopMvp=1',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='press');
  const canvas=page.locator('#game'),box=await canvas.boundingBox();
  await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='title',null,{timeout:30000});
  await page.evaluate(()=>globalThis.KatamonCoopRoom.openLobby());
  await page.locator('#coopBossTarget').selectOption('storm-dragon-02');await page.locator('#coopSoloStart').click();
  await page.waitForFunction(()=>globalThis.__salvoQa.state().inputReady,null,{timeout:30000});
  await page.waitForFunction(()=>globalThis.__salvoQa.state().salvo?.ready===3,null,{timeout:15000});
  const before=await page.evaluate(()=>globalThis.__salvoQa.state());
  assert.equal(before.projectiles.length,0);assert.equal(before.inputReady,true);assert.ok(before.salvo.remainingSeconds>20);
  await page.screenshot({path:path.join(evidence,'01-shared-preparation-mobile.png')});
  const pt=(x,y)=>({x:box.x+x/540*box.width,y:box.y+y/960*box.height});
  const fire=pt(270,810),pull=pt(178,860);
  await page.mouse.move(fire.x,fire.y);await page.mouse.down();await page.mouse.move(pull.x,pull.y,{steps:10});await page.mouse.up();
  await page.waitForFunction(()=>globalThis.__salvoQa.state().salvo?.launchTicks.length===4,null,{timeout:10000});
  const firing=await page.evaluate(()=>globalThis.__salvoQa.state());assert.ok(firing.salvo.launchTicks.every(t=>t===0));
  await page.screenshot({path:path.join(evidence,'02-simultaneous-fire-mobile.png')});
  await page.waitForFunction(()=>globalThis.__salvoQa.state().turnCount>=5&&globalThis.__salvoQa.state().inputReady||globalThis.__salvoQa.state().matchOver,null,{timeout:60000});
  if((await page.evaluate(()=>globalThis.__salvoQa.state())).matchOver) {
    await page.evaluate(()=>globalThis.KatamonCoopBattle.startSoloBrowser({bridge:globalThis.KatamonCoopBridge,characters:globalThis.KatamonCoopBridge.getBattleCharacters(),character:'kyoryu',bossId:'storm-dragon-02'}));
    await page.waitForFunction(()=>globalThis.__salvoQa.state().inputReady,null,{timeout:30000});
  }
  await page.mouse.move(fire.x,fire.y);await page.mouse.down();await page.mouse.move(pull.x,pull.y,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>globalThis.__salvoQa.state().salvo?.unitIds.includes('p1'));
  assert.equal((await page.evaluate(()=>globalThis.__salvoQa.state())).inputReady,false);
  await page.waitForTimeout(150); // Canvasの次の描画を待ってREADY表示を保存する。
  await page.screenshot({path:path.join(evidence,'03-ready-wait-mobile.png')});
  if(process.env.COOP_SCREENSHOT_ONLY) { assert.deepEqual(errors,[]); console.log('READY screenshot refreshed'); return; }
  await page.waitForFunction(()=>globalThis.__salvoQa.state().turnCount>=10&&globalThis.__salvoQa.state().inputReady,null,{timeout:45000});
  await page.waitForFunction(()=>globalThis.__salvoQa.state().salvo?.ready===3,null,{timeout:15000});
  await page.evaluate(()=>globalThis.__salvoQa.clock());
  await page.waitForFunction(()=>globalThis.__salvoQa.state().salvo?.phase==='resolving',null,{timeout:10000});
  const expired=await page.evaluate(()=>globalThis.__salvoQa.state());assert.equal(expired.salvo.launchTicks.length,3);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'browser-result.json'),JSON.stringify({browser:'Chromium',viewport:'390x844',before:{ready:before.salvo.ready,seconds:before.salvo.remainingSeconds},firing:firing.salvo,timeout:expired.salvo,errors},null,2));
  console.log('Browser QA passed: mobile 30-second preparation, AI concurrent ready, real drag/ready, same-tick fire, next round, timeout; no page errors');
 }catch(error){
  if(lastPage){fs.writeFileSync(path.join(evidence,'browser-failure.json'),JSON.stringify(await lastPage.evaluate(()=>globalThis.__salvoQa?.state()),null,2));await lastPage.screenshot({path:path.join(evidence,'browser-failure.png')});}
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
