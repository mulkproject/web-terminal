// Cline Web UI Service Worker with Background Sync Support
const CACHE_NAME = 'cline-web-ui-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and WebSocket connections
  if (event.request.method !== 'GET' || event.request.url.startsWith('ws')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache
        return caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || caches.match('/');
        });
      })
  );
});

// Background Sync - keep connection alive
self.addEventListener('sync', (event) => {
  if (event.tag === 'keep-alive') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        // Notify all clients that sync occurred
        clients.forEach((client) => {
          client.postMessage({ type: 'sync', tag: 'keep-alive' });
        });
      })
    );
  }
});

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'terminal-keepalive') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'periodic-sync', tag: 'terminal-keepalive' });
        });
      })
    );
  }
});

// Message from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Handle keep-alive ping from client
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // Acknowledge - service worker is alive
    event.source.postMessage({ type: 'KEEP_ALIVE_ACK' });
  }
});