import { describe, expect, it, vi } from 'vitest';
import { RepositoryService } from '../../server/repository-service';
import { reconstructSnapshot, trustedFile } from '../../server/snapshot';
import { validateSubmission } from '../../server/validation';
import { FixtureRepository } from './repository-fake';
import { serverTestConfig, submittedFile, validatedBundle } from './server-fixtures';
import type { ValidatedBundle } from '../../server/types';

function bundle(slug = 'unit-a', version = '0123456789ab'): ValidatedBundle {
  const original = validatedBundle();
  const files = original.files.map(f => {
    const path = f.path.replaceAll('sample-unit', slug).replaceAll('0123456789ab', version);
    const bytes = f.mimeType === 'application/json' ? Buffer.from(f.bytes.toString().replaceAll('sample-unit', slug).replaceAll('0123456789ab', version)) : f.bytes;
    return submittedFile(path, f.mimeType, bytes);
  });
  return validateSubmission({ ...original, bundleId: slug + version, character: { ...original.character, id: slug, slug }, files }, serverTestConfig());
}
async function publish(repo: FixtureRepository, value: ValidatedBundle) {
  const service = new RepositoryService(serverTestConfig(), repo);
  const prepared = await service.prepare(value, '123');
  return { service, prepared, result: await service.createPullRequest(prepared.id, value, '123') };
}
describe('fixed GitHub snapshot and durable reconciliation', () => {
  it('A add → B add → A update preserves B canonical and every B asset, even when Pages is stale', async () => {
    const repo = new FixtureRepository();
    const a = await publish(repo, bundle()); repo.advanceTo(a.result.commitSha);
    const b = await publish(repo, bundle('unit-b')); repo.advanceTo(b.result.commitSha);
    const preserved = repo.tree.filter(e => e.path.includes('unit-b'));
    const update = bundle('unit-a', 'abcdef012345');
    const result = await publish(repo, update); repo.advanceTo(result.result.commitSha);
    expect(repo.tree.filter(e => e.path.includes('unit-b'))).toEqual(preserved);
    const manifest = JSON.parse((await repo.getBlob(repo.tree.find(e => e.path.endsWith('manifest.json'))!.sha)).toString());
    expect(manifest.characters.map((c: {id: string}) => c.id)).toEqual(['unit-a','unit-b']);
    const regenerated = await reconstructSnapshot(update, repo.tree, sha => repo.getBlob(sha), serverTestConfig());
    expect(regenerated.every(f => repo.tree.find(e => e.path === f.path)?.sha === f.gitBlobSha)).toBe(true);
  });
  it('rejects a submitted aggregate that deletes another character', async () => {
    const repo = new FixtureRepository(); const b = await publish(repo, bundle('unit-b')); repo.advanceTo(b.result.commitSha);
    const a = bundle();
    a.files.push(trustedFile('generated/content-studio-manifest.json', 'application/json', Buffer.from('{"schemaVersion":1,"characters":[]}')));
    await expect(new RepositoryService(serverTestConfig(),repo).prepare(a,'123')).rejects.toMatchObject({ code: 'snapshot_invalid' });
    expect(repo.pullRequests).toBe(1);
  });
  it.each(['missing-reference','metadata-mismatch','dimensions-mismatch','foreign-image','foreign-file','invalid-base','case-collision','id-collision','immutable-overwrite'])('rejects %s without a branch write', async kind => {
    const repo = new FixtureRepository(); const value = bundle();
    if (kind === 'missing-reference') value.files = value.files.filter(f => !f.path.endsWith('character.webp'));
    if (kind === 'dimensions-mismatch') value.files = value.files.map(f => { if (!f.path.endsWith('idle.png')) return f; const bytes = Buffer.from(f.bytes); bytes.writeUInt32BE(1,16); return trustedFile(f.path,f.mimeType,bytes); });
    if (kind === 'metadata-mismatch') value.files = value.files.map(f => f.path.endsWith('idle.json') ? trustedFile(f.path, f.mimeType, Buffer.from('{}')) : f);
    if (kind === 'foreign-image') value.files = value.files.map(f => f.path.startsWith('content/') ? trustedFile(f.path,f.mimeType,Buffer.from(f.bytes.toString().replace('/unit-a/','/unit-b/'))) : f);
    if (kind === 'foreign-file') value.files.push(trustedFile('content/characters/unit-b.json','application/json',value.files[0].bytes));
    if (kind === 'invalid-base') { const f = trustedFile('content/characters/broken.json','application/json',Buffer.from('{}')); repo.tree.push({path:f.path,sha:f.gitBlobSha,type:'blob',mode:'100644'}); repo.blobData.set(f.gitBlobSha,f.bytes); }
    if (kind === 'case-collision') repo.tree.push({path:'content/characters/UNIT-A.json',sha:'a'.repeat(40),type:'blob',mode:'100644'});
    if (kind === 'id-collision') {
      const b = await publish(repo,bundle('unit-b')); repo.advanceTo(b.result.commitSha);
      value.files[0] = trustedFile(value.files[0].path,value.files[0].mimeType,Buffer.from(value.files[0].bytes.toString().replace('"id":"unit-a"','"id":"unit-b"')));
    }
    if (kind === 'immutable-overwrite') {
      const a = await publish(repo,value); repo.advanceTo(a.result.commitSha);
      const f = value.files.find(f => f.path.endsWith('icon.png'))!;
      value.files = value.files.map(v => v === f ? trustedFile(v.path,v.mimeType,Buffer.concat([v.bytes,Buffer.from('different')])) : v);
    }
    const before = repo.branches.length;
    await expect(new RepositoryService(serverTestConfig(),repo).prepare(value,'123')).rejects.toThrow();
    expect(repo.branches.length).toBe(before);
  });
  it.each(['branch','pr'] as const)('reconciles lost %s response and concurrent submission across two server instances', async fault => {
    const repo = new FixtureRepository(); repo.fault = fault;
    const value = bundle();
    const first = new RepositoryService(serverTestConfig(),repo), second = new RepositoryService(serverTestConfig(),repo);
    const p1 = await first.prepare(value,'123'), p2 = await second.prepare(value,'123');
    const results = await Promise.all([first.createPullRequest(p1.id,value,'123'), first.createPullRequest(p1.id,value,'123'), second.createPullRequest(p2.id,value,'123')]);
    expect(new Set(results.map(r => r.number)).size).toBe(1);
    expect(repo.branches).toHaveLength(1); expect(repo.pullRequests).toBe(1);
    expect((await repo.getCommit(results[0].commitSha)).parents).toEqual(['a'.repeat(40)]);
  });
  it('recovers after expiry, restart and renewed authentication without regenerating assets', async () => {
    const repo = new FixtureRepository(); let now = 100;
    const service = new RepositoryService(serverTestConfig(),repo,{now:()=>now}); const value = bundle();
    const p = await service.prepare(value,'123'); const result = await service.createPullRequest(p.id,value,'123');
    now += 31 * 60 * 1000;
    await expect(service.createPullRequest(p.id,value,'123')).rejects.toMatchObject({code:'preparation_expired'});
    const restarted = new RepositoryService(serverTestConfig(),repo);
    const recovered = await restarted.prepare({...value,recoveryBranch:p.branch},'123');
    expect(recovered.recovered?.number).toBe(result.number);
    expect((await restarted.createPullRequest(recovered.id,value,'123')).commitSha).toBe(result.commitSha);
    expect(repo.pullRequests).toBe(1);
    await expect(restarted.prepare({...value,recoveryBranch:p.branch},'another-user')).rejects.toMatchObject({code:'recovery_actor_mismatch'});
    await expect(new RepositoryService(serverTestConfig({GITHUB_REPO:'different-repo'}),repo).prepare({...value,recoveryBranch:p.branch},'123')).rejects.toThrow();
  });
  it('repeated recovery does not exhaust cached preparations', async () => {
    const repo = new FixtureRepository(); const value = bundle();
    const {service,result} = await publish(repo,value);
    for (let i=0;i<20;i++) expect((await service.prepare(value,'123')).recovered?.number).toBe(result.number);
    expect(repo.pullRequests).toBe(1);
  });
  it('lost merge response recovers the squash SHA; never marks a head deployment published', async () => {
    const repo = new FixtureRepository(); repo.checks = 'success';
    const {service,prepared,result} = await publish(repo,bundle()); repo.fault = 'merge';
    const merged = await service.mergePullRequest(prepared.id,result.number,result.commitSha,'123');
    expect(merged.merged).toBe(true); expect(merged.mergeCommitSha).toBe('f'.repeat(40));
    expect(repo.deploymentRefs).toEqual(['f'.repeat(40)]);
    await service.mergePullRequest(prepared.id,result.number,result.commitSha,'123'); expect(repo.merges).toBe(1);
  });
  it.each(['base','head','repo','protection','checks','result-sha'])('blocks merge on %s drift or missing evidence', async kind => {
    const repo = new FixtureRepository(); repo.checks = 'success';
    const {service,prepared,result} = await publish(repo,bundle());
    if (kind === 'base') repo.baseSha = '9'.repeat(40);
    if (kind === 'head') repo.refs.set(prepared.branch,'9'.repeat(40));
    if (kind === 'protection') repo.safe = false;
    if (kind === 'checks') repo.checks = 'queued';
    if (kind === 'repo') { const original = repo.getPullRequest.bind(repo); vi.spyOn(repo,'getPullRequest').mockImplementation(async n => ({...await original(n), headRepo:'intruder/repo'})); }
    await expect(service.mergePullRequest(prepared.id,result.number,kind === 'result-sha' ? '9'.repeat(40) : result.commitSha,'123')).rejects.toThrow();
    expect(repo.merges).toBe(0); expect(repo.pullRequests).toBe(1);
  });
});

function successor(value:ValidatedBundle,prepared:Awaited<ReturnType<RepositoryService['prepare']>>,headSha:string,targetBaseSha:string):ValidatedBundle {
 return validateSubmission({...value,recoveryBranch:undefined,revalidation:{branch:prepared.branch,headSha,baseSha:prepared.baseSha,digest:prepared.operationDigest,targetBaseSha},files:value.files.map(f=>submittedFile(f.path,f.mimeType,f.bytes))},serverTestConfig());
}
describe('R3 explicit latest-base successor',()=>{
 it('retains old PR, images and B; successor retries/restart converge without force updates',async()=>{
  const repo=new FixtureRepository(), value=bundle();
  const old=await publish(repo,value);
  const b=await publish(repo,bundle('unit-b'));repo.advanceTo(b.result.commitSha);
  const bFiles=repo.tree.filter(e=>e.path.includes('unit-b'));
  const restored=await old.service.prepare(value,'123');
  expect(restored.recovered?.number).toBe(old.result.number);expect(repo.pullRequests).toBe(2);
  const next=successor(value,restored,old.result.commitSha,repo.baseSha);
  const prepared=await old.service.prepare(next,'123');
  expect(prepared.baseSha).toBe(repo.baseSha);expect(prepared.branch).not.toBe(old.prepared.branch);
  expect(prepared.predecessor?.number).toBe(old.result.number);
  expect(prepared.changedFiles.find(f=>f.path.endsWith('manifest.json'))!.text).toContain('unit-b');
  expect(next.files.filter(f=>f.mimeType.startsWith('image/')).map(f=>f.sha256)).toEqual(value.files.filter(f=>f.mimeType.startsWith('image/')).map(f=>f.sha256));
  const made=await old.service.createPullRequest(prepared.id,next,'123');
  const restarted=new RepositoryService(serverTestConfig(),repo);
  const recovered=await restarted.prepare({...next,recoveryBranch:prepared.branch},'123');
  expect((await restarted.createPullRequest(recovered.id,next,'123')).number).toBe(made.number);
  expect(repo.pullRequests).toBe(3);expect(repo.refs.get(old.prepared.branch)).toBe(old.result.commitSha);
  expect((await repo.getPullRequest(old.result.number)).state).toBe('open');
  const tree=await repo.getTree((await repo.getCommit(made.commitSha)).treeSha);
  expect(tree.filter(e=>e.path.includes('unit-b'))).toEqual(bFiles);
  expect(made.checks).toBe('queued');
 });
 it.each(['target','actor','head','digest','base'])('stops conflicting or forged successor %s',async kind=>{
  const repo=new FixtureRepository(),value=bundle();const old=await publish(repo,value);
  const concurrent=await publish(repo,bundle(kind==='target'?'unit-a':'unit-b','abcdef123456'));repo.advanceTo(concurrent.result.commitSha);
  const next=successor(value,old.prepared,old.result.commitSha,repo.baseSha);
  if(kind==='head')next.revalidation!.headSha='9'.repeat(40);
  if(kind==='digest')next.revalidation!.digest='9'.repeat(64);
  if(kind==='base')next.revalidation!.targetBaseSha='9'.repeat(40);
  await expect(new RepositoryService(serverTestConfig(),repo).prepare(next,kind==='actor'?'other':'123')).rejects.toThrow();
  expect(repo.pullRequests).toBe(2);expect(repo.refs.get(old.prepared.branch)).toBe(old.result.commitSha);
 });
});
