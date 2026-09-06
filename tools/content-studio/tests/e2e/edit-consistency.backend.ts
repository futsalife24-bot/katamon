import {readFile} from 'node:fs/promises';
import {test,expect,type Page} from '@playwright/test';
import {attachSyntheticCharacter} from './image-upload';
async function generated(page:Page){await page.goto('/__fixture/reset');await page.goto('/');await page.getByTestId('add-character').click();await attachSyntheticCharacter(page);await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});}
async function owned(page:Page){return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('content-studio-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const result:Record<string,any[]>={};for(const name of ['drafts','blobs','appMeta','outbox'])result[name]=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return {drafts:result.drafts,blobs:result.blobs.map(b=>({key:b.key,sha256:b.sha256})),meta:result.appMeta.map(m=>m.key),outbox:result.outbox.map(o=>o.id)};});}
for(const width of [360,390,412])test(`E1 ${width}: real PNG generation rejects unapplied layout, reload and Apply`,async({page},info)=>{
 if(width===360)for(const name of ['observations.json','E1-new.png','E1-published.png','E2.png'])await info.attach(`PRE-FIX-local-${name}`,{body:await readFile(new URL(`../fixtures/p3a-r1-before/${name}`,import.meta.url)),contentType:name.endsWith('.json')?'application/json':'image/png'});
 await page.setViewportSize({width,height:780});await generated(page);const before=await owned(page);
 await page.getByTestId('step-nav-image').click();await page.getByText('背景と配置の調整',{exact:true}).click();await page.locator('label').filter({hasText:'大きさ'}).locator('input').fill('0.5');
 await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();await page.waitForTimeout(800);
 const after=await owned(page);await info.attach('unapplied-real-png-state',{body:JSON.stringify({before,after}),contentType:'application/json'});await page.screenshot({path:info.outputPath(`unapplied-${width}.png`),fullPage:true});
 await expect(page.getByRole('alert').last()).toContainText('変更を画像へ反映');expect(after.blobs).toEqual(before.blobs);
 await page.reload();await page.locator('button.draft-card__open').first().click();await page.getByTestId('step-nav-publish').click();await page.getByTestId('run-validation').click();await expect(page.getByTestId('step-publish')).toContainText('変更を画像へ反映');
 await page.getByTestId('step-nav-image').click();await page.getByText('背景と配置の調整',{exact:true}).click();const apply=page.getByRole('button',{name:'変更を画像へ反映',exact:true});await apply.scrollIntoViewIfNeeded();const box=await apply.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(48);expect(box!.width).toBeGreaterThanOrEqual(48);await apply.click();await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();
 await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});expect((await owned(page)).blobs).not.toEqual(before.blobs);
});
test('E2: UI deletion removes owned image metadata in real IndexedDB',async({page},info)=>{
 await generated(page);const before=await owned(page);const id=before.drafts[0].id;expect(before.meta).toContain(`${id}:editing-input`);
 await page.getByRole('button',{name:'ダッシュボードへ戻る'}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'削除',exact:true}).click();await expect(page.getByRole('button',{name:'削除',exact:true})).toBeHidden();
 const after=await owned(page);await info.attach('delete-indexeddb',{body:JSON.stringify({before,after}),contentType:'application/json'});expect(after.meta.filter(k=>k.startsWith(`${id}:`))).toEqual([]);expect(after.blobs).toEqual([]);expect(after.drafts).toEqual([]);await page.screenshot({path:info.outputPath('deleted.png'),fullPage:true});
});


async function publishedEdit(page:Page){
 await generated(page);await page.getByTestId('step-nav-character').click();await page.getByTestId('display-name').fill('公開済みの長い名前を持つ編集整合テスト');await page.getByTestId('character-id').fill('published-a');await page.getByTestId('step-nav-publish').click();await page.getByTestId('prepare-change').click();await page.getByTestId('review-publish-diff').check();await page.getByTestId('create-pr').click();await expect(page.getByTestId('publish-complete')).toBeVisible();await page.request.get('/__fixture/advance-last');
 await page.getByRole('button',{name:'ダッシュボードへ戻る'}).click();await page.getByRole('button',{name:'公開一覧を更新'}).click();await page.getByTestId('published-published-a').getByRole('button',{name:'公開版から新しい更新用下書き'}).click();await page.getByRole('button',{name:'編集入力を復元して画像・動作を編集'}).click();await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();
}
test('E1 published checkpoint: every placement field blocks generation and prepare until Apply; backup preserves pending state',async({page},info)=>{
 await page.setViewportSize({width:390,height:780});await publishedEdit(page);const baseline=await owned(page);const checks=[];
 const regenerated=await page.evaluate(async()=>{
  const db=await import('/src/storage/db.ts' as string),codec=await import('/src/image/canvas-codec.ts' as string),header=await import('/src/image/header.ts' as string),batch=await import('/src/motion/batch.ts' as string),hash=await import('/src/generation/hash.ts' as string);
  const draft=(await db.listDrafts()).find((d:any)=>d.publishedEdit),snapshot=await db.getAppMeta(`${draft.id}:published-snapshot`),recipe=snapshot.record.editing;
  const blob=await db.getDraftBlob(draft.id,'original'),source=await codec.decodeImageBlob(blob,await header.inspectImageBlob(blob,'checkpoint.png'));
  const clips=await batch.generateMotionBatch({source,sourceImage:'normalized.png',landmarks:{...draft.landmarks,...recipe.landmarks},sourcePlacement:recipe.placement,outputSize:recipe.outputSize,intensity:recipe.intensity});
  return Promise.all(batch.MOTION_CLIP_IDS.map(async(id:string)=>({id,actual:await hash.sha256Blob(clips[id].spriteSheetPng.blob),expected:snapshot.files.find((f:any)=>f.path===snapshot.record.assets.motionSpriteSheets[id]).sha256,rendering:clips[id].metadata.rendering,expectedRendering:snapshot.record.motionMetadata[id].rendering})));
 });
 await info.attach('checkpoint-real-png-regeneration',{body:JSON.stringify(regenerated),contentType:'application/json'});for(const clip of regenerated){expect(clip.actual).toBe(clip.expected);expect(clip.rendering).toEqual(clip.expectedRendering);}

 for(const [label,value] of [['大きさ','0.5'],['左右位置','24'],['上下位置','12'],['余白','30'],['左右反転','true'],['出力サイズ','256']]){
  await page.getByTestId('step-nav-image').click();await page.getByText('背景と配置の調整',{exact:true}).click();
  if(label==='左右反転')await page.getByLabel(label,{exact:true}).check();else if(label==='出力サイズ')await page.getByTestId('step-cutout').locator('select').selectOption(value);else await page.locator('label').filter({hasText:label}).locator('input').fill(value);
  await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByRole('alert').last()).toContainText('変更を画像へ反映');await page.getByRole('button',{name:'エラーを閉じる'}).click();
  await page.getByTestId('step-nav-publish').click();await page.getByTestId('prepare-change').click();await expect(page.getByTestId('step-publish')).toContainText('変更を画像へ反映');await expect(page.getByTestId('review-publish-diff')).toBeHidden();await expect(page.getByRole('button',{name:'モーションZIP',exact:true})).toBeDisabled();checks.push({label,value,blobs:(await owned(page)).blobs});
 }
 await page.waitForTimeout(800);const imported=await page.evaluate(async()=>{const db=await import('/src/storage/db.ts' as string);const d=(await db.listDrafts()).find((d:any)=>d.publishedEdit);return db.importDraftJson(await db.exportDraftJson(d.id));});
 await page.reload();await page.locator('button.draft-card__open').filter({hasText:imported.character.displayName}).first().click();await page.getByTestId('step-nav-publish').click();await page.getByTestId('run-validation').click();await expect(page.getByTestId('step-publish')).toContainText('変更を画像へ反映');
 expect((await owned(page)).blobs.filter(b=>baseline.blobs.some(x=>x.key===b.key))).toEqual(baseline.blobs);await info.attach('published-unapplied-matrix',{body:JSON.stringify(checks),contentType:'application/json'});await page.setViewportSize({width:390,height:430});await page.screenshot({path:info.outputPath('published-pending-import.png'),fullPage:true});
});
test('E2 real IndexedDB: published images, clone/import, transaction abort, outbox and late save',async({page},info)=>{
 await publishedEdit(page);await page.getByTestId('step-nav-motion').click();await page.getByTestId('intensity-fire-strong').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});await page.getByRole('button',{name:'ダッシュボードへ戻る'}).click();const before=await owned(page);
 const result=await page.evaluate(async()=>{
  const s=await import('/src/storage/db.ts' as string);const draft=(await s.listDrafts()).find((d:any)=>d.publishedEdit);const errors:string[]=[];const capture=async(fn:()=>Promise<unknown>)=>{try{await fn();return false;}catch(e){errors.push(String(e));return true;}};
  const put=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(this.name==='appMeta')throw new DOMException('fixture delete abort','AbortError');return put.call(this,key);};const failed=await capture(()=>s.deleteDraft(draft.id));IDBObjectStore.prototype.delete=put;
  const rollback={draft:Boolean(await s.getDraft(draft.id)),blobs:(await s.listDraftBlobs(draft.id)).length,snapshot:Boolean(await s.getAppMeta(`${draft.id}:published-snapshot`))};
  for(let i=0;i<2;i++)for(const copy of [await s.duplicateDraft(draft.id),await s.importDraftJson(await s.exportDraftJson(draft.id))])await s.deleteDraft(copy.id);
  await s.deleteDraft(draft.id);const late=await capture(()=>s.saveDraft(draft));const lateBlob=await capture(()=>s.putDraftBlob(draft.id,'original',new Blob(['late'])));const lateMeta=await capture(()=>s.setAppMeta(`${draft.id}:editing-input`,new Blob(['late'])));
  const outbox=await s.listOutbox();const dependent=await capture(()=>s.deleteDraft(outbox[0].draftId));return {failed,rollback,late,lateBlob,lateMeta,dependent,errors,deleted:draft.id};
 });
 expect(result.failed&&result.rollback.draft&&result.rollback.snapshot&&result.rollback.blobs>5).toBe(true);expect(result.late&&result.lateBlob&&result.lateMeta&&result.dependent).toBe(true);await page.reload();const after=await owned(page);expect(after.drafts).toHaveLength(1);expect(after.outbox).toEqual(before.outbox);expect(after.meta.filter(k=>k.startsWith(result.deleted+':'))).toEqual([]);expect(after.blobs.filter(b=>b.key.startsWith(result.deleted+':'))).toEqual([]);
 await info.attach('indexeddb-atomic-deletion',{body:JSON.stringify({before,after,result}),contentType:'application/json'});await page.screenshot({path:info.outputPath('published-deleted-preserved-outbox.png'),fullPage:true});
});
