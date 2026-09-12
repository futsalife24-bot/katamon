const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../coop-mvp-battle.js'),'utf8');
// Expose the existing transport only in this VM, without adding a shipping test API.
const context={module:{exports:{}},require:require('node:module').createRequire(path.join(__dirname,'../coop-mvp-battle.js'))};
vm.runInNewContext(source.replace('    startSoloBrowser,','    __testTransport: createNormalBattleTransport,\n    startSoloBrowser,'),context);
const make=context.module.exports.__testTransport;
async function delivered(code){
 const timers=[],received=[];let reads=0;
 const slots={p1:{uid:'host',seenAt:Date.now()},e1:{uid:'guest',seenAt:Date.now()}},roundId='a'.repeat(48);
 const outer=label=>({v:1,t:'net',roundId,seat:'p1',from:'host',payload:JSON.stringify({v:2,t:'ping',generation:1,from:'host',label})});
 const bridge={serverNow:()=>Date.now(),request:async (p,a,o)=>{
  if(p.endsWith('/messages')){reads++;return reads===1?{'-00000000000000000000':null}:reads===2?{'-0000000000000000000Z':outer('upper')}:reads===3?{'-0000000000000000000a':outer('lower')}:{};}
  if(p.endsWith('/slots'))return slots;if(p.endsWith('/phase'))return 'playing';return null;
 }};
 const root={setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},console:{warn:()=>{}}};
 const transport=make(root,{bridge,bossId:code,session:{code:'ABCDEFGH',role:'host',seat:'p1',auth:{uid:'host'},room:{slots,round:{id:roundId}}}},slots);
 transport.onMessage(p=>received.push(p.label));
 // Drain the initial asynchronous read, then execute exactly two subsequent polls.
 for(let i=0;i<8;i++)await Promise.resolve();
 for(let i=0;i<2;i++){
  const at=timers.findIndex(t=>t.fn.name==='poll');assert.ok(at>=0);const [{fn}]=timers.splice(at,1);await fn();
 }
 transport.close();return received;
}
(async()=>{
 assert.deepEqual(await delivered('storm-dragon-02'),['upper','lower'],'later RTDB lowercase key must not be skipped after uppercase cursor');
 assert.deepEqual(await delivered('siege-fortress-01'),['upper','lower'],'fortress uses the same RTDB key ordering');
 console.log('Storm transport: 2/2 ordering checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
