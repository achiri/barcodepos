// Barcode Sales App — Service Worker v1.0
const CACHE_NAME = 'barcodepos-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/scanner.js',
  './js/sheets.js',
  './js/receipt.js',
  './manifest.json',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for app shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Apps Script API calls — network only
  if (url.hostname.includes('google') || url.href.includes('script.google.com')) {
    return;
  }

  // Google Sheets / API calls — network only
  if (url.href.includes('sheets.googleapis.com')) {
    return;
  }

  // Barcode lookup API
  if (url.href.includes('openfoodfacts.org')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // App shell + static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, response.clone());
          return response;
        });
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('Accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});

function networkFirst(request) {
  return fetch(request).then(response => {
    return caches.open(CACHE_NAME).then(cache => {
      cache.put(request, response.clone());
      return response;
    });
  }).catch(() => caches.match(request));
}
