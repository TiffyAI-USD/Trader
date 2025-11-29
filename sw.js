const CACHE_NAME = 'tiffyai-bucks-v11';
const ASSETS = [
  '/Bucks/',
  '/Bucks/index.html',
  '/Bucks/manifest.json',
  '/Bucks/icon.png',
  '/Bucks/icon-192x192.png',
  '/Bucks/icon-512x512.png',
  '/Bucks/sky.jpg',
  '/Bucks/click.mp3',
  'https://aframe.io/releases/1.5.0/aframe.min.js',
  'https://cdn.jsdelivr.net/npm/aframe-extras@6.1.1/dist/aframe-extras.min.js'
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate & Clean Old Caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Fetch
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(networkResponse => {
        // Cache new assets
        if (e.request.url.includes('/Bucks/')) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, networkResponse.clone());
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Offline fallback
      if (e.request.destination === 'document') {
        return caches.match('/Bucks/index.html');
      }
    })
  );
});
