const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const protocol = require('../coop-mvp-engine.js');
const battle = require('../coop-mvp-battle.js');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules.coopRooms.$room;

assert.equal(protocol.INPUT_TIME_MS, 30000);
assert.equal(protocol.VOLLEY_INTERVAL_MS, 150);
assert.equal(protocol.MOVE_SYNC_INTERVAL_MS, 250);
assert.equal(protocol.MOVE_SYNC_MIN_DISTANCE, 8);
assert.deepEqual(protocol.VOLLEY_ORDER, ['p1', 'e1', 's1', 's2']);

const startedAt = 100000;
let round = protocol.createInputRound({
  id: 'a'.repeat(48),
  seats: { p1: { uid: 'h' }, e1: { uid: 'g' }, s1: { ai: true } },
  wind: { direction: 1, strength: 6 },
  nextWind: { direction: -1, strength: 4 },
  startedAt,
});
assert.equal(round.phase, 'input');
assert.equal(round.deadlineAt, startedAt + 30000);

round = protocol.updateDraft(round, 'p1', {
  x: 120, fuelSpent: 8, aim: { x: 300, y: 120 }, weapon: { kind: 'normal', id: 'normal' },
}, startedAt + 1000);
round = protocol.updateDraft(round, 'p1', {
  x: 118, fuelSpent: 3, aim: { x: 305, y: 118 }, weapon: { kind: 'normal', id: 'normal' },
}, startedAt + 1200);
assert.equal(round.drafts.p1.fuelSpent, 8, '移動燃料は巻き戻らない');

round = protocol.commitAction(round, 'p1', startedAt + 1500);
const frozen = round.commits.p1;
assert.equal(frozen.auto, false);
assert.equal(frozen.x, 118);
assert.throws(() => protocol.updateDraft(round, 'p1', { x: 999 }, startedAt + 1600), /already committed/);
assert.equal(protocol.allRequiredReady(round), false);

round = protocol.updateDraft(round, 'e1', {
  x: 160, fuelSpent: 4, aim: { x: 330, y: 140 }, weapon: { kind: 'special', id: 'special' },
}, startedAt + 1700);
round = protocol.commitAction(round, 'e1', startedAt + 1800);
assert.equal(protocol.humansReady(round), true);
assert.equal(protocol.shouldFinalizeAi(round, startedAt + 1800), true, '人間全員READYならAIは即判断');
round = protocol.updateDraft(round, 's1', {
  x: 190, fuelSpent: 0, aim: { x: 350, y: 150 }, weapon: { kind: 'coopItem', id: 'rescue-kit' },
}, startedAt + 1900);
round = protocol.commitAction(round, 's1', startedAt + 2000);
assert.equal(protocol.allRequiredReady(round), true);

const volley = protocol.buildVolley(round, startedAt + 2100);
assert.deepEqual(volley.actions.map((action) => action.seat), ['p1', 'e1', 's1']);
assert.deepEqual(volley.actions.map((action) => action.scheduledAt), [102100, 102250, 102400]);
assert.ok(volley.actions.every((action) => action.wind.direction === 1 && action.wind.strength === 6));
assert.equal(volley.projectilesCollide, false);

let timeoutRound = protocol.createInputRound({
  id: 'b'.repeat(48), seats: { p1: { uid: 'h' }, e1: { uid: 'g' } },
  wind: { direction: 0, strength: 0 }, nextWind: { direction: 1, strength: 2 }, startedAt,
});
timeoutRound = protocol.updateDraft(timeoutRound, 'e1', {
  x: 222, fuelSpent: 2, aim: { x: 400, y: 200 }, weapon: { kind: 'subweapon', id: 'drill' },
}, startedAt + 5000);
timeoutRound = protocol.autoCommitExpired(timeoutRound, startedAt + 29999);
assert.equal(timeoutRound.commits.e1, undefined);
timeoutRound = protocol.autoCommitExpired(timeoutRound, startedAt + 30000);
assert.equal(timeoutRound.commits.e1.auto, true);
assert.equal(timeoutRound.commits.e1.weapon.id, 'drill');
assert.equal(timeoutRound.commits.p1.auto, true, '入力が無くても期限時点の安全な既定値で確定する');

assert.equal(protocol.shouldSyncMove({ x: 100, sentAt: 1000 }, { x: 109 }, 1249, false), false);
assert.equal(protocol.shouldSyncMove({ x: 100, sentAt: 1000 }, { x: 109 }, 1250, false), true);
assert.equal(protocol.shouldSyncMove({ x: 100, aim: { x: 10, y: 10 }, weaponKey: 'normal:normal', sentAt: 1000 },
  { x: 100, aim: { x: 20, y: 10 }, weaponKey: 'normal:normal' }, 1250, false), true,
  '移動なしでも照準は低頻度同期する');
assert.equal(protocol.shouldSyncMove({ x: 100, aim: { x: 10, y: 10 }, weaponKey: 'normal:normal', sentAt: 1000 },
  { x: 100, aim: { x: 10, y: 10 }, weaponKey: 'subweapon:drill' }, 1250, false), true,
  '武器変更は低頻度同期する');
assert.equal(protocol.shouldSyncMove({ x: 100, sentAt: 1249 }, { x: 101 }, 1250, true), true, 'READY時は最終位置を必ず同期');
assert.deepEqual(protocol.friendlyFireEffect({ damage: 45, knockback: 10, terrainRadius: 44 }),
  { damage: 22.5, knockback: 10, terrainRadius: 44 });
assert.deepEqual(protocol.supportFireEffect(), { damage: 0, knockback: 0, hostile: false });
assert.deepEqual(protocol.advanceWind(volley, { direction: 1, strength: 8 }), {
  wind: { direction: -1, strength: 4 }, nextWind: { direction: 1, strength: 8 },
});

const firebaseVolleyActions = battle.scheduleVolleyActions({
  p1: {
    x: 120, fuelSpent: 8, aim: { x: 300, y: 120 }, weapon: { kind: 'normal', id: 'normal' },
    committedAt: startedAt + 1500, auto: false,
  },
  e1: {
    x: 160, fuelSpent: 4, aim: { x: 330, y: 140 }, weapon: { kind: 'special', id: 'special' },
    committedAt: startedAt + 1800, auto: false,
  },
}, startedAt + 2100);
assert.deepEqual(Object.keys(firebaseVolleyActions), ['p1', 'e1']);
assert.deepEqual(firebaseVolleyActions.p1, {
  x: 120, fuelSpent: 8, aim: { x: 300, y: 120 }, weapon: { kind: 'normal', id: 'normal' },
  scheduledAt: startedAt + 2100, auto: false,
}, 'Firebaseへ送るvolleyからcommit専用のcommittedAtを除く');
assert.equal('committedAt' in firebaseVolleyActions.e1, false,
  '全席のvolleyがSecurity Rulesの許可フィールドだけを送る');

assert.ok(rules.round, '協力部屋に現在ラウンド境界が必要');
assert.ok(rules.rounds, '協力部屋に追記専用ラウンド通信が必要');
const message = rules.rounds.$roundId.messages.$message;
assert.match(message.t['.validate'], /'move'/);
assert.match(message.t['.validate'], /'commit'/);
assert.match(message.t['.validate'], /'volley'/);
assert.match(message.t['.validate'], /'net'/,
  'ライブ協力戦は通常対戦エンジンのnetパケットを通す');
assert.match(message['.write'], /slots/);
assert.match(message['.write'], /hostUid/);
assert.match(message['.write'], /newData\.child\('t'\)\.val\(\) === 'net'/,
  'netパケットは送信席本人だけが追記できる');
assert.match(message['.write'], /!data\.exists\(\)/, 'ラウンド通信は追記専用');
assert.match(message.sentAt['.validate'], /120000/);
assert.match(message.payload['.validate'], /length <= 220000/,
  '通常エンジンの同期本文にはサイズ上限がある');
assert.equal(message.$other['.validate'], false, '未知フィールドを受け入れない');
assert.ok(message.aim && message.weapon, 'タイムアウト確定用に照準と武器のdraftを検証する');
assert.match(message.weapon.id['.validate'], /parent\(\)\.child\('kind'\)/,
  '武器kindとidの組合せをFirebase側でも許可リストへ限定する');
assert.match(message.action.weapon.id['.validate'], /'rescue-kit'.*'healing-kit'.*'debuff-grenade'/,
  'READY actionは既知のCO-OP ITEMだけを受理する');
assert.equal(message.actions['.validate'], 'newData.hasChildren()',
  'Security Rulesで未対応のnumChildrenを使わず、1件以上の確定行動を要求する');
assert.doesNotMatch(message.actions['.validate'], /numChildren/,
  'Realtime Database Security Rulesに存在しないSDK用メソッドを混ぜない');
assert.match(message.actions.$seat['.validate'], /\^\(p1\|e1\|s1\|s2\)\$/,
  '確定行動は4席の許可リストで最大4件に制限する');
assert.match(message.actions.$seat.weapon.id['.validate'], /'barrier'.*'impact'.*'drill'/,
  '確定volleyは既知のサブウェポンだけを受理する');

console.log('協力ラウンド: 旧一斉入力互換＋通常ターン制net通信（44/44 passed）');
