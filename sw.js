const CACHE_NAME = 'quant-verdict-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/quant.css',
  './js/app.js',
  './js/data.js',
  './js/indicators.js',
  './js/verdict.js',
  './js/charts.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each asset independently instead of cache.addAll(), which
      // fails the ENTIRE install if even one URL 404s — across repeated
      // redeploys that's an easy way to silently end up with no active
      // service worker at all, which fails Chrome's installability check
      // and demotes the site to a bare "Add to Home Screen" shortcut
      // instead of the full app install prompt.
      Promise.allSettled(
        ASSETS.map((url) =>
          fetch(url)
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
