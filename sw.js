const CACHE_NAME = 'codex-v1';
const ASSETS_TO_CACHE = [
  '/',
  './index.html',
  './style.css',
  './app.js',
  './codex_usage.json',
  '/webapp/assets/logo.png',
  '/webapp/assets/logo_background.png',
  '/webapp/assets/codex.webp',
  '/webapp/assets/splash.svg'
];

/* ===== Install Event ===== */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // Alguns assets podem não estar disponíveis, continuar mesmo assim
        return Promise.resolve();
      });
    }).then(() => {
      // Ativar o novo service worker imediatamente
      return self.skipWaiting();
    })
  );
});

/* ===== Activate Event ===== */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Reclamar todos os clientes
      return self.clients.claim();
    })
  );
});

/* ===== Fetch Event - Network First para dados, Cache First para assets ===== */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorar requisições para domínios diferentes
  if (url.origin !== location.origin) {
    return;
  }

  // Strategy: Network First para dados dinâmicos (JSON)
  if (event.request.url.includes('codex_usage.json')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Guardar resposta válida no cache
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Falha na rede, usar cache
          return caches.match(event.request).then(response => {
            return response || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // Strategy: Cache First para assets (imagens, CSS, JS)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        
        return fetch(event.request).then(response => {
          // Não cachear requisições não-GET
          if (!event.request.method === 'GET' || !response || response.status !== 200) {
            return response;
          }
          
          // Guardar no cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          
          return response;
        });
      })
      .catch(() => {
        // Fallback para offline
        return new Response('Resource not found', { status: 404 });
      })
  );
});

/* ===== Background Sync (Opcional) ===== */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-codex-data') {
    event.waitUntil(
      fetch('./codex_usage.json')
        .then(response => response.json())
        .then(data => {
          // Guardar dados atualizados
          return caches.open(CACHE_NAME).then(cache => {
            return cache.put('./codex_usage.json', new Response(JSON.stringify(data)));
          });
        })
        .catch(err => console.error('Sync failed:', err))
    );
  }
});

/* ===== Push Notifications (Opcional) ===== */
self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Codex Analytics', {
      body: data.body || '',
      icon: '/webapp/assets/logo.png',
      badge: '/webapp/assets/logo.png',
      tag: 'codex-notification',
      requireInteraction: data.requireInteraction || false
    })
  );
});

/* ===== Notification Click ===== */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Tentar focar uma janela existente
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Abrir nova janela se não houver
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
