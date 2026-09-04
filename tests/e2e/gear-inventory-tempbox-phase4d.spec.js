const { test, expect } = require('@playwright/test');

test('Gear Storageで500件Inventory・TEMP BOX・未受取を安全に管理できる', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/index.html?gear-inventory-tempbox-phase4d=1', async (route) => {
    const response = await route.fetch(); const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearStoragePhase4dTest = { openWorkbench: openGearWorkshop, state: () => ({ ...gearStorageUi }) };\n  ${marker}`) });
  });
  await page.goto('/index.html?gear-inventory-tempbox-phase4d=1');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage; const presets = globalThis.KatamonGearPresets; const presetStorage = globalThis.KatamonGearPresetStorage;
    const slots = domain.SLOT_IDS; const rarities = domain.RARITY_IDS; const sets = domain.SET_IDS; const now = Date.now();
    const make = (gearId, index, options = {}) => domain.createGear({ gearId, generationSeed: `phase4d:${gearId}:g`, enhancementSeed: `phase4d:${gearId}:e`, sourceId: options.sourceId || 'cpu_battle', sourceDetail: { e2e: 'phase4d' }, acquiredAt: options.acquiredAt || `2026-08-${String((index % 20) + 1).padStart(2, '0')}T00:00:00Z`, qualityProfile: { id: `phase4d-q-${index}`, starWeights: [{ id: options.star || (index % 6) + 1, weight: 1 }], rarityWeights: [{ id: options.rarityId || rarities[index % rarities.length], weight: 1 }] }, setProfile: { id: `phase4d-s-${index}`, setWeights: [{ id: options.setId || sets[index % sets.length], weight: 1 }] }, slotId: options.slotId || slots[index % slots.length], setId: options.setId || sets[index % sets.length] });
    const state = storage.createDefaultGearStorageState();
    state.inventory = Array.from({ length: storage.MAIN_INVENTORY_CAPACITY }, (_entry, index) => ({ gear: make(index === 0 ? 'phase4d-focus' : index === 1 ? 'phase4d-preset-other' : `phase4d-inv-${index}`, index, index === 0 ? { slotId: 'barrel', rarityId: 'mythic', star: 6, setId: 'assault', acquiredAt: 1900000000000 } : index === 1 ? { slotId: 'armor', acquiredAt: 1899999999000 } : {}), locked: false, favorite: false }));
    state.tempBox = [
      { gear: make('phase4d-temp-urgent', 600, { slotId: 'engine', rarityId: 'legend', star: 5, setId: 'life' }), locked: true, favorite: false, enteredAtMs: now - storage.TEMP_BOX_TTL_MS + (5 * 60 * 60 * 1000) },
      { gear: make('phase4d-temp-safe', 601, { slotId: 'core', rarityId: 'rare', star: 3, setId: 'fortify' }), locked: false, favorite: true, enteredAtMs: now - (24 * 60 * 60 * 1000) },
    ];
    const pendingGear = make('phase4d-pending', 700, { slotId: 'sight', rarityId: 'epic', star: 4, setId: 'critical' });
    state.unclaimedRewards = [{ rewardId: 'phase4d-pending-reward', sourceId: 'cpu_battle', sourceDetail: { e2e: 'phase4d' }, createdAtMs: now, gears: [pendingGear], powder: 0, blueprintShards: 0 }];
    storage.saveGearState(state, localStorage);
    let presetState = presets.createInitialState(['kyoryu']);
    presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: 'phase4d-focus', characterIds: ['kyoryu'] });
    presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset2', slotId: 'armor', gearId: 'phase4d-preset-other', characterIds: ['kyoryu'] });
    presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });

  await page.evaluate(() => globalThis.__gearStoragePhase4dTest.openWorkbench());
  await page.locator('#gearOpenStorage').click();
  await expect(page.locator('#gearStorage')).toHaveClass(/open/);
  await expect(page.locator('#gearStorageSummary')).toContainText('500 / 500');
  await expect(page.locator('#gearStorageSummary')).toContainText('2 / 50');
  await expect(page.locator('#gearStorageSummary')).toContainText('1 / 10');
  await expect(page.locator('#gearStorageRack .gearStorageCard')).toHaveCount(60);
  await expect(page.locator('#gearStorageMore')).toBeVisible();
  await page.locator('[data-gear-storage-slot="barrel"]').click();
  await page.locator('#gearStorageSort').selectOption('recent');
  await expect(page.locator('#gearStorageRack .gearStorageCard').first()).toHaveAttribute('data-gear-storage-card', 'phase4d-focus');
  await page.locator('[data-gear-storage-favorite="phase4d-focus"]').click();
  await page.locator('[data-gear-storage-lock="phase4d-focus"]').click();
  const metadata = await page.evaluate(() => {
    const entry = globalThis.KatamonGearStorage.loadGearState(localStorage).inventory.find((candidate) => candidate.gear.gearId === 'phase4d-focus');
    return { favorite: entry.favorite, locked: entry.locked, gearId: entry.gear.gearId };
  });
  expect(metadata).toEqual({ favorite: true, locked: true, gearId: 'phase4d-focus' });
  await page.locator('#gearStorageFavoriteOnly').click();
  await expect(page.locator('#gearStorageRack .gearStorageCard')).toHaveCount(1);
  await page.locator('[data-gear-storage-detail="phase4d-focus"]').click();
  expect(await page.evaluate(() => globalThis.__gearStoragePhase4dTest.state().selectedGearId)).toBe('phase4d-focus');
  await expect(page.locator('#gearStorageDetail')).toBeVisible();
  await expect(page.locator('#gearStorageDetail')).toContainText('砲身');
  await page.locator('[data-gear-storage-workbench="phase4d-focus"]').click();
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await expect(page.locator('[data-gear-slot="barrel"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-gear-candidate="phase4d-focus"]')).toBeVisible();

  await page.locator('#gearOpenStorage').click();
  await page.locator('[data-gear-storage-slot="all"]').click();
  await page.locator('#gearStorageFavoriteOnly').click();
  await page.locator('[data-gear-storage-tab="tempBox"]').click();
  await expect(page.locator('#gearStorageTempPolicy')).toContainText('保護設定に関係なく、期限を過ぎたGearは自動分解されます');
  await expect(page.locator('[data-gear-storage-card="phase4d-temp-urgent"]')).toContainText('残り5時間');
  await expect(page.locator('[data-gear-storage-card="phase4d-temp-urgent"] .gearStorageExpiry')).toHaveClass(/urgent/);
  await expect(page.locator('[data-gear-storage-card="phase4d-temp-urgent"] [data-gear-storage-lock]')).toHaveCount(0);
  await page.evaluate(() => {
    const storage = globalThis.KatamonGearStorage; const state = storage.loadGearState(localStorage); state.inventory.pop(); storage.saveGearState(state, localStorage);
  });
  await page.locator('#gearStorageMaintenance').click();
  await expect(page.locator('#gearStorageNotice')).toContainText('TEMP BOXから1個をInventoryへ移動');
  expect(await page.evaluate(() => globalThis.KatamonGearStorage.loadGearState(localStorage).inventory.some((entry) => entry.gear.gearId === 'phase4d-temp-urgent'))).toBe(true);

  await expect(page.locator('#gearStoragePending')).toContainText('未受取報酬 1件');
  await page.locator('#gearStoragePending').click();
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'sight');
  await page.locator('#gearDropClose').click();

  const assertLayout = async (width, height) => {
    await page.setViewportSize({ width, height });
    expect(await page.locator('#gearStorageBox').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const boxes = await page.locator('#gearStorageBox button:visible, #gearStorageBox select:visible').evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { label: node.id || node.getAttribute('data-gear-storage-slot') || node.textContent.trim().slice(0, 24), left: rect.left, right: rect.right, width: rect.width }; }));
    expect(boxes.filter((box) => !(box.width > 0 && box.left >= -1 && box.right <= width + 1))).toEqual([]);
  };
  await assertLayout(412, 915); await assertLayout(390, 844); await assertLayout(320, 640);
  await page.screenshot({ path: testInfo.outputPath('gear-inventory-tempbox-phase4d.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('選択中presetだけを装備中とし他presetを区別する', async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-inventory-preset-badges-phase4d=1'); await page.waitForTimeout(400);
  await page.evaluate(() => {
    const domain = globalThis.KatamonGearDomain; const storage = globalThis.KatamonGearStorage; const presets = globalThis.KatamonGearPresets; const presetStorage = globalThis.KatamonGearPresetStorage;
    const make = (gearId, slotId) => domain.createGear({ gearId, generationSeed: `${gearId}:g`, enhancementSeed: `${gearId}:e`, sourceId: 'cpu_battle', sourceDetail: { e2e: 'preset-badge' }, acquiredAt: 1900000000000, qualityProfile: { id: `${gearId}:q`, starWeights: [{ id: 3, weight: 1 }], rarityWeights: [{ id: 'rare', weight: 1 }] }, setProfile: { id: `${gearId}:s`, setWeights: [{ id: 'assault', weight: 1 }] }, slotId, setId: 'assault' });
    const state = storage.createDefaultGearStorageState(); state.inventory = [{ gear: make('preset-current', 'barrel'), locked: false, favorite: false }, { gear: make('preset-other', 'armor'), locked: false, favorite: false }]; storage.saveGearState(state, localStorage);
    let presetState = presets.createInitialState(['kyoryu']); presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: 'preset-current', characterIds: ['kyoryu'] }); presetState = presets.setPresetSlot(presetState, { characterId: 'kyoryu', presetId: 'preset2', slotId: 'armor', gearId: 'preset-other', characterIds: ['kyoryu'] }); presetStorage.save(presetState, localStorage, { characterIds: ['kyoryu'] });
  });
  await page.evaluate(() => globalThis.KatamonGearStorageUi.open());
  await expect(page.locator('[data-gear-storage-card="preset-current"]')).toContainText('装備中'); await expect(page.locator('[data-gear-storage-card="preset-other"]')).toContainText('プリセット登録'); await expect(page.locator('[data-gear-storage-card="preset-other"]')).not.toContainText('装備中');
  await page.locator('#gearStorageOpenWorkshop').click(); await page.locator('#gearPresetSelect').selectOption('preset2'); await page.locator('#gearOpenStorage').click();
  await expect(page.locator('[data-gear-storage-card="preset-other"]')).toContainText('装備中'); await expect(page.locator('[data-gear-storage-card="preset-current"]')).toContainText('プリセット登録'); await expect(page.locator('[data-gear-storage-card="preset-current"]')).not.toContainText('装備中');
  expect(errors).toEqual([]);
});
