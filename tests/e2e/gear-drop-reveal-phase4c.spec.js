const { test, expect } = require('@playwright/test');

test('canonical CPU Gear rewardを6P位置でrevealしWorkbenchの同slotへ案内する', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-drop-reveal-phase4c=1');
  await page.waitForTimeout(650);
  const storedBefore = await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain;
    const storage = globalThis.KatamonGearStorage;
    const rewards = globalThis.KatamonGearRewards;
    const make = (gearId, slotId, setId, rarityId, star) => domain.createGear({
      gearId, generationSeed: `drop:${gearId}:g`, enhancementSeed: `drop:${gearId}:e`,
      sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4c' }, acquiredAt: '2026-08-30T00:00:00Z',
      qualityProfile: { id: `drop:${rarityId}`, starWeights: [{ id: star, weight: 1 }], rarityWeights: [{ id: rarityId, weight: 1 }] },
      setProfile: { id: `drop:${setId}`, setWeights: [{ id: setId, weight: 1 }] }, slotId, setId,
    });
    const reward = { rewardId: 'drop-reveal-e2e', sourceId: 'cpu_battle', sourceDetail: { run: 'e2e' }, createdAtMs: 100,
      gears: [make('drop-barrel', 'barrel', 'assault', 'legend', 5), make('drop-core', 'core', 'life', 'mythic', 6)], blueprintShards: 0 };
    storage.saveGearState(storage.createDefaultGearStorageState(), localStorage);
    const queued = await rewards.persistQueueReward(reward, localStorage);
    if (!queued.queued) throw new Error('reward was not durably queued');
    const before = localStorage.getItem(storage.STORAGE_KEY);
    if (!globalThis.KatamonGearDropReveal.presentRewardId(reward.rewardId)) throw new Error('reveal did not open');
    return before;
  });

  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('.gearDropSlot')).toHaveCount(6);
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'barrel');
  await expect(page.locator('.gearDropSlot.active')).toContainText('砲身');
  await expect(page.locator('.gearDropCard')).toHaveAttribute('data-rarity', 'legend');
  await expect(page.locator('.gearDropCard')).toContainText('猛攻');
  await expect(page.locator('.gearDropStars')).toHaveText('★★★★★');
  await expect(page.locator('.gearDropCard')).toContainText('攻撃');
  await page.screenshot({ path: testInfo.outputPath('gear-drop-reveal-phase4c-reveal.png'), fullPage: true });

  const expectLayout = async (viewport) => {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.gearDropPanel').getBoundingClientRect();
      const map = document.querySelector('.gearDropMap').getBoundingClientRect();
      const slots = [...document.querySelectorAll('.gearDropSlot')].map((node) => { const r = node.getBoundingClientRect(); return { id: node.dataset.gearDropSlot, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
      const actions = [...document.querySelectorAll('.gearDropActions button:not([hidden])')].map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
      return { panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, map: { left: map.left, right: map.right }, slots, actions, pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    expect(layout.pageWidth, `${viewport.width}px page overflow`).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.panel.left).toBeGreaterThanOrEqual(0); expect(layout.panel.right).toBeLessThanOrEqual(viewport.width);
    for (const slot of layout.slots) { expect(slot.left).toBeGreaterThanOrEqual(layout.map.left); expect(slot.right).toBeLessThanOrEqual(layout.map.right); }
    for (let i = 0; i < layout.slots.length; i += 1) for (let j = i + 1; j < layout.slots.length; j += 1) {
      const a = layout.slots[i]; const b = layout.slots[j];
      expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, `${viewport.width}px ${a.id}/${b.id} overlap`).toBe(false);
    }
    for (let i = 0; i < layout.actions.length; i += 1) for (let j = i + 1; j < layout.actions.length; j += 1) {
      const a = layout.actions[i]; const b = layout.actions[j];
      expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, `${viewport.width}px action overlap`).toBe(false);
    }
  };
  for (const viewport of [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) await expectLayout(viewport);

  await page.locator('#gearDropNext').click();
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'core');
  await expect(page.locator('.gearDropCard')).toHaveAttribute('data-rarity', 'mythic');
  await expect(page.locator('.gearDropCard')).toContainText('生命');
  await expect(page.locator('#gearDropNext')).toBeHidden();

  expect(await page.evaluate(() => globalThis.KatamonGearDropReveal.presentRewardId('drop-reveal-e2e'))).toBe(false);
  expect(await page.evaluate((before) => localStorage.getItem(globalThis.KatamonGearStorage.STORAGE_KEY) === before, storedBefore)).toBe(true);
  await page.locator('#gearDropWorkbench').click();
  await expect(page.locator('#gearDropReveal')).not.toHaveClass(/open/);
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await expect(page.locator('[data-gear-slot="core"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-gear-slot="core"]')).toHaveClass(/updated/);
  expect(await page.evaluate((before) => localStorage.getItem(globalThis.KatamonGearStorage.STORAGE_KEY) === before, storedBefore)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gear-drop-reveal-phase4c.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('reduced motionでも同じ部位情報をanimationなしで読める', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html?gear-drop-reveal-phase4c-reduced=1');
  await page.waitForTimeout(500);
  const animation = await page.evaluate(() => getComputedStyle(document.querySelector('#gearDropReveal .gearDropPanel')).animationName);
  expect(animation).toBe('none');
  const before = await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage;
    const gear = domain.createGear({ gearId: 'drop-close-engine', generationSeed: 'drop:close:g', enhancementSeed: 'drop:close:e', sourceId: 'cpu_battle', sourceDetail: null, acquiredAt: '2026-08-30T00:00:00Z', qualityProfile: { id: 'drop-close', starWeights: [{ id: 3, weight: 1 }], rarityWeights: [{ id: 'rare', weight: 1 }] }, setProfile: { id: 'drop-close-life', setWeights: [{ id: 'life', weight: 1 }] }, slotId: 'engine', setId: 'life' });
    storage.saveGearState(storage.createDefaultGearStorageState(), localStorage);
    await globalThis.KatamonGearRewards.persistQueueReward({ rewardId: 'drop-close-reward', sourceId: 'cpu_battle', sourceDetail: null, createdAtMs: 200, gears: [gear], blueprintShards: 0 }, localStorage);
    const raw = localStorage.getItem(storage.STORAGE_KEY);
    globalThis.KatamonGearDropReveal.presentRewardId('drop-close-reward');
    return raw;
  });
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'engine');
  await page.locator('#gearDropClose').click();
  await expect(page.locator('#gearDropReveal')).not.toHaveClass(/open/);
  expect(await page.evaluate((raw) => localStorage.getItem(globalThis.KatamonGearStorage.STORAGE_KEY) === raw, before)).toBe(true);
});
