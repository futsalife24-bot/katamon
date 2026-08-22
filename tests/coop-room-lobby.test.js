const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const room = require('../coop-mvp-room.js');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8')).rules;
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const roomSource = fs.readFileSync(path.join(root, 'coop-mvp-room.js'), 'utf8');

assert.equal(room.ROOM_PROTOCOL, 1);
assert.deepEqual(room.SEATS, ['p1', 'e1', 's1', 's2']);
assert.equal(room.normalizeRoomCode('io10-abcd-z'), 'ABCDZ');
assert.equal(room.isRoomCode('A8TM4NAF'), true);
assert.equal(room.isRoomCode('A8TM1NAF'), false);

const baseSlot = room.normalizeSlot({
  uid: 'u1', name: '<b>メロニキ</b>', character: 'kyoryu',
  subweapon: 'barrier', coopItem: 'healing-kit', ready: true,
}, { characterIds: ['kyoryu'], inventory: { barrier: true, 'healing-kit': true, 'rescue-kit': true } });
assert.equal(baseSlot.name, 'メロニキ', 'ロビー名はHTMLとして解釈しない形へ正規化する');
assert.equal(baseSlot.ready, true);
const changed = room.applyEquipmentChange(baseSlot, { character: 'kyoryu', subweapon: null, coopItem: 'rescue-kit' });
assert.equal(changed.ready, false, '装備変更時はREADYを解除する');

const host = { uid: 'host', ready: true };
const guest = { uid: 'guest', ready: true };
assert.equal(room.canHostStart({ p1: host, e1: guest }, { aiFill: false }), true);
assert.equal(room.canHostStart({ p1: host, e1: { ...guest, ready: false } }, { aiFill: false }), false);
assert.equal(room.canHostStart({ p1: host }, { aiFill: false }), false, 'AI補充OFFは人間2人以上が必要');
assert.equal(room.canHostStart({ p1: host }, { aiFill: true }), false, 'AI補充ONでも参加人数は人間2人以上が必要');
assert.equal(room.canHostStart({ p1: host, e1: { ...guest, ready: false } }, { aiFill: true }), false,
  'AI補充ONでも参加中の人間のREADYを飛ばさない');

assert.ok(rules.coopOpen, '通常openと分離したcoopOpenが必要');
assert.ok(rules.coopRooms, '通常roomsと分離したcoopRoomsが必要');
assert.equal(rules.coopOpen['.read'], 'auth != null');
assert.match(rules.coopRooms.$room['.read'], /slots/);
assert.match(rules.coopRooms.$room.slots.$seat['.write'], /e1\|s1\|s2/);
assert.match(rules.coopRooms.$room.settings['.write'], /hostUid/);
assert.match(rules.coopRooms.$room.settings.difficulty['.validate'], /normal/);
assert.match(rules.coopRooms.$room.settings.difficulty['.validate'], /extreme/);
assert.match(rules.coopRooms.$room.settings.aiFill['.validate'], /isBoolean/);
assert.match(rules.coopRooms.$room.slots.$seat.ready['.validate'], /isBoolean/);
assert.match(rules.coopRooms.$room.slots.$seat.name['.validate'], /length <= 12/);

assert.match(indexHtml, /KatamonCoopBridge/);
assert.match(indexHtml, /<script src="coop-mvp-room\.js"><\/script>/);
assert.doesNotMatch(indexHtml, /titleCoopBtn|drawTitleWoodButtonText\([^\n]*'CO-OP BOSS'/,
  '凍結仕様どおりタイトルへ協力ボスの大ボタンを追加しない');
assert.match(indexHtml, /id="onlineKindActions"/);
assert.match(indexHtml, /id="onlineVersusKind"[^>]*>対戦/);
assert.match(indexHtml, /id="onlineCoopKind"[^>]*>協力ボス/);
assert.match(indexHtml, /onlineLobbyEl\.classList\.add\('coop-choice'\)/,
  '機能ON時だけONLINE BATTLE内で対戦か協力ボスを選ぶ');
assert.match(indexHtml, /通常対戦の部屋と協力ボスの部屋は別々に管理されます/,
  '対戦種別を選ぶ前に旧対戦専用案内を残さない');
assert.match(indexHtml, /KatamonCoopRoom\?\.openLobby\(\)/);
assert.doesNotMatch(roomSource, /coopBossLauncher/,
  'Canvas外へ世界観の異なる浮遊ボタンを重ねない');
assert.match(serviceWorker, /'\.\/coop-mvp-room\.js'/);
assert.doesNotMatch(room.sourceNamespaces(), /(^|\/)open($|\/)|(^|\/)rooms($|\/)/,
  '協力ロビーは通常ONLINE名前空間を使わない');
assert.match(roomSource, /coopRooms\/\$\{session\.code\}\/expiresAt/,
  'ホストは部屋TTLより短い間隔で協力部屋を延命する');
assert.match(roomSource, /lastLeaseAt[\s\S]{0,180}60000/);

console.log('協力専用部屋・4席ロビー・Rules分離（32/32 passed）');
