const { test, expect } = require('@playwright/test');

test('サウンドテスト音量はWebAudio fallbackでもゲーム設定へ追従する', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    class TestAudioContext {
      constructor() { this.destination = {}; this.state = 'running'; }
      createGain() { return { gain: { value: 1 }, connect() { return this; } }; }
      createMediaElementSource() { return { connect() { return this; } }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
    }
    window.AudioContext = TestAudioContext;
    window.webkitAudioContext = TestAudioContext;
  });
  await page.route('**/index.html?gameplay-ux-priority=1', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '\n})();\n</script>';
    const position = source.lastIndexOf(marker);
    expect(position).toBeGreaterThan(0);
    const hook = `
  window.__gameplayUxPriorityTest = {
    forceMediaVolumeFallback() { mediaVolumeSupported = false; },
    playSoundTestTrack,
    setBgmVolume(value) { bgmVolume = value; applyAudioVolumes(); },
    soundTestState() {
      const track = SOUND_TEST_TRACKS[soundTestCurrent];
      return {
        elementVolume: soundTestAudio?.volume ?? null,
        gain: soundTestGain?.gain?.value ?? null,
        baseVolume: track?.volume ?? null,
      };
    },
  };
  const soundTestTrigger = document.createElement('button');
  soundTestTrigger.id = 'gameplayUxSoundTestTrigger';
  soundTestTrigger.textContent = 'test sound';
  soundTestTrigger.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
  soundTestTrigger.addEventListener('click', () => playSoundTestTrack(1));
  document.body.appendChild(soundTestTrigger);
`;
    await route.fulfill({ response, body: `${source.slice(0, position)}${hook}${source.slice(position)}` });
  });
  await page.goto('/index.html?gameplay-ux-priority=1');
  await page.evaluate(() => window.__gameplayUxPriorityTest.forceMediaVolumeFallback());
  await page.locator('#gameplayUxSoundTestTrigger').click();
  const full = await page.evaluate(() => window.__gameplayUxPriorityTest.soundTestState());
  expect(full.elementVolume, JSON.stringify(full)).toBe(1);
  expect(full.gain).toBeCloseTo(full.baseVolume, 5);

  await page.evaluate(() => window.__gameplayUxPriorityTest.setBgmVolume(0.5));
  const half = await page.evaluate(() => window.__gameplayUxPriorityTest.soundTestState());
  expect(half.elementVolume).toBe(1);
  expect(half.gain).toBeGreaterThan(0);
  expect(half.gain).toBeLessThan(full.gain / 2);

  await page.evaluate(() => window.__gameplayUxPriorityTest.setBgmVolume(0));
  const muted = await page.evaluate(() => window.__gameplayUxPriorityTest.soundTestState());
  expect(muted.gain).toBe(0);
  expect(errors).toEqual([]);
});
