import {it,expect} from 'vitest';
import {boundedGitHubFetch,operationContext} from '../../server/operation-budget';

it('bounds queued/uncooperative calls after timeout until their actual completion',async()=>{
 let resolve!:(r:Response)=>void,calls=0;
 const fetch=boundedGitHubFetch(async()=>{calls++;return new Promise<Response>(r=>{resolve=r;});},1024,20,1);
 await expect(fetch('https://fixture.invalid')).rejects.toMatchObject({code:'github_timeout'});
 await expect(fetch('https://fixture.invalid')).rejects.toMatchObject({code:'github_busy'});expect(calls).toBe(1);
 resolve(new Response('{}'));await new Promise(r=>setTimeout(r,5));
 const next=fetch('https://fixture.invalid');resolve(new Response('{}'));expect((await next).status).toBe(200);
});
it('rejects oversized bodies and redirects and does not start writes after an operation expires',async()=>{
 const fetch=boundedGitHubFetch(async(_url,init)=>{expect(init?.redirect).toBe('error');return new Response('x'.repeat(33));},32);
 await expect(fetch('https://fixture.invalid')).rejects.toMatchObject({code:'github_transport_failed'});
 const controller=new AbortController();controller.abort();
 await expect(operationContext.run(controller.signal,()=>fetch('https://fixture.invalid',{method:'POST'}))).rejects.toMatchObject({code:'operation_expired'});
});
