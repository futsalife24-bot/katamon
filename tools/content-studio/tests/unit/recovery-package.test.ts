import {it,expect} from 'vitest';
import {createDraft} from '../../src/domain/defaults';
import {imageInputKey} from '../../src/domain/generation-input';
import {migrationContentHash,readRecovery} from '../../src/storage/recovery';
import {canonicalRecordBytes,submittedFile} from './server-fixtures';

async function fixture(){
 const record=JSON.parse(canonicalRecordBytes().toString()),draft=createDraft('old-id');
 draft.character=record.character;draft.appliedImageInputKey=imageInputKey(draft);
 const value={format:'content-studio-recovery-v1',mode:'server',actor:'allowed-user',draftContentHash:await migrationContentHash(draft),
  hint:{repository:'target-owner/target-repository',branch:'studio/add-character-sample-unit-'+'a'.repeat(40),baseSha:'b'.repeat(40),operationDigest:'c'.repeat(64)},
  bundle:{bundleId:'d'.repeat(64),generatorVersion:'0.1.0',createdAt:'2026-08-06T00:00:00.000Z',character:record.character,spriteMetadata:record.spriteMetadata,prBody:'fixture',files:[submittedFile('content/characters/sample-unit.json','application/json',canonicalRecordBytes())]}};
 return {draft,value};
}
const blob=(value:unknown)=>new Blob([JSON.stringify(value)],{type:'application/json'});
it('recovery matches unchanged content across local IDs without restoring approval or authentication',async()=>{
 const {draft,value}=await fixture(),moved={...draft,id:'new-id'};
 const result=await readRecovery(blob(value),moved);
 expect(result.bundle.inputKey).toContain('new-id');expect(result.bundle.files[0].sha256).toBe(value.bundle.files[0].sha256);
 expect(result).not.toHaveProperty('prepared');expect(result).not.toHaveProperty('csrfToken');
});
it('recovery rejects unapplied settings, changed draft, wrong hash, mock/old format and injected private fields',async()=>{
 const {draft,value}=await fixture();
 const pending=structuredClone(draft);pending.editor.scale=0.5;
 await expect(readRecovery(blob({...value,draftContentHash:await migrationContentHash(pending)}),pending)).rejects.toThrow('未適用');
 const changed=structuredClone(draft);changed.character.displayName='different';
 await expect(readRecovery(blob({...value,draftContentHash:await migrationContentHash(changed)}),changed)).rejects.toThrow('一致');
 for(const invalid of [{...value,mode:'mock'},{...value,format:'old'},{...value,csrfToken:'dummy-never-export'}, {...value,bundle:{...value.bundle,files:[{...value.bundle.files[0],sha256:'f'.repeat(64)}]}}])
   await expect(readRecovery(blob(invalid),draft)).rejects.toThrow();
});
it('untrusted package content hash cannot associate a different canonical character',async()=>{
 const {draft,value}=await fixture();
 draft.character.displayName='different';value.bundle.character={...draft.character};value.draftContentHash=await migrationContentHash(draft);
 await expect(readRecovery(blob(value),draft)).rejects.toThrow('正規レコード');
});
