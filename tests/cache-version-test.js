const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const EXPECTED_BUILD_ID = 'v2.0.159-loadout-lab-ui';

function assertCacheVersionContract(html, worker) {
  const buildId = /const BUILD_ID = '([^']+)'/.exec(html)?.[1];
  const cacheVersion = /const CACHE_VERSION = 'katamon-pwa-([^']+)'/.exec(worker)?.[1];
  assert.ok(buildId && cacheVersion, 'BUILD_ID と CACHE_VERSION が必要です。');
  assert.equal(buildId, cacheVersion, `BUILD_ID (${buildId}) と CACHE_VERSION (${cacheVersion}) を一致させてください。`);
  assert.equal(buildId, EXPECTED_BUILD_ID,
    '優先UX修正を既存端末へ配るrelease版へ更新してください。');
  assert.doesNotMatch(worker, /ignoreSearch\s*:\s*true/, 'Service Workerでクエリを無視してはいけません。');
  assert.doesNotMatch(html, /\?v=\d+/, 'index.htmlのアセットを ?v= で版管理してはいけません。BUILD_ID/CACHE_VERSIONを上げてください。');
  assert.doesNotMatch(worker, /\?v=\d+/, 'APP_SHELLのアセットを ?v= で版管理してはいけません。');
  assert.match(worker, /cache\.addAll\(APP_SHELL\.map\(asset => new Request\(asset, \{ cache: 'reload' \}\)\)\)/,
    '新しいCACHE_VERSIONではAPP_SHELLをネットワークから再取得してください。');
  assert.match(worker, /['"]\.\/shared\/firebase-online-battle-recovery\.js['"]/,
    'ONLINE Battle recovery moduleをAPP_SHELLへ含めてください。');
  assert.match(worker, /key\.startsWith\('katamon-pwa-'\) && key !== CACHE_VERSION[\s\S]*caches\.delete\(key\)/,
    'activate時に現在版以外の旧PWA cacheを削除してください。');
  assert.match(worker, /const ASSET_CACHE = 'katamon-assets-v1';/,
    '大型素材用の永続キャッシュを定義してください。');
  assert.match(worker, /url\.pathname\.includes\('\/assets\/'\)/,
    'assets配下は永続キャッシュから配信してください。');
  assert.match(worker, /ASSET_REFRESH\.map\(async \(\{ path, revision \}\)/,
    '差し替えた素材だけを改訂番号つきで更新できるようにしてください。');
  const appShell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
  const coreAssets = /const CORE_ASSETS = \[([\s\S]*?)\];/.exec(worker)?.[1] || '';
  assert.doesNotMatch(appShell, /['"]\.\/assets\//,
    '大型素材を版ごとのAPP_SHELLへ入れてはいけません。');
  assert.match(coreAssets, /['"]\.\/assets\//,
    '初回のオフライン起動用素材はCORE_ASSETSへ定義してください。');
  assert.match(worker, /if \(await cache\.match\(asset\)\) return;/,
    '保存済みCORE_ASSETSは再ダウンロードしないでください。');
  assert.match(worker, /const legacyCached = await caches\.match\(asset\);[\s\S]*cache\.put\(asset, legacyCached\.clone\(\)\)/,
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
