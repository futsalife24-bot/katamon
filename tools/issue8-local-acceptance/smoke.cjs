'use strict';
// 架空データだけを使用。固定loopback以外のURLは組み立てない。tokenは出力・保存しない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),https=require('node:https');
const {request}=require('./lab.cjs');const core=require('./core.cjs');
const ca=fs.readFileSync(path.join(__dirname,'.state/localhost-cert.pem'));
const base='https://localhost:'+core.PORTS.web;
const checks=[];
async function call(route,method='GET',body,headers={}) { return request(base+route,{ca,method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)}); }
async function main(){
  const status=JSON.parse((await call('/__lab/status')).body);assert.equal(status.sourceSha,core.SOURCE_SHA);assert.equal(status.serviceWorkers,'blocked');checks.push('固定版status');
  const signup=await call('/__lab/auth/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-local-acceptance','POST',{returnSecureToken:true});assert.equal(signup.status,200);
  const auth=JSON.parse(signup.body);assert.ok(auth.idToken&&auth.localId&&auth.refreshToken);checks.push('実Auth emulator匿名認証');
  const now=Date.now(),round=crypto.randomBytes(24).toString('hex');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(crypto.randomBytes(8),b=>alphabet[b%alphabet.length]).join('');
  const room={protocol:3,hostUid:auth.localId,createdAt:{'.sv':'timestamp'},expiresAt:now+600000,visibility:'private',settings:{terrain:'rolling',wind:'calm',turnsPerPlayer:10,format:'1v1',stageSize:'standard',revision:1},slots:{p1:{uid:auth.localId,claimedAt:now}},round:{id:round,status:'lobby',players:{p1:auth.localId}},rounds:{[round]:{createdAt:now}}};
  const route='/__lab/db/rooms/'+code+'.json?auth='+encodeURIComponent(auth.idToken);
  let created=false;
  try{
    const createdResponse=await call(route,'PUT',room);assert.equal(createdResponse.status,200);created=true;checks.push('変更なしRulesで架空私室作成');
    const read=await call(route);assert.equal(read.status,200);assert.equal(JSON.parse(read.body).round.id,round);checks.push('自分の私室読戻し');
    const denied=await call('/__lab/db/rooms/'+code+'.json');assert.ok([401,403].includes(denied.status));checks.push('未認証read拒否');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('実emulator SSE timeout')),5000);const req=https.get(base+route,{ca,headers:{Accept:'text/event-stream'}},res=>{let text='';res.on('data',chunk=>{text+=chunk.toString();if(text.includes('event: put')){clearTimeout(timer);req.destroy();resolve();}});});req.on('error',reject);});checks.push('実RTDB SSE即時配送');
    const tokenResponse=await request(base+'/__lab/auth/securetoken.googleapis.com/v1/token?key=demo-local-acceptance',{ca,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refreshToken}).toString()});assert.equal(tokenResponse.status,200);assert.equal(JSON.parse(tokenResponse.body).user_id,auth.localId);checks.push('実Auth token更新でUID維持');
  }finally{if(created){const removed=await call(route,'DELETE');assert.equal(removed.status,200);checks.push('自分が作った架空私室だけ削除');}}
  const output={at:new Date().toISOString(),sourceSha:core.SOURCE_SHA,passed:true,checks,productionAccess:false,uiVerified:false,physicalDeviceVerified:false,serviceWorkerVerified:false};
  fs.writeFileSync(path.join(__dirname,'.state/smoke-result.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}
main().catch(error=>{console.error('スモーク試験失敗:',error.code||error.message);process.exitCode=1;});
