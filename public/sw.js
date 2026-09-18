/* FORTS PILOT — Service Worker (design.md §8)
 * network-first для API Т-Инвестиций, cache-first для статики, офлайн-фолбэк на index.html */

const CACHE_STATIC = 'forts-pilot-static-v1';
const CACHE_RUNTIME = 'forts-pilot-runtime-v1';

const API_HOSTS = [
  'invest-public-api.tbank.ru',
  'sandbox-invest-public-api.tbank.ru',
  'invest-public-api.tinkoff.ru',
  'sandbox-invest-public-api.tinkoff.ru',
];

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.svg',
  './offline.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return API_HOSTS.includes(url.hostname);
}

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    /\.(js|css|png|svg|webp|woff2?|webmanifest)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // API-запросы POST — напрямую в сеть
  const url = new URL(request.url);

  // API: network-first (не кешируем котировки — только живые данные)
  if (isApi(url)) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request)),
    );
    return;
  }

  // Статика: cache-first
  if (isStaticAsset(url) || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_RUNTIME).then((cache) => cache.put(request, clone));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Навигация (SPA): network-first, офлайн — закешированный index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_RUNTIME).then((cache) => cache.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
  }
});
