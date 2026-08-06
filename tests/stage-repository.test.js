'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const StageCore = require('../shared/stage-core.js');
const StageStorage = require('../shared/stage-storage.js');
const StageRepository = require('../shared/stage-repository.js');

async function finalizedStage(seed) {
  return StageCore.finalizeStage(StageCore.generateStage({
    seed,
    preset: 'rolling',
    title: 'リポジトリ契約テスト'
  }), { touchUpdatedAt: false });
}

test('repository base contract exposes CRUD compatibility names', () => {
  const base = new StageRepository.StageRepositoryProvider();
  assert.equal(base.network, false);
  for (const method of [
    'saveStage', 'getStage', 'listStages', 'deleteStage', 'renameStage',
    'putCustom', 'getCustom', 'listCustom', 'deleteCustom', 'renameCustom'
  ]) {
    assert.equal(typeof base[method], 'function', method);
  }
  assert.throws(
    () => base.listCustom(),
    (error) => error instanceof StageRepository.StageRepositoryError
      && error.code === 'repository.notImplemented'
  );
});

test('local provider wraps custom CRUD and never touches the draft store', async () => {
  const stage = await finalizedStage('repository-crud');
  const storage = await StageStorage.open({
    forceMemory: true,
    dbName: 'test-repository-' + stage.stageId
  });
  const provider = StageRepository.createLocalProvider({ storage });

  assert.ok(provider instanceof StageRepository.StageRepositoryProvider);
  assert.ok(provider instanceof StageRepository.LocalStageRepositoryProvider);
  assert.equal(provider.providerId, 'local-device');
  assert.equal(provider.network, false);
  assert.equal(provider.capabilities.network, false);
  assert.equal(await provider.ready(), provider);

  await storage.putDraft({ stage, editor: { screen: 'terrain' } });
  const created = await provider.putCustom(stage);
  assert.equal(created.kind, 'custom');
  assert.equal((await provider.listCustom()).length, 1);
  assert.equal((await provider.getCustom(stage.stageId)).stage.title, stage.title);

  const updatedStage = StageCore.normalizeStage(stage);
  updatedStage.title = '更新後のステージ';
  const finalizedUpdate = await StageCore.finalizeStage(updatedStage, { touchUpdatedAt: false });
  await provider.saveStage(finalizedUpdate);
  assert.equal((await provider.getStage(stage.stageId)).stage.title, '更新後のステージ');
  assert.equal((await storage.listDrafts()).length, 1, 'custom update leaves drafts untouched');

  await provider.deleteCustom(stage.stageId);
  assert.equal(await provider.getCustom(stage.stageId), null);
  assert.ok(await storage.getDraft(stage.stageId), 'custom delete leaves the draft store untouched');
  await storage.close();
});

test('local provider performs no network request', async () => {
  const stage = await finalizedStage('repository-offline');
  const storage = await StageStorage.open({
    forceMemory: true,
    dbName: 'test-repository-offline-' + stage.stageId
  });
  const provider = new StageRepository.LocalStageRepositoryProvider({ storage });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async function () {
    requests += 1;
    throw new Error('network must not be used');
  };
  try {
    await provider.putCustom(stage);
    await provider.listCustom();
    await provider.getCustom(stage.stageId);
    await provider.deleteCustom(stage.stageId);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await storage.close();
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'stage-repository.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('game shell loads and caches the repository boundary before custom stage UI', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'game-custom-stages.js'), 'utf8');

  const storageIndex = html.indexOf('shared/stage-storage.js');
  const repositoryIndex = html.indexOf('shared/stage-repository.js');
  const managerIndex = html.indexOf('game-custom-stages.js');
  assert.ok(storageIndex >= 0, 'stage storage is loaded');
  assert.ok(repositoryIndex > storageIndex, 'repository loads after storage');
  assert.ok(managerIndex > repositoryIndex, 'custom stage UI loads after repository');
  assert.match(serviceWorker, /\.\/shared\/stage-repository\.js/);
  assert.match(manager, /createLocalProvider\s*\(/);
  assert.doesNotMatch(manager, /storageModule\.open\s*\(/);
});

test('stage identity requires all four pre-battle fields to match', async () => {
  const stage = await finalizedStage('identity-contract');
  const identity = StageCore.createStageIdentity(stage);
  assert.deepEqual(identity, {
    stageId: stage.stageId,
    schemaVersion: stage.schemaVersion,
    contentHash: stage.checksums.contentHash,
    gameCompatibility: stage.gameCompatibility
  });
  assert.deepEqual(StageCore.compareStageIdentity(identity, identity), {
    match: true,
    reason: '',
    reasons: []
  });

  const remote = JSON.parse(JSON.stringify(identity));
  remote.stageId += '_other';
  remote.schemaVersion = '9.9.9';
  remote.contentHash = '0'.repeat(64);
  remote.gameCompatibility.minBuild = 'v999';
  const mismatch = StageCore.compareStageIdentity(identity, remote);
  assert.equal(mismatch.match, false);
  assert.equal(mismatch.reasons.length, 4);
  assert.match(mismatch.reason, /stageId/);
  assert.match(mismatch.reason, /schemaVersion/);
  assert.match(mismatch.reason, /contentHash/);
  assert.match(mismatch.reason, /gameCompatibility/);

  const tampered = StageCore.normalizeStage(stage);
  tampered.title = '改変されたステージ';
  assert.throws(() => StageCore.createStageIdentity(tampered), /contentHash/);
});
