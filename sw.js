/* Агромаштех Баримт — Service Worker
 * Аппын бүрхүүлийг кэшлэж, сүлжээгүй үед нээгддэг болгоно.
 * ⚠️ Файл өөрчлөгдвөл CACHE хувилбарын дугаарыг ахиулна (v1→v2...).
 */
var CACHE = 'agro-baramt-v1';
var SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './lib/html5-qrcode.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // API дуудлагыг (script.google.com / googleusercontent) ХЭЗЭЭ Ч кэшлэхгүй
  if (url.indexOf('script.google.com') >= 0 ||
      url.indexOf('googleusercontent.com') >= 0) {
    return; // браузер шууд сүлжээгээр дуудна
  }
  // Бүрхүүл: cache-first (сүлжээгүй ч нээгдэнэ)
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        return caches.open(CACHE).then(function (c) {
          try { c.put(e.request, res.clone()); } catch (x) {}
          return res;
        });
      }).catch(function () { return hit; });
    })
  );
});
