const registryStorage=require('../shared/content-studio-registration.js').storage;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const project = 'demo-catamon-registration';
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:19000'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19099'
    || process.env.GCLOUD_PROJECT !== project) throw new Error('Explicit demo loopback Emulator environment is required');
const results = [];
const candidate = JSON.parse(fs.readFileSync('generated/content-studio-registration.json'));
const revision = candidate.registryRevision;
async function request(path, method, data, identity = null) {
  const url = new URL(`http://127.0.0.1:19000/${path}.json`); url.searchParams.set('ns', project + '-default-rtdb');
  if (identity && identity !== 'fixture-admin') url.searchParams.set('auth', identity);
  const response = await fetch(url, { method, signal:AbortSignal.timeout(10000), headers: { 'Content-Type':'application/json', ...(identity === 'fixture-admin' ? { Authorization:'Bearer owner' } : {}) }, ...(data !== undefined ? { body:JSON.stringify(data) } : {}) });
  const body = await response.json(); return { status:response.status, body };
}
async function user() {
  const response = await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ returnSecureToken:true }),signal:AbortSignal.timeout(10000) });
  assert.equal(response.status,200); return response.json();
}
async function expect(name, promise, allowed) {
  const result = await promise;
  if (allowed) assert.equal(result.status,200,name);
  else { assert.equal(result.status,401,name); assert.match(result.body.error,/Permission denied/i,name); }
  results.push({ name, boundary:'Realtime Database Rules', expected:allowed ? 'allow':'deny', status:result.status });
}
async function main() {
  const loadedRules = await request('.settings/rules','GET',undefined,'fixture-admin');
  assert.equal(loadedRules.status,200);
  assert.deepEqual(loadedRules.body, JSON.parse(fs.readFileSync('database.rules.json')), 'Emulator must serve the actual repository Rules');
  const host = await user(), guest = await user();
  // Admin is confined to immutable fixture setup, never a normal-user assertion.
  assert.equal((await request('characterRegistry','PUT',{ revisions:{ [revision]:registryStorage(candidate) },active:{ registryRevision:revision,generation:1,sourceSha:'a'.repeat(40) } },'fixture-admin')).status,200);
  await expect('authenticated revision read',request(`characterRegistry/revisions/${revision}`,'GET',undefined,host.idToken),true);
  await expect('unauthenticated revision read',request(`characterRegistry/revisions/${revision}`,'GET'),false);
  for (const [name,path,method,data] of [
    ['revision child write',`characterRegistry/revisions/${revision}/runtimeContract`,'PUT','forged'],
    ['revision delete',`characterRegistry/revisions/${revision}`,'DELETE'],
    ['parent set','characterRegistry','PUT',{}],
    ['root multipath','', 'PATCH', { 'characterRegistry/active/generation':100 }],
    ['active delete','characterRegistry/active','DELETE'],
  ]) await expect(name,request(path,method,data,host.idToken),false);
  const now = Date.now(), round = 'a'.repeat(48), roomId = 'ABCDEFGH';
  const room = { protocol:4,registryRevision:revision,hostUid:host.localId,createdAt:now,expiresAt:now+600000,visibility:'private',
    settings:{terrain:'random',wind:'random',turnsPerPlayer:15,format:'1v1',stageSize:'standard',revision:1},
    slots:{p1:{uid:host.localId,claimedAt:now}},round:{id:round,status:'lobby',players:{p1:host.localId}},rounds:{[round]:{createdAt:now}} };
  await expect('valid protocol4 room creation',request(`registeredRooms/${roomId}`,'PUT',room,host.idToken),true);
  await expect('valid guest seat claim',request(`registeredRooms/${roomId}/slots/e1`,'PUT',{uid:guest.localId,claimedAt:now},guest.idToken),true);
  for (const [name,path,method,data] of [
    ['revision deletion','registryRevision','DELETE'],['revision switch','registryRevision','PUT','f'.repeat(64)],['protocol downgrade','protocol','PUT',3],['protocol removal','protocol','DELETE'],
  ]) await expect(name,request(`registeredRooms/${roomId}/${path}`,method,data,host.idToken),false);
  await expect('unknown revision new room',request('registeredRooms/BCDEFGHJ','PUT',{...room,registryRevision:'f'.repeat(64)},host.idToken),false);
  await expect('guest cannot set host settings',request(`registeredRooms/${roomId}/settings`,'PUT',room.settings,guest.idToken),false);
  // Creation at a parent must not bypass packet checks.
  const forged = structuredClone(room); forged.rounds[round].messages = { ['x'.repeat(20)]:{v:4,t:'reveal',from:host.localId,seat:'p1',roundId:round,character:'unknown',nonce:'b'.repeat(48),sentAt:now,registryRevision:revision} };
  await expect('invalid message included in room creation',request('registeredRooms/CDEFGHJK','PUT',forged,host.idToken),false);
  await expect('direct playing skips reveal',request(`registeredRooms/${roomId}/round/status`,'PUT','playing',host.idToken),false);
  const packet={v:4,t:'reveal',from:host.localId,seat:'p1',roundId:round,character:'kyoryu',definitionHash:candidate.characters.kyoryu.definitionHash,nonce:'b'.repeat(48),sentAt:now,registryRevision:revision};
  // A valid control distinguishes actual authorization from a globally denied test setup.
  await expect('valid registered reveal',request(`registeredRooms/${roomId}/rounds/${round}/messages/${'y'.repeat(20)}`,'PUT',packet,host.idToken),true);
  for(const [name,change] of [['unknown ID',{character:'banana'}],['slug instead of game ID',{character:'do-rednote'}],['forged definition hash',{definitionHash:'f'.repeat(64)}],['another seat',{seat:'e1'}],['another round',{roundId:'c'.repeat(48)}],['packet revision',{registryRevision:'f'.repeat(64)}]]){
    await expect(name,request(`registeredRooms/${roomId}/rounds/${round}/messages/${crypto.randomBytes(15).toString('hex').slice(0,20)}`,'PUT',{...packet,...change},host.idToken),false);
  }
  await expect('commit cannot leak selection',request(`registeredRooms/${roomId}/rounds/${round}/messages/${'z'.repeat(20)}`,'PUT',{...packet,t:'commit',hash:'a'.repeat(64)},host.idToken),false);
  const coopId='GHJKLMNP',coopSlot={uid:host.localId,name:'host',character:'kyoryu',definitionHash:candidate.characters.kyoryu.definitionHash,coopItem:'rescue-kit',ready:false,claimedAt:now,seenAt:now};
  const coop={protocol:2,registryRevision:revision,hostUid:host.localId,createdAt:now,expiresAt:now+600000,phase:'lobby',settings:{difficulty:'normal',aiFill:true,revision:1,aiCharacters:{e1:'neko',s1:'hamulton',s2:'coolKai'}},slots:{p1:coopSlot},round:{id:round,status:'input',deadlineAt:now+60000}};
  await expect('unauthenticated registered room creation',request('registeredCoopRooms/HJKLMNPQ','PUT',coop),false);
  await expect('valid coop2 creation with registered humans and AI',request(`registeredCoopRooms/${coopId}`,'PUT',coop,host.idToken),true);
  await expect('valid coop guest claim',request(`registeredCoopRooms/${coopId}/slots/e1`,'PUT',{...coopSlot,uid:guest.localId,name:'guest'},guest.idToken),true);
  // Both entry protocols preserve old rooms and restrict boss selection to the host in lobby.
  for (const registered of [false, true]) {
    const prefix=registered?'registeredCoop':'coop', id=registered?'STURMABC':'STURMBCD';
    const fixture=structuredClone(coop);
    if (!registered) { fixture.protocol=1; delete fixture.registryRevision; delete fixture.slots.p1.definitionHash; }
    await expect(`${prefix} legacy boss omission`,request(`${prefix}Rooms/${id}`,'PUT',fixture,host.idToken),true);
    await expect(`${prefix} select second boss`,request(`${prefix}Rooms/${id}/settings/bossId`,'PUT','storm-dragon-02',host.idToken),true);
    await expect(`${prefix} invalid boss rejected`,request(`${prefix}Rooms/${id}/settings/bossId`,'PUT','forged-boss',host.idToken),false);
    await expect(`${prefix} guest cannot change boss`,request(`${prefix}Rooms/${id}/settings/bossId`,'PUT','siege-fortress-01',guest.idToken),false);
    const listing={hostUid:host.localId,hostName:'host',roomName:'storm QA',playerCount:1,difficulty:'normal',aiFill:true,createdAt:now,expiresAt:now+600000};
    await expect(`${prefix} old listing omission`,request(`${prefix}Open/${id}`,'PUT',listing,host.idToken),true);
    await expect(`${prefix} second boss listing`,request(`${prefix}Open/${id}`,'PUT',{...listing,bossId:'storm-dragon-02'},host.idToken),true);
    await expect(`${prefix} invalid listing boss rejected`,request(`${prefix}Open/${id}`,'PUT',{...listing,bossId:'forged-boss'},host.idToken),false);
    await expect(`${prefix} return to implicit first boss`,request(`${prefix}Rooms/${id}/settings/bossId`,'DELETE',undefined,host.idToken),true);
    await expect(`${prefix} lock room on launch`,request(`${prefix}Rooms/${id}/phase`,'PUT','launching',host.idToken),true);
    await expect(`${prefix} launched boss cannot change`,request(`${prefix}Rooms/${id}/settings/bossId`,'PUT','storm-dragon-02',host.idToken),false);
  }
  for(const [name,path,method,body,identity] of [
    ['coop revision delete','registryRevision','DELETE',undefined,host.idToken],
    ['coop protocol downgrade','protocol','PUT',1,host.idToken],
    ['coop revision multipath','', 'PATCH',{'registryRevision':'f'.repeat(64)},host.idToken],
    ['coop unknown AI','settings/aiCharacters/s1','PUT','unknown',host.idToken],
    ['coop guest cannot alter host AI','settings/aiCharacters/s1','PUT','kyoryu',guest.idToken],
    ['coop forged slot hash','slots/e1/definitionHash','PUT','f'.repeat(64),guest.idToken],
    ['coop another seat UID','slots/e1/uid','PUT',host.localId,guest.idToken],
    ['coop round deletion','round','DELETE',undefined,host.idToken],
  ]) await expect(name,request(`registeredCoopRooms/${coopId}/${path}`,method,body,identity),false);
  const badCoop=structuredClone(coop);badCoop.slots.p1.character='unknown';
  await expect('coop parent creation cannot bypass registered ID',request('registeredCoopRooms/JKLMNPQR','PUT',badCoop,host.idToken),false);
  await expect('valid coop launch',request(`registeredCoopRooms/${coopId}/phase`,'PUT','launching',host.idToken),true);
  await expect('coop live character replacement',request(`registeredCoopRooms/${coopId}/slots/e1`,'PATCH',{character:'neko',definitionHash:candidate.characters.neko.definitionHash},guest.idToken),false);
  await expect('coop live round replacement',request(`registeredCoopRooms/${coopId}/round/id`,'PUT','b'.repeat(48),host.idToken),false);
  const envelope={v:2,t:'net',from:guest.localId,seat:'e1',roundId:round,sentAt:now,registryRevision:revision,payload:JSON.stringify({v:2,t:'join',registryRevision:'f'.repeat(64)})};
  await expect('opaque coop JSON passes Rules; internal revision needs client rejection',request(`registeredCoopRooms/${coopId}/rounds/${round}/messages/${'q'.repeat(20)}`,'PUT',envelope,guest.idToken),true);
  await expect('coop outer revision mismatch',request(`registeredCoopRooms/${coopId}/rounds/${round}/messages/${'r'.repeat(20)}`,'PUT',{...envelope,registryRevision:'f'.repeat(64)},guest.idToken),false);
  await request('characterRegistry/active','PUT',{registryRevision:'d'.repeat(64),generation:2,sourceSha:'b'.repeat(40)},'fixture-admin');
  await expect('active update invalidates new room',request('registeredRooms/DEFGHJKL','PUT',room,host.idToken),false);
  await expect('active update rejects revealing transition',request(`registeredRooms/${roomId}/round/status`,'PUT','revealing',host.idToken),false);
  await expect('active update rejects coop new start',request(`registeredCoopRooms/${coopId}/phase`,'PUT','playing',host.idToken),false);
  await expect('old pinned definition still readable',request(`characterRegistry/revisions/${revision}`,'GET',undefined,host.idToken),true);
  const oldRoom={...room,protocol:3};delete oldRoom.registryRevision;
  await expect('legacy protocol3 unaffected without active registry',request('rooms/EFGHJKLM','PUT',oldRoom,host.idToken),true);
  // Actual privileged publisher uses ETag CAS against this Emulator; no production adapter.
  const {createStore}=require('../tools/registration/firebase-store.cjs');
  const {publish,REPOSITORY}=require('../tools/registration/publisher.cjs');
  const db=createStore({origin:'http://127.0.0.1:19000',token:'owner',emulator:true,approved:true});
  const repository={name:REPOSITORY,proveMerged:async sourceSha=>({merged:true,base:'master',sourceSha}),rebuild:async()=>candidate,verifyDeployedRuntime:async()=>true,
    deployment:async sourceSha=>({sourceSha,environment:'github-pages',state:'success'}),readDeployedCandidate:async()=>candidate,readDeployedAsset:async path=>fs.readFileSync(path),isAncestor:async()=>true};
  const previous=(await db.read('active')).value;
  const applied=await publish({sourceSha:'c'.repeat(40),apply:true,expectedActive:previous,repository,database:db});assert.equal(applied.generation,3);
  const repeated=await publish({sourceSha:'c'.repeat(40),apply:true,expectedActive:previous,repository,database:db});assert.equal(repeated.changed,false);
  const readBefore=await db.read('active');await db.compareAndSet('active',readBefore.etag,{...readBefore.value,generation:4});
  await assert.rejects(db.compareAndSet('active',readBefore.etag,readBefore.value),/activeConflict/);
  results.push({name:'publisher actual ETag CAS and idempotent replay',boundary:'publisher + Emulator Admin fixture',expected:'generation preserved / stale ETag rejected',status:200});
  fs.mkdirSync('.registration-evidence',{recursive:true});
  fs.writeFileSync('.registration-evidence/rules-results.json',JSON.stringify({ sourceSha:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),run:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,project,endpoint:'127.0.0.1:19000',rulesSha256:crypto.createHash('sha256').update(fs.readFileSync('database.rules.json')).digest('hex'),registryRevision:revision,results },null,2));
  console.log(`${results.length} real Emulator assertions passed`);
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
