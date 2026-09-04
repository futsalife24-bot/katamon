const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const EXPECTED_BUILD_ID = 'v2.0.171-stage-battle-items';

function tierBody(worker, tier) {
  return new RegExp(`const TIER${tier}_ASSETS = \\[([\\s\\S]*?)\\];`).exec(worker)?.[1] || '';
}

function assertCacheVersionContract(html, worker) {
  const buildId = /const BUILD_ID = '([^']+)'/.exec(html)?.[1];
  const cacheVersion = /const CACHE_VERSION = 'katamon-pwa-([^']+)'/.exec(worker)?.[1];
  assert.ok(buildId && cacheVersion, 'BUILD_ID と CACHE_VERSION が必要です。');
  assert.equal(buildId, cacheVersion, `BUILD_ID (${buildId}) と CACHE_VERSION (${cacheVersion}) を一致させてください。`);
  assert.equal(buildId, EXPECTED_BUILD_ID, '段階読み込みのrelease版へ更新してください。');
  assert.doesNotMatch(worker, /ignoreSearch\s*:\s*true/, 'Service Workerでクエリを無視してはいけません。');
  assert.doesNotMatch(html, /\?v=\d+/, 'index.htmlのアセットを ?v= で版管理してはいけません。BUILD_ID/CACHE_VERSIONを上げてください。');
  assert.doesNotMatch(worker, /\?v=\d+/, 'APP_SHELLのアセットを ?v= で版管理してはいけません。');
  assert.match(worker, /\.then\(cache => precacheAppShell\(cache\)\)/, 'APP_SHELLはinstall時にHTTP cacheを再利用して保存してください。');
  assert.match(worker, /cache: 'default'/, 'install時にAPP_SHELLを強制再取得してはいけません。');
  assert.match(worker, /new Request\(path, \{ cache: 'reload' \}\)/,
    'ASSET_REFRESHだけはrevision管理のためreloadを維持してください。');
  assert.match(worker, /['"]\.\/shared\/firebase-online-battle-recovery\.js['"]/,
    'ONLINE Battle recovery moduleをAPP_SHELLへ含めてください。');
  assert.match(worker, /key\.startsWith\('katamon-pwa-'\) && key !== CACHE_VERSION[\s\S]*caches\.delete\(key\)/,
    'activate時に現在版以外の旧PWA cacheを削除してください。');
  assert.match(worker, /const ASSET_CACHE = 'katamon-assets-v1';/,
    '大型素材用の永続キャッシュを定義してください。');
  assert.match(worker, /url\.pathname\.includes\('\/assets\/'\)/,
    'assets配下は永続キャッシュから配信してください。');
  const appShell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
  assert.doesNotMatch(worker, /const CORE_ASSETS\s*=/,
    '一括取得用のCORE_ASSETSを残してはいけません。');
  for (const tier of [1, 2, '3A', '3B']) {
    assert.match(worker, new RegExp(`const TIER${tier}_ASSETS = \\[`), `T${tier}を定義してください。`);
  }
  assert.doesNotMatch(appShell, /title-background-logo-start\.jpg/, 'T0素材をinstallで二重取得してはいけません。');
  assert.match(indexHtml, /FIRST_PAINT_CACHE_ASSETS/, 'T0素材はページ取得後に永続キャッシュへコピーしてください。');
  assert.match(indexHtml, /persistFirstPaintAssets/, 'T0素材の二重取得防止処理を維持してください。');
  assert.match(indexHtml, /FIRST_PAINT_CACHE_ASSETS[\s\S]*?assets\/wall\.jpg/,
    '最初のタップ前に表示する石壁をT0の永続キャッシュ対象へ含めてください。');
  assert.doesNotMatch(appShell, /assets\/wall\.jpg/,
    'ページpreload済みの石壁をSW installでも取得して二重化してはいけません。');
  assert.doesNotMatch(tierBody(worker, 2), /assets\/wall\.jpg/, '石壁をT2まで遅延してはいけません。');
  assert.match(tierBody(worker, 1), /title-bgm\.mp3/, 'T1にはタイトルBGMを含めてください。');
  assert.match(tierBody(worker, 2), /battle-start-logo\.mp4/, 'T2は最初にバトル開始動画を取得してください。');
  assert.match(tierBody(worker, '3A'), /stage-boss-arena\.mp3/, 'T3aにはゲーム成立用のステージBGMを含めてください。');
  assert.match(tierBody(worker, '3A'), /special-cutin-edm-zap\.mp3/, 'T3aにはゲーム中の効果音を含めてください。');
  assert.match(tierBody(worker, '3B'), /bonus-bgm-4\.mp3/, 'T3bには任意のおまけBGMを含めてください。');
  assert.match(tierBody(worker, '3B'), /six-eternel-dopagaki-remix\.mp3/, 'T3bにはサウンドテスト専用BGMを含めてください。');
  assert.match(tierBody(worker, '3B'), /device-exit-seal\.png/, 'T3bには終了確認素材を含めてください。');
  assert.match(worker, /for \(const asset of assets\)/, '各Tierは順次取得してください。');
  assert.match(worker, /KATAMON_PRECACHE_TIER_DONE/, 'T2完了をページへ通知してください。');
  assert.match(indexHtml, /KATAMON_PRECACHE_TIER/, 'ページから段階プリキャッシュを要求してください。');
  assert.match(indexHtml, /requestIdleCallback/, 'Safari向けidle fallbackと併せてT3を後送りしてください。');
  assert.match(indexHtml, /navigator\.connection/, 'saveData/低速回線ではT3bを後送りしてください。');
  assert.match(indexHtml, /conn\.saveData === true/, 'saveData時はT3bを省略してください。');
  assert.match(indexHtml, /navigator\.storage\?\.persist\?\.\(\)/, '永続ストレージを要求してください。');
  assert.ok((indexHtml.match(/rel="preload"/g) || []).length <= 10,
    'preloadはT0の9本だけに絞ってください。');
  assert.doesNotMatch(indexHtml, /rel="preload"[^>]*battle-start-logo/,
    'バトル開始素材はT0 preloadに入れてはいけません。');
  const deadHud = [
    'player-card-ally.png', 'player-card-enemy.png', 'wind-console.png',
    'v3/wind-console.png', 'v4-wind-console.png'
  ];
  for (const file of deadHud) {
    assert.doesNotMatch(worker, new RegExp(`['"]\\./assets/ui/battle-hud/${file.replace('.', '\\.') }['"]`),
      `${file} は旧HUDなのでTierから除外してください。`);
  }
  for (const file of [
    'v3/player-card-ally.png', 'v3/player-card-enemy.png', 'wind-console-round.webp',
    'minimap-frame.png', 'v3/turn-ribbon.png'
  ]) {
    assert.match(tierBody(worker, 2), new RegExp(file.replaceAll('.', '\\.')),
      `${file} は使用中HUDなのでT2に残してください。`);
  }
  assert.match(worker, /const legacyCached = await caches\.match\(request\);[\s\S]*cache\.put\(request, legacyCached\.clone\(\)\)/,
    '旧版キャッシュの大型素材は通信せず永続キャッシュへ移してください。');
  assert.match(worker, /cachedRevision\.text\(\) === revision\) return;/,
    '同じ改訂の差し替え素材を更新のたびに再取得してはいけません。');
  assert.match(worker, /cache\.put\(marker, new Response\(revision\)\)/,
    '取得済みの素材改訂番号を端末へ保存してください。');
}

assertCacheVersionContract(indexHtml, serviceWorker);
assert.throws(
  () => assertCacheVersionContract(
    "const BUILD_ID = 'v9'; <script src=\"game.js?v=2\"></script>",
    "const CACHE_VERSION = 'katamon-pwa-v8'; caches.match(request, { ignoreSearch: true });",
  ),
  /BUILD_ID/,
  '旧式の版不一致を検出できること',
);

console.log('キャッシュ版管理契約: priority UX rollout・BUILD_ID/CACHE_VERSION一致・素材の差分更新（2/2 passed）');
