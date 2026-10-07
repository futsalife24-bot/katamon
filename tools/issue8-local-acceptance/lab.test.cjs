'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),vm=require('node:vm');
const core=require('./core.cjs');
const {request}=require('./lab.cjs');
const source=core.sourceReader(process.env.KATAMON_SOURCE_REPO||core.DEFAULT_REPO);
const cert=fs.readFileSync(path.join(__dirname,'.state/localhost-cert.pem'));
const key=fs.readFileSync(path.join(__dirname,'.state/localhost-key.pem'));
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));
const close=server=>new Promise(r=>{server.closeAllConnections();server.close(r);});

test('固定Git objectを使い、Auth/DBだけを同originへ置換し、生成inline scriptが構文成立',()=>{
  const original=source.read('index.html'), rewritten=core.instrumentIndex(original).toString();
  assert.ok(rewritten.includes("databaseURL: location.origin + '/__lab/db'"));
  assert.ok(rewritten.includes("location.origin + '/__lab/auth/identitytoolkit.googleapis.com/v1/accounts:signUp'"));
  assert.ok(rewritten.includes("location.origin + '/__lab/auth/securetoken.googleapis.com/v1/token'"));
  assert.ok(rewritten.includes("apiKey: 'demo-local-acceptance'"));
  assert.ok(!rewritten.includes('https://identitytoolkit.googleapis.com/'));
  assert.ok(!rewritten.includes('https://securetoken.googleapis.com/'));
  const scripts=[...rewritten.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
  assert.ok(scripts.length>0);for(const script of scripts)new vm.Script(script);
  assert.notEqual(core.hash(original),core.hash(rewritten));
});

test('ソースdriftは起動前に拒否',()=>{
  assert.throws(()=>core.instrumentIndex(Buffer.from(source.read('index.html').toString().replace(core.BUILD,'wrong-build'))));
  assert.throws(()=>core.instrumentIndex(Buffer.from(source.read('index.html').toString().replace('</body>',''))));
});

test('固定版HTMLの63件のローカルscript/link参照を配信できる',()=>{
  const html=core.instrumentIndex(source.read('index.html')).toString();
  const refs=[...html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/g)].map(m=>new URL(m[1],'https://localhost/')).filter(u=>u.origin==='https://localhost');
  assert.equal(refs.length,63);
  for(const url of refs){const file=url.pathname.slice(1);assert.ok(core.publicFile(file),file);assert.ok(source.files.has(file),file);}
});

test('公開ファイルとproxy対象を限定し、Rules/秘密/管理API/別namespaceを拒否',()=>{
  for(const name of ['.git/config','database.rules.json','package.json','tools/registration/service-account.json','../index.html','sw.js'])assert.equal(core.publicFile(name),false,name);
  for(const name of ['index.html','shared/firebase-online-reentry.js','assets/font.woff2'])assert.equal(core.publicFile(name),true,name);
  for(const route of ['/__lab/db/.settings/rules.json','/__lab/db/rooms.json?ns=production','/__lab/db/rooms.json?auth=owner','/__lab/auth/identitytoolkit.googleapis.com/v1/projects/real/accounts','/__lab/db/rooms.json?download=anything'])assert.equal(core.proxyRoute(new URL(route,'https://localhost')),null,route);
});

test('TLS proxyは同origin・loopbackのみ、SSE即時配送、条件付きPUT/ETag保持、外部redirect拒否、停止認証',async()=>{
  const seen=[];let stopCalls=0;
  const backend=http.createServer((req,res)=>{
    seen.push({method:req.method,url:req.url,headers:req.headers});
    if(req.url.includes('stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();res.write('event: put\ndata: {"path":"/","data":null}\n\n');return;}
    if(req.url.includes('redirect')){res.writeHead(302,{Location:'https://example.com'}).end();return;}
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.setHeader('ETag','"local-test"');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({body:Buffer.concat(chunks).toString()}));});
  });
  await listen(backend);
  const reservation=http.createServer();await listen(reservation);const webPort=reservation.address().port;await close(reservation);
  const lab=core.createLab({source,key,cert,ports:{...core.PORTS,web:webPort,database:backend.address().port,auth:backend.address().port},shutdownToken:'test-only',onStop:()=>stopCalls++});
  await new Promise(r=>lab.server.listen(webPort,'127.0.0.1',r));
  const base='https://localhost:'+webPort;
  try{
    const status=await request(base+'/__lab/status',{ca:cert});assert.equal(status.status,200);assert.equal(JSON.parse(status.body).sourceSha,core.SOURCE_SHA);
    const index=await new Promise((resolve,reject)=>https.get(base+'/',{ca:cert},res=>{assert.equal(res.headers['content-security-policy'],core.CSP);res.resume();res.on('end',resolve);}).on('error',reject));
    const response=await request(base+'/__lab/db/rooms/fixture.json?auth=fake-local-token',{ca:cert,method:'PUT',headers:{'Content-Type':'application/json','if-match':'null_etag'},body:'{"fixture":true}'});
    assert.equal(response.status,200);assert.equal(seen.at(-1).headers['if-match'],'null_etag');assert.ok(seen.at(-1).url.includes('ns='+core.PROJECT+'-default-rtdb'));
    assert.equal(JSON.parse(response.body).body,'{"fixture":true}');
    const count=seen.length;
    for(const [route,headers] of [['/__lab/db/rooms.json',{Origin:'https://external.invalid'}],['/__lab/db/rooms.json',{Host:'external.invalid'}],['/__lab/db/rooms.json',{Authorization:'Bearer owner'}],['/__lab/db/rooms.json?ns=real',{}],['/__lab/db/rooms.json?auth=owner',{}],['/database.rules.json',{}],['/sw.js',{}],['/.git/config',{}]]){
      const denied=await request(base+route,{ca:cert,servername:'localhost',headers});assert.ok([403,404,410].includes(denied.status),route);
    }assert.equal(seen.length,count,'拒否された要求はbackendへ転送しない');
    assert.equal((await request(base+'/__lab/db/rooms/redirect.json',{ca:cert})).status,502);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SSEがbufferされています')),2000);const req=https.get(base+'/__lab/db/rooms/stream.json',{ca:cert,headers:{Accept:'text/event-stream'}},res=>{res.once('data',chunk=>{assert.match(chunk.toString(),/event: put/);clearTimeout(timer);req.destroy();resolve();});});req.on('error',reject);});
    assert.equal((await request(base+'/__lab/stop',{ca:cert,method:'POST'})).status,403);assert.equal(stopCalls,0);
    assert.equal((await request(base+'/__lab/stop',{ca:cert,method:'POST',headers:{'x-lab-stop':'test-only'}})).status,200);
    await new Promise(r=>setImmediate(r));assert.equal(stopCalls,1);
  }finally{await close(lab.server);await close(backend);}
});
