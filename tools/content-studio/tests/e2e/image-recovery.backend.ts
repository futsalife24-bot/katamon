import { test, expect, type Page } from '@playwright/test';
import { attachSyntheticCharacter } from './image-upload';

async function createPublication(page: Page, hit: boolean) {
  await page.goto('/__fixture/reset'); await page.goto('/'); await page.getByTestId('add-character').click();
  await attachSyntheticCharacter(page); await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();
  if (hit) { await attachSyntheticCharacter(page, '[data-testid="hit-image-input"]', 'alternate-hit.png', true); await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden(); }
  await page.getByTestId('step-nav-motion').click(); await page.getByTestId('generate-motion').click();
  await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成', { timeout: 120000 });
  await page.getByTestId('step-nav-character').click(); await page.getByTestId('display-name').fill('長い名前の画像付きキャラクター公開復旧確認'); await page.getByTestId('character-id').fill('recovery-unit');
  await page.getByTestId('step-nav-publish').click(); await page.getByTestId('prepare-change').click();
  await expect(page.getByTestId('review-publish-diff')).toBeVisible(); await page.getByTestId('review-publish-diff').check(); await page.getByTestId('create-pr').click(); await expect(page.getByTestId('publish-complete')).toBeVisible();
}
async function savedOperations(page: Page) {
return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('content-studio-v1', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const blobs = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('blobs').objectStore('blobs').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close();
    return { operations: rows.map(r => ({ id: r.id, bundleId: r.bundle.bundleId, createdAt: r.bundle.createdAt, inputKey: r.bundle.inputKey, files: r.bundle.files.map((f: any) => [f.path, f.sha256]), branch: r.prepared?.branch, head: r.result?.commitSha, diff: r.prepared?.diff })), blobs: blobs.map(b => [b.key, b.sha256]).sort() };
  });
}
async function fixture(page: Page) { return page.request.get('/__fixture/state').then(r => r.json()); }
async function installRestorationControl(page: Page, mode: string) {
  await page.addInitScript(mode => {
    const Native = window.Worker;
    (window as any).__restoration = { started: 0, finished: 0 };
    window.Worker = class extends Native {
      postMessage(message: any, options?: any) {
        if (message.type === 'process' && message.request?.generateVariants === false) {
          const stats = (window as any).__restoration; stats.started++;
          if ((mode === 'failure' && stats.started === 1) || (mode === 'hit-failure' && stats.started === 2)) { setTimeout(() => { stats.finished++; this.onmessage?.(new MessageEvent('message', { data: { id: message.id, type: 'error', error: { name: 'Error', message: 'プレビュー復元の故障注入' } } })); }, 500); return; }
          this.addEventListener('message', event => { if (event.data.type === 'complete' || event.data.type === 'error') stats.finished++; });
          setTimeout(() => super.postMessage(message, options), mode === 'slow' ? 2500 : 0); return;
        } super.postMessage(message, options);
      }
    };
  }, mode);
}
for (const width of [360, 390, 412]) for (const scenario of ['normal', 'hit', 'slow', 'failure']) test('R1 ' + width + 'px ' + scenario + ': image restoration retains publication and later edits invalidate it', async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 }); await createPublication(page, scenario !== 'normal');
  const before = await savedOperations(page), repository = await fixture(page);
  // Ordinary retries must use the frozen bundle even after time passes (R3 regression).
  await page.waitForTimeout(1100); await page.getByTestId('prepare-change').click(); await expect(page.getByTestId('review-publish-diff')).not.toBeChecked(); await page.getByTestId('review-publish-diff').check(); await page.getByTestId('create-pr').click(); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect(await fixture(page)).toEqual(repository);
  await installRestorationControl(page, scenario === 'failure' && width === 390 ? 'hit-failure' : scenario); await page.reload();
  if (scenario === 'hit') await page.goto('/__fixture/session').then(() => page.goto('/')); // Renewed session, same numeric actor.
  await page.getByRole('button', { name: '既存PRを確認・再開' }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__restoration.started)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => { const s = (window as any).__restoration; return s.started === s.finished; }), { timeout: 30000 }).toBe(true);
  await expect(page.getByText('画像プレビューの復元処理が完了しました。保存した公開操作は保持しています。')).toBeVisible();
  await expect(page.getByTestId('publish-complete')).toBeVisible(); await expect(page.getByTestId('review-publish-diff')).toBeVisible();
  expect(await savedOperations(page)).toEqual(before); expect(await fixture(page)).toEqual(repository);
  if (scenario === 'failure') await expect(page.getByRole('alert').last()).toContainText('故障注入');
  await page.getByTestId('review-publish-diff').check(); await page.getByTestId('create-pr').click(); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect(await fixture(page)).toEqual(repository);
  await page.getByTestId('create-pr').scrollIntoViewIfNeeded(); expect((await page.getByTestId('create-pr').boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: info.outputPath('restored-' + scenario + '-' + width + '.png'), fullPage: true });
  await page.setViewportSize({ width, height: 430 }); await page.getByTestId('create-pr').scrollIntoViewIfNeeded(); await expect(page.getByTestId('create-pr')).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (scenario === 'hit') { await page.getByTestId('step-nav-image').click(); await attachSyntheticCharacter(page, '[data-testid="image-input"]', 'sample-character.png', true); await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden(); }
  else if (scenario === 'slow') { await page.getByTestId('step-nav-motion').click(); await page.getByTestId('intensity-fire-strong').click(); }
  else { await page.getByTestId('step-nav-character').click(); await page.getByTestId('display-name').fill('実際に編集した名前'); }
  await page.getByTestId('step-nav-publish').click(); await expect(page.getByTestId('review-publish-diff')).toBeHidden(); await expect(page.getByTestId('create-pr')).toBeDisabled(); expect(await fixture(page)).toEqual(repository);
});

test('R1 delayed restoration cannot overwrite another draft or a later edit', async ({ page }) => {
  await createPublication(page, true); await installRestorationControl(page, 'slow'); await page.reload(); await page.getByRole('button', { name: '既存PRを確認・再開' }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__restoration.started)).toBeGreaterThan(0);
  await page.getByTestId('step-nav-character').click({ force: true }); await page.getByTestId('display-name').fill('後続の編集', { force: true });
  await page.waitForTimeout(3500); await expect(page.getByTestId('display-name')).toHaveValue('後続の編集'); await page.getByTestId('step-nav-publish').click(); await expect(page.getByTestId('review-publish-diff')).toBeHidden();
  await page.getByRole('button', { name: 'ダッシュボードへ戻る' }).click(); await page.getByTestId('add-character').click(); await page.waitForTimeout(3500);
  await expect(page.getByText('sample-character.png')).toBeHidden(); expect((await fixture(page)).prs).toBe(1);
});

test('R3 explicit successor preserves B and images, requires approval, and remains unique', async ({ page }, info) => {
  await createPublication(page, true); const original = await savedOperations(page); await page.request.get('/__fixture/add-b'); const drifted = await fixture(page);
  await page.getByTestId('prepare-change').click(); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect((await fixture(page)).prs).toBe(drifted.prs);
  await page.getByTestId('reprepare-latest').click(); await expect(page.getByTestId('review-publish-diff')).not.toBeChecked(); await expect(page.getByTestId('create-pr')).toBeDisabled();
  await expect(page.getByText('元PR #42（保持）')).toBeVisible(); expect(await page.locator('.publish-review').textContent()).toContain('unit-b');
  const next = await savedOperations(page); expect(next.blobs).toEqual(original.blobs); expect(next.operations).toHaveLength(2); expect(next.operations.every(r => JSON.stringify(r.files) === JSON.stringify(original.operations[0].files))).toBe(true);
  await page.getByTestId('review-publish-diff').check(); await page.getByTestId('create-pr').click(); await expect(page.getByTestId('publish-complete')).toContainText('CI queued'); const published = await fixture(page); expect(published.prs).toBe(drifted.prs + 1);
  await page.getByTestId('prepare-change').click(); await expect(page.getByTestId('review-publish-diff')).not.toBeChecked(); await expect(page.getByTestId('prepare-change')).toBeEnabled(); await page.getByTestId('review-publish-diff').check(); await page.getByTestId('create-pr').click(); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect(await fixture(page)).toEqual(published);
  await page.reload(); await page.getByRole('button', { name: '既存PRを確認・再開' }).first().click(); await expect(page.getByText('元PR #42（保持）')).toBeVisible(); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect(await fixture(page)).toEqual(published);
  await page.screenshot({ path: info.outputPath('successor.png'), fullPage: true });
});
test('R3 same-target change stops successor and retains the original PR', async ({ page }) => {
  await createPublication(page, false); await page.request.get('/__fixture/conflict'); const before = await fixture(page);
  await page.getByTestId('reprepare-latest').click(); await expect(page.getByRole('alert').last()).toContainText('対象キャラクター'); await expect(page.getByTestId('publish-complete')).toBeVisible(); expect(await fixture(page)).toEqual(before);
});

test('R1 switching drafts during delayed restore discards the old completion', async ({ page }) => {
  await createPublication(page, true); await installRestorationControl(page, 'slow'); await page.reload(); await page.getByRole('button', { name: '既存PRを確認・再開' }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__restoration.started)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'ダッシュボードへ戻る' }).click({ force: true }); await page.getByTestId('add-character').click({ force: true }); await page.waitForTimeout(3500);
  await expect(page.getByText('sample-character.png')).toBeHidden(); await page.getByTestId('step-nav-publish').click(); await expect(page.getByTestId('review-publish-diff')).toBeHidden(); await expect(page.getByTestId('create-pr')).toBeDisabled(); expect((await fixture(page)).prs).toBe(1);
});
test('R1 legacy outbox without a verified input binding is preserved with its PR link', async ({ page }) => {
  await createPublication(page, false);
  await page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('content-studio-v1', 2); r.onsuccess = () => resolve(r.result); }); await new Promise<void>((resolve, reject) => { const tx = db.transaction('outbox', 'readwrite'), store = tx.objectStore('outbox'), r = store.getAll(); r.onsuccess = () => { for (const row of r.result) { delete row.bundle.inputKey; store.put(row); } }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close(); });
  const before = await savedOperations(page); await page.reload(); await page.getByRole('button', { name: '既存PRを確認・再開' }).click(); await expect(page.getByRole('alert').last()).toContainText('対応を確認できません'); await expect(page.getByRole('link', { name: '保存済みPR #42を開く' })).toBeVisible(); expect(await savedOperations(page)).toEqual(before); expect((await fixture(page)).prs).toBe(1);
});

test('R1 preparation persists the current draft before outbox even with delayed autosave', async ({ page }) => {
  await page.addInitScript(() => { const native = window.setTimeout.bind(window); window.setTimeout = ((fn: TimerHandler, delay?: number, ...args: any[]) => native(fn, delay === 650 ? 60000 : delay, ...args)) as typeof window.setTimeout; });
  await createPublication(page, true);
  await page.reload(); await page.getByRole('button', { name: '既存PRを確認・再開' }).first().click();
  await expect(page.getByTestId('publish-complete')).toBeVisible();
  await expect(page.getByText('画像プレビューの復元処理が完了しました。保存した公開操作は保持しています。')).toBeVisible();
  expect((await fixture(page)).prs).toBe(1);
});
