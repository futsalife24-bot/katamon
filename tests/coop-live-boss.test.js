const assert = require('node:assert/strict');

const boss = require('../coop-mvp-boss.js');

let checks = 0;
function check(message, condition) {
  checks += 1;
  assert.ok(condition, message);
}

let state = boss.createLiveState({ bodyMaxHp: 2200, difficulty: 'normal' });
check('ライブ要塞はPhase 1・CORE閉鎖で開始', state.phase === 1 && !state.core.exposed && state.core.charge === 0);
check('Phase 1ではミサイルポッドだけ封印', !state.parts.missilePod.active
  && ['twinCannon', 'mainCannon', 'frontArmor'].every((id) => state.parts[id].active));
check('開始状態はオンライン開始snapshotとして安全', boss.liveStateLooksSafe(state, { bodyMaxHp: 2200, difficulty: 'normal' })
  && boss.liveStateIsInitial(state, { bodyMaxHp: 2200, difficulty: 'normal' }));
check('無傷のPhase 1は通常要塞砲プロファイル', boss.liveAttackProfile(state).weapon === 'cannon'
  && boss.liveAttackProfile(state).damageMultiplier === 1);
check('攻撃プロファイルは事前予告用の名称と危険範囲を持つ',
  boss.liveAttackProfile(state).warningLabel === '要塞砲撃'
    && boss.liveAttackProfile(state).warningRadius >= 40);

let target = boss.resolveLiveTarget(state, { x: 0.48, y: 0.18 });
check('主砲の見た目座標を主砲部位として解決', target.kind === 'part' && target.partId === 'mainCannon');
let hit = boss.applyLiveDamage(state, target, 45);
check('部位直撃は部位へ45、本体へ40%の18', hit.partDamage === 45 && hit.bodyDamage === 18);
check('部位を削るとCOREゲージだけ増える', hit.state.core.charge > 0 && !hit.state.core.exposed);

const hullTarget = boss.resolveLiveTarget(state, { x: 0.70, y: 0.80 });
check('部位外の車体は装甲本体として解決', hullTarget.kind === 'hull');
const hullHit = boss.applyLiveDamage(state, hullTarget, 45);
check('装甲本体への45直撃は30へ軽減', hullHit.bodyDamage === 30 && hullHit.partDamage === 0);

for (const partId of ['twinCannon', 'mainCannon', 'frontArmor']) {
  const part = state.parts[partId];
  const result = boss.applyLiveDamage(state, { kind: 'part', partId }, part.hp);
  state = result.state;
}
check('Phase 1の3部位を狙って破壊するとCOREが開く', state.core.exposed && state.core.trigger === 'parts');
check('強制CORE露出はゲージを0へ戻す', state.core.charge === 0);
check('NORMALのCORE露出は2ラウンド', state.core.roundsRemaining === 2);

target = boss.resolveLiveTarget(state, { x: boss.LIVE_CORE_SHAPE.x, y: boss.LIVE_CORE_SHAPE.y });
check('露出中だけ中央発光部をCOREとして解決', target.kind === 'core');
hit = boss.applyLiveDamage(state, target, 45);
check('NORMALのCORE直撃45は2倍の90', hit.bodyDamage === 90 && hit.coreMultiplier === 2);
check('CORE露出中でも装甲へ外すと30のまま', boss.applyLiveDamage(state, { kind: 'hull' }, 45).bodyDamage === 30);

state = boss.advanceLiveBossRound(state);
check('ボス行動1回後もCOREは残り1ラウンド', state.core.exposed && state.core.roundsRemaining === 1);
state = boss.advanceLiveBossRound(state);
check('NORMALはボス行動2回後にCORE閉鎖', !state.core.exposed && state.core.roundsRemaining === 0);

state = boss.activateLivePhase2(state);
check('Phase 2変形でミサイルポッドが解禁', state.phase === 2 && state.parts.missilePod.active);
check('Phase 2変形は見た目だけでなくCOREを再露出', state.core.exposed && state.core.trigger === 'phase2' && state.core.roundsRemaining === 2);
check('Phase 2状態もオンラインsnapshotとして安全', boss.liveStateLooksSafe(state, { bodyMaxHp: 2200, difficulty: 'normal' }));
check('Phase 2のミサイルポッドは砲撃範囲と威力を強化', boss.liveAttackProfile(state).weapon === 'missile'
  && boss.liveAttackProfile(state).blastMultiplier > 1.6 && boss.liveAttackProfile(state).damageMultiplier > 1
  && boss.liveAttackProfile(state).warningLabel === 'ミサイル斉射');
state = boss.applyLiveDamage(state, { kind: 'part', partId: 'missilePod' }, state.parts.missilePod.hp).state;
check('ミサイルポッド破壊で強化砲撃を封じる', boss.liveAttackProfile(state).weapon === 'cannon'
  && boss.liveAttackProfile(state).damageMultiplier === 0.72 && boss.liveAttackProfile(state).radius === 8);

let cannonState = boss.createLiveState({ bodyMaxHp: 2200, difficulty: 'normal' });
const twinAnchor = boss.liveAttackProfile(cannonState);
cannonState = boss.applyLiveDamage(cannonState, { kind: 'part', partId: 'twinCannon' }, cannonState.parts.twinCannon.hp).state;
const mainAnchor = boss.liveAttackProfile(cannonState);
check('連装砲破壊後は生きている主砲から発射', twinAnchor.anchorX !== mainAnchor.anchorX
  && mainAnchor.anchorX === boss.PART_DEFS.mainCannon.x && mainAnchor.anchorY === boss.PART_DEFS.mainCannon.y);

let transitionBefore = boss.createLiveState({ bodyMaxHp: 2200, difficulty: 'normal' });
transitionBefore = boss.applyLiveDamage(transitionBefore, { kind: 'part', partId: 'frontArmor' }, 45).state;
const transitionAfter = boss.activateLivePhase2(transitionBefore);
check('正しいPhase 2変形だけを通信境界として許可', boss.livePhase2TransitionLooksSafe(
  transitionBefore, transitionAfter, { bodyMaxHp: 2200, difficulty: 'normal' }
));
const forgedTransition = JSON.parse(JSON.stringify(transitionAfter));
forgedTransition.parts.frontArmor.hp = Math.max(0, forgedTransition.parts.frontArmor.hp - 1);
forgedTransition.parts.frontArmor.destroyed = forgedTransition.parts.frontArmor.hp === 0;
check('変形に混ぜた装甲の追加破壊を拒否', !boss.livePhase2TransitionLooksSafe(
  transitionBefore, forgedTransition, { bodyMaxHp: 2200, difficulty: 'normal' }
));

const hard = boss.exposeLiveCore(boss.createLiveState({ bodyMaxHp: 2400, difficulty: 'hard' }), 'attack');
check('HARDのCORE倍率は1.75', boss.applyLiveDamage(hard, { kind: 'core' }, 40).bodyDamage === 70);
const extreme = boss.activateLivePhase2(boss.createLiveState({ bodyMaxHp: 2600, difficulty: 'extreme' }));
check('EXTREMEのCOREは1ラウンド', extreme.core.roundsRemaining === 1);
check('EXTREMEのCORE倍率は1.5', boss.applyLiveDamage(extreme, { kind: 'core' }, 40).bodyDamage === 60);

const tampered = JSON.parse(JSON.stringify(state));
tampered.parts.mainCannon.maxHp += 1;
check('部位耐久値を改変したsnapshotは拒否', !boss.liveStateLooksSafe(tampered, { bodyMaxHp: 2200, difficulty: 'normal' }));
const forgedInactive = boss.createLiveState({ bodyMaxHp: 2200, difficulty: 'normal' });
forgedInactive.parts.missilePod.hp -= 1;
forgedInactive.parts.missilePod.destroyed = false;
check('Phase 1で封印中のミサイル耐久改変を拒否', !boss.liveStateLooksSafe(forgedInactive, { bodyMaxHp: 2200, difficulty: 'normal' }));
const forgedClosedCore = boss.createLiveState({ bodyMaxHp: 2200, difficulty: 'normal' });
forgedClosedCore.core.trigger = 'parts';
check('閉じたCOREへ露出理由だけを残す改変を拒否', !boss.liveStateLooksSafe(forgedClosedCore, { bodyMaxHp: 2200, difficulty: 'normal' }));

console.log(`協力ライブ要塞: 装甲・部位・CORE・Phase 2（${checks}/${checks} passed）`);
