// Verify the real-time rendered special sequence. Test hooks only instrument served HTML.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),base=process.env.COOP_BASE_URL||'http://127.0.0.1:4186';
const published=!!process.env.COOP_PUBLISHED;
const evidence=path.join(root,'docs/tasks/2026-09-12-coop-ready-fire-evidence');
const hook=`globalThis.__rallyQa={
 state:()=>({...coopNormalBattleState(),aura:!!coopSalvoSpecialAura,flash:!!coopSalvoSpecialFlash,
 label:coopSalvoState?.phase==='launch-cue'?(coopSalvoState.cueTimer>0.3?'Ready':'Fire'):coopSalvoState?.phase}),
 special:()=>{localUnit().specialCharge=SPECIAL_CHARGE_MAX;specialArmed=true;},
 trace:[]
};
function recordRallyQa(){const s=globalThis.__rallyQa.state();if(s.label && globalThis.__rallyQa.trace.at(-1)?.label!==s.label)globalThis.__rallyQa.trace.push({label:s.label,aura:s.aura,flash:s.flash,shots:s.projectiles.length,time:performance.now()});requestAnimationFrame(recordRallyQa);}requestAnimationFrame(recordRallyQa);
`;
(async()=>{const browser=await chromium.launch({headless:true});const results=[];
try{for(const boss of ['siege-fortress-01','storm-dragon-02']){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/index.html*',async route=>{
  const html=published?await (await route.fetch()).text():fs.readFileSync(path.join(root,'index.html'),'utf8');
  await route.fulfill({contentType:'text/html',body:html.replace('  globalThis.KatamonCoopBridge = Object.freeze({',hook+'  globalThis.KatamonCoopBridge = Object.freeze({')});
 });
 await page.goto(base+'/index.html?coopMvp=1',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='press');
 const box=await page.locator('#game').boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 await page.waitForFunction(()=>globalThis.KatamonCustomStageBridge?.getState()?.gamePhase==='title',null,{timeout:30000});
 await page.evaluate(()=>globalThis.KatamonCoopRoom.openLobby());
 await page.locator('#coopBossTarget').selectOption(boss);await page.locator('#coopSoloStart').click();
 await page.waitForFunction(()=>globalThis.__rallyQa.state().inputReady&&globalThis.__rallyQa.state().salvo?.ready===3,null,{timeout:30000});
 await page.evaluate(()=>{globalThis.__rallyQa.special();globalThis.__rallyQa.trace=[];});
 const pt=(x,y)=>({x:box.x+x/540*box.width,y:box.y+y/960*box.height});const fire=pt(270,810),pull=pt(178,860);
 await page.mouse.move(fire.x,fire.y);await page.mouse.down();await page.mouse.move(pull.x,pull.y,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>globalThis.__rallyQa.state().label==='special-aura',null,{timeout:15000});
 await page.screenshot({path:path.join(evidence,(published?'published-':'')+boss+'-aura.png')});
 await page.waitForFunction(()=>globalThis.__rallyQa.state().label==='special-cutin',null,{timeout:15000});
 await page.waitForTimeout(200);
 await page.screenshot({path:path.join(evidence,(published?'published-':'')+boss+'-cutin.png')});
 await page.waitForFunction(()=>globalThis.__rallyQa.trace.some(e=>e.label==='resolving'),null,{timeout:15000});
 const trace=await page.evaluate(()=>globalThis.__rallyQa.trace),sequence=trace.filter(e=>e.label!=='collecting');
 assert.deepEqual(sequence.map(e=>e.label),['Ready','Fire','special-aura','special-cutin','resolving']);
 for(const entry of sequence.slice(0,4))assert.equal(entry.shots,0);
 assert.equal(sequence[0].aura,false);assert.equal(sequence[1].flash,false);
 assert.equal(sequence[2].aura,true);assert.equal(sequence[3].flash,true);
 const state=await page.evaluate(()=>globalThis.__rallyQa.state());assert.equal(state.salvo.launchTicks.length,4);assert.ok(state.salvo.launchTicks.every(t=>t===0));assert.deepEqual(errors,[]);
 results.push({boss,sequence,launchTicks:state.salvo.launchTicks,errors});await context.close();
}fs.writeFileSync(path.join(evidence,(published?'published-':'')+'special-sequence.json'),JSON.stringify(results,null,2));console.log('Special browser sequence passed for both bosses: Ready → Fire → aura → cut-in → same-tick launch');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
