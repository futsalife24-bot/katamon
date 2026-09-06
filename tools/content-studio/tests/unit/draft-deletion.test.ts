import 'fake-indexeddb/auto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createDraft} from '../../src/domain/defaults';
import {deleteDraft,saveDraft,setAppMeta,getAppMeta,getDraft,putDraftBlob,listDraftBlobs,putOutbox,listOutbox,duplicateDraft,exportDraftJson,importDraftJson,resetDatabaseConnectionForTests,DRAFT_META_SUFFIXES} from '../../src/storage/db';
async function reset(){await resetDatabaseConnectionForTests();await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('content-studio-v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
beforeEach(reset);afterEach(async()=>{vi.restoreAllMocks();await reset();});
it('deletes exact owned keys and blobs, preserving another draft, settings, outbox and durable deletion marker',async()=>{
 const a=createDraft(),b=createDraft();await saveDraft(a);await saveDraft(b);await setAppMeta('storage-persistent',true);await setAppMeta(`${a.id}:unrelated-setting`,42);
 for(const d of [a,b]){await putDraftBlob(d.id,'original',new Blob(['image']));for(const suffix of DRAFT_META_SUFFIXES)await setAppMeta(`${d.id}:${suffix}`,{image:new Blob(['private pixels'])});}
 const outbox={id:'other',draftId:b.id,bundle:{} as any,createdAt:b.createdAt,updatedAt:b.updatedAt,attempts:0,lastError:null};await putOutbox(outbox);
 await deleteDraft(a.id);expect(await getDraft(a.id)).toBeNull();expect(await listDraftBlobs(a.id)).toEqual([]);for(const suffix of DRAFT_META_SUFFIXES){expect(await getAppMeta(`${a.id}:${suffix}`)).toBeNull();expect(await getAppMeta(`${b.id}:${suffix}`)).not.toBeNull();}
 expect(await getDraft(b.id)).not.toBeNull();expect(await listDraftBlobs(b.id)).toHaveLength(1);expect(await getAppMeta('storage-persistent')).toBe(true);expect(await getAppMeta(`${a.id}:unrelated-setting`)).toBe(42);expect(await listOutbox()).toHaveLength(1);
 await expect(saveDraft(a)).rejects.toThrow('削除済み');await expect(putDraftBlob(a.id,'original',new Blob(['late']))).rejects.toThrow('削除済み');await expect(setAppMeta(`${a.id}:editing-input`,new Blob(['late']))).rejects.toThrow('削除済み');await expect(putOutbox({...outbox,id:'late',draftId:a.id})).rejects.toThrow('削除済み');
 await resetDatabaseConnectionForTests();await expect(saveDraft(a)).rejects.toThrow('削除済み');expect(await getDraft(a.id)).toBeNull();
});
it('aborts the entire deletion on metadata failure and preserves dependent outbox',async()=>{
 const a=createDraft();await saveDraft(a);await putDraftBlob(a.id,'original',new Blob(['keep']));await setAppMeta(`${a.id}:editing-input`,{image:new Blob(['keep'])});
 const original=IDBObjectStore.prototype.delete;const spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key){if(this.name==='appMeta')throw new DOMException('fixture abort','QuotaExceededError');return original.call(this,key);});
 await expect(deleteDraft(a.id)).rejects.toThrow('fixture abort');spy.mockRestore();expect(await getDraft(a.id)).not.toBeNull();expect(await listDraftBlobs(a.id)).toHaveLength(1);expect(await getAppMeta(`${a.id}:editing-input`)).not.toBeNull();expect(await getAppMeta(`deleted-draft:${a.id}`)).toBeNull();
 await putOutbox({id:'pending',draftId:a.id,bundle:{} as any,createdAt:a.createdAt,updatedAt:a.updatedAt,attempts:0,lastError:null});await expect(deleteDraft(a.id)).rejects.toThrow('公開操作');expect(await getDraft(a.id)).not.toBeNull();expect(await listOutbox()).toHaveLength(1);
});
it('normal, duplicated and imported drafts repeatedly delete without accumulating owned image data',async()=>{
 const source=createDraft();await saveDraft(source);await putDraftBlob(source.id,'original',new Blob(['source']));
 for(let i=0;i<3;i++){for(const d of [await duplicateDraft(source.id),await importDraftJson(await exportDraftJson(source.id))]){await setAppMeta(`${d.id}:editing-input`,new Blob(['derived']));await deleteDraft(d.id);expect(await getDraft(d.id)).toBeNull();expect(await listDraftBlobs(d.id)).toEqual([]);for(const suffix of DRAFT_META_SUFFIXES)expect(await getAppMeta(`${d.id}:${suffix}`)).toBeNull();}}
 expect(await getDraft(source.id)).not.toBeNull();expect(await listDraftBlobs(source.id)).toHaveLength(1);
});

it('an actual queued autosave after deletion reports failure and never recreates the draft',async()=>{
 const {createAutosaveController}=await import('../../src/storage/autosave');const d=createDraft();await saveDraft(d);const saved=vi.fn(),failed=vi.fn();const autosave=createAutosaveController(60000,saved,failed);
 autosave.schedule({...d,title:'late edit'});await deleteDraft(d.id);expect(await autosave.flush()).toBeNull();expect(saved).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledOnce();expect(await getDraft(d.id)).toBeNull();
});
