const assert = require('node:assert/strict');
const settlement = require('../shared/gear-coop-settlement-storage.js');
const values = new Map();
const storage = { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const input = { matchId: 'room-match', eventId: 'room-match:result', difficulty: 'hard', outcome: 'victory', firstClear: true, createdAtMs: 77,
  foundationEvent: { id: 'room-match:result', type: 'coop-result', outcome: 'victory', difficulty: 'hard', rescues: 0, partsDestroyed: 0, totalParts: 4, bossHpRemainingRatio: 0, playerCount: 1, aiCount: 3, allPartsDestroyed: false, noDown: true, deadLineWin: false } };
const record = settlement.create(input);
settlement.save(record, storage);
assert.deepEqual(settlement.load(storage), record);
assert.throws(() => settlement.save({ ...record, matchId: 'other' }, storage));
settlement.clear(record, storage); assert.equal(settlement.load(storage), null);
const replacement = settlement.create({ ...input, matchId: 'room-match-b', eventId: 'room-match-b:result', foundationEvent: { ...input.foundationEvent, id: 'room-match-b:result' } });
settlement.save(record, storage); values.set(settlement.STORAGE_KEY, JSON.stringify(replacement)); assert.throws(() => settlement.clear(record, storage)); assert.deepEqual(settlement.load(storage), replacement);
values.set(settlement.STORAGE_KEY, '{bad'); assert.throws(() => settlement.load(storage), /malformed/);
console.log('gear-coop-settlement-storage: 6/6 passed');
