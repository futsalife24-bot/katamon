(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContentStudioMotion = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const CLIPS = Object.freeze(['move-forward', 'move-backward', 'fire', 'hit', 'land']);
  const MIB = 1024 * 1024;
  const PRIORITY = { hit: 4, fire: 3, land: 2, 'move-forward': 1, 'move-backward': 1 };
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const plain = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
  function paths(character, clip) {
    if (!CLIPS.includes(clip)) return null;
    const png = character?.motionSheets?.[clip], json = character?.motionMetadata?.[clip];
    const match = typeof png === 'string' && png.match(/^assets\/content-studio\/[a-z][a-z0-9-]{0,23}\/[a-f0-9]{12}\/(move-forward|move-backward|fire|hit|land)\.png$/);
    if (!match || match[1] !== clip || json !== png.slice(0, -4) + '.json') return null;
    return { png, json, directory: png.slice(0, png.lastIndexOf('/')) };
  }
  function validBounds(b, w, h) {
    return plain(b) && Object.keys(b).length===4 && ['x','y','width','height'].every(k => finite(b[k])) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= w && b.y + b.height <= h;
  }
  function validateMetadata(m, clip, directory) {
    if (!plain(m) || m.schemaVersion !== 1 || m.clipId !== clip || ![128,256,384,512].includes(m.frameWidth) || m.frameHeight !== m.frameWidth || ![8,12].includes(m.frameCount) || !finite(m.fps) || m.fps <= 0 || m.fps > 30 || m.loop !== clip.startsWith('move-') || m.sourceImage !== directory + '/character.png') return false;
    if (!finite(m.anchorX) || !finite(m.anchorY) || m.anchorX < 0 || m.anchorX > 1 || m.anchorY < 0 || m.anchorY > 1 || !validBounds(m.contentBounds,m.frameWidth,m.frameHeight) || !validBounds(m.collisionBounds,m.frameWidth,m.frameHeight)) return false;
    const allowed = ['schemaVersion','frameWidth','frameHeight','frameCount','fps','loop','anchorX','anchorY','contentBounds','collisionBounds','sourceImage','preset','motionAction','actionPreset','clipId','motionParameters','partMasks','partRegions','generatedAt','generatorVersion','rendering'];
    if (Object.keys(m).some(k => !allowed.includes(k)) || !plain(m.motionParameters) || m.motionParameters.frameCount !== m.frameCount || m.motionParameters.fps !== m.fps || m.motionParameters.outputSize !== m.frameWidth) return false;
    const params=m.motionParameters;
    const ranges={durationMs:[250,10000],moveX:[-64,64],moveY:[-256,256],scaleAmount:[0,.25],squashAmount:[0,.25],rotationDegrees:[-180,180],idlePause:[0,.9],groundContact:[0,1],intensity:[0,2],canvasPadding:[0,128]};
    if(Object.entries(ranges).some(([k,[lo,hi]])=>!finite(params[k]) || params[k]<lo || params[k]>hi) || !Number.isInteger(params.durationMs) || !Number.isInteger(params.canvasPadding) || typeof params.flipHorizontal!=='boolean' || params.flipHorizontal || typeof params.lightweightPreview!=='boolean')return false;
    if(!['standard','heavy','light','hover','flying','flexible','winged','mechanical','breathing','almost-still'].includes(m.preset) || m.motionAction!==(clip.startsWith('move-')?'move':clip) || typeof m.generatedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(m.generatedAt) || !Number.isFinite(Date.parse(m.generatedAt)) || typeof m.generatorVersion!=='string' || m.generatorVersion.length>32 || !Array.isArray(m.partMasks) || m.partMasks.length>32)return false;
    const r = m.rendering;
    return plain(r) && Object.keys(r).length === 5 && r.version === 1 && ['left','right'].includes(r.sourceFacing) && validBounds(r.restBounds,m.frameWidth,m.frameHeight) && plain(r.ground) && Object.keys(r.ground).length === 2 && r.ground.x === r.restBounds.x + r.restBounds.width / 2 && r.ground.y === r.restBounds.y + r.restBounds.height && r.contactFrame === (clip === 'land' ? Math.ceil(.48 * (m.frameCount - 1)) : 0);
  }
  function parseMetadata(bytes) {
    if (bytes.byteLength > 65536) throw Error('metadata size');
    const m = JSON.parse(new TextDecoder().decode(bytes));
    const queue = [[m,0]]; let count = 0;
    while (queue.length) {
      const [v,d] = queue.pop();
      if (++count > 2000 || d > 12) throw Error('metadata depth');
      if (typeof v === 'number' && !finite(v)) throw Error('metadata number');
      if (typeof v === 'string' && v.length > 512) throw Error('metadata string');
      if (v && typeof v === 'object') for (const [k,x] of Object.entries(v)) {
        if (['__proto__','prototype','constructor'].includes(k)) throw Error('metadata key');
        queue.push([x,d+1]);
      }
    }
    return m;
  }
  async function readLimited(response, maximum) {
    if (!response.ok || Number(response.headers.get('content-length') || 0) > maximum) throw Error('response');
    const reader = response.body?.getReader();
    if (!reader) throw Error('stream unavailable');
    const chunks = []; let length = 0;
    try { for (;;) { const {done,value} = await reader.read(); if(done) break; length += value.byteLength; if(length > maximum) throw Error('response size'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    return bytes;
  }
  function pngDimensions(bytes) {
    if(bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b) || ![73,72,68,82].every((b,i) => bytes[12+i] === b)) throw Error('PNG header');
    const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(v.getUint32(8) !== 13) throw Error('PNG IHDR');
    return {width:v.getUint32(16),height:v.getUint32(20)};
  }
  class AssetCache {
    constructor(options = {}) {
      this.fetch = options.fetch || ((url,init) => fetch(url,init));
      this.decode = options.decode || (blob => createImageBitmap(blob));
      this.base = options.base || new URL('./', location.href).href;
      this.budget = options.budget ?? 64*MIB; this.timeout = options.timeout ?? 10000;
      this.entries = new Map(); this.used = 0; this.serial = 0; this.epoch = 0; this.active = 0; this.failures = new Set();
    }
    reserve(bytes, current) {
      // Two MiB cover the bounded measurement canvas and its RGBA readback.
      while(this.used + bytes + 2*MIB > this.budget) {
        const oldest = [...this.entries.values()].filter(e => e !== current && e.state === 'ready').sort((a,b) => a.used-b.used)[0];
        if(!oldest) return false;
        this.drop(oldest);
      }
      this.used += bytes; current.bytes = bytes; return true;
    }
    drop(e) { if(e.bitmap) e.bitmap.close(); if(e.bytes) this.used -= e.bytes; e.bytes=0; e.bitmap=null; this.entries.delete(e.key); }
    // Read-only availability: terminal failures must not retain event priority.
    status(character,clip) {
      const p=paths(character,clip);if(!p)return {state:'unavailable'};
      const e=this.entries.get(p.png);
      if(e)return {state:['queued','loading'].includes(e.state)?'pending':e.state,asset:e.state==='ready'?e:null};
      if(this.failures.has(p.png))return {state:'failed'};
      return {state:this.failures.size>=128?'unavailable':'pending'};
    }
    request(character,clip) {
      const p=paths(character,clip); if(!p) return null;
      let e=this.entries.get(p.png);
      if(e) {e.used=++this.serial; return e.state === 'ready' ? e : null;}
      if(this.failures.has(p.png) || this.failures.size >= 128)return null;
      if(this.entries.size >= 32) {
        const old=[...this.entries.values()].filter(x=>!x.controller && x.state!=='loading' && x.state!=='queued').sort((a,b)=>a.used-b.used)[0];
        if(!old) return null; this.drop(old);
      }
      e={...p,key:p.png,clip,state:'queued',bytes:0,used:++this.serial,epoch:this.epoch};this.entries.set(e.key,e);this.pump();return null;
    }
    pump() {
      while(this.active < 2) {
        const e=[...this.entries.values()].find(x=>x.state==='queued');if(!e)break;
        this.active++;e.state='loading';this.load(e).finally(()=>{this.active--;this.pump();});
      }
    }
    async load(e) {
      const controller=new AbortController();e.controller=controller;
      const timer=setTimeout(()=>{
        controller.abort();
        if(this.entries.get(e.key)===e){e.state='failed';this.failures.add(e.key);}
        // A non-cancellable decoder retains its reservation and concurrency slot until settlement.
      },this.timeout);
      const current=()=>e.epoch===this.epoch && this.entries.get(e.key)===e && !controller.signal.aborted;
      try {
        const get=async (path,max,mime)=>{
          const response=await this.fetch(new URL(path,this.base).href,{signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
          if(!response.headers.get('content-type')?.toLowerCase().startsWith(mime))throw Error('MIME');
          return readLimited(response,max);
        };
        const metadata=parseMetadata(await get(e.json,65536,'application/json'));
        if(!current() || !validateMetadata(metadata,e.clip,e.directory))throw Error('metadata');
        const width=metadata.frameWidth*metadata.frameCount,height=metadata.frameHeight;
        if(!this.reserve(width*height*4,e))throw Error('budget');
        const bytes=await get(e.png,6*MIB,'image/png');const size=pngDimensions(bytes);
        if(!current() || size.width!==width || size.height!==height)throw Error('dimensions');
        const bitmap=await this.decode(new Blob([bytes],{type:'image/png'}));
        if(!current() || bitmap.width!==width || bitmap.height!==height) {bitmap.close();throw Error('decoded dimensions');}
        e.bitmap=bitmap;e.metadata=metadata;e.state='ready';
      } catch (_) {
        if(e.bytes){this.used-=e.bytes;e.bytes=0;}
        if(this.entries.get(e.key)===e){e.state='failed';this.failures.add(e.key);}
      } finally {clearTimeout(timer);e.controller=null;}
    }
    reset() {
      this.epoch++;
      for(const e of this.entries.values()) {
        e.controller?.abort();
        if(e.bitmap){e.bitmap.close();e.bitmap=null;this.used-=e.bytes;e.bytes=0;}
        // Pending work remains charged, even after it becomes unreachable from the new scene.
      }
      this.entries.clear();this.failures.clear();
    }
    stats() {return {entries:this.entries.size,rgbaAndReserved:this.used,scratchReserved:2*MIB,budget:this.budget,pending:this.active};}
  }
  function frameAt(metadata,elapsedMs) {
    const first=metadata.clipId==='land'?metadata.rendering.contactFrame:0;
    const elapsed=Math.max(0,Math.floor(elapsedMs*metadata.fps/1000));
    return metadata.loop ? elapsed % metadata.frameCount : (first+elapsed<metadata.frameCount ? first+elapsed : null);
  }
  function placement(metadata,body) {
    const r=metadata.rendering,b=r.restBounds,left=r.sourceFacing==='left';
    const sx=body.width/b.width,sy=body.height/b.height;
    const bodyX=left?-body.x-body.width:body.x;
    return {x:bodyX-b.x*sx,y:body.y-b.y*sy,width:metadata.frameWidth*sx,height:metadata.frameHeight*sy,scaleX:sx,scaleY:sy,sourceLeft:left};
  }
  class Player {
    constructor(options={}) {this.cache=options.cache || new AssetCache(options);this.clock=options.clock || (()=>performance.now());this.states=new Map();this.bounds=new WeakMap();}
    key(u) {return u.id+':'+u.character;}
    state(u) {const key=this.key(u);if(!this.states.has(key)){if(this.states.size>=16)this.states.delete(this.states.keys().next().value);this.states.set(key,{event:null,walk:null});}return this.states.get(key);}
    refreshEvent(state,character,now) {
      const event=state.event;if(!event)return;
      const availability=character && this.cache.status?.(character,event.clip);
      if(availability?.state==='ready')event.duration=(availability.asset.metadata.frameCount-availability.asset.metadata.rendering.contactFrame)/availability.asset.metadata.fps*1000;
      if(['failed','unavailable'].includes(availability?.state) || now-event.start>=event.duration)state.event=null;
    }
    notify(u,clip,character) {
      if(!u || !CLIPS.includes(clip) || clip.startsWith('move-'))return;
      const state=this.state(u),now=this.clock();
      if(character)state.character=character;
      this.refreshEvent(state,state.character,now);
      if(state.character && ['failed','unavailable'].includes(this.cache.status?.(state.character,clip)?.state))return;
      const old=state.event;
      if(old && now-old.start<old.duration && PRIORITY[old.clip]>=PRIORITY[clip])return;
      state.event={clip,start:now,duration:12000};
    }
    beginStep() {for(const state of this.states.values())if(state.walk)state.walk.active=false;}
    walk(u,delta,worldLeft) {
      if(!u?.grounded || !finite(delta) || Math.abs(delta)<.001)return;
      const state=this.state(u),now=this.clock(),clip=(delta<0)===worldLeft?'move-forward':'move-backward';
      if(!state.walk || state.walk.clip!==clip || now-state.walk.last>120)state.walk={clip,start:now,last:now};else state.walk.last=now;
      state.walk.active=true;
    }
    select(u,character) {
      const state=this.states.get(this.key(u));if(!state)return null;
      const now=this.clock();state.character=character;
      this.refreshEvent(state,character,now);
      let motion=state.event;
      if(motion && now-motion.start>=motion.duration){state.event=null;motion=null;}
      if(!motion && state.walk && state.walk.active && u.grounded && now-state.walk.last<=120)motion=state.walk;
      if(!motion)return null;
      const asset=this.cache.request(character,motion.clip);if(!asset)return null;
      if(state.event===motion)motion.duration=(asset.metadata.frameCount-asset.metadata.rendering.contactFrame)/asset.metadata.fps*1000;
      const frame=frameAt(asset.metadata,now-motion.start);
      if(frame===null){if(state.event===motion)state.event=null;return null;}
      return {asset,frame,clip:motion.clip};
    }
    body(image,crop,rect) {
      let cache=this.bounds.get(image);if(!cache){cache=new Map();this.bounds.set(image,cache);}
      const key=[crop.sx,crop.sy,crop.sw,crop.sh].join(',');let b=cache.get(key);
      if(b===false)throw Error('static measurement unavailable');
      if(!b) {
        cache.set(key,false);
        const canvas=document.createElement('canvas');canvas.width=Math.min(512,Math.ceil(crop.sw));canvas.height=Math.min(512,Math.ceil(crop.sh));
        const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('canvas');
        ctx.drawImage(image,crop.sx,crop.sy,crop.sw,crop.sh,0,0,canvas.width,canvas.height);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>4){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
        if(x1<0)throw Error('empty static');b={x:x0/canvas.width,y:y0/canvas.height,width:(x1-x0+1)/canvas.width,height:(y1-y0+1)/canvas.height};cache.set(key,b);canvas.width=canvas.height=1;
      }
      return {x:rect.x+b.x*rect.width,y:rect.y+b.y*rect.height,width:b.width*rect.width,height:b.height*rect.height};
    }
    draw(ctx,u,character,image,crop,rect,worldLeft,staticSourceLeft=false) {
      let saved=false;
      try {
        const selected=this.select(u,character);if(!selected)return false;
        const {asset,frame}=selected,m=asset.metadata,body=this.body(image,crop,rect);
        if(staticSourceLeft)body.x=-body.x-body.width;
        const p=placement(m,body);
        ctx.save();saved=true;if(worldLeft!==p.sourceLeft)ctx.scale(-1,1);
        ctx.drawImage(asset.bitmap,frame*m.frameWidth,0,m.frameWidth,m.frameHeight,p.x,p.y,p.width,p.height);
        return true;
      } catch (_) {return false;} finally {if(saved)ctx.restore();}
    }
    reset() {this.states.clear();this.bounds=new WeakMap();this.cache.reset();}
  }
  return Object.freeze({CLIPS,paths,validateMetadata,parseMetadata,pngDimensions,readLimited,frameAt,placement,AssetCache,Player});
});
