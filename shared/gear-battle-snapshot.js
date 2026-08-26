(function initKatamonGearBattleSnapshot(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonGearBattleSnapshot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createKatamonGearBattleSnapshot(root) {
  'use strict';
  const VERSION = 1;
  class GearBattleSnapshotError extends Error { constructor(code, message) { super(message || code); this.name = 'GearBattleSnapshotError'; this.code = code; } }
  const fail = (code, message) => { throw new GearBattleSnapshotError(code, message); };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const exact = (value, keys, code) => { if (!plain(value) || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail(code, 'snapshot has unknown or missing fields'); };
  function domain() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-domain.js'); if (root?.KatamonGearDomain) return root.KatamonGearDomain; fail('GEAR_DOMAIN_UNAVAILABLE'); }
  function combat() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-combat.js'); if (root?.KatamonGearCombat) return root.KatamonGearCombat; fail('GEAR_COMBAT_UNAVAILABLE'); }
  function presets() { if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./gear-presets.js'); if (root?.KatamonGearPresets) return root.KatamonGearPresets; fail('GEAR_PRESETS_UNAVAILABLE'); }
  const slots = () => domain().SLOT_IDS;

  // This is a current-state proof, not a future-roll proof: only already
  // materialized initial/upgrade rolls are projected; neither seed is sent.
  function canonicalSubs(raw) {
    const gear = domain().validateGear(raw); const plan = domain().calculateMilestonePlan(gear, gear.enhancementLevel);
    const byId = new Map(gear.initialSubOps.map((sub) => [sub.opId, { opId: sub.opId, initialValueBp: sub.initialValueBp, introducedAtLevel: 0, enhancementRollsBp: [] }]));
    plan.milestones.forEach((event) => {
      if (event.kind === 'add') byId.set(event.opId, { opId: event.opId, initialValueBp: event.valueBp, introducedAtLevel: event.level, enhancementRollsBp: [] });
      else byId.get(event.opId).enhancementRollsBp.push(event.valueBp);
    });
    return gear.subOps.map((sub) => ({ ...byId.get(sub.opId), enhancementRollsBp: byId.get(sub.opId).enhancementRollsBp.slice(), valueBp: sub.valueBp })).sort((a, b) => a.opId.localeCompare(b.opId));
  }
  function battleGear(raw) {
    const gear = domain().validateGear(raw);
    return { gearId: gear.gearId, slotId: gear.slotId, setId: gear.setId, star: gear.star, rarityId: gear.rarityId, enhancementLevel: gear.enhancementLevel, balanceTuningVersion: gear.balanceTuningVersion, mainOp: { opId: gear.mainOp.opId, unit: gear.mainOp.unit, value: gear.mainOp.value }, subs: canonicalSubs(gear) };
  }
  function validateResolvedLoadout(value) {
    exact(value, ['characterId', 'gearIds', 'presetId', 'slots'], 'INVALID_RESOLVED_LOADOUT');
    if (typeof value.characterId !== 'string' || !value.characterId || !presets().PRESET_IDS.includes(value.presetId) || !Array.isArray(value.gearIds)) fail('INVALID_RESOLVED_LOADOUT');
    exact(value.slots, slots(), 'INVALID_RESOLVED_LOADOUT');
    const ids = [];
    slots().forEach((slot) => { const gear = value.slots[slot]; if (gear === null) return; const checked = domain().validateGear(gear); if (checked.slotId !== slot) fail('INVALID_RESOLVED_LOADOUT'); ids.push(checked.gearId); });
    if (new Set(ids).size !== ids.length || domain().stableStringify(ids) !== domain().stableStringify(value.gearIds)) fail('INVALID_RESOLVED_LOADOUT');
  }
  function createBattleGearSnapshot({ resolvedLoadout, baseHp, baseFuel }) {
    validateResolvedLoadout(resolvedLoadout);
    const full = slots().map((slot) => resolvedLoadout.slots[slot]);
    const derivedStats = combat().calculateGearCombat({ loadout: full, baseHp, baseFuel }); const slotViews = {};
    slots().forEach((slot) => { slotViews[slot] = resolvedLoadout.slots[slot] === null ? null : battleGear(resolvedLoadout.slots[slot]); });
    return validateBattleGearSnapshot({ version: VERSION, characterId: resolvedLoadout.characterId, presetId: resolvedLoadout.presetId, slots: slotViews, derivedStats: clone(derivedStats), activeSets: clone(derivedStats.activeSets), initialRuntimeState: clone(combat().createRuntimeEffectsState()) }, { baseHp, baseFuel, expectedCharacterId: resolvedLoadout.characterId });
  }
  function validateBattleGearView(view, slot, seen) {
    const d = domain(); exact(view, ['balanceTuningVersion', 'enhancementLevel', 'gearId', 'mainOp', 'rarityId', 'setId', 'slotId', 'star', 'subs'], 'INVALID_BATTLE_GEAR');
    if (view.slotId !== slot || typeof view.gearId !== 'string' || !view.gearId || view.gearId.length > d.GEAR_ID_MAX_LENGTH || seen.has(view.gearId)) fail('INVALID_BATTLE_GEAR'); seen.add(view.gearId);
    if (!d.SET_IDS.includes(view.setId) || !d.STARS.includes(view.star) || !d.RARITY_IDS.includes(view.rarityId) || !Number.isSafeInteger(view.enhancementLevel) || view.enhancementLevel < 0 || view.enhancementLevel > d.MAX_ENHANCEMENT_LEVEL || !Number.isSafeInteger(view.balanceTuningVersion)) fail('INVALID_BATTLE_GEAR');
    exact(view.mainOp, ['opId', 'unit', 'value'], 'INVALID_BATTLE_GEAR'); const slotDef = d.SLOTS.find((entry) => entry.id === slot); const unit = slotDef.mainKind === 'fixed' ? 'flat' : 'bp';
    let tuning; try { tuning = d.resolveBalanceTuningForVersion(view.balanceTuningVersion); } catch (_) { fail('INVALID_BATTLE_GEAR'); }
    if (!slotDef.mainOpIds.includes(view.mainOp.opId) || view.mainOp.unit !== unit || view.mainOp.value !== d.mainValueAtLevel(slot, view.mainOp.opId, view.star, view.enhancementLevel, tuning)) fail('INVALID_BATTLE_GEAR');
    if (!Array.isArray(view.subs) || view.subs.length > 4) fail('INVALID_BATTLE_GEAR'); const rarity = d.RARITIES.find((entry) => entry.id === view.rarityId); const milestones = d.ENHANCEMENT_MILESTONES.filter((level) => level <= view.enhancementLevel); const expectedSubCount = Math.min(4, rarity.initialSubCount + milestones.length);
    if (view.subs.length !== expectedSubCount) fail('INVALID_BATTLE_GEAR'); const state = { ids: new Set(), prior: '', initialCount: 0, upgradeRolls: 0, introduced: [] };
    view.subs.forEach((sub) => { exact(sub, ['enhancementRollsBp', 'initialValueBp', 'introducedAtLevel', 'opId', 'valueBp'], 'INVALID_BATTLE_GEAR'); const range = d.subValueRange(view.star); if (!d.SUB_OP_IDS.includes(sub.opId) || state.ids.has(sub.opId) || sub.opId <= state.prior || !Number.isSafeInteger(sub.initialValueBp) || sub.initialValueBp < range.min || sub.initialValueBp > range.max || !Number.isSafeInteger(sub.introducedAtLevel) || !Array.isArray(sub.enhancementRollsBp) || !Number.isSafeInteger(sub.valueBp)) fail('INVALID_BATTLE_GEAR'); state.ids.add(sub.opId); state.prior = sub.opId; let total = sub.initialValueBp; if (sub.introducedAtLevel === 0) state.initialCount += 1; else { if (!milestones.includes(sub.introducedAtLevel)) fail('INVALID_BATTLE_GEAR'); state.introduced.push(sub.introducedAtLevel); } sub.enhancementRollsBp.forEach((roll) => { if (!Number.isSafeInteger(roll) || roll < range.min || roll > range.max) fail('INVALID_BATTLE_GEAR'); total += roll; state.upgradeRolls += 1; }); if (total !== sub.valueBp) fail('INVALID_BATTLE_GEAR'); });
    const expectedIntroduced = milestones.slice(0, Math.max(0, 4 - rarity.initialSubCount)); if (state.initialCount !== rarity.initialSubCount || state.upgradeRolls !== Math.max(0, milestones.length - (4 - rarity.initialSubCount)) || d.stableStringify(state.introduced.sort((a, b) => a - b)) !== d.stableStringify(expectedIntroduced)) fail('INVALID_BATTLE_GEAR');
  }
  function trustedContext(context) { if (!plain(context) || Object.keys(context).sort().join(',') !== 'baseFuel,baseHp,expectedCharacterId' || !Number.isFinite(context.baseHp) || context.baseHp < 0 || !Number.isFinite(context.baseFuel) || context.baseFuel < 0 || typeof context.expectedCharacterId !== 'string' || !context.expectedCharacterId) fail('INVALID_TRUSTED_BATTLE_CONTEXT'); return context; }
  function stableSerialize(snapshot, context) { const trusted = trustedContext(context); return domain().stableStringify(validateBattleGearSnapshot(snapshot, trusted)); }
  function validateBattleGearSnapshot(snapshot, context) {
    const { baseHp, baseFuel, expectedCharacterId } = trustedContext(context);
    exact(snapshot, ['activeSets', 'characterId', 'derivedStats', 'initialRuntimeState', 'presetId', 'slots', 'version'], 'INVALID_GEAR_BATTLE_SNAPSHOT'); if (snapshot.version !== VERSION) fail(snapshot.version > VERSION ? 'UNSUPPORTED_FUTURE_GEAR_BATTLE_SNAPSHOT' : 'UNSUPPORTED_GEAR_BATTLE_SNAPSHOT');
    if (snapshot.characterId !== expectedCharacterId || !presets().PRESET_IDS.includes(snapshot.presetId)) fail('INVALID_GEAR_BATTLE_SNAPSHOT'); exact(snapshot.slots, slots(), 'INVALID_GEAR_BATTLE_SNAPSHOT'); const seen = new Set(); const full = [];
    slots().forEach((slot) => { const view = snapshot.slots[slot]; if (view === null) { full.push(null); return; } validateBattleGearView(view, slot, seen); full.push(view); }); const expected = snapshot.derivedStats;
    if (!plain(expected) || expected.baseHp !== baseHp || expected.baseFuel !== baseFuel) fail('INVALID_GEAR_BATTLE_SNAPSHOT'); const derived = combat().calculateBattleGearCombat({ battleGears: full, baseHp, baseFuel }); const initial = combat().createRuntimeEffectsState();
    if (domain().stableStringify(derived) !== domain().stableStringify(expected) || domain().stableStringify(derived.activeSets) !== domain().stableStringify(snapshot.activeSets) || domain().stableStringify(initial) !== domain().stableStringify(snapshot.initialRuntimeState)) fail('TAMPERED_GEAR_BATTLE_SNAPSHOT'); return freeze(clone(snapshot));
  }
  return freeze({ GEAR_BATTLE_SNAPSHOT_VERSION: VERSION, createBattleGearSnapshot, validateBattleGearSnapshot, stableSerialize });
});
