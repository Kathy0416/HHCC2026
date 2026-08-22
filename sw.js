// Service Worker for Migraine Tracker App

const CACHE_NAME = 'migraine-app-cache-v11-larger-band-artwork';
const urlsToCache = [
  '.',
  'index.html',
  'diary.html',
  'sleep.html',
  'health-analysis.css?v=11-larger-band-artwork',
  'health-analysis.js?v=9-band-artwork',
  'assets/apple-watch.svg',
  'assets/xiaomi-band.svg',
  'tips.html',
  'my.html',
  'ai-chat.html',
  'styles.css',
  'locales.js',
  'i18n.js?v=8-health-analysis',
  'script.js',
  'ai-chat.js',
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
