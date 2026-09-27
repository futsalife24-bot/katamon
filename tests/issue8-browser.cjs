'use strict';
// Real Chromium/WebKit, independent storage contexts, native SSE, actual RTDB Rules.
// Requires only LOCAL Auth + RTDB emulators; every non-loopback request is blocked.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/issue8');
fs.mkdirSync(out, { recursive: true });
const project = 'demo-catamon-registration';
const db = 'http://127.0.0.1:19000';
const auth = 'http://127.0.0.1:19099';
const engine = process.env.KATAMON_BROWSER || 'chromium';
const events = [], errors = [];
const bridge = `
  const issue8WriteFailures=[]; const issue8MakeTransport=makeFirebaseTransport;
  makeFirebaseTransport=function(...args){const transport=issue8MakeTransport(...args);if(transport){const send=transport.send;transport.send=packet=>send(packet).then(ok=>{if(!ok)issue8WriteFailures.push({t:packet.t,seat:packet.seat,actionId:packet.actionId});return ok;});}return transport;};
  globalThis.issue8 = {
    async create() {
      const r = await createFirebaseRoom(null, { terrain:'rolling',wind:'calm',turnsPerPlayer:10,format:'1v1',stageSize:'standard',revision:1 }, {visibility:'private',gearMode:globalThis.KatamonGearOnlineProtocol.GEAR_MODE_OFF});
      beginFirebaseOnline('host',r.code,r.auth,'kyoryu',r.room,r.seat,null,r.reentryLease);
      return r.code;
    },
    async join(code) {
      const r = await claimFirebaseRoom(code);
      beginFirebaseOnline('guest',code,r.auth,'iwa',r.room,r.seat,null,r.reentryLease);
    },
    ready() { return commitOwnCharacterSelection(online.seat === 'p1' ? 'kyoryu' : 'iwa'); },
    start() { return requestFirebaseStart(); },
    state() {
      return structuredClone({room:online?.room, round:online?.currentRoundId,seat:online?.seat,
        phase:online?.phase,rosterSeats:Object.keys(online?.slots || {}).filter(k=>online.slots[k]?.uid),gamePhase,localUnitId,turn:turnCount,active:activeUnit()?.id,
        action:online?.localAction?.actionId || online?.remoteAction?.actionId || null,
        completed:Array.from(online?.completedRemoteActions?.keys() || []),
        canAct:online?.phase === 'playing' && gamePhase === 'battle' && isLocalTurn() && !netInputLocked() && !awaitingResolve && !matchOver && !cutIn,
        matchOver,winner,hidden:document.hidden,cutIn:!!cutIn,projectiles:projectiles.map(p=>({x:p.x,y:p.y,vx:p.vx,vy:p.vy})),pending:awaitingResolve,protocolError:online?.protocolError || null,
        failure:firebaseReentryLastFailureCode,bootstrap:firebaseReentryBootstrapState,status:onlineLobbyStatusEl?.textContent,
        writesFailed:issue8WriteFailures,snapshot:buildSnapshot(),credential:!!loadFirebaseReentryCredential()});
    },
    async move() {
      if (!isLocalTurn() || netInputLocked() || awaitingResolve || cutIn) return false;
      const u=localUnit(), x=u.x, fuel=u.fuel;
      moveDir=u.id==='p1'?1:-1;
      await new Promise(resolve=>setTimeout(resolve,350));
      moveDir=0; sendMoveUpdate(u);
      return u.x!==x && u.fuel<fuel;
    },
    fire() {
      if (online?.phase !== 'playing' || gamePhase !== 'battle' || !isLocalTurn() || netInputLocked() || awaitingResolve || matchOver || cutIn) return false;
      const u=localUnit(), a={x:u.x,y:u.y}, vx=u.id === 'p1' ? -1000 : 1000;
      netSendFire(u,a,vx,-140,false,false);
      launchShot(u,a,vx,-140,false,false,false);
      awaitingResolve=true;
      return true;
    },
    async raw(packet, round) {
      const response=await fetch(firebaseRequestUrl('rooms/'+online.room+'/rounds/'+(round || online.currentRoundId)+'/messages/'+firebasePushId(),online.auth),{method:'PUT',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','if-match':'null_etag'},body:JSON.stringify({...packet,sentAt:firebaseServerNow(online.auth)})});
      return response.status;
    },
    ownPacket(t,extra={}) { return {v:FIREBASE_PROTO_VERSION,t,from:online.clientId,seat:online.seat,roundId:online.currentRoundId,...extra}; },
    handoff() { globalThis.issue8OldTransport=online.transport; dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})); },
    queue(packet) { return online.transport.send(packet); },
    oldSend(packet) { return globalThis.issue8OldTransport.send(packet); },
    reconnect() { return online.transport.reconnect(); },
    rematch() { return requestFirebaseRematch(); },
    receive(packet) { netReceive(packet); },
    async history() { return firebaseRequest('rooms/'+online.room+'/rounds/'+online.currentRoundId+'/messages',online.auth); }
  };
`;
function instrument(source) {
  source=source.replace(/\r\n/g,'\n');
  source=source.replace(/https:\/\/[^'"\s]+\.firebasedatabase\.app/g,db);
  source=source.replaceAll('https://identitytoolkit.googleapis.com/',auth+'/identitytoolkit.googleapis.com/');
  source=source.replaceAll('https://securetoken.googleapis.com/',auth+'/securetoken.googleapis.com/');
  source=source.replace('new URLSearchParams({ auth: auth.idToken })',`new URLSearchParams({ auth: auth.idToken, ns: '${project}-default-rtdb' })`);
  const marker='\n})();\n</script>\n<script src="coop-mvp-boss.js"';
  assert.ok(source.includes(marker),'production main script boundary');
  return source.replace(marker,bridge+marker);
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if (!p.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  fs.readFile(p,(err,bytes)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(p.endsWith('index.html')?instrument(bytes.toString()):bytes);});
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=30000) {const deadline=Date.now()+ms;let last;while(Date.now()<deadline){last=await fn();if(last)return last;await sleep(150);}throw new Error('Timeout: '+label);}
const state=p=>p.evaluate(()=>issue8.state());
function board(s) {return {round:s.round,turn:s.turn,active:s.active,matchOver:s.matchOver,winner:s.winner,units:s.snapshot.units.map(u=>({id:u.id,hp:u.hp,x:u.x,y:u.y,fuel:u.fuel})),craters:s.snapshot.craters,wind:s.snapshot.wind,turnOrder:s.snapshot.turnOrder};}
function record(name,detail={}) {events.push({name,at:new Date().toISOString(),...detail});console.log('PASS '+name);}
async function main(){
  // Fail closed before any browser starts. No production DB fallback.
  const loaded=await fetch(db+'/.settings/rules.json?ns='+project+'-default-rtdb',{headers:{Authorization:'Bearer owner'}});
  assert.equal(loaded.status,200,'local emulator required');
  assert.deepEqual(await loaded.json(),JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'))),'actual repository Rules');
  // Prime only the local Auth emulator before starting timed gameplay requests.
  // A cold emulator/browser startup is not a recovery latency assertion.
  const ready=await fetch(auth+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true}),signal:AbortSignal.timeout(60000)});
  assert.equal(ready.status,200,'local Auth emulator ready');
  await ready.arrayBuffer();
  console.log('READY local Auth and RTDB emulators');
  await new Promise(r=>server.listen(4189,'127.0.0.1',r));
  const browser=await ({chromium,webkit}[engine]).launch({headless:true});
  let host,guest;
  try {
    async function context(){const c=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return c;}
    const hc=await context(), gc=await context();
    let delayed=0, comparisonTarget=null, comparisonPuts=0, comparisonGets=0, injectComparison=false;
    await hc.route('**/messages/*.json?*',async r=>{
      const request=r.request();
      if(injectComparison && !comparisonTarget && request.method()==='PUT' && request.postDataJSON()?.t==='ping')comparisonTarget=request.url();
      if(comparisonTarget && request.url()===comparisonTarget) {
        if(request.method()==='PUT') {
          comparisonPuts++;
          if(comparisonPuts===1) {
            const persisted=await r.fetch();assert.equal(persisted.status(),200);
            await r.abort('connectionreset');return;
          }
        } else if(request.method()==='GET') {
          comparisonGets++;
          if(comparisonGets===1){await r.fulfill({status:503,contentType:'application/json',body:'null'});return;}
        }
      }
      if (!delayed && r.request().method()==='PUT' && r.request().postDataJSON()?.t==='state') {
        delayed++; await sleep(750);
      }
      await r.fallback();
    });
    async function page(c){const p=await c.newPage();p.setDefaultNavigationTimeout(120000);p.on('console',m=>{if(m.type()==='error')console.log('browser-error',m.text().replace(/[?][^\s]+/g,'?REDACTED'));});p.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),new URL(r.url()).pathname);});p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:4189/index.html',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!globalThis.issue8,null,{timeout:120000});if((await state(p)).gamePhase==='press'){await p.mouse.click(640,400);await until(async()=> (await state(p)).gamePhase!=='press','leave press screen');}return p;}
    host=await page(hc); guest=await page(gc);
    const room=await host.evaluate(()=>issue8.create());
    await guest.evaluate(code=>issue8.join(code),room);
    await until(async()=> (await state(host)).phase==='lobby'&&(await state(guest)).phase==='lobby'&&(await state(host)).rosterSeats.includes('e1'),'two independent lobby clients');
    record('independent host + guest lobby',{room});
    assert.equal(await host.evaluate(()=>issue8.ready()),true);
    assert.equal(await guest.evaluate(()=>issue8.ready()),true);
    await until(async()=>{await host.evaluate(()=>issue8.start());return (await state(host)).phase==='playing'&&(await state(guest)).phase==='playing';},'start');
    await until(async()=> (await state(host)).canAct || (await state(guest)).canAct,'first input');
    record('commit/reveal/start through actual Rules and native SSE');
    injectComparison=true;
    assert.equal(await host.evaluate(()=>issue8.queue(issue8.ownPacket('ping'))),true);
    injectComparison=false;
    assert.equal(comparisonPuts,3);assert.equal(comparisonGets,2);
    record('persisted ping response loss then comparison GET 503 recovers',{puts:comparisonPuts,gets:comparisonGets});
    async function converged(label){await until(async()=>{const a=await state(host),b=await state(guest);return !a.pending&&!b.pending&&!a.action&&!b.action&&(a.matchOver || a.canAct || b.canAct)&&JSON.stringify(board(a))===JSON.stringify(board(b));},label,45000);const a=await state(host),b=await state(guest);assert.equal(a.protocolError,null);assert.equal(b.protocolError,null);if(!a.matchOver)assert.notEqual(a.canAct,b.canAct);record(label,{turn:a.turn,active:a.active});}
    async function shot(){await until(async()=> (await state(host)).canAct || (await state(guest)).canAct,'input available');const actor=(await state(host)).canAct?host:guest;record('fire attempt',{seat:(await state(actor)).seat,turn:(await state(actor)).turn,active:(await state(actor)).active});assert.equal(await actor.evaluate(()=>issue8.fire()),true);return actor;}
    const mover=(await state(host)).canAct?host:guest;
    assert.equal(await mover.evaluate(()=>issue8.move()),true);
    record('production movement changes position and fuel');
    await shot();await converged('first action boundary');
    fs.writeFileSync(path.join(out,engine+'-first-history.json'),JSON.stringify(await host.evaluate(()=>issue8.history()),null,2));
    // Disconnect the non-acting client so the authority can finish a real action.
    for (const seat of ['e1','p1']) {
      let a=await state(host);
      if(a.active===seat){await shot();await converged('arrange peer turn '+seat);}
      const lost=seat==='p1'?host:guest, lostContext=seat==='p1'?hc:gc;
      await lostContext.setOffline(true);
      await shot();
      await until(async()=>!(await state(seat==='p1'?guest:host)).pending,'actor settles offline peer');
      await lostContext.setOffline(false);
      if(seat==='p1') await lost.evaluate(()=>issue8.reconnect());
      await converged('native SSE offline/'+(seat==='e1'?'automatic reconnect ':'explicit reconnect ')+seat);
      await lost.reload({waitUntil:'domcontentloaded'});await lost.waitForFunction(()=>!!globalThis.issue8);
      await until(async()=> (await state(lost)).phase==='playing','zero-input reload '+seat,45000);
      // A slow full reload can exceed the existing 35s visible-peer timeout.
      // Preserve that production policy; explicitly test manual re-entry of the
      // waiting client rather than increasing timeouts or accepting an ended UI.
      const waiting=seat==='p1'?guest:host;
      const waitingState=await state(waiting);
      if(waitingState.protocolError==='相手との通信が途切れました。') {
        assert.equal(waitingState.phase,'ended');
        record('visible peer timeout requires explicit re-entry',{seat:waitingState.seat});
        await waiting.reload({waitUntil:'domcontentloaded'});await waiting.waitForFunction(()=>!!globalThis.issue8);
        await until(async()=> (await state(waiting)).phase==='playing','waiting peer manual re-entry',45000);
      }
      await converged('canonical history reload '+seat);
    }
    // Native lock takeover: new tab cannot act until old document hands off.
    const old=guest, duplicate=await page(gc);
    await until(async()=> (await state(duplicate)).bootstrap==='retry_wait','second-tab rejection');
    assert.equal((await state(duplicate)).canAct,false);
    const oldPacket=await old.evaluate(()=>issue8.ownPacket('ping'));
    // Hold a real old-tab request; its queued fire must never begin after lease handoff.
    let heldPing=false, releasePing, queuedFirePuts=0;
    const pingGate=new Promise(resolve=>{releasePing=resolve;});
    await old.route('**/messages/*.json?*',async route=>{
      const message=route.request().postDataJSON();
      if(route.request().method()==='PUT' && message?.t==='fire') queuedFirePuts++;
      if(route.request().method()==='PUT' && message?.t==='ping' && !heldPing){heldPing=true;await pingGate;}
      await route.continue();
    });
    await old.evaluate(()=>{globalThis.issue8QueuedPing=issue8.queue(issue8.ownPacket('ping'));});
    await until(()=>heldPing,'old ping is in flight');
    const priorGuestFire=Object.values(await old.evaluate(()=>issue8.history())).find(p=>p.t==='fire'&&p.seat==='e1');
    assert.ok(priorGuestFire);
    await old.evaluate(p=>{globalThis.issue8QueuedFire=issue8.queue(p);},priorGuestFire);
    await old.evaluate(()=>issue8.handoff());
    releasePing();
    assert.deepEqual(await old.evaluate(async()=>[await globalThis.issue8QueuedPing,await globalThis.issue8QueuedFire]),[false,false]);
    assert.equal(queuedFirePuts,0,'closed old queue must not dispatch even its first fire PUT');
    record('native old-tab queued fire cancelled at handoff',{queuedFirePuts});
    await until(async()=> (await state(duplicate)).phase==='playing','replacement acquires lease',45000);
    assert.equal(await old.evaluate(p=>issue8.oldSend(p),oldPacket),false);
    guest=duplicate;
    await converged('two-tab handoff and old transport rejection');
    await old.close();
    // Re-deliver an already completed authoritative state under a fresh key.
    const history=await host.evaluate(()=>issue8.history());
    const terminal=Object.values(history).find(p=>p.t==='state');assert.ok(terminal);
    const sender=terminal.seat==='p1'?host:guest;
    const before=board(await state(host));
    assert.equal(await sender.evaluate(p=>issue8.raw(p),terminal),200);
    await sleep(500);await converged('duplicate old actionId ignored');
    assert.deepEqual(board(await state(host)),before);
    const stale = structuredClone(terminal); stale.snap.units[0].hp = Math.max(0, stale.snap.units[0].hp - 1);
    assert.equal(await sender.evaluate(p=>issue8.raw(p),stale),200);
    await sleep(250); await converged('stale snapshot cannot overwrite current board');
    assert.deepEqual(board(await state(host)),before);
    const oldRound='f'.repeat(48), packet={...terminal,roundId:oldRound};
    assert.equal(await sender.evaluate(({p,r})=>issue8.raw(p,r),{p:packet,r:oldRound}),401);
    record('old-round write rejected by actual Rules');
    // Complete without changing HP/balance: ordinary outward shots reach turn cap.
    for(let i=0;i<24 && !(await state(host)).matchOver;i++){
      const s=await state(host), final=s.turn===19;
      const lostContext=s.canAct?gc:hc, lost=s.canAct?guest:host;
      if(final)await lostContext.setOffline(true);
      const actor=await shot();
      if(final){await until(async()=> (await state(actor)).matchOver,'result while peer offline');await lostContext.setOffline(false);await lost.evaluate(()=>issue8.reconnect());}
      await converged(final?'result-boundary offline/reconnect':'normal action '+i);
    }
    await until(async()=> (await state(host)).matchOver&&(await state(guest)).matchOver,'same result');
    const result=board(await state(host));record('normal result',{winner:result.winner});
    assert.equal(await sender.evaluate(p=>issue8.raw(p),terminal),200);
    await sleep(250); assert.deepEqual(board(await state(host)),result); assert.deepEqual(board(await state(guest)),result);
    record('late battle state cannot rewrite a result');
    for(const p of [host,guest]){await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!globalThis.issue8);await until(async()=> (await state(p)).phase==='results','result reload',180000);assert.deepEqual(board(await state(p)),result);}
    record('same result after host and guest reload');
    await host.screenshot({path:path.join(out,engine+'-result.png')});
    await host.evaluate(()=>issue8.rematch()); await guest.evaluate(()=>issue8.rematch());
    await until(async()=>{const a=await state(host),b=await state(guest);return a.round!==result.round&&a.round===b.round;},'rematch round fence');
    const delayedPacket={...terminal,roundId:result.round};
    assert.equal(await sender.evaluate(({p,r})=>issue8.raw(p,r),{p:delayedPacket,r:result.round}),401);
    record('rematch advances round and rejects old-round packet');
    assert.equal(delayed,1); record('delayed authoritative PUT preserves serial action ordering');
    await host.screenshot({path:path.join(out,engine+'-rematch.png')});
    assert.deepEqual(errors,[],'page errors');
  } catch(error) {
    if(host&&!host.isClosed())try{fs.writeFileSync(path.join(out,engine+'-failure-history.json'),JSON.stringify(await host.evaluate(()=>issue8.history()),null,2));}catch{}
    for(const [name,p] of [['host',host],['guest',guest]]) if(p&&!p.isClosed()) {try{fs.writeFileSync(path.join(out,engine+'-'+name+'-failure.json'),JSON.stringify(await state(p),null,2));await p.screenshot({path:path.join(out,engine+'-'+name+'-failure.png')});}catch{}}
    throw error;
  } finally {await browser.close();await new Promise(r=>server.close(r));}
}
main().then(()=>{fs.writeFileSync(path.join(out,engine+'-acceptance.json'),JSON.stringify({engine,passed:true,events,errors},null,2));}).catch(e=>{fs.writeFileSync(path.join(out,engine+'-acceptance.json'),JSON.stringify({engine,passed:false,events,errors,error:e.stack},null,2));console.error(e);server.close();process.exitCode=1;});
