const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];

async function seedFixture(page) {
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const base = domain.createGear({
      gearId: 'phase4l-barrel',
      generationSeed: 'phase4l:barrel:generation',
      enhancementSeed: 'phase4l:barrel:enhancement',
      sourceId: 'cpu_battle',
      sourceDetail: { e2e: 'phase4l' },
      acquiredAt: Date.now(),
      qualityProfile: { id: 'phase4l-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: 'phase4l-set', setWeights: [{ id: 'assault', weight: 1 }] },
      slotId: 'barrel',
      setId: 'assault',
    });
    const barrel = domain.enhanceGear(base, 6);
    const gearState = storage.createDefaultGearStorageState();
    gearState.inventory = [{ gear: barrel, locked: true, favorite: true }];
    storage.saveGearState(gearState, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    presetState = presets.setPresetSlot(presetState, {
      characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: barrel.gearId, characterIds: ['kyoryu'],
    });
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
}

async function measureLayout(page) {
  return page.locator('#gearWorkshopBox').evaluate((box) => {
    const detail = box.querySelector('.gearInlineDetail');
    const rect = detail?.getBoundingClientRect();
    return {
      scrollTop: box.scrollTop,
      boxOverflow: box.scrollWidth - box.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      detailInside: Boolean(rect && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1),
    };
  });
}

test('6slotタップで直下詳細、中央CATAMONタップで能力へ戻る', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.route('**/index.html?gear-workbench-inline-detail-phase4l=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4LTest = { openWorkbench: openGearWorkshop };\n  ${marker}`) });
  });
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/index.html?gear-workbench-inline-detail-phase4l=1');
  await page.waitForTimeout(400);
  await seedFixture(page);
  await page.evaluate(() => globalThis.__gearPhase4LTest.openWorkbench());

  await expect(page.locator('#gearSummary')).toHaveAttribute('data-gear-summary-mode', 'stats');
  await expect(page.locator('.gearStat')).toHaveCount(9);
  await expect(page.locator('#gearSetPanel')).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.locator('[data-gear-summary-return]').click();
    const before = await page.locator('#gearWorkshopBox').evaluate((box) => box.scrollTop);
    await page.locator('[data-gear-slot="barrel"]').click();
    await expect(page.locator('#gearSummary')).toHaveAttribute('data-gear-summary-mode', 'detail');
    await expect(page.locator('#gearSummary')).toHaveAttribute('data-gear-summary-slot', 'barrel');
    await expect(page.locator('[data-gear-slot="barrel"]')).toHaveClass(/selected/);
    await expect(page.locator('.gearInlineDetailPart')).toContainText('砲身');
    await expect(page.locator('.gearInlineDetailTitle')).toContainText('猛攻');
    await expect(page.locator('.gearInlineDetailBadges')).toContainText('★6');
    await expect(page.locator('.gearInlineDetailBadges')).toContainText('強化 +6');
    await expect(page.locator('.gearInlineDetailBadges')).toContainText('お気に入り');
    await expect(page.locator('.gearInlineDetailBadges')).toContainText('分解保護');
    await expect(page.locator('.gearInlineDetailMain')).toBeVisible();
    await expect(page.locator('.gearInlineDetailSubs')).toBeVisible();
    await expect(page.locator('.gearInlineDetailAsset .gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
    await expect(page.locator('#gearSetPanel')).toBeHidden();
    const report = await measureLayout(page);
    expect(report.scrollTop, `${viewport.width}px auto scroll`).toBe(before);
    expect(report.boxOverflow, `${viewport.width}px workshop overflow`).toBeLessThanOrEqual(0);
    expect(report.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    expect(report.detailInside, `${viewport.width}px inline detail is immediately visible`).toBe(true);
    console.log(`phase4l ${viewport.width}x${viewport.height}: inline detail visible, overflow 0, auto-scroll 0`);
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await page.locator('[data-gear-summary-return]').click();
  await expect(page.locator('#gearSummary')).toHaveAttribute('data-gear-summary-mode', 'stats');
  await expect(page.locator('.gearStat')).toHaveCount(9);
  await expect(page.locator('#gearSetPanel')).toBeVisible();
  await expect(page.locator('.gearSlot.selected')).toHaveCount(0);

  await page.locator('[data-gear-slot="sight"]').click();
  await expect(page.locator('#gearSummary')).toHaveAttribute('data-gear-summary-slot', 'sight');
  await expect(page.locator('.gearInlineDetailEmpty')).toContainText('未装備');
  await expect(page.locator('#gearSummary .gearAssetEmblem')).toHaveCount(0);
  await expect(page.locator('[data-gear-slot="sight"]')).toHaveClass(/selected/);
  await page.screenshot({ path: testInfo.outputPath('phase4l-inline-detail-412.png'), fullPage: true });
  await page.setViewportSize(VIEWPORTS[2]);
  await page.locator('[data-gear-slot="barrel"]').click();
  await page.screenshot({ path: testInfo.outputPath('phase4l-inline-detail-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});
