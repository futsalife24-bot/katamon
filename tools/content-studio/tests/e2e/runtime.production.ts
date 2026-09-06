import {test,expect,chromium,type Page,type BrowserContext,type TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {productionFixture} from './production-fixture';
import {attachSyntheticCharacter} from './image-upload';
import {productionStartSmoke} from './production-start-smoke';
import {attachDenseCharacter} from './dense-image-upload';
async function preserveContextTrace(context:BrowserContext,info:TestInfo,name:string){
 const path=info.outputPath(name+'.zip');
 // Save the automatically started context trace before closing the explicitly launched browser.
 await context.tracing.stop({path});
 await info.attach(name,{path,contentType:'application/zip'});
}
async function browserRequest(page:Page,url:string,init:RequestInit={}){
 init.headers={...init.headers,'x-content-studio-version':'0.7.0'};
 const result=await page.evaluate(async({url,init})=>{if(new URL(url).origin!==location.origin)throw new Error('Fixture request must remain same origin');const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store'});return {status:response.status,body:await response.json()};},{url,init});
 return {status:()=>result.status,json:async()=>result.body};
}

async function storageState(page:Page){return page.evaluate(async()=>new Promise<{drafts:string[];outbox:string[]}>((resolve,reject)=>{
 const open=indexedDB.open('content-studio-v1');open.onupgradeneeded=()=>{open.transaction?.abort();reject(new Error('Expected existing Studio DB'));};open.onerror=()=>reject(open.error);
 open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','outbox']),drafts=tx.objectStore('drafts').getAll(),outbox=tx.objectStore('outbox').getAll();tx.oncomplete=()=>{resolve({drafts:drafts.result.map((d:any)=>d.id),outbox:outbox.result.map((o:any)=>o.id)});db.close();};tx.onerror=()=>reject(tx.error);};
}));}
async function storageFingerprint(page:Page){
 return page.evaluate(async()=>{
  const rows=await new Promise<Record<string,unknown>>((resolve,reject)=>{
   const open=indexedDB.open('content-studio-v1');open.onerror=()=>reject(open.error);
   open.onsuccess=()=>{const db=open.result,names=Array.from(db.objectStoreNames),tx=db.transaction(names),requests=names.map(name=>tx.objectStore(name).getAll());
    tx.oncomplete=()=>{resolve(Object.fromEntries(names.map((name,index)=>[name,requests[index].result])));db.close();};tx.onerror=()=>reject(tx.error);};
  });
  const hash=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const normalize=async(value:any):Promise<any>=>{
   if(value instanceof Blob)return {blobHash:await hash(await value.arrayBuffer()),bytes:value.size,type:value.type};
   if(Array.isArray(value))return Promise.all(value.map(normalize));
   if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async key=>[key,await normalize(value[key])])));
   return value;
  };
  return hash(new TextEncoder().encode(JSON.stringify(await normalize(rows))).buffer);
 });
}

async function authenticate(page:Page,origin:string){
 await page.goto(origin+'/api/auth/login');await page.waitForURL(origin+'/tools/content-studio/');
 await expect(page.getByTestId('dashboard')).toBeVisible();
 const session=await browserRequest(page,origin+'/api/auth/session');expect((await session.json()).authenticated).toBe(true);
}
test('built production preflight, strict static routing, OAuth/PKCE, cookies, SW and no mock fallback',async({},info)=>{
 const f=await productionFixture();const origin=f.instances[0].origin;
 const browser=await chromium.launch({args:[`--ignore-certificate-errors-spki-list=${f.spki}`]}),context=await browser.newContext({viewport:{width:390,height:850},hasTouch:true,isMobile:true});
 const page=await context.newPage();
 try{
   await productionStartSmoke(f.baseEnv);
   const preflight=spawnSync(process.execPath,['production/preflight.mjs'],{env:{...process.env,...f.baseEnv,PUBLIC_APP_URL:origin},encoding:'utf8'});
   expect(preflight.status,preflight.stderr).toBe(0);expect(JSON.parse(preflight.stdout).mode).toBe('server');
   for(const patch of [{PUBLIC_APP_URL:'http://localhost'},{PUBLIC_APP_URL:origin+'/wrong'},{PUBLIC_APP_URL:origin+'?bad=1'},{SESSION_SECRET:''},{GITHUB_PRIVATE_KEY:'invalid'}]){
     const run=spawnSync(process.execPath,['production/preflight.mjs'],{env:{...process.env,...f.baseEnv,PUBLIC_APP_URL:origin,...patch},encoding:'utf8'});expect(run.status).not.toBe(0);expect(run.stderr).not.toContain('BEGIN PRIVATE KEY');
   }
   for(const path of ['/tools/content-studio/','/tools/content-studio/index.html','/tools/content-studio/sw.js','/tools/content-studio/manifest.webmanifest'])expect((await f.request(origin,path)).status).toBe(200);
   expect((await f.request(origin,'/tools/content-studio')).status).toBe(308);
   const head=await f.request(origin,'/tools/content-studio/','HEAD');expect(head.status).toBe(200);expect(head.body.length).toBe(0);
   expect((await f.request(origin,'/tools/content-studio/','POST')).status).toBe(405);
   for(const path of ['/.env','/.git/config','/server/app.ts','/production/release.json','/tools/content-studio/assets/fake.js.map','/api/unknown','/%2e%2e/.env','/tools/content-studio/%2e%2e/.env','/tools/content-studio/%5c.env'])expect((await f.request(origin,path)).status).toBeGreaterThanOrEqual(400);
   const health=await f.request(origin,'/api/health');expect(health.headers['cache-control']).toBe('no-store');expect(JSON.parse(health.body.toString())).toMatchObject({ok:true,mode:'server',readiness:'not_checked'});
   const images=[...f.release.files.keys()].filter((p:string)=>p.startsWith('/assets/characters/runtime/'));expect(images).toHaveLength(18);for(const path of images)expect((await f.request(origin,path)).status).toBe(200);
   f.pkceMismatch();await page.goto(origin+'/api/auth/login');await page.waitForURL(origin+'/tools/content-studio/?auth=failed');expect((await(await browserRequest(page,origin+'/api/auth/session')).json()).authenticated).toBe(false);
   f.cancel();await page.goto(origin+'/api/auth/login');await page.waitForURL(origin+'/tools/content-studio/?auth=failed');expect((await (await browserRequest(page,origin+'/api/auth/session')).json()).authenticated).toBe(false);
   f.user('not-allowed');await page.goto(origin+'/api/auth/login');await page.waitForURL(origin+'/tools/content-studio/?auth=failed');expect((await (await browserRequest(page,origin+'/api/auth/session')).json()).authenticated).toBe(false);f.user('allowed-user');
   await authenticate(page,origin);const cookies=await page.context().cookies();expect(cookies.find(c=>c.name.includes('session'))).toMatchObject({secure:true,httpOnly:true,sameSite:'Lax'});
   const sessionResponse=await browserRequest(page,origin+'/api/auth/session'),session=await sessionResponse.json();
   expect((await browserRequest(page,origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin}})).status()).toBe(403);
   expect((await browserRequest(page,origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin,'x-csrf-token':session.csrfToken}})).status()).toBe(200);
   await authenticate(page,origin);
   await expect.poll(()=>page.evaluate(async()=>{const registrations=await navigator.serviceWorker.getRegistrations();return registrations.map(r=>new URL(r.scope).pathname);})).toEqual(['/tools/content-studio/']);
   await page.reload();await expect(page.getByTestId('dashboard')).toBeVisible();
   const cached=await page.evaluate(async()=>{const urls=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())urls.push(request.url);return urls;});expect(cached.every(url=>!url.includes('/api/'))).toBe(true);
   const currentSession=await(await browserRequest(page,origin+'/api/auth/session')).json();
   const writeHeaders={Origin:origin,'content-type':'application/json','x-csrf-token':currentSession.csrfToken};
   f.permissions(false);const status=await (await browserRequest(page,origin+'/api/github/status')).json();expect(status.accessVerified).toBe(false);expect(status.mode).toBe('server');
   expect((await browserRequest(page,origin+'/api/github/pull-requests',{method:'POST',headers:writeHeaders,body:'{}'})).status()).toBeGreaterThanOrEqual(400);f.permissions(true);
   f.repo.safe=false;expect((await (await browserRequest(page,origin+'/api/github/status')).json()).protectionVerified).toBe(false);
   expect((await browserRequest(page,origin+'/api/github/pull-requests',{method:'POST',headers:writeHeaders,body:'{}'})).status()).toBe(409);
   expect(f.repo.pullRequests).toBe(0);expect(f.repo.commits).toBe(0);expect(f.repo.merges).toBe(0);
   const cookieHeader=(await context.cookies(origin)).map(cookie=>cookie.name+'='+cookie.value).join('; ');
   expect((await f.request(origin,'/api/github/prepare','POST',{...writeHeaders,'x-content-studio-version':'0.7.0',Cookie:cookieHeader,'content-length':String(24*1024*1024+1)})).status).toBe(413);
   await f.instances[0].restart();expect((await (await browserRequest(page,origin+'/api/auth/session')).json()).authenticated).toBe(false);await authenticate(page,origin);
   await info.attach('production-entry-results',{body:JSON.stringify({sourceSha:f.release.manifest.sourceSha,files:f.release.files.size,staticBytes:f.release.manifest.files.reduce((n:number,f:any)=>n+f.bytes,0),preflightExit:preflight.status,legacyImages:images.length,cacheUrls:cached,realAndroid:false,https:'isolated self-signed loopback certificate; browser context only',memory:process.memoryUsage()}),contentType:'application/json'});
   await page.screenshot({path:info.outputPath('production-status.png'),fullPage:true});
 }finally{try{await preserveContextTrace(context,info,'production-entry-context');}finally{await browser.close();await f.close();}}
});

for(const width of [360,390,412])test(`production ${width}: actual generator, two origins, migration and read-only PR recovery`,async({},info)=>{
 const f=await productionFixture();const oldOrigin=f.instances[0].origin,newOrigin=f.instances[1].origin;
 const browser=await chromium.launch({args:[`--ignore-certificate-errors-spki-list=${f.spki}`]});
 const old=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:'allow'}),next=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
 const page=await old.newPage(),moved=await next.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));moved.on('pageerror',e=>errors.push(e.message));
 try{
   await authenticate(page,oldOrigin);await page.getByTestId('add-character').click();if(width===412)await attachDenseCharacter(page);else await attachSyntheticCharacter(page);await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();
   if(width===412){await page.getByText('背景と配置の調整',{exact:true}).click();await page.getByRole('combobox',{name:'出力サイズ',exact:true}).selectOption('256');await page.getByRole('button',{name:'変更を画像へ反映',exact:true}).click();await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();}
   await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});
   await page.getByTestId('step-nav-character').click();await page.getByTestId('display-name').fill('公開元を移行しても保存物を守る長い名前');await page.getByTestId('character-id').fill('migrated-unit');
   await page.getByTestId('step-nav-publish').click();await page.getByTestId('prepare-change').click();await expect(page.getByTestId('review-publish-diff')).toBeVisible();await page.getByTestId('review-publish-diff').check();
   f.repo.fault='pr';await page.getByTestId('create-pr').click();await expect(page.getByTestId('publish-complete')).toBeVisible();expect(f.repo.pullRequests).toBe(1);
   await page.getByRole('button',{name:'ダッシュボードへ戻る'}).click();
   const download=page.waitForEvent('download');await page.locator('.draft-card__actions').getByRole('button',{name:'出力',exact:true}).click();const draftBytes=await readFile((await(await download).path())!);
   const recoveryDownload=page.waitForEvent('download');await page.getByRole('button',{name:/復旧情報を出力/}).click();const recoveryBytes=await readFile((await(await recoveryDownload).path())!);
   if(width===412)expect(recoveryBytes.length).toBeGreaterThan(2*1024*1024);
   expect(recoveryBytes.toString()).not.toMatch(/csrfToken|fixture-ephemeral-oauth-token|BEGIN PRIVATE KEY|code_verifier/);
   const before=await storageState(page);expect(before.drafts).toHaveLength(1);expect(before.outbox).toHaveLength(1);
   const beforeFingerprint=await storageFingerprint(page);
   await authenticate(moved,newOrigin);
   const chooser=moved.waitForEvent('filechooser');await moved.getByRole('button',{name:'JSON読込',exact:true}).click();await(await chooser).setFiles({name:'draft.json',mimeType:'application/json',buffer:draftBytes});
   await expect(moved.getByTestId('step-nav-publish')).toBeVisible();await moved.getByRole('button',{name:'ダッシュボードへ戻る'}).click();
   await moved.getByTestId('migration-draft').selectOption({index:1});
   await moved.getByRole('button',{name:'通知を閉じる',exact:true}).click();
   await moved.setViewportSize({width,height:450});
   await moved.getByTestId('origin-migration').scrollIntoViewIfNeeded();
   const controls=await moved.getByTestId('origin-migration').locator('button,select').evaluateAll(elements=>elements.map(element=>({height:element.getBoundingClientRect().height,width:element.getBoundingClientRect().width})));
   expect(controls.every(control=>control.height>=48&&control.width<=width)).toBe(true);
   await moved.screenshot({path:info.outputPath(`migration-controls-${width}.png`),fullPage:true});
   const recoveryChooser=moved.waitForEvent('filechooser');
   await moved.getByRole('button',{name:'復旧情報を読み込み、既存PRだけ照合',exact:true}).click();
   await(await recoveryChooser).setFiles({name:'recovery.json',mimeType:'application/json',buffer:recoveryBytes});
   await expect(moved.getByRole('status')).toContainText('読取照合');expect(f.repo.pullRequests).toBe(1);expect(f.repo.commits).toBe(1);
   await moved.getByRole('button',{name:'既存PRを確認・再開'}).click();await expect(moved.getByTestId('review-publish-diff')).not.toBeChecked();await expect(moved.getByTestId('create-pr')).toBeDisabled();
   await moved.setViewportSize({width,height:450});await moved.screenshot({path:info.outputPath(`recovery-${width}.png`),fullPage:true});
   await moved.getByTestId('review-publish-diff').check();await moved.getByTestId('create-pr').click();await expect(moved.getByTestId('publish-complete')).toBeVisible();expect(f.repo.pullRequests).toBe(1);expect(f.repo.commits).toBe(1);
   await f.instances[1].restart();await authenticate(moved,newOrigin);await moved.getByRole('button',{name:'既存PRを確認・再開'}).click();await expect(moved.getByTestId('review-publish-diff')).not.toBeChecked();expect(f.repo.pullRequests).toBe(1);
   if(width===360){
     await moved.getByTestId('publish-mode-merge').click();
     const freshPreparation=moved.waitForResponse(response=>new URL(response.url()).pathname==='/api/github/prepare'&&response.request().method()==='POST');
     await moved.getByTestId('prepare-change').click();expect((await freshPreparation).status()).toBe(200);
     await expect(moved.getByTestId('prepare-change')).toBeEnabled();await expect(moved.getByTestId('review-publish-diff')).not.toBeChecked();
     await moved.getByTestId('review-publish-diff').check();moved.once('dialog',dialog=>dialog.accept());f.repo.fault='merge';await moved.getByTestId('create-pr').click();
     await expect.poll(()=>f.repo.merges).toBe(1);expect(f.repo.pullRequests).toBe(1);expect(f.repo.deploymentRefs).toContain('f'.repeat(40));
     await moved.reload();await moved.getByRole('button',{name:'既存PRを確認・再開'}).click();await expect(moved.getByTestId('create-pr')).toBeDisabled();await expect(moved.getByTestId('create-pr')).toContainText('merge済み');
   }
   const migratedStorage=await storageState(moved);expect(migratedStorage.drafts).toHaveLength(1);expect(migratedStorage.drafts[0]).not.toBe(before.drafts[0]);expect(await storageState(page)).toEqual(before);
   expect(await storageFingerprint(page)).toBe(beforeFingerprint);
   if(width===412){
     const memoryBefore=process.memoryUsage();f.repo.advanceTo([...f.repo.refs.values()][0]);
     const response=await browserRequest(moved,newOrigin+'/api/github/published-character?slug=migrated-unit');expect(response.status()).toBe(200);const snapshot=await response.json();
     const fileBytes=snapshot.files.reduce((n:number,f:any)=>n+f.byteLength,0);expect(fileBytes).toBeGreaterThan(2*1024*1024);
     const thumbnailPath='/api/github/thumbnail?'+new URLSearchParams({slug:'migrated-unit',baseSha:snapshot.revision.baseSha,canonicalBlobSha:snapshot.revision.canonicalBlobSha});
     const thumbnail=await moved.evaluate(async path=>{
       const response=await fetch(path,{cache:'no-store'}),bytes=await response.arrayBuffer();
       const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
       return {status:response.status,mime:response.headers.get('content-type'),cache:response.headers.get('cache-control'),hash};
     },thumbnailPath);
     expect(thumbnail).toEqual({status:200,mime:'image/png',cache:'no-store',hash:snapshot.files.find((file:any)=>file.path===snapshot.record.assets.iconPng).sha256});
     expect((await browserRequest(moved,newOrigin+'/api/github/thumbnail?'+new URLSearchParams({slug:'migrated-unit',baseSha:snapshot.revision.baseSha,canonicalBlobSha:'e'.repeat(40)}))).status()).toBeGreaterThanOrEqual(400);
     await info.attach('large-publication-snapshot-memory',{body:JSON.stringify({node:process.version,platform:process.platform,measurement:'Node process includes real HTTPS handler, GitHub fixture storage and Playwright client; Chromium RAM excluded. Instantaneous RSS/heap/external readings, not peak or whole-host guarantee.',recoveryTransferBytes:recoveryBytes.length,snapshotFileBytes:fileBytes,memoryBefore,memoryAfter:process.memoryUsage()}),contentType:'application/json'});
   }
   expect(errors).toEqual([]);await info.attach('migration-results',{body:JSON.stringify({sourceSha:f.release.manifest.sourceSha,width,originChanged:oldOrigin!==newOrigin,oldStorage:before,oldStorageFingerprint:beforeFingerprint,migratedStorage,branches:f.repo.branches,commits:f.repo.commits,prs:f.repo.pullRequests,errors,realAndroid:false}),contentType:'application/json'});
 }finally{try{await preserveContextTrace(old,info,'old-origin-context');await preserveContextTrace(next,info,'new-origin-context');}finally{await browser.close();await f.close();}}
});
