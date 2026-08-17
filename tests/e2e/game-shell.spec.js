const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html';
const VIRTUAL_WIDTH = 540;
const VIRTUAL_HEIGHT = 960;

async function gameState(page) {
  return page.evaluate(() => globalThis.KatamonCustomStageBridge?.getState() || null);
}

async function tapVirtualCanvas(page, x, y) {
  const canvas = page.getByTestId('battle-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'ゲームcanvasの表示領域が必要').not.toBeNull();
  await page.touchscreen.tap(
    box.x + box.width * x / VIRTUAL_WIDTH,
    box.y + box.height * y / VIRTUAL_HEIGHT,
  );
}

async function openTitle(page) {
  await page.goto(GAME_URL);
  await expect.poll(() => gameState(page)).toMatchObject({ gamePhase: 'press' });
  await tapVirtualCanvas(page, VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2);
  await expect.poll(() => gameState(page), { timeout: 15_000 }).toMatchObject({ gamePhase: 'title' });
}

test.describe('カタモン本体の基本導線', () => {
  test('タイトル、CPU開始、演習、チュートリアルでページエラーを出さない', async ({ page }) => {
    // この環境のMobile WebKitは、巨大な本体canvasを初回読込する前にプロセスごと
    // 落ちる。ゲームscriptのpageerrorではなくブラウザクラッシュなので、本体導線は
    // 実行できるAndroid Chromiumで検証する。WebKit自体は既存Stage Studio E2Eで維持する。
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Mobile WebKit crashes before the game shell loads in this environment.');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openTitle(page);
    await tapVirtualCanvas(page, 270, 538); // CPU BATTLE
    await expect.poll(() => gameState(page)).toMatchObject({ gamePhase: 'select' });
    await tapVirtualCanvas(page, 438, 454); // 選択中キャラで出撃
    await expect.poll(() => gameState(page), { timeout: 15_000 }).toMatchObject({ gamePhase: 'battle', battleMode: 'normal' });

    await openTitle(page);
    await tapVirtualCanvas(page, 374, 700); // 演習
    await expect.poll(() => gameState(page)).toMatchObject({ gamePhase: 'freeSetup' });

    await openTitle(page);
    await tapVirtualCanvas(page, 169, 700); // チュートリアル
    await expect.poll(() => gameState(page), { timeout: 15_000 }).toMatchObject({ gamePhase: 'battle', battleMode: 'tutorial' });

    expect(pageErrors, `本体画面でpageerrorが発生: ${pageErrors.join(' | ')}`).toEqual([]);
    await page.goto('about:blank');
  });
});
