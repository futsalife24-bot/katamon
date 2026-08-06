const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const STUDIO_URL = '/tools/stage-studio/';
const GAME_URL = '/index.html';
const TITLE = 'E2Eサンプルステージ';
const SEED = 'stage-studio-e2e-20260806';
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');

const STATIC_CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
});

async function startOfflineTestServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filePath = path.resolve(REPOSITORY_ROOT, pathname.replace(/^\/+/, ''));
      if (!filePath.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': STATIC_CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream'
      });
      response.end(body);
    } catch (_) {
      response.writeHead(404);
      response.end('Not Found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('一時HTTPサーバーを開始できませんでした。');
  return {
    server,
    studioUrl: `http://127.0.0.1:${address.port}/tools/stage-studio/`
  };
}

async function stopOfflineTestServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function activeScreen(page, name) {
  const screen = page.locator(`[data-screen="${name}"]`);
  await expect(screen).toBeVisible();
  return screen;
}

async function goToStep(page, name) {
  await page.locator(`[data-step="${name}"]`).click();
  return activeScreen(page, name);
}

async function tapCanvas(page, locator, xRatio, yRatio) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, '編集キャンバスの表示領域が必要').not.toBeNull();
  await page.touchscreen.tap(
    box.x + box.width * xRatio,
    box.y + box.height * yRatio
  );
}

async function dragCanvas(page, locator, fromXRatio, fromYRatio, toXRatio, toYRatio) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, '編集キャンバスの表示領域が必要').not.toBeNull();
  await page.mouse.move(
    box.x + box.width * fromXRatio,
    box.y + box.height * fromYRatio
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * toXRatio,
    box.y + box.height * toYRatio,
    { steps: 8 }
  );
  await page.mouse.up();
}

async function createValidatedStage(page, options = {}) {
  await page.goto(STUDIO_URL);
  await expect(page.getByTestId('stage-studio')).toBeVisible();
  await expect(page.getByTestId('screen-home')).toBeVisible();
  await expect(page.locator('#appVersion')).toContainText('1.1.0-mvp');
  await expect(page.locator('#updateNotice')).toBeHidden();
  await expect(page.locator('.step-tab')).toHaveCount(8);
  await expect(page.locator('.usage-panel')).toBeVisible();
  await expect(page.locator('.usage-panel')).toContainText('対象ゲームへインポート');
  await expect(page.locator('.usage-panel')).not.toHaveAttribute('open');
  const usageBeforeDeviceState = await page.locator('.usage-panel').evaluate((usage, stats) => (
    usage.compareDocumentPosition(document.querySelector(stats)) & Node.DOCUMENT_POSITION_FOLLOWING
  ) !== 0, '.stats-panel');
  expect(usageBeforeDeviceState, '利用方法を端末の状態より先に表示する').toBe(true);

  const mobileLayout = await page.evaluate(() => {
    const navRect = document.querySelector('.step-nav').getBoundingClientRect();
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      noVerticalOverflow: document.documentElement.scrollHeight <= window.innerHeight + 1,
      navBottom: navRect.bottom,
      viewportBottom: window.innerHeight
    };
  });
  expect(mobileLayout.noHorizontalOverflow, '縦画面でページ全体の横スクロールを出さない').toBe(true);
  expect(mobileLayout.noVerticalOverflow, '縦画面で主要導線を画面外へ押し出さない').toBe(true);
  expect(mobileLayout.navBottom, '下部ステップナビを画面内に保つ').toBeLessThanOrEqual(mobileLayout.viewportBottom + 1);

  const newStageButton = page.getByTestId('new-stage');
  const newStageBox = await newStageButton.boundingBox();
  expect(newStageBox.height, '主要操作のタップ領域は48px以上').toBeGreaterThanOrEqual(48);
  await newStageButton.click();

  await activeScreen(page, 'new');
  await page.locator('#stageTitle').fill(TITLE);
  await page.locator('#stageAuthor').fill('作成者');
  await page.locator('#stageDescription').fill('モバイルE2Eで作成する検証用ステージ');
  await page.locator('#startPreset').click();

  await activeScreen(page, 'generate');
  await page.getByTestId('preset-select').selectOption('rolling');
  await page.getByTestId('seed-input').fill(SEED);
  await page.locator('#reliefRange').fill('68');
  await page.locator('#smoothRange').fill('57');
  await page.locator('#platformRange').fill('3');
  await page.locator('#densityRange').fill('81');
  await page.locator('#valleyRange').fill('64');
  await page.locator('#mountainRange').fill('5');
  await page.locator('#cavityRange').fill('9');
  await page.locator('#difficultyRange').fill('73');
  await page.getByTestId('generate-stage').click();

  const terrainCanvas = page.getByTestId('terrain-canvas');
  await expect(terrainCanvas).toBeVisible();
  await page.getByTestId('tool-draw').click();
  await tapCanvas(page, terrainCanvas, 0.5, 0.62);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.getByTestId('tool-erase').click();
  await tapCanvas(page, terrainCanvas, 0.52, 0.62);
  await page.getByTestId('undo').click();
  await page.getByTestId('redo').click();
  if (options.advancedEditing) {
    await page.locator('#toolLine').click();
    await dragCanvas(page, terrainCanvas, 0.22, 0.42, 0.36, 0.46);
    await page.locator('#smoothTerrain').click();
    await page.locator('#mirrorTerrain').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('redo').click();
  }
  await expect(page.locator('#terrainMaterial option[value="steel"]')).toHaveAttribute('disabled', '');
  await expect(page.locator('#backgroundMode')).toHaveValue('theme');
  await page.locator('#themeSelect').selectOption('grass');
  await page.locator('#brightnessRange').fill('100');
  if (options.advancedEditing) {
    await page.locator('#toolGuide').click();
    await dragCanvas(page, terrainCanvas, 0.28, 0.5, 0.28, 0.72);
    await expect(page.locator('#characterGuideHint')).toHaveAttribute('data-state', 'warning');
  }

  await goToStep(page, 'spawns');
  await expect(page.getByTestId('spawn-canvas')).toBeVisible();
  await page.locator('#spawnCount').selectOption('2');
  await page.locator('#autoPlaceSpawns').click();

  await goToStep(page, 'playtest');
  await page.locator('#windEnabled').check();
  await page.locator('#windDirection').selectOption('1');
  await page.locator('#windStrength').fill('35');
  await page.locator('#shotAngle').fill('45');
  await page.locator('#shotPower').fill('65');
  await page.getByTestId('test-play').click();
  await expect(page.locator('#testResult')).not.toContainText('角度と威力を決めて', { timeout: 15_000 });

  await goToStep(page, 'validate');
  await page.getByTestId('validate-stage').click();
  await expect(page.getByTestId('validation-summary')).toContainText(/エラー\s*0|問題ありません|共有できます/);
  await expect(page.locator('#validationErrors')).not.toContainText(/修正してください|不正|不足/);

  await goToStep(page, 'export');
  await expect(page.locator('#exportStageTitle')).toHaveText(TITLE);
  await expect(page.locator('#exportHash')).toContainText(/[a-f0-9]{64}/i);
}

async function exportStage(page, format, testInfo) {
  const testId = format === 'json' ? 'export-json' : 'export-zip';
  const expectedSuffix = format === 'json' ? '.stage.json' : '.stage.zip';
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId(testId).click();
  const download = await downloadPromise;
  const escapedSuffix = expectedSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(download.suggestedFilename()).toMatch(new RegExp(`${escapedSuffix}$`));
  const savedPath = testInfo.outputPath(`stage-export${expectedSuffix}`);
  await download.saveAs(savedPath);
  return savedPath;
}

async function importIntoGameAndStart(page, filePath) {
  await page.goto(GAME_URL);
  await page.getByTestId('custom-stage-button').click();
  await page.getByTestId('custom-stage-import').setInputFiles(filePath);

  const list = page.getByTestId('custom-stage-list');
  await expect(list).toContainText(TITLE);
  await page.reload();
  await page.getByTestId('custom-stage-button').click();
  await expect(page.getByTestId('custom-stage-list')).toContainText(TITLE);
  const card = page.getByTestId('custom-stage-card').filter({ hasText: TITLE }).first();
  await expect(card).toContainText(/[a-f0-9]{12,64}/i);
  await card.getByTestId('custom-stage-select').click();
  await expect(page.getByTestId('custom-battle-start')).toBeEnabled();
  await page.getByTestId('custom-battle-start').click();
  await expect(page.getByTestId('battle-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.KatamonCustomStageBridge?.getState().gamePhase
  ))).toBe('battle');
}

test.describe('Stage Studio モバイル縦フロー', () => {
  test('プリセット生成、タッチ編集、共有物理、検証、JSON、ゲーム開始', async ({ page }, testInfo) => {
    await createValidatedStage(page, { advancedEditing: true });
    const jsonPath = await exportStage(page, 'json', testInfo);
    const stage = JSON.parse(await fs.readFile(jsonPath, 'utf8'));

    expect(stage.title).toBe(TITLE);
    expect(stage.seed).toBe(SEED);
    expect(stage.terrain.encoding).toBe('column-segments-v1');
    expect(stage.terrain.columns).toHaveLength(480);
    expect(stage.spawnPoints).toHaveLength(2);
    expect(stage.generation.parameters).toMatchObject({
      elevation: 0.68,
      density: 0.81,
      platformCount: 3,
      valleyDepth: 0.64,
      mountainCount: 5,
      cavityRate: 0.09,
      smoothness: 0.57,
      difficulty: 0.73
    });
    expect(stage.checksums.algorithm).toBe('SHA-256');
    expect(stage.checksums.contentHash).toMatch(/^[a-f0-9]{64}$/);

    await importIntoGameAndStart(page, jsonPath);
  });

  test('ZIPを書き出し、対象ゲームへインポートして開始できる', async ({ page }, testInfo) => {
    await createValidatedStage(page);
    const zipPath = await exportStage(page, 'zip', testInfo);
    const bytes = await fs.readFile(zipPath);

    expect(bytes.length).toBeGreaterThan(64);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    await importIntoGameAndStart(page, zipPath);
  });

  test('自動保存した下書きを再読込後も復元する', async ({ page }) => {
    await createValidatedStage(page);
    await expect(page.locator('#saveState')).toContainText(/保存済み|自動保存/, { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('stage-studio')).toBeVisible();
    await goToStep(page, 'home');
    await expect(page.getByTestId('draft-list')).toContainText(TITLE);
    await page.locator('#resumeDraftButton').click();
    await expect(page.locator('#stageTitle')).toHaveValue(TITLE);
    await goToStep(page, 'home');
    await expect(page.getByTestId('draft-list')).toContainText(TITLE);
  });

  test('PWAアプリシェルをオフラインで再表示できる', async ({ page, request }) => {
    const offlineServer = await startOfflineTestServer();
    let serverRunning = true;
    try {
      const manifestResponse = await request.get(`${offlineServer.studioUrl}manifest.webmanifest`);
      expect(manifestResponse.ok()).toBe(true);
      const manifest = await manifestResponse.json();
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBeTruthy();
      expect(manifest.icons.length).toBeGreaterThan(0);

      await page.goto(offlineServer.studioUrl);
      await expect(page.getByTestId('stage-studio')).toBeVisible();
      await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) throw new Error('Service Worker非対応');
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await expect(page.getByTestId('stage-studio')).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

      await stopOfflineTestServer(offlineServer.server);
      serverRunning = false;
      await page.reload();
      await expect(page.getByTestId('stage-studio')).toBeVisible();
      await expect(page.locator('#offlineNotice')).toBeVisible();
    } finally {
      if (serverRunning) await stopOfflineTestServer(offlineServer.server);
    }
  });
});
