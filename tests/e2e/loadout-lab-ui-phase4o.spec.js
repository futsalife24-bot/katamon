const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

for (const viewport of [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`LOADOUTからCATAMON LABの装備管理を完了できる ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.route('**/index.html?loadout-lab-phase4o=1', async (route) => {
      const response = await route.fetch();
      const source = (await response.text()).replace(/\r\n/g, '\n');
      const marker = '\n})();\n</script>';
      const position = source.lastIndexOf(marker);
      expect(position).toBeGreaterThan(0);
      await route.fulfill({ response, body: `${source.slice(0, position)}\n  window.__loadoutLabTest = { open: openGearWorkshop, closeName: () => closeNameDialog(false), title: TITLE_MENU_PAGES[TITLE_MENU_GARAGE].items.find((item) => item.id === 'gear') };${source.slice(position)}` });
    });
    await page.goto('/index.html?loadout-lab-phase4o=1');
    await expect(page.locator('#game')).toBeVisible();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const foundation = globalThis.KatamonCoopMvp;
      const state = foundation.createDefaultState();
      for (const id of ['barrier', 'impact', 'rescue-kit', 'icon-brass', 'shell-amber']) state.inventory[id] = true;
      state.equipment.subweapon = 'barrier';
      state.equipment.coopItem = 'rescue-kit';
      state.equipment.cosmetic = 'icon-brass';
      state.equipment.cosmetics.icon = 'icon-brass';
      foundation.saveState(state, localStorage);
    });

    expect(await page.evaluate(() => globalThis.__loadoutLabTest.title)).toMatchObject({ label: 'LOADOUT', sub: '装備・装飾を管理', kind: 'loadout' });
    await page.evaluate(() => globalThis.__loadoutLabTest.open());
    await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
    await expect(page.locator('#gearWorkshopTitle')).toHaveText('CATAMON LAB');
    await expect(page.locator('[data-loadout-page]')).toHaveCount(4);
    if (viewport.width === 412) await page.screenshot({ path: testInfo.outputPath('loadout-lab-gear-412.png'), fullPage: true });

    const imageStatus = await page.evaluate(async () => Promise.all([
      'assets/gear/ui/runtime/gear_title_menu_frame_01.webp',
      'assets/gear/ui/runtime/gear_workbench_lab_background_01.webp',
      'assets/gear/ui/runtime/gear_lab_control_frame_01.png',
    ].map((src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve([src, image.naturalWidth, image.naturalHeight]); image.onerror = () => resolve([src, 0, 0]); image.src = src; }))));
    expect(imageStatus.every(([, width, height]) => width > 0 && height > 0)).toBe(true);

    await page.locator('[data-loadout-page="weapon"]').click();
    await expect(page.locator('#loadoutWeaponPanel')).toBeVisible();
    await expect(page.locator('#loadoutWeaponPanel')).toContainText('バリア');
    await expect(page.locator('#loadoutWeaponPanel')).toContainText('衝撃弾');
    await expect(page.locator('#loadoutWeaponPanel .loadoutItemIcon img')).toHaveCount(3);
    await expect.poll(() => page.locator('#loadoutWeaponPanel .loadoutItemIcon img').evaluateAll(
      (images) => images.map((image) => [image.naturalWidth, image.naturalHeight])
    )).toEqual(Array(3).fill([256, 256]));
    await page.locator('[data-loadout-equip="impact"]').click();
    await expect(page.locator('[data-loadout-item="impact"]')).toContainText('装備中');
    expect(await page.evaluate(() => globalThis.KatamonCoopMvp.loadState().equipment.subweapon)).toBe('impact');

    await page.locator('[data-loadout-page="style"]').click();
    await expect(page.locator('#loadoutStylePanel')).toBeVisible();
    await expect(page.locator('#loadoutStylePanel')).toContainText('真鍮アイコン');
    await expect(page.locator('#loadoutStylePanel')).toContainText('琥珀砲弾');
    await expect(page.locator('#loadoutStylePanel .loadoutItemIcon img')).toHaveCount(2);
    await page.locator('[data-loadout-equip="shell-amber"]').click();
    await expect.poll(
      () => page.evaluate(() => globalThis.KatamonCoopMvp.loadState().equipment.cosmetics.projectile)
    ).toBe('shell-amber');

    await page.locator('[data-loadout-page="profile"]').click();
    await expect(page.locator('#loadoutProfilePanel')).toBeVisible();
    await expect(page.locator('[data-loadout-name]')).toBeVisible();
    await page.locator('[data-loadout-name]').click();
    await expect(page.locator('#nameOverlay')).toHaveClass(/open/);
    await page.evaluate(() => globalThis.__loadoutLabTest.closeName());

    const layout = await page.locator('#gearWorkshopBox').evaluate((box) => ({
      boxOverflow: box.scrollWidth - box.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      backgroundImage: getComputedStyle(box).backgroundImage,
      controlFrame: getComputedStyle(document.getElementById('gearWorkshopClose')).borderImageSource,
      titleVisible: (() => {
        const title = document.getElementById('gearWorkshopTitle');
        const header = title.closest('.gearHeader');
        const titleRect = title.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const style = getComputedStyle(title);
        return title.textContent.trim() === 'CATAMON LAB'
          && style.textOverflow !== 'ellipsis'
          && style.webkitLineClamp === 'none'
          && titleRect.left >= headerRect.left - 1
          && titleRect.right <= headerRect.right + 1
          && titleRect.top >= headerRect.top - 1
          && titleRect.bottom <= headerRect.bottom + 1;
      })(),
      badControls: [...box.querySelectorAll('button,select')].filter((control) => {
        const rect = control.getBoundingClientRect(); const style = getComputedStyle(control);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      }).map((control) => control.textContent.trim()),
    }));
    expect(layout.boxOverflow).toBeLessThanOrEqual(0);
    expect(layout.documentOverflow).toBeLessThanOrEqual(0);
    expect(layout.backgroundImage).toContain('rgba(22, 34, 37, 0.62)');
    expect(layout.backgroundImage).toContain('gear_workbench_lab_background_01.webp');
    expect(layout.controlFrame).toContain('gear_lab_control_frame_01.png');
    expect(layout.titleVisible).toBe(true);
    expect(layout.badControls).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`loadout-lab-${viewport.width}.png`), fullPage: true });
  });
}
