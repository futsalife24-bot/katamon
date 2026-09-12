const { test, expect } = require('@playwright/test');

const labels = ['ショップ', '実績', '曜日迷宮', '大型ボス 共同討伐作戦',
  '鋼鉄要塞', '超大型要塞戦車', '雷晶龍ヴォルテリス', '雷雲の祭壇'];

async function assertRenderedFont(page, selector, family) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    const used = fonts.filter(font => font.glyphCount > 0);
    expect(used.length, selector).toBeGreaterThan(0);
    // document.fonts.check alone also succeeds when missing glyphs fall back.
    expect(used.every(font => font.isCustomFont && font.familyName === family), JSON.stringify(used)).toBe(true);
  } finally {
    await session.detach();
  }
}

test('shipped display labels decode in both browsers without mixed fallback glyphs', async ({ page, browserName }, testInfo) => {
  await page.goto('/assets/fonts/katamon-fonts-v178.css');
  await page.setContent(`<link rel="stylesheet" href="katamon-fonts-v178.css">
    <style>body{background:#12242d;color:#ffe7ad}p{font:24px var(--katamon-font-display)}</style>
    ${labels.map((label, index) => `<p id="fontSample${index}">${label}</p>`).join('')}`);
  await page.evaluate(async text => {
    await document.fonts.load('400 24px "Reggae One"', text);
    await document.fonts.ready;
  }, labels.join(''));
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Reggae One' && font.status === 'loaded'))).toBe(true);
  if (browserName === 'chromium') {
    for (let index = 0; index < labels.length; index++) await assertRenderedFont(page, `#fontSample${index}`, 'Reggae One');
  }
  await page.screenshot({ path: testInfo.outputPath('display-font-labels.png'), fullPage: true });
});

test('first title tap activates UI fonts without a Service Worker or T2 completion', async ({ browser, browserName, baseURL }, testInfo) => {
  test.skip(browserName === 'webkit', 'Existing mobile WebKit runner crashes in the full game; isolated font decoding is covered above.');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  const uiFontRequests = [];
  page.on('request', request => { if (request.url().includes('rocknroll-one-regular.ttf')) uiFontRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      window.fontRepairDraws = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (['ショップ', '実績', '曜日迷宮'].includes(text)) window.fontRepairDraws.push({ text, font: this.font });
        return original.call(this, text, ...args);
      };
    });
    await page.goto('/index.html');
    await page.waitForFunction(() => globalThis.KatamonCustomStageBridge?.getState().gamePhase === 'press');
    expect(await page.locator('#katamonFontFaces').getAttribute('media')).toBe('print');
    expect(uiFontRequests).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('sans-serif');
    const box = await page.locator('#game').boundingBox();
    const tap = (x, y) => page.touchscreen.tap(box.x + box.width * x / 540, box.y + box.height * y / 960);
    await tap(270, 480);
    await page.waitForFunction(() => globalThis.KatamonCustomStageBridge?.getState().gamePhase === 'title');
    await expect(page.locator('#katamonFontFaces')).toHaveAttribute('media', 'all');
    await page.waitForFunction(() => [...document.fonts].some(font => font.family === 'RocknRoll One' && font.status === 'loaded'));
    await tap(508, 690);
    await expect.poll(() => page.evaluate(() => [...new Set(window.fontRepairDraws.filter(draw => draw.font.includes('Reggae One')).map(draw => draw.text))].sort())).toEqual([...['ショップ', '実績', '曜日迷宮']].sort());
    await page.screenshot({ path: testInfo.outputPath('garage-fonts.png') });
    await page.evaluate(() => globalThis.KatamonCoopRoom.openLobby());
    await assertRenderedFont(page, '#coopBossName', 'Reggae One');
    await assertRenderedFont(page, '#coopSoloStart', 'RocknRoll One');
    await page.locator('#coopBossTarget').selectOption('storm-dragon-02');
    await assertRenderedFont(page, '#coopBossName', 'Reggae One');
    await page.screenshot({ path: testInfo.outputPath('coop-fonts.png') });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
