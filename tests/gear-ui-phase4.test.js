const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gear = require('../shared/gear-domain.js');
const presets = require('../shared/gear-presets.js');
const combat = require('../shared/gear-combat.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }
function makeGear(gearId, slotId, setId = 'assault') {
  return gear.createGear({ gearId, generationSeed: `${gearId}:generation`, enhancementSeed: `${gearId}:enhancement`, sourceId: 'cpu_battle', sourceDetail: { fixture: 'gear-ui-phase4' }, acquiredAt: '2026-08-30T00:00:00Z', qualityProfile: { id: 'ui-quality', starWeights: [{ id: 6, weight: 1 }], rarityWeights: [{ id: 'legend', weight: 1 }] }, setProfile: { id: `ui-${setId}`, setWeights: [{ id: setId, weight: 1 }] }, slotId, setId });
}

test('6部位はGear Domainの正本をそのまま画面へ配置する', () => {
  assert.deepEqual(gear.SLOT_IDS, ['barrel', 'armor', 'core', 'engine', 'sight', 'auxiliary']);
  assert.match(html, /domain\.SLOTS\.map/);
  assert.match(html, /data-gear-slot=\"\$\{slot\.id\}\"/);
  assert.match(html, /gearSlotGlyphs\[slot\.id\]/);
  assert.match(html, /data-slot=\"\$\{slot\.id\}\"/);
});
test('比較はcanonical aggregate/combatを使い、独自set判定を持たない', () => {
  assert.match(html, /domain\.aggregateLoadout\(loadout\)/);
  assert.match(html, /combat\.calculateGearCombat/);
  assert.match(html, /aggregate\.activeSetEffects/);
  assert.match(html, /aggregate\.softCaps/);
});
test('装備・解除はpreset storageのlock付き正本mutationだけを通す', () => {
  assert.match(html, /presetStorage\.setPresetSlotValidatedLocked/);
  assert.match(html, /characterId: gearUi\.characterId, presetId: gearUi\.presetId, slotId, gearId/);
  assert.doesNotMatch(html, /localStorage\.setItem\(['\"]katamon_gear_presets_v1/);
});
test('比較候補はslotを置換した最終combatとset効果を再計算する', () => {
  const ids = ['kyoryu'];
  const barrel = makeGear('ui-barrel', 'barrel', 'assault');
  const armor = makeGear('ui-armor', 'armor', 'assault');
  const alternative = makeGear('ui-barrel-alt', 'barrel', 'life');
  let state = presets.createInitialState(ids);
  state = presets.setPresetSlot(state, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'barrel', gearId: barrel.gearId, characterIds: ids });
  state = presets.setPresetSlot(state, { characterId: 'kyoryu', presetId: 'preset1', slotId: 'armor', gearId: armor.gearId, characterIds: ids });
  const current = presets.resolvePresetLoadout({ presetState: state, gearState: { inventory: [{ gear: barrel }, { gear: armor }, { gear: alternative }] }, characterId: 'kyoryu', presetId: 'preset1', characterIds: ids, validateGear: gear.validateGear });
  const currentLoadout = Object.values(current.slots).filter(Boolean);
  const nextLoadout = currentLoadout.filter((entry) => entry.slotId !== 'barrel').concat(alternative);
  assert.equal(gear.aggregateLoadout(currentLoadout).setCounts.assault, 2);
  assert.equal(gear.aggregateLoadout(nextLoadout).setCounts.assault, 1);
  assert.notDeepEqual(combat.calculateGearCombat({ loadout: currentLoadout, baseHp: 100, baseFuel: 50 }), combat.calculateGearCombat({ loadout: nextLoadout, baseHp: 100, baseFuel: 50 }));
});
test('GARAGEから単一のGear導線を持ち、比較・装備・解除の操作を表示する', () => {
  assert.match(html, /id: 'gear'/);
  assert.match(html, /openGearWorkshop\(\)/);
  assert.match(html, /data-gear-equip/);
  assert.match(html, /data-gear-unequip/);
  assert.match(html, /CURRENT → NEW/);
});
test('Gear IDはHTML属性へ入れる前にescapeし、プリセットの自動保存を明示する', () => {
  assert.match(html, /data-gear-candidate=\"\$\{gearHtml\(gear\.gearId\)\}\"/);
  assert.match(html, /data-gear-equip=\"\$\{gearHtml\(compared\.gearId\)\}\"/);
  assert.match(html, /id=\"gearPresetSave\"[^>]*>自動保存済み<\/button>/);
});
console.log(`gear-ui-phase4: ${passed}/6 passed`);
