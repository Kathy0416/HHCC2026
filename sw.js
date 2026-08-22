// Service Worker for Migraine Tracker App

const CACHE_NAME = 'migraine-app-cache-v26-demo-series';
const urlsToCache = [
  '.',
  'index.html',
  'diary.html',
  'sleep.html',
  'health-analysis.css?v=19-sensor-series',
  'health-analysis.js?v=20-demo-series',
  'esp32-parser.js?v=12-esp32-environment',
  'locales.js?v=20-demo-series',
  'api.js?v=19-sensor-series',
  'assets/apple-watch.svg',
  'assets/xiaomi-band.svg',
  'assets/moon-icon.svg',
  'tips.html',
  'my.html',
  'ai-chat.html',
  'styles.css',
  'ai-chat.css?v=1',
  'assets/ai-chat-icon.svg',
  'locales.js',
  'i18n.js?v=8-health-analysis',
  'script.js',
  'ai-chat.js?v=1',
  'api.js'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - 缓存优先 + 后台更新（stale-while-revalidate）
// 既能离线使用，又不会一直卡在旧版本
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // API responses can contain per-user state and must never be served stale.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;

  // Always prefer the latest HTML. This prevents a cached page from hiding
  // layout fixes until the user refreshes multiple times.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
