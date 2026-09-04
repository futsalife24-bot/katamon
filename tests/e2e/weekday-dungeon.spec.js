const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html?weekday-dungeon-e2e=battle-release-gate';
const VIRTUAL_WIDTH = 540;
const VIRTUAL_HEIGHT = 960;
const FIRE_ORIGIN = Object.freeze({ x: 270, y: 810 });

async function gamePhase(page) {
  return page.evaluate(() => globalThis.KatamonCustomStageBridge?.getState?.().gamePhase || null);
}

async function waitForProductionModules(page) {
  await expect.poll(() => page.evaluate(() => Boolean(
    globalThis.KatamonGearWeekdayDungeon
      && globalThis.KatamonGearWeekdayDungeonStorage
      && globalThis.KatamonGearDomain
      && globalThis.KatamonGearStorage
      && globalThis.KatamonGearRewards,
  )), { timeout: 20_000 }).toBe(true);
}

async function tapVirtualCanvas(page, x, y) {
  const canvas = page.getByTestId('battle-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'the shared Battle canvas must be visible').not.toBeNull();
  await page.touchscreen.tap(box.x + box.width * x / VIRTUAL_WIDTH, box.y + box.height * y / VIRTUAL_HEIGHT);
}

async function dragVirtualCanvas(page, from, to) {
  const canvas = page.getByTestId('battle-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'the shared Battle canvas must have a box').not.toBeNull();
  const point = (value) => ({ x: box.x + box.width * value.x / VIRTUAL_WIDTH, y: box.y + box.height * value.y / VIRTUAL_HEIGHT });
  const start = point(from);
  const end = point(to);
  // Mouse emits real PointerEvents against #game in Chromium and WebKit. This
  // deliberately does not call a production test hook or a weekday-only UI.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function openTitle(page, { navigate = true } = {}) {
  if (navigate) await page.goto(GAME_URL);
  await waitForProductionModules(page);
  // WebKit throttles the TAP TO START rAF while a newly-created second page
  // is still treated as background. Focus the page whose real canvas we are
  // about to operate before starting that production animation.
  await page.bringToFront();
  await expect.poll(() => gamePhase(page), { timeout: 20_000 }).toBe('press');
  await tapVirtualCanvas(page, VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2);
  await expect.poll(() => gamePhase(page), { timeout: 20_000 }).toBe('title');
}

async function openDungeon(page, { navigate = true, expectRecovery = false } = {}) {
  await openTitle(page, { navigate });
  await tapVirtualCanvas(page, 508, 690); // BATTLE -> GARAGE
  // The title card's documented 320ms transition must finish before LOADOUT
  // becomes its target. This is the only animation-bound wait in this spec.
  await page.waitForTimeout(380);
  await tapVirtualCanvas(page, 270, 727); // LOADOUT
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/, { timeout: 10_000 });
  await page.locator('#gearWeekdayDungeonEntry').click();
  await expect(page.locator('#gearWorkshop')).not.toHaveClass(/open/);
  if (!expectRecovery) await expect(page.locator('#weekdayDungeonBattleStatus')).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByTestId('battle-canvas')).toBeVisible();
}

async function findShot(page, wantedHit) {
  return page.evaluate(({ hit, fireOrigin }) => {
    const domain = globalThis.KatamonGearWeekdayDungeon;
    const dayInfo = domain.getDayInfo({ nowMs: Date.now() });
    // Keep both endpoints inside a 540x960 canvas when dragging from FIRE.
    for (let dragY = -115; dragY <= 110; dragY += 2) {
      for (let dragX = -120; dragX <= 120; dragX += 2) {
        if (Math.hypot(dragX, dragY) < domain.SHOT_LIMITS.minDrag || Math.hypot(dragX, dragY) > domain.SHOT_LIMITS.maxDrag) continue;
        if (fireOrigin.x + dragX < 4 || fireOrigin.x + dragX > 536 || fireOrigin.y + dragY < 4 || fireOrigin.y + dragY > 956) continue;
        const attempt = domain.createAttempt({ dayInfo, shot: { dragX, dragY } });
        const resolved = domain.resolveAttempt(attempt);
        if (resolved.hit !== hit) continue;
        // A browser may round a CSS pointer coordinate back to the 540x960
        // Battle space by one pixel. Release-gate shots must remain in the same
        // cloud (or safely outside every cloud) across that real-device jitter.
        let stable = true;
        for (let offsetY = -2; offsetY <= 2 && stable; offsetY += 1) {
          for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
            const neighborX = dragX + offsetX;
            const neighborY = dragY + offsetY;
            const magnitude = Math.hypot(neighborX, neighborY);
            if (magnitude < domain.SHOT_LIMITS.minDrag || magnitude > domain.SHOT_LIMITS.maxDrag) { stable = false; break; }
            const neighbor = domain.resolveAttempt(domain.createAttempt({ dayInfo, shot: { dragX: neighborX, dragY: neighborY } }));
            if (neighbor.hit !== resolved.hit || neighbor.slotId !== resolved.slotId) { stable = false; break; }
          }
        }
        if (stable) return { dragX, dragY, attempt };
      }
    }
    return null;
  }, { hit: wantedHit, fireOrigin: FIRE_ORIGIN });
}

async function fireShot(page, wantedHit, { expectLaunch = true } = {}) {
  const shot = await findShot(page, wantedHit);
  expect(shot, `a canonical ${wantedHit ? 'hit' : 'miss'} shot must exist`).not.toBeNull();
  await dragVirtualCanvas(page, FIRE_ORIGIN, { x: FIRE_ORIGIN.x + shot.dragX, y: FIRE_ORIGIN.y + shot.dragY });
  if (expectLaunch) {
    await expect(page.locator('#weekdayDungeonBattleStatus')).toHaveAttribute('data-phase', /committing|flying|revealing|persisting|complete|error/);
  }
  return shot;
}

async function waitForDrop(page) {
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 25_000 });
}

async function readDurableState(page) {
  return page.evaluate(() => {
    const dungeonStorage = globalThis.KatamonGearWeekdayDungeonStorage;
    const gearStorage = globalThis.KatamonGearStorage;
    const state = gearStorage.loadGearState(localStorage);
    return {
      dungeon: dungeonStorage.loadWeekdayDungeonState(localStorage),
      inventory: state.inventory.length,
      tempBox: state.tempBox.length,
      powder: state.resources.powder,
      pending: state.unclaimedRewards.map((reward) => ({ rewardId: reward.rewardId, sourceId: reward.sourceId, gears: reward.gears.map((gear) => gear.gearId), powder: reward.powder })),
      ledger: Object.keys(state.rewardLedger).sort(),
      wal: localStorage.getItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY),
    };
  });
}

async function clearWeekdayAndGearStorage(page) {
  await page.evaluate(() => {
    const dungeonStorage = globalThis.KatamonGearWeekdayDungeonStorage;
    const gearStorage = globalThis.KatamonGearStorage;
    localStorage.removeItem(dungeonStorage.WEEKDAY_DUNGEON_STORAGE_KEY);
    localStorage.removeItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY);
    gearStorage.saveGearState(gearStorage.createDefaultGearStorageState(), localStorage);
  });
}

function installStrictPageErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
}

function expectNoPageErrors(errors) {
  expect(errors).toEqual([]);
}

test.describe('weekday dungeon shared-Battle release gate', () => {
  test('Garage entry launches shared Battle, real drag FIRE hits a cloud and claim grants exactly one Gear', async ({ page }, testInfo) => {
    const errors = [];
    installStrictPageErrors(page, errors);
    await openDungeon(page);
    await expect(page.locator('#weekdayDungeonBattleStatus')).toContainText('6つの雲');
    await testInfo.attach('weekday-battle-ready', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    const shot = await fireShot(page, true);
    await waitForDrop(page);
    const queued = await readDurableState(page);
    expect(queued.dungeon.activeAttempt).toMatchObject({ schemaVersion: 2, phase: 'queued', slotId: shot.attempt.slotId });
    expect(Math.abs(queued.dungeon.activeAttempt.shot.dragX - shot.dragX)).toBeLessThanOrEqual(2);
    expect(Math.abs(queued.dungeon.activeAttempt.shot.dragY - shot.dragY)).toBeLessThanOrEqual(2);
    expect(queued.pending).toHaveLength(1);
    expect(queued.pending[0]).toMatchObject({ rewardId: queued.dungeon.activeAttempt.rewardId, sourceId: 'weekday_dungeon', powder: 0 });
    expect(queued.pending[0].gears).toEqual([`weekday-dungeon:${queued.dungeon.activeAttempt.dayKey}:${queued.dungeon.activeAttempt.slotId}:gear:0`]);
    await testInfo.attach('weekday-battle-hit', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.locator('#gearDropClaim').click();
    await expect(page.locator('#gearDropClaim')).toBeHidden();
    const claimed = await readDurableState(page);
    expect(claimed.inventory + claimed.tempBox).toBe(1);
    expect(claimed.pending).toEqual([]);
    expect(claimed.ledger).toEqual([queued.dungeon.activeAttempt.rewardId]);
    expectNoPageErrors(errors);
  });

  test('a real shared-Battle miss queues powder +3 and does not add it until claim', async ({ page }) => {
    await openDungeon(page);
    const shot = await fireShot(page, false);
    await waitForDrop(page);
    await expect(page.locator('#gearDropKicker')).toHaveText('MATERIAL REWARD');
    await expect(page.locator('.gearDropMaterialValues')).toContainText('粉末 +3');
    const queued = await readDurableState(page);
    expect(queued.dungeon.activeAttempt).toMatchObject({ schemaVersion: 2, phase: 'queued', slotId: null });
    expect(Math.abs(queued.dungeon.activeAttempt.shot.dragX - shot.dragX)).toBeLessThanOrEqual(2);
    expect(Math.abs(queued.dungeon.activeAttempt.shot.dragY - shot.dragY)).toBeLessThanOrEqual(2);
    expect(queued.pending).toEqual([{ rewardId: queued.dungeon.activeAttempt.rewardId, sourceId: 'weekday_dungeon', gears: [], powder: 3 }]);
    expect(queued.powder).toBe(0);
    await page.locator('#gearDropClaim').click();
    expect((await readDurableState(page)).powder).toBe(3);
  });

  test('v1 fired state reloads into reward-only recovery without a second projectile', async ({ page }) => {
    await page.goto(GAME_URL);
    await waitForProductionModules(page);
    const seeded = await page.evaluate(async () => {
      const domain = globalThis.KatamonGearWeekdayDungeon;
      const storage = globalThis.KatamonGearWeekdayDungeonStorage;
      const day = domain.getDayInfo({ nowMs: Date.now() });
      const slotId = day.fixedSlotId || domain.WEEKDAY_SLOT_IDS[0];
      let attempt = null;
      for (let angle = domain.AIM_LIMITS.angleMin; angle <= domain.AIM_LIMITS.angleMax && !attempt; angle += 1) for (let power = domain.AIM_LIMITS.powerMin; power <= domain.AIM_LIMITS.powerMax; power += 1) {
        const candidate = { schemaVersion: 1, rulesVersion: 1, attemptId: `weekday-dungeon:${day.dayKey}:${slotId}:attempt`, rewardId: `weekday-dungeon:${day.dayKey}:${slotId}:reward`, dayKey: day.dayKey, dayIndex: day.dayIndex, slotId, phase: 'fired', angle, power, createdAtMs: day.jstStartMs };
        if (domain.legacyResolveAttempt(candidate).hit) attempt = candidate;
      }
      if (!attempt) throw new Error('no v1 hit attempt');
      const committed = await storage.commitAttempt(attempt, localStorage, { nowMs: Date.now() });
      return committed.attempt;
    });
    await page.reload();
    await openDungeon(page, { navigate: false, expectRecovery: true });
    await waitForDrop(page);
    const recovered = await readDurableState(page);
    expect(recovered.dungeon.activeAttempt).toEqual({ ...seeded, phase: 'queued' });
    expect(recovered.pending).toHaveLength(1);
  });

  test('two tabs firing through shared Battle create one day-only entitlement', async ({ page, context }) => {
    const second = await context.newPage();
    await openDungeon(page);
    await openDungeon(second);
    const first = await findShot(page, true);
    const secondShot = await findShot(second, true);
    expect(secondShot).not.toBeNull();
    await Promise.all([
      dragVirtualCanvas(page, FIRE_ORIGIN, { x: FIRE_ORIGIN.x + first.dragX, y: FIRE_ORIGIN.y + first.dragY }),
      dragVirtualCanvas(second, FIRE_ORIGIN, { x: FIRE_ORIGIN.x + secondShot.dragX, y: FIRE_ORIGIN.y + secondShot.dragY }),
    ]);
    await expect.poll(async () => (await readDurableState(page)).dungeon.activeAttempt?.phase, { timeout: 25_000 }).toBe('queued');
    const state = await readDurableState(page);
    expect(state.pending).toHaveLength(1);
    expect(new Set(state.pending[0].gears).size).toBe(1);
    await second.close();
  });

  test('queue capacity and rejected Web Lock fail before the shared Battle shot is consumed', async ({ page }) => {
    await openDungeon(page);
    await page.evaluate(() => {
      const storage = globalThis.KatamonGearStorage;
      const rewards = globalThis.KatamonGearRewards;
      let state = storage.createDefaultGearStorageState();
      for (let index = 0; index < storage.UNCLAIMED_REWARD_CAPACITY; index += 1) state = rewards.queueUnclaimedReward(state, { rewardId: `weekday-cap-${index}`, sourceId: 'cpu_battle', sourceDetail: { index }, createdAtMs: index, gears: [], powder: 1, blueprintShards: 0 }).nextState;
      storage.saveGearState(state, localStorage);
    });
    await fireShot(page, false, { expectLaunch: false });
    await expect(page.locator('#weekdayDungeonBattleStatus')).toContainText('未受取報酬がいっぱい');
    let state = await readDurableState(page);
    expect(state.dungeon.activeAttempt).toBeNull();
    expect(state.pending).toHaveLength(10);

    await clearWeekdayAndGearStorage(page);
    await page.reload();
    await openDungeon(page, { navigate: false });
    await page.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, get: () => ({ request() { return Promise.reject(Object.assign(new Error('refused'), { code: 'WEEKDAY_DUNGEON_LOCK_UNAVAILABLE' })); } }) }));
    await fireShot(page, false, { expectLaunch: false });
    await expect(page.locator('#weekdayDungeonBattleStatus')).toContainText('安全な保存ロックを使えません');
    state = await readDurableState(page);
    expect(state.dungeon.activeAttempt).toBeNull();
    expect(state.pending).toEqual([]);
  });

  test('WAL retry, R and narrow 320x568 retain one-shot safety and a usable FIRE origin', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openDungeon(page);
    const layout = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth + 1, status: document.querySelector('#weekdayDungeonBattleStatus')?.getAttribute('aria-live') }));
    expect(layout).toEqual({ fits: true, status: 'polite' });
    await page.keyboard.press('r');
    await expect(page.locator('#weekdayDungeonBattleStatus')).toHaveAttribute('data-phase', 'ready');
    await page.evaluate(() => localStorage.setItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY, '{"pending":true}'));
    await fireShot(page, true);
    await expect(page.locator('#weekdayDungeonBattleStatus')).toHaveAttribute('data-phase', 'error', { timeout: 25_000 });
    let state = await readDurableState(page);
    expect(state.dungeon.activeAttempt).toMatchObject({ phase: 'fired' });
    await page.evaluate(() => localStorage.removeItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY));
    await tapVirtualCanvas(page, 270, 356); // weekday retry rendered inside shared Battle canvas
    await waitForDrop(page);
    state = await readDurableState(page);
    expect(state.dungeon.activeAttempt).toMatchObject({ phase: 'queued' });
  });
});
