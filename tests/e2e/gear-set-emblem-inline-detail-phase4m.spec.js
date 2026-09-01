const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915, partPx: 10, namePx: 11.6 },
  { width: 390, height: 844, partPx: 8.8, namePx: 9.4 },
  { width: 320, height: 640, partPx: 7.8, namePx: 8.4 },
  { width: 1280, height: 900, partPx: 10, namePx: 11.6 },
];

async function seedFixture(page) {
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const definitions = [
      ['phase4m-auxiliary', 'auxiliary', 'rescue', 'mythic', 12],
      ['phase4m-sight', 'sight', 'critical', 'legend', 6],
      ['phase4m-engine', 'engine', 'impact', 'rare', 3],
      ['phase4m-barrel', 'barrel', 'assault', 'normal', 1],
      ['phase4m-armor', 'armor', 'assault', 'epic', 9],
      ['phase4m-core', 'core', 'fortify', 'legend', 6],
    ];
    const make = ([gearId, slotId, setId, rarityId, level]) => {
      const base = domain.createGear({
        gearId,
        generationSeed: `phase4m:${gearId}:g`,
        enhancementSeed: `phase4m:${gearId}:e`,
        sourceId: 'cpu_battle',
        sourceDetail: { e2e: 'phase4m' },
        acquiredAt: Date.now(),
        qualityProfile: { id: `${gearId}:quality`, starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: rarityId, weight: 1 }] },
        setProfile: { id: `${gearId}:set`, setWeights: [{ id: setId, weight: 1 }] },
        slotId,
        setId,
      });
      return level ? domain.enhanceGear(base, level) : base;
    };
    const gears = definitions.map(make);
    const state = storage.createDefaultGearStorageState();
    state.inventory = gears.map((gear) => ({ gear, locked: false, favorite: false }));
    storage.saveGearState(state, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    for (const gear of gears) presetState = presets.setPresetSlot(presetState, {
      characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: ['kyoryu'],
    });
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
}

async function measure(page) {
  return page.locator('#gearWorkshopBox').evaluate((box) => {
    const naturalWidth = (element) => {
      const clone = element.cloneNode(true);
      const style = getComputedStyle(element);
      clone.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;overflow:visible;width:max-content;max-width:none;left:-9999px;font:${style.font};letter-spacing:${style.letterSpacing}`;
      document.body.appendChild(clone);
      const width = clone.getBoundingClientRect().width;
      clone.remove();
      return width;
    };
    const slots = [...box.querySelectorAll('.gearSlot')].map((slot) => {
      const part = slot.querySelector('.gearSlotPart');
      const name = slot.querySelector('.gearSlotName');
      const rect = slot.getBoundingClientRect();
      return {
        id: slot.dataset.gearSlot,
        partHeadroom: part.getBoundingClientRect().width - naturalWidth(part),
        nameHeadroom: name.getBoundingClientRect().width - naturalWidth(name),
        partPx: parseFloat(getComputedStyle(part).fontSize),
        namePx: parseFloat(getComputedStyle(name).fontSize),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      };
    });
    const overlaps = [];
    for (let first = 0; first < slots.length; first += 1) for (let second = first + 1; second < slots.length; second += 1) {
      const a = slots[first].rect; const b = slots[second].rect;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${slots[first].id}/${slots[second].id}`);
    }
    const detail = box.querySelector('.gearInlineDetail')?.getBoundingClientRect();
    const effects = box.querySelector('.gearInlineSetEffects')?.getBoundingClientRect();
    const plate = box.querySelector('.gearCharacterPlate');
    const plateRect = plate?.getBoundingClientRect();
    const plateName = plate?.querySelector('.gearCharacterPlateName');
    const plateNameRect = plateName?.getBoundingClientRect();
    const plateCount = plate?.querySelector('.gearCharacterPlateCount');
    const plateCountRect = plateCount?.getBoundingClientRect();
    const plateEquipped = plate?.querySelector('.gearCharacterPlateEquipped');
    const bottomSlots = slots.filter((slot) => slot.id === 'engine' || slot.id === 'core');
    const plateContentRect = plateNameRect && plateCountRect ? {
      left: Math.min(plateNameRect.left, plateCountRect.left), right: Math.max(plateNameRect.right, plateCountRect.right),
      top: Math.min(plateNameRect.top, plateCountRect.top), bottom: Math.max(plateNameRect.bottom, plateCountRect.bottom),
    } : null;
    return {
      slots,
      overlaps,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      boxOverflow: box.scrollWidth - box.clientWidth,
      detailHorizontalInsideViewport: Boolean(detail && detail.left >= -1 && detail.right <= innerWidth + 1),
      effectsInsideCard: Boolean(detail && effects && effects.left >= detail.left - 1 && effects.right <= detail.right + 1),
      plateNameHeadroom: plateName ? plateNameRect.width - naturalWidth(plateName) : -999,
      plateCountHeadroom: plateCount ? plateCountRect.width - naturalWidth(plateCount) : -999,
      plateCountInside: Boolean(plateRect && plateCountRect && plateCountRect.left >= plateRect.left - 1 && plateCountRect.right <= plateRect.right + 1),
      plateContentClear: Boolean(plateContentRect && bottomSlots.every(({ rect }) => Math.min(plateContentRect.right, rect.right) - Math.max(plateContentRect.left, rect.left) <= 1)),
      plateEquippedVisible: Boolean(plateEquipped && getComputedStyle(plateEquipped).display !== 'none'),
    };
  });
}

test('紋章タップでDomain準拠のセット効果を表示し、6枠の2行を全幅で読みやすく保つ', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.route('**/index.html?gear-set-emblem-inline-detail-phase4m=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4MTest = { openWorkbench: openGearWorkshop };\n  ${marker}`) });
  });
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/index.html?gear-set-emblem-inline-detail-phase4m=1');
  await page.waitForTimeout(400);
  await seedFixture(page);
  await page.evaluate(() => globalThis.__gearPhase4MTest.openWorkbench());
  await page.evaluate(() => document.fonts.ready);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.locator('[data-gear-slot="barrel"]').click();
    const button = page.locator('.gearInlineSetButton');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button.locator('.gearInlineSetEmblem')).toHaveJSProperty('naturalWidth', 256);
    await button.click();
    await expect(page.locator('.gearInlineSetEffects')).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-gear-inline-set-threshold="2"]')).toContainText('攻撃+8%');
    await expect(page.locator('[data-gear-inline-set-threshold="2"]')).toContainText('発動中');
    await expect(page.locator('[data-gear-inline-set-threshold="4"]')).toContainText('与ダメージ+12%');
    await expect(page.locator('[data-gear-inline-set-threshold="4"]')).toContainText('あと2部位');
    const report = await measure(page);
    expect(report.slots.filter((slot) => slot.partHeadroom < -0.5 || slot.nameHeadroom < -0.5), `${viewport.width}px truncation`).toEqual([]);
    expect(report.slots.map((slot) => slot.partPx), `${viewport.width}px part font`).toEqual(Array(6).fill(viewport.partPx));
    expect(report.slots.map((slot) => slot.namePx), `${viewport.width}px name font`).toEqual(Array(6).fill(viewport.namePx));
    expect(report.overlaps, `${viewport.width}px slot overlap`).toEqual([]);
    expect(report.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    expect(report.boxOverflow, `${viewport.width}px workshop overflow`).toBeLessThanOrEqual(0);
    expect(report.detailHorizontalInsideViewport, `${viewport.width}px detail horizontal viewport`).toBe(true);
    expect(report.effectsInsideCard, `${viewport.width}px effects card`).toBe(true);
    expect(report.plateNameHeadroom, `${viewport.width}px preset name truncation`).toBeGreaterThanOrEqual(-0.5);
    expect(report.plateCountHeadroom, `${viewport.width}px equipped count truncation`).toBeGreaterThanOrEqual(-0.5);
    expect(report.plateCountInside, `${viewport.width}px equipped count inside plate`).toBe(true);
    if (viewport.width <= 360) expect(report.plateContentClear, `${viewport.width}px plate text clear of bottom slots`).toBe(true);
    expect(report.plateEquippedVisible, `${viewport.width}px responsive EQUIPPED label`).toBe(viewport.width > 360);
    console.log(`phase4m ${viewport.width}x${viewport.height}: part ${viewport.partPx}px, set ${viewport.namePx}px, truncation/overlap/overflow 0`);
    await button.click();
    await expect(page.locator('.gearInlineSetEffects')).toHaveCount(0);
  }

  if (testInfo.project.name.includes('chromium')) {
    await page.setViewportSize(VIEWPORTS[0]);
    await page.locator('[data-gear-slot="barrel"]').click();
    await page.locator('.gearInlineSetButton').click();
    await page.screenshot({ path: testInfo.outputPath('phase4m-set-detail-412.png'), fullPage: true });
    await page.setViewportSize(VIEWPORTS[2]);
    await page.screenshot({ path: testInfo.outputPath('phase4m-set-detail-320.png'), fullPage: true });
  }
  expect(errors).toEqual([]);
});
