const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const MOBILE_VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];
const WORKBENCH_VIEWPORTS = [...MOBILE_VIEWPORTS, { width: 1280, height: 900 }];

async function assertPanelFits(page, selector, viewports = MOBILE_VIEWPORTS) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const layout = await page.locator(selector).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        badControls: [...node.querySelectorAll('button,select')].filter((control) => {
          const box = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
            && (box.left < -1 || box.right > innerWidth + 1);
        }).map((control) => control.id || control.textContent.trim().slice(0, 24)),
      };
    });
    expect(layout.left, `${selector} ${viewport.width}px left`).toBeGreaterThanOrEqual(-1);
    expect(layout.right, `${selector} ${viewport.width}px right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.top, `${selector} ${viewport.width}px top`).toBeGreaterThanOrEqual(-1);
    expect(layout.bottom, `${selector} ${viewport.width}px bottom`).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.scrollWidth, `${selector} ${viewport.width}px internal overflow`).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.documentScrollWidth, `${selector} ${viewport.width}px document overflow`).toBeLessThanOrEqual(layout.documentClientWidth);
    expect(layout.badControls, `${selector} ${viewport.width}px control overflow`).toEqual([]);
  }
}

async function assertWorkbenchSlotsDoNotOverlap(page) {
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const slots = await page.locator('.gearSlot').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    for (let first = 0; first < slots.length; first += 1) for (let second = first + 1; second < slots.length; second += 1) {
      const a = slots[first]; const b = slots[second];
      const overlaps = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      expect(overlaps, `Workbench slot overlap ${first}/${second} at ${viewport.width}px`).toBe(false);
    }
  }
}

async function assertWorkbenchTextFits(page, testInfo) {
  const reports = [];
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const metrics = await page.locator('.gearSlot.equipped').evaluateAll((nodes) => nodes.map((node) => {
      const measure = (selector) => {
        const element = node.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      };
      const primary = measure('.gearSlotName'); const set = measure('.gearSlotSetName'); const stars = measure('.gearSlotStars');
      const secondary = measure('.gearSlotEmpty'); const rarity = measure('.gearSlotRarity'); const level = measure('.gearSlotLevel');
      const inside = (child, parent) => child.left >= parent.left - 1 && child.right <= parent.right + 1;
      return { slotId: node.dataset.gearSlot, primary, set, stars, secondary, rarity, level, starsInside: inside(stars, primary), levelInside: inside(level, secondary) };
    }));
    expect(metrics, `Workbench equipped slot count at ${viewport.width}px`).toHaveLength(6);
    for (const metric of metrics) {
      expect(metric.set.scrollWidth, `${metric.slotId} Set名 truncation at ${viewport.width}px`).toBeLessThanOrEqual(metric.set.clientWidth);
      expect(metric.stars.text, `${metric.slotId} ★ text at ${viewport.width}px`).toMatch(/^\d★$/);
      expect(metric.stars.width, `${metric.slotId} ★ width at ${viewport.width}px`).toBeGreaterThan(0);
      expect(metric.starsInside, `${metric.slotId} ★ clipping at ${viewport.width}px`).toBe(true);
      expect(metric.rarity.scrollWidth, `${metric.slotId} rarity truncation at ${viewport.width}px`).toBeLessThanOrEqual(metric.rarity.clientWidth);
      expect(metric.level.text, `${metric.slotId} enhancement text at ${viewport.width}px`).toMatch(/^\+\d+$/);
      expect(metric.level.width, `${metric.slotId} enhancement width at ${viewport.width}px`).toBeGreaterThan(0);
      expect(metric.levelInside, `${metric.slotId} enhancement clipping at ${viewport.width}px`).toBe(true);
    }
    reports.push({ viewport, metrics });
    const maxSetOverflow = Math.max(...metrics.map((metric) => metric.set.scrollWidth - metric.set.clientWidth));
    const maxRarityOverflow = Math.max(...metrics.map((metric) => metric.rarity.scrollWidth - metric.rarity.clientWidth));
    console.log(`phase4g Workbench text ${viewport.width}x${viewport.height}: stars 6/6, levels 6/6, max Set overflow ${maxSetOverflow}px, max rarity overflow ${maxRarityOverflow}px`);
  }
  await testInfo.attach('phase4g-workbench-text-metrics.json', { body: Buffer.from(JSON.stringify(reports, null, 2)), contentType: 'application/json' });
}

async function seedVisualFixture(page) {
  await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const rewards = globalThis.KatamonGearRewards;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const foundation = globalThis.KatamonCoopMvp;
    const definitions = [
      ['visual-auxiliary', 'auxiliary', 'rescue', 'epic', 4, 3],
      ['visual-sight', 'sight', 'critical', 'legend', 5, 6],
      ['visual-engine', 'engine', 'impact', 'rare', 4, 3],
      ['visual-barrel', 'barrel', 'assault', 'mythic', 6, 9],
      ['visual-armor', 'armor', 'fortify', 'legend', 5, 6],
      ['visual-core', 'core', 'last_stand', 'epic', 4, 3],
      ['visual-dismantle', 'armor', 'blast', 'rare', 3, 0],
    ];
    const make = ([gearId, slotId, setId, rarityId, star, level]) => {
      const base = domain.createGear({
        gearId,
        generationSeed: `phase4g:${gearId}:g`,
        enhancementSeed: `phase4g:${gearId}:e`,
        sourceId: 'cpu_battle',
        sourceDetail: { e2e: 'phase4g' },
        acquiredAt: Date.now(),
        qualityProfile: { id: `${gearId}:quality`, starWeights: [{ id: star, weight: 1 }], rarityWeights: [{ id: rarityId, weight: 1 }] },
        setProfile: { id: `${gearId}:set`, setWeights: [{ id: setId, weight: 1 }] },
        slotId,
        setId,
      });
      return level ? domain.enhanceGear(base, level) : base;
    };
    const gears = definitions.map(make);
    const state = storage.createDefaultGearStorageState();
    state.inventory = gears.map((gear, index) => ({ gear, locked: index === 0, favorite: index === 1 || index === 6 }));
    state.resources.powder = 5000;
    state.resources.blueprintShards = 180;
    storage.saveGearState(state, localStorage);
    const foundationState = foundation.createDefaultState();
    foundationState.wallet.coins = 12000;
    foundation.saveState(foundationState, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    for (const gear of gears.slice(0, 6)) {
      presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: ['kyoryu'] });
    }
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
    const drop = make(['visual-drop', 'barrel', 'last_stand', 'mythic', 6, 0]);
    const queued = await rewards.persistQueueReward({ rewardId: 'visual-reward', sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4g' }, createdAtMs: Date.now(), gears: [drop], blueprintShards: 0 }, localStorage);
    if (!queued.queued) throw new Error('Phase 4G visual reward was not queued');
  });
}

test('Gear主要6画面を製品品質の情報階層で表示し、mobile/desktopで破綻しない', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  await page.route('**/index.html?gear-visual-polish-phase4g=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearVisualPolishTest = { openWorkbench: openGearWorkshop };\n  ${marker}`) });
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/index.html?gear-visual-polish-phase4g=1');
  await page.waitForTimeout(500);
  await seedVisualFixture(page);

  await page.evaluate(() => globalThis.__gearVisualPolishTest.openWorkbench());
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await page.locator('[data-gear-slot="barrel"]').click();
  await expect(page.locator('.gearSlot')).toHaveCount(6);
  await expect(page.locator('.gearSlot.equipped .gearSlotEmblem .gearAssetEmblem')).toHaveCount(6);
  await expect(page.locator('[data-gear-slot="barrel"] .gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
  await expect(page.locator('[data-gear-candidate="visual-barrel"] .gearCandidateAsset')).toBeVisible();
  await expect(page.locator('.gearSlotPart')).toHaveCount(6);
  await expect(page.locator('.gearSlotName')).toHaveCount(6);
  await assertWorkbenchSlotsDoNotOverlap(page);
  await assertPanelFits(page, '#gearWorkshopBox', WORKBENCH_VIEWPORTS);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath(`phase4g-workbench-${testInfo.project.name}.png`), fullPage: true });

  await page.evaluate(() => globalThis.KatamonGearStorageUi.open());
  await expect(page.locator('#gearStorage')).toHaveClass(/open/);
  await expect(page.locator('#gearStorageRack .gearStorageCard')).toHaveCount(7);
  await expect(page.locator('[data-gear-storage-card="visual-barrel"] .gearStorageAsset .gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
  await expect(page.locator('[data-gear-storage-card="visual-barrel"] .gearStorageQuality')).toContainText('6★');
  await expect(page.locator('[data-gear-storage-card="visual-barrel"] .gearStorageMeta')).toContainText('強化 +9');
  await assertPanelFits(page, '#gearStorageBox');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath(`phase4g-storage-${testInfo.project.name}.png`), fullPage: true });

  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage;
    const gear = domain.createGear({ gearId: 'visual-temp', generationSeed: 'visual-temp:g', enhancementSeed: 'visual-temp:e', sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4g' }, acquiredAt: Date.now(), qualityProfile: { id: 'visual-temp:q', starWeights: [{ id: 5, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: 'visual-temp:s', setWeights: [{ id: 'fortify', weight: 1 }] }, slotId: 'engine', setId: 'fortify' });
    const state = storage.loadGearState(localStorage); state.tempBox.push({ gear, locked: true, favorite: true, enteredAtMs: Date.now() - (storage.TEMP_BOX_TTL_MS - 7200000) }); storage.saveGearState(state, localStorage); globalThis.KatamonGearStorageUi.render();
  });
  await page.locator('[data-gear-storage-tab="tempBox"]').click();
  await expect(page.locator('[data-gear-storage-card="visual-temp"]')).toContainText('残り2時間');
  await expect(page.locator('#gearStorageTempPolicy')).toContainText('保護設定に関係なく');
  await page.screenshot({ path: testInfo.outputPath(`phase4g-temp-box-${testInfo.project.name}.png`), fullPage: true });

  await page.locator('[data-gear-storage-tab="inventory"]').click();
  await page.locator('[data-gear-storage-detail="visual-auxiliary"]').click();
  await page.locator('[data-gear-enhance="visual-auxiliary"]').click();
  await expect(page.locator('#gearEnhanceOverlay')).toHaveClass(/open/);
  await expect(page.locator('#gearEnhanceContent .gearActionAsset .gearAssetSilhouette')).toHaveJSProperty('naturalWidth', 256);
  await assertPanelFits(page, '#gearEnhanceOverlay .gearActionPanel');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath(`phase4g-enhance-${testInfo.project.name}.png`), fullPage: true });
  await page.locator('#gearEnhanceOverlay [data-gear-enhance-close]').first().click();

  await page.evaluate(() => globalThis.KatamonGearStorageUi.openDismantle('visual-dismantle'));
  await expect(page.locator('#gearDismantleOverlay')).toHaveClass(/open/);
  await expect(page.locator('#gearDismantleContent .gearActionAsset')).toBeVisible();
  await expect(page.locator('#gearDismantleContent')).toContainText('★ お気に入り登録済み');
  await assertPanelFits(page, '#gearDismantleOverlay .gearActionPanel');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath(`phase4g-dismantle-${testInfo.project.name}.png`), fullPage: true });
  await page.locator('#gearDismantleOverlay [data-gear-dismantle-close]').first().click();

  await page.evaluate(() => globalThis.KatamonGearDropReveal.presentRewardId('visual-reward'));
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'barrel');
  await expect(page.locator('.gearDropSlot.active .gearDropAsset .gearAssetEmblem')).toHaveJSProperty('naturalWidth', 256);
  await expect(page.locator('.gearDropCardAsset')).toBeVisible();
  await assertPanelFits(page, '.gearDropPanel');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath(`phase4g-drop-${testInfo.project.name}.png`), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await assertPanelFits(page, '.gearDropPanel', [{ width: 1280, height: 900 }]);
  expect(failures).toEqual([]);
});
