const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html?f4=1';
const MAIN_SCRIPT_END = '\n})();\n</script>\n<script src="coop-mvp-boss.js"';
const ROOM_CODE = 'A2BC3DEF';
const ROUND_ID = 'a'.repeat(48);
const HOST_UID = 'host-p1';
const GUEST_UID = 'guest-e1';

function token() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 })).toString('base64url');
  return `x.${payload}.y`;
}

async function installF4Bridge(context, fixture) {
  await context.addInitScript(() => {
    class F4EventSource {
      constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; }
      addEventListener(type, listener) { this.listeners.set(type, listener); }
      close() { this.closed = true; }
    }
    globalThis.EventSource = F4EventSource;
    globalThis.__f4PageErrors = [];
    addEventListener('error', event => globalThis.__f4PageErrors.push(String(event.error?.stack || event.message || event.error || 'error')));
  });
  await context.route('**/index.html?f4=1', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    expect(source).toContain(MAIN_SCRIPT_END);
    const bridge = `
  const f4Trace = [];
  const f4Push = (name, phase, detail = null) => f4Trace.push({
    sequence: f4Trace.length + 1, timestamp: performance.now(), name, phase, detail,
    gamePhase, battleMode, onlineKind: online?.kind || null,
    onlinePhase: online?.phase || null, pendingReentry: !!pendingFirebaseReentry,
    localUnitId: localUnitId || null, localCharacter: localUnit()?.character || null,
    hasSuspendedSave: !!loadSuspendedMatch()
  });
  const f4WrapAsync = (name, original) => async function(...args) {
    f4Push(name, 'before');
    try { const value = await original.apply(this, args); f4Push(name, 'after'); return value; }
    catch (error) { f4Push(name, 'error', { name: error?.name, message: error?.message, code: error?.code || null }); throw error; }
  };
  const f4WrapSync = (name, original) => function(...args) {
    f4Push(name, 'before', name === 'applySnapshot' ? { authority: new Error().stack } : null);
    try { const value = original.apply(this, args); f4Push(name, 'after'); return value; }
    catch (error) { f4Push(name, 'error', { name: error?.name, message: error?.message, code: error?.code || null }); throw error; }
  };
  restoreFirebaseRoomSeatReentry = f4WrapAsync('restoreFirebaseRoomSeatReentry', restoreFirebaseRoomSeatReentry);
  acquireFirebaseReentryLease = f4WrapAsync('acquireFirebaseReentryLease', acquireFirebaseReentryLease);
  activatePendingFirebaseBattleReentry = f4WrapAsync('activatePendingFirebaseBattleReentry', activatePendingFirebaseBattleReentry);
  replayFirebaseBattleRecoveryPlan = f4WrapAsync('replayFirebaseBattleRecoveryPlan', replayFirebaseBattleRecoveryPlan);
  const f4OriginalFinalFence = assertFinalFirebaseRecoveryRound;
  assertFinalFirebaseRecoveryRound = async function(candidate, plan) {
    f4Push('assertFinalFirebaseRecoveryRound', 'before', {
      candidateRoundId: candidate?.roundId, candidateRoundStatus: candidate?.roundStatus,
      planRoundId: plan?.roundId, planRoundStatus: plan?.roundStatus, planKind: plan?.kind
    });
    try { const value = await f4OriginalFinalFence(candidate, plan); f4Push('assertFinalFirebaseRecoveryRound', 'after'); return value; }
    catch (error) { f4Push('assertFinalFirebaseRecoveryRound', 'error', { code: error?.code, message: error?.message }); throw error; }
  };
  beginFirebaseOnline = f4WrapSync('beginFirebaseOnline', beginFirebaseOnline);
  restoreFirebaseBattleReplayRollback = f4WrapSync('restoreFirebaseBattleReplayRollback', restoreFirebaseBattleReplayRollback);
  resumeSuspendedMatch = f4WrapSync('resumeSuspendedMatch', resumeSuspendedMatch);
  applySnapshot = f4WrapSync('applySnapshot', applySnapshot);

  globalThis.KatamonF4StartupBridge = Object.freeze({
    async seed(options = {}) {
      setMatchFormat('1v1');
      gamePhase = 'battle';
      selectCharacterAndStart('kyoryu');
      for (let attempt = 0; attempt < 120 && !localStorage.getItem(SUSPEND_KEY); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!localStorage.getItem(SUSPEND_KEY)) throw new Error('F4 CPU suspend seed failed');

      setMatchFormat('1v1');
      applyCharacter(unitById('p1'), 'kyoryu');
      applyCharacter(unitById('e1'), 'iwa');
      resetMatch(false);
      const snap = structuredClone(buildSnapshot());
      const hostNonce = 'a'.repeat(48);
      const guestNonce = 'b'.repeat(48);
      snap.activeIndex = (await fairFirstPlayer('${ROOM_CODE}', hostNonce, guestNonce)) === 'p1' ? 0 : 1;
      const room = {
        protocol: 3, hostUid: '${HOST_UID}', createdAt: 1800000000000,
        expiresAt: Date.now() + 600000, visibility: 'private',
        settings: { terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format: '1v1', stageSize: 'standard', revision: 1 },
        slots: { p1: { uid: '${HOST_UID}', claimedAt: Date.now() - 2 }, e1: { uid: '${GUEST_UID}', claimedAt: Date.now() - 1 }, s1: null, s2: null },
        round: { id: '${ROUND_ID}', status: 'playing', players: { p1: '${HOST_UID}', e1: '${GUEST_UID}' } }
      };
      const credential = createFirebaseReentryCredential({
        auth: { uid: '${GUEST_UID}', refreshToken: 'refresh-f4' }, room,
        roomCode: '${ROOM_CODE}', seat: 'e1', savedAt: Date.now()
      });
      saveFirebaseReentryCredential(credential);
      if (options.holdReentryLease === true) {
        globalThis.__f5HeldReentryLease = await acquireFirebaseReentryLease(credential);
      }
      const base = { v: 3, roundId: '${ROUND_ID}', sentAt: 1800000000000 };
      const messages = {
        '-0000000000000000001': { ...base, t: 'commit', from: '${HOST_UID}', seat: 'p1', hash: await commitPayload('kyoryu', hostNonce) },
        '-0000000000000000002': { ...base, t: 'commit', from: '${GUEST_UID}', seat: 'e1', hash: await commitPayload('iwa', guestNonce) },
        '-0000000000000000003': { ...base, t: 'reveal', from: '${HOST_UID}', seat: 'p1', character: 'kyoryu', nonce: hostNonce },
        '-0000000000000000004': { ...base, t: 'reveal', from: '${GUEST_UID}', seat: 'e1', character: 'iwa', nonce: guestNonce },
        '-0000000000000000005': { ...base, t: 'start', from: '${HOST_UID}', seat: 'p1', snap }
      };
      // Fixture construction uses the production Battle path and may legitimately
      // refresh the current CPU suspend. The authority contract starts here: these
      // exact final bytes must survive the subsequent zero-input ONLINE re-entry.
      const cpuRaw = localStorage.getItem(SUSPEND_KEY);
      if (!cpuRaw) throw new Error('F4 CPU suspend disappeared during fixture construction');
      return {
        room, messages, cpuRaw,
        validation: Object.entries(messages).map(([key, value]) => ({ key, result: validateFirebaseMessageDetail(value) }))
      };
    },
    state() {
      const unit = localUnit();
      return structuredClone({
        gamePhase, battleMode, onlineKind: online?.kind || null,
        onlinePhase: online?.phase || null, onlineSeat: online?.seat || null,
        currentRoundId: online?.currentRoundId || null, localUnitId,
        localCharacter: unit?.character || null, pendingReentry: !!pendingFirebaseReentry,
        cpuRaw: localStorage.getItem(SUSPEND_KEY),
        credentialPresent: !!localStorage.getItem(firebaseReentryApi().FIREBASE_REENTRY_STORAGE_KEY),
        trace: f4Trace.slice(), pageErrors: globalThis.__f4PageErrors.slice()
      });
    }
  });
`;
    await route.fulfill({
      response,
      body: source.replace(MAIN_SCRIPT_END, `${bridge}${MAIN_SCRIPT_END}`),
      headers: { ...response.headers(), 'content-type': 'text/html; charset=utf-8' },
    });
  });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.includes('identitytoolkit.googleapis.com') && url.includes('signUp')) {
      fixture.authSignUpCount = (fixture.authSignUpCount || 0) + 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'F5_NEW_UID_FORBIDDEN' } }) });
    }
    if (url.includes('securetoken.googleapis.com')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: GUEST_UID, id_token: token(), refresh_token: 'rotated-f4', expires_in: '3600' }) });
    }
    if (url.includes(`/rooms/${ROOM_CODE}/slots/e1/seenAt.json`)) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (url.includes(`/rooms/${ROOM_CODE}/rounds/${ROUND_ID}/messages.json`)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.messages) });
    if (url.includes(`/rooms/${ROOM_CODE}/round.json`)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.room.round) });
    if (url.includes(`/rooms/${ROOM_CODE}.json`)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.room) });
    return route.fallback();
  });
}

test('zero-input reload gives Firebase re-entry authority while preserving CPU suspend bytes', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium is the production reload authority for F4.');
  const fixture = { room: null, messages: null };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed());
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    // The CPU loop remains live while the Firebase fixture is assembled and may
    // autosave normally. Freeze the authority comparison at the actual reload
    // boundary: ONLINE bootstrap must neither consume nor rewrite these bytes.
    const cpuRawBeforeReload = await page.evaluate(() => localStorage.getItem('katamon_suspend_v1'));
    expect(cpuRawBeforeReload).toBeTruthy();
    // Fixture assembly intentionally transitions one document through CPU and
    // canonical ONLINE start states. Only errors after this zero-input reload
    // boundary belong to the startup-recovery contract under test.
    browserErrors.length = 0;

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    const state = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(state.onlinePhase, JSON.stringify(state, null, 2)).toBe('playing');
    expect(state, JSON.stringify(state, null, 2)).toMatchObject({
      gamePhase: 'battle', battleMode: 'normal', onlineKind: 'firebase',
      onlinePhase: 'playing', onlineSeat: 'e1', currentRoundId: ROUND_ID,
      localUnitId: 'e1', localCharacter: 'iwa', pendingReentry: false,
      credentialPresent: true,
    });
    expect(state.cpuRaw).toBe(cpuRawBeforeReload);
    expect(state.trace.some(entry => entry.name === 'resumeSuspendedMatch')).toBe(false);
    expect(state.trace.some(entry => entry.name === 'restoreFirebaseBattleReplayRollback' && entry.phase === 'error')).toBe(false);
    expect(state.pageErrors).toEqual([]);
    expect(browserErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('native Firebase re-entry Web Lock contention retries without weakening second-tab exclusivity', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the F5 production authority.');
  const fixture = { room: null, messages: null };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await installF4Bridge(context, fixture);
  const lockOwnerPage = await context.newPage();
  let contenderPage = null;
  try {
    await lockOwnerPage.goto(GAME_URL);
    await expect.poll(() => lockOwnerPage.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await lockOwnerPage.evaluate(() => globalThis.KatamonF4StartupBridge.seed({ holdReentryLease: true }));
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;

    const heldBeforeHandoff = await lockOwnerPage.evaluate(async () => {
      const snapshot = await navigator.locks.query();
      return snapshot.held.map(lock => ({ name: lock.name, mode: lock.mode }));
    });
    expect(heldBeforeHandoff.some(lock => lock.mode === 'exclusive')).toBe(true);

    contenderPage = await context.newPage();
    await contenderPage.goto(GAME_URL);
    await expect.poll(() => contenderPage.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    await expect.poll(async () => {
      const state = await contenderPage.evaluate(() => globalThis.KatamonF4StartupBridge.state());
      return state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease'
        && entry.phase === 'error' && entry.detail?.code === 'FIREBASE_REENTRY_ALREADY_ACTIVE').length;
    }, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    // TAB A remains authoritative while it owns the native exclusive lock. TAB B
    // may retry, but it must not enter the same seat or erase the credential.
    await expect.poll(async () => {
      const state = await contenderPage.evaluate(() => globalThis.KatamonF4StartupBridge.state());
      return state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease' && entry.phase === 'before').length;
    }, { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    const blockedState = await contenderPage.evaluate(() => {
      const state = globalThis.KatamonF4StartupBridge.state();
      return {
        onlineKind: state.onlineKind,
        onlinePhase: state.onlinePhase,
        credentialPresent: state.credentialPresent,
        acquireTrace: state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease'),
      };
    });
    expect(blockedState.onlineKind).toBeNull();
    expect(blockedState.onlinePhase).toBeNull();
    expect(blockedState.credentialPresent).toBe(true);
    expect(fixture.authSignUpCount || 0).toBe(0);

    const cpuRawAtHandoff = await contenderPage.evaluate(() => localStorage.getItem('katamon_suspend_v1'));
    expect(cpuRawAtHandoff).toBeTruthy();

    // Closing the old document models the reload handoff boundary. Its lock is
    // released by Chromium; the already-running new document must acquire on a
    // later retry without a tap or a second bootstrap.
    const handoffStartedAt = await contenderPage.evaluate(() => performance.now());
    await lockOwnerPage.close();
    await expect.poll(async () => (await contenderPage.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    const restoredState = await contenderPage.evaluate(() => {
      const state = globalThis.KatamonF4StartupBridge.state();
      return {
        gamePhase: state.gamePhase,
        onlineKind: state.onlineKind,
        onlinePhase: state.onlinePhase,
        onlineSeat: state.onlineSeat,
        currentRoundId: state.currentRoundId,
        localUnitId: state.localUnitId,
        localCharacter: state.localCharacter,
        credentialPresent: state.credentialPresent,
        cpuRaw: state.cpuRaw,
        activationTrace: state.trace.filter(entry => entry.name === 'activatePendingFirebaseBattleReentry'),
        acquireTrace: state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease'),
        pageErrors: state.pageErrors,
      };
    });
    expect(restoredState).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase',
      onlineSeat: 'e1', currentRoundId: ROUND_ID, localUnitId: 'e1',
      localCharacter: 'iwa', credentialPresent: true, pageErrors: [],
    });
    const activationAfter = restoredState.activationTrace.find(entry => entry.phase === 'after');
    expect(activationAfter).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      localUnitId: 'e1', localCharacter: 'iwa', pendingReentry: false,
    });
    expect(restoredState.cpuRaw).toBe(cpuRawAtHandoff);
    expect(fixture.authSignUpCount || 0).toBe(0);
    const successfulAcquireAt = restoredState.acquireTrace.find(entry => entry.phase === 'after')?.timestamp;
    expect(successfulAcquireAt - handoffStartedAt).toBeLessThan(5000);
  } finally {
    if (contenderPage && !contenderPage.isClosed()) await contenderPage.close();
    await context.close();
  }
});

test('same-tab zero-input reload releases and reacquires its native Firebase re-entry Web Lock', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the F5 production authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({ holdReentryLease: true }));
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    const beforeReload = await page.evaluate(async () => {
      const lockSnapshot = await navigator.locks.query();
      return {
        cpuRaw: localStorage.getItem('katamon_suspend_v1'),
        heldExclusive: lockSnapshot.held.some(lock => lock.mode === 'exclusive'),
      };
    });
    expect(beforeReload.heldExclusive).toBe(true);
    expect(beforeReload.cpuRaw).toBeTruthy();

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    const restored = await page.evaluate(() => {
      const state = globalThis.KatamonF4StartupBridge.state();
      return {
        gamePhase: state.gamePhase,
        onlineKind: state.onlineKind,
        onlinePhase: state.onlinePhase,
        onlineSeat: state.onlineSeat,
        currentRoundId: state.currentRoundId,
        localUnitId: state.localUnitId,
        localCharacter: state.localCharacter,
        cpuRaw: state.cpuRaw,
        credentialPresent: state.credentialPresent,
        pageErrors: state.pageErrors,
        acquireTrace: state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease'),
      };
    });
    expect(restored).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 'e1', currentRoundId: ROUND_ID, localUnitId: 'e1',
      localCharacter: 'iwa', credentialPresent: true, pageErrors: [],
    });
    expect(restored.cpuRaw).toBe(beforeReload.cpuRaw);
    expect(restored.acquireTrace.some(entry => entry.phase === 'after')).toBe(true);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});
