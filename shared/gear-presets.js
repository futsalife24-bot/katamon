(function initKatamonGearPresets(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearPresets() {
  'use strict';
  const SCHEMA_VERSION = 1;
  const PRESET_IDS = Object.freeze(['preset1', 'preset2', 'preset3']);
  const SLOT_IDS = Object.freeze(['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  const MODE_IDS = Object.freeze(['cpu', 'free', 'online', 'coop']);
  const GEAR_ID_MAX_LENGTH = 512;
  class GearPresetError extends Error { constructor(code, message, cause) { super(message || code); this.name = 'GearPresetError'; this.code = code; if (cause !== undefined) this.cause = cause; } }
  const fail = (code, message, cause) => { throw new GearPresetError(code, message, cause); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const freezeClone = (value) => deepFreeze(clone(value));
  function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
  const sameKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
  function allowedCharacters(characterIds) {
    if (!Array.isArray(characterIds) || characterIds.length === 0 || characterIds.some((id) => typeof id !== 'string' || !id || id.length > 128) || new Set(characterIds).size !== characterIds.length) fail('INVALID_CHARACTER_IDS', 'characterIds must be a non-empty unique string list');
    return new Set(characterIds);
  }
  function assertCharacter(characterId, ids) { if (typeof characterId !== 'string' || !ids.has(characterId)) fail('INVALID_CHARACTER_ID', 'characterId is not in the canonical roster'); return characterId; }
  function assertPresetId(presetId) { if (!PRESET_IDS.includes(presetId)) fail('INVALID_PRESET_ID', 'presetId is invalid'); return presetId; }
  function assertMode(mode) { if (!MODE_IDS.includes(mode)) fail('INVALID_MODE', 'mode is invalid'); return mode; }
  function assertGearId(value, path) { if (value === null) return null; if (typeof value !== 'string' || value.length < 1 || value.length > GEAR_ID_MAX_LENGTH) fail('INVALID_GEAR_ID', `${path} must be null or a non-empty gearId`); return value; }
  function emptySlots() { return Object.fromEntries(SLOT_IDS.map((slotId) => [slotId, null])); }
  function defaultPreset(presetId) { const index = PRESET_IDS.indexOf(presetId) + 1; return { presetId, name: `Preset ${index}`, slots: emptySlots() }; }
  function defaultCharacter() { return { presets: PRESET_IDS.map(defaultPreset), modeDefaults: Object.fromEntries(MODE_IDS.map((mode) => [mode, 'preset1'])) }; }
  function createInitialState(characterIds) { allowedCharacters(characterIds); return freezeClone({ schemaVersion: SCHEMA_VERSION, characters: {} }); }
  function validatePreset(raw, path) {
    if (!sameKeys(raw, ['presetId', 'name', 'slots'])) fail('INVALID_PRESET', `${path} has an invalid shape`);
    const presetId = assertPresetId(raw.presetId);
    if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 32) fail('INVALID_PRESET_NAME', `${path}.name is invalid`);
    if (!sameKeys(raw.slots, SLOT_IDS)) fail('INVALID_PRESET_SLOTS', `${path}.slots must contain exactly six slots`);
    const slots = {}; const seen = new Set();
    SLOT_IDS.forEach((slotId) => { const gearId = assertGearId(raw.slots[slotId], `${path}.slots.${slotId}`); if (gearId !== null && seen.has(gearId)) fail('DUPLICATE_GEAR_ID_IN_PRESET', `${path} repeats a physical gearId`); if (gearId !== null) seen.add(gearId); slots[slotId] = gearId; });
    return { presetId, name: raw.name, slots };
  }
  function validateCharacter(raw, path) {
    if (!sameKeys(raw, ['presets', 'modeDefaults']) || !Array.isArray(raw.presets) || raw.presets.length !== PRESET_IDS.length) fail('INVALID_CHARACTER_PRESETS', `${path} has an invalid shape`);
    const presets = raw.presets.map((preset, index) => validatePreset(preset, `${path}.presets[${index}]`));
    if (!presets.every((preset, index) => preset.presetId === PRESET_IDS[index])) fail('INVALID_PRESET_ORDER', `${path}.presets must use canonical IDs in order`);
    if (!sameKeys(raw.modeDefaults, MODE_IDS)) fail('INVALID_MODE_DEFAULTS', `${path}.modeDefaults has invalid modes`);
    const modeDefaults = {}; MODE_IDS.forEach((mode) => { modeDefaults[mode] = assertPresetId(raw.modeDefaults[mode]); });
    return { presets, modeDefaults };
  }
  function validateState(raw, options = {}) {
    const ids = allowedCharacters(options.characterIds);
    if (!sameKeys(raw, ['schemaVersion', 'characters'])) fail('INVALID_PRESET_STATE', 'preset state has an invalid shape');
    if (raw.schemaVersion !== SCHEMA_VERSION) fail(raw.schemaVersion > SCHEMA_VERSION ? 'UNSUPPORTED_FUTURE_PRESET_VERSION' : 'UNSUPPORTED_PRESET_VERSION', 'preset schema version is unsupported');
    if (!plain(raw.characters)) fail('INVALID_PRESET_CHARACTERS', 'characters must be an object');
    const characters = {};
    Object.keys(raw.characters).sort().forEach((characterId) => { assertCharacter(characterId, ids); characters[characterId] = validateCharacter(raw.characters[characterId], `characters.${characterId}`); });
    return freezeClone({ schemaVersion: SCHEMA_VERSION, characters });
  }
  function characterState(state, characterId, characterIds) { const checked = validateState(state, { characterIds }); const id = assertCharacter(characterId, allowedCharacters(characterIds)); return checked.characters[id] ? freezeClone(checked.characters[id]) : freezeClone(defaultCharacter()); }
  function resolveDefaultPreset(state, { characterId, mode, characterIds }) { const character = characterState(state, characterId, characterIds); assertMode(mode); return character.modeDefaults[mode]; }
  function resolvePreset(state, { characterId, presetId, characterIds }) { const character = characterState(state, characterId, characterIds); const id = assertPresetId(presetId); return freezeClone(character.presets.find((preset) => preset.presetId === id)); }
  function setPresetSlot(state, { characterId, presetId, slotId, gearId, characterIds }) {
    const checked = validateState(state, { characterIds }); const ids = allowedCharacters(characterIds); assertCharacter(characterId, ids); const id = assertPresetId(presetId); if (!SLOT_IDS.includes(slotId)) fail('INVALID_SLOT_ID', 'slotId is invalid'); const next = clone(checked); if (!next.characters[characterId]) next.characters[characterId] = defaultCharacter(); const preset = next.characters[characterId].presets.find((entry) => entry.presetId === id); preset.slots[slotId] = assertGearId(gearId, `slots.${slotId}`); return validateState(next, { characterIds });
  }
  function setModeDefault(state, { characterId, mode, presetId, characterIds }) {
    const checked = validateState(state, { characterIds }); const ids = allowedCharacters(characterIds); assertCharacter(characterId, ids); assertMode(mode); const id = assertPresetId(presetId); const next = clone(checked); if (!next.characters[characterId]) next.characters[characterId] = defaultCharacter(); next.characters[characterId].modeDefaults[mode] = id; return validateState(next, { characterIds });
  }
  function setPresetName(state, { characterId, presetId, name, characterIds }) {
    const checked = validateState(state, { characterIds }); const ids = allowedCharacters(characterIds); assertCharacter(characterId, ids); const id = assertPresetId(presetId); if (typeof name !== 'string' || name.length < 1 || name.length > 32) fail('INVALID_PRESET_NAME', 'preset name is invalid'); const next = clone(checked); if (!next.characters[characterId]) next.characters[characterId] = defaultCharacter(); next.characters[characterId].presets.find((entry) => entry.presetId === id).name = name; return validateState(next, { characterIds });
  }
  function resolvePresetLoadout({ presetState, gearState, characterId, presetId, characterIds, validateGear }) {
    const preset = resolvePreset(presetState, { characterId, presetId, characterIds });
    if (!gearState || !Array.isArray(gearState.inventory)) fail('INVALID_GEAR_STATE', 'validated gear inventory is required');
    if (typeof validateGear !== 'function') fail('GEAR_VALIDATOR_REQUIRED', 'resolvePresetLoadout requires the canonical GearDomain validator');
    const byId = new Map();
    gearState.inventory.forEach((entry, index) => { if (!entry || !entry.gear || typeof entry.gear.gearId !== 'string') fail('INVALID_GEAR_STATE', `inventory[${index}] is invalid`); let checkedGear; try { checkedGear = validateGear(entry.gear); } catch (error) { fail('INVALID_GEAR_STATE', `inventory[${index}] failed canonical gear validation`, error); } if (byId.has(checkedGear.gearId)) fail('INVALID_GEAR_STATE', 'inventory repeats gearId'); byId.set(checkedGear.gearId, checkedGear); });
    const slots = {}; const gearIds = [];
    SLOT_IDS.forEach((slotId) => { const gearId = preset.slots[slotId]; if (gearId === null) { slots[slotId] = null; return; } const gear = byId.get(gearId); if (!gear) fail('GEAR_PRESET_MISSING_GEAR', `preset references unavailable inventory gear: ${gearId}`); if (gear.slotId !== slotId) fail('GEAR_PRESET_SLOT_MISMATCH', `preset slot ${slotId} does not match gear ${gearId}`); slots[slotId] = clone(gear); gearIds.push(gearId); });
    return freezeClone({ characterId, presetId: preset.presetId, slots, gearIds });
  }
  function resolveDefaultLoadout(input) { const presetId = resolveDefaultPreset(input.presetState, input); return resolvePresetLoadout({ ...input, presetId }); }
  function findSimultaneousGearConflicts(loadouts) {
    if (!Array.isArray(loadouts)) fail('INVALID_LOADOUT_GROUP', 'loadouts must be an array');
    const seen = new Map(); const conflicts = [];
    loadouts.forEach((loadout, index) => { if (!loadout || typeof loadout.characterId !== 'string' || typeof loadout.presetId !== 'string' || !Array.isArray(loadout.gearIds)) fail('INVALID_RESOLVED_LOADOUT', `loadouts[${index}] is invalid`); loadout.gearIds.forEach((gearId) => { if (typeof gearId !== 'string' || !gearId) fail('INVALID_RESOLVED_LOADOUT', 'gearId is invalid'); const first = seen.get(gearId); const current = { characterId: loadout.characterId, presetId: loadout.presetId }; if (first) conflicts.push({ gearId, firstCharacterId: first.characterId, firstPresetId: first.presetId, secondCharacterId: current.characterId, secondPresetId: current.presetId }); else seen.set(gearId, current); }); });
    return freezeClone(conflicts);
  }
  function assertNoSimultaneousGearConflicts(loadouts) { const conflicts = findSimultaneousGearConflicts(loadouts); if (conflicts.length) { const conflict = conflicts[0]; fail('SIMULTANEOUS_GEAR_CONFLICT', `gear ${conflict.gearId} is requested by multiple simultaneous loadouts`, conflict); } return true; }
  return Object.freeze({ GearPresetError, SCHEMA_VERSION, PRESET_IDS, SLOT_IDS, MODE_IDS, GEAR_ID_MAX_LENGTH, createInitialState, validateState, characterState, setPresetSlot, setModeDefault, setPresetName, resolveDefaultPreset, resolvePreset, resolvePresetLoadout, resolveDefaultLoadout, findSimultaneousGearConflicts, assertNoSimultaneousGearConflicts });
});
