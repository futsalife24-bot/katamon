(function initKatamonGearOnlineBattleStart(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearOnlineBattleStart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearOnlineBattleStart(root) {
  'use strict';

  const ONLINE_GEAR_BATTLE_START_MATCH_FORMAT = '1v1';
  const START_UNIT_IDS = Object.freeze(['p1', 'e1']);

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

  function createOnlineGearBattleStartState(input) {
    exact(input, ['manifest', 'matchFormat', 'participantReveals'], 'INVALID_ONLINE_GEAR_BATTLE_START');
    if (input.matchFormat !== ONLINE_GEAR_BATTLE_START_MATCH_FORMAT) {
      fail('ONLINE_GEAR_2V2_BATTLE_UNSUPPORTED', 'Gear ONのONLINE 2v2 Battleはまだ利用できません');
    }
    const manifest = lobbyProtocol().validateStartGearManifest(input.manifest, {
      participantReveals: input.participantReveals
    });
    const revealBySeat = new Map(input.participantReveals.map((entry) => [entry?.revealedCommitment?.seatId, entry]));
    const battleGearSnapshotsByUnit = {};
    const hpFuelByUnit = {};
    for (const commitment of manifest.commitments) {
      if (!START_UNIT_IDS.includes(commitment.unitId) || commitment.seatId !== commitment.unitId) {
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
    if (!Object.keys(battleGearSnapshotsByUnit).length) fail('MISSING_ONLINE_GEAR_BATTLE_REVEAL');
    return freeze({
      matchFormat: ONLINE_GEAR_BATTLE_START_MATCH_FORMAT,
      battleGearSnapshotsByUnit,
      hpFuelByUnit
    });
  }

  function validateOnlineGearStartSnapshot(snapshot, battleStartState) {
    exact(battleStartState, ['battleGearSnapshotsByUnit', 'hpFuelByUnit', 'matchFormat'], 'INVALID_ONLINE_GEAR_BATTLE_START');
    if (battleStartState.matchFormat !== ONLINE_GEAR_BATTLE_START_MATCH_FORMAT
        || snapshot?.matchFormat !== ONLINE_GEAR_BATTLE_START_MATCH_FORMAT
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
    ONLINE_GEAR_BATTLE_START_MATCH_FORMAT,
    GearOnlineBattleStartError,
    createOnlineGearBattleStartState,
    validateOnlineGearStartSnapshot
  });
});
