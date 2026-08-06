import { expect, test, type Page } from '@playwright/test';
import { basename } from 'node:path';

async function attachSyntheticCharacter(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvasを初期化できませんでした。');
    for (let y = 0; y < 96; y += 8) {
      for (let x = 0; x < 96; x += 8) {
        context.fillStyle = ((x + y) / 8) % 2 === 0 ? '#f6f6f6' : '#e8e8e8';
        context.fillRect(x, y, 8, 8);
      }
    }
    context.fillStyle = '#e6a51c';
    context.beginPath();
    context.arc(48, 43, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#243347';
    context.fillRect(26, 62, 44, 18);
    context.fillStyle = '#35d7de';
    context.fillRect(34, 68, 28, 5);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNGを作成できませんでした。')), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'sample-character.png', { type: 'image/png', lastModified: Date.now() }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="image-input"]');
    if (!input) throw new Error('画像入力が見つかりませんでした。');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('Android縦画面で画像登録からモックPR、再開、オフライン復旧まで完走する', async ({ page, context }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  const manifest = await page.evaluate(async () => fetch('./manifest.webmanifest').then((response) => response.json()));
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.share_target.action).toContain('share-target=1');
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    expect.objectContaining({ purpose: 'maskable' }),
  ]));
  await page.getByTestId('add-character').click();
  await expect(page.getByTestId('step-image')).toBeVisible();

  const localSample = process.env.CONTENT_STUDIO_E2E_SAMPLE?.trim();
  if (localSample) await page.getByTestId('image-input').setInputFiles(localSample);
  else await attachSyntheticCharacter(page);
  await expect(page.getByText(localSample ? basename(localSample) : 'sample-character.png')).toBeVisible();
  await expect(page.getByText('市松模様の焼き込み候補あり')).toBeVisible();

  await page.getByTestId('step-nav-cutout').click();
  await page.getByRole('button', { name: '自動背景除去' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();
  await page.getByRole('button', { name: '余白を自動トリム' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();
  await page.getByRole('button', { name: '変更を画像へ反映' }).click();
  await expect(page.getByRole('dialog', { name: '処理中' })).toBeHidden();

  await page.getByTestId('step-nav-motion').click();
  await page.getByTestId('generate-motion').click();
  await expect(page.getByText(/8枚 \/ /)).toBeVisible();

  await page.getByTestId('step-nav-details').click();
  await page.getByTestId('character-id').fill('sample-unit');
  await page.getByTestId('character-slug').fill('sample-unit');
  await page.getByTestId('display-name').fill('サンプルキャラクター');

  await page.getByTestId('step-nav-skills').click();
  await page.getByTestId('special-name').fill('サンプルショット');
  await page.getByTestId('special-template').selectOption('single');

  await page.getByTestId('step-nav-preview').click();
  await expect(page.getByLabel('ゲーム内プレビュー')).toBeVisible();
  await page.getByRole('button', { name: '暗い' }).click();
  await page.getByLabel('向き').selectOption('right');

  await page.getByTestId('step-nav-validate').click();
  await page.getByTestId('run-validation').click();
  await expect(page.getByText('検証に合格しました')).toBeVisible();

  await page.getByTestId('step-nav-publish').click();
  await expect(page.getByText('モック接続')).toBeVisible();
  await page.getByTestId('prepare-change').click();
  await expect(page.getByText('success', { exact: true })).toBeVisible();
  await page.getByTestId('create-pr').click();
  await expect(page.getByTestId('step-complete')).toBeVisible();
  await expect(page.getByRole('heading', { name: '登録準備が完了しました' })).toBeVisible();
  await expect(page.getByText(/^#\d+$/)).toBeVisible();

  await page.getByTestId('step-complete').getByRole('button', { name: 'ダッシュボードへ戻る' }).click();
  await expect(page.getByText('サンプルキャラクター', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Content Studio', exact: true })).toBeVisible();
  await expect(page.getByText('サンプルキャラクター', { exact: true }).first()).toBeVisible();

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
