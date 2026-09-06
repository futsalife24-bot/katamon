const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {publish,REPOSITORY} = require('../tools/registration/publisher.cjs');
const candidate = JSON.parse(fs.readFileSync('generated/content-studio-registration.json'));
const sha = 'a'.repeat(40);
function fixture() {
  const values = new Map(); let writes = 0, lose = null;
  const repository = {
    name:REPOSITORY, proveMerged:async sourceSha => ({merged:true,base:'master',sourceSha}),
    rebuild:async()=>candidate,verifyDeployedRuntime:async()=>true,deployment:async sourceSha => ({sourceSha,environment:'github-pages',state:'success'}),
    readDeployedCandidate:async()=>candidate,readDeployedAsset:async path=>fs.readFileSync(path),isAncestor:async()=>true,
  };
  const database = {
    applicationApproved:async()=>true,
    read:async path=>({value:values.get(path)??null,etag:JSON.stringify(values.get(path)??null)}),
    compareAndSet:async(path,etag,value)=>{
      assert.equal(JSON.stringify(values.get(path)??null),etag,'CAS'); values.set(path,structuredClone(value)); writes++;
      if (lose === path) { lose=null; throw new Error('response lost'); }
    },
  };
  return {repository,database,values,get writes(){return writes;},lose(path){lose=path;}};
}
test('default dry-run verifies actual deployed bytes without any database write',async()=>{
  const f=fixture(), result=await publish({...f,sourceSha:sha}); assert.equal(result.mode,'dry-run');assert.equal(f.writes,0);
});
for(const loss of ['active','candidate']) test(`activation reconciles lost ${loss} response and retry does not increment generation`,async()=>{
  const f=fixture();f.lose(loss==='candidate'?'revisions/'+candidate.registryRevision:'active');
  const first=await publish({...f,sourceSha:sha,apply:true,expectedActive:null});assert.equal(first.generation,1);
  const retry=await publish({...f,sourceSha:sha,apply:true,expectedActive:null});assert.equal(retry.changed,false);assert.equal(f.writes,2);
});
for(const fault of ['repo','unmerged','deploy-sha','deploy-host','runtime','content','asset','approval']) test(`publisher stops ${fault} before writes`,async()=>{
  const f=fixture();
  if(fault==='repo')f.repository.name='other/repo';
  if(fault==='unmerged')f.repository.proveMerged=async()=>({merged:false});
  if(fault==='deploy-sha')f.repository.deployment=async()=>({sourceSha:'b'.repeat(40),environment:'github-pages',state:'success'});
  if(fault==='deploy-host')f.repository.deployment=async()=>({sourceSha:sha,environment:'studio-host',state:'success'});
  if(fault==='content')f.repository.readDeployedCandidate=async()=>({...candidate,registryRevision:'c'.repeat(64)});
  if(fault==='runtime')f.repository.verifyDeployedRuntime=async()=>false;
  if(fault==='asset')f.repository.readDeployedAsset=async()=>Buffer.from('corrupted');
  if(fault==='approval')f.database.applicationApproved=async()=>false;
  await assert.rejects(publish({...f,sourceSha:sha,apply:true,expectedActive:null}));assert.equal(f.writes,0);
});
test('stale deployment and active CAS races leave previous active intact',async()=>{
  const f=fixture();const previous={registryRevision:'b'.repeat(64),generation:5,sourceSha:'c'.repeat(40)};f.values.set('active',previous);
  await assert.rejects(publish({...f,sourceSha:sha,apply:true,expectedActive:null}),/activeConflict/);
  f.repository.isAncestor=async()=>false;
  await assert.rejects(publish({...f,sourceSha:sha,apply:true,expectedActive:previous}),/staleDeployment/);
  assert.equal(f.writes,0);assert.deepEqual(f.values.get('active'),previous);
});
