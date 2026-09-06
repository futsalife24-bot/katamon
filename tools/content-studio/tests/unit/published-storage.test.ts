import 'fake-indexeddb/auto';
import {afterEach,it,expect,vi} from 'vitest';
import {createDraft} from '../../src/domain/defaults';
import {saveDraft,putDraftBlob,exportDraftJson,importDraftJson,listDrafts,listDraftBlobs,resetDatabaseConnectionForTests} from '../../src/storage/db';
afterEach(async()=>{vi.restoreAllMocks();await resetDatabaseConnectionForTests();await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('content-studio-v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});});
it('a failure after draft and first blob writes rolls back the entire imported unit',async()=>{
  const original=createDraft();await saveDraft(original);await putDraftBlob(original.id,'original',new Blob(['one'],{type:'image/png'}));await putDraftBlob(original.id,'hit-original',new Blob(['two'],{type:'image/png'}));
  const backup=await exportDraftJson(original.id),before=await listDrafts();let writes=0;const put=IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){if(this.name==='blobs'&&++writes===2)throw new DOMException('fixture late quota','QuotaExceededError');return put.call(this,value,key!);});
  await expect(importDraftJson(backup)).rejects.toThrow('fixture late quota');await new Promise(resolve=>setTimeout(resolve,20));
  expect(await listDrafts()).toEqual(before);expect(await listDraftBlobs(original.id)).toHaveLength(2);
});
it('invalid hash and deep JSON never write a partially imported draft',async()=>{
  const original=createDraft();await saveDraft(original);await putDraftBlob(original.id,'original',new Blob(['original'],{type:'image/png'}));const backup=JSON.parse(await (await exportDraftJson(original.id)).text());backup.blobs[0].sha256='0'.repeat(64);const before=await listDrafts();
  await expect(importDraftJson(new Blob([JSON.stringify(backup)]))).rejects.toThrow();await expect(importDraftJson(new Blob(['['.repeat(33)+']'.repeat(33)]))).rejects.toThrow();expect(await listDrafts()).toEqual(before);
});
