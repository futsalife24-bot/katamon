const registryStorage=require('../../shared/content-studio-registration.js').storage;
const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const esbuild=require('../../tools/content-studio/node_modules/esbuild');
const project='demo-catamon-registration-default-rtdb';
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:19000')throw new Error('Real loopback Emulator is required');
let fixture;
const oldSha='e51ff8a1d5d9fd086491f69914c5979a82eb6cb2';
const hook=`
  FIREBASE.databaseURL='http://127.0.0.1:19000';
  const originalFirebaseUrl=firebaseRequestUrl;
  firebaseRequestUrl=(path,auth,query=null)=>{const url=new URL(originalFirebaseUrl(path,auth,query));url.searchParams.set('ns','demo-catamon-registration-default-rtdb');return url.href;};
  let registrationAuth;
  ensureFirebaseAuth=async()=>{
    if(firebaseAuth)return firebaseAuth;
    if(registrationAuth)return registrationAuth;
    const response=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
    const data=await response.json();registrationAuth={uid:data.localId,idToken:data.idToken,refreshToken:data.refreshToken,expiresAt:Date.now()+3600000,serverTimeOffset:0};return registrationAuth;
  };
  globalThis.KatamonCoopBridge=Object.freeze({...globalThis.KatamonCoopBridge,ensureAuth:()=>ensureFirebaseAuth()});
  let registryPingCount=0;
  const registrationActivate=activatePendingFirebaseBattleReentry;
  activatePendingFirebaseBattleReentry=async(...args)=>{try{return await registrationActivate(...args);}catch(error){const cause=error.cause||error;globalThis.__registryRecoveryFailure={name:cause.name,code:error.code,details:error.details,message:['TypeError','ReferenceError'].includes(cause.name)?cause.message:undefined,frames:String(cause.stack||'').split('\\n').slice(1,5).map(line=>line.replace(/https?:[^ )]+/g,'[local test source]'))};console.log('REGISTRY_RECOVERY_DIAGNOSTIC '+JSON.stringify(globalThis.__registryRecoveryFailure));throw error;}};
  const registrationReceive=netReceive;
  netReceive=packet=>{if(packet.t==='ping')registryPingCount++;return registrationReceive(packet);};
  globalThis.__registrationTest={
    open:()=>openOnlineLobby(),
    ping:()=>netSend({t:'ping'}),pingCount:()=>registryPingCount,
    badCoopPacket:()=>online.transport.send({v:2,t:'ping',from:online.clientId,generation:online.matchGeneration,registryRevision:'f'.repeat(64)}),
    async create(format){openOnlineLobby();const created=await createFirebaseRoom(null,{...defaultLobbySettings(),format});beginFirebaseOnline('host',created.code,created.auth,'registry-a',created.room,'p1',null,created.reentryLease);return created.code;},
    async join(code){openOnlineLobby();const joined=await claimFirebaseRoom(code);beginFirebaseOnline('guest',code,joined.auth,'registry-a',joined.room,joined.seat,null,joined.reentryLease);},
    ready:()=>commitOwnCharacter(),start:()=>requestFirebaseStart(),
    coopOpen(){gamePhase='title';return globalThis.KatamonCoopRoom.openLobby();},
    status:()=>({seats:Object.keys(online?.slots||{}).sort(),phase:online?.phase,gamePhase,ready:online?.selfReady,revision:typeof registeredGame==='undefined'?null:(registeredGame?.revision??null),error:online?.protocolError,units:units.map(u=>({id:u.id,character:u.character,maxHp:u.maxHp})),status:onlineLobbyStatusEl?.textContent}),
    async pinnedAgain(){const prior=registeredRuntime().revision;await registeredRuntime().pin(prior);return registeredRuntime().resolve('registry-a').definition.maxHp;},
    snapshot:()=>buildSnapshot(),
    badSnapshot(){const data=buildSnapshot();data.registryRevision='f'.repeat(64);const before=JSON.stringify(units.map(serializeUnit));let rejected=false;try{applySnapshot(data,{allowUninitializedCharacters:true,forLocalRollback:true});}catch(_){rejected=true;}return{rejected,unchanged:before===JSON.stringify(units.map(serializeUnit))};}
  };
`;
async function admin(path,method='GET',body){
  const response=await fetch(`http://127.0.0.1:19000/${path}.json?ns=${project}`,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});expect(response.ok).toBe(true);return response.json();
}
async function activate(candidate,sourceSha){
  const {createStore}=require('../../tools/registration/firebase-store.cjs');
  const {publish,REPOSITORY}=require('../../tools/registration/publisher.cjs');
  const database=createStore({origin:'http://127.0.0.1:19000',token:'owner',emulator:true,approved:true});
  const files=new Map(fixture.files.map(file=>[file.path,file]));
  const repository={name:REPOSITORY,proveMerged:async sha=>({merged:true,base:'master',sourceSha:sha}),rebuild:async()=>candidate,
    verifyDeployedRuntime:async()=>true,deployment:async sha=>({sourceSha:sha,environment:'github-pages',state:'success'}),
    readDeployedCandidate:async()=>candidate,isAncestor:async()=>true,readDeployedAsset:async path=>{const file=files.get(path);return file?(file.text?Buffer.from(file.text):Buffer.from(file.base64,'base64')):fs.readFileSync(path);}};
  return publish({sourceSha,apply:true,expectedActive:(await database.read('active')).value,repository,database});
}
test.beforeEach(async()=>{await admin('characterRegistry/active','PUT',{registryRevision:fixture.candidate.registryRevision,generation:1,sourceSha:'a'.repeat(40)});});
test.afterEach(async({},info)=>{
  await info.attach('execution-contract.json',{contentType:'application/json',body:JSON.stringify({
    sourceSha:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    run:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,
    rulesSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync('database.rules.json')).digest('hex'),
    project:'demo-catamon-registration',endpoint:'127.0.0.1:19000',registryRevision:fixture?.candidate.registryRevision,
    publication:fixture?.publication,oldClientSource:oldSha,status:info.status,retry:info.retry,
  })});
});
test.beforeAll(async({baseURL})=>{
  const code=(await esbuild.build({entryPoints:[path.resolve('tests/fixtures/content-registration.ts')],bundle:true,format:'iife',write:false,logLevel:'silent'})).outputFiles[0].text;
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(baseURL+'/tools/content-studio/dist/');await page.addScriptTag({content:code});fixture=await page.evaluate(source=>globalThis.makeRegistrationSeries(source),fs.readFileSync('index.html','utf8'));}finally{await browser.close();}
  const publication=JSON.parse(require('node:child_process').execFileSync(process.execPath,['--import',require('node:url').pathToFileURL(path.resolve('tools/content-studio/node_modules/tsx/dist/loader.mjs')).href,'tests/fixtures/registration-publication.ts'],{input:JSON.stringify({files:fixture.publicationFiles}),maxBuffer:24*1024*1024,encoding:'utf8'}));
  expect(publication.candidate).toEqual(fixture.candidate);fixture.publication=publication.evidence;
  await admin('characterRegistry','PUT',{});await activate(fixture.candidate,'a'.repeat(40));
});
async function install(page,legacy=false,mode=legacy?'legacy':'registered'){
  page.on('console',message=>{if(message.text().startsWith('REGISTRY_RECOVERY_DIAGNOSTIC '))console.log(message.text());});
  const files=new Map(fixture.files.map(file=>['/'+file.path,file]));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(url.port==='19000'&&!url.searchParams.has('ns')){url.searchParams.set('ns',project);return route.continue({url:url.href});}
    const file=files.get(url.pathname);if(file)return route.fulfill({contentType:file.mimeType,body:file.text??Buffer.from(file.base64,'base64')});
    if(legacy&&['/coop-mvp-room.js','/coop-mvp-battle.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:require('node:child_process').execFileSync('git',['show',oldSha+':'+url.pathname.slice(1)])});
    if(!legacy&&url.pathname==='/coop-mvp-battle.js'){
      let script=fs.readFileSync('coop-mvp-battle.js','utf8');
      script=script.replace('function normalPacketLooksSafe(',`function normalPacketLooksSafe(...args){const result=registrationOriginalPacketCheck(...args);if(args[0]?.t==='start')globalThis.__registrationPacketDiagnostic={safe:result,roster:Object.fromEntries(Object.entries(args[2]).map(([id,e])=>[id,{character:e.character,maxHp:e.maxHp}])),bossMaxHp:args[3].bossMaxHp,packet:args[0].snap};return result;}\n  function registrationOriginalPacketCheck(`);
      return route.fulfill({contentType:'text/javascript',body:script});
    }
    if(url.pathname==='/index.html'){let html=legacy?require('node:child_process').execFileSync('git',['show',oldSha+':index.html'],{maxBuffer:6*1024*1024}).toString():fs.readFileSync('index.html','utf8');html=html.replace('https://securetoken.googleapis.com/v1/token','http://127.0.0.1:19099/securetoken.googleapis.com/v1/token');const end=html.lastIndexOf('})();');html=html.slice(0,end)+(mode==='legacy'?hook.replaceAll("'registry-a'","'kyoryu'"):hook)+html.slice(end);return route.fulfill({contentType:'text/html',body:html});}
    return route.continue();
  });
  await page.goto('/index.html?roster='+mode);await page.waitForFunction(()=>!!globalThis.__registrationTest);
}
for(const width of [360,390,412])for(const format of ['1v1','2v2'])test(`real registry ONLINE ${format} preserved reveal/start ${width}px`,async({browser},info)=>{
  const hostContext=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),guestContext=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const extra=[];
  try{
    // Standard browser permission, scoped to this isolated test origin only; TLS/CORS security stays enabled.
    await hostContext.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});
    await guestContext.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});
    const host=await hostContext.newPage(),guest=await guestContext.newPage();await install(host);await install(guest);
    const code=await host.evaluate(format=>globalThis.__registrationTest.create(format),format);await guest.evaluate(code=>globalThis.__registrationTest.join(code),code);
    if(format==='2v2')for(let i=0;i<2;i++){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});extra.push(context);
      await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});
      const page=await context.newPage();await install(page);await page.evaluate(code=>globalThis.__registrationTest.join(code),code);
    }
    await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status())).toMatchObject({seats:format==='2v2'?['e1','p1','s1','s2']:['e1','p1']});
    await host.selectOption('#onlineCharacter','registry-a');await guest.selectOption('#onlineCharacter','registry-a');
    const hostReady=await host.evaluate(()=>globalThis.__registrationTest.ready());expect(hostReady,JSON.stringify(await host.evaluate(()=>globalThis.__registrationTest.status()))).toBe(true);const guestReady=await guest.evaluate(()=>globalThis.__registrationTest.ready());expect(guestReady,JSON.stringify(await guest.evaluate(()=>globalThis.__registrationTest.status()))).toBe(true);
    for(const context of extra){const page=context.pages()[0];await page.selectOption('#onlineCharacter','registry-a');expect(await page.evaluate(()=>globalThis.__registrationTest.ready())).toBe(true);}
    const room=await admin('registeredRooms/'+code),messages=room.rounds[room.round.id].messages;
    const beforeReveal=Object.values(messages||{});expect(beforeReveal.some(message=>message.t==='commit')).toBe(true);
    for(const message of beforeReveal){expect(message.character).toBeUndefined();expect(message.definitionHash).toBeUndefined();expect(message.registryRevision).toBe(fixture.candidate.registryRevision);}
    await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status()),{timeout:15000}).toMatchObject({ready:true,revision:fixture.candidate.registryRevision});
    await host.evaluate(()=>globalThis.__registrationTest.start());
    await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing'});
    await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing'});
    expect(await guest.evaluate(()=>globalThis.__registrationTest.badSnapshot())).toEqual({rejected:true,unchanged:true});
    await host.screenshot({path:info.outputPath('registered-playing.png')});
    await info.attach('registration-result.json',{contentType:'application/json',body:JSON.stringify({width,registryRevision:fixture.candidate.registryRevision,host:await host.evaluate(()=>globalThis.__registrationTest.status()),guest:await guest.evaluate(()=>globalThis.__registrationTest.status()),hiddenBeforeReveal:true})});
  }finally{for(const context of extra)await context.close();await hostContext.close();await guestContext.close();}
});

for(const width of [360,390,412])test(`real registered coop human and AI ${width}px`,async({browser},info)=>{
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const guestContext=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  try{
    await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});
    const page=await context.newPage();await install(page);
    expect(await page.evaluate(()=>globalThis.__registrationTest.coopOpen())).toBe(true);
    await page.locator('#coopCreate').click();await expect(page.locator('#coopRoom')).toBeVisible();
    await guestContext.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});
    const guest=await guestContext.newPage();await install(guest);await guest.evaluate(()=>globalThis.__registrationTest.coopOpen());
    const code=await page.locator('#coopCode').textContent();await guest.locator('#coopJoinCode').fill(code.trim());await guest.locator('#coopJoin').click();await expect(guest.locator('#coopRoom')).toBeVisible();
    await page.selectOption('#coopCharacter',width===412?'kyoryu':'registry-a');
    await guest.selectOption('#coopCharacter','neko');
    if(width===412)await page.selectOption('#coopAiCharacterS1','registry-a');
    await guest.locator('#coopReady').click();
    await page.locator('#coopReady').click();await expect(page.locator('#coopStart')).toBeEnabled();
    await page.locator('#coopStart').click();
    await expect.poll(()=>page.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing',revision:fixture.candidate.registryRevision});
    await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing',revision:fixture.candidate.registryRevision});
    const state=await page.evaluate(()=>globalThis.__registrationTest.status());expect(state.units.filter(u=>u.character==='registry-a').length).toBeGreaterThanOrEqual(1);
    if(width===390){
      const before=await guest.evaluate(()=>globalThis.__registrationTest.pingCount());
      await guestContext.setOffline(true);await activate(fixture.ab,'b'.repeat(40));
      expect(await page.evaluate(()=>globalThis.__registrationTest.ping())).toBe(true);await guestContext.setOffline(false);
      await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.pingCount()),{timeout:15000}).toBeGreaterThan(before);
      expect((await guest.evaluate(()=>globalThis.__registrationTest.status())).revision).toBe(fixture.candidate.registryRevision);
    }
    await page.screenshot({path:info.outputPath('registered-coop.png')});await info.attach('coop-result.json',{body:JSON.stringify(state),contentType:'application/json'});
    if(width===390){
      expect(await guest.evaluate(()=>globalThis.__registrationTest.badCoopPacket())).toBe(true);
      await expect.poll(()=>page.evaluate(()=>globalThis.__registrationTest.status()),{timeout:10000}).toMatchObject({phase:'ended',error:'登録版と受信した協力戦データが一致しないため停止しました。部屋の版は変更していません。'});
      expect((await page.evaluate(()=>globalThis.__registrationTest.status())).units).toEqual(state.units);
      await info.attach('coop-client-rejection.json',{body:JSON.stringify({rulesEnvelopeAccepted:true,internalRevisionRejectedByClient:true,unitsUnchanged:true}),contentType:'application/json'});
    }
  }finally{
    for(const [label,c] of [['host',context],['guest',guestContext]])if(c.pages()[0])await info.attach(label+'-diagnostic.json',{contentType:'application/json',body:JSON.stringify(await c.pages()[0].evaluate(()=>({state:globalThis.__registrationTest?.status(),packet:globalThis.__registrationPacketDiagnostic})).catch(()=>({unavailable:true})))});
    await context.close();await guestContext.close();
  }
});

test('A then B then A update preserves live revision, resolves old definition, new room uses latest',async({browser},info)=>{
  const contexts=[];
  async function page(){const context=await browser.newContext({serviceWorkers:'block'});contexts.push(context);await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});const page=await context.newPage();await install(page);return page;}
  try{
    const host=await page(),guest=await page();const code=await host.evaluate(()=>globalThis.__registrationTest.create('1v1'));await guest.evaluate(code=>globalThis.__registrationTest.join(code),code);
    await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status())).toMatchObject({seats:['e1','p1']});
    for(const p of [host,guest]){await p.selectOption('#onlineCharacter','registry-a');expect(await p.evaluate(()=>globalThis.__registrationTest.ready())).toBe(true);}
    await host.evaluate(()=>globalThis.__registrationTest.start());await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing'});
    const before=await guest.evaluate(()=>globalThis.__registrationTest.snapshot());
    await activate(fixture.ab,'b'.repeat(40));const updated=await activate(fixture.a2b,'c'.repeat(40));const retry=await activate(fixture.a2b,'c'.repeat(40));expect(retry.changed).toBe(false);expect(retry.generation).toBe(updated.generation);
    expect(fixture.ab.characters['registry-b']).toEqual(fixture.a2b.characters['registry-b']);
    expect(await guest.evaluate(()=>globalThis.__registrationTest.pinnedAgain())).toBe(fixture.candidate.characters['registry-a'].definition.maxHp);
    const after=await guest.evaluate(()=>globalThis.__registrationTest.snapshot());expect(after.registryRevision).toBe(before.registryRevision);expect(after.definitionHashes).toEqual(before.definitionHashes);
    await guest.reload();await guest.waitForFunction(()=>!!globalThis.__registrationTest);
    await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing',revision:before.registryRevision});
    const fresh=await page();const newCode=await fresh.evaluate(()=>globalThis.__registrationTest.create('1v1'));expect((await admin('registeredRooms/'+newCode)).registryRevision).toBe(fixture.a2b.registryRevision);
    await info.attach('revision-transition.json',{contentType:'application/json',body:JSON.stringify({before:before.registryRevision,after:after.registryRevision,newRevision:fixture.a2b.registryRevision,publisher:updated,retry,bUnchanged:true})});
  }finally{for(const context of contexts){for(const page of context.pages())await info.attach('recovery-state.json',{contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>({state:globalThis.__registrationTest?.status(),failure:globalThis.__registryRecoveryFailure})).catch(()=>({unavailable:true})))});await context.close();}}
});

test('actual pre-registry client pair still plays protocol3; registered join does not downgrade',async({browser},info)=>{
  const contexts=[];
  async function page(legacy){const context=await browser.newContext({serviceWorkers:'block'});contexts.push(context);await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});const p=await context.newPage();await install(p,legacy);return p;}
  try{
    const host=await page(true),guest=await page(true),modern=await page(false);const code=await host.evaluate(()=>globalThis.__registrationTest.create('1v1'));
    const rejected=await modern.evaluate(async code=>{try{await globalThis.__registrationTest.join(code);return false;}catch(_){return true;}},code);expect(rejected).toBe(true);
    await guest.evaluate(code=>globalThis.__registrationTest.join(code),code);await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status())).toMatchObject({seats:['e1','p1']});
    for(const p of [host,guest]){await p.selectOption('#onlineCharacter','kyoryu');expect(await p.evaluate(()=>globalThis.__registrationTest.ready())).toBe(true);}
    await host.evaluate(()=>globalThis.__registrationTest.start());await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing',revision:null});
    expect((await admin('rooms/'+code)).protocol).toBe(3);
    await info.attach('actual-old-client.json',{contentType:'application/json',body:JSON.stringify({sourceSha:oldSha,protocol:3,pairStarted:true,registeredJoinRejected:true})});
  }finally{for(const context of contexts)await context.close();}
});

test('new client explicitly joins an actual old client with the legacy18 contract',async({browser},info)=>{
  const contexts=[];
  async function page(legacy){const context=await browser.newContext({serviceWorkers:'block'});contexts.push(context);await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});const p=await context.newPage();await install(p,legacy,'legacy');return p;}
  try{
    const host=await page(true),guest=await page(false);
    const code=await host.evaluate(()=>globalThis.__registrationTest.create('1v1'));await guest.evaluate(code=>globalThis.__registrationTest.join(code),code);
    await expect.poll(()=>host.evaluate(()=>globalThis.__registrationTest.status())).toMatchObject({seats:['e1','p1']});
    for(const p of [host,guest]){await p.selectOption('#onlineCharacter','kyoryu');expect(await p.evaluate(()=>globalThis.__registrationTest.ready())).toBe(true);}
    expect(await guest.locator('#onlineCharacter option').count()).toBe(18);
    await host.evaluate(()=>globalThis.__registrationTest.start());await expect.poll(()=>guest.evaluate(()=>globalThis.__registrationTest.status()),{timeout:30000}).toMatchObject({phase:'playing',revision:null});
    await info.attach('mixed-client-result.json',{contentType:'application/json',body:JSON.stringify({oldSource:oldSha,newClientLegacyMode:true,protocol:3,choices:18,started:true})});
  }finally{for(const context of contexts)await context.close();}
});

for(const width of [360,390,412])test(`missing registry stops explicitly without legacy downgrade ${width}px`,async({browser},info)=>{
  await admin('characterRegistry/active','DELETE');
  const context=await browser.newContext({viewport:{width,height:520},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  try{
    await context.grantPermissions(['local-network-access'],{origin:'http://127.0.0.1:4183'});const page=await context.newPage();await install(page);
    await page.evaluate(()=>globalThis.__registrationTest.open());await page.locator('#onlineVersusKind').click();await page.locator('#onlineCreateMode').click();await page.locator('#onlineCreatePublic').click();
    await expect(page.locator('#onlineLobbyStatus')).toContainText('登録対戦はまだ有効化されていません');
    expect(page.url()).toContain('roster=registered');expect((await page.evaluate(()=>globalThis.__registrationTest.status())).revision).toBeNull();
    const box=await page.locator('#onlineCreatePublic').boundingBox();expect(box.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({path:info.outputPath('registry-not-deployed.png')});
    await info.attach('unavailable-result.json',{contentType:'application/json',body:JSON.stringify({width,height:520,downgraded:false,button:box})});
  }finally{await context.close();}
});
