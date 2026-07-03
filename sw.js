/* Агромаштех Баримт — Service Worker (v4: network-first)
 * Онлайн үед ҮРГЭЛЖ шинэ кодыг ачаална (кэшэнд гацахгүй).
 * Сүлжээгүй үед л кэшнээс уншина.
 */
var CACHE = 'agro-baramt-v4';
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
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // API дуудлагыг хэзээ ч кэшлэхгүй
  if (url.indexOf('script.google.com') >= 0 ||
      url.indexOf('googleusercontent.com') >= 0) {
    return;
  }
  if (e.request.method !== 'GET') return;

  // NETWORK-FIRST: онлайн бол шинэ хувилбар, офлайн бол кэш
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { try { c.put(e.request, copy); } catch (x) {} });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
