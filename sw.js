/**
 * sw.js
 * Service Worker لتشغيل تطبيق المهندسين دون اتصال بالإنترنت (Offline-First)
 * شركة المحايد مهندسون استشاريون (MCE)
 */

const CACHE_NAME = 'mce-safety-pwa-v1';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/db.js',
  './js/media.js',
  './js/app.js',
  './assets/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (name) {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return Promise.resolve();
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;

  // لا نعترض طلبات POST أو طلبات خادم Google Apps Script
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (
    url.hostname.indexOf('script.google.com') !== -1 ||
    url.hostname.indexOf('script.googleusercontent.com') !== -1
  ) {
    return;
  }

  // فقط لملفات نفس نطاق التطبيق على GitHub Pages
  if (url.origin !== self.location.origin) {
    return;
  }

  // استراتيجية: الرد الفوري من الكاش مع تحديث صامت في الخلفية عند وجود إنترنت
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cachedResp) {
        const networkFetch = fetch(req).then(function (networkResp) {
          if (networkResp && networkResp.status === 200) {
            cache.put(req, networkResp.clone());
          }
          return networkResp;
        }).catch(function () {
          return null;
        });

        if (cachedResp) {
          return cachedResp;
        }

        return networkFetch.then(function (resp) {
          if (resp) return resp;
          if (req.mode === 'navigate') {
            return cache.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      });
    })
  );
});
