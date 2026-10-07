'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFile } = require('node:child_process');
const core = require('./core.cjs');
const root=__dirname, state=path.join(root,'.state');
const certPath=path.join(state,'localhost-cert.pem'), keyPath=path.join(state,'localhost-key.pem');
const firebasePath=path.join(root,'.runtime/node_modules/firebase-tools/lib/bin/firebase.js');
const sessionPath=path.join(state,'session.json');
function settings() { return { repo:process.env.KATAMON_SOURCE_REPO || core.DEFAULT_REPO, javaHome:process.env.KATAMON_JAVA_HOME || '', firebase:process.env.KATAMON_FIREBASE_CLI || firebasePath }; }
function childEnv(config) {
  const env={ ...process.env, CI:'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true', FIREBASE_EMULATORS_PATH:path.join(root,'.runtime/emulators'), GCLOUD_PROJECT:core.PROJECT, GOOGLE_CLOUD_PROJECT:core.PROJECT };
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GCLOUD_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN']) delete env[name];
  if (config.javaHome) { env.JAVA_HOME=config.javaHome; env.PATH=path.join(config.javaHome,'bin')+path.delimiter+env.PATH; }
  return env;
}
function portFree(port) { return new Promise(resolve=>{ const s=net.createServer(); s.once('error',()=>resolve(false)); s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true))); }); }
function request(url, options={}) { return new Promise((resolve,reject)=>{ const transport=url.startsWith('https:')?https:http; const req=transport.request(url,{...options,timeout:3000},res=>{ const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()})); }); req.on('timeout',()=>req.destroy(new Error('ローカル接続timeout')));req.on('error',reject);req.end(options.body); }); }
async function preflight(config) {
  const checks=[];
  const add=(name,ok,detail)=>checks.push({name,ok,detail});
  try { const source=core.sourceReader(config.repo); core.instrumentIndex(source.read('index.html'));add('固定コード',true,core.SOURCE_SHA); } catch { add('固定コード',false,'対象Git objectが必要です。checkoutの差分は使用しません'); }
  try { const cert=new crypto.X509Certificate(fs.readFileSync(certPath)); const valid=Date.parse(cert.validTo)>Date.now() && cert.checkHost('localhost') && cert.checkIP('127.0.0.1'); const key=crypto.createPrivateKey(fs.readFileSync(keyPath)); if(!cert.checkPrivateKey(key)) throw Error();add('loopback証明書',Boolean(valid),'自己署名ファイルのみ。OS/browserの信頼登録とは別'); } catch { add('loopback証明書',false,'make-local-cert.pyでファイル生成が必要です'); }
  try { const packagePath=path.resolve(config.firebase,'../../../package.json');const version=JSON.parse(fs.readFileSync(packagePath)).version; add('firebase-tools',version==='15.29.0','必要版15.29.0 / 検出'+version); } catch { add('firebase-tools',false,'固定版15.29.0のCLIパスが必要です'); }
  try { const java=config.javaHome?path.join(config.javaHome,'bin/java.exe'):'java';const result=spawnSync(java,['-version'],{env:childEnv(config),encoding:'utf8',windowsHide:true});const major=Number((String(result.stderr)+String(result.stdout)).match(/version\s+"(\d+)/)?.[1]);if(result.error||result.status!==0||!major)throw Error();add('Java',major>=21,'必要21以上 / 検出'+major); } catch(error) {
    // java -version writes to stderr while returning success; absence/failure is distinct.
    add('Java',false,'Java21以上が必要です。KATAMON_JAVA_HOMEは子processにだけ使用します');
  }
  for(const [name,port] of Object.entries(core.PORTS)) add('port '+name,await portFree(port),'127.0.0.1:'+port);
  return {sourceSha:core.SOURCE_SHA,build:core.BUILD,checks,ready:checks.every(c=>c.ok),lanEnabled:false,serviceWorkers:'blocked',physicalDeviceVerified:false};
}
function canonical(value) { if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value; }
async function verifyEmulators(source) {
  const response=await request(`http://127.0.0.1:${core.PORTS.database}/.settings/rules.json?ns=${core.PROJECT}-default-rtdb`,{headers:{Authorization:'Bearer owner'}});
  if(response.status!==200)throw Error('emulator Rules読取失敗');
  if(JSON.stringify(canonical(JSON.parse(response.body)))!==JSON.stringify(canonical(JSON.parse(source.read('database.rules.json')))))throw Error('固定Rulesと実emulator Rulesが不一致');
  const hub=await request(`http://127.0.0.1:${core.PORTS.hub}/emulators`);
  if(hub.status!==200)throw Error('emulator hub読取失敗');
  const services=JSON.parse(hub.body);
  for(const name of ['auth','database'])if(!services[name]||services[name].host!=='127.0.0.1'||services[name].port!==core.PORTS[name])throw Error('emulatorのbind/port不一致');
  return true;
}
async function start(config) {
  const check=await preflight(config); console.log(JSON.stringify(check,null,2));
  if(!check.ready) { process.exitCode=2;return; }
  if(fs.existsSync(sessionPath)) throw Error('既存session.jsonがあります。status/stopで前の起動を確認してください');
  const source=core.sourceReader(config.repo);fs.mkdirSync(state,{recursive:true});
  fs.writeFileSync(path.join(state,'database.rules.json'),source.read('database.rules.json'));
  const emulatorConfig={database:{rules:'database.rules.json'},emulators:{database:{host:'127.0.0.1',port:core.PORTS.database},auth:{host:'127.0.0.1',port:core.PORTS.auth},hub:{host:'127.0.0.1',port:core.PORTS.hub},logging:{host:'127.0.0.1',port:core.PORTS.logging},ui:{enabled:false},singleProjectMode:true}};
  fs.writeFileSync(path.join(state,'firebase.json'),JSON.stringify(emulatorConfig,null,2));
  const log=fs.createWriteStream(path.join(state,'emulator.log'),{flags:'a'});
  const child=spawn(process.execPath,[config.firebase,'emulators:start','--only','auth,database','--project',core.PROJECT,'--config',path.join(state,'firebase.json'),'--non-interactive'],{cwd:state,env:childEnv(config),windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log); child.stderr.pipe(log);
  let server, stopping=false, childFailure=null;
  child.on('error',error=>{childFailure=error;});
  child.on('exit',code=>{if(!stopping)childFailure=Error('emulator終了: '+code);});
  async function shutdown() {
    if(stopping)return;stopping=true;
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    if(child.exitCode===null&&child.pid){
      if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
      else child.kill('SIGTERM');
    }
    log.end();if(fs.existsSync(sessionPath))fs.unlinkSync(sessionPath);
    console.log('このキットが起動したprocessを停止しました');
  }
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  try {
    const deadline=Date.now()+120000;
    let ready=false;
    while(Date.now()<deadline&&!stopping){if(childFailure)throw childFailure;try{await verifyEmulators(source);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,1000));}
    if(!ready)throw Error('emulator準備が完了しませんでした。秘密を除いた .state/emulator.log を確認してください');
    const token=crypto.randomBytes(32).toString('hex');
    const lab=core.createLab({source,key:fs.readFileSync(keyPath),cert:fs.readFileSync(certPath),shutdownToken:token,onStop:shutdown});server=lab.server;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(core.PORTS.web,'127.0.0.1',resolve);});
    fs.writeFileSync(sessionPath,JSON.stringify({port:core.PORTS.web,token,pid:process.pid,sourceSha:core.SOURCE_SHA,startedAt:new Date().toISOString()}));
    console.log('起動: https://localhost:'+core.PORTS.web+'/（loopback専用、証明書は未信頼）');
    console.log('固定Rules読戻し一致 / 本番通信遮断 / SW無効 / 実機未確認');
    child.once('exit',()=>{if(!stopping)void shutdown();});
  } catch(error) { await shutdown();throw error; }
}
async function stop() {
  if(!fs.existsSync(sessionPath)){console.log('このキットの起動記録はありません');return;}
  const session=JSON.parse(fs.readFileSync(sessionPath));
  if(session.sourceSha!==core.SOURCE_SHA||session.port!==core.PORTS.web)throw Error('起動記録が一致しません。別processは停止しません');
  const response=await request('https://localhost:'+session.port+'/__lab/stop',{method:'POST',ca:fs.readFileSync(certPath),headers:{'x-lab-stop':session.token}});
  if(response.status!==200)throw Error('停止要求を拒否されました');console.log('起動processへ停止要求を送りました。session.jsonの解消とport閉鎖を確認してください');
}
async function main() {
  const command=process.argv[2]||'preflight';
  if(process.argv.length>3)throw Error('追加引数は非対応です。LAN bind指定はできません');
  if(command==='preflight'){const result=await preflight(settings());console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=2;}
  else if(command==='start')await start(settings());
  else if(command==='stop')await stop();
  else throw Error('preflight / start / stop のいずれかを指定してください');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={preflight,verifyEmulators,request,childEnv,canonical};
