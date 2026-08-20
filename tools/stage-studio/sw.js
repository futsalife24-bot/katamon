'use strict';

const CACHE_PREFIX = 'stage-studio-';
const CACHE_NAME = `${CACHE_PREFIX}1.8.1-character-assets`;
const OFFLINE_MARKER = new URL('./.offline-marker', self.location.href).href;
const APP_SHELL = [
  './',
  './index.html',
  './styles-1.4.0-mvp.css',
  './app-1.7.0.js',
  './generator-worker.js',
  './manifest.webmanifest',
  './icon.svg',
  '../../assets/loading-emblem.webp',
  '../../assets/loading-emblem.png',
  '../../assets/fonts/katamon-fonts.css',
  '../../assets/fonts/rocknroll-one-regular.ttf',
  '../../assets/fonts/reggae-one-display.woff2',
  '../../assets/stage-grass-bg.jpg',
  '../../assets/stage-desert-bg.jpg',
  '../../assets/stage-snow-bg.jpg',
  '../../assets/stage-volcanic-bg.jpg',
  '../../assets/characters/runtime/dirano.webp',
  '../../assets/characters/master/dirano.png',
  '../../assets/characters/runtime/eyebolt.webp',
  '../../assets/characters/master/eyebolt.png',
  '../../assets/characters/runtime/fenice.webp',
  '../../assets/characters/master/fenice.png',
  '../../assets/characters/runtime/gorocca.webp',
  '../../assets/characters/master/gorocca.png',
  '../../assets/apple-touch-icon.png',
  '../../assets/icon-192.png',
  '../../assets/icon-512.png',
  '../../assets/icon-maskable-512.png',
  '../../shared/stage-core.js',
  '../../shared/stage-storage.js',
  '../../shared/stage-zip.js'
].map((path) => new URL(path, self.location.href).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => fetch(request, { cache: 'no-cache' }).then((response) => {
        if (!response || !response.ok) throw new Error('navigation failed');
        return Promise.all([
          cache.delete(OFFLINE_MARKER),
          cache.put(request, response.clone())
        ]).then(() => response);
      }).catch(() => cache.put(OFFLINE_MARKER, new Response('offline')).then(() => (
        cache.match(new URL('./index.html', self.location.href).href)
      ))))
    );
    return;
  }

  const isVersionedAppAsset = request.destination === 'script'
    || request.destination === 'style'
    || url.pathname.endsWith('.webmanifest');
  if (isVersionedAppAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => fetch(request, { cache: 'no-cache' }).then((response) => {
        if (!response || !response.ok) throw new Error('asset update failed');
        return cache.put(request, response.clone()).then(() => response);
      }).catch(() => cache.match(request, { ignoreSearch: true })).then((response) => (
        response || new Response('オフラインのため、このファイルを読み込めません。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      )))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match(new URL('./index.html', self.location.href).href);
        return new Response('オフラインのため、このファイルを読み込めません。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
