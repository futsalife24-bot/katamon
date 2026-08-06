import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { basename } from 'node:path';

async function attachSyntheticCharacter(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvasを初期化できませんでした。');
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 128; x += 8) {
        context.fillStyle = ((x + y) / 8) % 2 === 0 ? '#f6f6f6' : '#e8e8e8';
        context.fillRect(x, y, 8, 8);
      }
    }
    context.fillStyle = '#e6a51c';
    context.beginPath();
    context.arc(62, 53, 30, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#243347';
    context.fillRect(26, 78, 76, 25);
    context.fillStyle = '#35d7de';
    context.fillRect(75, 54, 39, 10);
    context.fillStyle = '#111827';
    context.fillRect(38, 103, 23, 12);
    context.fillRect(72, 103, 23, 12);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNGを作成できませんでした。')), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'sample-character.png', { type: 'image/png', lastModified: Date.now() }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="image-input"]');
    if (!input) throw new Error('画像入力が見つかりませんでした。');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function swipeUpFrom(context: BrowserContext, page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('スワイプ対象の表示領域を取得できませんでした。');
  const client = await context.newCDPSession(page);
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.78;
  const endY = box.y + box.height * 0.22;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  for (let step = 1; step <= 6; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY + (endY - startY) * step / 6 }],
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('Android縦画面で部位検出から砲撃モーション出力、再開、オフライン復旧まで完走する', async ({ page, context }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  const manifest = await page.evaluate(async () => fetch('./manifest.webmanifest').then((response) => response.json()));
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.share_target.action).toContain('share-target=1');
  await page.getByTestId('add-character').click();
  await expect(page.getByTestId('step-image')).toBeVisible();

  const localSample = process.env.CONTENT_STUDIO_E2E_SAMPLE?.trim();
  if (localSample) await page.getByTestId('image-input').setInputFiles(localSample);
  else await attachSyntheticCharacter(page);
  await expect(page.getByText(localSample ? basename(localSample) : 'sample-character.png')).toBeVisible();

  await page.getByTestId('step-nav-cutout').click();
  const cutoutCanvas = page.locator('canvas[aria-label="背景除去後"]');
  const scrollBeforeCutoutSwipe = await page.evaluate(() => window.scrollY);
  await swipeUpFrom(context, page, cutoutCanvas);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBeforeCutoutSwipe + 40);
  await page.getByRole('button', { name: '自動背景除去' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();
  await page.getByRole('button', { name: '余白を自動トリム' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();

  await page.getByTestId('step-nav-parts').click();
  await page.getByTestId('detect-parts').click();
  await expect(page.locator('.part-candidate')).toHaveCount(5);
  await expect(page.getByTestId('focus-part')).toBeVisible();
  await page.getByTestId('focus-part').selectOption('part-right');

  await page.getByTestId('step-nav-motion').click();
  await page.getByTestId('motion-action-fire').click();
  await page.getByTestId('action-preset-fire-recoil').click();
  await expect(page.getByTestId('step-motion').locator('input[type="range"]')).toHaveCount(0);
  const motionCanvas = page.getByLabel('砲撃モーションプレビュー');
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrollBeforeMotionSwipe = await page.evaluate(() => window.scrollY);
  await swipeUpFrom(context, page, motionCanvas);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBeforeMotionSwipe + 40);

  await page.getByTestId('generate-motion').click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('高画質 512px', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'プレビュー停止' })).toBeVisible();
  const firstMotionFrame = await motionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await expect.poll(
    () => motionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
    { timeout: 2_000, intervals: [100, 100, 150, 200] },
  ).not.toBe(firstMotionFrame);

  await page.getByTestId('step-nav-preview').click();
  await expect(page.getByLabel('モーション最終プレビュー')).toBeVisible();
  await page.getByRole('button', { name: '暗い' }).click();
  await page.getByLabel('向き').selectOption('left');

  await page.getByTestId('step-nav-export').click();
  await page.getByText('ZIPに入るファイル', { exact: true }).click();
  await expect(page.getByText('motion/sprite-sheet.png')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-motion-zip').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^content-studio-motion-[a-f0-9]{8}\.zip$/u);

  await page.getByRole('button', { name: '下書きを保存して終了' }).click();
  await expect(page.getByText('新しいモーション', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  await expect(page.getByText('新しいモーション', { exact: true }).first()).toBeVisible();

  await page.locator('.draft-card__open').filter({ hasText: '新しいモーション' }).first().click();
  await page.getByTestId('step-nav-motion').click();
  await expect(page.getByRole('button', { name: 'プレビュー停止' })).toBeVisible();
  const restoredMotionCanvas = page.getByLabel('砲撃モーションプレビュー');
  const restoredFirstFrame = await restoredMotionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await expect.poll(
    () => restoredMotionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
    { timeout: 2_000, intervals: [100, 100, 150, 200] },
  ).not.toBe(restoredFirstFrame);
  await page.getByRole('button', { name: 'ダッシュボードへ戻る' }).click();

  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  await expect(page.getByText('新しいモーション', { exact: true }).first()).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('通信が復帰しました。未送信の変更を再送できます。')).toBeVisible();

  expect(runtimeErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
