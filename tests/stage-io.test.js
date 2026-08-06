'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/stage-core.js');
const StageZip = require('../shared/stage-zip.js');
const StageStorage = require('../shared/stage-storage.js');

async function finalizedStage(seed) {
  const stage = core.generateStage({ seed: seed || 'io-test', preset: 'rolling' });
  return core.finalizeStage(stage, { touchUpdatedAt: false });
}

function makeWebp(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes[4] = 22;
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  bytes[16] = 10;
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >>> 8) & 0xff;
  bytes[26] = (w >>> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >>> 8) & 0xff;
  bytes[29] = (h >>> 16) & 0xff;
  return bytes;
}

function findSignature(bytes, signature) {
  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    if (bytes[offset] === (signature & 0xff) && bytes[offset + 1] === ((signature >>> 8) & 0xff) &&
      bytes[offset + 2] === ((signature >>> 16) & 0xff) && bytes[offset + 3] === ((signature >>> 24) & 0xff)) return offset;
  }
  return -1;
}

test('CRC-32 and generic STORE ZIP round-trip are deterministic', async () => {
  assert.equal(StageZip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const source = {
    'z-last.txt': '最後',
    'a-first.json': '{"ok":true}'
  };
  const first = await StageZip.createZip(source);
  const second = await StageZip.createZip(source);
  assert.deepEqual(first, second);
  const archive = await StageZip.readZip(first);
  assert.deepEqual(Object.keys(archive.entries).sort(), ['a-first.json', 'z-last.txt']);
  assert.equal(new TextDecoder().decode(archive.entries['z-last.txt'].data), '最後');
});

test('stage ZIP round-trip preserves the normalized stage and optional image assets', async () => {
  const stage = await finalizedStage('bundle-roundtrip');
  const preview = new Blob([makeWebp(640, 360)], { type: 'image/webp' });
  const blob = await StageZip.createStageBundle(stage, { previewBlob: preview });
  assert.equal(blob.type, 'application/zip');
  assert.ok(blob.size > 0 && blob.size <= StageZip.ZIP_LIMITS.maxArchiveBytes);

  const result = await StageZip.readStageBundle(blob);
  assert.deepEqual(result.stage, stage);
  assert.equal((await core.verifyStageHash(result.stage)).valid, true);
  assert.equal(result.assets['preview.webp'].mimeType, 'image/webp');
  assert.equal(result.assets['preview.webp'].size, 30);
});

test('stage bundle bytes remain reproducible when metadata is fixed', async () => {
  const stage = await finalizedStage('bundle-deterministic');
  const first = await StageZip.createStageBundle(stage, { output: 'uint8array', finalize: false });
  const second = await StageZip.createStageBundle(stage, { output: 'uint8array', finalize: false });
  assert.deepEqual(first, second);
});

test('ZIP creation rejects traversal, duplicate names, unsupported images and size excess', async () => {
  await assert.rejects(StageZip.createZip({ '../escape.json': '{}' }), (error) => error.code === 'path.unsafe');
  await assert.rejects(StageZip.createZip([
    { name: 'same.json', data: '{}' },
    { name: 'SAME.JSON', data: '{}' }
  ]), (error) => error.code === 'entry.duplicate');
  await assert.rejects(StageZip.createZip({ 'preview.webp': new Uint8Array([1, 2, 3]) }, { strictStageBundle: true }),
    (error) => error.code === 'image.signature');
  await assert.rejects(StageZip.createZip({ 'preview.webp': makeWebp(3000, 10) }, { strictStageBundle: true }),
    (error) => error.code === 'image.dimensions');
  await assert.rejects(StageZip.createZip({ 'large.json': '123456' }, { limits: { maxEntryBytes: 4 } }),
    (error) => error.code === 'entry.tooLarge');
});

test('ZIP reader rejects wrong MIME, CRC damage and unsupported compression', async () => {
  const original = await StageZip.createZip({ 'data.json': '{"safe":true}' });
  await assert.rejects(StageZip.readZip(new Blob([original], { type: 'text/plain' })),
    (error) => error.code === 'archive.mime');

  const damaged = new Uint8Array(original);
  const nameLength = 'data.json'.length;
  damaged[30 + nameLength] ^= 0x01;
  await assert.rejects(StageZip.readZip(damaged), (error) => error.code === 'archive.crc');

  const compressed = new Uint8Array(original);
  const central = findSignature(compressed, 0x02014b50);
  assert.ok(central > 0);
  new DataView(compressed.buffer).setUint16(central + 10, 8, true);
  await assert.rejects(StageZip.readZip(compressed), (error) => error.code === 'archive.compression');
});

test('stage ZIP rejects prototype keys, unsupported entries and content hash tampering', async () => {
  const malicious = await StageZip.createZip({
    'manifest.json': '{"__proto__":{"polluted":true}}',
    'terrain.json': '{}',
    'gimmicks.json': '[]'
  }, { strictStageBundle: true });
  await assert.rejects(StageZip.readStageBundle(malicious), (error) => error.code === 'json.prototype');
  assert.equal({}.polluted, undefined);

  await assert.rejects(StageZip.createZip({
    'manifest.json': '{}',
    'terrain.json': '{}',
    'gimmicks.json': '[]',
    'run.js': 'alert(1)'
  }, { strictStageBundle: true }), (error) => error.code === 'entry.unsupported');

  const unsafeStage = await finalizedStage('unsafe-manifest');
  const unsafeManifest = JSON.parse(JSON.stringify(unsafeStage));
  const unsafeTerrain = unsafeManifest.terrain;
  const unsafeGimmicks = unsafeManifest.gimmicks;
  delete unsafeManifest.terrain;
  delete unsafeManifest.gimmicks;
  unsafeManifest.externalAsset = 'https://example.invalid/background.png';
  const unsafeBundle = await StageZip.createZip({
    'manifest.json': JSON.stringify(unsafeManifest),
    'terrain.json': JSON.stringify(unsafeTerrain),
    'gimmicks.json': JSON.stringify(unsafeGimmicks)
  }, { strictStageBundle: true });
  await assert.rejects(StageZip.readStageBundle(unsafeBundle), (error) => error.code === 'stage.invalid');

  const stage = await finalizedStage('tamper-test');
  const tampered = core.normalizeStage(stage);
  tampered.title = '改変済みステージ';
  tampered.checksums.contentHash = stage.checksums.contentHash;
  const bundle = await StageZip.createStageBundle(tampered, { output: 'uint8array', finalize: false });
  await assert.rejects(StageZip.readStageBundle(bundle), (error) => error.code === 'stage.hash');
});

test('memory fallback keeps drafts and custom stages in separate stores', async () => {
  const stage = await finalizedStage('separate-stores');
  const storage = await StageStorage.open({ forceMemory: true, dbName: 'test-separate-' + stage.stageId });
  await storage.putDraft({ stage, editor: { screen: 'terrain', view: { zoom: 1.5 } } });
  await storage.putCustom(stage);
  assert.equal((await storage.listDrafts()).length, 1);
  assert.equal((await storage.listCustom()).length, 1);
  assert.equal((await storage.getDraft(stage.stageId)).editor.screen, 'terrain');

  await storage.deleteDraft(stage.stageId);
  assert.equal(await storage.getDraft(stage.stageId), null);
  assert.ok(await storage.getCustom(stage.stageId));
  await storage.close();
});

test('stored values are cloned, drafts duplicate safely and custom hash is enforced', async () => {
  const stage = await finalizedStage('clone-storage');
  const storage = await StageStorage.open({ forceMemory: true, dbName: 'test-clone-' + stage.stageId });
  const saved = await storage.putDraft({ stage, history: [{ action: 'paint' }] });
  saved.stage.title = '呼び出し側の変更';
  assert.notEqual((await storage.getDraft(stage.stageId)).stage.title, saved.stage.title);

  const duplicated = await storage.duplicateDraft(stage.stageId, { title: '複製ステージ' });
  assert.notEqual(duplicated.id, stage.stageId);
  assert.equal(duplicated.stage.title, '複製ステージ');
  assert.equal(duplicated.stage.checksums.contentHash, '');

  await storage.putCustom(stage);
  const unsafe = JSON.parse(JSON.stringify(stage));
  unsafe.externalAsset = 'https://example.invalid/background.png';
  await assert.rejects(storage.putCustom(unsafe, { verifyHash: false }), (error) => error.code === 'stage.invalid');
  const tampered = core.normalizeStage(stage);
  tampered.title = '不正な変更';
  tampered.checksums.contentHash = stage.checksums.contentHash;
  await assert.rejects(storage.putCustom(tampered), (error) => error.code === 'stage.hash');
  await storage.close();
});

test('autosave coalesces updates and flushes the newest draft', async () => {
  const stage = await finalizedStage('autosave');
  const storage = await StageStorage.open({ forceMemory: true, dbName: 'test-autosave-' + stage.stageId });
  const first = { stage: core.normalizeStage(stage), editor: { screen: 'terrain' } };
  const latest = { stage: core.normalizeStage(stage), editor: { screen: 'spawn' } };
  latest.stage.description = '最新の自動保存';
  latest.stage.checksums.contentHash = '';
  const firstPromise = storage.scheduleAutosave(first, { delayMs: 30 });
  const latestPromise = storage.scheduleAutosave(latest, { delayMs: 5 });
  await Promise.all([firstPromise, latestPromise]);
  const restored = await storage.getDraft(stage.stageId);
  assert.equal(restored.stage.description, '最新の自動保存');
  assert.equal(restored.editor.screen, 'spawn');
  assert.equal((await storage.listDrafts()).length, 1);
  await storage.close();
});

test('record migration, corruption cleanup, usage and JSON backup round-trip work', async () => {
  const stage = await finalizedStage('migration');
  const migrated = StageStorage.migrateRecord({
    storageVersion: 1,
    stageId: stage.stageId,
    stage,
    editor: { screen: 'test-play' }
  }, 'drafts', core);
  assert.equal(migrated.storageVersion, StageStorage.RECORD_VERSION);
  assert.equal(migrated.editor.screen, 'test-play');

  const dbName = 'test-migration-' + stage.stageId;
  const storage = await StageStorage.open({ forceMemory: true, dbName });
  await storage.putDraft(migrated);
  const snapshot = await storage.exportSnapshot('drafts', stage.stageId);
  await storage.deleteDraft(stage.stageId);
  await storage.importSnapshot(snapshot, { kind: 'drafts' });
  assert.equal((await storage.getDraft(stage.stageId)).stage.stageId, stage.stageId);

  await storage.backend.put(StageStorage.STORES.drafts, { id: 'broken-record', storageVersion: 999, title: '壊れた保存データ' });
  const listed = await storage.listDrafts();
  assert.ok(listed.some((entry) => entry.id === 'broken-record' && entry.corrupt));
  const cleanup = await storage.clearCorrupt();
  assert.equal(cleanup.count, 1);
  assert.equal((await storage.listDrafts()).some((entry) => entry.corrupt), false);

  const usage = await storage.estimateUsage();
  assert.equal(usage.backend, 'memory');
  assert.equal(usage.durable, false);
  assert.ok(usage.stageStudioUsage > 0);
  await storage.close();
});
