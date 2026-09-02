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
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

  await page.goto('/index.html?shop-assets-phase5a=1');
  await page.waitForFunction(() => globalThis.KatamonMvpShop?.openShop);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => globalThis.KatamonMvpShop.openShop());
    await expect(page.locator('#mvpCollection')).toHaveClass(/open/);
    await expect(page.locator('.mvp-card')).toHaveCount(9);
    await expect(page.locator('.mvp-card .mvp-item-art')).toHaveCount(9);
    await expect(page.locator('.mvp-card .mvp-effect-preview')).toHaveCount(9);
    await expect(page.locator('.mvp-card [data-preview-replay]')).toHaveCount(9);
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
        previewScenes: [...document.querySelectorAll('.mvp-card .mvp-effect-preview')].map((preview) => preview.dataset.previewScene),
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
    expect(new Set(layout.previewScenes).size, `${viewport.width}px all item effect scenes`).toBe(9);
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
  const detailImage = page.locator('.mvp-dialog-card .mvp-item-art');
  await expect(detailImage).toHaveAttribute('src', 'assets/shop/runtime/items/shop_item_barrier_01.webp');
  await expect.poll(() => detailImage.evaluate((image) => [image.naturalWidth, image.naturalHeight])).toEqual([256, 256]);
  const detailPreview = page.locator('.mvp-dialog-card .mvp-effect-preview');
  await expect(detailPreview).toHaveAttribute('data-preview-scene', 'barrier');
  await detailPreview.locator('[data-preview-replay]').click();
  await expect.poll(() => detailPreview.locator('.mvp-demo-shot').evaluate((node) => getComputedStyle(node).animationName)).toContain('mvp-shot');
  console.log('shop-assets detail: image decoded');
  await page.locator('.mvp-dialog-card').screenshot({ path: testInfo.outputPath('shop-barrier-detail-412.png') });
  console.log('shop-assets detail: screenshot done');
  expect(errors).toEqual([]);
  await page.close({ runBeforeUnload: false });
});
