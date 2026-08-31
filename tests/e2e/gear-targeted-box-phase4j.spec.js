const { test, expect } = require('@playwright/test');

test('設計片の指定BOXをexactly once製作しDrop Revealから受け取れる', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?gear-targeted-box-phase4j=1');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const storage = globalThis.KatamonGearStorage;
    const state = storage.createDefaultGearStorageState();
    state.resources.blueprintShards = 300;
    storage.saveGearState(state, localStorage);
    const foundation = globalThis.KatamonCoopMvp;
    const foundationState = foundation.createDefaultState();
    foundationState.boss.unlockedDifficulties.push('hard');
    foundation.saveState(foundationState, localStorage);
  });
  await page.evaluate(() => globalThis.KatamonGearStorageUi.open());
  await page.locator('#gearStorageTargetedBox').click();
  await expect(page.locator('#gearTargetedBoxOverlay')).toHaveClass(/open/);
  await expect(page.locator('#gearTargetedBoxBalance')).toContainText('300');
  await page.locator('[data-gear-targeted-kind="slot_set"]').click();
  await page.locator('#gearTargetedSlot').selectOption('core');
  await page.locator('#gearTargetedSet').selectOption('rescue');
  await expect(page.locator('#gearTargetedBoxQuote')).toContainText('協力 HARD 到達相当');
  await expect(page.locator('#gearTargetedBoxConfirm')).toContainText('設計片300で製作');

  await page.locator('#gearTargetedBoxConfirm').evaluate((button) => { button.click(); button.click(); });
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/);
  await expect(page.locator('#gearDropProgress')).toContainText('TARGETED BOX');
  await expect(page.locator('.gearDropSlot.active')).toHaveAttribute('data-gear-drop-slot', 'core');
  await expect(page.locator('.gearDropCard')).toContainText('救援');
  const pending = await page.evaluate(() => {
    const state = globalThis.KatamonGearStorage.loadGearState(localStorage);
    return { shards: state.resources.blueprintShards, pending: state.unclaimedRewards.length, inventory: state.inventory.length };
  });
  expect(pending).toEqual({ shards: 0, pending: 1, inventory: 0 });

  await page.locator('#gearDropClaim').click();
  await expect(page.locator('#gearDropTitle')).toHaveText('GEAR GET!');
  const claimed = await page.evaluate(() => {
    const state = globalThis.KatamonGearStorage.loadGearState(localStorage);
    const gear = state.inventory[0]?.gear;
    return { shards: state.resources.blueprintShards, pending: state.unclaimedRewards.length, ledger: Object.keys(state.rewardLedger).length, inventory: state.inventory.length, slotId: gear?.slotId, setId: gear?.setId };
  });
  expect(claimed).toEqual({ shards: 0, pending: 0, ledger: 1, inventory: 1, slotId: 'core', setId: 'rescue' });

  await page.locator('#gearDropClose').click();
  await page.locator('#gearStorageTargetedBox').click();
  for (const [width, height] of [[412, 915], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.locator('#gearTargetedBoxOverlay .gearActionPanel').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { overflow: node.scrollWidth > node.clientWidth, left: rect.left, right: rect.right, viewport: innerWidth };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.left).toBeGreaterThanOrEqual(-1);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
  }
  await page.screenshot({ path: testInfo.outputPath('gear-targeted-box-phase4j.png'), fullPage: true });
  expect(errors).toEqual([]);
});
