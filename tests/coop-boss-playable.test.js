const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const battle = require('../coop-mvp-battle.js');
const boss = require('../coop-mvp-boss.js');

let passed = 0;
function check(message, condition) { assert.ok(condition, message); passed += 1; }
const root = path.join(__dirname, '..');
const A = 'a'.repeat(48);
const B = 'b'.repeat(48);
const characters = [
  { id: 'kyoryu', name: 'ディラノ', maxHp: 100, color: '#76d64b', assetPath: 'assets/characters/runtime/dirano.webp' },
  { id: 'medama', name: 'アイボルト', maxHp: 90, color: '#ffd24a', assetPath: 'assets/characters/runtime/eyebolt.webp' },
  { id: 'iwa', name: 'ゴーロッカ', maxHp: 130, color: '#999', assetPath: 'assets/characters/runtime/gorocca.webp' },
  { id: 'tori', name: 'フェニーチェ', maxHp: 75, color: '#f80', assetPath: 'assets/characters/runtime/fenice.webp' },
];
const slots = {
  p1: { uid: 'host', name: 'A', character: 'kyoryu', subweapon: 'barrier', coopItem: 'rescue-kit', ready: true, seenAt: 1000 },
  e1: { uid: 'guest', name: 'B', character: 'medama', subweapon: 'impact', coopItem: 'healing-kit', ready: true, seenAt: 1000 },
};

check('AIは0.75人相当', battle.AI_PLAYER_WEIGHT === 0.75);
check('ホスト切断はサーバー確認用90秒を待つ', battle.HOST_ABORT_AFTER_MS === 90000);
check('2人は65%補正', battle.playerCountRatio(2, 0) === 0.65);
check('2人+AI1は約76%', Math.abs(battle.playerCountRatio(2, 1) - 0.7625) < 1e-9);
check('2人+AI2は90%', Math.abs(battle.playerCountRatio(2, 2) - 0.9) < 1e-9);
check('3人+AI1は95%', Math.abs(battle.playerCountRatio(3, 1) - 0.95) < 1e-9);
check('4人は100%', battle.playerCountRatio(4, 0) === 1);

const liveTargets = [
  { id: 'p1', hp: 100, coopReviveGuard: false },
  { id: 'e1', hp: 90, coopReviveGuard: false },
  { id: 'p2', hp: 130, coopReviveGuard: false },
  { id: 'e2', hp: 75, coopReviveGuard: false },
];
check('要塞標的はラウンドごとに席順で公平に交代',
  [1, 2, 3, 4, 5].map((round) => battle.selectLiveBossTargetId(liveTargets, round)).join(',')
    === 'p1,e1,p2,e2,p1');
liveTargets[0].coopReviveGuard = true;
check('救助保護中は他の生存者を優先して狙う', battle.selectLiveBossTargetId(liveTargets, 1) === 'e1');
check('他が全滅なら保護対象にも攻撃できて戦闘が停止しない',
  battle.selectLiveBossTargetId(liveTargets.map((unit, index) => ({ ...unit, hp: index === 0 ? unit.hp : 0 })), 1) === 'p1');
check('救助保護は救助された要塞ラウンドだけ手番を保留',
  battle.shouldHoldRevivedTurn({ coopReviveGuard: true, coopRevivedBossRound: 3 }, 3)
    && !battle.shouldHoldRevivedTurn({ coopReviveGuard: true, coopRevivedBossRound: 3 }, 4));

const bytes = Uint8Array.from({ length: 20 }, (_, index) => index);
const roundId = battle.makeRoundId(17, bytes);
check('ラウンドIDはrevision 8桁+乱数40桁', roundId.length === 48 && roundId.startsWith('00000011'));
check('ラウンドIDは16進数だけ', /^[0-9a-f]{48}$/.test(roundId));
check('同じseedの風は完全一致', JSON.stringify(battle.windForRound(A, 'next')) === JSON.stringify(battle.windForRound(A, 'next')));
check('異なるseedの乱数列は異なる', battle.seededRandom(A)() !== battle.seededRandom(B)());

const roster = battle.activeRoster(slots, true, characters);
check('2人の実席を保持', !roster.p1.ai && !roster.e1.ai && roster.p1.uid === 'host');
check('空席2つをAI補充', roster.s1.ai && roster.s2.ai);
check('AIは可能なら重複キャラを避ける', roster.s1.character !== roster.p1.character && roster.s2.character !== roster.e1.character);
check('AI補充OFFなら空席を戦闘へ出さない', Object.keys(battle.activeRoster(slots, false, characters)).length === 2);
const soloRoster = battle.activeRoster({ p1: slots.p1 }, true, characters);
check('ホスト1人でもAI3体を補充して4体編成', Object.keys(soloRoster).length === 4 && ['e1', 's1', 's2'].every((seat) => soloRoster[seat].ai));
const selectedAiRoster = battle.activeRoster({ p1: slots.p1 }, true, characters, {
  e1: 'tori', s1: 'iwa', s2: 'medama',
});
check('ホストが選んだ味方AI3体のモンスターを席どおり実戦編成へ反映',
  selectedAiRoster.e1.character === 'tori'
    && selectedAiRoster.s1.character === 'iwa'
    && selectedAiRoster.s2.character === 'medama');

const transportConfig = {
  difficulty: 'normal',
  bossMaxHp: Math.round(battle.BASE_BODY_HP.normal * battle.playerCountRatio(1, 3)),
};
const transportSeatByUnit = { p1: 'p1', e1: 'e1', p2: 's1', e2: 's2' };
const transportUnits = ['p1', 'e1', 'p2', 'e2'].map((unitId, index) => {
  const entry = soloRoster[transportSeatByUnit[unitId]];
  return {
    id: unitId, team: 'player', control: entry.ai ? 'cpu' : 'local', character: entry.character,
    hp: entry.maxHp, maxHp: entry.maxHp, fuel: 100, fuelMax: 100,
    x: 180 + index * 150, y: 820, specialCharge: 0, moveLockTurns: 0, actionSkipTurns: 0,
    coopReviveGuard: false, coopRevivedBossRound: 0, jumpAvailable: true,
    subweapon: entry.subweapon || null, subweaponUsesLeft: entry.subweapon ? 1 : 0,
    subweaponBarrierActive: false, coopItem: entry.coopItem || 'rescue-kit',
    coopItemUsesLeft: entry.coopItem === 'healing-kit' ? 2 : 1, coopBoss: false, facingLeft: false,
  };
});
transportUnits.push({
  id: 'boss1', team: 'cpu', control: 'cpu', character: null,
  hp: transportConfig.bossMaxHp, maxHp: transportConfig.bossMaxHp, fuel: 0, fuelMax: 0,
  x: 1900, y: 820, specialCharge: 0, moveLockTurns: 0, actionSkipTurns: 0,
  coopReviveGuard: false, coopRevivedBossRound: 0, jumpAvailable: false,
  subweapon: null, subweaponUsesLeft: 0, subweaponBarrierActive: false,
  coopItem: null, coopItemUsesLeft: 0, coopBoss: true, phase: 1, vulnerabilityTurns: 0,
  bossState: boss.createLiveState({ bodyMaxHp: transportConfig.bossMaxHp, difficulty: 'normal' }), facingLeft: true,
});
const transportSegments = Array.from({ length: 720 }, () => [[848, 936]]);
const transportMaterials = Array.from({ length: 720 }, () => [[848, 936, 'steel']]);
[
  { start: 58, end: 130, top: 634, steel: true },
  { start: 166, end: 252, top: 461, steel: true },
  { start: 281, end: 374, top: 643, steel: true },
  { start: 389, end: 461, top: 365, steel: false },
  { start: 482, end: 518, top: 566, steel: false },
].forEach((platform) => {
  for (let column = platform.start; column < platform.end; column++) {
    transportSegments[column].unshift([platform.top, platform.top + 36]);
    if (platform.steel) transportMaterials[column].unshift([platform.top, platform.top + 36, 'steel']);
  }
});
const transportSnapshot = {
  battleMode: 'coop', matchFormat: 'coop4v1', stageW: 2160, stageH: 960,
  craters: [], turnOrder: ['p1', 'e1', 'p2', 'e2', 'boss1'], activeIndex: 0, turnCount: 0,
  wind: { dir: 1, strength: 0.5 }, nextWind: { dir: -1, strength: 0.7 }, units: transportUnits,
  pattern: 'coopSteel', terrainMaterial: 'terrain', segments: transportSegments,
  terrainMaterialSegments: transportMaterials,
};
check('鋼鉄初期台座と破壊可能足場を持つ大型開始snapshotを通信境界が受理',
  battle.normalSnapshotLooksSafe(transportSnapshot, soloRoster, transportConfig, true));
check('旧・全面鋼鉄の空中足場snapshotを新ルールでは拒否',
  !battle.normalSnapshotLooksSafe({
    ...transportSnapshot,
    terrainMaterialSegments: transportSegments.map(column => column.map(segment => [segment[0], segment[1], 'steel'])),
  }, soloRoster, transportConfig, true));
check('NORMALの60手目は受理し61手目を拒否',
  battle.normalSnapshotLooksSafe({ ...transportSnapshot, turnCount: 60 }, soloRoster, transportConfig, true)
    && !battle.normalSnapshotLooksSafe({ ...transportSnapshot, turnCount: 61 }, soloRoster, transportConfig, true));

let state = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: true, characters });
check('4席の協力パーティを生成', Object.keys(state.party.players).length === 4);
check('キャラ固有最大HPを保持', state.party.players.p1.maxHp === 100 && state.party.players.e1.maxHp === 90);
check('2人+AI2のボスHPは90%補正', state.encounter.boss.body.maxHp === Math.round(battle.BASE_BODY_HP.normal * 0.9));
check('全員の燃料と必殺ゲージを初期化', Object.values(state.party.players).every((player) => player.fuel === 100 && player.specialGauge === 0));
check('救助弾は試合開始時に1回', state.party.players.p1.itemUses.rescue === 1);

const bossPoint = { x: 1250, y: 500 };
let result = battle.applyPlayerAction(state, 'p1', { x: 180, fuelSpent: 12, aim: bossPoint, weapon: { kind: 'normal', id: 'normal' } });
check('通常弾で本体HPを削る', result.state.encounter.boss.body.hp < state.encounter.boss.body.hp);
check('移動燃料は不可逆に消費', result.state.party.players.p1.fuel === 88);
check('命中で必殺ゲージを蓄積', result.state.party.players.p1.specialGauge > 0);
check('通常対戦と同じ4行動で必殺ゲージMAX', result.state.party.players.p1.specialGauge === 25);
check('旧計算モデルの地形変形はライブ戦闘へ接続しない',
  result.state.stage.segments[0][0][0] === state.stage.segments[0][0][0]
    && result.state.stage.segments[Math.floor(bossPoint.x / state.stage.columnWidth)][0][0] > state.stage.segments[Math.floor(bossPoint.x / state.stage.columnWidth)][0][0]);
check('元の戦闘状態を破壊しない', state.party.players.p1.fuel === 100);

result = battle.applyPlayerAction(state, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'subweapon', id: 'barrier' } });
check('バリアは砲撃せず次の被弾軽減を起動', result.state.subweapons.players.p1.barrierActive && result.event.kind === 'barrier');
check('バリアは1試合1回を消費', result.state.subweapons.players.p1.usesLeft === 0);

const impactState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: false, characters });
const impactColumn = Math.floor(bossPoint.x / impactState.stage.columnWidth);
result = battle.applyPlayerAction(impactState, 'e1', { x: 330, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'subweapon', id: 'impact' } });
check('衝撃弾はボスへ命中しても地形を削らない',
  result.state.encounter.boss.body.hp < impactState.encounter.boss.body.hp
    && result.state.stage.segments[impactColumn][0][0] === impactState.stage.segments[impactColumn][0][0]);

const forgedState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: false, characters });
result = battle.applyPlayerAction(forgedState, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'special', id: 'special' } });
check('ゲージ不足の必殺要求は通常弾へ戻す', result.event.kind === 'normal' && result.state.party.players.p1.specialGauge === 25);
result = battle.applyPlayerAction(forgedState, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'subweapon', id: 'impact' } });
check('未装備サブウェポン要求は通常弾へ戻す', result.event.kind === 'normal' && result.state.subweapons.players.p1.usesLeft === 1);
result = battle.applyPlayerAction(forgedState, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'coopItem', id: 'debuff-grenade' } });
check('未装備CO-OP ITEM要求は通常弾へ戻す', result.event.kind === 'normal' && !result.state.support.bossVulnerability.active);

state.party.players.e1.hp = 0; state.party.players.e1.status = 'down';
result = battle.applyPlayerAction(state, 'p1', { x: 180, fuelSpent: 0, aim: { x: state.party.players.e1.x, y: state.party.players.e1.y }, weapon: { kind: 'coopItem', id: 'rescue-kit' } });
check('救助弾でダウン味方を30%復帰', result.state.party.players.e1.status === 'alive' && result.state.party.players.e1.hp === result.state.party.players.e1.maxHp * 0.3);
check('救助回数を射手ごとに記録', result.state.stats.rescues.p1 === 1);
check('救助弾は1回で残弾0', result.state.party.players.p1.itemUses.rescue === 0);
result.state.party.players.s1.hp = 0; result.state.party.players.s1.status = 'down';
result = battle.applyPlayerAction(result.state, 'p1', { x: 180, fuelSpent: 0, aim: { x: result.state.party.players.s1.x, y: result.state.party.players.s1.y }, weapon: { kind: 'coopItem', id: 'rescue-kit' } });
check('同じ試合の2回目は救助できない', result.state.party.players.s1.status === 'down' && result.state.stats.rescues.p1 === 1);
const rematchState = battle.createBattleState({ matchId: B, difficulty: 'normal', slots, aiFill: true, characters });
check('再戦用の新規状態では救助弾が1回へ戻る', rematchState.party.players.p1.itemUses.rescue === 1);

let healState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: false, characters });
healState.party.players.e1.hp = 20;
result = battle.applyPlayerAction(healState, 'e1', { x: 330, fuelSpent: 0, aim: { x: healState.party.players.p1.x, y: healState.party.players.p1.y }, weapon: { kind: 'coopItem', id: 'healing-kit' } });
check('回復弾は生存中の他味方を30%回復', result.state.party.players.p1.hp === healState.party.players.p1.hp, '満タン味方には効果しない');
healState.party.players.p1.hp = 20;
result = battle.applyPlayerAction(healState, 'e1', { x: 330, fuelSpent: 0, aim: { x: healState.party.players.p1.x, y: healState.party.players.p1.y }, weapon: { kind: 'coopItem', id: 'healing-kit' } });
check('負傷味方には最大HP30%を回復', result.state.party.players.p1.hp === 50);

const debuffSlots = clone(slots); debuffSlots.p1.coopItem = 'debuff-grenade';
let debuffState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots: debuffSlots, aiFill: false, characters });
result = battle.applyPlayerAction(debuffState, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'coopItem', id: 'debuff-grenade' } });
check('弱体化弾は命中時に次ラウンド1.25倍を予約', result.state.support.bossVulnerability.active && result.state.support.bossVulnerability.multiplier === 1.25);

let aiState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: true, characters });
aiState.party.players.p1.hp = 0; aiState.party.players.p1.status = 'down';
const aiAction = battle.buildAiAction(aiState, 's1', A, new Set());
check('AIはダウン味方の救助を最優先', aiAction.weapon.kind === 'coopItem' && aiAction.weapon.id === 'rescue-kit');
check('AIはサブウェポンを勝手に使わない', aiAction.weapon.kind !== 'subweapon');
aiState.party.players.s1.itemUses.rescue = 0;
const exhaustedAiAction = battle.buildAiAction(aiState, 's1', B, new Set());
check('AIも救助弾を使い切った後は再使用しない', exhaustedAiAction.weapon.id !== 'rescue-kit');

const nuisanceCharacters = [
  { id: 'medama', name: 'アイボルト', maxHp: 90 },
  { id: 'hamulton', name: 'ハムルトン', maxHp: 92 },
];
let nuisanceState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: false, characters: nuisanceCharacters });
nuisanceState.party.players.e1.specialGauge = 100;
result = battle.applyPlayerAction(nuisanceState, 'e1', { x: 330, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'special', id: 'special' } });
check('単発妨害必殺は元ダメージに加えてCORE変換', result.state.encounter.core.charge === 15 && result.state.party.players.e1.specialGauge === 0);
const hamultonSlots = clone(slots); hamultonSlots.p1.character = 'hamulton';
nuisanceState = battle.createBattleState({ matchId: A, difficulty: 'normal', slots: hamultonSlots, aiFill: false, characters: nuisanceCharacters });
nuisanceState.party.players.p1.specialGauge = 100;
result = battle.applyPlayerAction(nuisanceState, 'p1', { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'special', id: 'special' } });
check('持続妨害必殺は初回CORE+5かつ最大3回の効果を予約', result.state.encounter.core.charge === 5 && result.state.effects.persistentCore.ticksRemaining === 2);

state = battle.createBattleState({ matchId: A, difficulty: 'hard', slots, aiFill: false, characters });
const volley = { roundId: A, actions: {
  p1: { x: 180, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'normal', id: 'normal' }, scheduledAt: 1, auto: false },
  e1: { x: 330, fuelSpent: 0, aim: bossPoint, weapon: { kind: 'normal', id: 'normal' }, scheduledAt: 151, auto: false },
} };
const volleyA = battle.resolveVolley(state, volley);
const volleyB = battle.resolveVolley(state, volley);
check('固定順の疑似一斉砲撃を解決', volleyA.events[0].seat === 'p1' && volleyA.events[1].seat === 'e1');
check('同じroundIdと入力は完全決定論的', JSON.stringify(volleyA.state) === JSON.stringify(volleyB.state));
check('砲撃後にボス行動またはPhase2へ進む', volleyA.state.round >= 2);

const room = { rounds: {
  [A]: { messages: { one: { t: 'volley', roundId: A, sentAt: 20, actions: {}, wind: {} } } },
  [B]: { messages: { two: { t: 'volley', roundId: B, sentAt: 10, actions: {}, wind: {} } } },
} };
check('現在revisionの履歴だけを再生', battle.extractVolleys(room, 'aaaaaaaa').length === 1 && battle.extractVolleys(room, 'aaaaaaaa')[0].roundId === A);
check('結果集計へ人数・AI・部位・救助を渡す', battle.resultStats(volleyA.state).playerCount === 2 && battle.resultStats(volleyA.state).aiCount === 0);

const source = fs.readFileSync(path.join(root, 'coop-mvp-battle.js'), 'utf8');
const bossSource = fs.readFileSync(path.join(root, 'coop-mvp-boss.js'), 'utf8');
const roomSource = fs.readFileSync(path.join(root, 'coop-mvp-room.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const mobileQa = fs.readFileSync(path.join(root, 'docs', 'coop-boss-mvp-mobile-qa.md'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
const liveStartBlock = source.slice(source.indexOf('function startBrowser'), source.indexOf('return Object.freeze', source.indexOf('function startBrowser')));
const lockedResultBlock = source.slice(source.indexOf('async function recordResultLocked'), source.indexOf('function mountBrowser'));
const enterResultBlock = source.slice(source.indexOf('async function enterResult'), source.indexOf('async function updateOwnReady'));
const syncRoomBlock = source.slice(source.indexOf('async function syncRoom'), source.indexOf('async function heartbeat'));
const coopResetBlock = index.slice(index.indexOf('function resetCoopNormalBattle'), index.indexOf('function coopHumanUids'));
const bossShotBlock = index.slice(index.indexOf('function launchCoopBossShot'), index.indexOf('function perfectAimVelocity'));
const itemShotBlock = index.slice(index.indexOf('function launchCoopItemShot'), index.indexOf('function resolveCoopItemImpact'));
const netQueueBlock = index.slice(index.indexOf('function netCanApply'), index.indexOf('function applyNetMessage'));
const receivedStateBlock = index.slice(index.indexOf("case 'state':"), index.indexOf("case 'result':", index.indexOf("case 'state':")));
check('協力戦のライブ起動は別ゲームを作らず通常対戦エンジンへ接続',
  /config\.bridge\.startNormalBattle\(/.test(liveStartBlock)
    && !/createBrowserController\(/.test(liveStartBlock)
    && /startNormalBattle: startCoopNormalBattle/.test(index));
check('旧協力Surfaceはライブ起動経路から完全に外れている',
  !/attachBattleSurface/.test(liveStartBlock)
    && !/coopBattleSurface\?\./.test(liveStartBlock)
    && !/mountBrowser\(/.test(liveStartBlock));
check('協力結果のfoundation更新は最新loadから保存まで共通lock helper内で完結',
  /foundation\.mutateStateLocked\(/.test(lockedResultBlock)
    && lockedResultBlock.indexOf('resultSummary(runtime') < lockedResultBlock.indexOf('rewardEvent(preliminary)')
    && lockedResultBlock.indexOf('rewardEvent(preliminary)') < lockedResultBlock.indexOf('recordEvent(progressBefore, event)')
    && !/foundation\.saveState\(/.test(enterResultBlock));
check('協力結果のasync再入は同じPromiseを共有し、保存完了後に結果画面を一度だけ開く',
  /if \(resultEntered\) return resultEntryPromise;/.test(enterResultBlock)
    && /await recordResultLocked\(foundation, runtime, state/.test(enterResultBlock)
    && enterResultBlock.indexOf('await recordResultLocked') < enterResultBlock.indexOf("resultActionsEl.classList.add('open')")
    && /await enterResult\(\)/.test(syncRoomBlock));
check('別タブで先に保存済みの結果cacheをduplicate側がゼロ報酬で上書きしない',
  /cachedAfterLock\?\.matchId \? cachedAfterLock : recorded\.resultSummary/.test(enterResultBlock)
    && /!cachedAfterLock\?\.matchId && !recorded\.duplicate/.test(enterResultBlock));
check('通常2vs2の描画パイプラインをそのまま使用', ['drawBattleHudBackdrop()', 'drawWindMeter()', 'drawUnitPanel(', 'drawControlPanel()', 'drawCameraSlider()', 'drawMoveButtons()', 'drawFireButton()', 'drawSpecialButton()', 'drawSubweaponButton()'].every((call) => index.includes(call)));
check('味方4体と要塞1体を通常unitsへ登録',
  /units\.push\(player, cpu, ally2, foe2, coopBossUnit\)/.test(index)
    && /setMatchFormat\('coop4v1'\)/.test(coopResetBlock));
check('味方4体から要塞へ進む通常ターン順を一斉攻撃の入力順にも再利用',
  /turnOrder = \['p1', 'e1', 'p2', 'e2', COOP_BOSS_UNIT_ID\]/.test(coopResetBlock)
    && /startTurn\(\)/.test(coopResetBlock)
    && /advanceToNextPlayableTurn/.test(index));
check('ソロ＋CPU3体は4体のREADY後に通常物理へ通常弾・必殺・跳躍・救助弾を一斉投入',
  /function coopSoloSalvoEnabled\(\)/.test(index)
    && /coopHumanUids\(\)\.length === 1/.test(index)
    && /function queueCoopSalvoAction\(unit, action\)/.test(index)
    && /showCutIn\('一斉攻撃!'/.test(index)
    && /COOP_SALVO_LAUNCH_INTERVAL_TICKS = 18/.test(index)
    && /state\.launchTicks\.push\(state\.physicsTick\)/.test(index)
    && /function stepCoopSalvoLaunchQueue\(\)/.test(index)
    && /action\.coopItemId === 'rescue-kit'[\s\S]{0,180}launchCoopItemShot\(/.test(index)
    && /launchShot\(unit, action\.anchor, action\.vx0, action\.vy0, action\.useSpecial, action\.useSpecial, action\.useJump\)/.test(index));
check('一斉攻撃は跳躍と救助弾を許可し、SUBと救助以外のCO-OP ITEMを拒否する',
  /if \(action\.subweaponId \|\| \(action\.coopItemId && action\.coopItemId !== 'rescue-kit'\)\) return false/.test(index)
    && /const useJump = !!action\.useJump/.test(index)
    && /unit\.jumpAvailable !== false && unit\.moveLockTurns <= 0/.test(index)
    && /unit\.coopItem === 'rescue-kit' && unit\.coopItemUsesLeft > 0/.test(index)
    && /if \(useSpecial && \(def\?\.specialEnabled === false \|\| !isSpecialReady\(unit\)\)\) return false/.test(index)
    && /showCutIn\(`\$\{label\} READY`[^\n]+advanceCoopSalvoCollector/.test(index)
    && /coopSalvoState\?\.phase === 'resolving'/.test(index));
check('ハムルトンのクリーム雲は生成素材の3コマをその場でモクモク表示',
  fs.existsSync(path.join(root, 'assets', 'effects', 'hamulton-cream-cloud-frames.png'))
    && /const HAMULTON_CREAM_CLOUD_IMAGE_PATH = 'assets\/effects\/hamulton-cream-cloud-frames\.png';/.test(index)
    && /const CREAM_CLOUD_FRAME_COUNT = 3;/.test(index)
    && /const CREAM_CLOUD_VISUAL_SCALE = 2\.12;/.test(index)
    && /const CREAM_CLOUD_SPRITE_GROUND_RATIO = 0\.86;/.test(index)
    && /const frameIndex = Math\.floor\(simTimeMs \/ CREAM_CLOUD_FRAME_MS\) % CREAM_CLOUD_FRAME_COUNT;/.test(index)
    && /ctx\.globalAlpha = 0\.5;/.test(index)
    && /ctx\.drawImage\(image, frameIndex \* sourceW, 0, sourceW, sourceH,/.test(index)
    && /cloud\.y - drawH \* CREAM_CLOUD_SPRITE_GROUND_RATIO/.test(index)
    && /const shadowRadius = cloud\.radius \* 0\.72;/.test(index));
check('ハムルトン雲の範囲内では照準数値を隠し、弾道を半分にする',
  /function creamCloudDebuffTurnsFor\(unit\)/.test(index)
    && /entries\.push\(`照準妨害 \$\{creamCloudTurns\}手`\)/.test(index)
    && /const creamClouded = unitIsInCreamCloud\(me\);/.test(index)
    && /previewT = trajectoryPreviewDuration\(vx0, vy0, gravity\) \* shotProfile\.guideMul \* \(creamClouded \? 0\.5 : 1\)/.test(index)
    && /if \(aiming && !cancelling && !creamClouded\)/.test(index)
    && /else if \(aiming && creamClouded\)/.test(index)
    && /drawOutlinedText\('視界不良'/.test(index));
check('自分がREADY確定した弾道ガイドだけを一斉発射開始まで保持',
  /function drawOwnQueuedCoopSalvoGuide\(\)/.test(index)
    && /\['collecting', 'launching', 'special-aura', 'special-cutin'\]\.includes\(coopSalvoState\.phase\)/.test(index)
    && /state\.actions\.find\(entry => unitById\(entry\.unitId\)\?\.control === 'local'\)/.test(index)
    && /guide: unit\.control === 'local' \? \{/.test(index)
    && /drawOwnQueuedCoopSalvoGuide\(\);[\s\S]{0,120}drawTrajectoryPreview\(\);/.test(index));
check('複数必殺は全員同時オーラ、共通SE1回、長い同時カットインの順に見せてから発射',
  /COOP_SALVO_SPECIAL_AURA_DURATION = 0\.9/.test(index)
    && /COOP_SALVO_SPECIAL_FLASH_DURATION = 2\.37/.test(index)
    && /COOP_SALVO_SPECIAL_PANEL_STAGGER = 0\.16/.test(index)
    && /COOP_SALVO_SPECIAL_PANEL_ENTER_DURATION = 0\.42/.test(index)
    && /entries\.length > 1 \? 48 : 32/.test(index)
    && /state\.phase = 'special-aura'/.test(index)
    && /function beginCoopSalvoSpecialCutin\(entries\)/.test(index)
    && /state\.phase = 'special-cutin'/.test(index)
    && /const sharedAura = coopSalvoSpecialAura\?\.entries\?\.find\(entry => entry\.unitId === u\.id\)/.test(index)
    && /playCoopSalvoSpecialSound\(entries\)/.test(index)
    && /function drawCoopSalvoSpecialFlash\(\)/.test(index)
    && /const headline = entries\.length > 1 \? '同時必殺' : '必殺砲撃'/.test(index)
    && /beginQueuedCoopSalvoResolution\(\)/.test(index));
check('ソロCPUもゲージMAXなら一斉攻撃へ必殺をREADYする',
  /const useSpecial = isSpecialReady\(self\)[\s\S]{0,100}coopSoloSalvoEnabled\(\)/.test(index));
check('複数人戦は専用同期導入まで一斉攻撃へ誤って入れない',
  /return isCoop4v1\(\) && coopHumanUids\(\)\.length === 1;/.test(index));
check('NORMALは12巡60ターン、HARDとEXTREMEは既存難度別上限を使う',
  /function coopDifficultyRoundLimit\(\)/.test(index)
    && /return coopRounds \* Math\.max\(1, turnOrder\.length\)/.test(index)
    && battle.WORLD_WIDTH === 2160 && battle.WORLD_HEIGHT === 960 && battle.TERRAIN_COLUMNS === 720);
check('協力戦の味方4体は通常キャラ定義と通常drawUnitへ渡す',
  /applyCharacter\(u, entry\.character\)/.test(index)
    && /for \(const u of units\) drawUnit\(u\)/.test(index));
check('協力戦フィールドは大型2160×960を圧縮せず通常カメラで縦横移動',
  /setStageDimensions\(2160, 960\)/.test(coopResetBlock)
    && /cameraZoom = clampCameraZoom\(DEFAULT_CAMERA_ZOOM\)/.test(coopResetBlock)
    && /applyWorldCamera\(\)/.test(index)
    && /inputMode = 'pan'/.test(index)
    && /inputMode = 'cameraSlider'/.test(index)
    && /inputMode = 'pinch'/.test(index));
check('協力戦の視点変更は通常戦の保存倍率を汚さず終了時に復元',
  /function saveCameraZoom\(\)[\s\S]{0,260}if \(coopNormalSession\) return/.test(index)
    && /previousCameraZoom: cameraZoom/.test(index)
    && /previousCameraDistanceSetting: cameraDistanceSetting/.test(index)
    && /function stopCoopNormalBattle\([^)]*\)[\s\S]{0,800}session\.previousCameraZoom/.test(index));
check('進行中のゲストは重複startで試合を巻き戻さない',
  /sendMatchStart\(online\.kind === 'coop' \? msg\.from : null\)/.test(index)
    && /online\.kind === 'coop' && msg\.to && msg\.to !== online\.clientId/.test(index)
    && /online\.kind === 'coop' && \(online\.phase === 'playing' \|\| online\.phase === 'ended'\)/.test(index));
check('協力戦の受信stateは着弾と手番演出を待ち、次が権威AIなら計画を復元',
  netQueueBlock.match(/\(online\.kind === 'firebase' \|\| online\.kind === 'coop'\) && awaitingResolve/g)?.length === 2
    && /if \(next\?\.control === 'cpu'\) beginCpuTurnPlan\(next\)/.test(receivedStateBlock));
check('協力戦だけミニマップを隠し、見えない領域はタップ判定にも残さない',
  /function showTacticalStrip\(\) \{[\s\S]{0,100}if \(isCoop4v1\(\)\) return false;/.test(index)
    && /function isInMinimap\(p\) \{\s*if \(!showTacticalStrip\(\)\) return false;/.test(index));
check('ミニマップ撤去後はボスHP盤と部位TARGET盤をターン帯の直下へ詰める',
  /function tacticalStripBottom\(\)/.test(index)
    && /return isCoop4v1\(\) \? minimapTop\(\) - 7 : minimapTop\(\) \+ MINIMAP\.h;/.test(index)
    && /const y = tacticalStripBottom\(\) \+ 7;/.test(index)
    && /const y = tacticalStripBottom\(\) \+ \(isCoop4v1\(\) \? 37 : 5\);/.test(index)
    && /drawOutlinedText\('TARGET'/.test(index)
    && /label: 'CORE'/.test(index));
check('協力戦の手番キャラと大型ボスへHUDに隠れない▼マーカーを描く',
  /function drawActiveTurnMarker\(u\)/.test(index)
    && /if \(!isCoop4v1\(\)/.test(index)
    && /const jumpProjectile = [^;]+projectiles\.find\(p => p\.jump && p\.owner === u\.id\)/.test(index)
    && /const unitPosition = jumpProjectile \|\| unitAnchor\(u\)/.test(index)
    && /drawOutlinedText\('▼'/.test(index)
    && /Math\.max\(HUD_BASE_BOTTOM \+ hudShift\(\) \+ 24/.test(index)
    && /drawTurnInfo\(\);[\s\S]{0,100}drawActiveTurnMarker\(activeUnit\(\)\);/.test(index));
check('移動・照準・必殺・SUB・協力ITEMは通常戦の下部操作入力を使う',
  /function onPointerDown/.test(index) && /function onPointerMove/.test(index) && /function onPointerUp/.test(index)
    && /const activateCoopItem = isCoop4v1\(\)/.test(index));
check('協力戦でも跳躍を残し、救助弾などの協力ITEMは独立ボタンで選ぶ',
  /const coopItemBtn = \{/.test(index)
    && /let coopItemArmed = false;/.test(index)
    && /function drawCoopItemButton\(/.test(index)
    && /drawJumpButton\(\);[\s\S]{0,160}drawCoopItemButton\(\);/.test(index)
    && /const jumpAvailable = me\.jumpAvailable !== false && me\.moveLockTurns <= 0;/.test(index)
    && /const activateCoopItem = isCoop4v1\(\) && coopItemArmed/.test(index)
    && /const activateJump = !activateCoopItem[\s\S]{0,120}jumpArmed/.test(index));
check('跳躍は全モードで毎手番に戻し、移動不能デバフだけが発動を止める',
  /if \(!isCoopBossUnit\(acting\)\) acting\.jumpAvailable = true;/.test(index)
    && /me\.jumpAvailable !== false && me\.moveLockTurns <= 0/.test(index)
    && /me\.moveLockTurns > 0 \? '封印' : available \? '使用可'/.test(index)
    && /u\.moveLockTurns = Math\.max\(u\.moveLockTurns \|\| 0, 2\)/.test(index));
check('通常必殺の座標を維持し、協力戦だけ必殺・SUB・右移動を分離する',
  /const specialBtn = \{ x: VW - 92, y: CONTROL_PANEL_Y \+ 66, r: 46 \};/.test(index)
    && /const coopSpecialBtn = \{ x: VW - 55, y: CONTROL_PANEL_Y \+ 60, r: 46 \};/.test(index)
    && /const subweaponBtn = \{ x: 145, y: CONTROL_PANEL_Y \+ 30, r: 30 \};/.test(index)
    && /const coopJumpBtn = \{ x: 60, y: CONTROL_PANEL_Y \+ 62, r: 34 \};/.test(index)
    && /const coopItemBtn = \{ x: 116, y: CONTROL_PANEL_Y \+ 110, r: 30 \};/.test(index)
    && /function activeSpecialButton\(\) \{ return isCoop4v1\(\) \? coopSpecialBtn : specialBtn; \}/.test(index)
    && /function activeSubweaponButton\(\) \{ return isCoop4v1\(\) \? coopSubweaponBtn : subweaponBtn; \}/.test(index)
    && /function activeJumpButton\(\) \{ return isCoop4v1\(\) \? coopJumpBtn : jumpBtn; \}/.test(index)
    && /const padding = isCoop4v1\(\) \? 0 : normalPadding;/.test(index)
    && /radialControlHit\(p0, FIRE_BTN, 10\)/.test(index)
    && Math.hypot(145 - 270, 690 - 810) > (30 + 5) + (117 + 10)
    && Math.hypot(145 - 92, 690 - 760) > (30 + 5) + (34 + 10)
    && Math.hypot(60 - 116, 722 - 770) > 34 + 30
    && Math.hypot(116 - 270, 770 - 810) > 30 + 117
    && Math.hypot(485 - 420, 720 - 770) > 46 + 30
    && Math.hypot(420 - 270, 770 - 810) > 30 + 117
    && /const offsetY = isCoop4v1\(\) \? 58 : 73;/.test(index)
    && /return \{ x: 24, y: tacticalHudBottom\(\) \+ offsetY, w: CAMERA_SLIDER\.w \};/.test(index)
    && /const slider = cameraSliderRect\(\);/.test(index));
check('救助直後は同じ味方巡回を待機し、直後の要塞砲撃から1回保護する',
  /target\.coopReviveGuard = true;/.test(index)
    && /target\.coopRevivedBossRound = coopBossRoundNumber\(\);/.test(index)
    && /function showCoopReviveHold\(/.test(index)
    && /KatamonCoopBattle\.shouldHoldRevivedTurn\(next, coopBossRoundNumber\(\)\)/.test(index)
    && /coopReviveGuard: !coopBoss/.test(index));
check('ボス標的は距離固定ではなく席順ローテーションし、救助保護対象を後回しにする',
  /function coopBossPlannedTarget\(\)/.test(index)
    && /const unguarded = alive\.filter\(unit => unit\.coopReviveGuard !== true\);/.test(index)
    && /\(coopBossRoundNumber\(\) - 1\) % pool\.length/.test(index)
    && /const foe = isCoopBossUnit\(self\) \? coopBossPlannedTarget\(\) : cpuPickTarget\(self\);/.test(index));
check('要塞砲撃は発射前から標的・攻撃種別を前景サイトで予告する',
  /function drawCoopBossAttackWarning\(\)/.test(index)
    && /danger \? 'LOCK ON' : '次弾 TARGET'/.test(index)
    && /attack\.warningLabel/.test(index)
    && index.lastIndexOf('drawCoopBossAttackWarning();') > index.lastIndexOf('for (const u of units) drawUnit(u);'));
check('プレイヤーの弾道ガイドは大型ボスを含む全ユニットより手前へ描く',
  index.lastIndexOf('drawTrajectoryPreview();') > index.lastIndexOf('for (const u of units) drawUnit(u);'));
check('大型ボスは透明余白を含む一枚四角ではなく複合形状で当たり判定する',
  /const COOP_BOSS_HIT_SHAPES = Object\.freeze\(\[/.test(index)
    && /function distanceToCoopBossBody\(/.test(index)
    && /return distanceToCoopBossBody\(u, x, y\);/.test(index)
    && /return distanceToCoopBossBody\(u, p\.x, p\.y\) <= p\.radius;/.test(index));
check('露出COREは通常弾の正しい弾道を開口部へ通し、狙点サイトは実判定サイズで強調',
  /function coopBossProjectileWillReachExposedCore\(/.test(index)
    && /p\.coopCorePassageBossId = u\.id/.test(index)
    && /const hitRadius = Math\.min\(rect\.width, rect\.height\) \* def\.radius;/.test(index)
    && /ctx\.setLineDash\(\[6, 5\]\)/.test(index)
    && /drawOutlinedText\('CORE OPEN'/.test(index));
check('要塞直撃は装甲・部位・COREへ分岐し、地面爆風は通常減衰を維持',
  /function applyResolvedUnitDamage\(/.test(index)
    && /!options\.direct/.test(index)
    && /coopBossDirectTargetAt\(target, options\.x, options\.y/.test(index)
    && /api\.applyLiveDamage\(state, impactTarget, requested\)/.test(index)
    && /装甲軽減/.test(index)
    && /CORE ×/.test(index));
check('部位破壊はボス攻撃性能へ反映し、Phase 2は変形手番・CORE・専用BGMを伴う',
  /liveAttackProfile/.test(index)
    && /function activateCoopBossPhase2\(/.test(index)
    && /turnCount\+\+; \/\/ 変形で要塞の1手を消費/.test(index)
    && /function showCoopPhase2CutIn\(/.test(index)
    && /return 'coopPhase2'/.test(index)
    && /coopPhase2: '要塞決戦・第二形態'/.test(index));
check('開始・途中stateは部位HPとCOREを検証し、外側phaseだけの改変を拒否',
  /deps\.boss\?\.liveStateLooksSafe/.test(source)
    && /unit\.phase === unit\.bossState\.phase/.test(source)
    && /deps\.boss\?\.liveStateIsInitial/.test(source)
    && /u\.phase = u\.bossState\?\.phase === 2 \? 2 : 1;/.test(index));
check('通常弾とボス弾は同じ実弾physicsを通り、発射時に直接HPを減らさない',
  /fireProjectile\(unit\.id/.test(bossShotBlock)
    && /bossShot: true/.test(bossShotBlock)
    && !/\.hp\s*[-+]=/.test(bossShotBlock));
check('協力ITEMも実弾の着弾後だけ効果を解決',
  /fireProjectile\(unit\.id/.test(itemShotBlock)
    && /coopItemId: itemId/.test(itemShotBlock)
    && /if \(p\.coopItemId\)[\s\S]{0,120}resolveCoopItemImpact/.test(index)
    && /function coopItemCanImpactTarget\(/.test(index)
    && /p\.coopItemId && !coopItemCanImpactTarget\(p, u\)/.test(index));
check('要塞へ当てた跳躍は着弾点へ埋めず、進入側の車体外へ安全着地',
  /function coopBossSafeJumpLanding\(/.test(index)
    && /function coopBossJumpLandingForImpact\(/.test(index)
    && /const underBossSpan = terrainHit/.test(index)
    && /distanceToCoopBossBody\(boss, candidateX, candidateY\)/.test(index)
    && /teleportOwnerToImpact\(p, p\.x, p\.y, false, u\)/.test(index));
check('専用地形は大型鋼鉄地面と初期台座3つを守り、高所を含む移動用4足場だけ破壊可能',
  /const COOP_PLATFORM_LAYOUT = Object\.freeze\(\[/.test(index)
    && (index.match(/Object\.freeze\(\{ start: 0\./g) || []).length === 7
    && /setStageDimensions\(2160, 960\)/.test(coopResetBlock)
    && /for \(const platform of COOP_PLATFORM_LAYOUT\)/.test(index)
    && /addFloatingIsland\([\s\S]{0,300}'mesa'/.test(index)
    && (index.match(/spawnSteel: true/g) || []).length === 3
    && (index.match(/spawnSteel: false/g) || []).length === 4
    && /top: 0\.26/.test(index)
    && /top: 0\.19/.test(index)
    && /if \(!platform\.spawnSteel\) continue/.test(index)
    && /currentTerrainMaterial = 'terrain'/.test(index)
    && /function loadCoopBossTerrain\(\)[\s\S]{0,2400}craterHistory = \[\]/.test(index));
check('ライブ要塞は大型化し、固定判定を動かさない外装待機モーションを持つ',
  /const COOP_BOSS_WIDTH = 560;/.test(index)
    && /const COOP_BOSS_HEIGHT = 372;/.test(index)
    && /function drawCoopBossIdleMotion\(u, rect, foreground\)/.test(index)
    && /drawCoopBossIdleMotion\(u, rect, false\);/.test(index)
    && /drawCoopBossIdleMotion\(u, rect, true\);/.test(index)
    && !/function drawCoopBossIdleMotion[\s\S]{0,5000}u\.(x|y)\s*=/.test(index));
check('ホスト1人でもAI3体を生成してライブ戦闘へ渡す',
  /activeRoster\(room\.slots, room\.settings\?\.aiFill/.test(liveStartBlock)
    && /SEATS\.some\(seat => !roster\[seat\]\)/.test(liveStartBlock)
    && Object.keys(soloRoster).length === 4);
check('ソロ＋CPU3体は不要なFirebase戦闘通信を送らずローカル権威で動く',
  /const soloHost = config\.session\.role === 'host' && humans === 1/.test(liveStartBlock)
    && /soloHost \? createSoloNormalBattleTransport\(\) : createNormalBattleTransport/.test(liveStartBlock)
    && /function createSoloNormalBattleTransport\(\)/.test(source));
check('複数人戦で通信Rulesが古ければ誤った認証切れ表示で続行しない',
  /Firebaseルールが最新版か確認してください/.test(source)
    && /reportNormalBattleError/.test(source)
    && /reportNormalBattleError\(message\)/.test(index));
check('複数人協力戦は48桁の行動IDでfire・state・resultを同じ1手へ結ぶ',
  /const NORMAL_ACTION_ID_RE = \/\^\[0-9a-f\]\{48\}\$\//.test(source)
    && /online\.kind === 'firebase' \|\| online\.kind === 'coop'/.test(index)
    && /actionId: action\.actionId/.test(index));
check('再戦は通信generationを更新し旧試合の遅着packetを捨てる',
  /generation: online\.matchGeneration/.test(index)
    && /online\.matchGeneration = Math\.min\(100000, online\.matchGeneration \+ 1\)/.test(index)
    && /packet\.generation !== activeGeneration/.test(source)
    && /packet\.generation < activeGeneration/.test(source));
check('協力戦のturn stateは不変な鋼鉄地形を毎回再送しない',
  /buildSnapshot\(\{ includeTerrain: false \}\)/.test(index)
    && /preserveTerrain: true/.test(index));
check('協力メッセージはRTDB発番キーと上限付きカーソルで取得',
  /limitToLast: NORMAL_MESSAGE_PAGE_SIZE/.test(source)
    && /startAt: JSON\.stringify\(historyCursor\)/.test(source)
    && /method: 'POST'/.test(source)
    && /NORMAL_RECENT_KEY_LIMIT = 256/.test(source));
check('初回履歴cursor確立後にhello・joinの送信を開始',
  /const historyReadyGate = new Promise/.test(source)
    && /await historyReadyGate/.test(source)
    && /historyReady = true;[\s\S]{0,100}releaseHistoryReady/.test(source));
check('AI引継ぎ後は元席の遅着fire・state・resultを権威検証で拒否',
  source.indexOf("delegatedSeats?.has(ownerSeat)") >= 0
    && source.indexOf("delegatedSeats?.has(ownerSeat)") < source.indexOf("packet.unitId === NORMAL_SEAT_UNIT[outer.seat]")
    && /return outer\.seat === 'p1'/.test(source));
check('AI引継ぎ通知はfire・stateと同じFIFO順で適用',
  /const NET_CONTROL_TYPES = new Set\(\['join', 'hello', 'ready', 'bye', 'commit'/.test(index)
    && !/const NET_CONTROL_TYPES = new Set\([^\n]*'takeover'/.test(index)
    && /const COOP_FIFO_TYPES = new Set\(\['move', 'takeover', 'bye'\]\)/.test(index)
    && /online\.kind === 'coop' && COOP_FIFO_TYPES\.has\(msg\.t\)[\s\S]{0,120}enqueueNetMessage\(msg\)/.test(index));
check('host自身もAI引継ぎをRTDB順で受信してから適用',
  /msg\.from === online\.clientId && !\(online\.kind === 'coop' && msg\.t === 'takeover'\)/.test(index)
    && /onSeatLiveness\?\.\(\(seat, useAi\)[\s\S]{0,420}netSend\(\{ t: 'takeover', seat, value: useAi === true \}\)/.test(index)
    && !/onSeatLiveness\?\.\(\(seat, useAi\)[\s\S]{0,420}applyCoopSeatTakeover/.test(index)
    && /if \(!historyReady\)[\s\S]{0,160}setTimeout\(pollRoomLiveness, POLL_INTERVAL_MS\)/.test(source));
check('開始確認中に参加者が落ちてもAI補充後に待機を解除',
  /function maybeStartCoopNormalAfterReady\(\)/.test(index)
    && /case 'takeover':[\s\S]{0,320}applyCoopSeatTakeover[\s\S]{0,160}maybeStartCoopNormalAfterReady\(\)/.test(index));
check('行動不能・救助待機カットイン中のAI引継ぎは中間stateを送らない',
  /carriedAction\?\.resolved && !awaitingResolve[\s\S]{0,100}cutIn\?\.kind !== 'actionSkip'[\s\S]{0,80}cutIn\?\.kind !== 'reviveHold'/.test(index));
check('最終手の行動不能スキップ後も直前actionIdの端末が時間切れを宣言',
  /function canDeclareMatchEnd\(\)[\s\S]{0,520}online\.localAction\?\.unitId[\s\S]{0,180}online\.remoteAction/.test(index));
check('ロビーseenAtが古い正常参加者を出撃直後にAI化しない',
  battle.BATTLE_LIVENESS_GRACE_MS >= 18000
    && /withinStartGrace/.test(source)
    && /transportStartedAt \+ BATTLE_LIVENESS_GRACE_MS/.test(source));
check('state待ち中は次の人間入力とhost CPUを止める',
  /function coopAwaitingAuthoritativeState\(\)/.test(index)
    && /participantRole === 'spectator' \|\| coopAwaitingAuthoritativeState\(\)/.test(index)
    && /!awaitingResolve && !coopAwaitingAuthoritativeState\(\)/.test(index));
check('協力stateも通常戦と同じ盤面整合監査を通す',
  /const baseline = buildSnapshot\(\)/.test(index)
    && /const snapshotMismatch = phase2Handoff \? '' : stateSnapshotMismatchReason\(msg\.snap, baseline\)/.test(index)
    && /\|\| snapshotMismatch/.test(index));
check('Phase 2の通信だけ要塞手番1回ぶんを厳格に繰り上げる',
  /function coopPhase2StateHandoffOk\(/.test(index)
    && /Number\(snap\.turnCount\) !== Number\(baseline\.turnCount\) \+ 1/.test(index)
    && /before\.phase !== 1/.test(index)
    && /after\.phase !== 2/.test(index)
    && /livePhase2TransitionLooksSafe/.test(index)
    && /function coopPhase2BossHpEligible\(/.test(index)
    && /function coopPhase2ExpectedWind\(/.test(index)
    && /const windChanges = Number\(snap\.turnCount\) % \(snap\.turnOrder\.length \* 2\) === 0/.test(index)
    && /const expected = windChanges \? baseline\.nextWind : baseline\.wind/.test(index)
    && /const expectedWind = coopPhase2ExpectedWind\(snap, baseline\)/.test(index)
    && /\(phaseChanged && !phase2Handoff\)/.test(receivedStateBlock));
check('同じPhaseの部位・CORE改変を拒否し、変形時も既存装甲を照合',
  /stableFirebaseJson\(saved\.bossState\) !== stableFirebaseJson\(local\.bossState\)/.test(index)
    && /function livePhase2TransitionLooksSafe\(/.test(bossSource));
check('協力resultは5体の順序・HP範囲・勝敗整合を検証',
  /packet\.units\.map\(unit => unit\?\.id\)\.join\(','\) !== NORMAL_TURN_ORDER\.join\(','\)/.test(source)
    && /expectedWinner = playerAlive && !bossAlive/.test(source)
    && /packet\.reason === '時間切れ'/.test(source)
    && /playerHp \/ playerMaxHp/.test(source)
    && /packet\.winner === expectedWinner/.test(source));
check('リザルト中は通常操作を止めてロビーか再戦だけを受け付ける',
  /isCoop4v1\(\) && online\?\.kind === 'coop'/.test(index)
    && /returnCoopNormalToLobby/.test(index));
check('戦闘メニューのタイトル退出はロビー再表示と分離して部屋を片付ける',
  /if \(online\?\.kind === 'coop'\) \{\s*exitCoopNormalToTitle\(\)/.test(index)
    && /Promise\.resolve\(session\.onExitTitle\?\.\(\)\)/.test(index)
    && /async function exitNormalBattleToTitle\(config\)/.test(source)
    && /coopRooms\/\$\{session\.code\}[^\n]+method: 'DELETE'/.test(source)
    && /onExitTitle\(\)/.test(roomSource));
check('照準線は白・緑・紫・赤・橙を区別', ['#ffffff', '#65e092', '#a873ff', '#ff5d4f', '#f29a38'].every((color) => index.includes(color)));
check('ホスト開始ボタンが実戦を起動', /start\.disabled = !startable/.test(roomSource) && /超大型要塞へ出撃/.test(roomSource) && /startBattle/.test(roomSource));
check('通常ONLINEと別のcoopRoomsだけを使用', source.includes('coopRooms/${roomSession.code}') && !source.includes('rooms/${roomSession.code}'));
check('再戦非希望のゲスト席だけ受付後にホスト解放可能', rules.rules.coopRooms.$room.slots.$seat['.write'].includes("phase').val() === 'results'") && rules.rules.coopRooms.$room.slots.$seat['.write'].includes("child('ready').val() !== true"));
check('ホスト90秒無応答時だけ着席ゲストが無報酬ロビー中断可能', rules.rules.coopRooms.$room.phase['.write'].includes("newData.val() === 'lobby'") && rules.rules.coopRooms.$room.phase['.write'].includes("child('p1').child('seenAt').val() < now - 90000") && rules.rules.coopRooms.$room.phase['.write'].includes("child('e1').child('uid').val() === auth.uid"));
check('協力戦scriptはroomより先に読み込む', index.indexOf('coop-mvp-battle.js') < index.indexOf('coop-mvp-room.js'));
check('PWAへ協力戦scriptを登録', sw.includes("'./coop-mvp-battle.js'"));
check('協力matchIdは開始時に固定しラウンド進行で変えない', /const settings = \{ \.\.\.session\.room\.settings, revision, matchId: roundId \}/.test(roomSource)
  && /const fixed = room\.settings\?\.matchId/.test(source)
  && /String\(fixed\)\.toLowerCase\(\)/.test(source));
check('Android/iPhone実機QAは人数・同期・切断・報酬・回帰を固定', ['1人＋AI補充ON', '2人＋AI補充ON', '全端末でボスHP', 'ホストが90秒以上', '報酬が二重付与されない', '通常ONLINE'].every((text) => mobileQa.includes(text)));

console.log(`協力ボス実戦統合（${passed}/${passed} passed）`);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
