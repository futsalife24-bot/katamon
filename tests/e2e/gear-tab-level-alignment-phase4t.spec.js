const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
];

async function installHarness(page) {
  await page.route('**/index.html?gear-tab-level-alignment-phase4t=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4TTest = { openWorkbench: openGearWorkshop };\n  ${marker}`) });
  });
}

async function layout(page, root) {
  return page.locator(root).evaluate((box) => {
    const rect = (selector) => {
      const value = box.querySelector(selector)?.getBoundingClientRect();
      return value ? { top: value.top, bottom: value.bottom, height: value.height } : null;
    };
    return {
      header: rect('.gearHeader'),
      category: rect('.loadoutLabNav'),
      section: rect('.gearSectionNav'),
      overflow: box.scrollWidth - box.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test('装備と所持品のヘッダー・カテゴリ・タブ段を全幅で固定する', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await installHarness(page);
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/index.html?gear-tab-level-alignment-phase4t=1');
  await page.waitForTimeout(400);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => globalThis.__gearPhase4TTest.openWorkbench());
    const workshop = await layout(page, '#gearWorkshopBox');
    await page.locator('#gearOpenStorage').click();
    await expect(page.locator('#gearStorage')).toHaveAttribute('aria-hidden', 'false');
    const storage = await layout(page, '#gearStorageBox');

    for (const key of ['header', 'category', 'section']) {
      expect(Math.abs(workshop[key].top - storage[key].top), `${viewport.width}px ${key} top`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(workshop[key].height - storage[key].height), `${viewport.width}px ${key} height`).toBeLessThanOrEqual(0.5);
    }
    expect(workshop.overflow, `${viewport.width}px workshop overflow`).toBeLessThanOrEqual(0);
    expect(storage.overflow, `${viewport.width}px storage overflow`).toBeLessThanOrEqual(0);
    expect(storage.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    console.log(`phase4t ${viewport.width}px: header/category/section delta 0, overflow 0`);
    await page.locator('#gearStorageOpenWorkshop').click();
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await page.locator('#gearOpenStorage').click();
  await page.locator('[data-gear-storage-loadout-page="weapon"]').click();
  await expect(page.locator('#gearStorage')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#gearWorkshop')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#loadoutWeaponPanel')).toBeVisible();
  await expect(page.locator('#loadoutLabNav [data-loadout-page="weapon"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#gearWorkshopBox').screenshot({ path: testInfo.outputPath('phase4t-weapon-navigation-412.png') });
  expect(errors).toEqual([]);
});
