const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

async function seedPhase4e(page) {
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage; const presets = globalThis.KatamonGearPresets; const presetStorage = globalThis.KatamonGearPresetStorage; const foundation = globalThis.KatamonCoopMvp;
    const make = (gearId, slotId, options = {}) => domain.createGear({
      gearId, generationSeed: `${gearId}:g`, enhancementSeed: `${gearId}:e`, sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4e' }, acquiredAt: options.acquiredAt ?? Date.now(),
      qualityProfile: { id: `${gearId}:quality`, starWeights: [{ id: options.star || 5, weight: 1 }], rarityWeights: [{ id: options.rarityId || 'epic', weight: 1 }] },
      setProfile: { id: `${gearId}:set`, setWeights: [{ id: 'assault', weight: 1 }] }, slotId, setId: 'assault',
    });
    const state = storage.createDefaultGearStorageState();
    state.inventory = [
      { gear: make('phase4e-enhance', 'barrel'), locked: true, favorite: false },
      { gear: make('phase4e-dismantle', 'armor', { star: 4 }), locked: false, favorite: true },
      { gear: make('phase4e-preset', 'core'), locked: false, favorite: false },
    ];
    for (let index = state.inventory.length; index < storage.MAIN_INVENTORY_CAPACITY; index += 1) state.inventory.push({ gear: make(`phase4e-filler-${index}`, 'auxiliary', { star: 1, rarityId: 'normal', acquiredAt: index }), locked: false, favorite: false });
    state.tempBox = [{ gear: make('phase4e-temp', 'engine'), locked: false, favorite: false, enteredAtMs: Date.now() }];
    state.resources.powder = 2000; state.resources.blueprintShards = 50; storage.saveGearState(state, localStorage);
    const foundationState = foundation.createDefaultState(); foundationState.wallet.coins = 5000; foundation.saveState(foundationState, localStorage);
    let presetState = presets.createInitialState(['kyoryu']); presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset2', slotId: 'core', gearId: 'phase4e-preset', characterIds: ['kyoryu'] }); presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
}

test('Gear強化と安全なmanual dismantleをcanonical authorityで完了する', async ({ page }, testInfo) => {
  test.setTimeout(120000); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-enhance-dismantle-phase4e=1'); await page.waitForTimeout(500); await seedPhase4e(page);
  await page.evaluate(() => globalThis.KatamonGearStorageUi.open()); await expect(page.locator('#gearStorage')).toHaveClass(/open/);
  await expect(page.locator('#gearStorageResources')).toContainText('5000'); await expect(page.locator('#gearStorageResources')).toContainText('2000'); await expect(page.locator('#gearStorageResources')).toContainText('50');

  await page.locator('[data-gear-storage-detail="phase4e-enhance"]').click();
  await expect(page.locator('#gearStorageDetail')).toContainText('🔒 分解保護中'); await expect(page.locator('[data-gear-dismantle="phase4e-enhance"]')).toBeDisabled();
  await page.locator('[data-gear-enhance="phase4e-enhance"]').click(); await expect(page.locator('#gearEnhanceOverlay')).toHaveClass(/open/);
  await page.locator('[data-gear-enhance-target="3"]').click(); await expect(page.locator('#gearEnhanceContent')).toContainText('+3'); await expect(page.locator('#gearEnhanceContent')).toContainText('新しいサブOP');
  const before = await page.evaluate(() => ({ state: globalThis.KatamonGearStorage.loadGearState(localStorage), coins: globalThis.KatamonGearTransactions.loadStrictFoundationState(localStorage).state.wallet.coins }));
  const expectedCost = await page.evaluate(() => globalThis.KatamonGearDomain.calculateEnhancementCost(0, 3));
  await page.locator('[data-gear-enhance-confirm]').click(); await expect(page.locator('#gearEnhanceOverlay')).not.toHaveClass(/open/); await expect(page.locator('#gearStorageNotice')).toContainText('Gearを+3へ強化');
  const enhanced = await page.evaluate(() => ({ state: globalThis.KatamonGearStorage.loadGearState(localStorage), coins: globalThis.KatamonGearTransactions.loadStrictFoundationState(localStorage).state.wallet.coins }));
  const enhancedGear = enhanced.state.inventory.find((entry) => entry.gear.gearId === 'phase4e-enhance').gear;
  expect(enhancedGear.enhancementLevel).toBe(3); expect(enhancedGear.gearId).toBe('phase4e-enhance'); expect(enhanced.state.resources.powder).toBe(before.state.resources.powder - expectedCost.powder); expect(enhanced.coins).toBe(before.coins - expectedCost.coins);
  await page.locator('[data-gear-storage-workbench="phase4e-enhance"]').click(); await expect(page.locator('#gearWorkshop')).toHaveClass(/open/); await expect(page.locator('[data-gear-candidate="phase4e-enhance"]')).toContainText('強化 +3');

  await page.locator('#gearOpenStorage').click(); await page.locator('[data-gear-storage-detail="phase4e-dismantle"]').click(); await page.locator('[data-gear-dismantle="phase4e-dismantle"]').click();
  await expect(page.locator('#gearDismantleOverlay')).toHaveClass(/open/); await expect(page.locator('#gearDismantleContent')).toContainText('★ お気に入り登録済み'); await expect(page.locator('#gearDismantleContent')).toContainText('分解後は元に戻せません');
  const dismantleYield = await page.evaluate(() => { const entry = globalThis.KatamonGearStorage.loadGearState(localStorage).inventory.find((candidate) => candidate.gear.gearId === 'phase4e-dismantle'); return globalThis.KatamonGearDomain.calculateDismantleYield(entry.gear); });
  const resourcesBefore = await page.evaluate(() => globalThis.KatamonGearStorage.loadGearState(localStorage).resources); const coinsBeforeDismantle = enhanced.coins;
  await page.locator('[data-gear-dismantle-confirm]').click(); await expect(page.locator('#gearDismantleOverlay')).not.toHaveClass(/open/); await expect(page.locator('#gearStorageNotice')).toContainText(`パウダー +${dismantleYield.powder}`);
  const dismantled = await page.evaluate(() => ({ state: globalThis.KatamonGearStorage.loadGearState(localStorage), coins: globalThis.KatamonGearTransactions.loadStrictFoundationState(localStorage).state.wallet.coins }));
  expect(dismantled.state.inventory.some((entry) => entry.gear.gearId === 'phase4e-dismantle')).toBe(false); expect(dismantled.state.resources.powder).toBe(resourcesBefore.powder + dismantleYield.powder); expect(dismantled.state.resources.blueprintShards).toBe(resourcesBefore.blueprintShards + dismantleYield.blueprintShards); expect(dismantled.coins).toBe(coinsBeforeDismantle);

  await page.locator('[data-gear-storage-detail="phase4e-preset"]').click(); await expect(page.locator('[data-gear-dismantle="phase4e-preset"]')).toBeDisabled(); await expect(page.locator('#gearStorageDetail')).toContainText('プリセットから外してください');
  await page.locator('[data-gear-storage-tab="tempBox"]').click(); await page.locator('[data-gear-storage-detail="phase4e-temp"]').click(); await expect(page.locator('#gearStorageDetail')).toContainText('TEMP BOXのGearは強化・手動分解できません'); await expect(page.locator('#gearStorageDetail [data-gear-enhance]')).toHaveCount(0); await expect(page.locator('#gearStorageDetail [data-gear-dismantle]')).toHaveCount(0);

  await page.locator('[data-gear-storage-tab="inventory"]').click(); await page.locator('[data-gear-storage-detail="phase4e-enhance"]').click(); await page.locator('[data-gear-enhance="phase4e-enhance"]').click();
  for (const viewport of [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport); const layout = await page.locator('.gearActionPanel:visible').evaluate((node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; }); expect(layout.left).toBeGreaterThanOrEqual(-1); expect(layout.right).toBeLessThanOrEqual(viewport.width + 1); expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  }
  await page.screenshot({ path: testInfo.outputPath('gear-enhance-phase4e.png'), fullPage: true }); expect(errors).toEqual([]);
});

test('locked/preset/TEMP writer safetyとdouble tapは二重mutationを起こさない', async ({ page }) => {
  test.setTimeout(90000); const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/index.html?gear-phase4e-safety=1'); await page.waitForTimeout(400); await seedPhase4e(page);
  const result = await page.evaluate(async () => {
    const rewards = globalThis.KatamonGearRewards; const before = globalThis.KatamonGearStorage.loadGearState(localStorage); const codes = {};
    for (const id of ['phase4e-enhance', 'phase4e-preset', 'phase4e-temp']) { try { await rewards.persistDismantleInventoryGear(id, localStorage, { characterIds: ['kyoryu'] }); } catch (error) { codes[id] = error.code; } }
    return { codes, unchanged: localStorage.getItem(globalThis.KatamonGearStorage.GEAR_STORAGE_KEY) === globalThis.KatamonGearStorage.encodeGearStorageState(before) };
  });
  expect(result.codes).toEqual({ 'phase4e-enhance': 'GEAR_LOCKED', 'phase4e-preset': 'GEAR_REFERENCED_BY_PRESET', 'phase4e-temp': 'GEAR_NOT_IN_INVENTORY' }); expect(result.unchanged).toBe(true);
  await page.evaluate(() => globalThis.KatamonGearStorageUi.open()); await page.locator('[data-gear-storage-detail="phase4e-enhance"]').click(); await page.locator('[data-gear-enhance="phase4e-enhance"]').click(); await page.locator('[data-gear-enhance-target="3"]').click();
  await page.locator('[data-gear-enhance-confirm]').dispatchEvent('click'); await page.locator('[data-gear-enhance-confirm]').dispatchEvent('click').catch(() => {}); await expect(page.locator('#gearEnhanceOverlay')).not.toHaveClass(/open/);
  const level = await page.evaluate(() => globalThis.KatamonGearStorage.loadGearState(localStorage).inventory.find((entry) => entry.gear.gearId === 'phase4e-enhance').gear.enhancementLevel); expect(level).toBe(3); expect(errors).toEqual([]);
});
