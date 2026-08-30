const { test, expect } = require('@playwright/test');

test('Workbench・Storage・Drop Revealは同じ部位シルエットとセット紋章を合成表示する', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/index.html?gear-asset-ui-integration-phase4f=1', async (route) => {
    const response = await route.fetch(); const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearAssetUiTest = { openStorage: openGearStorage };\n  ${marker}`) });
  });
  await page.goto('/index.html?gear-asset-ui-integration-phase4f=1');
  await page.waitForTimeout(700);

  await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const rewards = globalThis.KatamonGearRewards;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const make = (gearId, slotId, setId) => domain.createGear({
      gearId, generationSeed: `asset-ui:${gearId}:g`, enhancementSeed: `asset-ui:${gearId}:e`,
      sourceId: 'cpu_battle', sourceDetail: { e2e: 'asset-ui' }, acquiredAt: '2026-08-30T00:00:00Z',
      qualityProfile: { id: 'asset-ui', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] },
      setProfile: { id: `asset-ui-${setId}`, setWeights: [{ id: setId, weight: 1 }] }, slotId, setId,
    });
    const barrel = make('asset-ui-barrel', 'barrel', 'assault');
    const dropBarrel = make('asset-ui-drop-barrel', 'barrel', 'assault');
    const state = storage.createDefaultGearStorageState();
    state.inventory = [{ gear: barrel, locked: false, favorite: false }];
    storage.saveGearState(state, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: barrel.gearId, characterIds: ['kyoryu'] });
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
    const queued = await rewards.persistQueueReward({ rewardId: 'asset-ui-reward', sourceId: 'cpu_battle', sourceDetail: { e2e: 'asset-ui' }, createdAtMs: Date.now(), gears: [dropBarrel], blueprintShards: 0 }, localStorage);
    if (!queued.queued) throw new Error('asset UI reward was not queued');
  });

  await page.evaluate(() => globalThis.__gearAssetUiTest.openStorage());
  await expect(page.locator('#gearStorage')).toHaveClass(/open/);
  await expect(page.locator('[data-gear-storage-card="asset-ui-barrel"] .gearAssetVisual')).toHaveAttribute('data-gear-asset-set', 'assault');
  await expect(page.locator('[data-gear-storage-card="asset-ui-barrel"] .gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
  await page.locator('#gearStorageOpenWorkshop').click();
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await expect(page.locator('.gearSlot')).toHaveCount(6);
  await expect(page.locator('[data-gear-slot="barrel"] .gearAssetVisual')).toHaveAttribute('data-gear-asset-set', 'assault');

  await page.evaluate(() => globalThis.KatamonGearDropReveal.presentRewardId('asset-ui-reward'));
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  const active = page.locator('.gearDropSlot.active');
  await expect(active).toHaveAttribute('data-gear-drop-slot', 'barrel');
  await expect(active.locator('.gearDropAsset')).toHaveAttribute('data-gear-asset-set', 'assault');
  await expect(active.locator('.gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
  await expect(active.locator('.gearAssetEmblem')).toHaveJSProperty('naturalWidth', 256);
  await page.screenshot({ path: testInfo.outputPath('gear-asset-ui-integration-phase4f.png'), fullPage: true });
  for (const width of [412, 390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, panel: document.querySelector('.gearDropPanel').getBoundingClientRect() }));
    expect(layout.scroll, `${width}px overflow`).toBeLessThanOrEqual(layout.client);
    expect(layout.panel.left).toBeGreaterThanOrEqual(0);
    expect(layout.panel.right).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});
