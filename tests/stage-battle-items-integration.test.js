const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(html, /<script src="shared\/stage-battle-items\.js"><\/script>/,
  'pure stage battle item module must load before the inline game');
assert.match(html, /const BUILD_ID = 'v2\.0\.175-content-studio-motion'/,
  'index and service worker build IDs must advance together');

for (const needle of [
  'function isStageBattleItemEligibleMatch()',
  'function initializeStageBattleItemsForMatch()',
  'function updateStageBattleItemsAtTurnStart()',
  'function tryCollectStageBattleItemByProjectile(',
  'function tryCollectStageBattleItemByUnit(',
  'function drawStageBattleItem()',
  'snapshot.stageBattleItems = cloneStageBattleItemsSnapshot(stageBattleItems)',
  "projectile?.gearDamageProfile !== 'normal_cannonball'",
  'tryCollectStageBattleItemByProjectile(p, prevX, prevY)',
  'tryCollectStageBattleItemByUnit(me)',
  'tryCollectStageBattleItemByUnit(cpuActor)',
  'tryCollectStageBattleItemByUnit(unitById(p.owner))',
  'drawStageBattleItem();',
]) {
  assert.ok(html.includes(needle), `missing stage battle item integration: ${needle}`);
}

const snapshotBlock = /function buildSnapshot\(options = \{\}\) \{[\s\S]*?\n  \}/.exec(html)?.[0] || '';
assert.ok(snapshotBlock.includes('isStageBattleItemEligibleMatch()'),
  'battle item snapshot must be CPU-local eligible only');
assert.ok(snapshotBlock.includes('options.includeStageBattleItems === true'),
  'battle item snapshot must require an explicit local-suspend opt-in');
assert.ok(html.includes('buildSnapshot({ includeStageBattleItems: true })'),
  'legacy local suspend writer must opt in to battle item state');
assert.match(html,
  /cpuGearSnapshotId: snapshotId,\s*includeStageBattleItems: true,/,
  'fenced CPU autosave must opt in to battle item state');
assert.ok(!snapshotBlock.includes('isOnline() ||'),
  'snapshot integration must not widen the ONLINE wire path');

const physicsHook = html.indexOf('tryCollectStageBattleItemByProjectile(p, prevX, prevY)');
const unitCollision = html.indexOf('// ユニットへの直撃判定', physicsHook);
assert.ok(physicsHook >= 0 && unitCollision > physicsHook,
  'normal projectile pickup sweep must happen before unit/terrain collision resolution');

console.log('stage battle item index integration: ok');
