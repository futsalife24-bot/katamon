const { test, expect } = require('@playwright/test');

test('CPU結果の素材内訳と共有ボタンをモバイルCanvasで安全に操作できる', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().route('https://x.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>X intent fixture</title>' });
  });
  await page.route('**/index.html?reward-summary-x-share=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '\n})();\n</script>';
    const position = source.lastIndexOf(marker);
    expect(position).toBeGreaterThan(0);
    const hook = `
  window.__rewardSummaryShareE2e = {
    async prepare() {
      localStorage.clear();
      selectCharacterAndStart(CHARACTER_LIST[0]);
      if (cpuGearStartPromise) await cpuGearStartPromise;
      winStreak = 8;
      winner = 'player';
      matchOver = true;
      matchEndPause = 0;
      cutIn = null;
      soundOn = false;
      render();
      const layout = cpuGearResultLayout();
      return {
        layout: {
          preview: JSON.parse(JSON.stringify(layout.preview)),
          titleButton: { ...layout.titleButton, shift: resultButtonShift() },
          shareButton: { ...layout.shareButton, shift: resultButtonShift() },
          settlementButton: { ...layout.settlementButton, shift: resultButtonShift() },
          continueButton: { ...layout.continueButton, shift: resultButtonShift() },
          bandHeight: layout.bandHeight,
        },
        breakdown: { ...cpuGearRewardBreakdown(layout.preview) },
        payload: { ...currentCpuResultSharePayload(layout) },
      };
    },
    redraw() { render(); },
    shareState() { return { status: resultShareStatusText, pending: !!resultSharePromise }; },
  };
`;
    await route.fulfill({ response, body: `${source.slice(0, position)}${hook}${source.slice(position)}` });
  });
  await page.goto('/index.html?reward-summary-x-share=1');
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data) => { window.__rewardShareData = data; return Promise.resolve(); },
    });
  });
  const prepared = await page.evaluate(() => window.__rewardSummaryShareE2e.prepare());
  expect(prepared.layout.shareButton).toBeTruthy();
  expect(prepared.breakdown.totalPowder).toBe(prepared.layout.preview.powder);
  expect(prepared.breakdown.totalBlueprintShards).toBe(prepared.layout.preview.blueprintShards);
  expect(prepared.breakdown.streakPowder + prepared.breakdown.stageItemPowder).toBe(prepared.breakdown.totalPowder);
  expect(prepared.breakdown.streakBlueprintShards + prepared.breakdown.stageItemBlueprintShards).toBe(prepared.breakdown.totalBlueprintShards);
  expect(prepared.payload.text).toContain('8連勝達成！');
  expect(prepared.payload.url).toBe('https://futsalife24-bot.github.io/katamon/');

  const overlaps = (a, b) => (
    a.x - a.w / 2 < b.x + b.w / 2
    && a.x + a.w / 2 > b.x - b.w / 2
    && a.y + a.shift - a.h / 2 < b.y + b.shift + b.h / 2
    && a.y + a.shift + a.h / 2 > b.y + b.shift - b.h / 2
  );
  expect(overlaps(prepared.layout.titleButton, prepared.layout.shareButton)).toBe(false);
  expect(overlaps(prepared.layout.settlementButton, prepared.layout.shareButton)).toBe(false);
  expect(prepared.layout.shareButton.y + prepared.layout.shareButton.shift + prepared.layout.shareButton.h / 2).toBeLessThanOrEqual(960);

  const canvas = page.locator('[data-testid="battle-canvas"]');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const tapCanvasButton = async (button) => {
    const x = box.x + (button.x / 540) * box.width;
    const y = box.y + ((button.y + button.shift) / 960) * box.height;
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="battle-canvas"]');
      const init = { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0 };
      canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      window.dispatchEvent(new PointerEvent('pointerup', init));
    }, { x, y });
  };
  await tapCanvasButton(prepared.layout.shareButton);
  await expect.poll(() => page.evaluate(() => window.__rewardShareData?.url || null)).toBe('https://futsalife24-bot.github.io/katamon/');
  await expect.poll(() => page.evaluate(() => window.__rewardSummaryShareE2e.shareState().status)).toBe('共有しました');
  const shared = await page.evaluate(() => window.__rewardShareData);
  expect(shared.text).toContain('精算見込み');
  expect(shared.text).not.toMatch(/room|deviceId|rivalId|runId|rewardId|gearId|seed|通信ログ/i);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    window.__rewardXAnchor = null;
    document.addEventListener('click', (event) => {
      const link = event.target?.closest?.('a[href^="https://x.com/intent/tweet?"]');
      if (link) window.__rewardXAnchor = { href: link.href, target: link.target, rel: link.rel };
    }, { capture: true, once: true });
    window.__rewardSummaryShareE2e.redraw();
  });
  const popupPromise = page.waitForEvent('popup');
  await tapCanvasButton(prepared.layout.shareButton);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toMatch(/^https:\/\/x\.com\/intent\/tweet\?/);
  const opened = await page.evaluate(() => window.__rewardXAnchor);
  expect(opened.href).toMatch(/^https:\/\/x\.com\/intent\/tweet\?/);
  expect(opened.target).toBe('_blank');
  expect(opened.rel).toContain('noopener');
  expect(opened.rel).toContain('noreferrer');
  await expect.poll(() => page.evaluate(() => window.__rewardSummaryShareE2e.shareState().status)).toBe('Xの投稿画面を開きました');
  await popup.close();

  await page.screenshot({ path: testInfo.outputPath('reward-summary-x-share.png'), fullPage: true });
  expect(errors).toEqual([]);
});
