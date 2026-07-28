// 結果画面の「タイトルへ戻る」の検証。
// 勝った直後だけは中断セーブしてから戻る(誤タップで連勝を失わないため)。
// 使い方: node tests/resulttest.js
const h = require('./seatharness.js');
const kt = h.kt();
const canvas = h.canvas;
const win = globalThis.window;

let pass = 0, fail = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) { pass++; log.push(`  ok   ${name}`); }
  else { fail++; log.push(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

let pid = 1;
function tap(x, y) {
  const id = pid++;
  canvas.__fire('pointerdown', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: Date.now(), button: 0 });
  win.__fire('pointerup', { pointerId: id, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: Date.now() });
}
function tapTitleButton() { const b = kt.resultTitleBtn(); tap(b.x, b.y + b.shift); }

// 決着まで進めたあと、結果ボタンが押せるようになる余韻(matchEndPause)も明ける。
function playToEnd(maxFrames = 60000) {
  let frames = 0;
  while (!kt.state().matchOver && frames++ < maxFrames) {
    if (kt.hud().fireActive) {
      const fb = kt.fireBtn();
      const toRight = kt.foeUnit().x > kt.localUnit().x;
      const id = pid++;
      canvas.__fire('pointerdown', { pointerId: id, clientX: fb.x, clientY: fb.y, pointerType: 'mouse', timeStamp: Date.now(), button: 0 });
      canvas.__fire('pointermove', { pointerId: id, clientX: fb.x + (toRight ? -70 : 70), clientY: fb.y + 55, pointerType: 'mouse', timeStamp: Date.now() });
      win.__fire('pointerup', { pointerId: id, clientX: fb.x + (toRight ? -70 : 70), clientY: fb.y + 55, pointerType: 'mouse', timeStamp: Date.now() });
    }
    kt.step(1 / 60);
  }
  let n = 0;
  while (kt.endPause() > 0 && n++ < 600) kt.step(1 / 60);
  return kt.state().matchOver;
}

// 勝ち・負けはCPU次第なので、狙った決着が出るまで試合をやり直す。
function playUntil(wantWin, tries = 40, afterStart) {
  for (let i = 0; i < tries; i++) {
    kt.startBattle();
    if (afterStart) afterStart(); // startBattle は winStreak を0に戻すので、その後に仕込む
    if (!playToEnd()) continue;
    if ((kt.state().winner === 'player') === wantWin) return true;
  }
  return false;
}

// ---- 1. 勝利 → 中断セーブされる ----
localStorage.clear();
check('勝ち試合を作れる', playUntil(true), 'CPUに勝てなかった');
const streakAtWin = kt.streak();
check('勝って連勝が立っている', streakAtWin > 0, String(streakAtWin));
check('勝利画面では中断して戻る扱い', kt.keepsRunOnExit() === true);

tapTitleButton();
check('タイトルへ戻っている', kt.state().gamePhase === 'title', kt.state().gamePhase);
check('中断セーブが残る', kt.hasSave() === true);
const saved = kt.load();
check('保存された中断セーブが読める', !!saved);
check('連勝が保存されている', saved && saved.winStreak === streakAtWin, saved && String(saved.winStreak));
check('保存されているのは次の試合の頭', saved && saved.turnCount === 0 && saved.activeIndex === 0,
  saved && `turnCount=${saved.turnCount} activeIndex=${saved.activeIndex}`);
check('決着済みの状態は保存されない', saved && !saved.matchOver);
check('10連勝ごとのボス戦フラグが引き継がれる',
  saved && saved.isBossMatch === (streakAtWin % 10 === 0), saved && `${saved.isBossMatch}/${streakAtWin}`);

// 再開すると連勝を保ったまま続きから戦える
kt.apply(saved);
check('再開後も連勝が残る', kt.streak() === streakAtWin, `${streakAtWin}→${kt.streak()}`);
check('再開後は決着していない', kt.state().matchOver === false);
check('再開後は両者とも生きている', kt.units.every(u => u.hp > 0), kt.units.map(u => u.hp).join(','));

// ---- 1b. 10連勝の節目で中断 → 再開するとボス戦から続く ----
// (ユーザーが実機で遭遇した場面そのもの。ここで連勝が飛ぶのが一番痛い)
localStorage.clear();
// この試合に勝つとちょうど10連勝になる状態から始める
check('10連勝の場面を作れる', playUntil(true, 40, () => kt.setStreak(9)), 'CPUに勝てなかった');
if (kt.streak() === 10) {
  tapTitleButton();
  const bossSave = kt.load();
  check('10連勝が保存されている', bossSave && bossSave.winStreak === 10, bossSave && String(bossSave.winStreak));
  check('次はボス戦として保存されている', bossSave && bossSave.isBossMatch === true, bossSave && String(bossSave.isBossMatch));
  check('ボス戦の闘技場マップで保存されている', bossSave && bossSave.pattern === 'tieredBasin', bossSave && String(bossSave.pattern));
  kt.apply(bossSave);
  check('再開すると10連勝のままボス戦が始まる',
    kt.streak() === 10 && kt.isBoss() === true && kt.pattern() === 'tieredBasin',
    `streak=${kt.streak()} boss=${kt.isBoss()} pattern=${kt.pattern()}`);
} else {
  check('10連勝の場面を作れる(連勝数)', false, `streak=${kt.streak()}`);
}

// ---- 2. 敗北 → 従来どおり(中断セーブしない) ----
localStorage.clear();
check('負け試合を作れる', playUntil(false), 'CPUに負けられなかった');
check('敗北画面は中断しない扱い', kt.keepsRunOnExit() === false);
check('敗北時は連勝が0', kt.streak() === 0, String(kt.streak()));
tapTitleButton();
check('敗北でもタイトルへ戻る', kt.state().gamePhase === 'title', kt.state().gamePhase);
check('敗北では中断セーブを作らない', kt.load() === null, JSON.stringify(kt.load() && kt.load().winStreak));

// ---- 3. フリーモード → 従来どおり ----
localStorage.clear();
kt.startFree();
playToEnd();
check('フリーモードは中断しない扱い', kt.keepsRunOnExit() === false, `mode=${kt.mode()} winner=${kt.state().winner}`);
tapTitleButton();
check('フリーモードでもタイトルへ戻る', kt.state().gamePhase === 'title', kt.state().gamePhase);
check('フリーモードでは中断セーブを作らない', kt.load() === null);

// ---- タイトルの CPU BATTLE が中断データを知らせること(Codex引き継ぎ書§6 #7) ----
// 以前はキャラ選択まで進まないと再開ボタンが見えず、中断した対戦があること自体に
// 気づけなかった。案内を落とすと元の状態に戻るので、ここで固定しておく。
check('告知は吹き出しが担い、説明文は通常のまま', !kt.titleCpuButtonSub().includes('中断'),
  kt.titleCpuButtonSub());
check('吹き出しの文面が中断を知らせている', kt.saveBubbleText().includes('中断'), kt.saveBubbleText());

// 尻尾は CPU BATTLE の文字へ向ける。ボタンの外や端を指すと、何の告知か分からなくなる。
{
  const tip = kt.saveBubbleTailTip();
  const btn = kt.titleCpuBtn();
  check('尻尾の先がCPUボタンの横幅に収まる',
    tip.x > btn.x - btn.w / 2 && tip.x < btn.x + btn.w / 2, `x=${tip.x}`);
  check('尻尾の先が文字の近く(中央寄り)を指す',
    Math.abs(tip.x - btn.x) < btn.w / 4, `中央からの差=${Math.abs(tip.x - btn.x)}`);
  check('尻尾はボタン枠の中へ入らない', tip.y <= btn.y - btn.h / 2, `y=${tip.y}`);
}

// 目で見られないぶん、置き場所は数値で押さえる。
// 幅は文字量で変わるので、想定より広い場合と狭い場合の両方で確かめる。
const cpuBtn = kt.titleCpuBtn();
for (const textW of [120, 220, 320, 460]) {
  const box = kt.saveBubbleRect(textW);
  check(`吹き出しが画面内に収まる(文字幅${textW})`, box.x >= 0 && box.x + box.w <= kt.viewW(),
    `x=${box.x} w=${box.w} VW=${kt.viewW()}`);
  check(`吹き出しがCPUボタンに被らない(文字幅${textW})`, box.y + box.h <= cpuBtn.y - cpuBtn.h / 2,
    `下端=${box.y + box.h} ボタン上端=${cpuBtn.y - cpuBtn.h / 2}`);
  check(`吹き出しがロゴに被らない(文字幅${textW})`, box.y >= 445,
    `上端=${box.y}`);
}
// 光らせる側は新しい描画経路なので、実際にタイトルを描かせて例外が出ないことも見る。
kt.setPhase('title');
let titleDrawThrew = null;
for (const hasSave of [true, false]) {
  kt.setHasSave(hasSave);
  try { kt.render(); } catch (e) { titleDrawThrew = `hasSave=${hasSave}: ${e.message}`; }
}
check('中断データの有無どちらでもタイトルを描画できる', !titleDrawThrew, titleDrawThrew);

console.log('\n=== result screen ===');
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
