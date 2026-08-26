const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const rewards = require('../shared/gear-coop-rewards.js');
const matchId = (label) => Array.from({ length: 48 }, (_, index) => ((label.charCodeAt(index % label.length) + index) & 15).toString(16)).join('');

for (const [difficulty, min] of [['normal', 3], ['hard', 4], ['extreme', 6]]) {
  const firstId = matchId(`first-${difficulty}`); const first = rewards.createCoopSettlementIntent({ matchId: firstId, eventId: `${firstId}:result`, difficulty, outcome: 'victory', firstClear: true, createdAtMs: 42 });
  const envelope = rewards.materializeCoopGearReward(first);
  assert.equal(envelope.sourceId, 'coop_boss'); assert.equal(envelope.blueprintShards, 0); assert.equal(envelope.gears.length, 3);
  assert.ok(envelope.gears[2].star >= min, `${difficulty} first-clear bonus star`);
  assert.equal(envelope.gears[2].setId in Object.fromEntries(domain.SETS.map((set) => [set.id, true])), true);
  assert.deepEqual(envelope, rewards.materializeCoopGearReward(first), `${difficulty} retry is deterministic`);
  const repeatId = matchId(`repeat-${difficulty}`); const repeat = rewards.materializeCoopGearReward(rewards.createCoopSettlementIntent({ matchId: repeatId, eventId: `${repeatId}:result`, difficulty, outcome: 'victory', firstClear: false, createdAtMs: 42 }));
  assert.equal(repeat.gears.length, 2);
}
assert.throws(() => rewards.createCoopSettlementIntent({ matchId: 'a'.repeat(48), eventId: `${'a'.repeat(48)}:result`, difficulty: 'normal', outcome: 'defeat', firstClear: false, createdAtMs: 0 }), /only victory/);
assert.throws(() => rewards.createCoopSettlementIntent({ matchId: 'A'.repeat(48), eventId: `${'A'.repeat(48)}:result`, difficulty: 'normal', outcome: 'victory', firstClear: false, createdAtMs: 0 }), /48-hex/);
console.log('gear-coop-rewards: 16/16 passed');
