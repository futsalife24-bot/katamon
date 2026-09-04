const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok ${name}`); }

test('未装備slotは外枠込みで減彩しつつbutton操作を維持する', () => {
  assert.match(html, /\.gearSlot\.empty:not\(\.selected\):not\(\.updated\) \{ filter:grayscale\(\.82\) saturate\(\.28\) brightness\(\.74\)/);
  assert.match(html, /\.gearSlot\.empty:not\(\.selected\):not\(\.updated\) \.gearSlotFrameOuter \{ fill:#465052; stroke:#89918e; \}/);
  assert.doesNotMatch(html, /\.gearSlot\.empty[^\{]*\{[^}]*pointer-events:none/);
  assert.match(html, /<button class="gearSlot \$\{stateClasses\}"[^>]+type="button"/);
});

test('Workbenchの9能力名は簡潔な日本語へ統一する', () => {
  const rows = html.slice(html.indexOf('function gearStatRows'), html.indexOf('function gearCapClass'));
  for (const label of ['体力', '攻撃', '防御', '燃料', '会心', '爆発', '状態耐性', 'シールド', '回復']) {
    assert.match(rows, new RegExp(`\\['${label}'`));
  }
  for (const english of ['HP', 'ATK', 'DEF', 'FUEL', 'CRIT', 'BLAST', 'RESIST', 'SHIELD', 'HEAL']) assert.doesNotMatch(rows, new RegExp(`\\['${english}'`));
});

test('Gear main/sub OPは一つの日本語ラベル正本を使う', () => {
  const labels = html.slice(html.indexOf('const gearStatusLabels'), html.indexOf('const gearValue'));
  const required = [
    'flat_attack', 'flat_hp', 'flat_defense', 'attack_pct', 'hp_pct', 'defense_pct',
    'crit_rate', 'crit_damage', 'blast_power', 'knockback_power', 'knockback_resistance',
    'status_resistance', 'heal_power', 'received_heal', 'shield_power', 'received_shield', 'max_fuel'
  ];
  for (const id of required) assert.match(labels, new RegExp(`\\b${id}:`));
  for (const label of ['攻撃', '体力', '防御', '会心率', '会心ダメージ', '爆発威力', '吹き飛ばし耐性', '状態異常耐性', '回復力', '被回復量', 'シールド力', '被シールド量', '最大燃料']) assert.match(labels, new RegExp(`'${label}'`));
  assert.match(labels, /const gearOpLabel = \(_domain, opId\) => gearStatusLabels\[opId\] \|\| opId/);
  assert.doesNotMatch(labels, /labelJa/);
});

test('Guideとset数値ラベルもWorkbenchと同じ語彙を使う', () => {
  assert.match(html, /gearGuideFixedMainLabels = Object\.freeze\(\{ barrel: '攻撃', armor: '体力', core: '防御' \}\)/);
  const setLabels = html.slice(html.indexOf('const gearSetStatLabels'), html.indexOf('const gearSetPercent'));
  for (const label of ['攻撃', '体力', '防御', '会心率', '会心ダメージ', '爆発威力', '爆発範囲', '吹き飛ばし耐性', '回復力', 'シールド力']) {
    assert.match(setLabels, new RegExp(`'${label}'`));
  }
});

test('Gear Domainとauthority writerは変更対象にしない', () => {
  assert.doesNotMatch(html.slice(html.indexOf('const gearStatusLabels'), html.indexOf('function gearCharacterAsset')), /saveGearState|setPresetSlot|persistClaimReward|enhanceStoredGearAtomic|persistDismantle/);
});

console.log(`Gear status visual language Phase 4S: ${passed} checks passed.`);
