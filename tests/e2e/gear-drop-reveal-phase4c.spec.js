const { test, expect } = require('@playwright/test');

test('canonical CPU Gear rewardを6P位置でrevealしWorkbenchの同slotへ案内する', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/index.html?gear-drop-reveal-phase4c=1', async (route) => {
    const response = await route.fetch(); const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '\n})();\n</script>'; const position = source.lastIndexOf(marker);
    expect(position).toBeGreaterThan(0);
    await route.fulfill({ response, body: `${source.slice(0, position)}\n  window.__gearDropPhase4cTest = { openGearWorkshop };${source.slice(position)}` });
  });
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
    const before = localStorage.getItem(storage.GEAR_STORAGE_KEY);
    if (!globalThis.KatamonGearDropReveal.presentRewardId(reward.rewardId)) throw new Error('reveal did not open');
    return before;
  });

  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('#gearDropTitle')).toHaveText('GEAR DROP!');
  await expect(page.locator('#gearDropWorkbench')).toBeHidden();
  await expect(page.locator('#gearDropClaim')).toBeHidden();
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

  await page.locator('#gearDropClose').click();
  await expect(page.locator('#gearDropReveal')).not.toHaveClass(/open/);
  expect(await page.evaluate((before) => localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === before, storedBefore)).toBe(true);
  await page.evaluate(() => globalThis.__gearDropPhase4cTest.openGearWorkshop());
  await expect(page.locator('#gearPendingRewards')).toBeVisible();
  await expect(page.locator('#gearPendingRewardCount')).toHaveText('1');
  await page.locator('#gearPendingRewards').click();
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'barrel');

  await page.locator('#gearDropNext').click();
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'core');
  await expect(page.locator('.gearDropCard')).toHaveAttribute('data-rarity', 'mythic');
  await expect(page.locator('.gearDropCard')).toContainText('生命');
  await expect(page.locator('#gearDropNext')).toBeHidden();
  await expect(page.locator('#gearDropClaim')).toBeVisible();
  await expect(page.locator('#gearDropWorkbench')).toBeHidden();

  expect(await page.evaluate(() => globalThis.KatamonGearDropReveal.presentRewardId('drop-reveal-e2e'))).toBe(false);
  expect(await page.evaluate((before) => localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === before, storedBefore)).toBe(true);
  await page.locator('#gearDropClaim').click();
  await expect(page.locator('#gearDropTitle')).toHaveText('GEAR GET!');
  await expect(page.locator('.gearDropRouting')).toContainText('インベントリへ保存');
  await expect(page.locator('.gearDropRouting')).toContainText('インベントリ 2件 / TEMP BOX 0件');
  await expect(page.locator('#gearDropClaim')).toBeHidden();
  await expect(page.locator('#gearDropWorkbench')).toBeVisible();
  const claimed = await page.evaluate(async () => {
    const storage = globalThis.KatamonGearStorage; const rewards = globalThis.KatamonGearRewards;
    const state = storage.loadGearState(localStorage);
    const beforeDuplicate = state.inventory.filter((entry) => entry.gear.gearId.startsWith('drop-')).length;
    const duplicate = await rewards.persistClaimReward('drop-reveal-e2e', Date.now(), localStorage);
    const after = storage.loadGearState(localStorage);
    return { pending: after.unclaimedRewards.length, ledger: after.rewardLedger['drop-reveal-e2e'], ids: after.inventory.map((entry) => entry.gear.gearId).filter((id) => id.startsWith('drop-')).sort(), beforeDuplicate, afterDuplicate: after.inventory.filter((entry) => entry.gear.gearId.startsWith('drop-')).length, duplicate: duplicate.duplicate };
  });
  expect(claimed).toEqual({ pending: 0, ledger: true, ids: ['drop-barrel', 'drop-core'], beforeDuplicate: 2, afterDuplicate: 2, duplicate: true });
  await expect(page.locator('#gearPendingRewards')).toBeHidden();
  for (const viewport of [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) await expectLayout(viewport);
  await page.screenshot({ path: testInfo.outputPath('gear-drop-reveal-phase4c-claimed.png'), fullPage: true });
  await page.evaluate(() => {
    globalThis.__gearDropSawBarrelHighlight = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-gear-slot="barrel"].updated')) {
        globalThis.__gearDropSawBarrelHighlight = true;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('#gearDropWorkbench').click();
  await expect(page.locator('#gearDropReveal')).not.toHaveClass(/open/);
  await expect(page.locator('#gearGuide')).toHaveClass(/open/);
  await page.locator('.gearGuideHeader [data-gear-guide-skip]').dispatchEvent('click');
  await expect(page.locator('#gearGuide')).not.toHaveClass(/open/);
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await expect(page.locator('[data-gear-slot="barrel"]')).toHaveClass(/selected/);
  await expect.poll(() => page.evaluate(() => globalThis.__gearDropSawBarrelHighlight)).toBe(true);
  await expect(page.locator('[data-gear-candidate="drop-barrel"]')).toBeVisible();
  expect(await page.evaluate((before) => localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === before, storedBefore)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('gear-drop-reveal-phase4c.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('claim失敗はpendingを保ち、満杯inventoryでは既存authorityがTEMP BOXへroutingする', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-drop-reveal-phase4c-temp=1');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage; const rewards = globalThis.KatamonGearRewards;
    const make = (gearId, slotId = 'barrel') => domain.createGear({ gearId, generationSeed: `temp:${gearId}:g`, enhancementSeed: `temp:${gearId}:e`, sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4c-temp' }, acquiredAt: '2026-08-30T00:00:00Z', qualityProfile: { id: 'temp-normal', starWeights: [{ id: 1, weight: 1 }], rarityWeights: [{ id: 'normal', weight: 1 }] }, setProfile: { id: 'temp-assault', setWeights: [{ id: 'assault', weight: 1 }] }, slotId, setId: 'assault' });
    const state = storage.createDefaultGearStorageState();
    state.inventory = Array.from({ length: storage.MAIN_INVENTORY_CAPACITY }, (_entry, index) => ({ gear: make(`temp-full-${index}`), locked: false, favorite: false }));
    storage.saveGearState(state, localStorage);
    const reward = { rewardId: 'temp-route-reward', sourceId: 'cpu_battle', sourceDetail: { run: 'temp' }, createdAtMs: 300, gears: [make('temp-route-engine', 'engine')], blueprintShards: 0 };
    await rewards.persistQueueReward(reward, localStorage);
    globalThis.KatamonGearDropReveal.presentRewardId(reward.rewardId);
    localStorage.setItem(rewards.GEAR_TRANSACTION_STORAGE_KEY, '{"pending":true}');
  });
  await expect(page.locator('#gearDropClaim')).toBeVisible();
  await page.locator('#gearDropClaim').click();
  await expect(page.locator('.gearDropRouting.error')).toContainText('Gear取引を復旧中');
  expect(await page.evaluate(() => globalThis.KatamonGearStorage.loadGearState(localStorage).unclaimedRewards.some((reward) => reward.rewardId === 'temp-route-reward'))).toBe(true);
  await page.evaluate(() => localStorage.removeItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY));
  await page.locator('#gearDropClaim').click();
  await expect(page.locator('#gearDropTitle')).toHaveText('GEAR GET!');
  await expect(page.locator('.gearDropRouting')).toContainText('TEMP BOXへ保管');
  await expect(page.locator('.gearDropRouting')).toContainText('インベントリ 0件 / TEMP BOX 1件');
  await expect(page.locator('#gearDropWorkbench')).toHaveText('同じ部位を見る');
  const routing = await page.evaluate(() => {
    const state = globalThis.KatamonGearStorage.loadGearState(localStorage);
    return { pending: state.unclaimedRewards.length, ledger: state.rewardLedger['temp-route-reward'], inventory: state.inventory.some((entry) => entry.gear.gearId === 'temp-route-engine'), temp: state.tempBox.some((entry) => entry.gear.gearId === 'temp-route-engine') };
  });
  expect(routing).toEqual({ pending: 0, ledger: true, inventory: false, temp: true });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.locator('.gearDropPanel').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator('#gearDropWorkbench').click();
  await expect(page.locator('[data-gear-slot="engine"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-gear-candidate="temp-route-engine"]')).toHaveCount(0);
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
    const raw = localStorage.getItem(storage.GEAR_STORAGE_KEY);
    globalThis.KatamonGearDropReveal.presentRewardId('drop-close-reward');
    return raw;
  });
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'engine');
  await page.locator('#gearDropClose').click();
  await expect(page.locator('#gearDropReveal')).not.toHaveClass(/open/);
  expect(await page.evaluate((raw) => localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === raw, before)).toBe(true);
});
