/* FORTS PILOT — Service Worker v3
 * network-first для навигации и API; cache-first только для хешированных ассетов.
 * ВАЖНО: SW_VERSION меняется каждый релиз — это триггерит установку нового SW. */
const SW_VERSION = 'v5.1.1-20260919';
const CACHE_STATIC = `forts-pilot-static-${SW_VERSION}`;
const CACHE_RUNTIME = `forts-pilot-runtime-${SW_VERSION}`;

const API_HOSTS = [
  'invest-public-api.tbank.ru',
  'sandbox-invest-public-api.tbank.ru',
  'invest-public-api.tinkoff.ru',
  'sandbox-invest-public-api.tinkoff.ru',
];

/* index.html НЕ precache'им: он всегда network-first,
   иначе старый shell навсегда блокирует обновления */
const PRECACHE = ['./manifest.webmanifest', './logo.svg', './offline.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => Promise.allSettled(PRECACHE.map((p) => cache.add(p))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('forts-pilot-') && k !== CACHE_STATIC && k !== CACHE_RUNTIME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: только сеть (котировки не кешируем)
  if (isApi(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Навигация (SPA): network-first с обходом HTTP-кеша; свежий index.html — в runtime-кеш для офлайна
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' }))
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_RUNTIME).then((cache) => cache.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Хешированные ассеты и шрифты: cache-first (имя файла = версия, протухания нет)
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
  }
});
