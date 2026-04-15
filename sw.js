// WordWeft Service Worker — caches static assets for offline shell
const CACHE_NAME = 'wordweft-v15';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/auth.js',
    '/room.js',
    '/game.js',
    '/results.js',
    '/screens.js',
    '/firebase-config.js',
    '/sound.js',
    '/analyzer.js',
    '/profanity.json',
    '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network first, fall back to cache for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Don't cache Firebase or Google API requests
    if (url.hostname.includes('firebase') ||
        url.hostname.includes('google') ||
        url.hostname.includes('gstatic')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
