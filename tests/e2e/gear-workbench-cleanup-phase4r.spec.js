const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
];

async function installHarness(page) {
  await page.route('**/index.html?gear-workbench-cleanup-phase4r=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = 'globalThis.KatamonGearStorageUi = Object.freeze({ open: openGearStorage';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `window.__gearPhase4RTest = {\n    openWorkbench: openGearWorkshop,\n    chooseCharacter: selectGearWorkbenchCharacter,\n    selectionMode: () => selectGearWorkbenchMode\n  };\n  ${marker}`) });
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const picker = document.querySelector('.gearCharacterPicker')?.getBoundingClientRect();
    const topLeft = document.querySelector('[data-frame-position="left-top"]')?.getBoundingClientRect();
    const topRight = document.querySelector('[data-frame-position="right-top"]')?.getBoundingClientRect();
    const stats = [...document.querySelectorAll('.gearStat')].map((node) => {
      const label = node.querySelector('small')?.getBoundingClientRect();
      const value = node.querySelector('b')?.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return { height: rect.height, labelTop: label?.top, labelBottom: label?.bottom, valueTop: value?.top, valueBottom: value?.bottom };
    });
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      workshopOverflow: document.querySelector('#gearWorkshopBox').scrollWidth - document.querySelector('#gearWorkshopBox').clientWidth,
      pickerBetweenTopSlots: Boolean(picker && topLeft && topRight && picker.left >= topLeft.right - 1 && picker.right <= topRight.left + 1),
      stats,
    };
  });
}

test('Workbench整理・キャラ選択・Storage共通意匠を4幅で維持する', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await installHarness(page);
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/index.html?gear-workbench-cleanup-phase4r=1');
  await page.waitForTimeout(400);
  await page.evaluate(() => globalThis.__gearPhase4RTest.openWorkbench());
  console.log('phase4r: workbench opened');

  await expect(page.locator('#gearCharacterPrev, #gearCharacterNext, .gearCharacterBar')).toHaveCount(0);
  await expect(page.locator('.gearCharacterPicker')).toHaveText('ディラノ');
  await expect(page.locator('.gearStat')).toHaveCount(9);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const report = await measure(page);
    expect(report.documentOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(0);
    expect(report.workshopOverflow, `${viewport.width}px workshop overflow`).toBeLessThanOrEqual(0);
    expect(report.pickerBetweenTopSlots, `${viewport.width}px character picker position`).toBe(true);
    for (const [index, stat] of report.stats.entries()) {
      expect(stat.height, `${viewport.width}px stat ${index} height`).toBeLessThanOrEqual(38);
      expect(Math.min(stat.labelBottom, stat.valueBottom) - Math.max(stat.labelTop, stat.valueTop), `${viewport.width}px stat ${index} one line overlap`).toBeGreaterThan(0);
    }
  }
  console.log('phase4r: responsive metrics passed');

  await page.setViewportSize(VIEWPORTS[0]);
  await page.locator('#gearWorkshopBox').screenshot({ path: testInfo.outputPath('phase4r-workbench-412.png') });
  await page.locator('.gearCharacterPicker').click();
  console.log('phase4r: picker clicked');
  await expect.poll(() => page.evaluate(() => globalThis.__gearPhase4RTest.selectionMode())).toBe(true);
  await expect(page.locator('#gearWorkshop')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#game').screenshot({ path: testInfo.outputPath('phase4r-character-select-412.png') });
  console.log('phase4r: select screenshot saved');
  await page.evaluate(() => globalThis.__gearPhase4RTest.chooseCharacter('medama'));
  await expect(page.locator('#gearWorkshop')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.gearCharacterPicker')).toHaveText('アイボルト');
  console.log('phase4r: character changed');

  await page.locator('#gearOpenStorage').click();
  await expect(page.locator('#gearStorage')).toHaveAttribute('aria-hidden', 'false');
  console.log('phase4r: storage opened');
  const storageStyle = await page.locator('#gearStorage .gearStorageTab').first().evaluate((button) => ({
    borderImage: getComputedStyle(button).borderImageSource,
    minHeight: button.getBoundingClientRect().height,
  }));
  expect(storageStyle.borderImage).toContain('gear_lab_control_frame_01.png');
  expect(storageStyle.minHeight).toBeGreaterThanOrEqual(40);
  const storageSelectStyle = await page.locator('#gearStorage .gearSelect').first().evaluate((select) => ({
    appearance: getComputedStyle(select).appearance,
    color: getComputedStyle(select).color,
    background: getComputedStyle(select).backgroundImage,
  }));
  expect(storageSelectStyle.appearance).toBe('none');
  expect(storageSelectStyle.color).toBe('rgb(255, 240, 201)');
  expect(storageSelectStyle.background).toContain('linear-gradient');
  await page.locator('#gearStorageBox').screenshot({ path: testInfo.outputPath('phase4r-storage-412.png') });
  console.log('phase4r: storage screenshot saved');
  expect(errors).toEqual([]);
});
