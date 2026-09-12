const assert=require('node:assert/strict'),{fork}=require('node:child_process'),path=require('node:path');
const seats=['p1','e1','s1','s2'];let seq=0,checks=0,queue=[],last=[],types={},history=[];
const children=seats.map(()=>fork(path.join(__dirname,'coop-simultaneous-peer.cjs'),[],{stdio:['ignore','inherit','inherit','ipc']}));
const pending=new Map();
children.forEach((c,i)=>c.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Error(m.error));else{last[i]=m.state;for(const packet of m.out){queue.push({source:i,packet});history.push(packet);types[packet.t]=(types[packet.t]||0)+1;}p.resolve(m);}}));
function rpc(i,cmd,extra={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});children[i].send({id,cmd,...extra});});}
async function drain(){let count=0;while(queue.length){if(++count>200)throw Error('packet loop');const {source,packet}=queue.shift();for(let i=0;i<4;i++)if(i!==source){const r=await rpc(i,'receive',{packet});assert.ok(r.result,`transport rejects ${packet.t} from ${source} to ${i}`);}}}
async function step(frames=6){await Promise.all(children.map((c,i)=>rpc(i,'step',{frames})));await drain();for(const s of last)assert.ok(!s.error,s.error);}
async function until(fn,max=400){for(let i=0;i<max;i++){if(fn())return;await step();}throw Error('timeout '+JSON.stringify(last.map(s=>({phase:s.phase,ready:s.ready,turn:s.turnCount,input:s.inputReady,err:s.error,action:s.remoteAction}))))}
function check(v,m){assert.ok(v,m);checks++;}
(async()=>{try{
 await Promise.all(seats.map((seat,i)=>rpc(i,'init',{seat,boss:process.argv[2]})));await drain();
 await until(()=>last.every(s=>s.inputReady));
 check(last.every(s=>s.salvo.total===4),'all four can act in same round');
 const before=last.map((s,i)=>s.units[i].x);
 await Promise.all(children.map((c,i)=>rpc(i,'move',{dir:1})));
 await step(30);
 await Promise.all(children.map((c,i)=>rpc(i,'move',{dir:0})));await step(30);
 check(last.every((s,i)=>s.units[i].x>before[i]),'four humans move concurrently');
 await step(60);
 const positions=last.map(s=>s.units.slice(0,4).map(u=>Math.round(u.x)));
 check(positions.every(p=>JSON.stringify(p)===JSON.stringify(positions[0])),'all clients see same settled positions');
 for(let i=3;i>=1;i--){check((await rpc(i,'ready')).result,'guest ready out of seat order');await drain();}
 const duplicate=history.find(p=>p.t==='salvoReady');
 await rpc(0,'receive',{packet:duplicate});await drain();
 check(last[0].salvo.ready===3,'same-round duplicate ready cannot add an action');
 check(last.every(s=>s.salvo.ready===3&&s.projectiles.length===0),'ready ack shared with no early fire');
 check((await rpc(0,'ready')).result,'last human ready');await drain();await until(()=>last.every(s=>s.salvo?.launchTicks.length===4),20);
 check(last.every(s=>s.salvo.launchTicks.length===4&&s.salvo.launchTicks.every(t=>t===0)),'all peers launch four on same physics tick');
 await until(()=>last.every(s=>s.turnCount>=5&&s.inputReady));
 check(last.every(s=>s.turnCount===5),'one boss turn then shared second round');
 check(last.every(s=>s.bossHp===last[0].bossHp),'authoritative boss HP converges');
 // Nobody ready: common deadline advances without synthesizing a shot.
 await Promise.all(children.map((c,i)=>rpc(i,'clock',{ms:31000})));await step(1);await until(()=>last.every(s=>s.salvo?.phase==='resolving'),10);
 check(last.every(s=>s.salvo.phase==='resolving'&&s.salvo.launchTicks.length===0),'all idle timeout skips every ally');
 await until(()=>last.every(s=>s.turnCount>=10&&s.inputReady));
 check(last.every(s=>s.turnCount===10),'timeout round also resolves and resets fuel/ready');
 // Replays cannot change a later preparation round.
 const oldReady=history.find(p=>p.t==='salvoReady'),oldFire=history.find(p=>p.t==='salvoFire');
 const count=last[0].salvo.ready;
 await rpc(0,'receive',{packet:oldReady});await rpc(1,'receive',{packet:oldFire});await step(1);
 check(last.every(s=>s.salvo.ready===count&&s.turnCount===10),'old round ready/fire ignored');
 check(!(await rpc(0,'validate',{packet:{...oldReady,unitId:'p2'}})).result,'other-seat ready rejected at transport');
 check(!(await rpc(0,'validate',{packet:{...oldReady,action:{...oldReady.action,vx0:Infinity}}})).result,'nonfinite shot rejected');
 check(!(await rpc(0,'validate',{packet:{...oldFire,from:'user1'}})).result,'guest cannot forge collective fire');
 await Promise.all(children.map((c,i)=>rpc(i,'position')));
 await Promise.all(children.map((c,i)=>rpc(i,'special')));
 for(let i=0;i<4;i++){check((await rpc(i,'aim',{special:true})).result,'special ready');await drain();}
 await until(()=>last.every(s=>s.salvo?.launchTicks.length===4));
 check(last.every(s=>s.salvo.launchTicks.every(t=>t===0)),'four specials share launch tick');
 await until(()=>last.every(s=>s.turnCount>=14&&(s.onlinePhase==='results'||s.phase==='collecting'&&s.ready)));

 check(last[0].bossHp<1650&&last.every(s=>s.bossHp===last[0].bossHp),'real special damage converges '+JSON.stringify(last.map(s=>s.bossHp)));
 // Independent phase-change scenario starts with fresh HP and statuses.
 await Promise.all(seats.map((seat,i)=>rpc(i,'init',{seat,boss:process.argv[2]})));await drain();
 await until(()=>last.every(s=>s.inputReady));
 await Promise.all(children.map((c,i)=>rpc(i,'hp',{unit:'boss1',hp:800})));
 for(let i=0;i<4;i++){await rpc(i,'ready');await drain();}
 await until(()=>last.every(s=>s.turnCount>=5&&s.inputReady));
 check(last.every(s=>s.units[4].phase===2),'phase two transformation converges');
 const legacy={...history.find(p=>p.t==='hello'),salvoVersion:0};
 await rpc(1,'receive',{packet:legacy});
 check(last[1].onlinePhase==='ended'&&last[1].error.includes('バージョン'),'legacy client mismatch closes with update guidance');
 console.log('Coop simultaneous four-peer:',checks,'passed',types);
 }finally{children.forEach(c=>c.kill());}
})().catch(e=>{console.error(e);process.exitCode=1;});
