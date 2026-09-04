const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
];

async function installHarness(page) {
  await page.route('**/index.html?gear-status-visual-language-phase4s=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4STest = { openWorkbench: openGearWorkshop };\n  ${marker}`) });
  });
}

async function seedFixture(page) {
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const gear = domain.createGear({
      gearId: 'phase4s-barrel', generationSeed: 'phase4s:barrel:g', enhancementSeed: 'phase4s:barrel:e',
      sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4s' }, acquiredAt: Date.now(),
      qualityProfile: { id: 'phase4s-quality', starWeights: [{ id: 4, weight: 1 }], rarityWeights: [{ id: 'epic', weight: 1 }] },
      setProfile: { id: 'phase4s-set', setWeights: [{ id: 'assault', weight: 1 }] }, slotId: 'barrel', setId: 'assault',
    });
    const gearState = storage.createDefaultGearStorageState();
    gearState.inventory = [{ gear, locked: false, favorite: false }];
    storage.saveGearState(gearState, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    presetState = presets.setPresetSlot(presetState, {
      characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: gear.gearId, characterIds: ['kyoryu'],
    });
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
}

test('未装備slotと日本語status語彙を全幅で維持する', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await installHarness(page);
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/index.html?gear-status-visual-language-phase4s=1');
  await seedFixture(page);
  await page.evaluate(() => globalThis.__gearPhase4STest.openWorkbench());

  const expectedLabels = ['体力', '攻撃', '防御', '燃料', '会心', '爆発', '状態耐性', 'シールド', '回復'];
  await expect(page.locator('.gearSlot.empty')).toHaveCount(5);
  await expect(page.locator('.gearSlot.equipped')).toHaveCount(1);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const report = await page.evaluate(() => ({
      labels: [...document.querySelectorAll('.gearStat small')].map((node) => node.textContent.trim()),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      workshopOverflow: document.querySelector('#gearWorkshopBox').scrollWidth - document.querySelector('#gearWorkshopBox').clientWidth,
      empty: [...document.querySelectorAll('.gearSlot.empty')].map((node) => ({
        filter: getComputedStyle(node).filter,
        pointerEvents: getComputedStyle(node).pointerEvents,
        disabled: node.disabled,
        outerFill: getComputedStyle(node.querySelector('.gearSlotFrameOuter')).fill,
      })),
      equipped: [...document.querySelectorAll('.gearSlot.equipped')].map((node) => getComputedStyle(node).filter),
    }));
    expect(report.labels).toEqual(expectedLabels);
    expect(report.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    expect(report.workshopOverflow, `${viewport.width}px workshop overflow`).toBeLessThanOrEqual(0);
    for (const empty of report.empty) {
      expect(empty.filter).toContain('grayscale');
      expect(empty.pointerEvents).toBe('auto');
      expect(empty.disabled).toBe(false);
      expect(empty.outerFill).toBe('rgb(70, 80, 82)');
    }
    for (const filter of report.equipped) expect(filter).not.toContain('grayscale');
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await page.locator('#gearWorkshopBox').screenshot({ path: testInfo.outputPath('phase4s-workbench-412.png') });
  const emptySlot = page.locator('.gearSlot.empty').first();
  await emptySlot.click();
  await expect(emptySlot).toHaveClass(/selected/);
  await expect(page.locator('.gearInlineDetailEmptyTitle')).toHaveText('未装備');

  const equippedSlot = page.locator('.gearSlot.equipped').first();
  await equippedSlot.click();
  await expect(page.locator('.gearInlineDetailMain b')).toContainText(/^(攻撃|体力|防御|最大燃料|会心率|爆発威力|吹き飛ばし|吹き飛ばし耐性|状態異常耐性|回復力|シールド力)/);
  expect(errors).toEqual([]);
});
