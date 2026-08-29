const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html?f3=1';
const MAIN_SCRIPT_END = '\n})();\n</script>\n<script src="coop-mvp-boss.js"';

async function installF3Bridge(context) {
  await context.addInitScript(() => {
    globalThis.__f3InvalidColorStops = [];
    const nativeAddColorStop = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function addColorStopWithTrace(offset, color) {
      if (typeof color !== 'string' || !color.trim()) {
        globalThis.__f3InvalidColorStops.push({
          offset,
          colorType: typeof color,
          stack: new Error('invalid CanvasGradient color').stack,
        });
      }
      return nativeAddColorStop.call(this, offset, color);
    };
  });
  await context.route('**/index.html?f3=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    expect(source).toContain(MAIN_SCRIPT_END);
    const bridge = `
  globalThis.KatamonF3GuestStartBridge = Object.freeze({
    createHostStartSnapshot() {
      setMatchFormat('1v1');
      for (const unit of units) unit.character = 'kyoryu';
      gamePhase = 'battle';
      resetMatch(false);
      applyStageAppearance('volcanic', null);
      return structuredClone(buildSnapshot());
    },
    applyGuestStartSnapshot(snap) {
      online = { kind: 'firebase', role: 'guest', seat: 'e1', settings: { format: '1v1' } };
      applyVerifiedFirebaseStartSnapshot(structuredClone(snap), null);
      setOnlineSeat('e1');
      // The fixture has no transport clock.  The production start/apply/seat
      // boundary above is complete; detach only the incomplete test shell so
      // the native first render is not followed by unrelated liveness work.
      online = null;
      battleMode = 'normal';
      gamePhase = 'battle';
      return this.state();
    },
    state() {
      return structuredClone({
        gamePhase,
        battleMode,
        currentThemeKey,
        currentTheme,
        currentCustomAppearance,
        currentPattern,
        turnOrder,
        activeIndex,
        turnCount,
      });
    },
  });
`;
    await route.fulfill({
      response,
      body: source.replace(MAIN_SCRIPT_END, `${bridge}${MAIN_SCRIPT_END}`),
      headers: { ...response.headers(), 'content-type': 'text/html; charset=utf-8' },
    });
  });
}

test.describe('Phase 3D-8D-F3 guest Battle start render', () => {
  test('verified Firebase start keeps official appearance canonical before native Canvas render', async ({ browser }) => {
    test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium native CanvasGradient is the production failure authority.');

    const hostContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const hostErrors = [];
    const guestErrors = [];
    try {
      await installF3Bridge(hostContext);
      await installF3Bridge(guestContext);
      const host = await hostContext.newPage();
      const guest = await guestContext.newPage();
      host.on('pageerror', error => hostErrors.push(error.stack || error.message));
      guest.on('pageerror', error => guestErrors.push(error.stack || error.message));

      await Promise.all([host.goto(GAME_URL), guest.goto(GAME_URL)]);
      await expect.poll(() => host.evaluate(() => typeof globalThis.KatamonF3GuestStartBridge)).toBe('object');
      await expect.poll(() => guest.evaluate(() => typeof globalThis.KatamonF3GuestStartBridge)).toBe('object');

      const start = await host.evaluate(() => globalThis.KatamonF3GuestStartBridge.createHostStartSnapshot());
      const hostState = await host.evaluate(() => globalThis.KatamonF3GuestStartBridge.state());
      const guestResult = await guest.evaluate((snapshot) => {
        try {
          return { state: globalThis.KatamonF3GuestStartBridge.applyGuestStartSnapshot(snapshot), error: null };
        } catch (error) {
          return { state: null, error: { name: error?.name, message: error?.message, stack: error?.stack } };
        }
      }, start);
      const invalidStops = await guest.evaluate(() => globalThis.__f3InvalidColorStops.slice());

      expect(guestResult.error, JSON.stringify({ error: guestResult.error, invalidStops }, null, 2)).toBeNull();
      expect(invalidStops).toEqual([]);
      expect(guestResult.state).toMatchObject({
        gamePhase: 'battle',
        battleMode: 'normal',
        currentThemeKey: hostState.currentThemeKey,
        currentTheme: hostState.currentTheme,
        currentCustomAppearance: hostState.currentCustomAppearance,
        currentPattern: hostState.currentPattern,
        turnOrder: hostState.turnOrder,
        activeIndex: hostState.activeIndex,
        turnCount: hostState.turnCount,
      });
      expect(hostErrors).toEqual([]);
      expect(guestErrors).toEqual([]);
    } finally {
      await Promise.allSettled([hostContext.close(), guestContext.close()]);
    }
  });
});
