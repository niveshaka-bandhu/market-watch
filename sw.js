const CACHE_NAME = 'quant-verdict-v2';
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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
