import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDraft } from '../../src/domain/defaults';
import { createAutosaveController } from '../../src/storage/autosave';
import {
  exportDraftJson,
  getDraft,
  getDraftBlob,
  importDraftJson,
  listDrafts,
  putDraftBlob,
  resetDatabaseConnectionForTests,
} from '../../src/storage/db';

const DATABASE_NAME = 'content-studio-v1';

async function deleteTestDatabase(): Promise<void> {
  await resetDatabaseConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('テスト用データベースを閉じられませんでした。'));
  });
}

describe('端末内の下書き保存', () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it('自動保存後に下書きと画像を復元する', async () => {
    const onSaved = vi.fn();
    const onError = vi.fn();
    const autosave = createAutosaveController(10_000, onSaved, onError);
    const draft = createDraft('draft-storage-test');
    draft.title = 'サンプルキャラクター';
    draft.character.displayName = 'サンプルキャラクター';
    draft.lastStep = 'motion';

    autosave.schedule(draft);
    const saved = await autosave.flush();
    expect(saved?.historyStatus).toBe('clean');
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    const pixels = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await putDraftBlob(draft.id, 'normalized', new Blob([pixels], { type: 'image/png' }));
    const restored = await getDraft(draft.id);
    expect(restored?.character.displayName).toBe('サンプルキャラクター');
    expect(restored?.lastStep).toBe('motion');
    expect(new Uint8Array(await (await getDraftBlob(draft.id, 'normalized'))!.arrayBuffer())).toEqual(pixels);
    expect(await listDrafts()).toHaveLength(1);
  });

  it('JSON出力と読込で内容・画像ハッシュを保ち、別IDへ複製する', async () => {
    const draft = createDraft('draft-export-test');
    draft.title = 'サンプルキャラクター';
    const autosave = createAutosaveController(0, () => undefined, () => undefined);
    autosave.schedule(draft);
    await autosave.flush();
    const source = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' });
    const hitSource = new Blob([new Uint8Array([5, 4, 3, 2, 1])], { type: 'image/png' });
    await putDraftBlob(draft.id, 'original', source);
    await putDraftBlob(draft.id, 'hit-original', hitSource);

    const exported = await exportDraftJson(draft.id);
    const imported = await importDraftJson(exported);
    expect(imported.id).not.toBe(draft.id);
    expect(imported.title).toContain('サンプルキャラクター');
    expect(new Uint8Array(await (await getDraftBlob(imported.id, 'original'))!.arrayBuffer())).toEqual(
      new Uint8Array(await source.arrayBuffer()),
    );
    expect(new Uint8Array(await (await getDraftBlob(imported.id, 'hit-original'))!.arrayBuffer())).toEqual(
      new Uint8Array(await hitSource.arrayBuffer()),
    );
  });
});
