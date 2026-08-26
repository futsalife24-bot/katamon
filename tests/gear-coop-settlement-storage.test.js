const assert = require('node:assert/strict');
const settlement = require('../shared/gear-coop-settlement-storage.js');
const values = new Map();
const storage = { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const matchId = (digit) => digit.repeat(48);
const input = { matchId: matchId('a'), eventId: `${matchId('a')}:result`, difficulty: 'hard', outcome: 'victory', firstClear: true, createdAtMs: 77,
  foundationEvent: { id: `${matchId('a')}:result`, type: 'coop-result', outcome: 'victory', difficulty: 'hard', rescues: 0, partsDestroyed: 0, totalParts: 4, bossHpRemainingRatio: 0, playerCount: 1, aiCount: 3, allPartsDestroyed: false, noDown: true, deadLineWin: false } };
const record = settlement.create(input);
settlement.save(record, storage);
assert.deepEqual(settlement.load(storage), record);
assert.throws(() => settlement.save({ ...record, matchId: 'other' }, storage));
settlement.clear(record, storage); assert.equal(settlement.load(storage), null);
const replacement = settlement.create({ ...input, matchId: matchId('b'), eventId: `${matchId('b')}:result`, foundationEvent: { ...input.foundationEvent, id: `${matchId('b')}:result` } });
settlement.save(record, storage); values.set(settlement.STORAGE_KEY, JSON.stringify(replacement)); assert.throws(() => settlement.clear(record, storage)); assert.deepEqual(settlement.load(storage), replacement);
values.set(settlement.STORAGE_KEY, '{bad'); assert.throws(() => settlement.load(storage), /malformed/);
for (const [field, value] of [['rescues', 100], ['partsDestroyed', 100], ['totalParts', 100], ['playerCount', 5], ['aiCount', 5]]) {
  const malformed = JSON.parse(JSON.stringify(record)); malformed.foundationEvent[field] = value; assert.throws(() => settlement.validate(malformed));
}
console.log('gear-coop-settlement-storage: 7/7 passed');
