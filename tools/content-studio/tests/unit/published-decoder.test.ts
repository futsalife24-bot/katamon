import {afterEach,it,expect,vi} from 'vitest';
import {acquirePublishedBitmap,decodePublishedResponse} from '../../src/generation/published-edit';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const blob=new Blob(['fixture'],{type:'image/png'});
it('bad or over-budget dimensions are rejected before starting a decoder',async()=>{
  const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
  for(const size of [[NaN,1],[-1,1],[1.5,1],[9000,1],[8192,8192]])await expect(acquirePublishedBitmap(blob,size[0],size[1])).rejects.toThrow();expect(decode).not.toHaveBeenCalled();
});
it('two pending decodes reserve bytes and slots; late timeout results release exactly once',async()=>{
  vi.useFakeTimers();const resolves:Array<(value:any)=>void>=[];const decode=vi.fn(()=>new Promise(resolve=>resolves.push(resolve)));vi.stubGlobal('createImageBitmap',decode);
  const a=acquirePublishedBitmap(blob,4096,2048),b=acquirePublishedBitmap(blob,4096,2048);
  const rejectedA=expect(a).rejects.toThrow('時間切れ'),rejectedB=expect(b).rejects.toThrow('時間切れ');await Promise.resolve();
  await expect(acquirePublishedBitmap(blob,1,1)).rejects.toThrow('容量');expect(decode).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10001);await rejectedA;await rejectedB;
  await expect(acquirePublishedBitmap(blob,1,1)).rejects.toThrow('容量');
  const closeA=vi.fn(),closeB=vi.fn();resolves[0]({width:4096,height:2048,close:closeA});resolves[1]({width:4096,height:2048,close:closeB});await vi.advanceTimersByTimeAsync(0);expect(closeA).toHaveBeenCalledOnce();expect(closeB).toHaveBeenCalledOnce();
  const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:1,height:1,close}));const lease=await acquirePublishedBitmap(blob,1,1);lease.release();lease.release();expect(close).toHaveBeenCalledOnce();
});
it('decode failure and decoded-dimension mismatch do not leak reservations',async()=>{
  vi.stubGlobal('createImageBitmap',vi.fn().mockRejectedValue(new Error('fixture decode error')));await expect(acquirePublishedBitmap(blob,1,1)).rejects.toThrow('fixture');
  const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:2,height:2,close}));await expect(acquirePublishedBitmap(blob,1,1)).rejects.toThrow('寸法');expect(close).toHaveBeenCalledOnce();
  vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:1,height:1,close:vi.fn()}));const lease=await acquirePublishedBitmap(blob,1,1);lease.release();
});

it('a false tiny byte count cannot bypass the transfer budget before Base64 decoding',async()=>{
  const decode=vi.fn();vi.stubGlobal('atob',decode);
  await expect(decodePublishedResponse({files:[{path:'a.png',mimeType:'image/png',byteLength:1,sha256:'0'.repeat(64),contentBase64:'AAAA'.repeat(100)}]})).rejects.toThrow('転送形式');expect(decode).not.toHaveBeenCalled();
});
