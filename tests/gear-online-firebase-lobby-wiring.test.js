const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../shared/gear-domain.js');
const gearStorage = require('../shared/gear-storage.js');
const presets = require('../shared/gear-presets.js');
const presetStorage = require('../shared/gear-preset-storage.js');
const battleSnapshot = require('../shared/gear-battle-snapshot.js');
const protocol = require('../shared/gear-online-protocol.js');
const lobby = require('../shared/gear-online-lobby-protocol.js');
const wire = require('../shared/gear-online-firebase-wire.js');
const harness = require('./seatharness.js');

const kt = harness.kt();
const h = kt.stage3();
const wiring = h.firebaseGearLobbyForTest();
const characterIds = wiring.characterIds();
const roundId = '0123456789abcdef0123456789abcdef0123456789abcdef';
const slotIds = ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary'];
const gearMode = protocol.GEAR_MODE_PRIVATE_TRUSTED_V1;
const capability = lobby.createRoomGearCapability({ visibility: 'private', gearMode });
let passed = 0;
const cases = [];
const test = (name, fn) => { cases.push([name, fn]); };

function settings({ revision = 1, format = '2v2', gear = false } = {}) {
  const value = { terrain: 'random', wind: 'random', turnsPerPlayer: 15, format, stageSize: 'standard', revision };
  if (gear) value.gearCapability = capability;
  return value;
}

function room({ visibility = 'private', revision = 1, format = '2v2', gear = false, occupied = ['p1', 'e1'] } = {}) {
  const slots = { p1: null, e1: null, s1: null, s2: null };
  for (const seat of occupied) slots[seat] = { uid: `uid-${seat}`, claimedAt: 1, ...(seat === 'p1' ? {} : { seenAt: 1 }) };
  const value = {
    protocol: 3,
    hostUid: 'uid-p1',
    settings: settings({ revision, format, gear }),
    slots,
    round: { id: roundId, status: 'lobby', players: { p1: 'uid-p1', e1: occupied.includes('e1') ? 'uid-e1' : null } }
  };
  if (visibility !== null) value.visibility = visibility;
  return value;
}

function onlineFixture(roomValue, { seat = 'p1', role = seat === 'p1' ? 'host' : 'guest', sent = [] } = {}) {
  const persisted = wiring.inspectPersistedRoom(roomValue);
  const uid = persisted.slots[seat] && persisted.slots[seat].uid;
  return {
    kind: 'firebase', role, participantRole: persisted.settings.format === '2v2' || ['p1', 'e1'].includes(seat) ? 'player' : 'spectator',
    phase: 'lobby', room: 'A2BC3DEF', auth: { uid, idToken: 'test-token' }, clientId: uid,
    seat, peerSeat: seat === 'p1' ? 'e1' : 'p1', currentRoundId: roundId,
    visibility: persisted.visibility, settings: persisted.settings, slots: persisted.slots,
    acceptedSettingsRevision: persisted.settings.revision, acceptedSettingsIdentity: persisted.settingsIdentity,
    persistedRosterIdentity: persisted.rosterIdentity, settingsAuthorityBlocked: false,
    settingsRefreshPromise: null, settingsRefreshBroadcastRequested: false, settingsWritePending: false,
    readyCapturePending: false, readyCaptureGeneration: 0,
    gearRevealCompatibility: { visibleMs: 0, checkedAt: 0 },
    selfCharacter: 'kyoryu', selfNonce: null, selfCommit: null, selfReady: false, selfRevealed: false,
    selfRevealSending: false, selfGearCapture: null, participantGearReveals: {}, verifiedStartGearManifest: null,
    peerCommit: null, peerCommitAt: null, peerCommitted: false, peerReady: false, peerRevealSeen: false,
    peerCharacter: null, peerNonce: null, revealVerified: false, protocolError: '',
    seatReady: {}, seatCommit: {}, seatCommitAt: {}, seatRevealSeen: {}, seatCharacter: {}, seatNonce: {}, seatVerified: {},
    startAcks: {}, rematchVotes: {}, pendingStart: null, startVerifying: false, matchStarted: false,
    seatNames: {}, seatRivalIds: {}, seatSeen: {}, seatStale: {}, seatReleaseReady: {},
    queue: [], log: [], retryTimer: 0, quickWaiting: false, quickListed: false,
    pendingRemoteTerminals: new Map(), completedRemoteActions: new Map(), remoteAction: null, localAction: null,
    lobbyLiveness: { clockMs: 0, pingVisibleMs: 0, checkedAt: 0 },
    peerLiveness: { peerVisibleMs: 0, pingVisibleMs: 0, checkedAt: 0 },
    transport: { send: async (packet) => { sent.push(structuredClone(packet)); return true; } }
  };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) };
}

function installRoomFetch(holder, getSequence = null) {
  const calls = [];
  const sequence = Array.isArray(getSequence) ? getSequence.slice() : null;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, body: options.body || null });
    if (method === 'PUT' && String(url).includes('/settings.json')) {
      holder.room.settings = JSON.parse(options.body);
      return jsonResponse(holder.room.settings);
    }
    if (method === 'GET') {
      const value = sequence && sequence.length ? sequence.shift() : holder.room;
      return jsonResponse(value);
    }
    return jsonResponse(options.body ? JSON.parse(options.body) : null);
  };
  return calls;
}

function makeGear(gearId, slotId = 'barrel') {
  return domain.createGear({
    gearId,
    generationSeed: `generation:${gearId}`,
    enhancementSeed: `enhancement:${gearId}`,
    sourceId: 'coop_boss',
    sourceDetail: { difficulty: 'normal' },
    acquiredAt: '2026-08-27T00:00:00Z',
    qualityProfile: { id: 'test-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'normal', weight: 1 }] },
    setProfile: { id: 'test-set', setWeights: [{ id: 'assault', weight: 1 }] },
    slotId,
    setId: 'assault'
  });
}

function saveGearState({ inventory = [], tempBox = [], unclaimedRewards = [] } = {}) {
  gearStorage.saveGearState({
    storageSchemaVersion: 2,
    inventory: inventory.map((gear) => ({ gear, locked: false, favorite: false })),
    tempBox,
    unclaimedRewards,
    rewardLedger: {},
    resources: { powder: 999, blueprintShards: 0 }
  }, localStorage);
}

function savePreset(characterId = 'kyoryu', gearId = null, presetId = 'preset1') {
  let state = presets.createInitialState(characterIds);
  state = presets.setPresetSlot(state, {
    characterId, presetId, slotId: 'barrel', gearId, characterIds
  });
  state = presets.setModeDefault(state, {
    characterId, mode: 'online', presetId, characterIds
  });
  presetStorage.save(state, localStorage, { characterIds });
}

function seedEquipped(gear = makeGear('online-barrel')) {
  saveGearState({ inventory: [gear] });
  savePreset('kyoryu', gear.gearId);
  return gear;
}

function canonicalLoadout(characterId, item = null, presetId = 'preset1') {
  const slots = Object.fromEntries(slotIds.map((slot) => [slot, null]));
  if (item) slots[item.slotId] = item;
  return { characterId, presetId, gearIds: item ? [item.gearId] : [], slots };
}

function revealEntry(seat, characterId = 'kyoryu', item = null, presetId = 'preset1', contextOverride = null) {
  const trustedContext = contextOverride || wiring.trustedContext(seat, characterId);
  const snapshot = battleSnapshot.createBattleGearSnapshot({
    resolvedLoadout: canonicalLoadout(characterId, item, presetId),
    baseHp: trustedContext.baseHp,
    baseFuel: trustedContext.baseFuel
  });
  const revealedCommitment = protocol.createLoadoutCommitment({
    battleGearSnapshot: snapshot,
    roundId: trustedContext.expectedRoundId,
    trustedContext
  });
  const readyBinding = lobby.createReadyGearBinding({ loadoutCommitment: revealedCommitment, trustedContext });
  const bindingText = lobby.stableSerializeReadyGearBinding(readyBinding);
  return { trustedContext, revealedCommitment, readyBinding, bindingText };
}

function verifiedReveal(entry) {
  return Object.freeze({
    trustedContext: entry.trustedContext,
    revealedCommitment: entry.revealedCommitment
  });
}

async function revealMessage(entry, nonce = 'a'.repeat(48)) {
  return {
    v: 3,
    from: entry.trustedContext.expectedOwnerUid,
    seat: entry.trustedContext.expectedSeatId,
    roundId,
    sentAt: Date.now(),
    t: 'reveal',
    character: entry.trustedContext.expectedCharacterId,
    nonce,
    gearWireVersion: wire.ONLINE_GEAR_FIREBASE_WIRE_VERSION,
    gearCommitmentJson: wire.encodeRevealGearCommitment({
      loadoutCommitment: entry.revealedCommitment,
      trustedContext: entry.trustedContext
    })
  };
}

test('persisted visibility/capability accepts only private Gear and keeps legacy Gear OFF', async () => {
  assert.equal(wiring.inspectPersistedRoom(room({ visibility: 'public', gear: false })).settings.gearCapability, undefined);
  assert.equal(wiring.inspectPersistedRoom(room({ visibility: 'private', gear: true })).settings.gearCapability.gearMode, gearMode);
  assert.equal(wiring.inspectPersistedRoom(room({ visibility: null, gear: false })).visibility, null);
  assert.throws(() => wiring.inspectPersistedRoom(room({ visibility: 'public', gear: true })),
    (error) => error && error.code === 'PUBLIC_ROOM_GEAR_NOT_ALLOWED');
  assert.throws(() => wiring.inspectPersistedRoom(room({ visibility: null, gear: true })), /legacy room/);
});

test('Gear mode UI is editable only by a private host and remains visible to every participant', async () => {
  const privateOn = room({ visibility: 'private', gear: true });
  h.setOnlineForLogTest(onlineFixture(privateOn));
  assert.deepEqual(wiring.renderGearMode(), {
    value: gearMode, disabled: false,
    status: 'Gear ON：信頼できる非公開対戦。全員の装備をREADY時に固定します', enabled: 'true'
  });
  h.setOnlineForLogTest(onlineFixture(privateOn, { seat: 'e1', role: 'guest' }));
  assert.equal(wiring.renderGearMode().disabled, true);
  const publicOff = room({ visibility: 'public', gear: false });
  h.setOnlineForLogTest(onlineFixture(publicOff));
  const publicUi = wiring.renderGearMode();
  assert.equal(publicUi.disabled, true);
  assert.match(publicUi.status, /公開部屋ではGearを使用できません/);
});

test('client update path rejects public/non-host Gear ON and persists the exact private capability', async () => {
  const publicHolder = { room: room({ visibility: 'public', gear: false }) };
  const publicSent = [];
  h.setOnlineForLogTest(onlineFixture(publicHolder.room, { sent: publicSent }));
  const publicCalls = installRoomFetch(publicHolder);
  assert.equal(await wiring.updateSettings({ requestedGearMode: gearMode }), false);
  assert.equal(publicCalls.some((call) => call.method === 'PUT'), false);

  const guestHolder = { room: room({ visibility: 'private', gear: false }) };
  h.setOnlineForLogTest(onlineFixture(guestHolder.room, { seat: 'e1', role: 'guest' }));
  installRoomFetch(guestHolder);
  assert.equal(await wiring.updateSettings({ requestedGearMode: gearMode }), false);

  const privateHolder = { room: room({ visibility: 'private', gear: false }) };
  const sent = [];
  h.setOnlineForLogTest(onlineFixture(privateHolder.room, { sent }));
  const privateCalls = installRoomFetch(privateHolder);
  assert.equal(await wiring.updateSettings({ requestedGearMode: gearMode }), true);
  assert.deepEqual(privateHolder.room.settings.gearCapability, capability);
  assert.equal(privateHolder.room.settings.revision, 2);
  assert.equal(privateCalls.filter((call) => call.method === 'PUT').length, 1);
  assert.equal(sent.some((packet) => packet.t === 'settings' && packet.settings.gearCapability.gearMode === gearMode), true);
});

test('settings writer latch is acquired before authority refresh so rapid conflicting changes cannot share a revision', async () => {
  const holder = { room: room({ visibility: 'private', gear: false }) };
  h.setOnlineForLogTest(onlineFixture(holder.room));
  const calls = [];
  let announceGet;
  let releaseGet;
  const getStarted = new Promise((resolve) => { announceGet = resolve; });
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, body: options.body || null });
    if (method === 'GET') {
      announceGet();
      await getGate;
      return jsonResponse(holder.room);
    }
    if (method === 'PUT' && String(url).includes('/settings.json')) {
      holder.room.settings = JSON.parse(options.body);
      return jsonResponse(holder.room.settings);
    }
    return jsonResponse(null);
  };
  const first = wiring.updateSettings({ requestedGearMode: gearMode });
  await getStarted;
  const second = await wiring.updateSettings({ requestedGearMode: protocol.GEAR_MODE_OFF });
  assert.equal(second, false);
  releaseGet();
  assert.equal(await first, true);
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
  assert.equal(holder.room.settings.revision, 2);
  assert.deepEqual(holder.room.settings.gearCapability, capability);
});

test('settings writer cannot report success into a replacement session after its broadcast awaits', async () => {
  const holder = { room: room({ visibility: 'private', gear: false }) };
  const firstFixture = onlineFixture(holder.room);
  let announceSend;
  let releaseSend;
  const sendStarted = new Promise((resolve) => { announceSend = resolve; });
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  firstFixture.transport.send = async (packet) => {
    if (packet.t === 'settings') {
      announceSend();
      await sendGate;
    }
    return true;
  };
  h.setOnlineForLogTest(firstFixture);
  installRoomFetch(holder);
  const updating = wiring.updateSettings({ requestedGearMode: gearMode });
  await sendStarted;
  const replacement = onlineFixture(room({ visibility: 'private', gear: false }));
  h.setOnlineForLogTest(replacement);
  releaseSend();
  assert.equal(await updating, false);
  const replacementState = wiring.state();
  assert.equal(replacementState.settingsAuthorityBlocked, false);
  assert.equal(replacementState.protocolError, '');
});

test('settings messages are hints: persisted conflict clears READY, refetches, and fails closed', async () => {
  const persistedOff = room({ visibility: 'private', gear: false, revision: 1 });
  const holder = { room: persistedOff };
  const fixture = onlineFixture(persistedOff);
  fixture.selfReady = true;
  fixture.selfCommit = 'f'.repeat(64);
  h.setOnlineForLogTest(fixture);
  const calls = installRoomFetch(holder);
  const hintedOn = settings({ revision: 2, gear: true });
  assert.equal(await wiring.handleSettingsHint(hintedOn), false);
  const state = wiring.state();
  assert.equal(state.settings.gearCapability, undefined);
  assert.equal(state.selfReady, false);
  assert.equal(state.settingsAuthorityBlocked, true);
  assert.equal(calls.filter((call) => call.method === 'GET').length, 1);
});

test('persisted settings revision is monotonic and same-revision contradictions fail closed', async () => {
  const initial = room({ visibility: 'private', gear: false, revision: 1 });
  const fixture = onlineFixture(initial);
  h.setOnlineForLogTest(fixture);
  const newer = room({ visibility: 'private', gear: true, revision: 2 });
  assert.equal(wiring.applyPersistedRoom(newer), true);
  assert.equal(wiring.gearEnabled(), true);
  assert.throws(() => wiring.applyPersistedRoom(initial), /巻き戻/);
  const contradictory = room({ visibility: 'private', gear: false, revision: 2 });
  assert.throws(() => wiring.applyPersistedRoom(contradictory), /同じsettings revision/);
  assert.equal(wiring.gearEnabled(), true);
});

test('delayed lower-revision settings hint is ignored without refetch or rollback', async () => {
  const initial = room({ visibility: 'private', gear: false, revision: 1 });
  h.setOnlineForLogTest(onlineFixture(initial));
  assert.equal(wiring.applyPersistedRoom(room({ visibility: 'private', gear: true, revision: 2 })), true);
  const holder = { room: initial };
  const calls = installRoomFetch(holder);
  assert.equal(await wiring.handleSettingsHint(initial.settings), true);
  assert.equal(calls.length, 0);
  assert.equal(wiring.state().acceptedSettingsRevision, 2);
  assert.equal(wiring.gearEnabled(), true);
});

test('persisted settings mutation after match start fails closed instead of changing Gear authority', async () => {
  const initial = room({ visibility: 'private', gear: true, revision: 1 });
  const fixture = onlineFixture(initial);
  fixture.phase = 'playing';
  h.setOnlineForLogTest(fixture);
  assert.throws(() => wiring.applyPersistedRoom(room({ visibility: 'private', gear: false, revision: 2 })),
    /対戦開始後にFirebase settings authority/);
  assert.equal(wiring.state().acceptedSettingsRevision, 1);
  assert.equal(wiring.gearEnabled(), true);
});

test('persisted capability and roster changes both invalidate READY', async () => {
  const initial = room({ visibility: 'private', gear: true, revision: 1, occupied: ['p1', 'e1'] });
  const fixture = onlineFixture(initial);
  fixture.selfReady = true;
  fixture.selfCommit = 'f'.repeat(64);
  h.setOnlineForLogTest(fixture);
  assert.equal(wiring.applyPersistedRoom(room({ visibility: 'private', gear: false, revision: 2, occupied: ['p1', 'e1'] })), true);
  assert.equal(wiring.state().selfReady, false);

  const rosterBase = room({ visibility: 'private', gear: true, revision: 1, occupied: ['p1', 'e1'] });
  const rosterFixture = onlineFixture(rosterBase);
  rosterFixture.selfReady = true;
  rosterFixture.selfCommit = 'e'.repeat(64);
  h.setOnlineForLogTest(rosterFixture);
  const rosterChanged = structuredClone(rosterBase);
  rosterChanged.slots.e1.uid = 'uid-replacement';
  assert.equal(wiring.applyPersistedRoom(rosterChanged), true);
  assert.equal(wiring.state().selfReady, false);
});

test('Gearless READY creates a full commitment while the wire keeps one opaque SHA-256 hash', async () => {
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  const sent = [];
  const fixture = onlineFixture(roomValue, { sent });
  h.setOnlineForLogTest(fixture);
  installRoomFetch(holder);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  const state = wiring.state();
  assert.equal(state.selfReady, true);
  assert.equal(state.selfGearCapture.loadoutCommitment.canonicalLoadout.presetId, 'preset1');
  assert.equal(Object.values(state.selfGearCapture.loadoutCommitment.canonicalLoadout.slots).every((value) => value === null), true);
  const commit = sent.find((packet) => packet.t === 'commit');
  // Harness transport records the packet before makeFirebaseTransport adds server sentAt.
  assert.deepEqual(Object.keys(commit).sort(), ['from', 'hash', 'roundId', 'seat', 't', 'v'].sort());
  assert.equal(commit.hash, await wiring.commitPayload('kyoryu', state.selfNonce, state.selfGearCapture.readyGearBindingText));
  assert.notEqual(commit.hash, await wiring.commitPayload('kyoryu', state.selfNonce));
  assert.equal(JSON.stringify(commit).includes('loadoutHash'), false);
});

test('equipped READY reuses Battle Snapshot/commitment/binding without leaking private Gear fields', async () => {
  seedEquipped();
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  const sent = [];
  h.setOnlineForLogTest(onlineFixture(roomValue, { sent }));
  installRoomFetch(holder);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  const capture = wiring.state().selfGearCapture;
  assert.equal(capture.battleGearSnapshot.slots.barrel.gearId, 'online-barrel');
  assert.equal(capture.loadoutCommitment.canonicalLoadout.slots.barrel.gearId, 'online-barrel');
  assert.equal(capture.readyGearBinding.loadoutHash, capture.loadoutCommitment.loadoutHash);
  const readyPacket = sent.find((packet) => packet.t === 'ready' && packet.value === true);
  for (const key of ['loadoutHash', 'canonicalLoadout', 'gearCommitmentJson', 'readyGearBinding']) {
    assert.equal(Object.prototype.hasOwnProperty.call(readyPacket, key), false, key);
  }
});

test('READY capture fails closed for stale, TEMP, unclaimed, wrong-slot, duplicate and WAL Gear', async () => {
  const roomValue = room({ visibility: 'private', gear: true });
  h.setOnlineForLogTest(onlineFixture(roomValue));
  const item = makeGear('blocked-item');
  const cases = [
    ['stale', () => { saveGearState(); savePreset('kyoryu', item.gearId); }, 'GEAR_PRESET_MISSING_GEAR'],
    ['TEMP', () => { saveGearState({ tempBox: [{ gear: item, locked: false, favorite: false, enteredAtMs: 1 }] }); savePreset('kyoryu', item.gearId); }, 'GEAR_PRESET_MISSING_GEAR'],
    ['unclaimed', () => { saveGearState({ unclaimedRewards: [{ rewardId: 'r1', sourceId: 'coop_boss', sourceDetail: { difficulty: 'normal' }, blueprintShards: 0, createdAtMs: 1, gears: [item] }] }); savePreset('kyoryu', item.gearId); }, 'GEAR_PRESET_MISSING_GEAR'],
    ['wrong slot', () => { const wrong = makeGear(item.gearId, 'armor'); saveGearState({ inventory: [wrong] }); savePreset('kyoryu', wrong.gearId); }, 'GEAR_PRESET_SLOT_MISMATCH'],
    ['duplicate', () => {
      saveGearState({ inventory: [item] });
      let state = presets.setPresetSlot(presets.createInitialState(characterIds), {
        characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: item.gearId, characterIds
      });
      state = structuredClone(state);
      state.characters.kyoryu.presets[0].slots.armor = item.gearId;
      localStorage.setItem(presetStorage.STORAGE_KEY, JSON.stringify(state));
    }, 'DUPLICATE_GEAR_ID_IN_PRESET'],
    ['WAL', () => { saveGearState({ inventory: [item] }); savePreset('kyoryu', item.gearId); localStorage.setItem(presetStorage.WAL_KEY, '{}'); }, 'PENDING_GEAR_TRANSACTION_EXISTS']
  ];
  for (const [name, seed, code] of cases) {
    localStorage.clear();
    seed();
    await assert.rejects(() => wiring.captureReady('kyoryu'), (error) => error && error.code === code, name);
  }
});

test('READY authority is re-fetched around capture so a revision race sends no commit', async () => {
  seedEquipped();
  const first = room({ visibility: 'private', gear: true, revision: 1 });
  const second = room({ visibility: 'private', gear: true, revision: 2 });
  const holder = { room: second };
  const sent = [];
  h.setOnlineForLogTest(onlineFixture(first, { sent }));
  installRoomFetch(holder, [first, second]);
  assert.equal(await wiring.commitReady('kyoryu'), false);
  assert.equal(sent.some((packet) => packet.t === 'commit' || (packet.t === 'ready' && packet.value === true)), false);
  assert.equal(wiring.state().selfReady, false);
});

test('READY capture latch rejects double tap and character mutation cancels the stale operation', async () => {
  seedEquipped();
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  const sent = [];
  h.setOnlineForLogTest(onlineFixture(roomValue, { sent }));
  installRoomFetch(holder);
  let releaseLock;
  let announceLock;
  const lockRequested = new Promise((resolve) => { announceLock = resolve; });
  const originalManager = localStorage.gearMutationLockManager;
  localStorage.gearMutationLockManager = {
    request: (name, options, callback) => new Promise((resolve, reject) => {
      releaseLock = () => Promise.resolve(callback({ name, options })).then(resolve, reject);
      announceLock();
    })
  };
  try {
    const first = wiring.commitReady('kyoryu');
    await lockRequested;
    assert.equal(wiring.state().readyCapturePending, true);
    assert.equal(await wiring.commitReady('kyoryu'), false);
    wiring.changeCharacter('medama');
    assert.equal(wiring.state().readyCapturePending, false);
    await releaseLock();
    assert.equal(await first, false);
    assert.equal(sent.some((packet) => packet.t === 'commit' || (packet.t === 'ready' && packet.value === true)), false);
    assert.equal(wiring.state().selfReady, false);
  } finally {
    localStorage.gearMutationLockManager = originalManager;
  }
});

test('Gear/preset/enhancement and character mutation invalidate the captured READY binding', async () => {
  const original = seedEquipped();
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  const fixture = onlineFixture(roomValue);
  h.setOnlineForLogTest(fixture);
  installRoomFetch(holder);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  saveGearState({ inventory: [domain.enhanceGear(original, 1)] });
  assert.equal(wiring.pollReadyStorage(), true);
  assert.equal(wiring.state().selfReady, false);

  saveGearState({ inventory: [original] });
  savePreset('kyoryu', original.gearId);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  savePreset('kyoryu', null);
  assert.equal(await wiring.ensureReadyCurrent(), false);

  savePreset('kyoryu', original.gearId);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  wiring.changeCharacter('medama');
  assert.equal(wiring.state().selfReady, false);
});

test('WAL/storage-clear notification immediately removes READY before reveal', async () => {
  seedEquipped();
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  h.setOnlineForLogTest(onlineFixture(roomValue));
  installRoomFetch(holder);
  assert.equal(await wiring.commitReady('kyoryu'), true);
  localStorage.setItem(presetStorage.WAL_KEY, '{}');
  wiring.storageMutation({ storageArea: localStorage, key: presetStorage.WAL_KEY });
  assert.equal(wiring.state().selfReady, false);
});

test('valid Gear reveal verifies nonce-sealed binding and stores only a locally verified reveal', async () => {
  const roomValue = room({ visibility: 'private', gear: true });
  const holder = { room: roomValue };
  const fixture = onlineFixture(roomValue);
  h.setOnlineForLogTest(fixture);
  installRoomFetch(holder);
  const entry = revealEntry('e1', 'kyoryu', makeGear('peer-gear'));
  const msg = await revealMessage(entry);
  fixture.seatCommit.e1 = await wiring.commitPayload(msg.character, msg.nonce, entry.bindingText);
  await wiring.verifyReveal(msg);
  const state = wiring.state();
  assert.equal(state.protocolError, '');
  assert.deepEqual(state.participantGearReveals.e1.revealedCommitment, entry.revealedCommitment);
  assert.equal(state.participantGearReveals.e1.revealedCommitment.canonicalLoadout.slots.barrel.gearId, 'peer-gear');
});

test('reveal rejects nonce/character/owner/seat/round/version/canonical/tamper violations', async () => {
  const run = async (mutate, entryFactory = () => revealEntry('e1')) => {
    const roomValue = room({ visibility: 'private', gear: true, format: '2v2', occupied: ['p1', 'e1', 's1'] });
    const holder = { room: roomValue };
    const fixture = onlineFixture(roomValue);
    h.setOnlineForLogTest(fixture);
    installRoomFetch(holder);
    const entry = entryFactory();
    const msg = await revealMessage(entry);
    fixture.seatCommit[msg.seat] = await wiring.commitPayload(msg.character, msg.nonce, entry.bindingText);
    await mutate(msg, entry, fixture);
    await wiring.verifyReveal(msg);
    assert.equal(Object.keys(wiring.state().participantGearReveals).length, 0);
    assert.notEqual(wiring.state().protocolError, '');
  };
  await run(async (msg) => { msg.nonce = 'b'.repeat(48); });
  await run(async (msg) => { msg.character = 'medama'; });
  await run(async (msg) => { msg.gearWireVersion = 2; });
  await run(async (msg) => { msg.gearCommitmentJson = ` ${msg.gearCommitmentJson}`; });
  await run(async (msg) => { msg.gearCommitmentJson = 'x'.repeat(wire.MAX_REVEAL_GEAR_JSON_CHARS + 1); });
  await run(async (msg) => {
    const parsed = JSON.parse(msg.gearCommitmentJson);
    parsed.loadoutHash = 'fnv1a64-v1:0000000000000000';
    msg.gearCommitmentJson = domain.stableStringify(parsed);
  });
  await run(async () => {}, () => {
    const actual = wiring.trustedContext('e1', 'kyoryu');
    return revealEntry('e1', 'kyoryu', null, 'preset1', { ...actual, expectedOwnerUid: 'uid-attacker' });
  });
  await run(async (msg, entry, fixture) => {
    msg.from = fixture.slots.e1.uid;
    msg.seat = 'e1';
    fixture.seatCommit.e1 = await wiring.commitPayload(msg.character, msg.nonce, entry.bindingText);
  }, () => revealEntry('s1'));
  await run(async () => {}, () => {
    const actual = wiring.trustedContext('e1', 'kyoryu');
    return revealEntry('e1', 'kyoryu', null, 'preset1', { ...actual, expectedRoundId: 'b'.repeat(48) });
  });
});

test('Gear ON rejects legacy reveal while Gear OFF preserves the exact v3 legacy flow', async () => {
  const base = { v: 3, from: 'uid-e1', seat: 'e1', roundId, sentAt: Date.now(), t: 'reveal', character: 'kyoryu', nonce: 'a'.repeat(48) };
  const onRoom = room({ visibility: 'private', gear: true });
  h.setOnlineForLogTest(onlineFixture(onRoom));
  assert.equal(h.validateFirebaseMessage(base), false);

  const offRoom = room({ visibility: 'public', gear: false });
  const offFixture = onlineFixture(offRoom);
  h.setOnlineForLogTest(offFixture);
  assert.equal(h.validateFirebaseMessage(base), true);
  offFixture.seatCommit.e1 = await wiring.commitPayload('kyoryu', base.nonce);
  await wiring.verifyReveal(base);
  assert.equal(offFixture.seatVerified.e1, true);
});

test('old-round legacy history is discarded before current Gear-mode validation', async () => {
  const onRoom = room({ visibility: 'private', gear: true });
  const fixture = onlineFixture(onRoom);
  h.setOnlineForLogTest(fixture);
  h.receiveFirebaseForTest({
    v: 3, from: 'uid-e1', seat: 'e1', roundId: 'f'.repeat(48), sentAt: Date.now(),
    t: 'reveal', character: 'kyoryu', nonce: 'a'.repeat(48)
  });
  assert.equal(wiring.state().protocolError, '');
  assert.equal(Object.keys(wiring.state().participantGearReveals).length, 0);
});

test('Gear ON reveal wait ends with an explicit mixed-client compatibility error', async () => {
  const onRoom = room({ visibility: 'private', gear: true });
  const fixture = onlineFixture(onRoom);
  fixture.phase = 'revealing';
  fixture.selfRevealed = true;
  h.setOnlineForLogTest(fixture);
  assert.equal(wiring.expireRevealCompatibility(), true);
  assert.match(wiring.state().protocolError, /Gear ONに対応していない参加者/);
});

test('Gear OFF accepts legacy start while Gear ON requires exact versioned manifest fields', async () => {
  kt.startBattle('kyoryu');
  const snap = kt.snapshot();
  const base = { v: 3, from: 'uid-p1', seat: 'p1', roundId, sentAt: Date.now(), t: 'start', snap };
  h.setOnlineForLogTest(onlineFixture(room({ visibility: 'public', format: '1v1', gear: false }), { seat: 'e1', role: 'guest' }));
  assert.equal(h.validateFirebaseMessage(base), true);
  h.setOnlineForLogTest(onlineFixture(room({ visibility: 'private', format: '1v1', gear: true }), { seat: 'e1', role: 'guest' }));
  assert.equal(h.validateFirebaseMessage(base), false);
  assert.equal(h.validateFirebaseMessage({ ...base, gearWireVersion: 2, gearManifestJson: '{}' }), false);
});

test('Gear wire fields on Gear OFF are re-fetched against persisted authority then rejected', async () => {
  const offRoom = room({ visibility: 'private', gear: false });
  const holder = { room: offRoom };
  const fixture = onlineFixture(offRoom);
  h.setOnlineForLogTest(fixture);
  installRoomFetch(holder);
  const context = wiring.trustedContext('e1', 'kyoryu');
  const entry = revealEntry('e1');
  const msg = await revealMessage(entry);
  fixture.seatCommit.e1 = await wiring.commitPayload(msg.character, msg.nonce);
  assert.equal(h.validateFirebaseMessage(msg), true); // persisted再確認へ渡す正規envelope
  await wiring.verifyReveal(msg);
  assert.equal(wiring.state().participantGearReveals.e1, undefined);
  assert.match(wiring.state().protocolError, /Gear OFF room/);
  assert.equal(context.expectedOwnerUid, 'uid-e1');
});

test('all non-reveal/start packets reject Gear fields exactly like Firebase Rules', async () => {
  const roomValue = room({ visibility: 'private', gear: true });
  h.setOnlineForLogTest(onlineFixture(roomValue));
  const common = { v: 3, from: 'uid-e1', seat: 'e1', roundId, sentAt: Date.now(), gearWireVersion: 1 };
  assert.equal(h.validateFirebaseMessage({ ...common, t: 'commit', hash: 'a'.repeat(64) }), false);
  assert.equal(h.validateFirebaseMessage({ ...common, t: 'ready', value: true }), false);
  assert.equal(h.validateFirebaseMessage({ ...common, t: 'settings', settings: settings() }), false);
  assert.equal(h.validateFirebaseMessage({ ...common, t: 'lobbyState', status: 'lobby' }), false);
  assert.equal(h.validateFirebaseMessage({ ...common, t: 'rematchVote', vote: true }), false);
});

test('start manifest includes every human in canonical order, excludes CPU seats, and keeps Gearless humans', async () => {
  const roomValue = room({ visibility: 'private', gear: true, format: '2v2', occupied: ['p1', 'e1', 's2'] });
  const fixture = onlineFixture(roomValue);
  h.setOnlineForLogTest(fixture);
  const p1 = revealEntry('p1'); // legitimate Gearless human
  const e1 = revealEntry('e1', 'kyoryu', makeGear('e1-gear'));
  const s2 = revealEntry('s2');
  const participantReveals = [p1, e1, s2].map(verifiedReveal);
  fixture.participantGearReveals = Object.fromEntries(participantReveals.map((entry) => [entry.trustedContext.expectedSeatId, entry]));
  const envelope = wiring.buildStartEnvelope();
  const manifest = wire.decodeStartGearManifest(envelope.gearManifestJson, { participantReveals });
  assert.equal(envelope.gearWireVersion, 1);
  assert.deepEqual(manifest.commitments.map((entry) => entry.seatId), ['p1', 'e1', 's2']);
  assert.equal(manifest.commitments.some((entry) => entry.seatId === 's1'), false);
  assert.equal(Object.values(manifest.commitments[0].canonicalLoadout.slots).every((value) => value === null), true);
});

test('start manifest validation exact-binds local reveals and rejects legal Gear substitution/malformed wire', async () => {
  const roomValue = room({ visibility: 'private', gear: true, format: '1v1', occupied: ['p1', 'e1'] });
  const fixture = onlineFixture(roomValue);
  h.setOnlineForLogTest(fixture);
  const p1 = revealEntry('p1');
  const e1A = revealEntry('e1', 'kyoryu', makeGear('gear-a'));
  const verifiedA = [p1, e1A].map(verifiedReveal);
  fixture.participantGearReveals = { p1: verifiedA[0], e1: verifiedA[1] };
  const valid = wiring.buildStartEnvelope();
  const battleBefore = kt.buildSnapshotForTest();
  assert.ok(wiring.validateStartEnvelope(valid));
  assert.deepEqual(kt.buildSnapshotForTest(), battleBefore, 'manifest validation must not mutate ONLINE battle numerics');

  const e1B = revealEntry('e1', 'kyoryu', makeGear('gear-b'));
  const alternateReveals = [p1, e1B].map(verifiedReveal);
  const alternateManifest = lobby.createStartGearManifest({
    roundId,
    commitments: alternateReveals.map((entry) => entry.revealedCommitment),
    participantReveals: alternateReveals
  });
  const substituted = {
    gearWireVersion: 1,
    gearManifestJson: wire.encodeStartGearManifest({ manifest: alternateManifest, participantReveals: alternateReveals })
  };
  assert.throws(() => wiring.validateStartEnvelope(substituted), (error) => error && error.code === 'ONLINE_GEAR_REVEAL_BINDING_MISMATCH');
  assert.throws(() => wiring.validateStartEnvelope({ gearWireVersion: 1, gearManifestJson: ` ${valid.gearManifestJson}` }), (error) => error && error.code === 'NON_CANONICAL_ONLINE_GEAR_WIRE_JSON');
  assert.throws(() => wiring.validateStartEnvelope({ gearWireVersion: 1, gearManifestJson: '{broken' }), (error) => error && error.code === 'MALFORMED_ONLINE_GEAR_WIRE_JSON');
  assert.throws(() => wiring.validateStartEnvelope({ gearWireVersion: 1, gearManifestJson: 'x'.repeat(wire.MAX_START_GEAR_MANIFEST_JSON_CHARS + 1) }), (error) => error && error.code === 'ONLINE_GEAR_WIRE_PAYLOAD_TOO_LARGE');
  assert.throws(() => wiring.validateStartEnvelope({ ...valid, gearWireVersion: 2 }), /wire version/);
});

test('browser scripts/service worker load all pure modules in dependency order without changing Rules protocol', async () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
  const snapshotAt = index.indexOf('shared/gear-battle-snapshot.js');
  const protocolAt = index.indexOf('shared/gear-online-protocol.js');
  const lobbyAt = index.indexOf('shared/gear-online-lobby-protocol.js');
  const wireAt = index.indexOf('shared/gear-online-firebase-wire.js');
  const battleStartAt = index.indexOf('shared/gear-online-battle-start.js');
  const battleDamageAt = index.indexOf('shared/gear-online-battle-damage.js');
  const battleRngAt = index.indexOf('shared/gear-online-battle-rng.js');
  assert.ok(snapshotAt >= 0 && snapshotAt < protocolAt && protocolAt < lobbyAt && lobbyAt < wireAt && wireAt < battleStartAt && battleStartAt < battleDamageAt && battleDamageAt < battleRngAt);
  for (const file of ['shared/gear-online-protocol.js', 'shared/gear-online-lobby-protocol.js', 'shared/gear-online-firebase-wire.js', 'shared/gear-online-battle-start.js', 'shared/gear-online-battle-damage.js', 'shared/gear-online-battle-rng.js']) {
    assert.equal(sw.includes(`'./${file}'`), true, file);
  }
  assert.equal(rules.rules.rooms.$room.protocol['.validate'], 'newData.val() === 3');
});

test('Phase 3D-2B wire remains derived-free while 3D-3A enters through the isolated Battle-start adapter', async () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(index.includes('online.selfGearCapture.battleGearSnapshot'), false);
  assert.equal(/participantGearReveals[\s\S]{0,160}(?:applyDamage|calculateBattleGearCombat|cpuBattleGearSnapshot)/.test(index), false);
  assert.match(index, /KatamonGearOnlineBattleStart\.createOnlineGearBattleStartState/);
  assert.match(index, /KatamonGearOnlineBattleStart\.validateOnlineGearStartSnapshot/);
});

async function main() {
  for (const [name, fn] of cases) {
    localStorage.clear();
    h.setOnlineForLogTest(null);
    const originalFetch = globalThis.fetch;
    try {
      await fn();
      passed += 1;
      console.log(`  ok ${name}`);
    } finally {
      globalThis.fetch = originalFetch;
      h.setOnlineForLogTest(null);
      localStorage.clear();
    }
  }
  console.log(`gear-online-firebase-lobby-wiring: ${passed}/${cases.length} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
