const CACHE_VERSION = 'katamon-pwa-v138';
const APP_SHELL = [
  './',
  './index.html',
  './generated/content-studio-catalog.js',
  './generated/content-studio-manifest.json',
  './manifest.webmanifest',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/loading-emblem.webp',
  './assets/title-logo.webp',
  './assets/wall.jpg',
  './assets/intro-cannonball.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('katamon-pwa-') && key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Content Studioは独立した子スコープのService Workerを持つ。親ゲームのオフライン
  // フォールバックを返すと初回起動がゲーム画面になるため、この配下は常に子へ任せる。
  if (url.pathname.includes('/tools/content-studio/')) return;

  // 音声・動画のRangeリクエストはブラウザに任せ、シークやループを壊さない。
  if (request.headers.has('range')) return;

  // Content StudioのPRは生成カタログだけを更新し、ゲーム本体の版番号は変更しない。
  // ここを通常のcache-firstにすると、既存端末が古いキャラクター一覧を保持し続ける。
  // オンライン時は必ず再検証し、失敗時だけ最後の安全なコピーへ戻す。
  const generatedContent = url.pathname.endsWith('/generated/content-studio-catalog.js')
    || url.pathname.endsWith('/generated/content-studio-manifest.json');
  if (generatedContent) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)
          .then(cached => cached || caches.match(url.pathname.endsWith('.js')
            ? './generated/content-studio-catalog.js'
            : './generated/content-studio-manifest.json')))
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)
          .then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
