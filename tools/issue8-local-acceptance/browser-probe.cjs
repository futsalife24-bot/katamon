'use strict';
// 独立headless browserだけを使う。本人profile、OS信頼ストア、LAN、本番へは接続しない。
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),assert=require('node:assert/strict');
const core=require('./core.cjs');
const playwright=require(process.env.KATAMON_PLAYWRIGHT_MODULE || 'C:/Users/futsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const executablePath=process.env.KATAMON_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const cert=fs.readFileSync(path.join(__dirname,'.state/localhost-cert.pem'));
const key=fs.readFileSync(path.join(__dirname,'.state/localhost-key.pem'));
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const close=server=>new Promise(resolve=>{if(!server?.listening)return resolve();server.closeAllConnections();server.close(resolve);});
async function reserve(){const server=http.createServer();const port=await listen(server);await close(server);return port;}

async function main(){
  const source=core.sourceReader(process.env.KATAMON_SOURCE_REPO||core.DEFAULT_REPO);
  const checks=[], pageErrors=[], violations=[], interceptedExternal=[];
  let backend,lab,bridge,browser;
  try{
    // SSEブラウザ適用だけの架空backend。実emulator8項目を繰り返さない。
    backend=http.createServer((req,res)=>{
      if(req.url.startsWith('/rooms/BROWSER1.json?')&&req.headers.accept==='text/event-stream'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders();
        res.write('event: put\ndata: {"path":"/","data":{"fixture":"browser-only"}}\n\n');return;
      }
      res.writeHead(404).end('試験用backendの対象外です');
    });
    const backendPort=await listen(backend),tlsPort=await reserve();
    lab=core.createLab({source,key,cert,ports:{...core.PORTS,web:tlsPort,database:backendPort,auth:backendPort}});
    await new Promise((resolve,reject)=>{lab.server.once('error',reject);lab.server.listen(tlsPort,'127.0.0.1',resolve);});
    let plainOrigin;
    bridge=http.createServer((req,res)=>{
      if(req.headers.host!==new URL(plainOrigin).host){res.writeHead(403).end();return;}
      const headers={...req.headers,host:'localhost:'+tlsPort};
      if(headers.origin===plainOrigin)headers.origin='https://localhost:'+tlsPort;
      const upstream=https.request({hostname:'127.0.0.1',port:tlsPort,servername:'localhost',ca:cert,path:req.url,method:req.method,headers},remote=>{
        res.writeHead(remote.statusCode,remote.headers);res.flushHeaders();remote.pipe(res);
      });
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());req.pipe(upstream);
    });
    const plainPort=await listen(bridge);plainOrigin='http://127.0.0.1:'+plainPort;
    browser=await playwright.chromium.launch({executablePath,headless:true,chromiumSandbox:true});
    async function context(allowedOrigin){
      const c=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'allow',viewport:{width:1100,height:760}});
      await c.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===allowedOrigin)return route.continue();
        interceptedExternal.push({origin:url.origin,type:route.request().resourceType()});return route.abort('blockedbyclient');
      });
      await c.addInitScript(()=>{window.__labViolations=[];document.addEventListener('securitypolicyviolation',event=>{
        let target=event.blockedURI;try{const u=new URL(target);target=u.origin+u.pathname;}catch{}
        window.__labViolations.push({directive:event.effectiveDirective,target});
      });});return c;
    }
    const same=await context(plainOrigin),separate=await context(plainOrigin);
    const page=await same.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(plainOrigin+'/',{waitUntil:'domcontentloaded',timeout:120000});
    const capabilities=await page.evaluate(()=>({secure:isSecureContext,locks:typeof navigator.locks?.request==='function',origin:location.origin,canvas:!!document.querySelector('#game'),swController:!!navigator.serviceWorker?.controller}));
    assert.equal(capabilities.secure,true);assert.equal(capabilities.locks,true);assert.equal(capabilities.canvas,true);assert.equal(capabilities.swController,false);
    checks.push('固定版ゲームHTMLを通常設定のsecure localhostで実行');
    const otherTab=await same.newPage();await otherTab.goto(plainOrigin+'/__lab/status');
    const otherProfile=await separate.newPage();await otherProfile.goto(plainOrigin+'/__lab/status');
    await page.evaluate(()=>localStorage.setItem('katamon_browser_probe','synthetic-only'));
    assert.equal(await otherTab.evaluate(()=>localStorage.getItem('katamon_browser_probe')),'synthetic-only');
    assert.equal(await otherProfile.evaluate(()=>localStorage.getItem('katamon_browser_probe')),null);checks.push('同profileの共有と独立profileのstorage分離');
    await page.evaluate(()=>{window.__held=false;window.__hold=navigator.locks.request('katamon_firebase_reentry:BROWSER1:e1:synthetic-only',{mode:'exclusive'},async()=>{window.__held=true;await new Promise(resolve=>{window.__release=resolve;});});});
    await page.waitForFunction(()=>window.__held===true);
    assert.equal(await otherTab.evaluate(()=>navigator.locks.request('katamon_firebase_reentry:BROWSER1:e1:synthetic-only',{mode:'exclusive',ifAvailable:true},lock=>!!lock)),false);
    assert.equal(await otherProfile.evaluate(()=>navigator.locks.request('katamon_firebase_reentry:BROWSER1:e1:synthetic-only',{mode:'exclusive',ifAvailable:true},lock=>!!lock)),true);
    checks.push('同profileの同席exclusive競合と別profileの独立');
    const cspResults=await page.evaluate(async()=>{
      const results={};
      results.fetch=await fetch('https://katamon-csp-probe.invalid/fetch').then(()=>true,()=>false);
      results.eventSource=await new Promise(resolve=>{const s=new EventSource('https://katamon-csp-probe.invalid/events');const t=setTimeout(()=>{s.close();resolve('timeout');},2000);s.onerror=()=>{clearTimeout(t);s.close();resolve(false);};s.onopen=()=>{clearTimeout(t);s.close();resolve(true);};});
      try{results.webSocket=await new Promise(resolve=>{const s=new WebSocket('wss://katamon-csp-probe.invalid/socket');const t=setTimeout(()=>{s.close();resolve('timeout');},2000);s.onerror=()=>{clearTimeout(t);resolve(false);};s.onopen=()=>{clearTimeout(t);s.close();resolve(true);};});}catch{results.webSocket=false;}
      results.serviceWorker=await navigator.serviceWorker.register('/sw.js').then(()=>true,()=>false);
      results.registrations=(await navigator.serviceWorker.getRegistrations()).length;
      return results;
    });
    assert.deepEqual(cspResults,{fetch:false,eventSource:false,webSocket:false,serviceWorker:false,registrations:0});
    await page.waitForFunction(()=>window.__labViolations.some(v=>v.directive==='worker-src')&&window.__labViolations.filter(v=>v.directive==='connect-src'&&v.target.includes('katamon-csp-probe.invalid')).length>=3);
    violations.push(...await page.evaluate(()=>window.__labViolations));
    checks.push('CSPが外部fetch/EventSource/WebSocketを送信前に拒否');checks.push('CSPがService Worker登録を拒否しcontroller/登録数0');
    const event=await page.evaluate(()=>new Promise((resolve,reject)=>{const s=new EventSource('/__lab/db/rooms/BROWSER1.json?auth=synthetic-only');const timer=setTimeout(()=>{s.close();reject(Error('SSE timeout'));},5000);s.addEventListener('put',e=>{clearTimeout(timer);s.close();resolve(JSON.parse(e.data));});s.onerror=()=>{clearTimeout(timer);s.close();reject(Error('SSE failed'));};}));
    assert.equal(event.data.fixture,'browser-only');checks.push('native EventSourceが既存proxy経由のSSEを受信');
    await page.screenshot({path:path.join(__dirname,'.state/browser-probe.png')});
    await page.close();
    await otherTab.waitForFunction(()=>navigator.locks.request('katamon_firebase_reentry:BROWSER1:e1:synthetic-only',{mode:'exclusive',ifAvailable:true},lock=>!!lock),null,{timeout:5000});checks.push('旧document終了後に同profileの新documentがlease取得');
    const tlsOrigin='https://localhost:'+tlsPort,tlsContext=await context(tlsOrigin),tlsPage=await tlsContext.newPage();
    let untrustedRejected=false;try{await tlsPage.goto(tlsOrigin+'/__lab/status',{timeout:15000});}catch(error){untrustedRejected=/ERR_CERT_AUTHORITY_INVALID/.test(error.message);}
    assert.equal(untrustedRejected,true);checks.push('未信頼自己署名HTTPSはbrowserが拒否（迂回なし）');
    assert.equal(interceptedExternal.length,0,'CSPの外へ抜けた要求を外側guardで止めた場合は合格にしない');
    assert.equal(pageErrors.length,0);
    const result={at:new Date().toISOString(),sourceSha:core.SOURCE_SHA,build:core.BUILD,browser:await browser.version(),passed:true,checks,capabilities,cspResults,cspViolations:violations,interceptedExternalRequests:interceptedExternal.length,pageErrors,scope:{isolatedHeadless:true,existingUserProfileUsed:false,chromiumSandbox:true,ignoreHTTPSErrors:false,certificateBypassFlags:false,osTrustChanged:false,lanBind:false,realEmulatorRepeated:false,backend:'synthetic SSE fixture',browserOrigin:'HTTP loopback secure context',upstreamTls:'Node validates only this certificate via explicit ca',physicalDevice:false,pwa:false,production:false}};
    fs.writeFileSync(path.join(__dirname,'browser-verification-20261007.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{if(browser)await browser.close();await close(bridge);await close(lab?.server);await close(backend);}
}
main().catch(error=>{console.error('browser試験失敗:',error.message);process.exitCode=1;});
