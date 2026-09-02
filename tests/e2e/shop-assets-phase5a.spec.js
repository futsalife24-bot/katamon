const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
];

test('ショップ9商品の正式画像・詳細・responsiveを検証する', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
    console.log(`shop-assets pageerror: ${error.message}\n${error.stack || ''}`);
  });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

  await page.goto('/index.html?shop-assets-phase5a=1');
  await page.waitForFunction(() => globalThis.KatamonMvpShop?.openShop);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => globalThis.KatamonMvpShop.openShop());
    await expect(page.locator('#mvpCollection')).toHaveClass(/open/);
    await expect(page.locator('.mvp-card')).toHaveCount(9);
    await expect(page.locator('.mvp-card .mvp-item-art')).toHaveCount(9);
    await expect(page.locator('.mvp-card .mvp-product-preview')).toHaveCount(9);
    await page.locator('.mvp-scroll').evaluate((scroll) => { scroll.scrollTop = scroll.scrollHeight; });
    await page.locator('.mvp-scroll').evaluate((scroll) => { scroll.scrollTop = 0; });
    const layout = await page.evaluate(async () => {
      const images = [...document.querySelectorAll('.mvp-card .mvp-item-art')];
      images.forEach((image) => { image.loading = 'eager'; });
      await Promise.all(images.map((image) => image.decode()));
      const cards = [...document.querySelectorAll('.mvp-card')];
      return {
        imageSizes: images.map((image) => [image.naturalWidth, image.naturalHeight]),
      imageSources: images.map((image) => new URL(image.currentSrc, location.href).pathname),
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOverflow: document.querySelector('.mvp-panel').scrollWidth - document.querySelector('.mvp-panel').clientWidth,
        controlsOutside: cards.filter((card) => {
          const button = card.querySelector('button').getBoundingClientRect();
          const bounds = card.getBoundingClientRect();
          return button.left < bounds.left || button.right > bounds.right || button.bottom > bounds.bottom;
        }).length,
      };
    });
    expect(layout.imageSizes, `${viewport.width}px runtime dimensions`).toEqual(Array(9).fill([256, 256]));
    expect(new Set(layout.imageSources).size, `${viewport.width}px distinct item images`).toBe(9);
    expect(layout.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    expect(layout.panelOverflow, `${viewport.width}px panel overflow`).toBeLessThanOrEqual(0);
    expect(layout.controlsOutside, `${viewport.width}px card control overflow`).toBe(0);
    console.log(`shop-assets ${viewport.width}px: images 9/9, overflow 0, controls outside 0`);

    if (viewport.width === 412 || viewport.width === 320) {
      await page.locator('.mvp-panel').screenshot({ path: testInfo.outputPath(`shop-${viewport.width}.png`) });
    }
    await page.evaluate(() => globalThis.KatamonMvpShop.close());
    await expect(page.locator('#mvpCollection')).not.toHaveClass(/open/);
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await page.evaluate(() => globalThis.KatamonMvpShop.openShop());
  await page.waitForTimeout(320);
  console.log('shop-assets detail: opening barrier');
  await page.locator('[data-preview="barrier"]').click();
  console.log('shop-assets detail: barrier clicked');
  await expect(page.locator('#mvpPurchaseDialog')).toHaveClass(/open/);
  console.log('shop-assets detail: dialog open');
  const detailPreview = page.locator('.mvp-dialog-card .mvp-live-battle-preview');
  await expect(detailPreview).toHaveAttribute('data-live-battle-preview', 'barrier');
  await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview?.activeItemId?.())).toBe('barrier');
  const previewCanvas = detailPreview.locator('canvas');
  await expect(previewCanvas).toHaveAttribute('width', '540');
  await expect(previewCanvas).toHaveAttribute('height', '304');
  await expect.poll(() => previewCanvas.evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible += 1;
    return visible;
  })).toBeGreaterThan(10000);
  await page.waitForTimeout(1200);
  await detailPreview.locator('[data-preview-replay]').click();
  await page.waitForTimeout(1200);
  await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview?.activeItemId?.())).toBe('barrier');
  console.log('shop-assets detail: live Battle canvas rendered');
  await page.locator('.mvp-dialog-card').screenshot({ path: testInfo.outputPath('shop-barrier-detail-412.png') });
  await page.locator('#mvpCollection').evaluate((overlay) => { overlay.style.visibility = 'hidden'; });
  await page.locator('#game').screenshot({ path: testInfo.outputPath('shop-barrier-source-canvas.png') });
  await page.locator('#mvpCollection').evaluate((overlay) => { overlay.style.visibility = ''; });
  console.log('shop-assets detail: screenshot done');
  await page.locator('.mvp-dialog-card [data-action="cancel"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview?.activeItemId?.())).toBe(null);

  const remainingPreviewIds = [
    'impact', 'drill', 'rescue-kit', 'healing-kit',
    'debuff-grenade', 'icon-brass', 'shell-amber', 'impact-cyan'
  ];
  for (const itemId of remainingPreviewIds) {
    console.log(`shop-assets live preview: ${itemId}`);
    await page.locator(`[data-preview="${itemId}"]`).click();
    await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview?.activeItemId?.())).toBe(itemId);
    await page.waitForTimeout(850);
    const liveCanvas = page.locator('.mvp-dialog-card [data-live-battle-preview] canvas');
    await expect.poll(() => liveCanvas.evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlack = 0;
      for (let index = 0; index < pixels.length; index += 64) {
        if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) nonBlack += 1;
      }
      return nonBlack;
    }), { message: `${itemId} Battle preview must render pixels` }).toBeGreaterThan(100);
    await page.locator('.mvp-dialog-card [data-action="cancel"]').click();
    await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview?.activeItemId?.())).toBe(null);
  }
  expect(errors).toEqual([]);
  await page.close({ runBeforeUnload: false });
});
