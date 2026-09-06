import {useEffect,useRef} from 'react';
import {publishedAssetUrl} from '../game/published-content';
import {inspectImageBlob} from '../image/header';
import {acquirePublishedBitmap} from '../generation/published-edit';
let active=0;
/** List thumbnails are optional. Bound the response/header before a browser decoder sees bytes. */
export function PublishedThumbnail({path}:{path:string}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,started=false;
    const load=async()=>{
      if(started||abort.signal.aborted)return;
      if(active>=2){timer=setTimeout(()=>void load(),150);return;}
      started=true;active++;
      try{
        const response=await fetch(publishedAssetUrl(path),{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});
        if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png'||Number(response.headers.get('content-length'))>6*1024*1024)throw new Error('thumbnail unavailable');
        const reader=response.body?.getReader();if(!reader)throw new Error('empty thumbnail');
        const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
        try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>6*1024*1024)throw new Error('large thumbnail');chunks.push(new Uint8Array(next.value));}}finally{await reader.cancel().catch(()=>undefined);}
        const blob=new Blob(chunks,{type:'image/png'}),checked=await inspectImageBlob(blob,'icon.png',{maxWidth:512,maxHeight:512,maxPixels:512*512,maxDecodedBytes:1024*1024});
        if(abort.signal.aborted)return;
        const lease=await acquirePublishedBitmap(blob,checked.header.width,checked.header.height);
        try{if(!abort.signal.aborted)canvas.getContext('2d')?.drawImage(lease.bitmap,0,0,64,64);}finally{lease.release();}
      }catch{if(!abort.signal.aborted)canvas.setAttribute('aria-label','画像を取得できません（再編集時に正本を検証）');}
      finally{active--;}
    };
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();void load();}});observer.observe(canvas);
    return()=>{abort.abort();clearTimeout(timer);observer.disconnect();};
  },[path]);
  return <canvas ref={ref} width={64} height={64} role="img" aria-label="公開キャラクター画像" />;
}
