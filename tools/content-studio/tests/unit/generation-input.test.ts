import {afterEach,expect,it} from 'vitest';
import 'fake-indexeddb/auto';
import {createDraft} from '../../src/domain/defaults';
import {imageInputKey,hasUnappliedImage,draftClipInputKey} from '../../src/domain/generation-input';
import {saveDraft,getDraft,exportDraftJson,importDraftJson,resetDatabaseConnectionForTests} from '../../src/storage/db';
afterEach(async()=>{await resetDatabaseConnectionForTests();await new Promise<void>(resolve=>{const r=indexedDB.deleteDatabase('content-studio-v1');r.onsuccess=()=>resolve();});});
it('pending placement survives storage and import; original settings are never silently restored',async()=>{
 const d=createDraft();d.originalSha256='a'.repeat(64);d.appliedImageInputKey=imageInputKey(d);expect(hasUnappliedImage(d)).toBe(false);
 for(const field of ['scale','padding','offsetX','offsetY','flipHorizontal','outputSize'] as const){const next=structuredClone(d);if(field==='flipHorizontal')next.editor[field]=!d.editor[field];else if(field==='outputSize')next.editor[field]=256;else next.editor[field]=d.editor[field]+(field==='scale'?.1:1);expect(hasUnappliedImage(next)).toBe(true);await saveDraft(next);expect(hasUnappliedImage((await getDraft(next.id))!)).toBe(true);const imported=await importDraftJson(await exportDraftJson(next.id));expect(imported.editor).toEqual(next.editor);expect(hasUnappliedImage(imported)).toBe(true);}
});
it('view and information edits do not invalidate pixels; strength is per clip, legacy input stays unverified',()=>{
 const d=createDraft();expect(hasUnappliedImage(d)).toBe(true);d.appliedImageInputKey=imageInputKey(d);const next=structuredClone(d);next.editor.zoom=2;next.editor.tool='erase';next.character.displayName='名前だけ';expect(hasUnappliedImage(next)).toBe(false);expect(draftClipInputKey(next,'fire')).toBe(draftClipInputKey(d,'fire'));next.motionIntensity.fire='strong';expect(draftClipInputKey(next,'fire')).not.toBe(draftClipInputKey(d,'fire'));expect(draftClipInputKey(next,'hit')).toBe(draftClipInputKey(d,'hit'));
});
