import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GitHubClient } from '../../server/github-api';
import { GITHUB_ACTIONS_APP_ID, REQUIRED_STUDIO_CHECKS, safeMergeProtection, requiredChecksFromProtection } from '../../server/ci-policy';
import { serverTestConfig } from './server-fixtures';

const head = 'a'.repeat(40);
const {privateKey} = generateKeyPairSync('rsa',{modulusLength:2048});
function harness() {
  const workflow = {id:20,head_sha:head,event:'pull_request',run_attempt:2,status:'completed',conclusion:'success',run_started_at:'2026-09-05T01:00:00Z'};
  const data = {
    runs: [workflow] as Record<string,unknown>[],
    jobs: REQUIRED_STUDIO_CHECKS.map((name,i) => ({name,id:i+1,head_sha:head,run_id:20,run_attempt:2,status:'completed',conclusion:'success',check_run_url:`https://api.github.invalid/check-runs/${i+1}`})) as Record<string,unknown>[],
    checks: REQUIRED_STUDIO_CHECKS.map((name,i) => ({name,id:i+1,head_sha:head,app:{id:GITHUB_ACTIONS_APP_ID},status:'completed',conclusion:'success'})) as Record<string,unknown>[],
    statuses: [] as Record<string,unknown>[],
    deployments: [] as Record<string,unknown>[],
    extraRuns: [] as Record<string,unknown>[],
    extraJobs: [] as Record<string,unknown>[],
  };
  const urls: string[] = [];
  const client = new GitHubClient(serverTestConfig({GITHUB_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString(),GITHUB_API_URL:'https://api.github.invalid'}), async input => {
    const url = new URL(String(input)); urls.push(url.toString());
    if (url.pathname.endsWith('access_tokens')) return Response.json({token:'dummy-installation-token',expires_at:'2030-01-01T00:00:00Z'});
    const page = Number(url.searchParams.get('page') ?? '1');
    const slice = (v: Record<string,unknown>[]) => v.slice((page-1)*100,page*100);
    if (url.pathname.endsWith('/actions/runs')) return Response.json({workflow_runs:slice(data.extraRuns)});
    if (url.pathname.includes('/runs/30/') || url.pathname.includes('/runs/31/')) return Response.json({jobs:slice(data.extraJobs)});
    if (url.pathname.endsWith('/runs')) return Response.json({workflow_runs:slice(data.runs)});
    if (url.pathname.endsWith('/jobs')) return Response.json({jobs:slice(data.jobs)});
    if (url.pathname.endsWith('/check-runs')) return Response.json({check_runs:slice(data.checks)});
    if (url.pathname.includes('/deployments/') && url.pathname.endsWith('/statuses')) return Response.json([{state:'success'}]);
    if (url.pathname.endsWith('/deployments')) return Response.json(data.deployments);
    if (url.pathname.endsWith('/statuses')) return Response.json(slice(data.statuses));
    return new Response('',{status:404});
  });
  return {client,data,urls};
}
const extraRequirements=['test','mobile-e2e'].map(context=>({context,appId:GITHUB_ACTIONS_APP_ID}));
function extras(data:ReturnType<typeof harness>['data']) {
 data.extraRuns=[{id:30,workflow_id:100,check_suite_id:300,head_sha:head,run_attempt:2,run_started_at:'2026-09-05T02:00:00Z',status:'completed',conclusion:'success'}];
 data.extraJobs=['test','mobile-e2e'].map((name,i)=>({id:3+i,name,run_id:30,run_attempt:2,head_sha:head,status:'completed',conclusion:'success',check_run_url:'https://api.github.invalid/check-runs/'+(i+3)}));
 data.checks.push(...data.extraJobs.map(j=>({...j,app:{id:GITHUB_ACTIONS_APP_ID},check_suite:{id:300}})));
}
describe('mandatory CI evidence', () => {
  it('R2 accepts successful additional required check-runs without commit statuses', async () => {
    const {client,data}=harness();
    extras(data);
    expect(await client.getChecks(head,extraRequirements)).toBe('success');
  });
  it.each(['missing','running','failure','cancelled','timed_out','skipped','neutral','wrong-source','wrong-sha','old-success','new-attempt'])('R2 additional required check: %s',async kind=>{
    const {client,data}=harness();extras(data);
    if(kind==='missing')data.checks=data.checks.filter(c=>c.name!=='test');
    else if(kind==='wrong-source')data.checks.find(c=>c.name==='test')!.app={id:77};
    else if(kind==='wrong-sha')data.checks.find(c=>c.name==='test')!.head_sha='b'.repeat(40);
    else if(kind==='new-attempt'){data.extraRuns[0].run_attempt=3;data.extraJobs=[];}
    else if(kind==='old-success'){data.extraRuns.push({...data.extraRuns[0],id:31,run_attempt:1,status:'queued',conclusion:null});data.extraJobs=[];}
    else if(kind==='running')data.extraJobs[0].status='in_progress';
    else data.extraJobs[0].conclusion=kind;
    expect(await client.getChecks(head,extraRequirements)).not.toBe('success');
  });
  it.each(['success','pending','failure'])('R2 additional status and same-name check require both: %s',async state=>{
    const {client,data}=harness();
    data.checks.push({id:33,name:'external',head_sha:head,app:{id:77},status:'completed',conclusion:'success'});
    data.statuses=[{id:1,context:'external',url:'https://api.github.invalid/statuses/'+head,state}];
    expect(await client.getChecks(head,[{context:'external',appId:null}])).toBe(state==='success'?'success':state==='pending'?'queued':'failure');
    await expect(client.getChecks(head,[{context:'external',appId:77}])).rejects.toMatchObject({code:'required_checks_unsupported'});
  });
  it('R2 pages extra jobs/checks/runs and rejects ambiguous sources',async()=>{
    const {client,data,urls}=harness();extras(data);
    data.extraRuns.unshift(...Array.from({length:100},(_,i)=>({id:1000+i,workflow_id:1000+i,head_sha:head})));
    data.extraJobs.unshift(...Array.from({length:100},(_,i)=>({id:1000+i,name:'unrelated'})));
    data.checks.unshift(...Array.from({length:100},(_,i)=>({id:1000+i,name:'unrelated'})));
    expect(await client.getChecks(head,extraRequirements)).toBe('success');
    expect(urls.filter(u=>u.includes('page=2')).length).toBeGreaterThanOrEqual(3);
    data.checks.push({id:99,name:'test',head_sha:head,app:{id:77},status:'completed',conclusion:'success'});
    await expect(client.getChecks(head,[{context:'test',appId:null}])).rejects.toMatchObject({code:'required_checks_unsupported'});
  });
  it('R2 preserves configured source and rejects malformed settings',()=>{
    expect(requiredChecksFromProtection({required_status_checks:{contexts:['test','legacy'],checks:[{context:'test',app_id:15368}]}})).toEqual([{context:'test',appId:15368},{context:'legacy',appId:null}]);
    expect(()=>requiredChecksFromProtection({required_status_checks:{contexts:[],checks:[{context:'test'}]}})).toThrow();
    expect(()=>requiredChecksFromProtection({required_status_checks:{contexts:[],checks:[{context:'test',app_id:1},{context:'test',app_id:2}]}})).toThrow();
  });
  it.each(['success','pending','failure','absent'])('R2 status-only requirement: %s',async state=>{
    const {client,data}=harness();
    if(state!=='absent')data.statuses=[{id:4,context:'status-only',url:'https://api.github.invalid/statuses/'+head,state}];
    expect(await client.getChecks(head,[{context:'status-only',appId:null}])).toBe(state==='success'?'success':state==='failure'?'failure':'queued');
  });
  it('R2 accepts explicit unbound null and -1 source responses',()=>{
    for(const app_id of [null,-1])expect(requiredChecksFromProtection({required_status_checks:{contexts:['status-only'],checks:[{context:'status-only',app_id}]}})).toEqual([{context:'status-only',appId:null}]);
  });
  it('R2 queued check with no start timestamp cannot reuse an older success',async()=>{
    const {client,data}=harness();
    data.checks.push({id:4,name:'external',head_sha:head,app:{id:77},status:'completed',conclusion:'success',started_at:'2026-09-05T00:00:00Z'});
    data.checks.push({id:5,name:'external',head_sha:head,app:{id:77},status:'queued',conclusion:null,started_at:null});
    expect(await client.getChecks(head,[{context:'external',appId:77}])).toBe('queued');
  });
  it('R2 non-Actions latest rerun replaces an old success',async()=>{
    const {client,data}=harness();
    data.checks.push({id:4,name:'external',head_sha:head,app:{id:77},status:'completed',conclusion:'success',created_at:'2026-09-05T00:00:00Z'});
    data.checks.push({id:5,name:'external',head_sha:head,app:{id:77},status:'in_progress',conclusion:null,created_at:'2026-09-05T01:00:00Z'});
    expect(await client.getChecks(head,[{context:'external',appId:77}])).toBe('running');
    data.checks[3].status='completed';data.checks[3].conclusion='failure';
    expect(await client.getChecks(head,[{context:'external',appId:77}])).toBe('failure');
  });
  it('requires the deployed merge SHA and Pages environment', async () => {
    const {client,data} = harness();
    data.deployments = [{id:3,sha:'b'.repeat(40),environment:'github-pages'},{id:2,sha:head,environment:'preview'}];
    expect(await client.getDeployment(head)).toBe('unknown');
    data.deployments.push({id:1,sha:head,environment:'github-pages'});
    expect(await client.getDeployment(head)).toBe('published');
  });
  it('accepts documented jobs without run_attempt only from the exact attempt endpoint', async () => {
    const {client,data}=harness(); for (const job of data.jobs) delete job.run_attempt;
    expect(await client.getChecks(head)).toBe('success');
  });
  it('uses the exact names in the actual workflow', () => {
    const yaml=readFileSync(new URL('../../../../.github/workflows/content-studio.yml',import.meta.url),'utf8');
    for (const name of REQUIRED_STUDIO_CHECKS) expect(yaml).toContain(`name: ${name}`);
  });
  it('accepts only the exact head and latest attempt with both successful jobs', async () => {
    const {client,urls} = harness(); expect(await client.getChecks(head)).toBe('success');
    expect(urls.some(url=>url.includes('/attempts/2/jobs'))).toBe(true);
  });
  it.each(['zero-checks','one-job','delayed-job','no-run','new-run','old-attempt','other-sha','wrong-app','duplicate-name'])('does not pass %s', async kind => {
    const {client,data}=harness();
    if (kind==='zero-checks') data.checks=[];
    if (kind==='one-job') data.jobs.pop();
    if (kind==='delayed-job') data.jobs[1].status='queued';
    if (kind==='no-run') data.runs=[];
    if (kind==='new-run') data.runs.push({...data.runs[0],id:21,status:'queued',conclusion:null});
    if (kind==='old-attempt') data.jobs[0].run_attempt=1;
    if (kind==='other-sha') data.checks[0].head_sha='b'.repeat(40);
    if (kind==='wrong-app') data.checks[0].app={id:123};
    if (kind==='duplicate-name') data.jobs.push({...data.jobs[0],id:3});
    expect(await client.getChecks(head)).not.toBe('success');
  });
  it.each(['skipped','neutral','cancelled','timed_out','failure','action_required','stale'])('rejects important job conclusion %s', async conclusion => {
    const {client,data}=harness(); data.jobs[1].conclusion=conclusion; expect(await client.getChecks(head)).toBe('failure');
  });
  it('paginates checks, jobs and statuses and uses latest context result', async () => {
    const {client,data,urls}=harness();
    data.checks.unshift(...Array.from({length:100},(_,i)=>({id:100+i,name:'extra'})));
    data.jobs.unshift(...Array.from({length:100},(_,i)=>({id:100+i,name:'extra'})));
    data.statuses=[{id:1,context:'external-review',url:`https://api.github.invalid/statuses/${head}`,state:'failure'},{id:2,context:'external-review',url:`https://api.github.invalid/statuses/${head}`,state:'success'}];
    expect(await client.getChecks(head,[{context:'external-review',appId:null}])).toBe('success');
    expect(urls.filter(u=>u.includes('page=2')).length).toBeGreaterThanOrEqual(2);
    data.statuses.unshift(...Array.from({length:100},(_,i)=>({id:100+i,context:'other',url:`https://api.github.invalid/statuses/${head}`,state:'success'})));
    expect(await client.getChecks(head,[{context:'external-review',appId:null}])).toBe('success');
    expect(urls.some(u=>u.includes('/statuses?') && u.includes('page=2'))).toBe(true);
    data.statuses.splice(0,100);
    data.statuses[1].state='pending'; expect(await client.getChecks(head,[{context:'external-review',appId:null}])).toBe('queued');
  });
  it('requires configured status contexts and fails closed when protection cannot be read', async () => {
    const {client}=harness(); expect(await client.getChecks(head,[{context:'absent-context',appId:null}])).toBe('queued');
    expect((await client.getMergeProtection()).safe).toBe(false);
  });
  it('requires strict base, enforced admins and GitHub Actions app binding with no bypass', () => {
    const p={allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:REQUIRED_STUDIO_CHECKS.map(context=>({context,app_id:GITHUB_ACTIONS_APP_ID}))}};
    expect(safeMergeProtection(p)).toBe(true);
    expect(safeMergeProtection({...p,enforce_admins:{enabled:false}})).toBe(false);
    expect(safeMergeProtection({...p,required_status_checks:{...p.required_status_checks,strict:false}})).toBe(false);
    expect(safeMergeProtection({...p,required_pull_request_reviews:{bypass_pull_request_allowances:{apps:[{}]}}})).toBe(false);
    expect(safeMergeProtection({...p,allow_force_pushes:undefined})).toBe(false);
    expect(safeMergeProtection({...p,allow_deletions:{enabled:true}})).toBe(false);
    expect(safeMergeProtection(null)).toBe(false);
  });
});
