const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../coop-mvp-foundation.js');
const subweapons = require('../subweapon-mvp.js');

assert.deepEqual(foundation.SUBWEAPONS.map(({ id, price, usesPerMatch }) => ({ id, price, usesPerMatch })), [
  { id: 'barrier', price: 100, usesPerMatch: 1 },
  { id: 'impact', price: 200, usesPerMatch: 1 },
  { id: 'drill', price: 200, usesPerMatch: 1 },
]);
assert.equal(subweapons.USES_PER_MATCH, 1);
assert.equal(subweapons.GUIDE_COLOR, '#f29a38');

let state = subweapons.createMatchState({ p1: 'barrier', e1: 'impact', s1: 'drill', s2: 'unknown' });
assert.deepEqual(state, {
  players: {
    p1: { equipped: 'barrier', usesLeft: 1, barrierActive: false },
    e1: { equipped: 'impact', usesLeft: 1, barrierActive: false },
    s1: { equipped: 'drill', usesLeft: 1, barrierActive: false },
    s2: { equipped: null, usesLeft: 0, barrierActive: false },
  },
});

let barrier = subweapons.activateBarrier(state, 'p1');
state = barrier.state;
assert.equal(barrier.consumed, true);
assert.equal(state.players.p1.usesLeft, 0);
assert.equal(state.players.p1.barrierActive, true);

let hit = subweapons.applyIncomingDamage(state, 'p1', 80);
state = hit.state;
assert.equal(hit.damage, 40, 'バリアは次の1回だけ被ダメージを半減');
assert.equal(hit.blocked, 40);
assert.equal(hit.barrierConsumed, true);
assert.equal(state.players.p1.barrierActive, false);

hit = subweapons.applyIncomingDamage(state, 'p1', 80);
assert.equal(hit.damage, 80, '2回目以降は通常ダメージ');
assert.equal(hit.barrierConsumed, false);
barrier = subweapons.activateBarrier(state, 'p1');
assert.equal(barrier.consumed, false, '1試合1回を超えて使えない');

let fired = subweapons.fireProjectile(state, 'e1', 'impact');
state = fired.state;
assert.equal(fired.consumed, true);
assert.deepEqual(fired.projectile, {
  gravity: 650,
  velocityScale: 7.8,
  affectedByWind: true,
  guide: 'normal',
  guideColor: '#f29a38',
  damage: 25,
  knockbackSpeed: 160,
  terrainRadius: 0,
});
assert.equal(state.players.e1.usesLeft, 0);
assert.equal(subweapons.fireProjectile(state, 'e1', 'impact').consumed, false);

fired = subweapons.fireProjectile(state, 's1', 'drill');
state = fired.state;
assert.equal(fired.consumed, true);
assert.equal(fired.projectile.damage, 15, '掘削弾は衝撃弾より低威力');
assert.equal(fired.projectile.knockbackSpeed, 0);
assert.equal(fired.projectile.terrainRadius, 88, '通常弾44pxの2倍を掘削');
assert.equal(fired.projectile.guideColor, '#f29a38');
assert.equal(state.players.s1.usesLeft, 0);

assert.equal(subweapons.fireProjectile(state, 'p1', 'impact').consumed, false,
  '装備していないサブウェポンは使えない');
assert.equal(subweapons.equipmentChangedAfterReady('impact', 'drill'), true);
assert.equal(subweapons.equipmentChangedAfterReady('impact', 'impact'), false);
assert.equal(subweapons.equipmentChangedAfterReady(null, 'unknown'), false);

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(gameSource, /const selectSubweaponBtn = \{/,
  'キャラ選択画面に小さいSUB欄を持つ');
assert.match(gameSource, /function cycleSelectedSubweapon\(\)/,
  '専用装備画面を増やさず、所持済みSUBを切り替えられる');
assert.match(gameSource, /progress\.equipment\.subweapon = selectedSubweapon/,
  '装備は端末内の正規進捗へ保存する');
assert.match(gameSource, /COOP_MVP_FEATURE_ENABLED && hitRect\(p0, selectSubweaponBtn\)/,
  'SUB欄が実際のタップ操作へ接続されている');
assert.match(gameSource, /function launchSubweaponShot\(/,
  '通常CPU戦・ONLINE戦も共通発射口からSUBを使用する');
assert.match(gameSource, /const impact = subweaponId === 'impact';[\s\S]*?noTerrain: true,[\s\S]*?knockbackSpeed: 160/,
  '衝撃弾はノックバックだけを与え地形を削らない');
assert.match(gameSource, /explodeAt\([^\n]+!!p\.noTerrain, p\)/,
  '実弾の地形非破壊指定を着弾処理まで維持する');
assert.match(gameSource, /subweaponId: opts\.subweaponId \|\| null/,
  '衝撃弾と掘削弾の種別を弾へ保持する');
assert.match(gameSource, /subweaponBarrierActive: u\.subweaponBarrierActive === true/,
  'バリア状態はターン境界snapshotへ保持する');
assert.match(gameSource, /mitigateDamageWithSubweaponBarrier/,
  '通常対戦の次の被弾をバリアで半減する');
assert.match(gameSource, /COOP_MVP_FEATURE_ENABLED && battleMode === 'normal'/,
  'feature flag OFFやチュートリアルでは通常対戦SUBを出さない');

console.log('サブウェポン3種の役割・装備・1試合1回（44/44 passed）');
