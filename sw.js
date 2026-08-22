// Service Worker for Migraine Tracker App

const CACHE_NAME = 'migraine-app-cache-v9-readings';
const urlsToCache = [
  '.',
  'index.html',
  'diary.html',
  'sleep.html',
  'health-analysis.css?v=9-readings',
  'health-analysis.js?v=9-readings',
  'tips.html',
  'my.html',
  'ai-chat.html',
  'styles.css',
  'locales.js',
  'i18n.js?v=9-readings',
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

// Fetch event - 静态资源：缓存优先 + 后台更新（stale-while-revalidate）
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // API 请求一律走网络、不缓存，避免返回过期的空数据
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
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
