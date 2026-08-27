const CACHE_VERSION = 'katamon-pwa-v2.0.143-title-logo-intro';
const BUILD_ID = CACHE_VERSION.slice('katamon-pwa-'.length);
const ASSET_CACHE = 'katamon-assets-v1';
// 素材を差し替えたら改訂番号を更新する。各端末はその改訂を一度だけ取得する。
const ASSET_REFRESH = [
  { path: './assets/characters/master/dread-arrow.png', revision: 'v2.0.130' },
  { path: './assets/characters/runtime/dread-arrow.webp', revision: 'v2.0.130' },
  { path: './assets/characters/master/hamulton.png', revision: 'v2.0.130' },
  { path: './assets/characters/runtime/hamulton.webp', revision: 'v2.0.130' },
  { path: './assets/characters/master/sumoeru.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/runtime/sumoeru.webp', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/rubidevi.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/runtime/rubidevi.webp', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/paladier.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/runtime/paladier.webp', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/nyan-tank.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/runtime/nyan-tank.webp', revision: 'v2.0.139-right-facing' },
];
const APP_SHELL = [
  './index.html',
  './generated/content-studio-catalog.js',
  './generated/content-studio-manifest.json',
  './manifest.webmanifest',
  './coop-mvp-foundation.js',
  './coop-mvp-boss.js',
  './coop-mvp-boss-ai.js',
  './coop-mvp-engine.js',
  './coop-mvp-survival.js',
  './coop-mvp-items.js',
  './subweapon-mvp.js',
  './coop-mvp-rewards.js',
  './coop-mvp-shop.js',
  './coop-mvp-session.js',
  './coop-mvp-battle.js',
  './coop-mvp-room.js',
  './game-custom-stages.css',
  './game-custom-stages.js',
  './shared/stage-core.js',
  './shared/stage-storage.js',
  './shared/stage-repository.js',
  './shared/stage-zip.js',
  './shared/gear-domain.js',
  './shared/gear-storage.js',
  './shared/gear-rewards.js',
  './shared/gear-transactions.js',
  './shared/gear-cpu-rewards.js',
  './shared/gear-cpu-run-storage.js',
  './shared/gear-coop-rewards.js',
  './shared/gear-coop-settlement-storage.js',
  './shared/gear-coop-recovery.js',
  './shared/gear-presets.js',
  './shared/gear-preset-storage.js',
  './shared/gear-combat.js',
  './shared/gear-battle-rng.js',
  './shared/gear-battle-snapshot.js',
  './shared/gear-online-protocol.js',
  './shared/gear-online-lobby-protocol.js',
  './shared/gear-online-firebase-wire.js',
  './shared/gear-online-battle-start.js',
  './shared/gear-online-battle-damage.js'
];
// 初回はオフライン起動に必要な素材を保存し、以後は同じURLの端末内コピーを再利用する。
const CORE_ASSETS = [
  './assets/bosses/runtime/fortress-tank.webp',
  './assets/bosses/runtime/fortress-tank-phase2.webp',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/loading-emblem.webp',
  './assets/fonts/katamon-fonts.css',
  './assets/fonts/rocknroll-one-regular.ttf',
  './assets/fonts/reggae-one-display.woff2',
  './assets/title-background-logo-start.jpg',
  './assets/title-background-logo-transition.mp4',
  './assets/title-background-logo-end.jpg',
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
  './assets/special-cutin-finisher.mp3',
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
      .then(async cache => {
        await Promise.all(ASSET_REFRESH.map(async ({ path, revision }) => {
          const marker = `./__katamon_asset_revision__/${encodeURIComponent(path)}`;
          const cachedRevision = await cache.match(marker);
          if (cachedRevision && await cachedRevision.text() === revision) return;
          const response = await fetch(new Request(path, { cache: 'reload' }));
          if (!response.ok) throw new Error(`asset refresh failed: ${path}`);
          await cache.put(path, response.clone());
          await cache.put(marker, new Response(revision));
        }));
        await Promise.all(CORE_ASSETS.map(async asset => {
          if (await cache.match(asset)) return;
          const legacyCached = await caches.match(asset);
          if (legacyCached) {
            await cache.put(asset, legacyCached.clone());
            return;
          }
          await cache.add(new Request(asset, { cache: 'reload' }));
        }));
      })
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
