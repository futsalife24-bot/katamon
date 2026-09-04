const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html?weekday-dungeon-e2e=release-gate';
const VIRTUAL_WIDTH = 540;
const VIRTUAL_HEIGHT = 960;

async function gamePhase(page) {
  return page.evaluate(() => globalThis.KatamonCustomStageBridge?.getState?.().gamePhase || null);
}

async function tapVirtualCanvas(page, x, y) {
  const canvas = page.getByTestId('battle-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'game canvas must have a rendered box').not.toBeNull();
  await page.touchscreen.tap(
    box.x + box.width * x / VIRTUAL_WIDTH,
    box.y + box.height * y / VIRTUAL_HEIGHT,
  );
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

async function openTitle(page, { navigate = true } = {}) {
  if (navigate) await page.goto(GAME_URL);
  await waitForProductionModules(page);
  await expect.poll(() => gamePhase(page), { timeout: 20_000 }).toBe('press');
  await tapVirtualCanvas(page, VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2);
  await expect.poll(() => gamePhase(page), { timeout: 20_000 }).toBe('title');
}

async function openDungeon(page, { navigate = true, expectAutomaticRecovery = false } = {}) {
  await openTitle(page, { navigate });
  await tapVirtualCanvas(page, 508, 690); // BATTLE -> GARAGE
  await page.waitForTimeout(380); // title menu slide is 320ms
  await tapVirtualCanvas(page, 270, 727); // LOADOUT
  await expect(page.locator('#gearWorkshop')).toHaveClass(/open/);
  await page.locator('#gearWeekdayDungeonEntry').click();
  // A durable fired attempt is recovered immediately and closes this dialog
  // before Playwright can observe its transient open class.
  if (!expectAutomaticRecovery) await expect(page.locator('#weekdayDungeon')).toHaveClass(/open/);
  await expect(page.locator('#weekdayDungeonCanvas')).toHaveAttribute('width', '540');
  await expect(page.locator('#weekdayDungeonCanvas')).toHaveAttribute('height', '720');
}

async function findAim(page, hit) {
  return page.evaluate((wantedHit) => {
    const domain = globalThis.KatamonGearWeekdayDungeon;
    const dayInfo = domain.getDayInfo({ nowMs: Date.now() });
    const selected = document.querySelector('.weekdayDungeonSlotChoice.active')?.dataset.weekdayDungeonSlot;
    const slotId = dayInfo.fixedSlotId || selected || domain.WEEKDAY_SLOT_IDS[0];
    for (let angle = domain.AIM_LIMITS.angleMin; angle <= domain.AIM_LIMITS.angleMax; angle += 1) {
      for (let power = domain.AIM_LIMITS.powerMin; power <= domain.AIM_LIMITS.powerMax; power += 1) {
        const attempt = domain.createAttempt({ dayInfo, slotId, aim: { angle, power } });
        if (domain.resolveAttempt(attempt).hit === wantedHit) return { angle, power, slotId };
      }
    }
    return null;
  }, hit);
}

async function aimDungeonCanvas(page, hit) {
  const aim = await findAim(page, hit);
  expect(aim, `a deterministic ${hit ? 'hit' : 'miss'} aim must exist`).not.toBeNull();
  const point = await page.evaluate(({ angle, power }) => {
    const field = globalThis.KatamonGearWeekdayDungeon.PLAYFIELD;
    const radians = angle * Math.PI / 180;
    return {
      x: field.originX + Math.cos(radians) * power * 3.2,
      y: field.originY - Math.sin(radians) * power * 3.2,
    };
  }, aim);
  const canvas = page.locator('#weekdayDungeonCanvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box, 'weekday dungeon canvas must have a rendered box').not.toBeNull();
  await page.touchscreen.tap(
    box.x + box.width * point.x / 540,
    box.y + box.height * point.y / 720,
  );
  await expect(page.locator('#weekdayDungeonAimAngle')).toHaveValue(String(aim.angle));
  await expect(page.locator('#weekdayDungeonAimPower')).toHaveValue(String(aim.power));
  await expect(page.locator('#weekdayDungeonAimReadout')).toHaveText(`角度 ${aim.angle}°・強さ ${aim.power}`);
  return aim;
}

async function clickFireAndWaitForReveal(page) {
  await page.locator('#weekdayDungeonFire').click();
  await expect(page.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 25_000 });
}

async function readDurableState(page) {
  return page.evaluate(() => {
    const dungeonStorage = globalThis.KatamonGearWeekdayDungeonStorage;
    const gearStorage = globalThis.KatamonGearStorage;
    const dungeon = dungeonStorage.loadWeekdayDungeonState(localStorage);
    const gear = gearStorage.loadGearState(localStorage);
    return {
      dungeon,
      inventory: gear.inventory.length,
      tempBox: gear.tempBox.length,
      pending: gear.unclaimedRewards.map((reward) => ({
        rewardId: reward.rewardId,
        sourceId: reward.sourceId,
        gears: reward.gears.map((entry) => entry.gearId),
        powder: reward.powder,
      })),
      ledger: Object.keys(gear.rewardLedger).sort(),
      powder: gear.resources.powder,
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

test.describe('weekday dungeon durable release gate', () => {
  test('Garage DOM entry, canvas aim, FIRE, reveal and explicit Gear claim create one entitlement', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDungeon(page);
    await expect(page.locator('#weekdayDungeonStatus')).toContainText(/命中で.*Gear.*粉末3/);
    const aim = await aimDungeonCanvas(page, true);
    await clickFireAndWaitForReveal(page);

    const queued = await readDurableState(page);
    expect(queued.dungeon.activeAttempt).toMatchObject({ phase: 'queued', angle: aim.angle, power: aim.power, slotId: aim.slotId });
    expect(queued.pending).toEqual([{
      rewardId: queued.dungeon.activeAttempt.rewardId,
      sourceId: 'weekday_dungeon',
      gears: [`weekday-dungeon:${queued.dungeon.activeAttempt.dayKey}:${aim.slotId}:gear:0`],
      powder: 0,
    }]);
    expect(queued.inventory).toBe(0);
    await testInfo.attach('weekday-dungeon-hit', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await expect(page.locator('#gearDropClaim')).toBeVisible();
    await page.locator('#gearDropClaim').click();
    await expect(page.locator('#gearDropClaim')).toBeHidden();
    await page.locator('#gearDropClose').click();
    const claimed = await readDurableState(page);
    expect(claimed.inventory).toBe(1);
    expect(claimed.tempBox).toBe(0);
    expect(claimed.pending).toEqual([]);
    expect(claimed.ledger).toEqual([queued.dungeon.activeAttempt.rewardId]);
    await expect(page.locator('#gearWeekdayDungeonEntry')).toBeDisabled();
    // The Windows WebKit runtime used by Playwright does not expose the iOS
    // AudioContext constructor. Keep this exact simulator-only title-BGM noise
    // out of the dungeon release gate while retaining every other pageerror.
    const unexpectedErrors = errors.filter((message) => message !== "undefined is not a constructor (evaluating 'new AC()')");
    expect(unexpectedErrors).toEqual([]);
  });

  test('miss queues powder +3 and adds it only after the explicit claim button', async ({ page }) => {
    await openDungeon(page);
    const aim = await aimDungeonCanvas(page, false);
    await clickFireAndWaitForReveal(page);
    await expect(page.locator('#gearDropKicker')).toHaveText('MATERIAL REWARD');
    await expect(page.locator('.gearDropMaterialValues')).toContainText('粉末 +3');

    const queued = await readDurableState(page);
    expect(queued.dungeon.activeAttempt).toMatchObject({ phase: 'queued', angle: aim.angle, power: aim.power });
    expect(queued.pending).toEqual([{
      rewardId: queued.dungeon.activeAttempt.rewardId,
      sourceId: 'weekday_dungeon',
      gears: [],
      powder: 3,
    }]);
    expect(queued.powder).toBe(0);
    await page.locator('#gearDropClaim').click();
    await expect(page.locator('#gearDropTitle')).toHaveText('MATERIAL GET!');
    const claimed = await readDurableState(page);
    expect(claimed.pending).toEqual([]);
    expect(claimed.powder).toBe(3);
    expect(claimed.ledger).toEqual([queued.dungeon.activeAttempt.rewardId]);
  });

  test('reload recovers a public-API durable fired-before-queue state without a second FIRE', async ({ page }) => {
    await page.goto(GAME_URL);
    await waitForProductionModules(page);
    const seeded = await page.evaluate(async () => {
      const domain = globalThis.KatamonGearWeekdayDungeon;
      const storage = globalThis.KatamonGearWeekdayDungeonStorage;
      const dayInfo = domain.getDayInfo({ nowMs: Date.now() });
      const slotId = dayInfo.fixedSlotId || domain.WEEKDAY_SLOT_IDS[0];
      let selected = null;
      for (let angle = domain.AIM_LIMITS.angleMin; angle <= domain.AIM_LIMITS.angleMax && !selected; angle += 1) {
        for (let power = domain.AIM_LIMITS.powerMin; power <= domain.AIM_LIMITS.powerMax; power += 1) {
          const candidate = domain.createAttempt({ dayInfo, slotId, aim: { angle, power } });
          if (domain.resolveAttempt(candidate).hit) { selected = candidate; break; }
        }
      }
      if (!selected) throw new Error('no hit attempt exists');
      const committed = await storage.commitAttempt(selected, localStorage, { nowMs: Date.now() });
      const gear = globalThis.KatamonGearStorage.loadGearState(localStorage);
      return { attempt: committed.attempt, pending: gear.unclaimedRewards.length, ledger: Object.keys(gear.rewardLedger).length };
    });
    expect(seeded.attempt.phase).toBe('fired');
    expect(seeded.pending).toBe(0);
    expect(seeded.ledger).toBe(0);

    await page.reload();
    await openDungeon(page, { navigate: false, expectAutomaticRecovery: true });
    // Opening the real entry performs reward-only recovery; the test never clicks FIRE.
    await expect(page.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 20_000 });
    const recovered = await readDurableState(page);
    expect(recovered.dungeon.activeAttempt).toEqual({ ...seeded.attempt, phase: 'queued' });
    expect(recovered.pending).toHaveLength(1);
    expect(recovered.pending[0].rewardId).toBe(seeded.attempt.rewardId);
    expect(recovered.pending[0].gears).toHaveLength(1);
    expect(recovered.ledger).toEqual([]);
  });

  test('two pages in one context concurrently FIRE but produce exactly one durable entitlement', async ({ page, context }) => {
    const second = await context.newPage();
    await openDungeon(page);
    await openDungeon(second);
    const firstAim = await aimDungeonCanvas(page, true);
    const secondAim = await aimDungeonCanvas(second, true);
    expect(secondAim).toEqual(firstAim);

    await Promise.all([
      page.locator('#weekdayDungeonFire').click(),
      second.locator('#weekdayDungeonFire').click(),
    ]);
    await expect.poll(async () => (await readDurableState(page)).dungeon.activeAttempt?.phase, { timeout: 25_000 }).toBe('queued');
    await expect(page.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 25_000 });
    await expect(second.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 25_000 });

    const queued = await readDurableState(page);
    expect(queued.pending).toHaveLength(1);
    expect(queued.pending[0].sourceId).toBe('weekday_dungeon');
    expect(queued.pending[0].gears).toHaveLength(1);
    expect(new Set(queued.pending[0].gears).size).toBe(1);
    expect(queued.ledger).toEqual([]);
    await page.locator('#gearDropClaim').click();
    await expect(page.locator('#gearDropClaim')).toBeHidden();
    const claimed = await readDurableState(second);
    expect(claimed.inventory + claimed.tempBox).toBe(1);
    expect(claimed.pending).toEqual([]);
    expect(claimed.ledger).toEqual([queued.dungeon.activeAttempt.rewardId]);
    await second.close();
  });

  test('pending queue full and physical Gear storage full both fail preflight without consuming', async ({ page }) => {
    await openDungeon(page);
    await page.evaluate(() => {
      const storage = globalThis.KatamonGearStorage;
      const rewards = globalThis.KatamonGearRewards;
      let state = storage.createDefaultGearStorageState();
      for (let index = 0; index < storage.UNCLAIMED_REWARD_CAPACITY; index += 1) {
        state = rewards.queueUnclaimedReward(state, {
          rewardId: `weekday-preflight-pending-${index}`,
          sourceId: 'cpu_battle',
          sourceDetail: { e2e: 'pending-full' },
          createdAtMs: index,
          gears: [], powder: 1, blueprintShards: 0,
        }).nextState;
      }
      storage.saveGearState(state, localStorage);
    });
    await aimDungeonCanvas(page, false);
    await page.locator('#weekdayDungeonFire').click();
    await expect(page.locator('#weekdayDungeonStatus')).toContainText('未受取報酬がいっぱい');
    let blocked = await readDurableState(page);
    expect(blocked.dungeon).toMatchObject({ maxConsumedDayIndex: -1, activeAttempt: null });
    expect(blocked.pending).toHaveLength(10);
    expect(blocked.pending.some((reward) => reward.sourceId === 'weekday_dungeon')).toBe(false);

    await clearWeekdayAndGearStorage(page);
    await page.reload();
    await openDungeon(page, { navigate: false });
    await page.evaluate(() => {
      const domain = globalThis.KatamonGearDomain;
      const storage = globalThis.KatamonGearStorage;
      const state = storage.createDefaultGearStorageState();
      const base = domain.createGear({
        gearId: 'weekday-preflight-full-0',
        generationSeed: 'weekday-preflight-full:g', enhancementSeed: 'weekday-preflight-full:e',
        sourceId: 'cpu_battle', sourceDetail: { e2e: 'physical-full' }, acquiredAt: '2026-09-04T00:00:00Z',
        slotId: 'barrel', setId: 'assault',
        qualityProfile: { id: 'weekday-preflight-full', starWeights: [{ id: 1, weight: 1 }], rarityWeights: [{ id: 'normal', weight: 1 }] },
        setProfile: { id: 'weekday-preflight-full-set', setWeights: [{ id: 'assault', weight: 1 }] },
      });
      state.inventory = Array.from({ length: storage.MAIN_INVENTORY_CAPACITY }, (_value, index) => ({
        gear: { ...base, gearId: `weekday-preflight-full-${index}` }, locked: false, favorite: false,
      }));
      state.tempBox = Array.from({ length: storage.TEMP_BOX_CAPACITY }, (_value, offset) => ({
        gear: { ...base, gearId: `weekday-preflight-full-${storage.MAIN_INVENTORY_CAPACITY + offset}` },
        locked: false, favorite: false, enteredAtMs: Date.now(),
      }));
      storage.saveGearState(state, localStorage);
    });
    await aimDungeonCanvas(page, true);
    await page.locator('#weekdayDungeonFire').click();
    await expect(page.locator('#weekdayDungeonStatus')).toContainText('インベントリとTEMP BOXがいっぱい');
    blocked = await readDurableState(page);
    expect(blocked.dungeon).toMatchObject({ maxConsumedDayIndex: -1, activeAttempt: null });
    expect(blocked.inventory).toBe(500);
    expect(blocked.tempBox).toBe(50);
    expect(blocked.pending).toEqual([]);
  });

  test('pending Gear WAL blocks reward mutation, then reward-only retry recovers the consumed shot', async ({ page }) => {
    await openDungeon(page);
    await aimDungeonCanvas(page, true);
    await page.evaluate(() => localStorage.setItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY, '{"pending":true}'));
    await page.locator('#weekdayDungeonFire').click();
    await expect(page.locator('#weekdayDungeonStatus')).toContainText('Gear取引を復旧中', { timeout: 25_000 });
    const blocked = await readDurableState(page);
    expect(blocked.dungeon.activeAttempt).toMatchObject({ phase: 'fired' });
    expect(blocked.pending).toEqual([]);
    expect(blocked.ledger).toEqual([]);
    expect(blocked.wal).toBe('{"pending":true}');
    await expect(page.locator('#weekdayDungeonFire')).toHaveText('報酬保存を再試行');

    await page.evaluate(() => localStorage.removeItem(globalThis.KatamonGearRewards.GEAR_TRANSACTION_STORAGE_KEY));
    await page.locator('#weekdayDungeonFire').click();
    await expect(page.locator('#gearDropReveal')).toHaveClass(/open/, { timeout: 20_000 });
    const recovered = await readDurableState(page);
    expect(recovered.dungeon.activeAttempt).toEqual({ ...blocked.dungeon.activeAttempt, phase: 'queued' });
    expect(recovered.pending).toHaveLength(1);
    expect(recovered.pending[0].rewardId).toBe(blocked.dungeon.activeAttempt.rewardId);
  });

  test('browser Web Lock request refusal fails closed before shot consumption', async ({ page }) => {
    await page.addInitScript(() => {
      const refusingLocks = Object.freeze({
        request() { return Promise.reject(new Error('weekday dungeon lock refused by browser')); },
      });
      Object.defineProperty(navigator, 'locks', { configurable: true, get: () => refusingLocks });
    });
    await openDungeon(page);
    await aimDungeonCanvas(page, false);
    await page.locator('#weekdayDungeonFire').click();
    await expect(page.locator('#weekdayDungeonStatus')).toContainText('安全な保存ロックを使えません');
    const blocked = await readDurableState(page);
    expect(blocked.dungeon).toMatchObject({ maxConsumedDayIndex: -1, activeAttempt: null });
    expect(blocked.inventory).toBe(0);
    expect(blocked.pending).toEqual([]);
    expect(blocked.ledger).toEqual([]);
  });

  test('320x568 has no horizontal overflow and reaches 44px controls that can FIRE', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openDungeon(page);
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.weekdayDungeonPanel');
      const slotButtons = [...document.querySelectorAll('.weekdayDungeonSlotChoice')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      const actionButtons = [...document.querySelectorAll('.weekdayDungeonActions button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return {
        documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
        panelFitsWidth: panel.scrollWidth <= panel.clientWidth + 1,
        slotButtons,
        actionButtons,
        fireTextFits: document.querySelector('#weekdayDungeonFire').scrollWidth <= document.querySelector('#weekdayDungeonFire').clientWidth + 1,
        fireWhiteSpace: getComputedStyle(document.querySelector('#weekdayDungeonFire')).whiteSpace,
      };
    });
    expect(layout.documentFits).toBe(true);
    expect(layout.panelFitsWidth).toBe(true);
    expect(layout.slotButtons).toHaveLength(6);
    for (const button of [...layout.slotButtons, ...layout.actionButtons]) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    expect(layout.fireTextFits).toBe(true);
    expect(layout.fireWhiteSpace).toBe('nowrap');

    const fire = page.locator('#weekdayDungeonFire');
    await fire.scrollIntoViewIfNeeded();
    const fireRect = await fire.boundingBox();
    expect(fireRect).not.toBeNull();
    expect(fireRect.x).toBeGreaterThanOrEqual(0);
    expect(fireRect.x + fireRect.width).toBeLessThanOrEqual(320);
    expect(fireRect.y).toBeGreaterThanOrEqual(0);
    expect(fireRect.y + fireRect.height).toBeLessThanOrEqual(568);
    await clickFireAndWaitForReveal(page);
  });
});
