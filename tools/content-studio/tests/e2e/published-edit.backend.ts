import {readFile} from 'node:fs/promises';
import {test, expect, type Page} from '@playwright/test';
import {attachSyntheticCharacter} from './image-upload';
async function state(page:Page){return (await page.request.get('/__fixture/catalog-state')).json();}
async function publish(page:Page){
  await page.getByTestId('step-nav-publish').click();await page.getByTestId('prepare-change').click();
  await expect(page.getByTestId('review-publish-diff')).toBeVisible();await expect(page.getByTestId('create-pr')).toBeDisabled();
  await page.getByTestId('review-publish-diff').check();await page.getByTestId('create-pr').click();await expect(page.getByTestId('publish-complete')).toBeVisible();
  await page.request.get('/__fixture/advance-last');
}
for(const width of [360,390,412])test(`P3A ${width}: generated A, B, empty storage, no-op, information bytes, regeneration and re-edit`,async({page,browser},info)=>{
  await page.setViewportSize({width,height:850});await page.goto('/__fixture/reset');await page.goto('/');await page.getByTestId('add-character').click();
  await attachSyntheticCharacter(page);await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();
  if(width===390){await attachSyntheticCharacter(page,'[data-testid="hit-image-input"]','test-hit.png',true);await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();}
  await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});
  await page.getByTestId('step-nav-character').click();await page.getByTestId('display-name').fill('公開再編集テストA');await page.getByTestId('character-id').fill('published-a');await publish(page);
  await page.request.get('/__fixture/add-b');const before=await state(page);
  const fresh=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:'block'});const edit=await fresh.newPage();
  await edit.goto('http://localhost:4177/__fixture/session');await edit.goto('http://localhost:4177/');
  await edit.getByTestId('published-published-a').getByRole('button',{name:'公開版から新しい更新用下書き'}).click();await expect(edit.getByTestId('published-edit-mode')).toBeVisible();
  await expect(edit.getByTestId('display-name')).toHaveValue('公開再編集テストA');await edit.getByTestId('step-nav-publish').click();await edit.getByTestId('prepare-change').click();
  await expect(edit.getByRole('status')).toContainText('変更はありません');expect(await state(page)).toEqual(before);await expect(edit.getByTestId('review-publish-diff')).toBeHidden();
  await edit.getByTestId('step-nav-character').click();await edit.getByTestId('display-name').fill('長い名前の公開済みキャラクター情報だけを更新');await edit.getByTestId('published-description').fill('画像・5動作は変更しない説明');
  await edit.waitForTimeout(900);await edit.reload();await edit.getByRole('button',{name:/作業中の下書きを再開/}).click();await expect(edit.getByTestId('display-name')).toHaveValue('長い名前の公開済みキャラクター情報だけを更新');
  await edit.setViewportSize({width,height:430});await publish(edit);const after=await state(page);
  expect(after.files.filter((f:any)=>f.path.startsWith('assets/')||f.path.includes('unit-b'))).toEqual(before.files.filter((f:any)=>f.path.startsWith('assets/')||f.path.includes('unit-b')));
  await edit.screenshot({path:info.outputPath(`information-${width}.png`),fullPage:true});
  await edit.reload();await edit.getByTestId('published-published-a').getByRole('button',{name:'公開版から新しい更新用下書き'}).click();
  await edit.getByRole('button',{name:'編集入力を復元して画像・動作を編集'}).click();await expect(edit.getByRole('dialog',{name:'処理中'})).toBeHidden();
  await edit.evaluate(()=>{const encode=OffscreenCanvas.prototype.convertToBlob;(window as any).__pngEncodes=[];OffscreenCanvas.prototype.convertToBlob=function(options){if(options?.type==='image/png')(window as any).__pngEncodes.push([this.width,this.height]);return encode.call(this,options);};});
  await edit.getByTestId('step-nav-motion').click();await edit.getByTestId('intensity-fire-strong').click();await edit.getByTestId('generate-motion').click();await expect(edit.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});await publish(edit);
  const regenerated=await state(page),oldA=after.files.find((f:any)=>f.path==='content/characters/published-a.json').json,newA=regenerated.files.find((f:any)=>f.path==='content/characters/published-a.json').json;
  for(const id of ['move-forward','move-backward','hit','land'])expect(regenerated.files.find((f:any)=>f.path===newA.assets.motionSpriteSheets[id]).sha).toBe(after.files.find((f:any)=>f.path===oldA.assets.motionSpriteSheets[id]).sha);
  const encodes=await edit.evaluate(()=>(window as any).__pngEncodes);expect(encodes).toHaveLength(1);expect(encodes[0][0]).toBe(newA.motionMetadata.fire.frameWidth*newA.motionMetadata.fire.frameCount);
  expect(newA.editing.intensity.fire).toBe('strong');expect(regenerated.files.filter((f:any)=>f.path.includes('unit-b'))).toEqual(before.files.filter((f:any)=>f.path.includes('unit-b')));
  const second=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:'block'}),again=await second.newPage();await again.goto('http://localhost:4177/__fixture/session');await again.goto('http://localhost:4177/');await again.getByTestId('published-published-a').getByRole('button',{name:'公開版から新しい更新用下書き'}).click();await expect(again.getByTestId('published-edit-mode')).toBeVisible();
  await again.screenshot({path:info.outputPath(`reedited-${width}.png`),fullPage:true});await info.attach('canonical-and-file-hashes',{body:JSON.stringify({before,after,regenerated}),contentType:'application/json'});
  if(width===390){
    await again.getByTestId('step-nav-publish').click();const downloadPromise=again.waitForEvent('download');await again.getByRole('button',{name:'下書きJSON',exact:true}).click();const download=await downloadPromise;
    const third=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:'block'}),imported=await third.newPage();await imported.goto('http://localhost:4177/__fixture/session');await imported.goto('http://localhost:4177/');
    const chooserPromise=imported.waitForEvent('filechooser');await imported.getByRole('button',{name:'JSON読込',exact:true}).click();await (await chooserPromise).setFiles({name:'local-backup.json',mimeType:'application/json',buffer:await readFile((await download.path())!)});
    await expect(imported.getByTestId('published-edit-mode')).toBeVisible();await imported.getByTestId('step-nav-publish').click();await imported.getByTestId('prepare-change').click();await expect(imported.getByRole('status')).toContainText('変更はありません');expect(await state(page)).toEqual(regenerated);
    await info.attach('backup-import',{body:JSON.stringify(await draftsIn(imported)),contentType:'application/json'});await third.close();
  }
  await second.close();await fresh.close();
});
async function createFixtureA(page:Page){
  await page.goto('/__fixture/reset');await page.goto('/');await page.getByTestId('add-character').click();await attachSyntheticCharacter(page);await expect(page.getByRole('dialog',{name:'処理中'})).toBeHidden();
  await page.getByTestId('step-nav-motion').click();await page.getByTestId('generate-motion').click();await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成',{timeout:120000});await page.getByTestId('step-nav-character').click();await page.getByTestId('display-name').fill('公開A');await page.getByTestId('character-id').fill('published-a');await publish(page);
}
async function draftsIn(page:Page){return page.evaluate(async()=>{const {listDrafts}=await import('/src/storage/db.ts' as string);return (await listDrafts()).map((d:any)=>({id:d.id,title:d.title,revision:d.publishedEdit?.revision,generated:d.generatedClips}));});}
test('P3A failed reads, atomic save failure, late completion, conflict and old recipe preserve drafts',async({page,browser},info)=>{
  test.setTimeout(240000);await createFixtureA(page);
  const ctx=await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true,serviceWorkers:'block'}),edit=await ctx.newPage();
  await edit.goto('http://localhost:4177/__fixture/session');await edit.goto('http://localhost:4177/');await edit.getByTestId('add-character').click();await edit.getByTestId('step-nav-character').click();await edit.getByTestId('display-name').fill('守る作業');await edit.getByRole('button',{name:'ダッシュボードへ戻る'}).click();const protectedDrafts=await draftsIn(edit);
  const open=()=>edit.getByTestId('published-published-a').getByRole('button',{name:'公開版から新しい更新用下書き'}).click();
  for(const fault of ['missing','hash']){await page.request.get('/__fixture/'+fault);await open();await expect(edit.getByRole('alert').last()).toContainText('公開正本を取得できません');expect(await draftsIn(edit)).toEqual(protectedDrafts);await page.request.get('/__fixture/clear-fault');await edit.getByRole('button',{name:'エラーを閉じる'}).click();}
  await edit.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){if(this.name==='drafts'&&value.publishedEdit)throw new DOMException('fixture quota exceeded','QuotaExceededError');return original.call(this,value,key!);};(window as any).__restorePut=()=>{IDBObjectStore.prototype.put=original;};});
  await open();await expect(edit.getByRole('alert').last()).toContainText('fixture quota exceeded');expect(await draftsIn(edit)).toEqual(protectedDrafts);await edit.evaluate(()=>(window as any).__restorePut());await edit.getByRole('button',{name:'エラーを閉じる'}).click();
  await page.request.get('/__fixture/slow');await open();await edit.getByRole('button',{name:'処理を中止'}).click();await edit.getByTestId('add-character').click();await edit.getByTestId('step-nav-character').click();await edit.getByTestId('display-name').fill('後続の別下書き');await edit.waitForTimeout(3500);await expect(edit.getByTestId('display-name')).toHaveValue('後続の別下書き');expect(await draftsIn(edit)).toHaveLength(2);
  await edit.getByRole('button',{name:'ダッシュボードへ戻る'}).click();await open();await expect(edit.getByTestId('published-edit-mode')).toBeVisible();await edit.getByTestId('display-name').fill('編集中のAは保持');await page.request.get('/__fixture/target-update');const conflictState=await state(page);
  await edit.getByTestId('step-nav-publish').click();await edit.getByTestId('prepare-change').click();await expect(edit.getByRole('alert').last()).toContainText('同じキャラクター');await expect(edit.getByTestId('review-publish-diff')).toBeHidden();expect(await state(page)).toEqual(conflictState);
  await edit.getByTestId('step-nav-character').click();await expect(edit.getByTestId('display-name')).toHaveValue('編集中のAは保持');await edit.screenshot({path:info.outputPath('conflict-preserved.png'),fullPage:true});
  await page.request.get('/__fixture/old-record');await edit.getByRole('button',{name:'ダッシュボードへ戻る'}).click();await edit.getByRole('button',{name:'公開一覧を更新'}).click();await open();await expect(edit.getByTestId('published-edit-mode')).toContainText('未復元');await expect(edit.getByRole('button',{name:'この公開画像を新しい編集元にする'})).toBeVisible();
  const oldState=await state(page);await edit.getByTestId('display-name').fill('旧形式でも情報編集');await publish(edit);const newState=await state(page);expect(newState.files.filter((f:any)=>f.path.startsWith('assets/'))).toEqual(oldState.files.filter((f:any)=>f.path.startsWith('assets/')));
  expect((await draftsIn(edit)).some((d:any)=>d.title==='編集中のAは保持')).toBe(true);await info.attach('fault-and-old-data-evidence',{body:JSON.stringify({protectedDrafts,conflictState,oldState,newState}),contentType:'application/json'});await ctx.close();
});
