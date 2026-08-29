const { test, expect } = require('@playwright/test');

const GAME_URL = '/index.html?f4=1';
const MAIN_SCRIPT_END = '\n})();\n</script>\n<script src="coop-mvp-boss.js"';
const ROOM_CODE = 'A2BC3DEF';
const ROUND_ID = 'a'.repeat(48);
const HOST_UID = 'host-p1';
const GUEST_UID = 'guest-e1';
const SUPPORT1_UID = 'support-s1';
const SUPPORT2_UID = 'support-s2';

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
  const f4OriginalActivatePending = activatePendingFirebaseBattleReentry;
  activatePendingFirebaseBattleReentry = async function(...args) {
    f4Push('activatePendingFirebaseBattleReentry', 'before');
    try {
      const value = await f4OriginalActivatePending.apply(this, args);
      f4Push('activatePendingFirebaseBattleReentry', 'after');
      // Once canonical replay has reached its stable boundary, stop only this
      // mock's ping-less frame loop. Replay itself keeps native RAF authority.
      requestAnimationFrame = () => 0;
      return value;
    } catch (error) {
      f4Push('activatePendingFirebaseBattleReentry', 'error', { name: error?.name, message: error?.message, code: error?.code || null });
      throw error;
    }
  };
  replayFirebaseBattleRecoveryPlan = f4WrapAsync('replayFirebaseBattleRecoveryPlan', replayFirebaseBattleRecoveryPlan);
  beginFirebaseBattleReplayAction = f4WrapSync('beginFirebaseBattleReplayAction', beginFirebaseBattleReplayAction);
  const f4OriginalSnapshotMismatch = firebaseRecoverySnapshotMismatchReason;
  firebaseRecoverySnapshotMismatchReason = function(candidate, baseline) {
    const reason = f4OriginalSnapshotMismatch(candidate, baseline);
    if (reason) f4Push('firebaseRecoverySnapshotMismatchReason', 'mismatch', {
      reason,
      candidateTurn: candidate?.turnCount,
      baselineTurn: baseline?.turnCount,
      candidateCraters: structuredClone(candidate?.craters || []),
      baselineCraters: structuredClone(baseline?.craters || [])
    });
    return reason;
  };
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
      const format = options.format === '2v2' ? '2v2' : '1v1';
      const requestedSeat = ['p1', 'e1', 's1', 's2'].includes(options.reentrySeat) ? options.reentrySeat : 'e1';
      const reentrySeat = format === '2v2' ? requestedSeat : (requestedSeat === 'p1' ? 'p1' : 'e1');
      const reentryUid = ({ p1: '${HOST_UID}', e1: '${GUEST_UID}', s1: '${SUPPORT1_UID}', s2: '${SUPPORT2_UID}' })[reentrySeat];
      const reentryCharacter = ({ p1: 'kyoryu', e1: 'iwa', s1: 'medama', s2: 'kyoryu' })[reentrySeat];
      const reentryRole = reentrySeat === 'p1' ? 'host' : 'guest';
      setMatchFormat('1v1');
      gamePhase = 'battle';
      selectCharacterAndStart('kyoryu');
      for (let attempt = 0; attempt < 120 && !localStorage.getItem(SUSPEND_KEY); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!localStorage.getItem(SUSPEND_KEY)) throw new Error('F4 CPU suspend seed failed');
      // The mock has no natural peer ping stream. Stop the production frame loop
      // after it has created the CPU suspend so a successful recovery cannot age
      // into peer-timeout/ended while the suite is asserting a later case.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      requestAnimationFrame = () => 0;
      await new Promise(resolve => setTimeout(resolve, 25));

      setMatchFormat(format);
      applyCharacter(unitById('p1'), 'kyoryu');
      applyCharacter(unitById('e1'), 'iwa');
      if (format === '2v2') {
        applyCharacter(unitById('p2'), 'medama');
        applyCharacter(unitById('e2'), 'kyoryu');
      }
      resetMatch(false);
      let snap = structuredClone(buildSnapshot());
      const hostNonce = 'a'.repeat(48);
      const guestNonce = 'b'.repeat(48);
      snap.activeIndex = (await fairFirstPlayer('${ROOM_CODE}', hostNonce, guestNonce)) === 'p1' ? 0 : 1;
      if (options.completedHitActions === true) {
        const player = snap.units.find(unit => unit.id === 'p1');
        const enemy = snap.units.find(unit => unit.id === 'e1');
        player.x = 600; player.y = 360;
        enemy.x = 840; enemy.y = 360;
      }
      const room = {
        protocol: 3, hostUid: '${HOST_UID}', createdAt: 1800000000000,
        expiresAt: Date.now() + 600000, visibility: 'private',
        settings: {
          terrain: 'rolling', wind: 'calm', turnsPerPlayer: 15, format, stageSize: 'standard', revision: 1,
          ...(options.gear === true ? {
            gearCapability: globalThis.KatamonGearOnlineLobbyProtocol.createRoomGearCapability({
              visibility: 'private',
              gearMode: globalThis.KatamonGearOnlineProtocol.GEAR_MODE_PRIVATE_TRUSTED_V1,
            }),
          } : {}),
        },
        slots: {
          p1: { uid: '${HOST_UID}', claimedAt: Date.now() - 4 },
          e1: { uid: '${GUEST_UID}', claimedAt: Date.now() - 3 },
          s1: format === '2v2' ? { uid: '${SUPPORT1_UID}', claimedAt: Date.now() - 2 } : null,
          s2: format === '2v2' ? { uid: '${SUPPORT2_UID}', claimedAt: Date.now() - 1 } : null
        },
        round: {
          id: '${ROUND_ID}', status: 'playing',
          players: format === '2v2'
            ? { p1: '${HOST_UID}', e1: '${GUEST_UID}', s1: '${SUPPORT1_UID}', s2: '${SUPPORT2_UID}' }
            : { p1: '${HOST_UID}', e1: '${GUEST_UID}' }
        }
      };
      const credential = createFirebaseReentryCredential({
        auth: { uid: reentryUid, refreshToken: 'refresh-f4' }, room,
        roomCode: '${ROOM_CODE}', seat: reentrySeat, savedAt: Date.now()
      });
      saveFirebaseReentryCredential(credential);
      if (options.holdReentryLease === true || options.activeOnlineLease === true) {
        globalThis.__f5HeldReentryLease = await acquireFirebaseReentryLease(credential);
      }
      if (options.activeOnlineLease === true) {
        const auth = {
          uid: reentryUid, idToken: 'test-f5', refreshToken: 'refresh-f5',
          expiresAt: Date.now() + 3600000, serverTimeOffset: 0
        };
        beginFirebaseOnline(reentryRole, '${ROOM_CODE}', auth, reentryCharacter, room, reentrySeat, null, globalThis.__f5HeldReentryLease);
        online.phase = 'playing';
      }
      let gearFixture = null;
      if (options.gear === true) {
        if (format !== '1v1') throw new Error('F4 Gear browser fixture currently supports canonical 1v1 only');
        const makeReveal = (seat, characterId) => {
          const trustedContext = firebaseGearTrustedContext(seat, characterId);
          const slots = Object.fromEntries(globalThis.KatamonGearDomain.SLOT_IDS.map(slotId => [slotId, null]));
          const battleGearSnapshot = globalThis.KatamonGearBattleSnapshot.createBattleGearSnapshot({
            resolvedLoadout: { characterId, presetId: 'preset1', gearIds: [], slots },
            baseHp: trustedContext.baseHp, baseFuel: trustedContext.baseFuel,
          });
          const revealedCommitment = globalThis.KatamonGearOnlineProtocol.createLoadoutCommitment({
            battleGearSnapshot, roundId: '${ROUND_ID}', trustedContext,
          });
          return Object.freeze({ trustedContext, revealedCommitment });
        };
        const reveals = [makeReveal('p1', 'kyoryu'), makeReveal('e1', 'iwa')];
        const readyBindingTexts = Object.fromEntries(reveals.map(entry => {
          const readyBinding = globalThis.KatamonGearOnlineLobbyProtocol.createReadyGearBinding({
            loadoutCommitment: entry.revealedCommitment, trustedContext: entry.trustedContext,
          });
          return [entry.revealedCommitment.seatId,
            globalThis.KatamonGearOnlineLobbyProtocol.stableSerializeReadyGearBinding(readyBinding)];
        }));
        const manifest = globalThis.KatamonGearOnlineLobbyProtocol.createStartGearManifest({
          roundId: '${ROUND_ID}',
          commitments: reveals.map(entry => entry.revealedCommitment),
          participantReveals: reveals,
        });
        const startState = globalThis.KatamonGearOnlineBattleStart.createOnlineGearBattleStartState({
          matchFormat: '1v1', manifest, participantReveals: reveals,
        });
        online.participantGearReveals = Object.fromEntries(reveals.map(entry => [entry.revealedCommitment.seatId, entry]));
        online.verifiedStartGearManifest = manifest;
        applyFirebaseOnlineGearBattleStartState(startState);
        snap = structuredClone(buildSnapshot());
        snap.activeIndex = (await fairFirstPlayer('${ROOM_CODE}', hostNonce, guestNonce)) === 'p1' ? 0 : 1;
        gearFixture = { reveals, manifest, readyBindingTexts };
      }
      const base = { v: 3, roundId: '${ROUND_ID}', sentAt: 1800000000000 };
      let messages = {
        '-0000000000000000001': { ...base, t: 'commit', from: '${HOST_UID}', seat: 'p1', hash: await commitPayload('kyoryu', hostNonce) },
        '-0000000000000000002': { ...base, t: 'commit', from: '${GUEST_UID}', seat: 'e1', hash: await commitPayload('iwa', guestNonce) },
        '-0000000000000000003': { ...base, t: 'reveal', from: '${HOST_UID}', seat: 'p1', character: 'kyoryu', nonce: hostNonce },
        '-0000000000000000004': { ...base, t: 'reveal', from: '${GUEST_UID}', seat: 'e1', character: 'iwa', nonce: guestNonce },
        '-0000000000000000005': { ...base, t: 'start', from: '${HOST_UID}', seat: 'p1', snap }
      };
      if (gearFixture) {
        const hostReveal = gearFixture.reveals[0];
        const guestReveal = gearFixture.reveals[1];
        const wire = globalThis.KatamonGearOnlineFirebaseWire;
        messages = {
          '-0000000000000000001': { ...base, t: 'commit', from: '${HOST_UID}', seat: 'p1', hash: await commitPayload('kyoryu', hostNonce, gearFixture.readyBindingTexts.p1) },
          '-0000000000000000002': { ...base, t: 'commit', from: '${GUEST_UID}', seat: 'e1', hash: await commitPayload('iwa', guestNonce, gearFixture.readyBindingTexts.e1) },
          '-0000000000000000003': { ...base, t: 'reveal', from: '${HOST_UID}', seat: 'p1', character: 'kyoryu', nonce: hostNonce, gearWireVersion: wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearCommitmentJson: wire.encodeRevealGearCommitment({ loadoutCommitment: hostReveal.revealedCommitment, trustedContext: hostReveal.trustedContext }) },
          '-0000000000000000004': { ...base, t: 'reveal', from: '${GUEST_UID}', seat: 'e1', character: 'iwa', nonce: guestNonce, gearWireVersion: wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearCommitmentJson: wire.encodeRevealGearCommitment({ loadoutCommitment: guestReveal.revealedCommitment, trustedContext: guestReveal.trustedContext }) },
          '-0000000000000000005': { ...base, t: 'start', from: '${HOST_UID}', seat: 'p1', snap, gearWireVersion: wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION, gearManifestJson: wire.encodeStartGearManifest({ manifest: gearFixture.manifest, participantReveals: gearFixture.reveals }) },
        };
      }
      if (format === '2v2') {
        const support1Nonce = 'c'.repeat(48);
        const support2Nonce = 'd'.repeat(48);
        messages = {
          '-0000000000000000001': { ...base, t: 'commit', from: '${HOST_UID}', seat: 'p1', hash: await commitPayload('kyoryu', hostNonce) },
          '-0000000000000000002': { ...base, t: 'commit', from: '${GUEST_UID}', seat: 'e1', hash: await commitPayload('iwa', guestNonce) },
          '-0000000000000000003': { ...base, t: 'commit', from: '${SUPPORT1_UID}', seat: 's1', hash: await commitPayload('medama', support1Nonce) },
          '-0000000000000000004': { ...base, t: 'commit', from: '${SUPPORT2_UID}', seat: 's2', hash: await commitPayload('kyoryu', support2Nonce) },
          '-0000000000000000005': { ...base, t: 'reveal', from: '${HOST_UID}', seat: 'p1', character: 'kyoryu', nonce: hostNonce },
          '-0000000000000000006': { ...base, t: 'reveal', from: '${GUEST_UID}', seat: 'e1', character: 'iwa', nonce: guestNonce },
          '-0000000000000000007': { ...base, t: 'reveal', from: '${SUPPORT1_UID}', seat: 's1', character: 'medama', nonce: support1Nonce },
          '-0000000000000000008': { ...base, t: 'reveal', from: '${SUPPORT2_UID}', seat: 's2', character: 'kyoryu', nonce: support2Nonce },
          '-0000000000000000009': { ...base, t: 'start', from: '${HOST_UID}', seat: 'p1', snap }
        };
      }
      if (options.resultMode === 'concede') {
        room.round.status = 'results';
        messages['-0000000000000000000'] = {
          ...base, t: 'presence', from: '${HOST_UID}', seat: 'p1',
          rivalId: 'c'.repeat(64), name: 'Host'
        };
        messages['-0000000000000000006'] = {
          ...base, t: 'result', from: '${HOST_UID}', seat: 'p1',
          actionId: 'f'.repeat(48), unitId: 'p1', winner: 'cpu', reason: '投了',
          units: snap.units.map(unit => ({ id: unit.id, hp: unit.hp }))
        };
      }
      const completedActionCount = Math.max(0, Math.min(4, Number(options.completedActionCount) || 0));
      if (completedActionCount > 0) {
        const rollback = captureFirebaseBattleReplayRollback();
        try {
          gamePhase = 'battle';
          battleIntroPending = false;
          applySnapshot(snap);
          for (let index = 0; index < completedActionCount; index += 1) {
            const unit = activeUnit();
            if (!unit) throw new Error('F5 completed history active unit is missing');
            const isPlayer = unit.team === 'player';
            const target = units.find(entry => entry.team !== unit.team);
            const actor = isPlayer
              ? { from: '${HOST_UID}', seat: 'p1', x: 240, vx0: -5000 }
              : { from: '${GUEST_UID}', seat: 'e1', x: 1200, vx0: 5000 };
            if (options.completedHitActions === true && target) {
              actor.x = unit.x;
              actor.vx0 = Math.sign(target.x - unit.x || (isPlayer ? 1 : -1)) * 1000;
            }
            const actionId = String.fromCharCode(99 + index).repeat(48);
            unit.x = actor.x;
            unit.y = 360;
            faceAllUnitsTowardOpponents();
            const fire = {
              ...base, t: 'fire', from: actor.from, seat: actor.seat,
              actionId, unitId: unit.id, x: unit.x, y: unit.y,
              anchor: { x: unit.x, y: unit.y }, vx0: actor.vx0, vy0: -140,
              useSpecial: false, useJump: false, sentAt: base.sentAt + 1 + index * 2
            };
            launchShot(unit, fire.anchor, fire.vx0, fire.vy0, false, false, false);
            awaitingResolve = true;
            await firebaseRecoveryAwait(
              () => !awaitingResolve && !pendingShot && !projectiles.length
                && !barucopters.length && !groundFlames.length
                && units.every(entry => entry.grounded),
              {
                timeoutMs: 15000,
                frame: callback => setTimeout(() => { update(0.05); callback(); }, 0)
              }
            );
            const terminalSnap = buildSnapshot({ includeTerrain: false });
            for (const field of [
              'segments', 'pattern', 'startOnIsland', 'bridge', 'themeKey',
              'parallaxSeed', 'terrainMaterial', 'terrainMaterialSegments',
              'customStage', 'customStageIdentity', 'terrainDelta'
            ]) delete terminalSnap[field];
            messages['-' + String(6 + index * 2).padStart(19, '0')] = fire;
            messages['-' + String(7 + index * 2).padStart(19, '0')] = {
              ...base, t: 'state', from: actor.from, seat: actor.seat,
              actionId, unitId: unit.id, snap: structuredClone(terminalSnap),
              sentAt: base.sentAt + 2 + index * 2
            };
          }
        } finally {
          restoreFirebaseBattleReplayRollback(rollback);
        }
      }
      // Fixture construction uses the production Battle path and may legitimately
      // refresh the current CPU suspend. The authority contract starts here: these
      // exact final bytes must survive the subsequent zero-input ONLINE re-entry.
      const cpuRaw = localStorage.getItem(SUSPEND_KEY);
      if (!cpuRaw) throw new Error('F4 CPU suspend disappeared during fixture construction');
      return {
        room, messages, cpuRaw, reentrySeat, reentryUid, reentryCharacter,
        historySummary: {
          units: Object.values(messages).filter(packet => packet.t === 'state')
            .map(packet => packet.snap.units.map(unit => ({ id: unit.id, hp: unit.hp, maxHp: unit.maxHp })))
        },
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
        matchOver, winner, resultSent: online?.resultSent || false,
        gearEnabled: firebaseGearEnabled(),
        verifiedGearManifest: !!online?.verifiedStartGearManifest,
        gearSnapshotUnits: Object.keys(online?.battleGearSnapshotsByUnit || {}).sort(),
        gearShieldByUnit: structuredClone(online?.battleGearShieldStateByUnit || null),
        gearRuntimeByUnit: structuredClone(online?.battleGearRuntimeEffectsStateByUnit || null),
        reentryFailureCode: firebaseReentryLastFailureCode,
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: fixture.reentryUid || GUEST_UID, id_token: token(), refresh_token: 'rotated-f4', expires_in: '3600' }) });
    }
    if (url.includes(`/rooms/${ROOM_CODE}/slots/`) && url.includes('/seenAt.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (url.includes(`/rooms/${ROOM_CODE}/rounds/${ROUND_ID}/messages.json`)) {
      if ((fixture.recoveryMessageFailuresRemaining || 0) > 0) {
        fixture.recoveryMessageFailuresRemaining -= 1;
        return route.fulfill({
          status: fixture.recoveryMessageFailureStatus || 503,
          contentType: 'application/json', body: JSON.stringify({ error: 'temporary' }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.messages) });
    }
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
    // Loaded CI workers can add several seconds after the owner closes.  The
    // security contract is eventual acquisition only after release; 8 seconds
    // remains well inside the production disconnect timeout.
    expect(successfulAcquireAt - handoffStartedAt).toBeLessThan(8000);
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

test('non-bfcache guest pagehide releases its native lease for the replacement document', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the F5 production authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const ownerPage = await context.newPage();
  let replacementPage = null;
  try {
    await ownerPage.goto(GAME_URL);
    await expect.poll(() => ownerPage.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await ownerPage.evaluate(() => globalThis.KatamonF4StartupBridge.seed({ activeOnlineLease: true }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;

    replacementPage = await context.newPage();
    await replacementPage.goto(GAME_URL);
    await expect.poll(async () => {
      const state = await replacementPage.evaluate(() => globalThis.KatamonF4StartupBridge.state());
      return state.trace.filter(entry => entry.name === 'acquireFirebaseReentryLease'
        && entry.phase === 'error' && entry.detail?.code === 'FIREBASE_REENTRY_ALREADY_ACTIVE').length;
    }, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    const persistedStillHeld = await ownerPage.evaluate(async () => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      return (await navigator.locks.query()).held.some(lock => lock.mode === 'exclusive');
    });
    expect(persistedStillHeld).toBe(true);

    const releasedForReplacement = await ownerPage.evaluate(async () => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      await new Promise(resolve => setTimeout(resolve, 50));
      return !(await navigator.locks.query()).held.some(lock => lock.mode === 'exclusive');
    });
    expect(releasedForReplacement).toBe(true);
    await expect.poll(async () => (await replacementPage.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    if (replacementPage && !replacementPage.isClosed()) await replacementPage.close();
    await context.close();
  }
});

test('same-tab zero-input reload replays two completed production actions after native lock handoff', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the F5 production authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      activeOnlineLease: true,
      completedActionCount: 2,
      completedHitActions: false,
    }));
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    expect(Object.values(fixture.messages).filter(packet => packet.t === 'fire')).toHaveLength(2);
    expect(Object.values(fixture.messages).filter(packet => packet.t === 'state')).toHaveLength(2);

    await page.reload();
    await expect.poll(async () => {
      const state = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
      if (state.onlinePhase === 'playing') return 'playing';
      const terminalError = state.trace.find(entry => entry.phase === 'error'
        && ['replayFirebaseBattleRecoveryPlan', 'activatePendingFirebaseBattleReentry'].includes(entry.name));
      return terminalError?.detail?.code || null;
    }, { timeout: 15000 }).toBeTruthy();
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored.onlinePhase, JSON.stringify(restored, null, 2)).toBe('playing');
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 'e1', currentRoundId: ROUND_ID, localUnitId: 'e1',
      localCharacter: 'iwa', credentialPresent: true, pageErrors: [],
    });
    expect(restored.trace.some(entry => entry.name === 'restoreFirebaseBattleReplayRollback' && entry.phase === 'error')).toBe(false);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('zero-input reload retries a transient canonical history read without losing its active guest identity', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0, recoveryMessageFailuresRemaining: 1 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      activeOnlineLease: true, completedActionCount: 2,
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase,
      { timeout: 15000 }).toBe('playing');
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 'e1', currentRoundId: ROUND_ID, localUnitId: 'e1',
      localCharacter: 'iwa', credentialPresent: true, pageErrors: [],
    });
    expect(fixture.recoveryMessageFailuresRemaining).toBe(0);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('permission failure remains terminal without replacing or deleting the existing identity', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = {
    room: null, messages: null, authSignUpCount: 0,
    recoveryMessageFailuresRemaining: 1, recoveryMessageFailureStatus: 401,
  };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      activeOnlineLease: true, completedActionCount: 2,
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).reentryFailureCode,
      { timeout: 10000 }).toBe('FIREBASE_REQUEST_UNAUTHORIZED');
    await page.waitForTimeout(1500);
    const stopped = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(stopped).toMatchObject({
      onlineKind: null, onlinePhase: null, credentialPresent: true,
      reentryFailureCode: 'FIREBASE_REQUEST_UNAUTHORIZED', pageErrors: [],
    });
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('host zero-input reload retries a transient history read and retains p1 authority', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = {
    room: null, messages: null, authSignUpCount: 0, reentryUid: HOST_UID,
    recoveryMessageFailuresRemaining: 1,
  };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      reentrySeat: 'p1', activeOnlineLease: true, completedActionCount: 2,
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    fixture.reentryUid = seeded.reentryUid;
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 'p1', currentRoundId: ROUND_ID, localUnitId: 'p1',
      localCharacter: 'kyoryu', credentialPresent: true, pageErrors: [],
    });
    expect(restored.trace.some(entry => entry.name === 'resumeSuspendedMatch')).toBe(false);
    expect(fixture.recoveryMessageFailuresRemaining).toBe(0);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('results reload retries a transient history read and restores a verified concede result once', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0, recoveryMessageFailuresRemaining: 1 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      holdReentryLease: true, resultMode: 'concede',
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('results');
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      onlineKind: 'firebase', onlinePhase: 'results', onlineSeat: 'e1',
      currentRoundId: ROUND_ID, localUnitId: 'e1', localCharacter: 'iwa',
      matchOver: true, winner: 'cpu', resultSent: true,
      credentialPresent: true, pageErrors: [],
    });
    expect(restored.trace.some(entry => entry.name === 'resumeSuspendedMatch')).toBe(false);
    expect(fixture.recoveryMessageFailuresRemaining).toBe(0);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('Gear ON reload retries a transient history read and restores the verified manifest runtime', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = { room: null, messages: null, authSignUpCount: 0, recoveryMessageFailuresRemaining: 1 };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      activeOnlineLease: true, gear: true,
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase,
      { timeout: 15000 }).toBe('playing');
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 'e1', currentRoundId: ROUND_ID, localUnitId: 'e1',
      localCharacter: 'iwa', credentialPresent: true, pageErrors: [],
      gearEnabled: true, verifiedGearManifest: true, gearSnapshotUnits: ['e1', 'p1'],
    });
    expect(Object.keys(restored.gearShieldByUnit || {}).sort()).toEqual(['e1', 'p1']);
    expect(Object.keys(restored.gearRuntimeByUnit || {}).sort()).toEqual(['e1', 'p1']);
    expect(fixture.recoveryMessageFailuresRemaining).toBe(0);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('2v2 support zero-input reload retries a transient history read and restores s1 only as p2', async ({ browser }) => {
  test.skip(test.info().project.name.startsWith('iphone-webkit'), 'Chromium Web Locks are the reconnect authority.');
  const fixture = {
    room: null, messages: null, authSignUpCount: 0, reentryUid: SUPPORT1_UID,
    recoveryMessageFailuresRemaining: 1,
  };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await installF4Bridge(context, fixture);
  const page = await context.newPage();
  try {
    await page.goto(GAME_URL);
    await expect.poll(() => page.evaluate(() => typeof globalThis.KatamonF4StartupBridge)).toBe('object');
    const seeded = await page.evaluate(() => globalThis.KatamonF4StartupBridge.seed({
      format: '2v2', reentrySeat: 's1', activeOnlineLease: true,
    }));
    fixture.room = seeded.room;
    fixture.messages = seeded.messages;
    fixture.reentryUid = seeded.reentryUid;
    expect(seeded.validation.every(entry => entry.result.ok), JSON.stringify(seeded.validation, null, 2)).toBe(true);

    await page.reload();
    await expect.poll(async () => (await page.evaluate(() => globalThis.KatamonF4StartupBridge.state())).onlinePhase, { timeout: 15000 }).toBe('playing');
    const restored = await page.evaluate(() => globalThis.KatamonF4StartupBridge.state());
    expect(restored, JSON.stringify(restored, null, 2)).toMatchObject({
      gamePhase: 'battle', onlineKind: 'firebase', onlinePhase: 'playing',
      onlineSeat: 's1', currentRoundId: ROUND_ID, localUnitId: 'p2',
      localCharacter: 'medama', credentialPresent: true, pageErrors: [],
    });
    expect(restored.trace.some(entry => entry.name === 'resumeSuspendedMatch')).toBe(false);
    expect(fixture.recoveryMessageFailuresRemaining).toBe(0);
    expect(fixture.authSignUpCount).toBe(0);
  } finally {
    await context.close();
  }
});
