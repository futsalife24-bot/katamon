const { test, expect } = require('@playwright/test');

// このspecはピクセル密度ではなく実Battle効果の成立を全27件巡回する。
// viewport/touch/browserは各mobile projectを維持し、描画負荷だけ1xへ下げる。
test.use({ serviceWorkers: 'block', deviceScaleFactor: 1 });

const SHOP_EXPECTATIONS = {
  barrier: { key: 'barrierActivated', value: true },
  impact: { key: 'knockbackPx', min: 1 },
  drill: { key: 'craterAdded', min: 1 },
  'rescue-kit': { key: 'rescuedHp', min: 1 },
  'healing-kit': { key: 'healedHp', min: 1 },
  'debuff-grenade': { key: 'weakenedTurns', min: 1 },
  'icon-brass': { key: 'iconVisible', value: true },
  'shell-amber': { key: 'amberProjectile', value: true },
  'impact-cyan': { key: 'cyanImpact', value: true },
};

const LEGACY_SPECIALS = [
  'kyoryu', 'medama', 'iwa', 'tori', 'barugerukan', 'nisenmono',
  'burumutan', 'sumoeru', 'doRednote', 'hamulton', 'mocchario', 'mecha',
  'akuma', 'jinba', 'kishi', 'neko', 'shinigami', 'coolKai',
];

async function waitForEvidence(page, predicate, message) {
  await expect.poll(async () => {
    let state = await page.evaluate(() => ({
      shop: globalThis.KatamonWorkshopBattlePreview?.inspect?.() || null,
      special: globalThis.KatamonSpecialDemo?.inspect?.() || null,
    }));
    await page.evaluate((hasShop) => {
      const api = hasShop ? globalThis.KatamonWorkshopBattlePreview : globalThis.KatamonSpecialDemo;
      api?.advanceForTest?.(0.75);
    }, Boolean(state.shop));
    state = await page.evaluate(() => ({
      shop: globalThis.KatamonWorkshopBattlePreview?.inspect?.() || null,
      special: globalThis.KatamonSpecialDemo?.inspect?.() || null,
    }));
    return predicate(state);
  }, { timeout: 30000, intervals: [100, 250, 500], message }).toBe(true);
}

test('ショップ9商品は実戦効果が対象へ発生し、必殺技は全キャラが命中演出まで進む', async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

  await page.addInitScript((characters) => {
    const audioParam = () => ({
      value: 1,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      linearRampToValueAtTime() {},
    });
    class PreviewAudioContext {
      constructor() { this.destination = {}; this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
      createGain() { return { gain: audioParam(), connect() { return this; } }; }
      createDynamicsCompressor() {
        return {
          threshold: audioParam(), knee: audioParam(), ratio: audioParam(),
          attack: audioParam(), release: audioParam(), connect() { return this; },
        };
      }
      createOscillator() {
        return { frequency: audioParam(), connect() { return this; }, start() {}, stop() {} };
      }
      createBufferSource() {
        return { playbackRate: audioParam(), connect() { return this; }, start() {}, stop() {} };
      }
      createBuffer(_channels, length) {
        const data = new Float32Array(length);
        return { getChannelData() { return data; } };
      }
      createBiquadFilter() {
        return { frequency: audioParam(), Q: audioParam(), connect() { return this; } };
      }
      decodeAudioData() { return Promise.resolve({}); }
    }
    window.AudioContext ||= PreviewAudioContext;
    window.webkitAudioContext ||= PreviewAudioContext;
    localStorage.setItem('katamon_character_unlock_v1', JSON.stringify({
      version: 1,
      totalWins: 0,
      loginDates: [],
      bestStreak: 0,
      achievements: {},
      unlocked: Object.fromEntries(characters.map((key) => [key, true])),
    }));
  }, LEGACY_SPECIALS);

  await page.goto('/index.html?shop-assets-phase5b=1');
  await page.waitForFunction(() => globalThis.KatamonMvpShop?.openShop && globalThis.KatamonWorkshopBattlePreview?.inspect);
  await page.evaluate(() => globalThis.KatamonMvpShop.openShop());

  for (const [itemId, expectation] of Object.entries(SHOP_EXPECTATIONS)) {
    await page.locator(`[data-preview="${itemId}"]`).click();
    await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview.inspect().itemId)).toBe(itemId);
    await waitForEvidence(page, ({ shop }) => {
      const evidence = shop?.evidence;
      // Icon is intentionally a non-projectile preview; its semantic proof is
      // the visible equipped icon rather than a hit event.
      if (itemId !== 'icon-brass' && (!evidence?.launched || !evidence.hit)) return false;
      const value = evidence[expectation.key];
      return expectation.value === true ? value === true : Number(value) >= expectation.min;
    }, `${itemId} must show a launched, targeted effect`).catch(async (error) => {
      const state = await page.evaluate(() => globalThis.KatamonWorkshopBattlePreview.inspect());
      throw new Error(`${error.message}\n${itemId} evidence: ${JSON.stringify(state)}`);
    });
    const evidence = await page.evaluate(() => globalThis.KatamonWorkshopBattlePreview.inspect().evidence);
    if (itemId !== 'icon-brass') {
      expect(evidence.launched, `${itemId} launched`).toBe(true);
      expect(evidence.hit, `${itemId} hit a valid target`).toBe(true);
    }
    if (expectation.value === true) expect(evidence[expectation.key], itemId).toBe(true);
    else expect(evidence[expectation.key], itemId).toBeGreaterThanOrEqual(expectation.min);
    await page.locator('.mvp-dialog-card [data-action="cancel"]').click();
    await expect.poll(() => page.evaluate(() => globalThis.KatamonWorkshopBattlePreview.inspect?.() || null)).toBe(null);
  }

  await page.evaluate(() => globalThis.KatamonMvpShop.close());
  await page.waitForFunction(() => globalThis.KatamonSpecialDemo?.start && globalThis.KatamonSpecialDemo?.inspect);
  const characters = await page.evaluate((legacy) => {
    const api = globalThis.KatamonSpecialDemo;
    const listed = api.characters?.();
    return Array.isArray(listed) && listed.length ? listed.map((entry) => entry.id || entry.key || entry) : legacy;
  }, LEGACY_SPECIALS);
  expect(new Set(characters).size, 'special preview character ids').toBe(characters.length);
  expect(characters.length, 'at least all legacy specials').toBeGreaterThanOrEqual(LEGACY_SPECIALS.length);

  const auditCharacters = process.env.PREVIEW_CHARACTER
    ? characters.filter((key) => key === process.env.PREVIEW_CHARACTER)
    : characters;
  expect(auditCharacters.length, 'selected special preview audit targets').toBeGreaterThan(0);
  for (const key of auditCharacters) {
    await page.evaluate((character) => globalThis.KatamonSpecialDemo.start(character), key);
    await expect.poll(() => page.evaluate(() => globalThis.KatamonSpecialDemo.inspect().key)).toBe(key);
    await waitForEvidence(page, ({ special }) => {
      const evidence = special?.evidence;
      return evidence?.launched === true
        && evidence.hit === true
        && Array.isArray(evidence.specialSignals)
        && evidence.specialSignals.length > 0;
    }, `${key} must produce a targeted special effect`).catch(async (error) => {
      const state = await page.evaluate(() => globalThis.KatamonSpecialDemo.inspect());
      throw new Error(`${error.message}\n${key} evidence: ${JSON.stringify(state)}`);
    });
    const evidence = await page.evaluate(() => globalThis.KatamonSpecialDemo.inspect().evidence);
    expect(evidence.launched, `${key} launched`).toBe(true);
    expect(evidence.hit, `${key} hit the dummy`).toBe(true);
    expect(evidence.specialSignals, `${key} special signal`).toEqual(expect.arrayContaining([expect.any(String)]));
    await page.evaluate(() => globalThis.KatamonSpecialDemo.stop());
    await expect.poll(() => page.evaluate(() => globalThis.KatamonSpecialDemo.inspect?.() || null)).toBe(null);
  }

  expect(errors).toEqual([]);
});
