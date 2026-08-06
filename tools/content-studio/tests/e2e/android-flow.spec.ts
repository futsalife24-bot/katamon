import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { basename } from 'node:path';

async function attachSyntheticCharacter(
  page: Page,
  selector = '[data-testid="image-input"]',
  fileName = 'sample-character.png',
  hitVariant = false,
): Promise<void> {
  await page.evaluate(async ({ selector: inputSelector, fileName: name, hitVariant: isHit }) => {
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
    if (isHit) {
      context.fillStyle = '#f4f7fb';
      context.fillRect(48, 43, 10, 4);
      context.fillRect(68, 43, 10, 4);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNGを作成できませんでした。')), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: 'image/png', lastModified: Date.now() }));
    const input = document.querySelector<HTMLInputElement>(inputSelector);
    if (!input) throw new Error('画像入力が見つかりませんでした。');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, fileName, hitVariant });
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

test('Android縦画面で5モーション生成、固定操作、モック反映、再開まで完走する', async ({ page, context }) => {
  test.setTimeout(180_000);
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

  if (localSample) await page.getByTestId('hit-image-input').setInputFiles(localSample);
  else await attachSyntheticCharacter(page, '[data-testid="hit-image-input"]', 'sample-hit-character.png', true);
  await expect(page.getByTestId('hit-image-card')).toContainText(localSample ? basename(localSample) : 'sample-hit-character.png');

  const cutoutCanvas = page.locator('canvas[aria-label="背景除去後"]');
  await expect(cutoutCanvas).toBeVisible();
  const scrollBeforeCutoutSwipe = await page.evaluate(() => window.scrollY);
  await swipeUpFrom(context, page, cutoutCanvas);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBeforeCutoutSwipe + 40);
  await page.getByRole('button', { name: '自動背景除去' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();
  await page.getByRole('button', { name: '余白を自動トリム' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();

  await page.getByTestId('step-nav-setup').click();
  await expect(page.getByTestId('landmark-canvas')).toBeVisible();
  await page.getByTestId('facing-right').click();
  await page.getByTestId('detect-landmarks').click();
  await page.getByRole('button', { name: '接地点', exact: true }).click();
  const landmarkCanvas = page.getByTestId('landmark-canvas');
  const landmarkBox = await landmarkCanvas.boundingBox();
  if (!landmarkBox) throw new Error('位置調整画像を取得できませんでした。');
  await landmarkCanvas.tap({ position: { x: landmarkBox.width * 0.5, y: landmarkBox.height * 0.9 } });
  await page.getByRole('button', { name: '砲口', exact: true }).click();
  await landmarkCanvas.tap({ position: { x: landmarkBox.width * 0.82, y: landmarkBox.height * 0.5 } });

  await page.getByTestId('step-nav-motion').click();
  await expect(page.getByTestId('step-motion').locator('input[type="range"]')).toHaveCount(0);
  const generateButton = page.getByTestId('generate-motion');
  await expect(generateButton).toBeVisible();
  expect(await generateButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  })).toBe(true);

  await generateButton.click();
  await expect(page.getByTestId('generate-motion')).toHaveText('5種類を再生成', { timeout: 120_000 });
  await expect(page.locator('.motion-batch-list article.is-complete')).toHaveCount(5);
  const motionCanvas = page.getByLabel('前進プレビュー');
  await expect(page.getByRole('button', { name: 'プレビュー停止' })).toBeVisible();
  const firstMotionFrame = await motionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await expect.poll(
    () => motionCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
    { timeout: 2_000, intervals: [100, 100, 150, 200] },
  ).not.toBe(firstMotionFrame);

  await page.getByTestId('preview-fire').click();
  await expect(page.getByLabel('単発砲撃プレビュー')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.getByTestId('generate-motion').evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  })).toBe(true);

  await page.getByTestId('step-nav-character').click();
  await page.getByTestId('display-name').fill('サンプルキャラクター');
  await page.getByTestId('character-id').fill('sample-unit');
  await expect(page.getByText('未設定（ボタン無効）')).toBeVisible();

  await page.getByTestId('step-nav-publish').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'モーションZIP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^content-studio-motions-[a-f0-9]{8}\.zip$/u);

  await page.getByTestId('publish-mode-merge').click();
  await page.getByTestId('prepare-change').click();
  await expect(page.getByText('自動テスト', { exact: true })).toBeVisible({ timeout: 60_000 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('create-pr').click();
  await expect(page.getByTestId('publish-complete')).toContainText('PRを作成してマージしました', { timeout: 60_000 });

  await page.getByRole('button', { name: '保存して終了' }).click();
  await expect(page.getByText('サンプルキャラクター', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  await expect(page.getByText('サンプルキャラクター', { exact: true }).first()).toBeVisible();

  await page.locator('.draft-card__open').filter({ hasText: 'サンプルキャラクター' }).first().click();
  await page.getByTestId('step-nav-image').click();
  await expect(page.getByTestId('hit-image-card')).toContainText(localSample ? basename(localSample) : 'sample-hit-character.png');
  await page.getByTestId('step-nav-motion').click();
  await expect(page.getByRole('button', { name: 'プレビュー停止' })).toBeVisible();
  await page.getByTestId('preview-fire').click();
  const restoredMotionCanvas = page.getByLabel('単発砲撃プレビュー');
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
  await expect(page.getByText('サンプルキャラクター', { exact: true }).first()).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('通信が復帰しました。未送信の変更を再送できます。')).toBeVisible();

  expect(runtimeErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
