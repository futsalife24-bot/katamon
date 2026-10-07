'use strict';
// 新USB入口の統合試験。2つの架空identityのみ。token/UID/部屋番号を出力・保存しない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
const {request}=require('./lab.cjs'),core=require('./core.cjs'),{USB_PORT}=require('./usb-entry.cjs');
const base='http://localhost:'+USB_PORT,checks=[];
async function call(route,method='GET',body,extra={}){
  return request(base+route,{method,headers:{Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
}
async function main(){
  const status=await call('/__lab/status');assert.equal(status.status,200);assert.equal(JSON.parse(status.body).sourceSha,core.SOURCE_SHA);checks.push('USB入口から固定版status');
  for(const headers of [{Host:'untrusted.invalid:'+USB_PORT},{Origin:'https://untrusted.invalid'},{Origin:'http://127.0.0.1:'+USB_PORT},{'Sec-Fetch-Site':'cross-site'},{Authorization:'Bearer owner'},{'x-lab-stop':'synthetic-only'}])assert.equal((await call('/__lab/status','GET',undefined,headers)).status,403);
  assert.equal((await call('/__lab/stop','POST',{})).status,403);checks.push('Host/厳密Origin/cross-site/Admin/停止要求を拒否');
  assert.equal((await call('/__lab/db/rooms/ABCDEFGH.json?auth=owner')).status,403);
  assert.equal((await call('/__lab/db/rooms/ABCDEFGH.json?ns=production')).status,403);checks.push('管理token/別namespaceを拒否');
  const html=await call('/');assert.equal(html.status,200);assert.ok(html.body.includes("databaseURL: location.origin + '/__lab/db'"));assert.ok(!html.body.includes('https://identitytoolkit.googleapis.com/'));checks.push('USB originを使う固定HTML');
  const signup='/__lab/auth/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-local-acceptance';
  const a=await call(signup,'POST',{returnSecureToken:true}),b=await call(signup,'POST',{returnSecureToken:true});assert.equal(a.status,200);assert.equal(b.status,200);
  const host=JSON.parse(a.body),guest=JSON.parse(b.body);assert.notEqual(host.localId,guest.localId);checks.push('実Authで独立した2identity');
  const now=Date.now(),round=crypto.randomBytes(24).toString('hex'),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code=Array.from(crypto.randomBytes(8),b=>alphabet[b%alphabet.length]).join('');
  const room={protocol:3,hostUid:host.localId,createdAt:{'.sv':'timestamp'},expiresAt:now+600000,visibility:'private',settings:{terrain:'rolling',wind:'calm',turnsPerPlayer:10,format:'1v1',stageSize:'standard',revision:1},slots:{p1:{uid:host.localId,claimedAt:now}},round:{id:round,status:'lobby',players:{p1:host.localId}},rounds:{[round]:{createdAt:now}}};
  const route=(suffix,auth)=>'/__lab/db/rooms/'+code+suffix+'.json?auth='+encodeURIComponent(auth.idToken);
  let created=false;
  try{
    assert.equal((await call(route('',host),'PUT',room)).status,200);created=true;
    assert.ok([401,403].includes((await call(route('',guest))).status));
    assert.equal((await call(route('/slots/e1',guest),'PUT',{uid:guest.localId,claimedAt:now})).status,200);
    const read=await call(route('',guest));assert.equal(read.status,200);assert.equal(JSON.parse(read.body).slots.e1.uid,guest.localId);checks.push('私室は入室前拒否、変更なしRulesで別identity入室後read');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{req.destroy();reject(Error('USB SSE timeout'));},5000);
      const req=http.get(base+route('',guest),{headers:{Origin:base,Accept:'text/event-stream'}},res=>{let received='';res.on('data',chunk=>{received+=chunk.toString();if(received.includes('event: put')&&received.includes(round)){clearTimeout(timer);req.destroy();resolve();}});});
      req.on('error',error=>{clearTimeout(timer);reject(error);});
    });checks.push('別identityの実RTDB SSEをUSB入口がstream配送');
    const refresh=await request(base+'/__lab/auth/securetoken.googleapis.com/v1/token?key=demo-local-acceptance',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:guest.refreshToken}).toString()});
    assert.equal(refresh.status,200);assert.equal(JSON.parse(refresh.body).user_id,guest.localId);checks.push('USB入口でguest token更新・UID維持');
  }finally{if(created){assert.equal((await call(route('',host),'DELETE')).status,200);checks.push('生成した架空私室だけ削除');}}
  const result={at:new Date().toISOString(),sourceSha:core.SOURCE_SHA,passed:true,checks,entry:base,backend:'actual local Auth/RTDB emulators',physicalDevice:false,browserUi:false,usbForwarding:false,productionAccess:false};
  fs.writeFileSync(path.join(__dirname,'usb-verification-20261007.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error('USB入口試験失敗:',error.code||error.message);process.exitCode=1;});
