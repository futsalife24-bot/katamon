const { test, expect } = require('@playwright/test');

async function installListingHarness(page) {
  await page.route('**/index.html?public-room-listing-resilience=1', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = '  async function joinFirebaseRoomFromBrowser(code) {';
    expect(source.includes(marker)).toBeTruthy();
    const hook = `
  globalThis.__publicRoomListingTest = {
    fail() {
      ensureFirebaseAuth = async () => ({ uid: 'listing-test', serverTimeOffset: 0 });
      readOpenRooms = async () => { throw new Error('LISTING_UNAVAILABLE'); };
    },
    empty() {
      ensureFirebaseAuth = async () => ({ uid: 'listing-test', serverTimeOffset: 0 });
      readOpenRooms = async () => [];
    },
    oneRoom() {
      ensureFirebaseAuth = async () => ({ uid: 'listing-test', serverTimeOffset: 0 });
      readOpenRooms = async () => [{
        code: 'ROOM01', createdAt: Date.now() - 1000, format: '1v1',
        hostName: 'テストHOST', roomName: 'だれでも歓迎', playerCount: 1
      }];
    },
    refresh: () => refreshOpenRoomList(),
    state() {
      const codeButton = document.getElementById('onlineCodeToggle');
      return {
        status: onlineLobbyStatusEl?.textContent || '',
        listText: onlineRoomListEl?.textContent || '',
        listError: onlineRoomListEl?.querySelector('.onlineRoomListError')?.textContent || '',
        busy: onlineLobbyBusy,
        createDisabled: !!onlineCreateModeButton?.disabled,
        codeDisabled: !!codeButton?.disabled,
        refreshDisabled: !!onlineRefreshRoomsButton?.disabled,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    }
  };
`;
    await route.fulfill({ response, body: source.replace(marker, `${hook}${marker}`) });
  });
}

test('public listing failure stays distinct from a true empty listing and can retry', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await installListingHarness(page);
  await page.goto('/index.html?public-room-listing-resilience=1');
  await page.waitForFunction(() => !!globalThis.__publicRoomListingTest);

  for (const viewport of [{ width: 412, height: 915 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      globalThis.__publicRoomListingTest.fail();
      await globalThis.__publicRoomListingTest.refresh();
    });
    const failed = await page.evaluate(() => globalThis.__publicRoomListingTest.state());
    expect(failed.listError).toContain('一覧だけ読み込めませんでした');
    expect(failed.listText).toContain('部屋IDで入室できます');
    expect(failed.listText).not.toContain('条件に合う公開部屋はありません');
    expect(failed.status).toContain('一覧通信に失敗');
    expect(failed.busy).toBe(false);
    expect(failed.createDisabled).toBe(false);
    expect(failed.codeDisabled).toBe(false);
    expect(failed.refreshDisabled).toBe(false);
    expect(failed.horizontalOverflow).toBeLessThanOrEqual(0);
  }

  await page.evaluate(async () => {
    globalThis.__publicRoomListingTest.empty();
    await globalThis.__publicRoomListingTest.refresh();
  });
  const empty = await page.evaluate(() => globalThis.__publicRoomListingTest.state());
  expect(empty.listError).toBe('');
  expect(empty.listText).toContain('条件に合う公開部屋はありません');
  expect(empty.status).toContain('0件');

  await page.evaluate(async () => {
    globalThis.__publicRoomListingTest.fail();
    await globalThis.__publicRoomListingTest.refresh();
    globalThis.__publicRoomListingTest.oneRoom();
    await globalThis.__publicRoomListingTest.refresh();
  });
  const recovered = await page.evaluate(() => globalThis.__publicRoomListingTest.state());
  expect(recovered.listError).toBe('');
  expect(recovered.listText).toContain('だれでも歓迎');
  expect(recovered.status).toContain('1件');
  expect(recovered.busy).toBe(false);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
