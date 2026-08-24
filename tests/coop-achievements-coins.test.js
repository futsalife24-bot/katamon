const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const foundation = require('../coop-mvp-foundation.js');
const rewards = require('../coop-mvp-rewards.js');

assert.equal(rewards.ACHIEVEMENTS.length, 18);
assert.deepEqual(rewards.RARITY_REWARDS, { Bronze: 20, Silver: 40, Gold: 80, Legendary: 150 });
assert.equal(rewards.ACHIEVEMENTS.filter((entry) => entry.hidden).length, 2);
assert.deepEqual(rewards.BOSS_REWARDS, {
  normal: { victory: 15, firstClear: 30, defeatMax: 5, unlocks: 'hard' },
  hard: { victory: 25, firstClear: 60, defeatMax: 10, unlocks: 'extreme' },
  extreme: { victory: 40, firstClear: 100, defeatMax: 15, unlocks: null },
});

let state = foundation.createDefaultState();
let result = rewards.syncLegacyProgress(state, {
  totalWins: 10,
  bestStreak: 5,
  achievements: { 'first-win': 1, 'ten-wins': 1, 'streak-3': 1 },
});
state = result.state;
assert.deepEqual(result.newlyCompleted.sort(), ['first-victory', 'streak-3', 'streak-5', 'victories-10']);
assert.equal(state.wallet.coins, 120, 'Bronze+Bronze+Silver+Silver');
assert.equal(state.achievements.progress.cpuWins, 10);
assert.equal(state.achievements.progress.bestStreak, 5);
result = rewards.syncLegacyProgress(state, { totalWins: 10, bestStreak: 5, achievements: {} });
assert.equal(result.credited, 0, '既存進捗の再同期で実績報酬を重複付与しない');

result = rewards.recordEvent(state, { id: 'round:pvp-1', type: 'pvp-result', outcome: 'win', hpRatio: 0.1 });
state = result.state;
assert.equal(result.credited, 90, 'PvP勝利10 + 崖っぷちGold 80');
assert.equal(state.achievements.progress.pvpWins, 1);
assert.equal(state.wallet.coins, 210);
const duplicate = rewards.recordEvent(state, { id: 'round:pvp-1', type: 'pvp-result', outcome: 'win', hpRatio: 0.1 });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.state.wallet.coins, 210);

result = rewards.recordEvent(state, {
  id: 'boss:normal-1', type: 'coop-result', outcome: 'victory', difficulty: 'normal',
  playerCount: 2, aiCount: 0, rescues: 1, partsDestroyed: 4, allPartsDestroyed: true, noDown: false,
});
state = result.state;
assert.equal(result.credited, 245, '初回NORMAL45 + Bronze2件40 + Gold2件160');
assert.equal(state.wallet.coins, 455);
assert.equal(state.boss.firstClears.normal, true);
assert.ok(state.boss.unlockedDifficulties.includes('hard'));
assert.equal(state.coopStats.clears, 1);
assert.equal(state.coopStats.rescues, 1);
assert.equal(state.coopStats.partBreaks, 4);

result = rewards.recordEvent(state, {
  id: 'boss:normal-2', type: 'coop-result', outcome: 'victory', difficulty: 'normal',
  playerCount: 3, aiCount: 1, rescues: 0, partsDestroyed: 1, allPartsDestroyed: false,
});
state = result.state;
assert.equal(result.credited, 15, '2回目以降は通常撃破報酬だけ');
assert.equal(state.wallet.coins, 470);

assert.equal(rewards.bossDefeatReward('normal', 0, 4, 4), 5);
assert.equal(rewards.bossDefeatReward('hard', 0.5, 2, 4), 5);
assert.equal(rewards.bossDefeatReward('extreme', 1, 0, 4), 0);
result = rewards.recordEvent(state, {
  id: 'boss:hard-loss', type: 'coop-result', outcome: 'defeat', difficulty: 'hard',
  bossHpRemainingRatio: 0.5, partsDestroyed: 2, totalParts: 4,
});
state = result.state;
assert.equal(result.credited, 5);

result = rewards.recordEvent(state, {
  id: 'tech:1', type: 'normal-technique', longRangeHit: true, deadLineWin: true,
  subweaponFinisher: true, selfHit: true, simultaneousDowns: 2,
});
state = result.state;
assert.equal(result.newlyCompleted.length, 5);
const rows = rewards.achievementRows(state);
assert.equal(rows.length, 18);
assert.equal(rows.find((row) => row.id === 'hidden-self-hit').name, '自分に正直な砲弾');
const freshRows = rewards.achievementRows(foundation.createDefaultState());
assert.equal(freshRows.find((row) => row.id === 'hidden-self-hit').name, '？？？');
assert.equal(freshRows.find((row) => row.id === 'hidden-self-hit').condition, '条件は秘密');

state.wallet.coins = 9990;
result = rewards.recordEvent(state, { id: 'tech:pending', type: 'normal-technique', simultaneousDowns: 1 });
state = result.state;
assert.equal(state.wallet.coins, 9990);
result = rewards.recordEvent(state, { id: 'pvp:overflow', type: 'pvp-result', outcome: 'win', hpRatio: 1 });
state = result.state;
assert.equal(state.wallet.coins, 9999);
assert.equal(state.pendingRewards['pvp-win:pvp:overflow'], undefined, '通常報酬の超過分は消滅');

let capped = foundation.createDefaultState();
capped.wallet.coins = 9999;
result = rewards.recordEvent(capped, { id: 'hidden:pending', type: 'normal-technique', selfHit: true });
capped = result.state;
assert.equal(capped.pendingRewards['achievement:hidden-self-hit'], 20, '一回限り実績だけ未受取保持');
capped.wallet.coins = 9979;
const claimed = rewards.claimPendingAchievements(capped);
assert.equal(claimed.credited, 20);
assert.equal(claimed.state.wallet.coins, 9999);
assert.equal(claimed.state.pendingRewards['achievement:hidden-self-hit'], undefined);
assert.equal(claimed.state.achievements.claimed['hidden-self-hit'], true);

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(gameSource, /syncMvpRewardsFromLegacy/,
  '既存の勝利・連勝・実績進捗を新しい18実績へ接続する');
assert.match(gameSource, /type: 'pvp-result'/,
  '既存ONLINEの確定済みresultからPvP報酬を記録する');
assert.match(gameSource, /firebaseOpponentHumanSeats\(\)\.length > 0/,
  '全CPUのONLINE部屋をPvP勝利報酬として扱わない');
assert.match(gameSource, /clutchWin: winner === 'player' && teamHpRatio\('player'\) <= 0\.1/,
  '既存CPU戦のHP10%以下勝利を安定した決着時点で判定する');
assert.match(gameSource, /flightDistance >= MVP_LONG_RANGE_DISTANCE/,
  '超遠距離命中を実際の発射点から着弾点までの距離で判定する');
assert.match(gameSource, /techniqueProjectile\.subweaponId && enemyDowns > 0/,
  'サブウェポンでHPを0にした一撃だけを撃破実績にする');
assert.match(gameSource, /teamHasDeadLineEdgeSurvivor\(team\)/,
  '勝利側の生存キャラがDEAD LINE直前にいる場合だけ崖際勝利にする');
assert.match(gameSource, /owner === localUnitId && target\?\.id === localUnitId/,
  '自弾による自分自身への実ダメージを隠し実績へ接続する');
assert.match(gameSource, /Math\.max\(mvpTechniqueStats\.simultaneousDowns, enemyDowns\)/,
  '同じ爆発で同時に倒した人数を隠し実績へ接続する');
assert.match(gameSource, /id: `pvp-technique:\$\{online\.currentRoundId\}`/,
  'ONLINEはroundId単位で技術実績を重複なく保存する');

console.log('18実績・カタコイン・ボス報酬・難易度解放（88/88 passed）');
