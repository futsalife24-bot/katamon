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

async function openTerrainInspector(page, panelName) {
  const inspector = page.getByTestId('terrain-inspector');
  if (await inspector.isHidden()) await page.getByTestId('terrain-palette-toggle').click();
  await page.locator(`[data-terrain-panel="${panelName}"]`).click();
  await expect(page.locator(`[data-terrain-panel-content="${panelName}"]`)).toBeVisible();
  return inspector;
}

async function selectTerrainTool(page, selector) {
  const menu = page.getByTestId('terrain-tool-menu');
  if (await menu.isHidden()) await page.getByTestId('terrain-tool-menu-toggle').click();
  await expect(menu).toBeVisible();
  await page.locator(selector).click();
  await expect(menu).toBeHidden();
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

async function assertPlaytestMapAndControlsVisible(page, expectedScrollTop = null) {
  const metrics = await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="playtest"]');
    const canvas = document.querySelector('[data-testid="test-canvas"]');
    const dock = document.querySelector('[data-testid="playtest-controls"]');
    const asRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    return {
      screen: { ...asRect(screen), scrollTop: screen.scrollTop },
      map: asRect(canvas.closest('.canvas-card')),
      dock: asRect(dock),
      angle: asRect(document.querySelector('#shotAngle')),
      power: asRect(document.querySelector('#shotPower')),
      moveLeft: asRect(document.querySelector('#moveTestLeft')),
      fire: asRect(document.querySelector('#fireTest')),
      moveRight: asRect(document.querySelector('#moveTestRight')),
      reset: asRect(document.querySelector('#resetTest')),
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
    };
  });

  expect(metrics.noHorizontalOverflow, 'テスト操作帯で横スクロールを発生させない').toBe(true);
  expect(Math.abs(metrics.map.bottom - metrics.dock.top), '操作帯をマップ直下へ隙間なく接続する').toBeLessThanOrEqual(2);
  for (const name of ['map', 'dock', 'angle', 'power', 'moveLeft', 'fire', 'moveRight', 'reset']) {
    const rect = metrics[name];
    expect(rect.top, `${name}をテスト画面の上端より下に保つ`).toBeGreaterThanOrEqual(metrics.screen.top - 1);
    expect(rect.bottom, `${name}を下部ナビより上に保つ`).toBeLessThanOrEqual(metrics.screen.bottom + 1);
    expect(rect.left, `${name}を画面左端より内側に保つ`).toBeGreaterThanOrEqual(metrics.screen.left - 1);
    expect(rect.right, `${name}を画面右端より内側に保つ`).toBeLessThanOrEqual(metrics.screen.right + 1);
  }
  for (const name of ['moveLeft', 'fire', 'moveRight', 'reset']) {
    expect(metrics[name].height, `${name}のタップ領域は48px以上`).toBeGreaterThanOrEqual(48);
  }
  if (expectedScrollTop !== null) {
    expect(Math.abs(metrics.screen.scrollTop - expectedScrollTop), '移動・砲撃でマップ位置を動かさない').toBeLessThanOrEqual(2);
  }
  return metrics.screen.scrollTop;
}

async function assertTerrainWorkspaceVisible(page) {
  const metrics = await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="terrain"]');
    const workspace = document.querySelector('[data-testid="terrain-workspace"]');
    const map = document.querySelector('[data-testid="terrain-canvas"]').closest('.canvas-card');
    const tools = document.querySelector('[data-testid="terrain-tools"]');
    const stageControls = document.querySelector('[data-testid="terrain-stage-controls"]');
    const recovery = document.querySelector('#characterGuidePanel');
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    return {
      screen: rect(screen), workspace: rect(workspace), map: rect(map), tools: rect(tools), stageControls: rect(stageControls), recovery: rect(recovery),
      toolToggle: rect(document.querySelector('[data-testid="terrain-tool-menu-toggle"]')),
      undo: rect(document.querySelector('[data-testid="undo"]')),
      redo: rect(document.querySelector('[data-testid="redo"]')),
      snap: rect(document.querySelector('#snapCharacterGuides')),
      orientation: rect(document.querySelector('[data-testid="orientation-toggle"]')),
      palette: rect(document.querySelector('[data-testid="terrain-palette-toggle"]')),
      zoomOut: rect(document.querySelector('#zoomOut')),
      zoomIn: rect(document.querySelector('#zoomIn')),
      zoomReset: rect(document.querySelector('#zoomReset')),
      mapButtonCount: map.querySelectorAll('button').length,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
    };
  });
  expect(metrics.noHorizontalOverflow, '地形ワークスペースで横スクロールを発生させない').toBe(true);
  expect(metrics.mapButtonCount, 'ステージ画像内へ操作ボタンを重ねない').toBe(0);
  expect(Math.abs(metrics.map.bottom - metrics.tools.top), 'ツールをCanvas直下へ接続する').toBeLessThanOrEqual(3);
  expect(Math.abs(metrics.tools.bottom - metrics.recovery.top), 'キャラ補正をツール直下へ接続する').toBeLessThanOrEqual(3);
  for (const name of ['workspace', 'map', 'tools', 'stageControls', 'recovery', 'toolToggle', 'undo', 'redo', 'snap', 'orientation', 'palette', 'zoomOut', 'zoomIn', 'zoomReset']) {
    expect(metrics[name].left, `${name}を地形画面の左端より内側に保つ`).toBeGreaterThanOrEqual(metrics.screen.left - 1);
    expect(metrics[name].right, `${name}を地形画面の右端より内側に保つ`).toBeLessThanOrEqual(metrics.screen.right + 1);
  }
  for (const name of ['map', 'tools', 'recovery']) {
    expect(metrics[name].top, `${name}を地形画面の上端より下に保つ`).toBeGreaterThanOrEqual(metrics.screen.top - 1);
    expect(metrics[name].bottom, `${name}を下部ナビより上に保つ`).toBeLessThanOrEqual(metrics.screen.bottom + 1);
  }
  expect(metrics.orientation.top).toBeGreaterThanOrEqual(metrics.map.bottom - 1);
  expect(metrics.palette.top).toBeGreaterThanOrEqual(metrics.map.bottom - 1);
  for (const name of ['toolToggle', 'undo', 'redo', 'snap', 'orientation', 'palette', 'zoomOut', 'zoomIn', 'zoomReset']) {
    expect(metrics[name].height, `${name}のタップ領域は48px以上`).toBeGreaterThanOrEqual(47.9);
  }
}

async function createValidatedStage(page, options = {}) {
  await page.goto(STUDIO_URL);
  await expect(page.getByTestId('stage-studio')).toBeVisible();
  await expect(page.getByTestId('screen-home')).toBeVisible();
  await expect(page.locator('#appVersion')).toContainText('1.4.0-mvp');
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
  await expect(page.getByTestId('terrain-tools')).toBeVisible();
  await expect(page.getByTestId('terrain-inspector')).toBeHidden();
  await assertTerrainWorkspaceVisible(page);
  await page.getByTestId('terrain-palette-toggle').click();
  await expect(page.locator('#terrainPanelBrush')).toBeVisible();
  await page.locator('#brushSize').evaluate((input) => {
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByTestId('terrain-inspector')).toBeHidden();
  await expect(page.getByTestId('terrain-tool-menu')).toBeHidden();
  await selectTerrainTool(page, '#toolDraw');
  await tapCanvas(page, terrainCanvas, 0.5, 0.62);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await selectTerrainTool(page, '#toolErase');
  await tapCanvas(page, terrainCanvas, 0.52, 0.62);
  await page.getByTestId('undo').click();
  await page.getByTestId('redo').click();
  if (options.advancedEditing) {
    await selectTerrainTool(page, '#toolLine');
    await dragCanvas(page, terrainCanvas, 0.22, 0.42, 0.36, 0.46);
    await openTerrainInspector(page, 'shape');
    await expect(page.locator('#terrainPanelShape')).toBeVisible();
    await page.locator('#smoothTerrain').click();
    await openTerrainInspector(page, 'shape');
    await page.locator('#mirrorTerrain').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('redo').click();
  }
  await expect(page.locator('#terrainMaterial option[value="steel"]')).toHaveAttribute('disabled', '');
  await expect(page.locator('#backgroundMode')).toHaveValue('theme');
  await openTerrainInspector(page, 'appearance');
  await page.locator('#themeSelect').selectOption('grass');
  await expect(page.getByTestId('terrain-inspector')).toBeHidden();
  if (options.advancedEditing) {
    await openTerrainInspector(page, 'brush');
    await expect(page.locator('#terrainPanelAppearance')).toBeHidden();
    await page.locator('#brushHardness').evaluate((input) => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByTestId('terrain-inspector')).toBeHidden();
    await selectTerrainTool(page, '#toolGuide');
    await dragCanvas(page, terrainCanvas, 0.28, 0.5, 0.28, 0.72);
    await expect(page.locator('#characterGuideHint')).toHaveAttribute('data-state', 'warning');
    await expect(page.locator('#snapCharacterGuides')).toBeEnabled();
    await page.locator('#snapCharacterGuides').click();
    await expect(page.locator('#characterGuideHint')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('#snapCharacterGuides')).toBeDisabled();
    await expect(page.locator('#activeTerrainTool')).toHaveText('キャラ確認');
    await assertTerrainWorkspaceVisible(page);
  }

  await goToStep(page, 'spawns');
  await expect(page.getByTestId('spawn-canvas')).toBeVisible();
  await page.locator('#spawnCount').selectOption('2');
  await page.locator('#autoPlaceSpawns').click();

  await goToStep(page, 'playtest');
  await expect(page.getByTestId('test-canvas')).toBeVisible();
  await expect(page.getByTestId('playtest-controls')).toBeVisible();
  await assertPlaytestMapAndControlsVisible(page);
  await page.locator('#windEnabled').check();
  await page.locator('#windDirection').selectOption('1');
  await page.locator('#windStrength').fill('35');
  const playtestScrollTop = await assertPlaytestMapAndControlsVisible(page);
  await page.locator('#shotAngle').fill('45');
  await assertPlaytestMapAndControlsVisible(page, playtestScrollTop);
  await page.locator('#shotPower').fill('65');
  await assertPlaytestMapAndControlsVisible(page, playtestScrollTop);
  await page.locator('#moveTestLeft').click();
  await expect(page.locator('#testResult')).toContainText(/左右移動|落下/);
  await assertPlaytestMapAndControlsVisible(page, playtestScrollTop);
  await page.getByTestId('test-play').click();
  await expect(page.locator('#testResult')).not.toContainText('角度と威力を決めて', { timeout: 15_000 });
  await assertPlaytestMapAndControlsVisible(page, playtestScrollTop);

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

async function openCustomStageManager(page) {
  const launcher = page.getByTestId('custom-stage-button');
  const canvas = page.getByTestId('battle-canvas');
  // 本編の開始演出より先に固定ボタンを見せない。タイトルにも常駐させず、
  // 演習設定へ入った時だけカスタムステージ管理を出す。
  await expect.poll(() => page.evaluate(() => globalThis.KatamonCustomStageBridge?.getState().gamePhase)).toBe('press');
  await expect(launcher).toBeHidden();
  await tapCanvas(page, canvas, 0.5, 0.5);
  await expect.poll(() => page.evaluate(() => globalThis.KatamonCustomStageBridge?.getState().gamePhase), { timeout: 15_000 }).toBe('title');
  await expect(launcher).toBeHidden();
  await page.evaluate(() => globalThis.CustomStageManager.open());
  await expect(page.locator('#customStageOverlay')).toBeVisible();
}

async function importIntoGameAndStart(page, filePath) {
  await page.goto(GAME_URL);
  await openCustomStageManager(page);
  await page.getByTestId('custom-stage-import').setInputFiles(filePath);

  const list = page.getByTestId('custom-stage-list');
  await expect(list).toContainText(TITLE);
  await page.reload();
  await openCustomStageManager(page);
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
  // Stop the game's continuous rendering/audio loops before Playwright closes
  // the mobile WebKit context. This keeps teardown deterministic on Windows.
  await page.goto('about:blank');
}

test.describe('Stage Studio モバイル作成フロー', () => {
  test('横画面では地形・出撃・テストの操作をマップ横へまとめる', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(`${STUDIO_URL}#terrain`);
    await expect(page.getByTestId('stage-studio')).toBeVisible();
    await expect(page.getByTestId('orientation-toggle')).toContainText('縦画面');

    const readLayout = async (screenName, controlSelector) => page.evaluate(({ screenName, controlSelector }) => {
      const root = document.querySelector(`[data-screen="${screenName}"]`);
      const map = root.querySelector('.canvas-card').getBoundingClientRect();
      const controls = root.querySelector(controlSelector).getBoundingClientRect();
      const orientation = root.querySelector('[data-orientation-toggle]').getBoundingClientRect();
      const mapButtonCount = root.querySelector('.canvas-card').querySelectorAll('button').length;
      const screen = root.getBoundingClientRect();
      return {
        map: { left: map.left, right: map.right, top: map.top, bottom: map.bottom },
        controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom },
        orientation: { left: orientation.left, right: orientation.right, top: orientation.top, bottom: orientation.bottom, height: orientation.height },
        mapButtonCount,
        screen: { left: screen.left, right: screen.right, top: screen.top, bottom: screen.bottom },
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
      };
    }, { screenName, controlSelector });

    const assertLandscapeLayout = (layout, label) => {
      expect(layout.noHorizontalOverflow, `${label}で横スクロールを出さない`).toBe(true);
      expect(layout.mapButtonCount, `${label}のステージ画像内へ操作ボタンを重ねない`).toBe(0);
      expect(Math.abs(layout.map.right - layout.controls.left), `${label}の操作をマップ横へ接続する`).toBeLessThanOrEqual(12);
      expect(layout.orientation.left, `${label}の回転ボタンを操作欄内に置く`).toBeGreaterThanOrEqual(layout.controls.left - 1);
      expect(layout.orientation.right, `${label}の回転ボタンを操作欄内に置く`).toBeLessThanOrEqual(layout.controls.right + 1);
      expect(layout.orientation.top).toBeGreaterThanOrEqual(layout.controls.top - 1);
      expect(layout.orientation.bottom).toBeLessThanOrEqual(layout.controls.bottom + 1);
      expect(layout.orientation.height, `${label}の回転ボタンを48px以上にする`).toBeGreaterThanOrEqual(48);
    };

    assertLandscapeLayout(await readLayout('terrain', '[data-testid="terrain-tools"]'), '地形');
    await goToStep(page, 'spawns');
    assertLandscapeLayout(await readLayout('spawns', '.panel.form-grid.compact'), '出撃');
    await goToStep(page, 'playtest');
    assertLandscapeLayout(await readLayout('playtest', '[data-testid="playtest-controls"]'), 'テスト');
  });

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
