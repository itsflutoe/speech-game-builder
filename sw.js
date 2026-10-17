const CACHE = 'speech-game-v2';
const CORE = [
  './',
  './index.html',
  './play.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchAndCache = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          if (
            url.includes('vosk') ||
            url.includes('model') ||
            url.endsWith('.js') ||
            url.endsWith('.wasm') ||
            url.endsWith('.html') ||
            url.endsWith('.webmanifest') ||
            url.includes('jsdelivr') ||
            url.includes('github.io')
          ) {
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
        }
        return res;
      }).catch(() => cached);
      return cached || fetchAndCache;
    })
  );
});
