const CACHE_VERSION = 'katamon-pwa-v138-stage-studio-mvp';
const APP_SHELL = [
  './',
  './index.html',
  './generated/content-studio-catalog.js',
  './generated/content-studio-manifest.json',
  './manifest.webmanifest',
  './game-custom-stages.css',
  './game-custom-stages.js',
  './shared/stage-core.js',
  './shared/stage-storage.js',
  './shared/stage-repository.js',
  './shared/stage-zip.js',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/loading-emblem.webp',
  './assets/title-logo.webp',
  './assets/wall.jpg',
  './assets/intro-cannonball.png',
  './assets/normal-impact-explosion.mp3?v=1'
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

  // 各Studioは子スコープ側のService Workerで管理する。
  if (
    url.pathname.includes('/tools/content-studio/')
    || url.pathname.includes('/tools/stage-studio/')
  ) return;

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
    caches.match(request, { ignoreSearch: true }).then(cached => {
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
