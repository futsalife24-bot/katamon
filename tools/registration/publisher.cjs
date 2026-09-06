const registry = require('../../shared/content-studio-registration.js');
const REPOSITORY = 'futsalife24-bot/katamon';
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Privileged boundary. No caller-supplied roster, URLs, source code or hash is trusted. */
async function publish({ sourceSha, apply = false, expectedActive, repository, database }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail('publisher.sourceSha');
  if (repository.name !== REPOSITORY) fail('publisher.repository');
  const proof = await repository.proveMerged(sourceSha);
  if (!proof.merged || proof.base !== 'master' || proof.sourceSha !== sourceSha) fail('publisher.notMerged');
  const candidate = await registry.verify(await repository.rebuild(sourceSha));
  const storedCandidate = registry.storage(candidate);
  const deployed = await repository.deployment(sourceSha);
  if (deployed.sourceSha !== sourceSha || deployed.environment !== 'github-pages' || deployed.state !== 'success') fail('publisher.notDeployed');
  if (!await repository.verifyDeployedRuntime(sourceSha)) fail('publisher.deployedRuntime');
  if (registry.stable(await repository.readDeployedCandidate()) !== registry.stable(candidate)) fail('publisher.deployedContent');
  // Every referenced byte is verified against the independently reconstructed immutable candidate.
  const assets = new Map();
  for (const entry of Object.values(candidate.characters)) for (const asset of entry.assets) {
    if (assets.has(asset.path) && assets.get(asset.path).sha256 !== asset.sha256) fail('publisher.assetConflict');
    assets.set(asset.path,asset);
  }
  for (const asset of assets.values()) {
    const bytes = await repository.readDeployedAsset(asset.path, asset.bytes);
    if (bytes.byteLength !== asset.bytes || await registry.hash(bytes) !== asset.sha256) fail('publisher.deployedAsset');
  }
  const plan = { mode:apply ? 'apply':'dry-run', sourceSha, registryRevision:candidate.registryRevision, assets:assets.size };
  if (!apply) return { ...plan, changed:false };
  if (!database || !await database.applicationApproved()) fail('publisher.applyNotApproved');
  const active = await database.read('active');
  if (active.value && (!/^[a-f0-9]{64}$/.test(active.value.registryRevision) || !/^[a-f0-9]{40}$/.test(active.value.sourceSha)
      || !Number.isSafeInteger(active.value.generation) || active.value.generation < 1 || active.value.generation >= Number.MAX_SAFE_INTEGER)) fail('publisher.activeInvalid');
  // An ambiguous write response is recognized before attempting another generation increment.
  if (active.value?.registryRevision === candidate.registryRevision && active.value?.sourceSha === sourceSha) {
    const existing = await database.read('revisions/' + candidate.registryRevision);
    if (registry.stable(existing.value) !== registry.stable(storedCandidate)) fail('publisher.immutableConflict');
    return { ...plan, changed:false, generation:active.value.generation };
  }
  if (registry.stable(active.value) !== registry.stable(expectedActive ?? null)) fail('publisher.activeConflict');
  if (active.value && (!Number.isSafeInteger(active.value.generation) || !await repository.isAncestor(active.value.sourceSha,sourceSha))) fail('publisher.staleDeployment');
  const candidatePath = 'revisions/' + candidate.registryRevision;
  const prior = await database.read(candidatePath);
  if (prior.value !== null && registry.stable(prior.value) !== registry.stable(storedCandidate)) fail('publisher.immutableConflict');
  if (prior.value === null) {
    try { await database.compareAndSet(candidatePath,prior.etag,storedCandidate); }
    catch (error) { if (registry.stable((await database.read(candidatePath)).value) !== registry.stable(storedCandidate)) throw error; }
  }
  const next = { registryRevision:candidate.registryRevision, sourceSha, generation:(active.value?.generation ?? 0)+1 };
  try { await database.compareAndSet('active',active.etag,next); }
  catch (error) { if (registry.stable((await database.read('active')).value) !== registry.stable(next)) throw error; }
  return { ...plan, changed:true, generation:next.generation };
}
module.exports = { publish, REPOSITORY };
