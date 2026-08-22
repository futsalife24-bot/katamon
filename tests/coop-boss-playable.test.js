const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const battle = require('../coop-mvp-battle.js');

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

let state = battle.createBattleState({ matchId: A, difficulty: 'normal', slots, aiFill: true, characters });
check('4席の協力パーティを生成', Object.keys(state.party.players).length === 4);
check('キャラ固有最大HPを保持', state.party.players.p1.maxHp === 100 && state.party.players.e1.maxHp === 90);
check('2人+AI2のボスHPは90%補正', state.encounter.boss.body.maxHp === Math.round(battle.BASE_BODY_HP.normal * 0.9));
check('全員の燃料と必殺ゲージを初期化', Object.values(state.party.players).every((player) => player.fuel === 100 && player.specialGauge === 0));

const bossPoint = { x: 1250, y: 500 };
let result = battle.applyPlayerAction(state, 'p1', { x: 180, fuelSpent: 12, aim: bossPoint, weapon: { kind: 'normal', id: 'normal' } });
check('通常弾で本体HPを削る', result.state.encounter.boss.body.hp < state.encounter.boss.body.hp);
check('移動燃料は不可逆に消費', result.state.party.players.p1.fuel === 88);
check('命中で必殺ゲージを蓄積', result.state.party.players.p1.specialGauge > 0);
check('通常対戦と同じ4行動で必殺ゲージMAX', result.state.party.players.p1.specialGauge === 25);
check('通常弾は鋼鉄足場を残して地形を削る',
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
const roomSource = fs.readFileSync(path.join(root, 'coop-mvp-room.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const mobileQa = fs.readFileSync(path.join(root, 'docs', 'coop-boss-mvp-mobile-qa.md'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
check('縦持ち720×960の協力戦Canvas', /width="720" height="960"/.test(source));
check('黒鉄・真鍮の操作盤と火山背景を使用', source.includes('#243238f2') && source.includes('#9f7137') && /stage-volcanic-bg\.jpg/.test(source));
check('戦場HUDも既存カタモンのUI・見出し書体を使用', source.includes("getPropertyValue('--katamon-font-ui')") && source.includes("getPropertyValue('--katamon-font-display')") && /setCanvasFont\(900, 54, true\)/.test(source));
check('既存キャラruntime素材をBridgeから受け取る', /assetPath: character\.assetBase/.test(index));
check('指を離した瞬間にREADY送信', /canvas\.onpointerup.*commitLocal/s.test(source));
check('ダウン中の人間を入力待ちに含めずAI救助を止めない', /!state\.roster\[seat\]\.ai && deps\.survival\.canAct\(state\.party\.players\[seat\], state\.round\)/.test(source));
check('リザルト中は戦闘操作を畳んで誤操作を防ぐ', source.includes('.coop-battle-controls.results .coop-battle-row') && /controlsEl\.classList\.add\('results'\)/.test(source));
check('移動同期は既存0.25秒・8px契約を流用', /shouldSyncMove\(lastMoveSync/.test(source));
check('照準線は白・緑・紫・赤・橙を区別', ['#ffffff', '#65e092', '#a873ff', '#ff5d4f', '#f29a38'].every((color) => source.includes(color)));
check('ホスト開始ボタンが実戦を起動', /start\.disabled = !startable/.test(roomSource) && /超大型要塞へ出撃/.test(roomSource) && /startBattle/.test(roomSource));
check('通常ONLINEと別のcoopRoomsだけを使用', source.includes('coopRooms/${roomSession.code}') && !source.includes('rooms/${roomSession.code}'));
check('再戦非希望のゲスト席だけ受付後にホスト解放可能', rules.rules.coopRooms.$room.slots.$seat['.write'].includes("phase').val() === 'results'") && rules.rules.coopRooms.$room.slots.$seat['.write'].includes("child('ready').val() !== true"));
check('ホスト90秒無応答時だけ着席ゲストが無報酬ロビー中断可能', rules.rules.coopRooms.$room.phase['.write'].includes("newData.val() === 'lobby'") && rules.rules.coopRooms.$room.phase['.write'].includes("child('p1').child('seenAt').val() < now - 90000") && rules.rules.coopRooms.$room.phase['.write'].includes("child('e1').child('uid').val() === auth.uid"));
check('協力戦scriptはroomより先に読み込む', index.indexOf('coop-mvp-battle.js') < index.indexOf('coop-mvp-room.js'));
check('PWAへ協力戦scriptを登録', sw.includes("'./coop-mvp-battle.js'"));
check('Android/iPhone実機QAは人数・同期・切断・報酬・回帰を固定', ['2人＋AI補充ON', '全端末でボスHP', 'ホストが90秒以上', '報酬が二重付与されない', '通常ONLINE'].every((text) => mobileQa.includes(text)));

console.log(`協力ボス実戦統合（${passed}/${passed} passed）`);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
