const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const reg = require('../shared/content-studio-registration.js');
const base = JSON.parse(fs.readFileSync('generated/content-studio-registration.json', 'utf8'));
test('actual generated registry verifies all legacy IDs without slug normalization', async () => {
  const candidate = await reg.verify(base);
  assert.equal(Object.values(candidate.characters).filter(entry=>entry.legacy).length, 18);
  assert.ok(Object.keys(candidate.characters).length >= 18, 'published standard characters may extend the legacy roster');
  assert.equal(candidate.characters.doRednote.slug, 'do-rednote');
  assert.equal(candidate.characters.coolKai.slug, 'cool-kai');
  assert.equal(candidate.characters.hamulton.gameId, 'hamulton');
});
test('ordering is deterministic and definition corruption is rejected', async () => {
  const reverse = Object.fromEntries(Object.entries(base.characters).reverse());
  assert.equal((await reg.create(reverse)).registryRevision, base.registryRevision);
  const bad = structuredClone(base); bad.characters.kyoryu.definition.maxHp++;
  await assert.rejects(reg.verify(bad), /registry.definition/);
});
test('commitment binds revision, seat, room, round and Gear without revealing selection', async () => {
  const fields = { registryRevision: base.registryRevision, room: 'ABCDEFGH', round: 'a'.repeat(48), seat: 'p1', character: 'kyoryu', nonce: 'b'.repeat(48), gear: 'gear-binding' };
  const digest = await reg.binding(fields);
  for (const change of [{ seat:'e1' }, { round:'c'.repeat(48) }, { character:'hamulton' }, { gear:null }, { registryRevision:'d'.repeat(64) }]) assert.notEqual(await reg.binding({ ...fields,...change }), digest);
  assert.match(digest, /^[a-f0-9]{64}$/);
});
test('pinned old revision remains available after active changes; new start fails', async () => {
  let active = { registryRevision: base.registryRevision, generation:1, sourceSha:'a'.repeat(40) };
  const session = new reg.Session(async path => path.endsWith('/active') ? active : reg.storage(base));
  await session.pin(base.registryRevision); await session.start();
  active = { ...active, registryRevision:'b'.repeat(64), generation:2 };
  assert.equal(session.current.registryRevision, base.registryRevision);
  await assert.rejects(session.assertNewStart(), /activeChanged/);
  assert.equal(session.current.characters.kyoryu.definition.maxHp, 100);
  session.reset(); assert.equal(session.current, null);
});
test('late previous-session result cannot repin after reset', async () => {
  let finish; const session = new reg.Session(() => new Promise(resolve => { finish = resolve; }));
  const pending = session.pin(base.registryRevision); session.reset(); finish(reg.storage(base));
  await assert.rejects(pending, /cancelled/); assert.equal(session.current, null);
});

test('RTDB storage preserves null fields and rejects forged Rules index',async()=>{
  const stored=reg.storage(base);assert.deepEqual(await reg.verifyStored(JSON.parse(JSON.stringify(stored)),base.registryRevision),base);
  const bad=structuredClone(stored);bad.characters.kyoryu.definitionHash='f'.repeat(64);
  await assert.rejects(reg.verifyStored(bad,base.registryRevision),/indexMismatch/);
});
test('bounded registry reads reject declared and streamed excess',async()=>{
  await assert.rejects(reg.readJson(new Response('{}',{headers:{'content-length':'50'}}),20),/capacity/);
  await assert.rejects(reg.readJson(new Response(' '.repeat(21)),20),/capacity/);
  assert.deepEqual(await reg.readJson(new Response('{"ok":true}'),20),{ok:true});
});
test('complete-looking JSON on a response that never ends still times out',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{}'));}}));
  const pending=reg.readJson(response);
  await Promise.resolve();t.mock.timers.tick(12000);
  await assert.rejects(pending,/registry.timeout/);
});

test('an earlier active lookup cannot replace a later explicitly pinned revision',async()=>{
  const {GameRegistry}=require('../shared/content-studio-registration-game');
  let release;
  const game=new GameRegistry(path=>path.endsWith('/active')?new Promise(resolve=>{release=resolve;}):Promise.resolve(reg.storage(base)),{});
  const stale=game.pin();await game.pin(base.registryRevision);
  release({registryRevision:base.registryRevision,generation:1,sourceSha:'a'.repeat(40)});
  await assert.rejects(stale,/cancelled/);assert.equal(game.revision,base.registryRevision);
});
test('game pin rejects missing room revision, resolves old data and releases state',async()=>{
  const {GameRegistry}=require('../shared/content-studio-registration-game');
  const game=new GameRegistry(async()=>reg.storage(base),Object.fromEntries(Object.entries(base.characters).map(([id,e])=>[id,e.definition])));
  await assert.rejects(game.pin(null),/revision/);
  await game.pin(base.registryRevision);assert.equal(game.resolve('doRednote').gameId,'doRednote');
  assert.throws(()=>game.resolve('do-rednote'),/unknownDefinition/);
  assert.equal(game.validatePacket({t:'commit',registryRevision:game.revision,character:'kyoryu'}),'packet.selectionLeak');
  assert.equal(game.validateSnapshot({registryRevision:game.revision,definitionHashes:{p1:game.resolve('kyoryu').definitionHash},units:[{id:'p1',character:'kyoryu',maxHp:199}]}),'snap.definition.maxHp');
  game.reset();assert.equal(game.revision,null);
});
test('verified optional motion 404 retains static fallback; changed bytes reject and requests are shared',async()=>{
  const {GameRegistry}=require('../shared/content-studio-registration-game');
  const chars=structuredClone(base.characters), entry=chars.kyoryu, prefix='assets/content-studio/kyoryu/aaaaaaaaaaaa/';
  entry.appearance={motionSheets:{},motionMetadata:{}};
  for(const clip of reg.CLIPS) for(const [field,suffix] of [['motionSheets','.png'],['motionMetadata','.json']]){
    const path=prefix+clip+suffix;entry.appearance[field][clip]=path;entry.assets.push({path,bytes:1,sha256:await reg.hash(new Uint8Array([1]))});
  }
  const candidate=await reg.create(chars);let calls=0,live=0,peak=0;
  const fetchAsset=async path=>{calls++;live++;peak=Math.max(peak,live);await new Promise(resolve=>setTimeout(resolve,1));live--;return path.startsWith(prefix)?new Response('',{status:404}):new Response(fs.readFileSync(path));};
  const game=new GameRegistry(async()=>reg.storage(candidate),{},fetchAsset);await game.pin(candidate.registryRevision);
  await Promise.all([game.assets('kyoryu'),game.assets('kyoryu'),game.assets('hamulton')]);assert.equal(calls,14);assert.equal(peak,1);
  await game.assets('kyoryu');assert.equal(calls,14);
  const corrupt=new GameRegistry(async()=>reg.storage(base),{},async()=>new Response('bad'));await corrupt.pin(base.registryRevision);
  await assert.rejects(corrupt.assets('kyoryu'),/assetHash/);
});
