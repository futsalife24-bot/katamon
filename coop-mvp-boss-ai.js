(function attachCoopBossAi(root, factory) {
  const bossApi = typeof module === 'object' && module.exports
    ? require('./coop-mvp-boss.js') : root?.KatamonCoopBoss;
  const api = factory(bossApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopBossAi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopBossAi(boss) {
  'use strict';

  const DIFFICULTY_RULES = Object.freeze({
    normal: Object.freeze({ coreRounds: 2, coreMultiplier: 2, roundLimit: 20, bigTelegraphRounds: 1, blockBigAfterBig: true, phase2DoubleActionChance: 0 }),
    hard: Object.freeze({ coreRounds: 2, coreMultiplier: 1.75, roundLimit: 15, bigTelegraphRounds: 0, blockBigAfterBig: true, phase2DoubleActionChance: 0 }),
    extreme: Object.freeze({ coreRounds: 1, coreMultiplier: 1.5, roundLimit: 12, bigTelegraphRounds: 0, blockBigAfterBig: false, phase2DoubleActionChance: 0.25 }),
  });
  const ATTACKS = Object.freeze({
    grandCannon: Object.freeze({ id: 'grandCannon', label: '巨砲撃', category: 'big', requiredPart: 'mainCannon', phase: 1, weight: 28, exposesCore: true, targetMode: 'single' }),
    twinBarrage: Object.freeze({ id: 'twinBarrage', label: '連装砲乱射', category: 'normal', requiredPart: 'twinCannon', phase: 1, weight: 36, exposesCore: false, targetMode: 'spread' }),
    terrainBreaker: Object.freeze({ id: 'terrainBreaker', label: '地形崩壊弾', category: 'big', requiredPart: null, phase: 1, weight: 22, exposesCore: true, targetMode: 'terrain' }),
    missileBombardment: Object.freeze({ id: 'missileBombardment', label: 'ミサイル爆撃', category: 'big', requiredPart: 'missilePod', phase: 2, weight: 14, exposesCore: false, targetMode: 'area' }),
  });
  const ATTACK_ORDER = Object.freeze(Object.keys(ATTACKS));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function rulesFor(difficulty) {
    return DIFFICULTY_RULES[difficulty] || DIFFICULTY_RULES.normal;
  }

  function createEncounter(options = {}) {
    const difficulty = DIFFICULTY_RULES[options.difficulty] ? options.difficulty : 'normal';
    if (!boss?.createBossState) throw new Error('boss model is unavailable');
    return {
      difficulty,
      round: 1,
      boss: boss.createBossState(options),
      core: { charge: 0, exposed: false, roundsRemaining: 0, trigger: null, availableFromRound: null },
      lastAttackId: null,
      lastAttackCategory: null,
      plannedActions: [],
      phaseTransitionPending: false,
      playerStarts: true,
    };
  }

  function getCoreDamageMultiplier(encounter) {
    return encounter?.core?.exposed ? rulesFor(encounter.difficulty).coreMultiplier : 1;
  }

  function exposeCore(encounter, trigger, availableFromRound) {
    const next = clone(encounter);
    const forced = trigger === 'forced';
    if (forced) next.core.charge = 0;
    next.core.exposed = true;
    next.core.roundsRemaining = rulesFor(next.difficulty).coreRounds;
    next.core.trigger = forced ? 'forced' : 'auto';
    next.core.availableFromRound = Number.isInteger(availableFromRound) ? availableFromRound : next.round;
    return next;
  }

  function closeCore(encounter) {
    const next = clone(encounter);
    next.core.exposed = false;
    next.core.roundsRemaining = 0;
    next.core.trigger = null;
    next.core.availableFromRound = null;
    return next;
  }

  function applyEncounterDamage(encounter, target, rawDamage) {
    let next = clone(encounter);
    const previousPart = target?.kind === 'part' && next.boss.parts[target.partId]
      ? clone(next.boss.parts[target.partId]) : null;
    const scaledDamage = Math.max(0, Number(rawDamage) || 0) * getCoreDamageMultiplier(next);
    const result = boss.applyBossDamage(next.boss, target, scaledDamage);
    next.boss = result.state;

    if (!next.core.exposed && previousPart && !previousPart.destroyed) {
      const currentPart = next.boss.parts[target.partId];
      const actualPartLoss = Math.max(0, previousPart.hp - currentPart.hp);
      const progressGain = previousPart.maxHp > 0 ? actualPartLoss / previousPart.maxHp * 15 : 0;
      const destructionGain = !previousPart.destroyed && currentPart.destroyed ? 25 : 0;
      next.core.charge = Math.min(100, next.core.charge + progressGain + destructionGain);
      if (next.core.charge >= 100) next = exposeCore(next, 'forced', next.round);
    }

    return {
      encounter: next,
      bodyDamage: result.bodyDamage,
      partDamage: result.partDamage,
      notification: result.notification,
      damageMultiplier: getCoreDamageMultiplier(encounter),
    };
  }

  function getTelegraph(attack, difficulty) {
    if (!attack || attack.category !== 'big') return { style: 'subtle', roundsAhead: 0, camera: 'current' };
    return {
      style: 'danger-red',
      roundsAhead: rulesFor(difficulty).bigTelegraphRounds,
      camera: 'overview',
    };
  }

  function availableAttacks(encounter, excludeIds = [], secondAction = false) {
    const excluded = new Set(excludeIds);
    const rules = rulesFor(encounter.difficulty);
    return ATTACK_ORDER.map((id) => ATTACKS[id]).filter((attack) => {
      if (excluded.has(attack.id) || attack.id === encounter.lastAttackId) return false;
      if (attack.phase > encounter.boss.phase) return false;
      if (rules.blockBigAfterBig && encounter.lastAttackCategory === 'big' && attack.category === 'big') return false;
      if (attack.requiredPart) {
        const part = encounter.boss.parts[attack.requiredPart];
        if (!part?.active || part.destroyed) return false;
      }
      return true;
    }).map((attack) => ({
      ...attack,
      effectiveWeight: attack.weight * (secondAction ? (attack.category === 'normal' ? 3 : 0.5) : 1),
    }));
  }

  function weightedPick(entries, random) {
    if (!entries.length) return null;
    const total = entries.reduce((sum, entry) => sum + entry.effectiveWeight, 0);
    let cursor = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
    for (const entry of entries) {
      cursor -= entry.effectiveWeight;
      if (cursor < 0) return entry;
    }
    return entries[entries.length - 1];
  }

  function planBossActions(encounter, random = Math.random) {
    const next = clone(encounter);
    if (next.phaseTransitionPending || next.boss.body.hp <= 0) return { encounter: next, actions: [] };
    const rules = rulesFor(next.difficulty);
    const wantsSecond = next.difficulty === 'extreme' && next.boss.phase >= 2
      && random() < rules.phase2DoubleActionChance;
    const first = weightedPick(availableAttacks(next), random);
    const picked = first ? [first] : [];
    if (wantsSecond && first) {
      const second = weightedPick(availableAttacks(next, [first.id], true), random);
      if (second) picked.push(second);
    }
    const actions = picked.map((attack, index) => ({
      id: attack.id,
      label: attack.label,
      category: attack.category,
      requiredPart: attack.requiredPart,
      targetMode: attack.targetMode,
      exposesCore: attack.exposesCore,
      plannedRound: next.round,
      secondAction: index > 0,
      telegraph: getTelegraph(attack, next.difficulty),
    }));
    next.plannedActions = clone(actions);
    return { encounter: next, actions };
  }

  function resolvePreparedActions(actions) {
    return clone(Array.isArray(actions) ? actions : []);
  }

  function finishRound(encounter, resolvedActions) {
    let next = clone(encounter);
    if (next.core.exposed && next.core.availableFromRound <= next.round) {
      next.core.roundsRemaining = Math.max(0, next.core.roundsRemaining - 1);
      if (next.core.roundsRemaining === 0) next = closeCore(next);
    }
    const actions = Array.isArray(resolvedActions) ? resolvedActions : [];
    const exposesAfterAction = actions.some((action) => ATTACKS[action.id]?.exposesCore === true);
    if (exposesAfterAction && !next.core.exposed) next = exposeCore(next, 'auto', next.round + 1);
    if (actions.length) {
      const finalAction = actions[actions.length - 1];
      next.lastAttackId = finalAction.id;
      next.lastAttackCategory = ATTACKS[finalAction.id]?.category || finalAction.category || null;
    }
    next.plannedActions = [];
    next.round += 1;
    next.playerStarts = true;
    return next;
  }

  function finishPlayerVolley(encounter) {
    const next = clone(encounter);
    const reachedPhase2 = next.boss.phase === 1
      && next.boss.body.hp > 0
      && next.boss.body.hp <= next.boss.body.maxHp * 0.5;
    if (reachedPhase2) next.phaseTransitionPending = true;
    return { encounter: next, phaseTransitionPending: reachedPhase2, skipBossAction: reachedPhase2 };
  }

  function completePhase2Transition(encounter) {
    const next = clone(encounter);
    if (!next.phaseTransitionPending) return next;
    next.boss = boss.activatePhase2(next.boss);
    next.phaseTransitionPending = false;
    next.plannedActions = [];
    next.round += 1;
    next.playerStarts = true;
    return next;
  }

  function isRoundLimitDefeat(encounter) {
    return Number(encounter?.round || 0) > rulesFor(encounter?.difficulty).roundLimit;
  }

  function drawCoreGauge(context, encounter, rectangle) {
    if (!context || !rectangle) return false;
    const ratio = encounter?.core?.exposed ? 1 : Math.max(0, Math.min(1, Number(encounter?.core?.charge || 0) / 100));
    context.save();
    context.fillStyle = '#080d10';
    context.strokeStyle = '#b87932';
    context.lineWidth = 2;
    context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    const fill = context.createLinearGradient(rectangle.x, 0, rectangle.x + rectangle.width, 0);
    fill.addColorStop(0, '#8d2d1f');
    fill.addColorStop(0.72, '#e48a24');
    fill.addColorStop(1, '#ffe49a');
    context.fillStyle = fill;
    context.fillRect(rectangle.x + 2, rectangle.y + 2, Math.max(0, (rectangle.width - 4) * ratio), Math.max(0, rectangle.height - 4));
    if (encounter?.core?.exposed) {
      context.fillStyle = 'rgba(255,239,175,.28)';
      context.fillRect(rectangle.x, rectangle.y - 2, rectangle.width, rectangle.height + 4);
    }
    context.restore();
    return true;
  }

  return Object.freeze({
    DIFFICULTY_RULES,
    ATTACKS,
    ATTACK_ORDER,
    createEncounter,
    getCoreDamageMultiplier,
    exposeCore,
    closeCore,
    applyEncounterDamage,
    getTelegraph,
    availableAttacks,
    planBossActions,
    resolvePreparedActions,
    finishRound,
    finishPlayerVolley,
    completePhase2Transition,
    isRoundLimitDefeat,
    drawCoreGauge,
  });
});
