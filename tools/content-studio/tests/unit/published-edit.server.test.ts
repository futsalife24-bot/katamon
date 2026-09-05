import {LEGACY_CHARACTERS,getLegacyRepositoryIdentity} from '../../src/domain/legacy-characters';
import {describe, expect, it} from 'vitest';
import {RepositoryService} from '../../server/repository-service';
import {validateSubmission} from '../../server/validation';
import {FixtureRepository} from './repository-fake';
import {serverTestConfig, submittedFile, validatedBundle} from './server-fixtures';
import {decodePublishedResponse, buildInformationBundle} from '../../src/generation/published-edit';
import {serializeBundle} from '../../src/github/server-gateway';
import type {ValidatedBundle} from '../../server/types';
const config=serverTestConfig();
function rename(value:ValidatedBundle,name:string,revision?:ValidatedBundle['sourceRevision']){
  return validateSubmission({...value,sourceRevision:revision,bundleId:`edited-${name.replaceAll(' ','-')}`,character:{...value.character,displayName:name},files:value.files.map(f=>submittedFile(f.path,f.mimeType,f.path.startsWith('content/characters/')?Buffer.from(JSON.stringify({...JSON.parse(f.bytes.toString()),character:{...JSON.parse(f.bytes.toString()).character,displayName:name}})):f.bytes))},config);
}
async function setup(){
  const repo=new FixtureRepository(),service=new RepositoryService(config,repo);
  const fixture=validatedBundle();
  const initial=validateSubmission({...fixture,files:fixture.files.map(f=>{const bytes=Buffer.from(f.bytes);if(f.mimeType==='image/png'){bytes.write('IHDR',12);bytes[24]=8;bytes[25]=6;}return submittedFile(f.path,f.mimeType,bytes);})},config);
  const prepared=await service.prepare(initial,'123'),pr=await service.createPullRequest(prepared.id,initial,'123');repo.advanceTo(pr.commitSha);
  return {repo,service,initial};
}
it('refuses an existing character update without a verified editing-start revision',async()=>{
  const {repo,service,initial}=await setup();
  await expect(service.prepare(rename(initial,'Edited elsewhere'),'123')).rejects.toMatchObject({code:'published_revision_required'});
  expect(repo.branches).toHaveLength(1);expect(repo.pullRequests).toBe(1);
});
it('fixed read verifies canonical blob and every file, then information edit preserves old assets and special settings',async()=>{
  const {repo,service}=await setup(),wire=await service.readPublishedCharacter('sample-unit','123');
  const snapshot=await decodePublishedResponse(wire,false);
  expect(snapshot.revision.baseSha).toBe(repo.baseSha);expect(snapshot.revision.canonicalBlobSha).toBe(repo.tree.find(e=>e.path==='content/characters/sample-unit.json')!.sha);
  const unchanged=await buildInformationBundle(snapshot,snapshot.record.character),counts=[repo.commits,repo.pullRequests,repo.branches.length];
  expect(unchanged.noChanges).toBe(true);
  await expect(service.prepare(validateSubmission(await serializeBundle(unchanged),config),'123')).rejects.toMatchObject({code:'no_changes'});
  expect([repo.commits,repo.pullRequests,repo.branches.length]).toEqual(counts);
  const renamed=await buildInformationBundle(snapshot,{...snapshot.record.character,displayName:'Only a name',description:'Only description'});
  expect(renamed.files.filter(f=>!f.path.startsWith('content/characters/'))).toEqual(unchanged.files.filter(f=>!f.path.startsWith('content/characters/')));
  expect(renamed.character.specialEnabled).toBe(snapshot.record.character.specialEnabled);expect(renamed.character.specialTemplate).toBe(snapshot.record.character.specialTemplate);
  const value=validateSubmission(await serializeBundle(renamed),config),p=await service.prepare(value,'123'),result=await service.createPullRequest(p.id,value,'123');repo.advanceTo(result.commitSha);
  const reread=await service.readPublishedCharacter('sample-unit','123');expect(reread.record.character.displayName).toBe('Only a name');expect(reread.record.assets).toEqual(wire.record.assets);
  expect(reread.files.filter(f=>!f.path.startsWith('content/characters/'))).toEqual(wire.files.filter(f=>!f.path.startsWith('content/characters/')));
});
it('A edit-start revision survives unrelated B addition and rejects a concurrent A update',async()=>{
  const {repo,service,initial}=await setup(),read=await service.readPublishedCharacter('sample-unit','123');
  const b=validateSubmission({...initial,bundleId:'unit-b',character:{...initial.character,id:'unit-b',slug:'unit-b'},files:initial.files.map(f=>submittedFile(f.path.replaceAll('sample-unit','unit-b'),f.mimeType,f.mimeType==='application/json'?Buffer.from(f.bytes.toString().replaceAll('sample-unit','unit-b')):f.bytes))},config);
  const pb=await service.prepare(b,'123'),prb=await service.createPullRequest(pb.id,b,'123');repo.advanceTo(prb.commitSha);const preserved=repo.tree.filter(e=>e.path.includes('unit-b'));
  const update=rename(initial,'A updated',read.revision),p=await service.prepare(update,'123'),pr=await service.createPullRequest(p.id,update,'123');repo.advanceTo(pr.commitSha);
  expect(repo.tree.filter(e=>e.path.includes('unit-b'))).toEqual(preserved);
  const counts=[repo.commits,repo.pullRequests,repo.branches.length];
  await expect(service.prepare(rename(initial,'Stale A',read.revision),'123')).rejects.toMatchObject({code:'published_target_conflict'});
  expect([repo.commits,repo.pullRequests,repo.branches.length]).toEqual(counts);
});
it.each(['actor','repository','sha','signature','mode'])('rejects forged source %s before any write',async(kind)=>{
  const {repo,service,initial}=await setup(),{revision}=await service.readPublishedCharacter('sample-unit','123');
  if(kind==='repository')revision.repository='other/repository';if(kind==='sha')revision.canonicalBlobSha='0'.repeat(40);if(kind==='signature')revision.attestation='0'.repeat(64);if(kind==='mode')revision.mode='mock';
  await expect(service.prepare(rename(initial,'Forged',revision),kind==='actor'?'456':'123')).rejects.toMatchObject({code:'published_revision_invalid'});
  expect(repo.branches).toHaveLength(1);expect(repo.pullRequests).toBe(1);
});
it.each(['missing','hash','metadata','path','too-large'])('public read rejects %s; no partial result is returned',async(kind)=>{
  const {repo,service}=await setup();
  if(kind==='path'){await expect(service.readPublishedCharacter('../sample-unit','123')).rejects.toMatchObject({code:'published_slug_invalid'});return;}
  const entry=repo.tree.find(e=>e.path.endsWith(kind==='metadata'?'idle.json':'icon.png'))!;
  if(kind==='missing')repo.blobData.delete(entry.sha);
  if(kind==='hash'||kind==='metadata')repo.blobData.set(entry.sha,Buffer.from('invalid'));
  if(kind==='too-large'){const commit=await repo.getCommit(repo.baseSha);repo.treeData.get(commit.treeSha)!.find(e=>e.path===entry.path)!.size=config.maxFileBytes+1;}
  await expect(service.readPublishedCharacter('sample-unit','123')).rejects.toBeDefined();expect(repo.pullRequests).toBe(1);
});
it('restart and response-loss retries use the same information operation',async()=>{
  const {repo,service,initial}=await setup(),{revision}=await service.readPublishedCharacter('sample-unit','123'),value=rename(initial,'Recovered',revision);
  const p=await service.prepare(value,'123');repo.fault='pr';const recovered=await service.createPullRequest(p.id,value,'123');expect(recovered.number).toBe(43);expect(repo.fault).toBeNull();
  const restarted=new RepositoryService(config,repo),again=await restarted.prepare(value,'123');
  expect(again.recovered?.number).toBe(43);await restarted.createPullRequest(again.id,value,'123');expect(repo.pullRequests).toBe(2);expect(repo.branches).toHaveLength(2);
});

it.each(LEGACY_CHARACTERS)('legacy $id read retains its game target and storage identity; non-motion edits are refused',async legacy=>{
  const repo=new FixtureRepository(),service=new RepositoryService(config,repo),original=validatedBundle(),identity=getLegacyRepositoryIdentity(legacy.id);
  const files=original.files.map(f=>{
    const path=f.path.replaceAll('sample-unit',identity.slug);let bytes=f.mimeType==='application/json'?Buffer.from(f.bytes.toString().replaceAll('sample-unit',identity.slug)):f.bytes;
    if(path.startsWith('content/characters/')){const record=JSON.parse(bytes.toString());record.legacyTargetId=legacy.id;record.character.id=identity.id;record.character.displayName=legacy.displayName;bytes=Buffer.from(JSON.stringify(record));}
    return submittedFile(path,f.mimeType,bytes);
  });
  const initial=validateSubmission({...original,bundleId:identity.slug,character:{...identity,displayName:legacy.displayName},files},config),p=await service.prepare(initial,'123'),pr=await service.createPullRequest(p.id,initial,'123');repo.advanceTo(pr.commitSha);
  const read=await service.readPublishedCharacter(identity.slug,'123');expect(read.record.legacyTargetId).toBe(legacy.id);expect(read.record.character.id).toBe(identity.id);expect(read.record.character.slug).toBe(identity.slug);
  await expect(service.prepare(rename(initial,'Changed legacy',read.revision),'123')).rejects.toMatchObject({code:'snapshot_invalid'});expect(repo.pullRequests).toBe(1);
});

it('listing distinguishes a broken canonical from a normal empty list and a transport failure',async()=>{
  const {repo,service}=await setup();expect(await service.listPublishedCharacters()).toMatchObject({failed:0,records:[expect.anything()]});
  const entry=repo.tree.find(e=>e.path==='content/characters/sample-unit.json')!;repo.blobData.set(entry.sha,Buffer.from('broken'));
  expect(await service.listPublishedCharacters()).toMatchObject({failed:1,records:[]});
  const empty=new RepositoryService(config,new FixtureRepository());expect(await empty.listPublishedCharacters()).toMatchObject({failed:0,records:[]});
  repo.getBaseSha=async()=>{throw new Error('fixture offline');};await expect(service.listPublishedCharacters()).rejects.toThrow('fixture offline');
});
