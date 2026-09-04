const CACHE_VERSION = 'katamon-pwa-v2.0.168-title-wall-first-paint';
const BUILD_ID = CACHE_VERSION.slice('katamon-pwa-'.length);
const ASSET_CACHE = 'katamon-assets-v1';
// 素材を差し替えたら改訂番号を更新する。各端末はその改訂を一度だけ取得する。
const ASSET_REFRESH = [
  { path: './assets/characters/master/dread-arrow.png', revision: 'v2.0.130' },
  { path: './assets/characters/master/hamulton.png', revision: 'v2.0.130' },
  { path: './assets/characters/master/sumoeru.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/rubidevi.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/paladier.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/characters/master/nyan-tank.png', revision: 'v2.0.139-right-facing' },
  { path: './assets/gear/ui/runtime/gear_workbench_lab_background_01.webp', revision: 'v2.0.160-loadout-lab-mobile-background' },
  { path: './assets/gear/ui/runtime/gear_lab_control_frame_01.png', revision: 'v2.0.161-loadout-lab-ui-chrome' },
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
  './shared/firebase-online-reentry.js',
  './shared/firebase-online-battle-recovery.js',
  './shared/gear-online-battle-start.js',
  './shared/gear-online-battle-damage.js',
  './shared/gear-online-battle-rng.js',
  './shared/gear-online-battle-runtime-state.js',
  './assets/fonts/katamon-fonts.css'
];
// T1: title is interactive soon after the first tap. This queue deliberately
// excludes battle HUD and bonus media so it cannot compete with first paint.
const TIER1_ASSETS = [
  './assets/title-background-logo-end.jpg',
  './assets/title-bgm.mp3'
];

// T2: title idle time. Keep this exact order: first-battle HUD and media
// precede cosmetic/background material, while the 6.70 MB theme remains last.
const TIER2_ASSETS = [
  './assets/title-background-logo-transition.mp4',
  './assets/battle-start-logo.mp4',
  './assets/ui/battle-hud/v3/player-card-enemy.png',
  './assets/ui/battle-hud/v3/turn-ribbon.png',
  './assets/ui/battle-hud/v3/player-card-ally.png',
  './assets/ui/battle-hud/minimap-frame.png',
  './assets/ui/battle-hud/wind-console-round.webp',
  './assets/bosses/runtime/fortress-tank.webp',
  './assets/bosses/runtime/fortress-tank-phase2.webp',
  './assets/gear/ui/runtime/gear_workbench_lab_background_01.webp',
  './assets/gear/ui/runtime/gear_lab_control_frame_01.png',
  './assets/fonts/rocknroll-one-regular.ttf',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/intro-cannonball.png',
  './assets/battle-start-logo.png'
];

// T3a: enough audio and media for the game to remain playable offline.
const TIER3A_ASSETS = [
  './assets/room-bgm.mp3',
  './assets/stage-grass.mp3',
  './assets/stage-desert.mp3',
  './assets/stage-snow.mp3',
  './assets/stage-volcanic.mp3',
  './assets/stage-boss-arena.mp3',
  './assets/normal-impact-explosion.mp3',
  './assets/special-cutin-finisher.mp3',
  './assets/special-cutin-edm-zap.mp3',
  './assets/cool-kai-special-voice.mp3'
];

// T3b: optional listening and visual fallbacks. Skip this on data-saving or
// very slow connections; a later non-frugal visit can still complete it.
const TIER3B_ASSETS = [
  './assets/bonus-bgm-1.mp3',
  './assets/bonus-bgm-2.mp3',
  './assets/bonus-bgm-3.mp3',
  './assets/bonus-bgm-4.mp3',
  './assets/SIX ÉTERNEL ―愛はひとつじゃない―.mp3',
  './assets/six-eternel-dopagaki-remix.mp3',
  './assets/device-exit-seal.png',
  './assets/exit-confirm-stay-v2.png',
  './assets/exit-confirm-exit-v2.png',
  './assets/characters/master/dread-arrow.png',
  './assets/characters/master/hamulton.png',
  './assets/characters/master/sumoeru.png',
  './assets/characters/master/rubidevi.png',
  './assets/characters/master/paladier.png',
  './assets/characters/master/nyan-tank.png'
];

let precacheQueue = Promise.resolve();
let assetCacheExistedAtInstall = false;
const completedPrecacheTiers = new Set();
const pendingPrecacheTiers = new Map();
const pendingAssetFetches = new Map();

async function refreshRevisionedAssets(cache) {
  await Promise.all(ASSET_REFRESH.map(async ({ path, revision }) => {
    const marker = `./__katamon_asset_revision__/${encodeURIComponent(path)}`;
    const cachedRevision = await cache.match(marker);
    if (cachedRevision && await cachedRevision.text() === revision) return;
    const response = await fetch(new Request(path, { cache: 'reload' }));
    if (!response.ok) throw new Error(`asset refresh failed: ${path}`);
    await cache.put(path, response.clone());
    await cache.put(marker, new Response(revision));
  }));
}

function precacheRequest(asset) {
  return new Request(new URL(asset, self.location).href);
}

async function fetchAndCachePrecacheAsset(cache, request) {
  const key = request.url;
  let pending = pendingAssetFetches.get(key);
  if (!pending) {
    pending = fetch(new Request(request, { cache: 'default' }))
      .then(async response => {
        if (!response.ok) throw new Error(`precache failed: ${request.url}`);
        await cache.put(request, response.clone());
        return response;
      })
      .finally(() => pendingAssetFetches.delete(key));
    pendingAssetFetches.set(key, pending);
  }
  return (await pending).clone();
}

// One asset at a time keeps title rendering and the user’s own requests ahead
// of offline preparation. A failed optional asset must not stop the next one.
async function precacheTier(cache, assets) {
  for (const asset of assets) {
    const request = precacheRequest(asset);
    if (await cache.match(request)) continue;
    const legacyCached = await caches.match(request);
    if (legacyCached) {
      await cache.put(request, legacyCached.clone());
      continue;
    }
    try {
      await fetchAndCachePrecacheAsset(cache, request);
    } catch (_) { /* retry via normal fetch later */ }
  }
}

// Cache.addAll internally bypasses the browser HTTP cache in WebKit. Keep the
// first-page responses reusable while copying the app shell into CacheStorage.
async function precacheAppShell(cache) {
  for (const asset of APP_SHELL) {
    const request = precacheRequest(asset);
    if (await cache.match(request)) continue;
    try {
      await fetchAndCachePrecacheAsset(cache, request);
    } catch (_) { /* retry through normal navigation/fetch later */ }
  }
}

function enqueuePrecacheTier(tier) {
  const assets = tier === 2
    ? TIER2_ASSETS
    : tier === '3a'
      ? TIER3A_ASSETS
      : tier === '3b'
        ? TIER3B_ASSETS
        : null;
  if (!assets) return Promise.resolve(false);
  if (completedPrecacheTiers.has(tier)) return Promise.resolve(false);
  if (pendingPrecacheTiers.has(tier)) return pendingPrecacheTiers.get(tier);
  const pending = precacheQueue
    .catch(() => {})
    .then(() => caches.open(ASSET_CACHE))
    .then(async cache => {
      if (tier === 2 && assetCacheExistedAtInstall) await refreshRevisionedAssets(cache);
      await precacheTier(cache, assets);
      completedPrecacheTiers.add(tier);
    })
    .then(() => true)
    .finally(() => pendingPrecacheTiers.delete(tier));
  pendingPrecacheTiers.set(tier, pending);
  precacheQueue = pending;
  return pending;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(clients.map(client => client.postMessage(message)));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => { assetCacheExistedAtInstall = keys.includes(ASSET_CACHE); })
      .then(() => caches.open(CACHE_VERSION))
      .then(cache => precacheAppShell(cache))
      .then(() => caches.open(ASSET_CACHE))
      .then(async cache => {
        await precacheTier(cache, TIER1_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  if (event.data?.type !== 'KATAMON_PRECACHE_TIER') return;
  const tier = event.data.tier === 2 || event.data.tier === '2'
    ? 2
    : event.data.tier;
  event.waitUntil(
    enqueuePrecacheTier(tier).then(completed => completed
      ? notifyClients({ type: 'KATAMON_PRECACHE_TIER_DONE', tier })
      : undefined)
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
      .then(() => notifyClients({
        type: 'KATAMON_UPDATE_READY',
        build: BUILD_ID
      }))
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
        // The page uses this mode only to copy an already resident first-paint
        // response into CacheStorage. Never turn that probe into a download.
    if (request.cache === 'only-if-cached') {
      // The page uses this as a no-network probe while its first-paint
      // resources are still only in the browser HTTP cache.  A 504 is
      // correct HTTP semantics, but browsers report it as a console error;
      // use an explicit successful sentinel instead and let the page skip
      // Cache Storage persistence for this miss.
      return new Response('', {
        status: 200,
        headers: { 'X-Katamon-Cache-Miss': '1' }
      });
    }
        // Page rendering and a staged precache may request the same asset in
        // the same event turn. Share a single network response between them.
        return fetchAndCachePrecacheAsset(cache, new Request(request.url));
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
