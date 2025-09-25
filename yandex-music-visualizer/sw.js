self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('yandex-music-visualizer-v1').then(cache => {
      return cache.addAll([
        '/',
        '/src/index.html',
        '/src/styles/main.css',
        '/src/scripts/canvas.js',
        '/src/scripts/animation.js',
        '/src/scripts/utils.js',
        '/src/assets/icon.png',
        '/manifest.webmanifest'
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = ['yandex-music-visualizer-v1'];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});