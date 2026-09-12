const {kt}=require('./seatharness.js');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const file=path.join(__dirname,'../coop-mvp-battle.js');
const context={module:{exports:{}},require:require('node:module').createRequire(file)};
vm.runInNewContext(fs.readFileSync(file,'utf8').replace('    normalSnapshotLooksSafe,','    normalSnapshotLooksSafe,\n    packetSafe: normalPacketLooksSafe,'),context);
const battle=globalThis.KatamonCoopBattle=context.module.exports,bridge=globalThis.KatamonCoopBridge;
let now=100000,out=[],handler,roster,config,seat;
const slots=Object.fromEntries(['p1','e1','s1','s2'].map((s,i)=>[s,{uid:'user'+i,character:['kyoryu','medama','iwa','tori'][i],coopItem:'rescue-kit'}]));
process.on('message',m=>{
 try{
 let result;
 if(m.cmd==='init'){
  seat=m.seat;roster=battle.activeRoster(slots,true,bridge.getBattleCharacters());
  config={bossId:m.boss||'storm-dragon-02',bossMaxHp:1650,difficulty:'normal'};
  bridge.startNormalBattle({...config,roster,session:{role:seat==='p1'?'host':'guest',seat,auth:{uid:slots[seat].uid},room:{slots}},
   serverNow:()=>now,transport:{send:p=>{out.push(JSON.parse(JSON.stringify(p)));return Promise.resolve(true);},onMessage:fn=>handler=fn,close:()=>{}}});
 }else if(m.cmd==='validate'){
  const p=m.packet,fromSeat=Object.keys(slots).find(s=>slots[s].uid===p.from);
  result=battle.packetSafe(p,{from:p.from,seat:fromSeat},roster,config);
 }else if(m.cmd==='receive'){
  const p=m.packet,fromSeat=Object.keys(slots).find(s=>slots[s].uid===p.from);
  result=battle.packetSafe(p,{from:p.from,seat:fromSeat},roster,config);
  if(result)handler(p);
 }else if(m.cmd==='step'){for(let i=0;i<m.frames;i++){now+=1000/60;kt().step(1/60);}}
 else if(m.cmd==='aim')result=kt().salvoTest.aim(m.special,m.target);
 else if(m.cmd==='ready') result=kt().salvoTest.ready(undefined,m.options);
 else if(m.cmd==='move')kt().salvoTest.move(m.dir);
 else if(m.cmd==='clock')now+=m.ms;
 else if(m.cmd==='position'){for(let i=0;i<4;i++){const u=kt().unitById(['p1','e1','p2','e2'][i]);Object.assign(u,{x:1500+i*35,y:830,grounded:true,vy:0,netWalkTargetX:null});}}
 else if(m.cmd==='special')kt().fillCharges();
 else if(m.cmd==='hp')kt().unitById(m.unit).hp=m.hp;
 else if(m.cmd==='menu')kt().salvoTest.menu(m.value);
 process.send({id:m.id,result,state:kt().salvoTest.status(),out});out=[];
 }catch(e){process.send({id:m.id,error:e.stack});}
});
