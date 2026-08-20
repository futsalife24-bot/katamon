const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function assertCacheVersionContract(html, worker) {
  const buildId = /const BUILD_ID = '([^']+)'/.exec(html)?.[1];
  const cacheVersion = /const CACHE_VERSION = 'katamon-pwa-([^']+)'/.exec(worker)?.[1];
  assert.ok(buildId && cacheVersion, 'BUILD_ID と CACHE_VERSION が必要です。');
  assert.equal(buildId, cacheVersion, `BUILD_ID (${buildId}) と CACHE_VERSION (${cacheVersion}) を一致させてください。`);
  assert.doesNotMatch(worker, /ignoreSearch\s*:\s*true/, 'Service Workerでクエリを無視してはいけません。');
  assert.doesNotMatch(html, /\?v=\d+/, 'index.htmlのアセットを ?v= で版管理してはいけません。BUILD_ID/CACHE_VERSIONを上げてください。');
  assert.doesNotMatch(worker, /\?v=\d+/, 'APP_SHELLのアセットを ?v= で版管理してはいけません。');
  assert.match(worker, /cache\.addAll\(APP_SHELL\.map\(asset => new Request\(asset, \{ cache: 'reload' \}\)\)\)/,
    '新しいCACHE_VERSIONではAPP_SHELLをネットワークから再取得してください。');
  assert.match(worker, /const ASSET_CACHE = 'katamon-assets-v1';/,
    '大型素材用の永続キャッシュを定義してください。');
  assert.match(worker, /url\.pathname\.includes\('\/assets\/'\)/,
    'assets配下は永続キャッシュから配信してください。');
  assert.match(worker, /ASSET_REFRESH\.map\(asset => cache\.delete\(asset\)\)/,
    '差し替えた素材だけを永続キャッシュから更新できるようにしてください。');
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

console.log('キャッシュ版管理契約: BUILD_ID/CACHE_VERSION一致・素材の永続キャッシュ（2/2 passed）');
