const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915, minHeadroom: 10, socketDistance: 47 },
  { width: 390, height: 844, minHeadroom: 5, socketDistance: 38 },
  { width: 375, height: 812, minHeadroom: 5, socketDistance: 38 },
  { width: 360, height: 800, minHeadroom: 5, socketDistance: 38 },
  { width: 320, height: 640, minHeadroom: 4, socketDistance: 34 },
  { width: 1280, height: 900, minHeadroom: 10, socketDistance: 47 },
];

async function seedWorstCase(page) {
  await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const rewards = globalThis.KatamonGearRewards;
    const presets = globalThis.KatamonGearPresets;
    const presetStorage = globalThis.KatamonGearPresetStorage;
    const definitions = [
      ['phase4h-auxiliary', 'auxiliary', 'rescue', 'mythic', 12],
      ['phase4h-sight', 'sight', 'critical', 'legend', 6],
      ['phase4h-engine', 'engine', 'impact', 'rare', 3],
      ['phase4h-barrel', 'barrel', 'assault', 'normal', 1],
      ['phase4h-armor', 'armor', 'assault', 'epic', 9],
      ['phase4h-core', 'core', 'fortify', 'legend', 6],
    ];
    const make = ([gearId, slotId, setId, rarityId, level]) => {
      const base = domain.createGear({
        gearId,
        generationSeed: `phase4h:${gearId}:g`,
        enhancementSeed: `phase4h:${gearId}:e`,
        sourceId: 'cpu_battle',
        sourceDetail: { e2e: 'phase4h' },
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
    const drop = make(['phase4h-drop', 'barrel', 'last_stand', 'mythic', 0]);
    const queued = await rewards.persistQueueReward({
      rewardId: 'phase4h-reward', sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4h' }, createdAtMs: Date.now(), gears: [drop], blueprintShards: 0,
    }, localStorage);
    if (!queued.queued) throw new Error('Phase 4H reward was not queued');
  });
}

async function measureWorkbench(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  return page.locator('.gearBuildStage').evaluate((stage) => {
    const natural = (element) => {
      const clone = element.cloneNode(true); const style = getComputedStyle(element);
      clone.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;overflow:visible;'
        + 'width:auto;max-width:none;left:-9999px;font:' + style.font + ';letter-spacing:' + style.letterSpacing;
      document.body.appendChild(clone);
      const width = clone.getBoundingClientRect().width;
      clone.remove();
      return width;
    };
    const stageRect = stage.getBoundingClientRect();
    const slots = [...stage.querySelectorAll('.gearSlot')].map((slot) => {
      const rect = slot.getBoundingClientRect();
      const emblemRect = slot.querySelector('.gearSlotEmblem').getBoundingClientRect();
      const part = slot.querySelector('.gearSlotPart'); const name = slot.querySelector('.gearSlotName');
      const headrooms = [part, name].map((element) => element.getBoundingClientRect().width - natural(element));
      return {
        id: slot.dataset.gearSlot,
        rarity: slot.dataset.rarity,
        setState: slot.dataset.setState,
        distance: Math.round(Math.hypot((emblemRect.left + emblemRect.right - rect.left - rect.right) / 2, (emblemRect.top + emblemRect.bottom - rect.top - rect.bottom) / 2)),
        minHeadroom: Math.min(...headrooms),
        truncated: headrooms.some((value) => value < -0.5),
        socketOutside: emblemRect.left < stageRect.left - 1 || emblemRect.right > stageRect.right + 1 || emblemRect.top < stageRect.top - 1 || emblemRect.bottom > stageRect.bottom + 1,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      };
    });
    const overlaps = [];
    for (let a = 0; a < slots.length; a += 1) for (let b = a + 1; b < slots.length; b += 1) {
      const first = slots[a].rect; const second = slots[b].rect;
      if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1) overlaps.push(`${slots[a].id}/${slots[b].id}`);
    }
    const badControls = [...document.querySelectorAll('#gearWorkshopBox button,#gearWorkshopBox select')].filter((control) => {
      const rect = control.getBoundingClientRect(); const style = getComputedStyle(control);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map((control) => control.id || control.textContent.trim().slice(0, 20));
    return {
      slots,
      overlaps,
      badControls,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test('Workbench socketを6角度で等距離配置し、最悪ケースでも全幅で読める', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  await page.route('**/index.html?gear-workbench-slot-phase4h=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4HTest = { openWorkbench: openGearWorkshop, renderWorkbench: gearRender };\n  ${marker}`) });
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/index.html?gear-workbench-slot-phase4h=1');
  await page.waitForTimeout(400);
  await seedWorstCase(page);
  await page.evaluate(() => globalThis.__gearPhase4HTest.openWorkbench());
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.gearSlot')).toHaveCount(6);
  await expect(page.locator('[data-gear-slot="auxiliary"] .gearSlotPart')).toHaveText('補機 +12');
  await expect(page.locator('.gearSlot.equipped .gearSlotEmblem .gearAssetEmblem')).toHaveCount(6);

  const reports = [];
  for (const viewport of VIEWPORTS) {
    const report = await measureWorkbench(page, viewport);
    expect(report.slots).toHaveLength(6);
    expect(report.slots.map((slot) => slot.distance), `${viewport.width}px socket distance`).toEqual(Array(6).fill(viewport.socketDistance));
    expect(report.slots.filter((slot) => slot.truncated), `${viewport.width}px truncation`).toEqual([]);
    expect(Math.min(...report.slots.map((slot) => slot.minHeadroom)), `${viewport.width}px minimum headroom`).toBeGreaterThanOrEqual(viewport.minHeadroom - 0.5);
    expect(report.slots.filter((slot) => slot.socketOutside), `${viewport.width}px socket overflow`).toEqual([]);
    expect(report.overlaps, `${viewport.width}px slot overlap`).toEqual([]);
    expect(report.badControls, `${viewport.width}px control overflow`).toEqual([]);
    expect(report.documentOverflow, `${viewport.width}px horizontal overflow`).toBeLessThanOrEqual(0);
    reports.push({ viewport, ...report });
    console.log(`phase4h ${viewport.width}x${viewport.height}: headroom ${Math.min(...report.slots.map((slot) => slot.minHeadroom)).toFixed(2)}px, sockets ${report.slots.map((slot) => slot.distance).join('/')}, truncation 0`);
  }

  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath('phase4h-workbench-412.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.screenshot({ path: testInfo.outputPath('phase4h-workbench-320.png'), fullPage: true });

  const colors = await page.locator('.gearSlot').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.dataset.gearSlot,
    state: node.dataset.setState,
    ringStroke: getComputedStyle(node.querySelector('.gearSocketRing')).stroke,
    innerFill: getComputedStyle(node.querySelector('.gearSlotFrameInner')).fill,
  })));
  expect(colors.find((entry) => entry.id === 'barrel')).toMatchObject({ state: 'two', ringStroke: 'rgb(224, 60, 60)' });
  expect(colors.find((entry) => entry.id === 'core')).toMatchObject({ state: 'none', ringStroke: 'rgb(211, 161, 93)' });
  expect(new Set(colors.map((entry) => entry.innerFill))).toEqual(new Set(['rgb(38, 56, 59)']));

  await page.evaluate(() => {
    const presets = globalThis.KatamonGearPresets; const presetStorage = globalThis.KatamonGearPresetStorage;
    let state = presetStorage.load(localStorage, { characterIds: ['kyoryu'] });
    state = presets.setPresetSlot(state, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'auxiliary', gearId: null, characterIds: ['kyoryu'] });
    presetStorage.save(state, localStorage, { characterIds: ['kyoryu'] });
    globalThis.__gearPhase4HTest.renderWorkbench();
  });
  await expect(page.locator('.gearSlot.empty .gearSlotEmblem .gearAssetEmblem')).toHaveCount(0);

  await page.evaluate(() => globalThis.KatamonGearDropReveal.presentRewardId('phase4h-reward'));
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  const notched = await page.locator('.gearDropSlot .gearSlotFrameOuter').evaluateAll((nodes) => nodes.filter((node) => (node.getAttribute('d') || '').includes('L18 51')).length);
  expect(notched).toBe(6);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: testInfo.outputPath('phase4h-drop-unchanged.png'), fullPage: true });
  await testInfo.attach('phase4h-metrics.json', { body: Buffer.from(JSON.stringify(reports, null, 2)), contentType: 'application/json' });
  expect(failures).toEqual([]);
});
