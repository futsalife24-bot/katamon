// Local HTTP / real Chromium. Observability hooks exist only in the served response.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), base = process.env.COOP_BASE_URL || 'http://127.0.0.1:4188';
const evidence = path.join(root, 'docs/tasks/2026-09-12-fortress-stage-evidence', base.startsWith('https:') ? 'published' : '');
const hook = `globalThis.__foundryQA = {
 state:()=>({...coopNormalBattleState(),pattern:currentPattern,background:getReadyStageBackground()?.src}),
 overview:()=>{cameraZoom=MIN_CAMERA_ZOOM;cameraDistanceSetting=0;cameraX=0;cameraY=0;cameraTargetX=null;cameraTargetY=null;},
 focus:()=>{cameraZoom=.65;cameraDistanceSetting=cameraSliderValue();focusCameraOn(coopBossUnit.x,true,coopBossUnit.y);},
 damage:()=>{const p=COOP_PLATFORM_LAYOUT.find(p=>!p.spawnSteel);const x=STAGE_W*(p.start+p.end)/2,y=STAGE_H*p.top+12;
 const before=solidGrid.reduce((a,b)=>a+b,0);carveCraterInternal(STAGE_W*.1,coopBossGroundY()+10,25);const steel=solidGrid.reduce((a,b)=>a+b,0);
 carveCraterInternal(x,y,28);return {before,steel,after:solidGrid.reduce((a,b)=>a+b,0)};},
 normal:()=>{coopNormalSession=null;setMatchFormat('2v2');applyStageAppearance('grass');newTerrain('rolling');}
};\n`;
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const browser=await chromium.launch({headless:true}), results=[];
 try {
  for(const boss of ['siege-fortress-01','storm-dragon-02']){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/index.html*',async route=>{
    const local=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const body=base.startsWith('https:') ? await (await route.fetch()).text() : local;
    assert.equal(body.replaceAll('\r\n','\n'),local.replaceAll('\r\n','\n'),'served HTML equals reviewed source');
    await route.fulfill({contentType:'text/html',body:body.replace('  globalThis.KatamonCoopBridge = Object.freeze({',hook+'  globalThis.KatamonCoopBridge = Object.freeze({')});
   });
   await page.goto(base+'/index.html?coopMvp=1',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='press');
   const box=await page.locator('#game').boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
   await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='title');
   await page.evaluate(()=>globalThis.KatamonCoopRoom.openLobby());
   await page.locator('#coopBossTarget').selectOption(boss);
   if(boss==='siege-fortress-01')assert.equal(await page.locator('#coopBossStage').textContent(),'灼鉄の包囲工廠');
   await page.locator('#coopSoloStart').click();
   await page.waitForFunction(()=>globalThis.__foundryQA.state().inputReady&&globalThis.__foundryQA.state().background);
   const state=await page.evaluate(()=>globalThis.__foundryQA.state());
   assert.match(state.background,boss==='siege-fortress-01'?/fortress-foundry.webp/:/thunder-altar.webp/);
   await page.screenshot({path:path.join(evidence,boss+'-mobile.png')});
   // Human drag, full allied salvo, and boss reply use unmodified clocks/physics.
   const pt=(x,y)=>({x:box.x+x/540*box.width,y:box.y+y/960*box.height});
   const fire=pt(270,810),pull=pt(178,860);
   await page.mouse.move(fire.x,fire.y);await page.mouse.down();await page.mouse.move(pull.x,pull.y,{steps:10});await page.mouse.up();
   await page.waitForFunction(()=>globalThis.__foundryQA.state().turnCount>=5&&globalThis.__foundryQA.state().inputReady,null,{timeout:45000});
   await page.evaluate(()=>globalThis.__foundryQA.overview());await page.waitForTimeout(300);
   await page.screenshot({path:path.join(evidence,boss+'-overview.png')});
   if(boss==='siege-fortress-01'){
    await page.evaluate(()=>globalThis.__foundryQA.focus());await page.waitForTimeout(300);
    await page.screenshot({path:path.join(evidence,'fortress-close.png')});
    const damage=await page.evaluate(()=>globalThis.__foundryQA.damage());
    assert.equal(damage.before,damage.steel);assert.ok(damage.after<damage.steel);
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>globalThis.__foundryQA.overview());await page.waitForTimeout(300);
    await page.screenshot({path:path.join(evidence,'fortress-desktop.png')});
    await page.evaluate(()=>globalThis.__foundryQA.normal());
    const normal=await page.evaluate(()=>globalThis.__foundryQA.state());
    assert.equal(normal.pattern,'rolling');assert.ok(!normal.background?.includes('fortress-foundry'));
   }
   assert.deepEqual(errors,[]);results.push({boss,background:state.background,realSalvo:true,errors});await context.close();
  }
  fs.writeFileSync(path.join(evidence,'browser-result.json'),JSON.stringify(results,null,2));console.log('PASS: both solo entries, backgrounds, actual salvos/boss replies, fortress terrain destruction, mobile/desktop; zero page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
