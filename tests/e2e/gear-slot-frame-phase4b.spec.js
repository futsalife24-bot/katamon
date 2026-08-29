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

  const stage = page.locator('#gearBuildStage');
  const slots = page.locator('.gearSlot');
  await expect(slots).toHaveCount(6);
  await expect(page.locator('.gearSlotFrame')).toHaveCount(6);
  await expect(page.locator('.gearSlot.equipped')).toHaveCount(3);
  await expect(page.locator('.gearSlot.empty')).toHaveCount(3);
  await expect(page.locator('.gearCharacterImage')).toBeVisible();

  const expectedPositions = {
    barrel: 'north', armor: 'north-east', core: 'south-east',
    engine: 'south', sight: 'south-west', auxiliary: 'north-west'
  };
  for (const [slotId, position] of Object.entries(expectedPositions)) {
    await expect(page.locator(`[data-gear-slot="${slotId}"]`)).toHaveAttribute('data-frame-position', position);
  }

  const layout = await page.evaluate(() => {
    const stage = document.querySelector('#gearBuildStage').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.gearSlot')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.gearSlot, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    });
    return { stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom, cx: stage.left + stage.width / 2, cy: stage.top + stage.height / 2 }, boxes };
  });
  const byId = Object.fromEntries(layout.boxes.map((box) => [box.id, box]));
  expect(Math.abs(byId.barrel.cx - layout.stage.cx)).toBeLessThan(4);
  expect(byId.barrel.cy).toBeLessThan(layout.stage.cy);
  expect(byId.armor.cx).toBeGreaterThan(layout.stage.cx);
  expect(byId.armor.cy).toBeLessThan(layout.stage.cy);
  expect(byId.core.cx).toBeGreaterThan(layout.stage.cx);
  expect(byId.core.cy).toBeGreaterThan(layout.stage.cy);
  expect(Math.abs(byId.engine.cx - layout.stage.cx)).toBeLessThan(4);
  expect(byId.engine.cy).toBeGreaterThan(layout.stage.cy);
  expect(byId.sight.cx).toBeLessThan(layout.stage.cx);
  expect(byId.sight.cy).toBeGreaterThan(layout.stage.cy);
  expect(byId.auxiliary.cx).toBeLessThan(layout.stage.cx);
  expect(byId.auxiliary.cy).toBeLessThan(layout.stage.cy);
  for (const box of layout.boxes) {
    expect(box.left).toBeGreaterThanOrEqual(layout.stage.left);
    expect(box.right).toBeLessThanOrEqual(layout.stage.right);
    expect(box.top).toBeGreaterThanOrEqual(layout.stage.top);
    expect(box.bottom).toBeLessThanOrEqual(layout.stage.bottom);
  }
  for (let index = 0; index < layout.boxes.length; index += 1) {
    for (let other = index + 1; other < layout.boxes.length; other += 1) {
      const a = layout.boxes[index]; const b = layout.boxes[other];
      const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false);
    }
  }

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

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(stage).toBeVisible();
  expect(await page.locator('#gearWorkshopBox').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
