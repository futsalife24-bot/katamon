const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./seatharness.js');

const kt = h.kt();
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`  ok ${name}`);
  });
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const overlaps = (left, right) => (
  left.x - left.w / 2 < right.x + right.w / 2
  && left.x + left.w / 2 > right.x - right.w / 2
  && left.y - left.h / 2 < right.y + right.h / 2
  && left.y + left.h / 2 > right.y - right.h / 2
);

(async () => {
  await test('報酬合計を連勝報酬と資源箱の連戦累計へ分け、旧previewは資源箱0として扱う', () => {
    assert.deepEqual(kt.cpuGearRewardBreakdownForTest({
      powder: 23,
      blueprintShards: 11,
      stageItemPowder: 3,
      stageItemBlueprintShards: 1,
    }), {
      totalPowder: 23,
      totalBlueprintShards: 11,
      streakPowder: 20,
      streakBlueprintShards: 10,
      stageItemPowder: 3,
      stageItemBlueprintShards: 1,
    });
    assert.deepEqual(kt.cpuGearRewardBreakdownForTest({ powder: 20, blueprintShards: 10 }), {
      totalPowder: 20,
      totalBlueprintShards: 10,
      streakPowder: 20,
      streakBlueprintShards: 10,
      stageItemPowder: 0,
      stageItemBlueprintShards: 0,
    });
    assert.deepEqual(kt.cpuGearRewardBreakdownForTest({
      powder: 3,
      blueprintShards: 0,
      stageItemPowder: 99,
      stageItemBlueprintShards: -1,
    }), {
      totalPowder: 3,
      totalBlueprintShards: 0,
      streakPowder: 0,
      streakBlueprintShards: 0,
      stageItemPowder: 3,
      stageItemBlueprintShards: 0,
    });
  });

  await test('共有文は固定公開URLと集計値だけで作り、X Intentを二重encodeしない', () => {
    const payload = kt.buildCpuResultSharePayloadForTest({
      preview: {
        peakStreak: 8,
        gearCount: 1,
        powder: 33,
        blueprintShards: 16,
        stageItemPowder: 3,
        stageItemBlueprintShards: 1,
      },
      won: true,
      rare: true,
      playerName: '秘密の名前',
      roomId: 'SECRET-ROOM',
      runId: 'SECRET-RUN',
      seed: 'SECRET-SEED',
    });
    assert.equal(payload.url, 'https://futsalife24-bot.github.io/katamon/');
    assert.match(payload.text, /8連勝達成！/);
    assert.match(payload.text, /希少個体を撃破！/);
    assert.match(payload.text, /精算見込み: Gear 1個 \/ 粉末 33 \/ 設計片 16/);
    assert.match(payload.text, /資源箱の連戦累計: 粉末 \+3 \/ 設計片 \+1/);
    assert.ok(payload.text.length <= 280, `share text length=${payload.text.length}`);
    for (const forbidden of ['秘密の名前', 'SECRET-ROOM', 'SECRET-RUN', 'SECRET-SEED', 'deviceId', 'rewardId', 'gearId', '通信ログ']) {
      assert.equal(payload.text.includes(forbidden), false, forbidden);
    }
    const intent = new URL(payload.xUrl);
    assert.equal(intent.origin + intent.pathname, 'https://x.com/intent/tweet');
    assert.equal(intent.searchParams.get('url'), payload.url);
    assert.equal(intent.searchParams.get('hashtags'), 'カタモン');
    assert.equal(intent.searchParams.get('text').includes('%E3%82'), false, 'text must be decoded once');
    assert.match(intent.searchParams.get('text'), /8連勝達成！/);
  });

  localStorage.clear();
  kt.startBattle();
  kt.setStreak(8);
  kt.forceWinner('player');
  const layout = kt.cpuGearResultLayoutForTest();

  await test('通常CPU非ボス結果だけに共有ボタンを置き、既存ボタンと重ねない', () => {
    assert.ok(layout?.shareButton);
    assert.equal(overlaps(layout.titleButton, layout.shareButton), false);
    assert.equal(overlaps(layout.settlementButton, layout.shareButton), false);
    assert.equal(overlaps(layout.continueButton, layout.shareButton), false);
    for (const button of [layout.continueButton, layout.settlementButton, layout.titleButton, layout.shareButton]) {
      assert.ok(button.x - button.w / 2 >= 0 && button.x + button.w / 2 <= kt.viewW(), JSON.stringify(button));
      assert.ok(button.y + button.shift + button.h / 2 <= kt.viewH(), JSON.stringify(button));
    }
  });

  const durableBefore = JSON.stringify({
    run: kt.cpuGearRunStateForTest(),
    state: kt.state(),
    streak: kt.streak(),
  });

  await test('Web Share成功・キャンセル・失敗は報酬状態を変えず、失敗時にXを勝手に開かない', async () => {
    let shared = null;
    let launched = 0;
    assert.equal(kt.requestCpuResultShareForTest({ share: (data) => { shared = data; return Promise.resolve(); }, launchX: () => { launched += 1; } }), true);
    await flush();
    assert.equal(shared.url, 'https://futsalife24-bot.github.io/katamon/');
    assert.equal(kt.resultShareStateForTest().status, '共有しました');
    assert.equal(launched, 0);

    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    assert.equal(kt.requestCpuResultShareForTest({ share: () => Promise.reject(abort), launchX: () => { launched += 1; } }), true);
    await flush();
    assert.equal(kt.resultShareStateForTest().status, '共有をキャンセルしました');
    assert.equal(launched, 0);

    assert.equal(kt.requestCpuResultShareForTest({ share: () => Promise.reject(new Error('denied')), launchX: () => { launched += 1; } }), true);
    await flush();
    assert.match(kt.resultShareStateForTest().status, /共有できませんでした/);
    assert.equal(launched, 0);
    assert.equal(JSON.stringify({ run: kt.cpuGearRunStateForTest(), state: kt.state(), streak: kt.streak() }), durableBefore);
  });

  await test('Web Share非対応時だけ安全なXリンクを同期起動し、起動不能でも現在画面を保つ', async () => {
    let launchedUrl = null;
    assert.equal(kt.requestCpuResultShareForTest({ share: null, launchX: (url) => { launchedUrl = url; return true; } }), true);
    assert.ok(launchedUrl, 'X launch must run before returning');
    assert.equal(new URL(launchedUrl).origin + new URL(launchedUrl).pathname, 'https://x.com/intent/tweet');
    await flush();
    assert.equal(kt.resultShareStateForTest().status, 'Xの投稿画面を開きました');

    assert.equal(kt.requestCpuResultShareForTest({ share: null, launchX: () => false }), false);
    await flush();
    assert.match(kt.resultShareStateForTest().status, /Xを開けませんでした/);
    assert.equal(JSON.stringify({ run: kt.cpuGearRunStateForTest(), state: kt.state(), streak: kt.streak() }), durableBefore);
  });

  await test('共有Promise中の二重タップを無視する', async () => {
    let resolveShare;
    let calls = 0;
    const pending = new Promise((resolve) => { resolveShare = resolve; });
    assert.equal(kt.requestCpuResultShareForTest({ share: () => { calls += 1; return pending; } }), true);
    assert.equal(kt.requestCpuResultShareForTest({ share: () => { calls += 1; return pending; } }), false);
    assert.equal(calls, 1);
    resolveShare();
    await flush();
    assert.equal(kt.resultShareStateForTest().pending, false);
  });

  await test('素材のみ報酬は既存Drop Revealと明示claimへ接続し、空報酬は除外する', () => {
    assert.match(html, /function gearRewardHasClaimableValue\(reward\)/);
    assert.match(html, /reward\.gears\.length > 0 \|\| reward\.powder > 0 \|\| reward\.blueprintShards > 0/);
    assert.match(html, /if \(reward\.gears\.length === 0\) return gearDropRenderMaterialReward\(reward\)/);
    assert.match(html, /data-gear-material-reward=/);
    assert.match(html, /await rewards\.persistClaimReward\(gearDropUi\.reward\.rewardId, Date\.now\(\), localStorage\)/);
    assert.match(html, /粉末・設計片を受け取りました/);
    assert.match(html, /link\.rel = 'noopener noreferrer'/);
    assert.match(html, /return typeof navigator\?\.share === 'function' \? '結果を共有' : 'Xで共有'/);
  });

  console.log(`reward-summary-x-share: ${passed}/${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
