const assert = require('node:assert/strict');
const session = require('../coop-mvp-session.js');
const battleModule = require('../coop-mvp-battle.js');
const foundation = require('../coop-mvp-foundation.js');

let passed = 0;
function check(message, condition) { assert.ok(condition, message); passed += 1; }
const A = 'a'.repeat(48);
const B = 'b'.repeat(48);
const C = 'c'.repeat(48);
const battle = { hp: 74, fuel: 18, status: 'down', coopItemUses: 1 };
const base = session.createRuntime({
  id: A,
  bossId: 'fortress-tank', difficulty: 'hard', stageId: 'fortress-fixed', startedAt: 100,
  seats: {
    p1: { uid: 'host', name: 'H', battle: { hp: 100, fuel: 30 } },
    e1: { uid: 'guest-1', name: 'B', battle },
    s1: { uid: 'guest-2', name: 'C', battle: { hp: 40, fuel: 5 } },
    s2: { name: 'AI', battle: { hp: 90, fuel: 20 } },
  },
});

check('再戦受付は15秒固定', session.REMATCH_WINDOW_MS === 15000);
check('ホストはp1から変えない', base.hostSeat === 'p1' && base.seats.p1.control === 'human');
check('人間席は接続中のhuman操作', base.seats.e1.human && base.seats.e1.connected && base.seats.e1.control === 'human');
check('空席補充AIはhumanを名乗らない', !base.seats.s2.human && !base.seats.s2.connected && base.seats.s2.control === 'ai');

const disconnected = session.disconnectSeat(base, 'e1', 500);
check('通常参加者の切断は即AI操作へ引き継ぐ', disconnected.seats.e1.control === 'ai' && !disconnected.seats.e1.connected);
check('通常参加者は試合終了まで再接続可能', disconnected.seats.e1.reconnectable === true);
check('切断時刻を保持する', disconnected.seats.e1.disconnectedAt === 500);
check('AI引継ぎでHP・燃料・ダウン・使用回数を巻き戻さない', JSON.stringify(disconnected.seats.e1.battle) === JSON.stringify(battle));
check('元のruntimeは変更しない', base.seats.e1.control === 'human' && base.seats.e1.connected);

let reconnect = session.requestReconnect(disconnected, 'e1', 'wrong', B, 800);
check('別UIDによる席の奪取を拒否', !reconnect.accepted && reconnect.reason === 'identity-mismatch');
reconnect = session.requestReconnect(disconnected, 'e1', 'guest-1', 'bad', 800);
check('不正な次ラウンドIDを拒否', !reconnect.accepted && reconnect.reason === 'invalid-round');
reconnect = session.requestReconnect(disconnected, 'e1', 'guest-1', B, 800);
check('同じ本人の再接続を受理', reconnect.accepted && reconnect.reason === 'pending-next-input');
check('再接続直後はまだAI操作', reconnect.runtime.seats.e1.connected && reconnect.runtime.seats.e1.control === 'ai');
check('次の入力ラウンドを予約', reconnect.runtime.seats.e1.resumeAtRoundId === B);
check('再接続でもAI中に変化した状態をそのまま保持', JSON.stringify(reconnect.runtime.seats.e1.battle) === JSON.stringify(battle));
let activated = session.activateRoundControls(reconnect.runtime, C);
check('別ラウンドでは人間操作へ戻さない', activated.seats.e1.control === 'ai');
activated = session.activateRoundControls(reconnect.runtime, B);
check('指定した次の入力ラウンドから人間操作へ戻す', activated.seats.e1.control === 'human' && !activated.seats.e1.reconnectable);
check('操作復帰時にも戦闘状態を巻き戻さない', JSON.stringify(activated.seats.e1.battle) === JSON.stringify(battle));

const hostRecovering = session.disconnectSeat(base, 'p1', 900, { canContinue: true });
check('現ホスト権限で継続可能なら通信復旧状態を保持', hostRecovering.phase === 'playing' && hostRecovering.hostRecovery.state === 'reconnecting');
check('継続試行でもホストを他席へ移譲しない', hostRecovering.hostSeat === 'p1');
const hostFailed = session.disconnectSeat(base, 'p1', 900, { canContinue: false });
check('ホスト継続不能なら試合を安全中断', hostFailed.phase === 'aborted' && hostFailed.destination === 'lobby');
check('中断は勝敗・報酬対象にしない', hostFailed.rewardable === false);

const victory = session.resultSummary(base, {
  outcome: 'victory', coins: 85, partsDestroyed: 3, totalParts: 3, rescues: 2,
  firstClear: true, achievements: ['boss-hard', 'first-rescue', 'boss-hard'],
  bossHpRemainingRatio: 0, playerCount: 3, aiCount: 1, allPartsDestroyed: true, noDown: false,
});
check('勝利タイトル・難易度・コインを結果へ出す', victory.title === 'VICTORY' && victory.difficulty === 'hard' && victory.coins === 85);
check('部位破壊・救助・初回クリアを結果へ出す', victory.partsDestroyed === 3 && victory.rescues === 2 && victory.firstClear);
check('実績達成は重複なく結果へ出す', victory.achievements.length === 2 && victory.achievements.includes('boss-hard'));
const event = session.rewardEvent(victory);
check('勝敗結果だけが協力報酬イベントになる', event?.type === 'coop-result' && event.outcome === 'victory' && event.id === `${A}:result`);
check('報酬イベントへ部位・救助・参加人数を渡す', event.partsDestroyed === 3 && event.rescues === 2 && event.playerCount === 3 && event.aiCount === 1);

const aborted = session.resultSummary(hostFailed, { outcome: 'victory', coins: 999, firstClear: true, achievements: ['boss-hard'] });
check('中断はBATTLE ABORTEDとする', aborted.title === 'BATTLE ABORTED' && aborted.outcome === 'aborted');
check('中断時はコインも初回クリアも付与しない', aborted.coins === 0 && !aborted.firstClear && !aborted.rewardable);
check('中断から報酬イベントを作らない', session.rewardEvent(aborted) === null);

let window = session.openRematch(base, ['p1', 'e1', 's1', 's2', 'unknown'], 1000);
check('再戦対象は接続中の人間席だけ', JSON.stringify(window.eligibleSeats) === JSON.stringify(['p1', 'e1', 's1']));
check('同じボス・難易度・ステージを保持', window.settings.bossId === 'fortress-tank' && window.settings.difficulty === 'hard' && window.settings.stageId === 'fortress-fixed');
check('残り秒数を15から0へ丸める', session.secondsRemaining(window, 1000) === 15 && session.secondsRemaining(window, 16001) === 0);
let vote = session.castRematchVote(window, 's2', true, 2000);
check('AI席は再戦投票できない', !vote.accepted && vote.reason === 'not-eligible');
vote = session.castRematchVote(window, 'p1', true, 2000); window = vote.window;
check('受付中の賛成票を記録', vote.accepted && window.votes.p1 === true);
vote = session.castRematchVote(window, 'e1', true, 3000); window = vote.window;
check('2人目の賛成票を記録', vote.accepted && window.votes.e1 === true);
let decision = session.resolveRematch(window, 4000);
check('未投票者がいて受付中なら待つ', decision.decision === 'waiting' && !decision.resolved);
vote = session.castRematchVote(window, 's1', false, 5000); window = vote.window;
decision = session.resolveRematch(window, 5000);
check('全員投票後は15秒前でも確定できる', decision.resolved && decision.decision === 'rematch');
check('賛成した2人だけを同じ条件の再戦へ残す', JSON.stringify(decision.retainedSeats) === JSON.stringify(['p1', 'e1']));
check('抜けた枠はロビーで補充対象にする', decision.missingSeats.includes('s1') && decision.missingSeats.includes('s2'));

let guestOnly = session.openRematch(base, ['p1', 'e1', 's1'], 0);
guestOnly = session.castRematchVote(guestOnly, 'p1', false, 1).window;
guestOnly = session.castRematchVote(guestOnly, 'e1', true, 1).window;
guestOnly = session.castRematchVote(guestOnly, 's1', true, 1).window;
decision = session.resolveRematch(guestOnly, 1);
check('ホスト移譲なしのためゲスト2人だけでは再戦しない', decision.decision === 'lobby');

let timeout = session.openRematch(base, ['p1', 'e1', 's1'], 100);
timeout = session.castRematchVote(timeout, 'p1', true, 101).window;
decision = session.resolveRematch(timeout, 15100);
check('15秒終了時に希望者1人以下ならロビーへ戻る', decision.resolved && decision.decision === 'lobby' && decision.yesSeats.length === 1);
vote = session.castRematchVote(timeout, 'e1', true, 15101);
check('受付終了後の投票を拒否', !vote.accepted && vote.reason === 'closed');

(async () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  let lockTail = Promise.resolve();
  let lockCalls = 0;
  let activeLocks = 0;
  let maxActiveLocks = 0;
  const lockManager = {
    request(_name, options, callback) {
      lockCalls += 1;
      check('協力結果writerはexclusive lockを要求', options?.mode === 'exclusive');
      const run = lockTail.then(async () => {
        activeLocks += 1;
        maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
        try {
          await Promise.resolve();
          return await callback({ name: _name });
        } finally {
          activeLocks -= 1;
        }
      });
      lockTail = run.catch(() => {});
      return run;
    },
  };
  const resultState = battleModule.createBattleState({
    matchId: A,
    difficulty: 'hard',
    slots: base.seats,
    aiFill: true,
    characters: {},
  });
  resultState.outcome = 'victory';
  resultState.encounter.boss.body.hp = 0;

  const [firstEntry, duplicateEntry] = await Promise.all([
    battleModule.recordResultLocked(foundation, base, resultState, { storage, lockManager }),
    battleModule.recordResultLocked(foundation, base, resultState, { storage, lockManager }),
  ]);
  const saved = foundation.loadState(storage);
  check('同時結果処理とGear queueは同じlockで直列化', lockCalls >= 2 && maxActiveLocks === 1);
  check('同じrewardIdの協力結果は1回だけcredit', firstEntry.resultSummary.coins > 0 && !firstEntry.duplicate
    && duplicateEntry.resultSummary.coins === 0 && duplicateEntry.duplicate
    && saved.wallet.coins === firstEntry.resultSummary.coins);
  check('同じ協力結果のfirst clear・実績進捗を二重加算しない', saved.coopStats.clears === 1
    && saved.achievements.progress.hardClears === 1);
  check('同じ協力結果のreward ledgerを保持', saved.rewardLedger[`event:${A}:result`] === true);

  console.log(`協力結果・15秒再戦・切断復帰（${passed}/${passed} passed）`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
