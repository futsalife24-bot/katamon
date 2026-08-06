const VERSION = '0.2.0';
const CACHE_NAME = `content-studio-pwa-${VERSION}`;
const CACHE_PREFIX = 'content-studio-pwa-';
const MAX_RUNTIME_ENTRIES = 80;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/icon.svg',
  './icons/maskable.svg',
];
const SHARE_DB = 'content-studio-share-v1';
const SHARE_STORE = 'shares';
const MAX_SHARED_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) db.createObjectStore(SHARE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('共有画像を保存できませんでした。'));
  });
}

async function saveSharedFile(file) {
  const id = crypto.randomUUID();
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).put({ id, file, receivedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('共有画像を保存できませんでした。'));
  });
  db.close();
  return id;
}

async function deleteSharedFile(id) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('共有画像を削除できませんでした。'));
  });
  db.close();
}

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  const runtime = keys.filter((request) => !APP_SHELL.some((entry) => new URL(entry, self.registration.scope).href === request.url));
  const excess = runtime.slice(0, Math.max(0, runtime.length - MAX_RUNTIME_ENTRIES));
  await Promise.all(excess.map((request) => cache.delete(request)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A controlled page may POST to the same-origin GitHub backend as well. Only
  // the manifest's share-target action is image intake; all other POST requests
  // must pass through untouched.
  const scopeUrl = new URL(self.registration.scope);
  const isShareTarget = request.method === 'POST'
    && url.pathname === scopeUrl.pathname
    && url.searchParams.get('share-target') === '1';
  if (isShareTarget) {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_SHARED_FILE_BYTES) {
          return Response.redirect(new URL('./?shareError=invalid-image', self.registration.scope), 303);
        }
        const id = await saveSharedFile(file);
        return Response.redirect(new URL(`./?shared=${encodeURIComponent(id)}`, self.registration.scope), 303);
      } catch {
        return Response.redirect(new URL('./?shareError=save-failed', self.registration.scope), 303);
      }
    })());
    return;
  }

  if (request.method !== 'GET' || request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && ['script', 'style', 'image', 'font', 'worker'].includes(request.destination)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
        event.waitUntil(trimRuntimeCache(cache));
      }
      return response;
    } catch {
      return new Response('オフラインのため取得できませんでした。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'DELETE_SHARED_FILE' && typeof data.id === 'string') event.waitUntil(deleteSharedFile(data.id));
  if (data.type === 'GET_VERSION') event.source?.postMessage({ type: 'SW_VERSION', version: VERSION });
});
