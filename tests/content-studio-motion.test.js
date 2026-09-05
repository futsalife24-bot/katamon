const test = require('node:test');
const assert = require('node:assert/strict');
const {AssetCache,Player,paths,frameAt,placement,parseMetadata,pngDimensions,readLimited}=require('../shared/content-studio-motion');
const dir='assets/content-studio/sample-unit/aaaaaaaaaaaa';
const character={motionSheets:{},motionMetadata:{}};
for(const clip of ['move-forward','move-backward','fire','hit','land']){character.motionSheets[clip]=`${dir}/${clip}.png`;character.motionMetadata[clip]=`${dir}/${clip}.json`;}
// Loader fixtures isolate corrupt/network boundaries. Real generated data is tested separately in Studio and browser integration.
function metadata(clip='fire',size=128){return {schemaVersion:1,frameWidth:size,frameHeight:size,frameCount:8,fps:12,loop:clip.startsWith('move-'),clipId:clip,anchorX:.5,anchorY:.9,contentBounds:{x:10,y:10,width:80,height:100},collisionBounds:{x:10,y:10,width:80,height:100},sourceImage:dir+'/character.png',preset:'standard',motionAction:clip.startsWith('move-')?'move':clip,generatedAt:'2026-09-05T00:00:00.000Z',generatorVersion:'0.5.0',partMasks:[],motionParameters:{frameCount:8,fps:12,outputSize:size,durationMs:667,moveX:0,moveY:0,scaleAmount:0,squashAmount:0,rotationDegrees:0,idlePause:0,groundContact:.9,intensity:1,canvasPadding:32,flipHorizontal:false,lightweightPreview:true},rendering:{version:1,sourceFacing:'right',restBounds:{x:10,y:10,width:80,height:100},ground:{x:50,y:110},contactFrame:clip==='land'?4:0}};}
function png(w=1024,h=128){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);b.set([73,72,68,82],12);const v=new DataView(b.buffer);v.setUint32(8,13);v.setUint32(16,w);v.setUint32(20,h);return b;}
const tick=()=>new Promise(r=>setTimeout(r,5));
async function settled(cache){for(let i=0;i<200&&cache.active;i++)await tick();assert.equal(cache.active,0);}
function setup(options={}){let calls=0,decoded=0,closed=0;const cache=new AssetCache({base:'https://example.test/game/',fetch:async(url)=>{calls++;const clip=url.split('/').pop().split('.')[0];return new Response(url.endsWith('.json')?JSON.stringify(metadata(clip)):png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}});},decode:async()=>{decoded++;return{width:1024,height:128,close(){closed++;}};},...options});return{cache,counts:()=>({calls,decoded,closed})};}
test('deduplicates only requested clips; reset closes bitmap',async()=>{const {cache,counts}=setup();for(let i=0;i<100;i++)cache.request(character,'fire');await settled(cache);assert.deepEqual(counts(),{calls:2,decoded:1,closed:0});assert.equal(cache.entries.size,1);cache.reset();assert.equal(counts().closed,1);assert.equal(cache.used,0);});
for(const failure of ['404','mime','json','dimensions','decode'])test(`finite negative cache: ${failure}`,async()=>{let calls=0,decodes=0;const {cache}=setup({fetch:async(url)=>{calls++;if(failure==='404')return new Response('',{status:404});return new Response(url.endsWith('.json')?(failure==='json'?'null':JSON.stringify(metadata())):png(failure==='dimensions'?999999:1024),{headers:{'content-type':failure==='mime'?'text/html':url.endsWith('.json')?'application/json':'image/png'}});},decode:async()=>{decodes++;throw Error('decode');}});cache.request(character,'fire');await settled(cache);const n=calls;for(let i=0;i<100;i++)cache.request(character,'fire');assert.equal(calls,n);assert.equal(cache.used,0);assert.equal(decodes,failure==='decode'?1:0);});
test('pending reservation survives reset; late decode closes without applying',async()=>{let resolve;const {cache}=setup({decode:()=>new Promise(r=>resolve=r)});cache.request(character,'fire');for(let i=0;i<100&&!resolve;i++)await tick();const bytes=cache.used;assert.ok(bytes>0);cache.reset();assert.equal(cache.used,bytes);let closed=0;resolve({width:1024,height:128,close(){closed++;}});await settled(cache);assert.equal(cache.used,0);assert.equal(cache.entries.size,0);assert.equal(closed,1);});
test('decoder timeout keeps reservation and cannot start unlimited decoders',async()=>{let resolves=[];const {cache}=setup({timeout:20,decode:()=>new Promise(r=>resolves.push(r))});cache.request(character,'fire');cache.request(character,'hit');await new Promise(r=>setTimeout(r,50));assert.equal(cache.active,2);assert.ok(cache.used>0);for(let i=0;i<10;i++){cache.reset();cache.request(character,'land');}assert.equal(resolves.length,2);cache.reset();for(const resolve of resolves)resolve({width:1024,height:128,close(){}});await settled(cache);});
test('budget includes reservations and scratch, evicts LRU',async()=>{const {cache,counts}=setup({budget:3*1024*1024});cache.request(character,'fire');await settled(cache);cache.request(character,'hit');await settled(cache);cache.request(character,'land');await settled(cache);assert.ok(cache.used+2*1024*1024<=cache.budget);assert.equal(cache.entries.size,2);assert.equal(counts().closed,1);});
test('budget failure before PNG fetch/decode',async()=>{const {cache,counts}=setup({budget:1024*1024});cache.request(character,'fire');await settled(cache);assert.equal(counts().calls,1);assert.equal(counts().decoded,0);});
for(const path of ['https://evil.test/x','../secret','assets/content-studio/a/../fire.png','assets/content-studio/a/aaaaaaaaaaaa/fire.png?token=DUMMY','assets/content-studio/a/aaaaaaaaaaaa/hit.png'])test('rejects path '+path,()=>assert.equal(paths({motionSheets:{fire:path},motionMetadata:{fire:path.replace('.png','.json')}},'fire'),null));
test('bounded JSON and streamed response',async()=>{for(const text of ['{"constructor":{}}','['.repeat(15)+'0'+']'.repeat(15),'"'+'a'.repeat(65536)+'"'])assert.throws(()=>parseMetadata(new TextEncoder().encode(text)));await assert.rejects(readLimited(new Response(new Uint8Array(100)),99));assert.throws(()=>pngDimensions(new Uint8Array(99)));});
test('30/60/120 Hz have identical frame and completion time',()=>{const m=metadata();for(const hz of [30,60,120]){let last;for(let i=0;i<=hz;i++)last=frameAt(m,i/hz*1000);assert.equal(last,null);assert.equal(frameAt(m,500),6);}assert.equal(frameAt(metadata('land'),0),4);});
test('priority, actual walk, expiry, repeated hit and scene reset',()=>{let now=0;const p=new Player({clock:()=>now,cache:{request:(_c,clip)=>({metadata:metadata(clip)}),reset(){}}});const u={id:'p1',character:'test',grounded:true};p.walk(u,2,false);assert.equal(p.select(u,character).clip,'move-forward');p.beginStep();assert.equal(p.select(u,character),null);p.walk(u,-2,false);assert.equal(p.select(u,character).clip,'move-backward');p.notify(u,'land');p.notify(u,'fire');p.notify(u,'hit');assert.equal(p.select(u,character).clip,'hit');now=300;p.notify(u,'hit');assert.equal(p.select(u,character).frame,3);now=900;assert.equal(p.select(u,character),null);p.reset();assert.equal(p.states.size,0);});
test('late load never restarts a completed event',()=>{let now=0,ready=false;const p=new Player({clock:()=>now,cache:{request:()=>ready?{metadata:metadata()}:null,reset(){}}});const u={id:'p1',character:'test'};p.notify(u,'fire');assert.equal(p.select(u,character),null);now=2000;ready=true;assert.equal(p.select(u,character),null);});
test('source direction changes flip once, not target body dimensions',()=>{for(const sourceFacing of ['left','right']){const m=metadata();m.rendering.sourceFacing=sourceFacing;const p=placement(m,{x:-20,y:-90,width:50,height:70});assert.equal(p.scaleX*80,50);assert.equal(p.y+110*p.scaleY,-20);assert.equal(p.sourceLeft,sourceFacing==='left');}});

// M1: exercise the real cache + Player; only transport/decoder/clock are fixtures.
for(const failure of ['404','metadata','unsupported','decode','timeout','path'])test(`M1 ${failure}: failed hit releases walking and subsequent fire/land without reset`,async()=>{
 const c=structuredClone(character);let now=0,hitRequests=0,pngClip,late;
 if(failure==='path')c.motionSheets.hit='../hit.png';
 const {cache}=setup({timeout:30,fetch:async(url)=>{
  const clip=url.split('/').pop().split('.')[0];if(clip==='hit')hitRequests++;
  if(clip==='hit'&&url.endsWith('.png')&&failure==='404')return new Response('',{status:404});
  if(url.endsWith('.json')){const m=metadata(clip);if(clip==='hit'&&failure==='metadata')m.fps=-1;if(clip==='hit'&&failure==='unsupported')delete m.rendering;return new Response(JSON.stringify(m),{headers:{'content-type':'application/json'}});}
  pngClip=clip;return new Response(png(),{headers:{'content-type':'image/png'}});
 },decode:async()=>{if(pngClip==='hit'&&failure==='decode')throw Error('decode fixture');if(pngClip==='hit'&&failure==='timeout')return new Promise(r=>late=r);return{width:1024,height:128,close(){}};}});
 for(const clip of ['move-forward','move-backward','fire','land']){cache.request(c,clip);await settled(cache);}
 const p=new Player({cache,clock:()=>now}),u={id:'p1',character:'sample',grounded:true};
 p.notify(u,'hit',c);p.select(u,c);
 if(failure==='timeout')await new Promise(r=>setTimeout(r,60));else await settled(cache);
 now=100;p.walk(u,1,false);assert.equal(p.select(u,c)?.clip,'move-forward');
 p.beginStep();p.walk(u,-1,false);assert.equal(p.select(u,c)?.clip,'move-backward');
 // A known failed hit notified again must not swallow a fire notification before select.
 p.notify(u,'hit',c);p.notify(u,'fire',c);assert.equal(p.select(u,c)?.clip,'fire');
 now=900;p.notify(u,'hit',c);p.notify(u,'land',c);assert.equal(p.select(u,c)?.clip,'land');
 const count=hitRequests;for(let i=0;i<100;i++){p.notify(u,'hit',c);p.select(u,c);}assert.equal(hitRequests,count);
 assert.ok(now<12000);assert.equal(p.states.size,1);
 if(late){assert.ok(cache.active>0);assert.ok(cache.used>0);late({width:1024,height:128,close(){}});await settled(cache);}
 cache.reset();
});

test('M1 notification before select after terminal failure does not suppress a new event',async()=>{
 let now=0;const {cache}=setup({fetch:async(url)=>{if(url.includes('/hit.'))return new Response('',{status:404});return new Response(url.endsWith('.json')?JSON.stringify(metadata('fire')):png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}});}});cache.request(character,'fire');await settled(cache);
 const p=new Player({cache,clock:()=>now}),u={id:'p1',character:'sample',grounded:true};p.notify(u,'hit',character);p.select(u,character);await settled(cache);
 now=100;p.notify(u,'fire',character);assert.equal(p.states.get(p.key(u)).event?.clip,'fire');assert.equal(p.select(u,character)?.clip,'fire');cache.reset();
});

test('M1 real pending/ready hit keeps priority, original start and finite completion',async()=>{
 let now=0,release;const {cache}=setup({fetch:async(url)=>{const clip=url.split('/').pop().split('.')[0];if(clip==='hit'&&url.endsWith('.json'))await new Promise(r=>release=r);return new Response(url.endsWith('.json')?JSON.stringify(metadata(clip)):png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}});}});
 const p=new Player({cache,clock:()=>now}),u={id:'p1',character:'sample',grounded:true};
 p.notify(u,'hit',character);p.select(u,character);now=200;p.notify(u,'fire',character);p.notify(u,'hit',character);assert.equal(p.states.get(p.key(u)).event.start,0);
 release();await settled(cache);assert.equal(p.select(u,character)?.frame,2);now=500;p.notify(u,'hit',character);assert.equal(p.states.get(p.key(u)).event.start,0);
 now=700;assert.equal(p.select(u,character),null);cache.reset();
});

test('M1 cache availability is read-only and preserves ready assets at failure limit',async()=>{
 const {cache,counts}=setup();assert.equal(cache.status(character,'hit').state,'pending');assert.equal(counts().calls,0);
 cache.request(character,'fire');assert.equal(cache.status(character,'fire').state,'pending');await settled(cache);assert.equal(cache.status(character,'fire').state,'ready');
 for(let i=0;i<128;i++)cache.failures.add('failed-'+i);
 assert.equal(cache.status(character,'land').state,'unavailable');assert.ok(cache.request(character,'fire'));assert.equal(cache.status(character,'fire').state,'ready');cache.reset();
});

test('M1 real late completed hit is discarded before new fire notification',async()=>{
 let now=0,release;const {cache}=setup({fetch:async(url)=>{const clip=url.split('/').pop().split('.')[0];if(clip==='hit'&&url.endsWith('.json'))await new Promise(r=>release=r);return new Response(url.endsWith('.json')?JSON.stringify(metadata(clip)):png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}});}});
 cache.request(character,'fire');await settled(cache);const p=new Player({cache,clock:()=>now}),u={id:'p1',character:'sample',grounded:true};
 p.notify(u,'hit',character);p.select(u,character);now=1000;release();await settled(cache);
 // No select of the completed hit between decoder completion and the fire notification.
 p.notify(u,'fire',character);assert.equal(p.select(u,character)?.clip,'fire');assert.equal(p.select(u,character)?.frame,0);cache.reset();
});

test('M1 transport timeout releases priority without releasing another asset',async()=>{
 let now=0,calls=0;const {cache}=setup({timeout:30,fetch:async(url,{signal})=>{const clip=url.split('/').pop().split('.')[0];if(clip==='hit'){calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}return new Response(url.endsWith('.json')?JSON.stringify(metadata(clip)):png(),{headers:{'content-type':url.endsWith('.json')?'application/json':'image/png'}});}});
 cache.request(character,'land');await settled(cache);const p=new Player({cache,clock:()=>now}),u={id:'p1',character:'sample',grounded:true};p.notify(u,'hit',character);p.select(u,character);await settled(cache);assert.equal(cache.status(character,'hit').state,'failed');now=100;p.notify(u,'land',character);assert.equal(p.select(u,character)?.clip,'land');for(let i=0;i<100;i++)p.select(u,character);assert.equal(calls,1);cache.reset();
});
