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

async function openTitle(page, url = GAME_URL) {
  await page.goto(url);
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

  test('協力MVPの入口・ショップ・実績がスマホ内へ収まり、公開OFF画面へ直ボタンを増やさない', async ({ page }) => {
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Mobile WebKit crashes before the game shell loads in this environment.');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openTitle(page);
    await expect(page.locator('#coopBossLobby')).toHaveCount(0);
    await expect(page.locator('#mvpCollection')).toHaveCount(0);
    await tapVirtualCanvas(page, 270, 619);
    await expect(page.locator('#onlineLobby')).not.toHaveClass(/coop-choice/);
    await expect(page.locator('#onlineKindActions')).toBeHidden();
    await page.locator('#onlineCancel').click();

    await openTitle(page, `${GAME_URL}?coopMvp=1`);
    await expect(page.locator('#titleCoopBtn')).toHaveCount(0);
    await tapVirtualCanvas(page, 270, 619); // ONLINE BATTLE
    await expect(page.locator('#onlineLobby')).toHaveClass(/open.*coop-choice|coop-choice.*open/);
    await expect(page.locator('#onlineLobbyNote')).toContainText('通常対戦の部屋と協力ボスの部屋は別々');
    await expect(page.getByRole('button', { name: /協力ボス/ })).toBeVisible();
    await page.locator('#onlineCoopKind').click();
    await expect(page.locator('#coopBossLobby')).toHaveClass(/open/);
    await expect(page.getByText('超大型要塞戦車')).toBeVisible();
    await page.locator('#coopClose').click();

    await tapVirtualCanvas(page, 378, 799); // おまけ
    await tapVirtualCanvas(page, 155, 734); // ショップ
    await expect(page.locator('#mvpCollection')).toHaveClass(/open/);
    const layout = await page.evaluate(() => {
      const scroll = document.querySelector('.mvp-scroll').getBoundingClientRect();
      const footer = document.querySelector('.mvp-foot').getBoundingClientRect();
      return { scrollBottom: scroll.bottom, footerTop: footer.top, footerBottom: footer.bottom, panelBottom: document.querySelector('.mvp-panel').getBoundingClientRect().bottom };
    });
    expect(layout.scrollBottom).toBeLessThanOrEqual(layout.footerTop + 1);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.panelBottom + 1);
    await page.locator('#mvpCollectionClose').click();
    await page.waitForTimeout(500); // DOMオーバーレイを閉じた同じ指のゴーストタップ防止が明けるまで待つ

    await tapVirtualCanvas(page, 378, 799); // ショップを閉じるとタイトルへ戻るため、おまけを開き直す
    await tapVirtualCanvas(page, 385, 734); // 実績
    await expect(page.locator('#mvpCollection')).toHaveClass(/open/);
    await expect(page.locator('.mvp-achievement')).toHaveCount(18);
    await expect(page.getByText('？？？')).toHaveCount(2);
    expect(pageErrors, `協力MVP画面でpageerrorが発生: ${pageErrors.join(' | ')}`).toEqual([]);
    await page.goto('about:blank');
  });
});
