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
  test('協力ボスの味方AI3席を縦画面で選び、席別設定へ保存する', async ({ page }) => {
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Mobile WebKit crashes before the game shell loads in this environment.');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/tests/fixtures/coop-ai-roster-visual.html?coopMvp=1');
    await expect(page.locator('body')).toHaveAttribute('data-qa-ready', 'true');
    await page.locator('#coopCreate').click();
    await expect(page.locator('#coopRoom')).toBeVisible();
    await expect(page.locator('#coopAiRoster')).toBeVisible();
    await expect(page.locator('#coopAiRoster select')).toHaveCount(3);
    await page.locator('#coopAiCharacterE1').selectOption('tori');
    await page.locator('#coopAiCharacterS1').selectOption('iwa');
    await page.locator('#coopAiCharacterS2').selectOption('medama');
    await expect.poll(() => page.evaluate(() => globalThis.qaRoom()?.settings?.aiCharacters)).toEqual({
      e1: 'tori', s1: 'iwa', s2: 'medama',
    });
    const layout = await page.locator('#coopAiRoster').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: innerWidth };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(pageErrors, `AI編成画面でpageerrorが発生: ${pageErrors.join(' | ')}`).toEqual([]);
  });

  test('協力4vs1 fixtureが通常対戦エンジン上で5体・大型立体鋼鉄として起動する', async ({ page }) => {
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Mobile WebKit crashes before the game shell loads in this environment.');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/tests/fixtures/coop-battle-visual.html');
    await expect(page.locator('body')).toHaveAttribute('data-qa-started', 'true', { timeout: 20_000 });
    await expect.poll(() => page.locator('#gameFrame').evaluate((frame) => (
      frame.contentWindow.KatamonCoopBridge?.getNormalBattleState?.() || null
    )), { timeout: 20_000 }).toMatchObject({
      active: true,
      phase: 'playing',
      activeUnitId: 'p1',
      stageW: 2160,
      stageH: 960,
      terrainPattern: 'coopSteel',
      craterCount: 0,
      turnLimit: 100,
      salvo: { phase: 'collecting', ready: 0, total: 4 },
      turnOrder: ['p1', 'e1', 'p2', 'e2', 'boss1'],
    });
    const state = await page.locator('#gameFrame').evaluate((frame) => frame.contentWindow.KatamonCoopBridge.getNormalBattleState());
    expect(state.units).toHaveLength(5);
    expect(state.elevatedTerrainColumns).toBeGreaterThan(200);
    expect(state.units.filter((unit) => unit.team === 'player')).toHaveLength(4);
    expect(state.units.find((unit) => unit.id === 'boss1')).toMatchObject({ team: 'cpu', phase: 1 });
    const coopCanvas = page.frameLocator('#gameFrame').getByTestId('battle-canvas');
    await expect(coopCanvas).toBeVisible();
    await expect.poll(() => page.locator('#gameFrame').evaluate((frame) => (
      frame.contentWindow.KatamonCoopBridge.getNormalBattleState().inputReady
    )), { timeout: 20_000 }).toBe(true);
    const box = await coopCanvas.boundingBox();
    expect(box).not.toBeNull();
    const virtual = (x, y) => ({ x: box.x + box.width * x / VIRTUAL_WIDTH, y: box.y + box.height * y / VIRTUAL_HEIGHT });
    const origin = virtual(270, 810);
    const pull = virtual(135, 850);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(pull.x, pull.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.locator('#gameFrame').evaluate((frame) => {
      const salvo = frame.contentWindow.KatamonCoopBridge.getNormalBattleState().salvo;
      return salvo?.phase === 'collecting' && salvo?.ownGuideVisible === true;
    }), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => page.locator('#gameFrame').evaluate((frame) => (
      frame.contentWindow.KatamonCoopBridge.getNormalBattleState()
    )), { timeout: 30_000 }).toMatchObject({
      activeUnitId: 'boss1',
      turnCount: 4,
      salvo: { phase: 'complete', ready: 4, total: 4, ownGuideVisible: false, launchTicks: [0, 18, 36, 54] },
    });
    await expect.poll(() => page.locator('#gameFrame').evaluate((frame) => (
      frame.contentWindow.KatamonCoopBridge.getNormalBattleState()
    )), { timeout: 30_000 }).toMatchObject({
      phase: 'playing',
      activeUnitId: 'p1',
      turnCount: 5,
      turnLimit: 100,
      salvo: { phase: 'collecting', ready: 0, total: 4 },
    });
    expect(pageErrors, `協力4vs1 fixtureでpageerrorが発生: ${pageErrors.join(' | ')}`).toEqual([]);
    await page.goto('about:blank');
  });

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

  test('公開ONの協力MVP入口・ショップ・実績がスマホ内へ収まり、タイトルへ直ボタンを増やさない', async ({ page }) => {
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Mobile WebKit crashes before the game shell loads in this environment.');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openTitle(page);
    await expect(page.locator('#coopBossLobby')).toHaveCount(1);
    await expect(page.locator('#mvpCollection')).toHaveCount(1);
    await expect(page.locator('#titleCoopBtn')).toHaveCount(0);
    await tapVirtualCanvas(page, 270, 619); // ONLINE BATTLE
    await expect(page.locator('#onlineLobby')).toHaveClass(/open.*coop-choice|coop-choice.*open/);
    await expect(page.locator('#onlineLobbyNote')).toContainText('通常対戦の部屋と協力ボスの部屋は別々');
    await expect(page.getByRole('button', { name: /協力ボス/ })).toBeVisible();
    await page.locator('#onlineCoopKind').click();
    await expect(page.locator('#coopBossLobby')).toHaveClass(/open/);
    await expect(page.getByText('超大型要塞戦車')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      titlePaused: document.querySelector('#titleBgm').paused,
      roomPaused: document.querySelector('#roomBgm').paused,
    }))).toEqual({ titlePaused: true, roomPaused: false });
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
