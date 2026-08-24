const assert = require('node:assert/strict');

const boss = require('../coop-mvp-boss.js');
const ai = require('../coop-mvp-boss-ai.js');

assert.deepEqual(ai.DIFFICULTY_RULES.normal, {
  coreRounds: 2, coreMultiplier: 2, roundLimit: 12, bigTelegraphRounds: 1,
  blockBigAfterBig: true, phase2DoubleActionChance: 0,
});
assert.deepEqual(ai.DIFFICULTY_RULES.hard, {
  coreRounds: 2, coreMultiplier: 1.75, roundLimit: 15, bigTelegraphRounds: 0,
  blockBigAfterBig: true, phase2DoubleActionChance: 0,
});
assert.deepEqual(ai.DIFFICULTY_RULES.extreme, {
  coreRounds: 1, coreMultiplier: 1.5, roundLimit: 12, bigTelegraphRounds: 0,
  blockBigAfterBig: false, phase2DoubleActionChance: 0.25,
});
assert.deepEqual(Object.keys(ai.ATTACKS), ['grandCannon', 'twinBarrage', 'terrainBreaker', 'missileBombardment']);
assert.equal(ai.ATTACKS.grandCannon.requiredPart, 'mainCannon');
assert.equal(ai.ATTACKS.twinBarrage.requiredPart, 'twinCannon');
assert.equal(ai.ATTACKS.terrainBreaker.requiredPart, null);
assert.equal(ai.ATTACKS.missileBombardment.requiredPart, 'missilePod');
assert.equal(ai.ATTACKS.grandCannon.category, 'big');
assert.equal(ai.ATTACKS.twinBarrage.category, 'normal');
assert.equal(ai.getTelegraph(ai.ATTACKS.grandCannon, 'normal').roundsAhead, 1);
assert.equal(ai.getTelegraph(ai.ATTACKS.grandCannon, 'hard').roundsAhead, 0);
assert.equal(ai.getTelegraph(ai.ATTACKS.twinBarrage, 'normal').style, 'subtle');
assert.equal(ai.getTelegraph(ai.ATTACKS.terrainBreaker, 'extreme').style, 'danger-red');

let encounter = ai.createEncounter({ difficulty: 'hard', bodyHp: 5000, partUnitHp: 500 });
assert.equal(encounter.round, 1);
assert.deepEqual(encounter.core, { charge: 0, exposed: false, roundsRemaining: 0, trigger: null, availableFromRound: null });
const placement = boss.createFortressStage().boss;
const mainPoint = boss.partCenter(placement, 'mainCannon');
const mainTarget = boss.resolveImpactTarget(encounter.boss, placement, mainPoint, 20);
let damage = ai.applyEncounterDamage(encounter, mainTarget, 250);
encounter = damage.encounter;
assert.equal(encounter.core.charge, 7.5, '部位HP半分でCORE +7.5%');
damage = ai.applyEncounterDamage(encounter, mainTarget, 250);
encounter = damage.encounter;
assert.equal(encounter.core.charge, 40, '1部位完全破壊で削り15%＋破壊25%');
assert.equal(damage.notification, 'MAIN CANNON DESTROYED');

encounter = { ...encounter, core: { ...encounter.core, charge: 99 } };
const twinPoint = boss.partCenter(placement, 'twinCannon');
const twinTarget = boss.resolveImpactTarget(encounter.boss, placement, twinPoint, 10);
damage = ai.applyEncounterDamage(encounter, twinTarget, 100);
encounter = damage.encounter;
assert.equal(encounter.core.exposed, true);
assert.equal(encounter.core.charge, 0, 'CORE100%の強制露出は0%へリセット');
assert.equal(encounter.core.trigger, 'forced');
assert.equal(encounter.core.roundsRemaining, 2);

const beforeExposedBody = encounter.boss.body.hp;
damage = ai.applyEncounterDamage(encounter, { kind: 'body' }, 100);
encounter = damage.encounter;
assert.equal(beforeExposedBody - encounter.boss.body.hp, 175, 'HARD露出中は1.75倍');
assert.equal(encounter.core.charge, 0, '露出中はCORE増加停止');

encounter = ai.finishRound(encounter, []);
assert.equal(encounter.round, 2);
assert.equal(encounter.core.roundsRemaining, 1);
encounter = ai.finishRound(encounter, []);
assert.equal(encounter.round, 3);
assert.equal(encounter.core.exposed, false, '規定ラウンド終了時に閉じる');

let auto = ai.createEncounter({ difficulty: 'normal', bodyHp: 5000, partUnitHp: 500 });
auto = { ...auto, core: { ...auto.core, charge: 63 } };
auto = ai.finishRound(auto, [{ id: 'grandCannon' }]);
assert.equal(auto.round, 2);
assert.equal(auto.core.exposed, true);
assert.equal(auto.core.charge, 63, '大技後の自動露出はゲージ維持');
assert.equal(auto.core.availableFromRound, 2, '大技後は次ラウンドから露出');
assert.equal(auto.core.roundsRemaining, 2, 'NORMALのCORE露出は2ラウンド');
auto = ai.finishRound(auto, []);
assert.equal(auto.core.roundsRemaining, 1);
auto = ai.finishRound(auto, []);
assert.equal(auto.core.exposed, false, 'NORMALは2ラウンド終了時にCOREが閉じる');

let phase = ai.createEncounter({ difficulty: 'normal', bodyHp: 5000, partUnitHp: 500 });
phase = ai.applyEncounterDamage(phase, { kind: 'body' }, 3250).encounter;
const transition = ai.finishPlayerVolley(phase);
assert.equal(transition.encounter.boss.body.hp, 1750, '50%ストッパーを置かない');
assert.equal(transition.phaseTransitionPending, true);
assert.equal(transition.skipBossAction, true, 'Phase移行ラウンドはボスが即攻撃しない');
phase = ai.completePhase2Transition(transition.encounter);
assert.equal(phase.boss.phase, 2);
assert.equal(phase.boss.parts.missilePod.active, true);
assert.equal(phase.round, 2, '変形後は次ラウンドをプレイヤーから開始');

const intact = ai.createEncounter({ difficulty: 'normal', bodyHp: 5000, partUnitHp: 500 });
const firstPlan = ai.planBossActions(intact, () => 0);
assert.equal(firstPlan.actions.length, 1);
const preparedId = firstPlan.actions[0].id;
const destroyedAfterTell = JSON.parse(JSON.stringify(firstPlan.encounter));
const requiredPart = ai.ATTACKS[preparedId].requiredPart;
if (requiredPart) destroyedAfterTell.boss.parts[requiredPart].destroyed = true;
assert.equal(ai.resolvePreparedActions(firstPlan.actions, destroyedAfterTell)[0].id, preparedId,
  '予告済みの技は部位破壊後もその1回だけ発動');

let sealed = ai.createEncounter({ difficulty: 'normal', bodyHp: 5000, partUnitHp: 500 });
sealed.boss.parts.mainCannon.destroyed = true;
sealed.boss.parts.twinCannon.destroyed = true;
sealed.boss.parts.missilePod.destroyed = true;
sealed = { ...sealed, boss: boss.activatePhase2(sealed.boss) };
const sealedPlan = ai.planBossActions(sealed, () => 0.5);
assert.deepEqual(sealedPlan.actions.map((action) => action.id), ['terrainBreaker'], '全部位破壊後は本体技だけ');

let noRepeat = ai.createEncounter({ difficulty: 'hard', bodyHp: 5000, partUnitHp: 500 });
noRepeat.lastAttackId = 'grandCannon';
noRepeat.lastAttackCategory = 'big';
const noRepeatPlan = ai.planBossActions(noRepeat, () => 0.99);
assert.ok(noRepeatPlan.actions.every((action) => action.category !== 'big'));
assert.ok(noRepeatPlan.actions.every((action) => action.id !== 'grandCannon'));

let extreme = ai.createEncounter({ difficulty: 'extreme', bodyHp: 5000, partUnitHp: 500 });
extreme = { ...extreme, boss: boss.activatePhase2(extreme.boss) };
const randomValues = [0.1, 0.1, 0.9];
const extremePlan = ai.planBossActions(extreme, () => randomValues.shift() ?? 0.5);
assert.equal(extremePlan.actions.length, 2, 'EXTREME Phase2は25%で2回行動');
assert.notEqual(extremePlan.actions[0].id, extremePlan.actions[1].id, '同じ技の連続使用禁止');
assert.equal(extremePlan.actions[1].secondAction, true);

assert.equal(ai.isRoundLimitDefeat({ ...intact, round: 12 }), false);
assert.equal(ai.isRoundLimitDefeat({ ...intact, round: 13 }), true);
assert.equal(ai.isRoundLimitDefeat({ ...noRepeat, round: 16 }), true);
assert.equal(ai.isRoundLimitDefeat({ ...extreme, round: 13 }), true);

console.log('協力ボスCORE・Phase2・4技AI（57/57 passed）');
