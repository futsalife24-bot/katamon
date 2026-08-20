const CACHE_VERSION = 'katamon-pwa-v2.0.94-dread-arrow-facing';
const BUILD_ID = CACHE_VERSION.slice('katamon-pwa-'.length);
const ASSET_CACHE = 'katamon-assets-v1';
// 素材を差し替える版だけ、ここへ対象パスを追加する。ほかの素材は再取得しない。
const ASSET_REFRESH = [
  './assets/characters/master/dread-arrow.png',
  './assets/characters/runtime/dread-arrow.webp',
  './assets/characters/master/hamulton.png',
  './assets/characters/runtime/hamulton.webp',
];
const APP_SHELL = [
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
  './assets/fonts/katamon-fonts.css',
  './assets/fonts/rocknroll-one-regular.ttf',
  './assets/fonts/reggae-one-display.woff2',
  './assets/title-logo.webp',
  './assets/title-mode-board.webp',
  './assets/title-shield-button.webp',
  './assets/title-hanging-sign.webp',
  './assets/title-parchment-button.webp',
  './assets/wall.jpg',
  './assets/intro-cannonball.png',
  './assets/battle-start-logo.png',
  './assets/battle-start-logo.mp4',
  './assets/ui/battle-hud/player-card-ally.png',
  './assets/ui/battle-hud/player-card-enemy.png',
  './assets/ui/battle-hud/wind-console.png',
  './assets/ui/battle-hud/minimap-frame.png',
  './assets/ui/battle-hud/v3/player-card-ally.png',
  './assets/ui/battle-hud/v3/player-card-enemy.png',
  './assets/ui/battle-hud/v3/wind-console.png',
  './assets/ui/battle-hud/v3/turn-ribbon.png',
  './assets/ui/battle-hud/v4-wind-console.png',
  './assets/ui/battle-hud/wind-console-round.webp',
  './assets/normal-impact-explosion.mp3',
  './assets/special-cutin-edm-zap.mp3',
  './assets/cool-kai-special-voice.mp3',
  './assets/SIX ÉTERNEL ―愛はひとつじゃない―.mp3',
  './assets/six-eternel-dopagaki-remix.mp3',
  './assets/device-exit-seal.png',
  './assets/exit-confirm-stay-v2.png',
  './assets/exit-confirm-exit-v2.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL.map(asset => new Request(asset, { cache: 'reload' }))))
      .then(() => caches.open(ASSET_CACHE))
      .then(cache => Promise.all(ASSET_REFRESH.map(asset => cache.delete(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
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
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => Promise.all(clients.map(client => client.postMessage({
        type: 'KATAMON_UPDATE_READY',
        build: BUILD_ID
      }))))
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
      fetch(request, { cache: 'no-store' })
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

  // 大きい画像・音声・動画は更新ごとに捨てず、同じURLなら前回の取得結果を再利用する。
  // 素材を差し替える時だけURLを変えるため、普段の更新で全素材を再取得しない。
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(cache => cache.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        });
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(new Request(request, { cache: 'reload' })).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
