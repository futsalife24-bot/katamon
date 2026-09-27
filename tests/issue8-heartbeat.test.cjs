'use strict';
const assert = require('node:assert/strict');
const h = require('./seatharness.js').kt().stage3();
const live = h.firebaseLiveRoundContractForTest();
const originalFetch = global.fetch, originalSource = global.EventSource;
global.EventSource = class { addEventListener(){} close(){} };
const auth = {uid:'issue8-host',idToken:'test-only',serverTimeOffset:0};
const packet = t => ({v:3,t,from:auth.uid,seat:'p1',roundId:'a'.repeat(48),...(t==='ping'?{}:{actionId:'c'.repeat(48)})});
let passed=0;
(async()=>{
  for(const fault of ['network','timeout',503,408,429]) {
    let fatal=0, failing=true;
    global.fetch=async()=>{
      if(!failing)return {ok:true,status:200};
      if(fault==='network')throw new TypeError('Failed to fetch');
      if(fault==='timeout')throw Object.assign(new Error('request aborted'),{name:'AbortError'});
      return {ok:false,status:fault};
    };
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>{fatal++;});
    await transport.send(packet('ping'));
    assert.equal(fatal,0,'lost heartbeat must not poison action queue: '+fault);
    failing=false;
    assert.equal(await transport.send(packet('fire')),true);
    transport.close();
    assert.equal(await transport.send(packet('fire')),false,'closed old client stays fenced');
    passed++;
  }
  for(const fault of ['action-offline',401,403]) {
    let fatal=0;
    global.fetch=async()=>{if(fault==='action-offline')throw new TypeError('Failed to fetch');return {ok:false,status:fault};};
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>{fatal++;});
    assert.equal(await transport.send(packet(fault==='action-offline'?'fire':'ping')),false);
    assert.equal(fatal,1,'authority/permission failure stays terminal: '+fault);
    assert.equal(await transport.send(packet('fire')),false,'poisoned action queue is not revived');
    transport.close();passed++;
  }
  {
    const msg={...packet('state'),snap:{runStats:{shots:1},craters:[]}}, writes=[];
    global.fetch=async(url,options)=>{writes.push(JSON.parse(options.body));if(writes.length===1){msg.snap.runStats.shots=2;msg.snap.craters.push({x:1,y:2,r:3});throw new TypeError('lost response');}return {ok:true,status:200};};
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>{});
    assert.equal(await transport.send(msg),true);
    assert.deepEqual(writes[1],writes[0],'retry must retain the original wire body after local state advances');
    transport.close();passed++;
  }
  for (const first of [401,403,412]) {
    let calls=0, fatal=0;
    global.fetch=async(url,options)=>{
      if(options?.method==='GET' || !options?.method) return {ok:true,status:200,json:async()=>({t:'conflicting-body'})};
      calls++; const status=calls===1?first:503; return {ok:false,status};
    };
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>fatal++);
    assert.equal(await transport.send(packet('ping')),false,'hard failure cannot become a dropped ping: '+first);
    assert.equal(fatal,1);
    assert.equal(calls,1,'hard failure is not retried: '+first);
    assert.equal(await transport.send(packet('fire')),false);
    transport.close(); passed++;
  }
  for (const status of [200,503]) {
    let calls=0, release;
    global.fetch=async()=>{calls++;if(calls===1) return new Promise(resolve=>{release=resolve;}); return {ok:true,status:200};};
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>{});
    const first=transport.send(packet('ping'));
    const queued=transport.send(packet('fire'));
    await new Promise(resolve=>setImmediate(resolve));
    transport.close(); release({ok:status===200,status});
    assert.equal(await first,false,'closed transport cannot retry');
    assert.equal(await queued,false,'closed transport cannot dispatch queued authority');
    assert.equal(calls,1,'only request already in flight may finish');
    passed++;
  }
  {
    let calls=0,release;
    global.fetch=async()=>{calls++;if(calls===3)return new Promise(resolve=>{release=resolve;});return {ok:false,status:503};};
    const transport=live.createTransport('A2BC3DEF',auth,'a'.repeat(48),()=>{},()=>{},()=>{});
    const pending=transport.send(packet('ping'));
    while(!release) await new Promise(resolve=>setTimeout(resolve,10));
    transport.close();release({ok:false,status:503});
    assert.equal(await pending,false,'close during the final failed attempt is cancellation, not a dropped ping');
    assert.equal(calls,3);passed++;
  }
  console.log('issue8 transport: '+passed+'/'+passed+' cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.fetch=originalFetch;global.EventSource=originalSource;});
