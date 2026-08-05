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
    const winner = kt.state().winner;
    // 引き分けは勝ちでも負けでもない。v91で引き分けが入って以降、
    // 「winner !== 'player' なら敗北」とみなすと引き分けを敗北として拾い、
    // 敗北時の検査(中断セーブを作らない等)が落ちることがあった。
    if (winner === 'draw') continue;
    if ((winner === 'player') === wantWin) return true;
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

// ---- 中断データがある時に新しく出撃しようとしたら、消す前に確認すること ----
// selectCharacterAndStart() は入口で clearSuspendedMatch() を呼ぶので、素通しすると
// 押した瞬間に消えて戻せない(2026-07-29の要望)。
{
  kt.setPhase('select');
  // 中断データを作ってから、新規出撃を試みる
  kt.startBattle(kt.chars()[0]);
  kt.forceWinner('player');
  kt.save();
  kt.setHasSave(true);
  const started = kt.requestNewMatch(kt.chars()[1]);
  check('中断データがある時は、すぐには始めない', started === false);
  check('確認待ちの状態になる', kt.pendingNewMatch() === kt.chars()[1], String(kt.pendingNewMatch()));
  check('確認中はまだ中断データが残っている', kt.load() !== null);

  kt.resolveNewMatchConfirm('cancel');
  check('やめるを選んだら中断データは残る', kt.load() !== null);
  check('やめるを選んだら確認待ちも解ける', kt.pendingNewMatch() === null);

  kt.setHasSave(true);
  kt.requestNewMatch(kt.chars()[1]);
  kt.resolveNewMatchConfirm('start');
  check('消して出撃を選んで初めて中断データが消える', kt.load() === null);

  // 中断データが無ければ、確認を挟まずそのまま始まる
  kt.setHasSave(false);
  check('中断データが無ければ確認を挟まない', kt.requestNewMatch(kt.chars()[2]) === true);
  check('その時は確認待ちにならない', kt.pendingNewMatch() === null);
}
{
  // 3つのボタンが重ならず、画面に収まっていること
  const b = kt.newMatchBtns();
  const rows = [b.resume, b.start, b.cancel];
  for (const r of rows) {
    check(`確認ボタンが画面に収まる(y=${r.y})`,
      r.x - r.w / 2 >= 0 && r.x + r.w / 2 <= kt.viewW() && r.y - r.h / 2 >= 0, JSON.stringify(r));
  }
  check('確認ボタンどうしが重ならない',
    rows[0].y + rows[0].h / 2 < rows[1].y - rows[1].h / 2
    && rows[1].y + rows[1].h / 2 < rows[2].y - rows[2].h / 2);
  // 1つ目のボタンの上端が本文の最終行へ被り、「元に戻せません。」が半分隠れていた
  // (2026-07-29に実機で発覚)。文字は12pxなので、下端までの余裕を見て8px空ける。
  const textY = kt.newMatchTextY();
  const lastLine = textY.body[textY.body.length - 1];
  check('本文がボタンに隠れない', rows[0].y - rows[0].h / 2 > lastLine + 8,
    `ボタン上端=${rows[0].y - rows[0].h / 2} 本文最終行=${lastLine}`);
  check('本文が見出しより下にある', textY.body[0] > textY.title,
    `見出し=${textY.title} 本文=${textY.body[0]}`);
  // 中身がパネルからはみ出さないこと。ボタンを下げていくと、まずここが破れる。
  const panel = kt.newMatchPanel();
  const top = panel.y - panel.h / 2, bottom = panel.y + panel.h / 2;
  check('見出しがパネルの中にある', textY.title > top, `見出し=${textY.title} 上端=${top}`);
  for (const r of rows) {
    check(`確認ボタンがパネルの中にある(y=${r.y})`,
      r.y - r.h / 2 > top && r.y + r.h / 2 < bottom
      && r.x - r.w / 2 > panel.x - panel.w / 2 && r.x + r.w / 2 < panel.x + panel.w / 2,
      `ボタン=${r.y - r.h / 2}〜${r.y + r.h / 2} パネル=${top}〜${bottom}`);
  }
}

// ---- タイトルの CPU BATTLE が中断データを知らせること(Codex引き継ぎ書§6 #7) ----
// 以前はキャラ選択まで進まないと再開ボタンが見えず、中断した対戦があること自体に
// 気づけなかった。案内を落とすと元の状態に戻るので、ここで固定しておく。
check('告知は吹き出しが担い、説明文は通常のまま', !kt.titleCpuButtonSub().includes('中断'),
  kt.titleCpuButtonSub());
check('吹き出しの文面が中断を知らせている', kt.saveBubbleText().includes('中断'), kt.saveBubbleText());

// 尻尾は短い出っ張り。CPU BATTLE の側(左下)へ向くが、ボタンまでは届かせない。
{
  const btn = kt.titleCpuBtn();
  const box = kt.saveBubbleRect(120);
  const t = kt.saveBubbleTail(box);
  check('尻尾は吹き出しより下へ出る', t.tip.y > box.y + box.h, `先端y=${t.tip.y} 下端=${box.y + box.h}`);
  // 枠に軽くかかるのが狙い。届かないと繋がって見えず、入りすぎると CPU BATTLE の
  // 文字(button.y - 7)に被って読めなくなる。
  check('尻尾の先がボタン枠に軽くかかる',
    t.tip.y > btn.y - btn.h / 2 && t.tip.y < btn.y - 14,
    `先端y=${t.tip.y.toFixed(0)} 枠上端=${btn.y - btn.h / 2} 文字=${btn.y - 7}`);
  // 見るのは先端の絶対位置ではなく伸びる向き。付け根が右寄りなので、左下へ伸びても
  // 先端は中心より右に来る。ここを中心と比べると、正しい向きなのに落ちる。
  check('尻尾はCPU BATTLEの側(左下)へ伸びる', t.tip.x < t.base.x && t.tip.y > t.base.y,
    `付け根=(${t.base.x.toFixed(0)},${t.base.y.toFixed(0)}) 先端=(${t.tip.x.toFixed(0)},${t.tip.y.toFixed(0)})`);
  // 付け根が真下より右にあること。ここが左へ回ると、尻尾が吹き出しの下を横切る形になる。
  check('付け根は吹き出しの中央よりやや右', (t.at[0] + t.at[1]) / 2 < Math.PI / 2,
    `角度=${((t.at[0] + t.at[1]) / 2 / Math.PI).toFixed(2)}π`);
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
  // 下げすぎると SELECT A BATTLE MODE の帯に楕円が乗る。尻尾が横切るのは想定内だが、
  // 本体が被ると文字が読めなくなる。
  check(`吹き出しがモードラベルに乗らない(文字幅${textW})`, box.y + box.h < kt.modeLabelY() - 4,
    `下端=${box.y + box.h} ラベル=${kt.modeLabelY()}`);
}
// 光らせる側は新しい描画経路なので、実際にタイトルを描かせて例外が出ないことも見る。
kt.setPhase('title');
let titleDrawThrew = null;
for (const hasSave of [true, false]) {
  kt.setHasSave(hasSave);
  try { kt.render(); } catch (e) { titleDrawThrew = `hasSave=${hasSave}: ${e.message}`; }
}
check('中断データの有無どちらでもタイトルを描画できる', !titleDrawThrew, titleDrawThrew);


// ---- 起動演出:砦の壁を撃ち抜いてタイトルへ(v110) ----
// 見た目そのものはヘッドレスChromiumで実際に描いて確認している。ここで守るのは
// 「一度決めた性質が黙って崩れないこと」だけ。
const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
// 起動時の1回だけ。'press' からしか 'breaking' へ入らないので、対戦を終えて
// タイトルへ戻る時は従来どおり直接表示になる。毎回壊れたら必ず飽きる。
check('壁が出るのは起動時の1回だけ',
  (html.match(/gamePhase = 'breaking'/g) || []).length === 1
  && /if \(e\.type === 'pointerup' && gamePhase === 'press'\)[\s\S]{0,400}beginWallBreak\(aim\);/.test(html));
// タップした場所へ撃ち込む。中央固定にすると「自分が壊した」感触が無くなる。
check('砲弾はタップした場所へ飛ぶ',
  html.includes('const aim = canvasPointFromEvent(e);')
  && /function beginWallBreak\(point\)[\s\S]{0,400}x: Math\.max\(VW \* 0\.15, Math\.min\(VW \* 0\.85, point\.x\)\)/.test(html));
// 奥に描くのは本物のタイトル。TAP TO START の時点でロゴも背景も読み込み済み。
check('壁の向こうに本物のタイトルを描いている',
  /gamePhase === 'breaking' && wallBreak\)[\s\S]{0,400}drawTitleScreen\(\);\s*\n\s*drawFortressWall\(wallBreak\);/.test(html));
// 石に隙間を空けると継ぎ目から奥のタイトルが透け、壁に見えなくなる(実際に透けた)。
check('石は隙間なく敷き詰める',
  html.includes("pieces.push({ kind: 'stone', x, y: row * bh, w: bw, h: bh,"));
// 遠い石は飛びきる前に演出が終わる。消しきらないと切り替わった瞬間に瓦礫がパッと消える。
check('終わり際に破片を必ず消しきる',
  html.includes('const WALL_CLEAR_SEC')
  && /const clearing = breakState[\s\S]{0,200}WALL_BREAK_SEC - breakState\.t\) \/ WALL_CLEAR_SEC/.test(html));
// 実機で「タイトル表示してからずっとブルブル震える」。着弾で画面を揺らした後、
// 揺れを減らす処理が update の「対戦中」の分岐の内側にあったため一度も走らなかった。
// 揺れは描画側の効果であって対戦の状態ではない。どの画面でも必ず止まること。
for (const phase of ['title', 'select', 'ranking', 'freeSetup']) {
  kt.setPhase(phase);
  kt.triggerShakeForTest(9, 0.32);
  for (let i = 0; i < 40; i++) kt.step(0.02);   // 0.8秒ぶん回す
  check(`${phase} でも画面の揺れが止まる`, kt.shakeTimer() === 0, `残り=${kt.shakeTimer()}`);
}
kt.setPhase('title');

// 崩れ方は「近い石は吹き飛び、遠い石は支えを失って落ちる」の2段構え。
// 全部を放射状に飛ばすと爆発にしか見えず、壁が崩れたようにならない(実機で指摘)。
check('近い石と遠い石で崩れ方を分けている',
  html.includes('const WALL_BLAST_RANGE')
  && html.includes('const WALL_GRAVITY')
  && /const blast = Math\.pow\(1 - Math\.min\(1, distance \/ WALL_BLAST_RANGE\), 2\);/.test(html)
  && /cy \+= vy \* local \+ 0\.5 \* WALL_GRAVITY \* local \* local;/.test(html));
// 着弾点より上の石は下の支えを失う。穴が上へ広がる形になる。
check('着弾点より上の石は支えを失って落ちる',
  /const unsupported = piece\.cy < breakState\.y \? (\d+) : (\d+);/.test(html)
  && (() => {
    const [, above, below] = /const unsupported = piece\.cy < breakState\.y \? (\d+) : (\d+);/.exec(html);
    return Number(above) > Number(below);   // 上の石のほうが強く落ちる
  })());
// 手前へ来るのは爆風に巻かれた石だけ。遠い石まで拡大すると全部が飛んできて爆発に見える。
check('手前へ来るのは爆風に巻かれた石だけ',
  html.includes('scale = 1 + blast * 2.8 * local;'));
// 真っ直ぐ縮むだけだと「飛んでいる」ように見えない。
check('砲弾は山なりに飛ぶ',
  html.includes('const WALL_ARC')
  && html.includes('Math.sin(travel * Math.PI) * WALL_ARC'));
// 角の欠けは切り抜かずに描く。実際に削ると継ぎ目に穴が開き奥のタイトルが透ける。
check('石の欠けで継ぎ目に穴を開けていない',
  /角の欠け。\*\*切り抜かずに描く。\*\*/.test(html)
  && html.includes("pieces.push({ kind: 'stone', x, y: row * bh, w: bw, h: bh,"));

// 壁は生成画像。破片ごとに画像から切り出して貼るので、崩れ方はそのまま効く。
check('壁の絵を破片ごとに切り出して貼っている',
  html.includes("wallImage.src = 'assets/wall.jpg';")
  && html.includes('ctx.drawImage(wallImage, piece.sx, piece.sy, piece.sw, piece.sh, piece.bx, piece.by, w, h);'));
// 格子のまま切ると「賽の目にスライスされた」ようにしか見えない(実機で指摘)。
// 頂点を先に散らしてから四隅で破片を作る。隣は同じ頂点を共有するので隙間が出ない。
check('破片の形が不揃いになっている',
  html.includes('const jx = edge ? 0 : (wallNoise(row * 97 + col, 41) - 0.5) * bw * 0.72;')
  && html.includes('ctx.clip();')
  && /画面の縁の頂点は動かさない/.test(html));
// 近いほど細かく砕ける。全部同じ大きさだと、どこに当たったのか分からない。
check('着弾のそばだけさらに細かく割る',
  html.includes('WALL_BLAST_RANGE * 0.62')
  && html.includes('const top = mid(tl, tr), right = mid(tr, br), bottom = mid(br, bl), left = mid(bl, tl);'));
// 着弾点が決まってからでないと「近いほど細かく」が作れない。
check('着弾点が決まってから破片を組む',
  /wallPieces = buildWallPieces\(wallBreak\);/.test(html));
// 壁の絵は読み込み画面の背景そのもの。コア画像の待ち合わせに入れると
// 「壁の絵を読み終わるまで読み込み画面が出せない」という順序の矛盾になる。
const coreReadySrc = /function areCoreImagesReady\(\)[\s\S]*?\n  \}/.exec(html);
check('壁の絵は読み込み画面の待ち合わせに入れない',
  !!coreReadySrc && !/wall/i.test(coreReadySrc[0]));
check('絵が届くまでは手続き的な壁を出す',
  html.includes('wallPiecesUseArt = wallArtReady();')
  && /if \(!wallPieces \|\| \(!breakState && wallPiecesUseArt !== wallArtReady\(\)\)\) wallPieces = buildWallPieces\(\);/.test(html));
// 崩している最中に絵が届いて組み直すと、破片が一斉に元の位置へ戻ってしまう。
check('崩れている最中は組み直さない',
  html.includes('!breakState && wallPiecesUseArt !== wallArtReady()'));
// 読み込み中はずっと出ている。128枚を毎フレーム貼る意味がない。
check('崩していない間は1枚で描く',
  /if \(!breakState && wallPiecesUseArt\) \{[\s\S]{0,300}ctx\.drawImage\(wallImage, map\.offX, map\.offY,/.test(html));
check('壁の絵を先読みし、オフラインでも出せるようにしている',
  html.includes('<link rel="preload" as="image" href="assets/wall.jpg" fetchpriority="high">')
  && require('fs').readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8').includes("'./assets/wall.jpg'"));

// 撃ち込む砲弾の絵(v128でユーザー提供素材へ差し替え)。
// 参照だけ書いてファイルを入れ忘れると、実機では何も出ないまま静かに壊れる。
const introBallPath = require('path').join(__dirname, '..', 'assets', 'intro-cannonball.png');
check('砲弾の素材ファイルが実在する', require('fs').existsSync(introBallPath));
check('砲弾の絵を先読みし、オフラインでも出せるようにしている',
  html.includes('<link rel="preload" as="image" href="assets/intro-cannonball.png" fetchpriority="high">')
  && require('fs').readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8').includes("'./assets/intro-cannonball.png'"));
check('砲弾は絵で描く',
  /if \(introBallArtReady\(\)\) \{[\s\S]{0,260}ctx\.drawImage\(introBallImage, x - radius, y - radius, radius \* 2, radius \* 2\);/.test(html));
// 起動直後の1回きりの演出。絵の読み込みを待って起動を止めない。
check('砲弾の絵が間に合わない時は手描きの鉄球で出す',
  /\} else \{[\s\S]{0,400}const iron = ctx\.createRadialGradient/.test(html)
  && !html.includes('areCoreImagesReady() && introBallArtReady()'));

check('演出中は入力を受け付けない',
  html.includes("if (gamePhase === 'loading' || gamePhase === 'breaking') return;"));
// 読み込み中も毎フレーム回る。破片ごとのグラデーションは作り直さず持たせる。
check('壁のグラデーションを毎フレーム作り直さない',
  (html.match(/piece\.grad = ctx\.createLinearGradient/g) || []).length === 3
  && !/const stone = ctx\.createLinearGradient/.test(html));

console.log('\n=== result screen ===');
console.log(log.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
