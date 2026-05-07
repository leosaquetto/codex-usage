const CACHE_VERSION = 'v2';
const STATIC_CACHE = `codex-static-${CACHE_VERSION}`;
const DATA_CACHE = `codex-data-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/codex_usage.json',
  '/webapp/assets/logo.png',
  '/webapp/assets/logo_background.png',
  '/webapp/assets/codex.webp',
  '/webapp/assets/splash.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => Promise.resolve())
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
            .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isSameOrigin(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || !isSameOrigin(request)) {
    return;
  }

  const isNavigation = request.mode === 'navigate';
  const isUsageData = request.url.includes('/codex_usage.json');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', clone));
          }
          return response;
        })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/'))),
    );
    return;
  }

  if (isUsageData) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request) || caches.match('/codex_usage.json')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});


self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'Codex Usage', body: 'Limite baixo detectado.' };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Codex Usage', body: event.data.text() || payload.body };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Codex Usage', {
      body: payload.body || 'Limite baixo detectado.',
      icon: '/webapp/assets/logo.png',
      badge: '/webapp/assets/logo.png',
      tag: payload.tag || 'codex-push-alert',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
