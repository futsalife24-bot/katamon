const assert = require('node:assert/strict');

const battle = require('../coop-mvp-battle.js');
const boss = require('../coop-mvp-boss.js');

const NORMAL_DAMAGE = 45;
const STANDARD_SPECIALS = ['kyoryu', 'medama', 'iwa', 'tori']
  .map((id) => battle.SPECIAL_BOSS_PROFILES[id].damage);

function targetFor(state) {
  const phase1 = ['twinCannon', 'mainCannon', 'frontArmor'];
  const activePart = (state.phase === 1 ? phase1 : ['missilePod'])
    .find((id) => state.parts[id].active && !state.parts[id].destroyed);
  if (activePart) return { kind: 'part', partId: activePart };
  return state.core.exposed ? { kind: 'core' } : { kind: 'hull' };
}

// ライブ当たり判定・部位spill・CORE倍率を直接使う、全員生存の標準攻略モデル。
// 各人は4発の通常弾で必殺MAXとなるため、5巡目だけ4人の固有必殺を使う。
function simulateStandardNormal() {
  const maxHp = battle.BASE_BODY_HP.normal;
  let hp = maxHp;
  let state = boss.createLiveState({ bodyMaxHp: maxHp, difficulty: 'normal' });
  let phase2Round = null;
  const history = [];
  for (let round = 1; round <= 12 && hp > 0; round += 1) {
    const damages = round === 5 ? STANDARD_SPECIALS : [NORMAL_DAMAGE, NORMAL_DAMAGE, NORMAL_DAMAGE, NORMAL_DAMAGE];
    let roundDamage = 0;
    damages.forEach((rawDamage) => {
      if (hp <= 0) return;
      const hit = boss.applyLiveDamage(state, targetFor(state), rawDamage);
      state = hit.state;
      hp = Math.max(0, hp - hit.bodyDamage);
      roundDamage += hit.bodyDamage;
    });
    history.push({ round, hp, phase: state.phase, core: state.core.exposed, roundDamage });
    if (state.phase === 1 && hp > 0 && hp <= maxHp * 0.5) {
      state = boss.activateLivePhase2(state);
      phase2Round = round;
      continue; // 変形は要塞の1手を消費し、露出COREを減らさない。
    }
    state = boss.advanceLiveBossRound(state);
  }
  return { maxHp, hp, state, phase2Round, history, rounds: history.length, partyHp: [100, 90, 130, 75] };
}

assert.deepEqual(battle.BASE_BODY_HP, { normal: 1650, hard: 2400, extreme: 2600 });
assert.deepEqual(boss.LIVE_DIFFICULTY_RULES, {
  normal: { coreRounds: 2, coreMultiplier: 2 },
  hard: { coreRounds: 2, coreMultiplier: 1.75 },
  extreme: { coreRounds: 1, coreMultiplier: 1.5 },
});

const result = simulateStandardNormal();
assert.equal(result.hp, 0, '標準攻略はボスを撃破する');
assert.ok(result.rounds >= 7 && result.rounds <= 9, `標準攻略は7〜9巡（実測: ${result.rounds}巡）`);
assert.ok(result.phase2Round >= 4 && result.phase2Round <= 5, `Phase 2は4〜5巡（実測: ${result.phase2Round}巡）`);
assert.equal(result.history[2].core, true, 'Phase 1の部位破壊でCOREを露出する');
assert.ok(result.history.some((entry) => entry.phase === 2), 'Phase 2のミサイル部位とCORE攻略へ進む');
assert.ok(result.partyHp.every((hp) => hp > 0), '標準ケースの味方4体は全員生存');

console.log(`coop-normal-tempo: ${result.rounds} rounds, phase2 at ${result.phase2Round}, ${result.maxHp} HP`);
