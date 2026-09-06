// Test-only GitHub boundary. Real generated PNG -> validation -> RepositoryService
// -> reviewed fixture PR/merge -> committed candidate, used by the real Emulator test.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { RepositoryService } from '../../tools/content-studio/server/repository-service';
import { validateSubmission } from '../../tools/content-studio/server/validation';
import { FixtureRepository } from '../../tools/content-studio/tests/unit/repository-fake';
import { serverTestConfig, submittedFile } from '../../tools/content-studio/tests/unit/server-fixtures';
import registration from '../../shared/content-studio-registration.js';

async function main() {
  const input=JSON.parse(readFileSync(0,'utf8'));
  const canonical=input.files.find((file:any)=>file.path==='content/characters/registry-a.json');
  const record=JSON.parse(canonical.text), github=new FixtureRepository(), config=serverTestConfig();
  const bundle=validateSubmission({bundleId:'registration-browser-fixture',generatorVersion:record.generatorVersion,character:record.character,prBody:'Local generated registration acceptance fixture',files:input.files.map((file:any)=>submittedFile(file.path,file.mimeType,file.text!==undefined?Buffer.from(file.text):Buffer.from(file.base64,'base64')))},config);
  const service=new RepositoryService(config,github),actor='emulator-fixture-actor';
  const prepared=await service.prepare(bundle,actor);
  assert.ok(prepared.diff.includes('generated/content-studio-registration.json'));
  const pr=await service.createPullRequest(prepared.id,bundle,actor);
  assert.deepEqual(await service.createPullRequest(prepared.id,bundle,actor),pr);
  await assert.rejects(()=>service.mergePullRequest(prepared.id,pr.number,pr.commitSha,actor));
  github.checks='success';
  const merged=await service.mergePullRequest(prepared.id,pr.number,pr.commitSha,actor);
  assert.equal(merged.merged,true);assert.equal(github.commits,1);assert.equal(github.pullRequests,1);
  const commit=await github.getCommit(pr.commitSha),tree=await github.getTree(commit.treeSha);
  const file=tree.find(file=>file.path==='generated/content-studio-registration.json')!;
  const candidate=await registration.verify(JSON.parse((await github.getBlob(file.sha)).toString('utf8')));
  process.stdout.write(JSON.stringify({candidate,evidence:{validation:true,preparedDiff:true,prCount:github.pullRequests,commitCount:github.commits,queuedCiRejected:true,merged:true,mergeSha:merged.mergeCommitSha,treeSha:commit.treeSha}}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
