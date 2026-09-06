import {it,expect} from 'vitest';
import {RepositoryService} from '../../server/repository-service';
import {FixtureRepository} from './repository-fake';
import {serverTestConfig,validatedBundle} from './server-fixtures';

it('read-only recovery across restart revalidates actor, repository, base, head and signed frozen tree',async()=>{
 const config=serverTestConfig(),repo=new FixtureRepository(),service=new RepositoryService(config,repo),bundle=validatedBundle();
 const prepared=await service.prepare(bundle,'123'),pr=await service.createPullRequest(prepared.id,bundle,'123');
 const hint={repository:`${config.githubOwner}/${config.githubRepo}`,branch:prepared.branch,baseSha:prepared.baseSha,headSha:pr.commitSha,pullRequestNumber:pr.number,operationDigest:prepared.operationDigest};
 const restarted=new RepositoryService(config,repo);
 const before={commits:repo.commits,prs:repo.pullRequests,branches:[...repo.branches]};
 for(let i=0;i<2;i++){const result=await restarted.recover(bundle,'123',hint);expect(result.recovered?.number).toBe(pr.number);expect(result.id).not.toBe(prepared.id);}
 for(const wrong of [{...hint,repository:'other/repo'},{...hint,headSha:'f'.repeat(40)},{...hint,baseSha:'e'.repeat(40)},{...hint,operationDigest:'d'.repeat(64)}])await expect(restarted.recover(bundle,'123',wrong)).rejects.toThrow();
 await expect(restarted.recover(bundle,'another',hint)).rejects.toThrow();
 await expect(new RepositoryService({...config,sessionSecret:'different-stable-key-at-least-32-characters'},repo).recover(bundle,'123',hint)).rejects.toThrow();
 expect({commits:repo.commits,prs:repo.pullRequests,branches:[...repo.branches]}).toEqual(before);
});
it('missing PR does not turn a recovery hint into new preparation or Git writes',async()=>{
 const config=serverTestConfig(),repo=new FixtureRepository(),service=new RepositoryService(config,repo),bundle=validatedBundle();
 const p=await service.prepare(bundle,'123');
 await expect(service.recover(bundle,'123',{repository:`${config.githubOwner}/${config.githubRepo}`,branch:p.branch,baseSha:p.baseSha,operationDigest:p.operationDigest})).rejects.toMatchObject({code:'recovery_pr_missing'});
 expect(repo.commits).toBe(0);expect(repo.branches).toHaveLength(0);
});
