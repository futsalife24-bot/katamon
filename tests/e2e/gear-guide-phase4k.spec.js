const { test, expect } = require('@playwright/test');

test('初回claim後のGEARを見るから3ページGuideを経て同slot Workbenchへ進む', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-guide-phase4k=1');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const rewards = globalThis.KatamonGearRewards;
    storage.saveGearState(storage.createDefaultGearStorageState(), localStorage);
    const gear = domain.createGear({
      gearId: 'guide-first-core', generationSeed: 'guide:first:g', enhancementSeed: 'guide:first:e',
      sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4k' }, acquiredAt: Date.now(),
      qualityProfile: { id: 'guide-quality', starWeights: [{ id: 4, weight: 1 }], rarityWeights: [{ id: 'epic', weight: 1 }] },
      setProfile: { id: 'guide-set', setWeights: [{ id: 'fortify', weight: 1 }] }, slotId: 'core', setId: 'fortify',
    });
    await rewards.persistQueueReward({ rewardId: 'guide-first-reward', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: Date.now(), gears: [gear], blueprintShards: 0 }, localStorage);
    globalThis.KatamonGearDropReveal.presentRewardId('guide-first-reward');
  });
  await page.locator('#gearDropClaim').click();
  await expect(page.locator('#gearDropTitle')).toHaveText('GEAR GET!');
  await page.locator('#gearDropWorkbench').click();
  await expect(page.locator('#gearGuide')).toHaveClass(/open/);
  await expect(page.locator('#gearWorkshop')).not.toHaveClass(/open/);
  await expect(page.locator('#gearGuideProgress')).toContainText('1 / 3');
  await expect(page.locator('[data-gear-guide-slot]')).toHaveCount(6);
  await expect(page.locator('[data-gear-guide-slot]').first()).toHaveAttribute('data-gear-guide-slot', 'auxiliary');
  await expect(page.locator('[data-gear-guide-slot]').nth(1)).toHaveAttribute('data-gear-guide-slot', 'barrel');
  await expect(page.locator('[data-gear-guide-slot]').nth(2)).toHaveAttribute('data-gear-guide-slot', 'sight');
  await expect(page.locator('[data-gear-guide-slot]').nth(3)).toHaveAttribute('data-gear-guide-slot', 'armor');
  await expect(page.locator('[data-gear-guide-slot]').nth(4)).toHaveAttribute('data-gear-guide-slot', 'engine');
  await expect(page.locator('[data-gear-guide-slot]').nth(5)).toHaveAttribute('data-gear-guide-slot', 'core');
  await expect(page.locator('[data-gear-guide-slot="barrel"]')).toContainText('メイン：ATK');
  await expect(page.locator('[data-gear-guide-slot="armor"]')).toContainText('メイン：HP');
  await expect(page.locator('[data-gear-guide-slot="core"]')).toContainText('メイン：DEF');
  for (const slotId of ['auxiliary', 'sight', 'engine']) {
    await expect(page.locator(`[data-gear-guide-slot="${slotId}"]`)).toContainText('メイン：ランダム');
  }
  if (testInfo.project.name.includes('chromium')) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.screenshot({ path: testInfo.outputPath('gear-guide-main-stats-412.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.screenshot({ path: testInfo.outputPath('gear-guide-main-stats-320.png'), fullPage: true });
    await page.setViewportSize({ width: 412, height: 915 });
  }
  await expect(page.locator('#gearGuideContent')).toContainText('PRESET 1 / 2 / 3');
  await page.locator('#gearGuideNext').click();
  await expect(page.locator('#gearGuideProgress')).toContainText('2 / 3');
  await expect(page.locator('#gearGuideContent')).toContainText('2 SET');
  await expect(page.locator('#gearGuideContent')).toContainText('RARITY / ★');
  await page.locator('#gearGuideNext').click();
  await expect(page.locator('#gearGuideProgress')).toContainText('3 / 3');
  await expect(page.locator('#gearGuideContent')).toContainText('+12');
  await expect(page.locator('#gearGuideContent')).toContainText('TEMP BOX');
  await page.evaluate(() => {
    globalThis.__gearGuideSawCoreHighlight = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-gear-slot="core"].updated')) {
        globalThis.__gearGuideSawCoreHighlight = true;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('#gearGuideNext').click();
  await expect(page.locator('#gearGuide')).not.toHaveClass(/open/);
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await expect(page.locator('[data-gear-slot="core"]')).toHaveClass(/selected/);
  await expect.poll(() => page.evaluate(() => globalThis.__gearGuideSawCoreHighlight)).toBe(true);
  await page.locator('#gearWorkshopGuide').click();
  await expect(page.locator('#gearGuide')).toHaveClass(/open/);
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').click();
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await page.locator('#gearOpenStorage').click();
  await expect(page.locator('#gearStorage')).toHaveClass(/open/);
  await page.locator('#gearStorageGuide').click();
  await expect(page.locator('#gearGuide')).toHaveClass(/open/);
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').click();
  await page.locator('[data-gear-storage-detail="guide-first-core"]').click();
  await page.locator('[data-gear-enhance="guide-first-core"]').click();
  await expect(page.locator('#gearEnhanceOverlay')).toHaveClass(/open/);
  // WebKit can keep the underlying scrolling Storage dialog in its hit-test
  // chain even though Enhance is the top overlay. Dispatch verifies the same
  // production handler without waiting on that engine-specific actionability.
  await page.locator('[data-gear-enhance-guide]').dispatchEvent('click');
  await expect(page.locator('#gearGuide')).toHaveClass(/open/);
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').dispatchEvent('click');
  await expect(page.locator('#gearEnhanceOverlay')).toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('常設入口・skip・responsiveはstorage mutationなしで機能する', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html?gear-guide-phase4k-manual=1');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const storage = globalThis.KatamonGearStorage;
    storage.saveGearState(storage.createDefaultGearStorageState(), localStorage);
    globalThis.KatamonGearGuide.open();
    return localStorage.getItem(storage.GEAR_STORAGE_KEY);
  });
  for (const viewport of [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.locator('.gearGuidePanel').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
    });
    expect(layout.left).toBeGreaterThanOrEqual(-1);
    expect(layout.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.top).toBeGreaterThanOrEqual(-1);
    expect(layout.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    const skip = await page.locator('.gearGuideHeader [data-gear-guide-skip]').evaluate((node) => ({
      whiteSpace: getComputedStyle(node).whiteSpace,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(skip.whiteSpace).toBe('nowrap');
    expect(skip.scrollWidth).toBeLessThanOrEqual(skip.clientWidth);
  }
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').click();
  expect(await page.evaluate((raw) => localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === raw, before)).toBe(true);
  await page.evaluate(() => globalThis.KatamonGearGuide.open());
  expect(await page.locator('#gearGuide').evaluate((node) => getComputedStyle(node.querySelector('.gearGuidePanel')).animationName)).toBe('none');
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').click();
  expect(errors).toEqual([]);
});
