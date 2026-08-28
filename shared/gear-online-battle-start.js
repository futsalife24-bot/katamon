(function initKatamonGearOnlineBattleStart(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleStart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleStart(root) {
  'use strict';

  const ONLINE_GEAR_BATTLE_START_MATCH_FORMATS = Object.freeze(['1v1', '2v2']);
  const START_UNIT_IDS_BY_FORMAT = Object.freeze({ '1v1': Object.freeze(['p1', 'e1']), '2v2': Object.freeze(['p1', 'e1', 'p2', 'e2']) });

  class GearOnlineBattleStartError extends Error {
    constructor(code, message) { super(message || code); this.name = 'GearOnlineBattleStartError'; this.code = code; }
  }
  const fail = (code, message) => { throw new GearOnlineBattleStartError(code, message); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const exact = (value, keys, code) => {
    if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'unknown or missing fields');
  };
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };

  function onlineProtocol() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-online-protocol.js');
    if (root?.KatamonGearOnlineProtocol) return root.KatamonGearOnlineProtocol;
    fail('ONLINE_GEAR_PROTOCOL_UNAVAILABLE');
  }
  function lobbyProtocol() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-online-lobby-protocol.js');
    if (root?.KatamonGearOnlineLobbyProtocol) return root.KatamonGearOnlineLobbyProtocol;
    fail('ONLINE_GEAR_LOBBY_PROTOCOL_UNAVAILABLE');
  }
  function gearPresets() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-presets.js');
    if (root?.KatamonGearPresets) return root.KatamonGearPresets;
    fail('ONLINE_GEAR_PRESETS_UNAVAILABLE');
  }

  function assertNoSameOwnerGearConflicts(manifest, snapshotsByUnit) {
    const presets = gearPresets();
    const loadoutsByOwner = new Map();
    manifest.commitments.forEach((commitment) => {
      const snapshot = snapshotsByUnit[commitment.unitId];
      const gearIds = presets.SLOT_IDS
        .map(slotId => snapshot?.slots?.[slotId])
        .filter(gear => gear !== null)
        .map(gear => gear?.gearId);
      const loadout = {
        characterId: snapshot?.characterId,
        presetId: snapshot?.presetId,
        gearIds
      };
      const ownerLoadouts = loadoutsByOwner.get(commitment.ownerUid) || [];
      ownerLoadouts.push(loadout);
      loadoutsByOwner.set(commitment.ownerUid, ownerLoadouts);
    });
    for (const ownerLoadouts of loadoutsByOwner.values()) {
      try {
        presets.assertNoSimultaneousGearConflicts(ownerLoadouts);
      } catch (error) {
        if (error?.code !== 'SIMULTANEOUS_GEAR_CONFLICT') throw error;
        const wrapped = new GearOnlineBattleStartError(
          'ONLINE_GEAR_2V2_SAME_OWNER_GEAR_CONFLICT',
          error.message
        );
        wrapped.cause = error;
        wrapped.detail = error.cause;
        throw wrapped;
      }
    }
  }

  function createOnlineGearBattleStartState(input) {
    exact(input, ['manifest', 'matchFormat', 'participantReveals'], 'INVALID_ONLINE_GEAR_BATTLE_START');
    if (!ONLINE_GEAR_BATTLE_START_MATCH_FORMATS.includes(input.matchFormat)) fail('INVALID_ONLINE_GEAR_BATTLE_START');
    const manifest = lobbyProtocol().validateStartGearManifest(input.manifest, {
      participantReveals: input.participantReveals
    });
    const unitIds = START_UNIT_IDS_BY_FORMAT[input.matchFormat];
    const protocol = onlineProtocol();
    const requiredSeats = Object.entries(protocol.ONLINE_GEAR_SEAT_UNIT_MAP)
      .filter(([, unitId]) => unitIds.includes(unitId)).map(([seatId]) => seatId);
    if (manifest.commitments.length !== unitIds.length || input.participantReveals.length !== unitIds.length) fail('MISSING_ONLINE_GEAR_BATTLE_REVEAL');
    const revealBySeat = new Map(input.participantReveals.map((entry) => [entry?.revealedCommitment?.seatId, entry]));
    if (revealBySeat.size !== requiredSeats.length || requiredSeats.some(seatId => !revealBySeat.has(seatId))) fail('MISSING_ONLINE_GEAR_BATTLE_REVEAL');
    const battleGearSnapshotsByUnit = {};
    const hpFuelByUnit = {};
    for (const commitment of manifest.commitments) {
      if (!unitIds.includes(commitment.unitId) || protocol.ONLINE_GEAR_SEAT_UNIT_MAP[commitment.seatId] !== commitment.unitId) {
        fail('INVALID_ONLINE_GEAR_BATTLE_PARTICIPANT');
      }
      const reveal = revealBySeat.get(commitment.seatId);
      if (!reveal) fail('MISSING_ONLINE_GEAR_BATTLE_REVEAL');
      const snapshot = onlineProtocol().reconstructBattleGearSnapshot(commitment, reveal.trustedContext);
      const derived = snapshot.derivedStats;
      battleGearSnapshotsByUnit[commitment.unitId] = snapshot;
      hpFuelByUnit[commitment.unitId] = freeze({
        character: snapshot.characterId,
        maxHp: derived.maxHp,
        hp: derived.maxHp,
        fuelMax: derived.maxFuel,
        fuel: derived.currentFuelAtBattleStart
      });
    }
    if (Object.keys(battleGearSnapshotsByUnit).sort().join(',') !== unitIds.slice().sort().join(',')) fail('MISSING_ONLINE_GEAR_BATTLE_REVEAL');
    if (input.matchFormat === '2v2') assertNoSameOwnerGearConflicts(manifest, battleGearSnapshotsByUnit);
    return freeze({
      matchFormat: input.matchFormat,
      battleGearSnapshotsByUnit,
      hpFuelByUnit
    });
  }

  function validateOnlineGearStartSnapshot(snapshot, battleStartState) {
    exact(battleStartState, ['battleGearSnapshotsByUnit', 'hpFuelByUnit', 'matchFormat'], 'INVALID_ONLINE_GEAR_BATTLE_START');
    if (!ONLINE_GEAR_BATTLE_START_MATCH_FORMATS.includes(battleStartState.matchFormat)
        || snapshot?.matchFormat !== battleStartState.matchFormat
        || !Array.isArray(snapshot?.units)) fail('INVALID_ONLINE_GEAR_START_SNAPSHOT');
    for (const [unitId, expected] of Object.entries(battleStartState.hpFuelByUnit)) {
      const unit = snapshot.units.find((entry) => entry?.id === unitId);
      if (!unit) fail('MISSING_ONLINE_GEAR_START_UNIT');
      if (unit.character !== expected.character) fail('ONLINE_GEAR_START_CHARACTER_MISMATCH');
      if (unit.maxHp !== expected.maxHp) fail('ONLINE_GEAR_START_MAX_HP_MISMATCH');
      if (unit.hp !== expected.hp) fail('ONLINE_GEAR_START_HP_MISMATCH');
      if (unit.fuelMax !== expected.fuelMax) fail('ONLINE_GEAR_START_FUEL_MAX_MISMATCH');
      if (unit.fuel !== expected.fuel) fail('ONLINE_GEAR_START_FUEL_MISMATCH');
    }
    return true;
  }

  return freeze({
    ONLINE_GEAR_BATTLE_START_MATCH_FORMATS,
    GearOnlineBattleStartError,
    createOnlineGearBattleStartState,
    validateOnlineGearStartSnapshot
  });
});
