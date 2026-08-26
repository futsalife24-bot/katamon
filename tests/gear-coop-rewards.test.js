const assert = require('node:assert/strict');
const domain = require('../shared/gear-domain.js');
const rewards = require('../shared/gear-coop-rewards.js');

for (const [difficulty, min] of [['normal', 3], ['hard', 4], ['extreme', 6]]) {
  const first = rewards.createCoopSettlementIntent({ matchId: `first-${difficulty}`, eventId: `first-${difficulty}:result`, difficulty, outcome: 'victory', firstClear: true, createdAtMs: 42 });
  const envelope = rewards.materializeCoopGearReward(first);
  assert.equal(envelope.sourceId, 'coop_boss'); assert.equal(envelope.blueprintShards, 0); assert.equal(envelope.gears.length, 3);
  assert.ok(envelope.gears[2].star >= min, `${difficulty} first-clear bonus star`);
  assert.equal(envelope.gears[2].setId in Object.fromEntries(domain.SETS.map((set) => [set.id, true])), true);
  assert.deepEqual(envelope, rewards.materializeCoopGearReward(first), `${difficulty} retry is deterministic`);
  const repeat = rewards.materializeCoopGearReward(rewards.createCoopSettlementIntent({ matchId: `repeat-${difficulty}`, eventId: `repeat-${difficulty}:result`, difficulty, outcome: 'victory', firstClear: false, createdAtMs: 42 }));
  assert.equal(repeat.gears.length, 2);
}
assert.throws(() => rewards.createCoopSettlementIntent({ matchId: 'x', eventId: 'x:result', difficulty: 'normal', outcome: 'defeat', firstClear: false, createdAtMs: 0 }), /only victory/);
console.log('gear-coop-rewards: 16/16 passed');
