const { test, expect } = require('@playwright/test');

test('6Pチーズ型Gear slotを位置で識別し、比較・装備・更新発光まで完了できる', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/index.html?gear-slot-frame-phase4b=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '\n})();\n</script>';
    const position = source.lastIndexOf(marker);
    expect(position).toBeGreaterThan(0);
    await route.fulfill({ response, body: `${source.slice(0, position)}\n  window.__gearSlotFrameTest = { open: openGearWorkshop };${source.slice(position)}` });
  });
  await page.goto('/index.html?gear-slot-frame-phase4b=1');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const presets = globalThis.KatamonGearPresets;
    const make = (id, slotId, setId, seed) => domain.createGear({ gearId: id, generationSeed: `frame:${seed}:g`, enhancementSeed: `frame:${seed}:e`, sourceId: 'cpu_battle', sourceDetail: { e2e: 'gear-slot-frame' }, acquiredAt: '2026-08-30T00:00:00Z', qualityProfile: { id: 'frame', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: `frame:${setId}`, setWeights: [{ id: setId, weight: 1 }] }, slotId, setId });
    const items = [
      make('frame-barrel-current', 'barrel', 'assault', 'barrel-current'),
      make('frame-barrel-new', 'barrel', 'life', 'barrel-new'),
      make('frame-armor', 'armor', 'fortify', 'armor'),
      make('frame-core', 'core', 'critical', 'core'),
      make('frame-engine', 'engine', 'blast', 'engine'),
      make('frame-sight', 'sight', 'impact', 'sight'),
      make('frame-auxiliary', 'auxiliary', 'rescue', 'auxiliary')
    ];
    const gearState = storage.createDefaultGearStorageState();
    gearState.inventory = items.map((gear) => ({ gear, locked: false, favorite: false }));
    storage.saveGearState(gearState, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    for (const gear of [items[0], items[2], items[3]]) {
      presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset1', slotId: gear.slotId, gearId: gear.gearId, characterIds: ['kyoryu'] });
    }
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
  await page.evaluate(() => globalThis.__gearSlotFrameTest.open());

  const measureLayout = () => page.evaluate(() => {
    const stage = document.querySelector('#gearBuildStage').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.gearSlot')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.gearSlot, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    });
    return { stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom, cx: stage.left + stage.width / 2, cy: stage.top + stage.height / 2 }, boxes, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  const expectClearLayout = (layout, width) => {
    expect(layout.horizontalOverflow, `${width}px page has horizontal overflow`).toBe(false);
    for (const box of layout.boxes) {
      expect(box.left, `${width}px ${box.id} leaves stage left`).toBeGreaterThanOrEqual(layout.stage.left);
      expect(box.right, `${width}px ${box.id} leaves stage right`).toBeLessThanOrEqual(layout.stage.right);
      expect(box.top, `${width}px ${box.id} leaves stage top`).toBeGreaterThanOrEqual(layout.stage.top);
      expect(box.bottom, `${width}px ${box.id} leaves stage bottom`).toBeLessThanOrEqual(layout.stage.bottom);
    }
    for (let index = 0; index < layout.boxes.length; index += 1) {
      for (let other = index + 1; other < layout.boxes.length; other += 1) {
        const a = layout.boxes[index]; const b = layout.boxes[other];
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap, `${width}px ${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
  };

  const stage = page.locator('#gearBuildStage');
  const slots = page.locator('.gearSlot');
  await expect(slots).toHaveCount(6);
  await expect(page.locator('.gearSlotFrame')).toHaveCount(6);
  await expect(page.locator('.gearSlot.equipped')).toHaveCount(3);
  await expect(page.locator('.gearSlot.empty')).toHaveCount(3);
  await expect(page.locator('.gearCharacterImage')).toBeVisible();

  const expectedPositions = {
    barrel: 'right-top', armor: 'right-middle', core: 'right-bottom',
    engine: 'left-bottom', sight: 'left-middle', auxiliary: 'left-top'
  };
  for (const [slotId, position] of Object.entries(expectedPositions)) {
    await expect(page.locator(`[data-gear-slot="${slotId}"]`)).toHaveAttribute('data-frame-position', position);
  }

  const layout = await measureLayout();
  const byId = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
  for (const slotId of ['auxiliary', 'sight', 'engine']) expect(byId[slotId].cx, `${slotId} is in left column`).toBeLessThan(layout.stage.cx);
  for (const slotId of ['barrel', 'armor', 'core']) expect(byId[slotId].cx, `${slotId} is in right column`).toBeGreaterThan(layout.stage.cx);
  expect(Math.abs(byId.auxiliary.cy - byId.barrel.cy)).toBeLessThan(4);
  expect(Math.abs(byId.sight.cy - byId.armor.cy)).toBeLessThan(4);
  expect(Math.abs(byId.engine.cy - byId.core.cy)).toBeLessThan(4);
  expect(byId.auxiliary.cy).toBeLessThan(byId.sight.cy);
  expect(byId.sight.cy).toBeLessThan(byId.engine.cy);
  expectClearLayout(layout, page.viewportSize().width);

  const initialViewport = page.viewportSize();
  for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    expectClearLayout(await measureLayout(), viewport.width);
  }
  await page.setViewportSize(initialViewport);

  await page.locator('[data-gear-slot="barrel"]').click();
  await expect(page.locator('[data-gear-slot="barrel"]')).toHaveClass(/selected/);
  await expect(page.locator('#gearInventoryTitle [data-gear-slot-mini="barrel"]')).toBeVisible();
  await page.locator('[data-gear-candidate="frame-barrel-new"]').click();
  await expect(page.locator('#gearCompare [data-gear-slot-mini="barrel"]')).toBeVisible();
  await page.locator('[data-gear-equip="frame-barrel-new"]').click();
  await expect(page.locator('[data-gear-slot="barrel"]')).toHaveClass(/updated/);
  await expect(page.locator('[data-gear-slot="barrel"]')).toContainText('生命');
  await expect(page.locator('.gearSetPanel')).toContainText('生命');
  expect(await page.locator('#gearWorkshopBox').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gear-slot-frame-phase4b-android.png'), fullPage: true });

  expect(errors).toEqual([]);
});
