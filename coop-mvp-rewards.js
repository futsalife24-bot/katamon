(function attachCoopRewards(root, factory) {
  const foundation = typeof module === 'object' && module.exports
    ? require('./coop-mvp-foundation.js') : root?.KatamonCoopMvp;
  const api = factory(foundation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KatamonCoopRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCoopRewards(foundation) {
  'use strict';

  const RARITY_REWARDS = Object.freeze({ Bronze: 20, Silver: 40, Gold: 80, Legendary: 150 });
  const BOSS_REWARDS = Object.freeze({
    normal: Object.freeze({ victory: 15, firstClear: 30, defeatMax: 5, unlocks: 'hard' }),
    hard: Object.freeze({ victory: 25, firstClear: 60, defeatMax: 10, unlocks: 'extreme' }),
    extreme: Object.freeze({ victory: 40, firstClear: 100, defeatMax: 15, unlocks: null }),
  });
  const ACHIEVEMENTS = Object.freeze([
    { id: 'first-victory', name: 'はじめの一勝', rarity: 'Bronze', target: 1, metric: 'wins', condition: '通常対戦で初勝利' },
    { id: 'victories-10', name: '十番勝負', rarity: 'Silver', target: 10, metric: 'wins', condition: '通常対戦で累計10勝' },
    { id: 'victories-50', name: '歴戦の砲手', rarity: 'Gold', target: 50, metric: 'wins', condition: '通常対戦で累計50勝' },
    { id: 'streak-3', name: '三連砲', rarity: 'Bronze', target: 3, metric: 'bestStreak', condition: '通常対戦で3連勝' },
    { id: 'streak-5', name: '止まらぬ進撃', rarity: 'Silver', target: 5, metric: 'bestStreak', condition: '通常対戦で5連勝' },
    { id: 'clutch-win', name: '崖っぷちの勝者', rarity: 'Gold', target: 1, metric: 'clutchWins', condition: 'HP10%以下で勝利' },
    { id: 'boss-normal', name: '鉄城陥落', rarity: 'Bronze', target: 1, metric: 'normalClears', condition: 'NORMALを初撃破' },
    { id: 'boss-hard', name: '鋼の試練', rarity: 'Silver', target: 1, metric: 'hardClears', condition: 'HARDを初撃破' },
    { id: 'boss-extreme', name: '極限突破', rarity: 'Legendary', target: 1, metric: 'extremeClears', condition: 'EXTREMEを初撃破' },
    { id: 'first-rescue', name: '救いの一射', rarity: 'Bronze', target: 1, metric: 'rescues', condition: '味方を初めて救助' },
    { id: 'rescues-10', name: '不屈の救護兵', rarity: 'Silver', target: 10, metric: 'rescues', condition: '累計10回救助' },
    { id: 'all-parts-clear', name: '完全解体', rarity: 'Gold', target: 1, metric: 'allPartsClears', condition: '1戦で全部位を破壊して撃破' },
    { id: 'duo-no-ai-clear', name: '背中合わせ', rarity: 'Gold', target: 1, metric: 'duoNoAiClears', condition: 'AIなし2人でボス撃破' },
    { id: 'long-range-hit', name: '地平線の向こうへ', rarity: 'Silver', target: 1, metric: 'longRangeHits', condition: '超遠距離から命中' },
    { id: 'dead-line-comeback', name: '奈落の縁から', rarity: 'Gold', target: 1, metric: 'deadLineWins', condition: 'DEAD LINE寸前から勝利' },
    { id: 'subweapon-finisher', name: '切り札の一撃', rarity: 'Silver', target: 1, metric: 'subweaponFinishers', condition: 'サブウェポンで敵を撃破' },
    { id: 'hidden-self-hit', name: '自分に正直な砲弾', rarity: 'Bronze', target: 1, metric: 'selfHits', condition: '自分の砲弾を自分に当てる', hidden: true },
    { id: 'hidden-double-down', name: '一石二鳥', rarity: 'Gold', target: 1, metric: 'doubleDowns', condition: '1発で2体以上を同時にダウンさせる', hidden: true },
  ].map((entry) => Object.freeze({ ...entry, reward: RARITY_REWARDS[entry.rarity] })));

  function stateOf(raw) {
    return foundation.normalizeState(raw);
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(999999, Math.max(0, Math.trunc(number))) : 0;
  }

  function achievementValue(state, achievement) {
    const progress = state.achievements.progress;
    if (achievement.metric === 'wins') return safeCount(progress.cpuWins) + safeCount(progress.pvpWins);
    return safeCount(progress[achievement.metric]);
  }

  function setMax(state, metric, value) {
    state.achievements.progress[metric] = Math.max(safeCount(state.achievements.progress[metric]), safeCount(value));
  }

  function increment(state, metric, amount = 1) {
    state.achievements.progress[metric] = safeCount(state.achievements.progress[metric]) + safeCount(amount);
  }

  function awardCompleted(currentState) {
    let state = stateOf(currentState);
    const newlyCompleted = [];
    let credited = 0;
    let pending = 0;
    for (const achievement of ACHIEVEMENTS) {
      if (achievementValue(state, achievement) < achievement.target) continue;
      const firstCompletion = state.achievements.completed[achievement.id] !== true;
      state.achievements.completed[achievement.id] = true;
      const reward = foundation.grantCoins(state, achievement.reward, `achievement:${achievement.id}`);
      state = reward.state;
      credited += reward.credited;
      pending += reward.pending;
      if (reward.pending === 0) state.achievements.claimed[achievement.id] = true;
      if (firstCompletion) newlyCompleted.push(achievement.id);
    }
    return { state, newlyCompleted, credited, pending };
  }

  function syncLegacyProgress(currentState, legacy) {
    const state = stateOf(currentState);
    setMax(state, 'cpuWins', legacy?.totalWins);
    setMax(state, 'bestStreak', legacy?.bestStreak);
    if (safeCount(legacy?.achievements?.['first-win']) > 0) setMax(state, 'cpuWins', 1);
    if (safeCount(legacy?.achievements?.['ten-wins']) > 0) setMax(state, 'cpuWins', 10);
    if (safeCount(legacy?.achievements?.['streak-3']) > 0) setMax(state, 'bestStreak', 3);
    return awardCompleted(state);
  }

  function bossDefeatReward(difficulty, hpRemainingRatio, partsDestroyed, totalParts) {
    const rule = BOSS_REWARDS[difficulty];
    if (!rule) return 0;
    const bodyRatio = Math.min(1, Math.max(0, 1 - Number(hpRemainingRatio || 0)));
    const partRatio = Math.min(1, Math.max(0, safeCount(partsDestroyed) / Math.max(1, safeCount(totalParts))));
    return Math.floor(rule.defeatMax * (bodyRatio * 0.7 + partRatio * 0.3));
  }

  function grantMatchCoins(currentState, amount, id) {
    return foundation.grantCoins(currentState, amount, id, { preserveOverflow: false });
  }

  function recordEvent(currentState, event) {
    let state = stateOf(currentState);
    const eventId = typeof event?.id === 'string' && /^[a-z0-9:._-]{1,120}$/iu.test(event.id) ? event.id : '';
    if (!eventId || state.rewardLedger[`event:${eventId}`]) {
      return { state, duplicate: true, newlyCompleted: [], credited: 0, pending: 0 };
    }
    state.rewardLedger[`event:${eventId}`] = true;
    let credited = 0;
    let pending = 0;

    if (event.type === 'pvp-result') {
      if (event.outcome === 'win') {
        increment(state, 'pvpWins');
        if (Number(event.hpRatio) <= 0.1) increment(state, 'clutchWins');
        const reward = grantMatchCoins(state, 10, `pvp-win:${eventId}`);
        state = reward.state; credited += reward.credited;
      }
    } else if (event.type === 'normal-technique') {
      if (event.clutchWin === true) increment(state, 'clutchWins');
      if (event.longRangeHit === true) increment(state, 'longRangeHits');
      if (event.deadLineWin === true) increment(state, 'deadLineWins');
      if (event.subweaponFinisher === true) increment(state, 'subweaponFinishers');
      if (event.selfHit === true) increment(state, 'selfHits');
      if (safeCount(event.simultaneousDowns) >= 2) increment(state, 'doubleDowns');
    } else if (event.type === 'coop-result') {
      const difficulty = BOSS_REWARDS[event.difficulty] ? event.difficulty : 'normal';
      const victory = event.outcome === 'victory';
      const rewardRule = BOSS_REWARDS[difficulty];
      let matchReward = 0;
      if (victory) {
        const metric = `${difficulty}Clears`;
        increment(state, metric);
        state.coopStats.clears = safeCount(state.coopStats.clears) + 1;
        if (difficulty === 'hard') state.coopStats.hardClears = safeCount(state.coopStats.hardClears) + 1;
        if (difficulty === 'extreme') state.coopStats.extremeClears = safeCount(state.coopStats.extremeClears) + 1;
        matchReward = rewardRule.victory;
        if (!state.boss.firstClears[difficulty]) {
          state.boss.firstClears[difficulty] = true;
          matchReward += rewardRule.firstClear;
          if (rewardRule.unlocks && !state.boss.unlockedDifficulties.includes(rewardRule.unlocks)) {
            state.boss.unlockedDifficulties.push(rewardRule.unlocks);
          }
        }
        if (event.allPartsDestroyed === true) increment(state, 'allPartsClears');
        if (safeCount(event.playerCount) === 2 && safeCount(event.aiCount) === 0) increment(state, 'duoNoAiClears');
        if (event.deadLineWin === true) increment(state, 'deadLineWins');
      } else if (event.outcome === 'defeat') {
        matchReward = bossDefeatReward(difficulty, event.bossHpRemainingRatio, event.partsDestroyed, event.totalParts);
      }
      increment(state, 'rescues', event.rescues);
      state.coopStats.rescues = safeCount(state.coopStats.rescues) + safeCount(event.rescues);
      state.coopStats.partBreaks = safeCount(state.coopStats.partBreaks) + safeCount(event.partsDestroyed);
      if (victory && event.noDown === true) state.coopStats.noDownClears = safeCount(state.coopStats.noDownClears) + 1;
      if (matchReward > 0) {
        const reward = grantMatchCoins(state, matchReward, `boss-result:${eventId}`);
        state = reward.state; credited += reward.credited;
      }
    }

    const achievements = awardCompleted(state);
    state = achievements.state;
    credited += achievements.credited;
    pending += achievements.pending;
    return { state, duplicate: false, newlyCompleted: achievements.newlyCompleted, credited, pending };
  }

  function claimPendingAchievements(currentState) {
    let state = stateOf(currentState);
    let credited = 0;
    for (const achievement of ACHIEVEMENTS) {
      const rewardId = `achievement:${achievement.id}`;
      const claim = foundation.claimPendingReward(state, rewardId);
      state = claim.state;
      credited += claim.credited;
      if (claim.pending === 0 && state.achievements.completed[achievement.id]) {
        state.achievements.claimed[achievement.id] = true;
      }
    }
    return { state, credited };
  }

  function achievementRows(currentState) {
    const state = stateOf(currentState);
    return ACHIEVEMENTS.map((achievement) => {
      const value = Math.min(achievement.target, achievementValue(state, achievement));
      const completed = state.achievements.completed[achievement.id] === true;
      return {
        id: achievement.id,
        name: achievement.hidden && !completed ? '？？？' : achievement.name,
        rarity: achievement.rarity,
        value,
        target: achievement.target,
        condition: achievement.hidden && !completed ? '条件は秘密' : achievement.condition,
        reward: achievement.reward,
        completed,
        claimed: state.achievements.claimed[achievement.id] === true,
      };
    });
  }

  return Object.freeze({
    RARITY_REWARDS,
    BOSS_REWARDS,
    ACHIEVEMENTS,
    syncLegacyProgress,
    bossDefeatReward,
    recordEvent,
    claimPendingAchievements,
    achievementRows,
  });
});
