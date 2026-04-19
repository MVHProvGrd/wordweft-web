// WordWeft Service Worker — caches static assets for offline shell
const CACHE_NAME = 'wordweft-v46';
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
    '/reserved_names.json',
    '/word_cefr.tsv',
    '/manifest.json',
    '/wefty.png',
    '/wefty_blink.png',
    '/wefty_wave.png',
    '/wefty_celebrate.png',
    '/wefty_arm.png',
    '/yarn_texture.png',
    '/wefty-thread.js',
    '/wefty-hub.html',
    '/wefty-run.html',
    '/wefty_run_a.png',
    '/wefty_run_b.png',
    '/wefty_fall.png',
    '/scissors_hazard.png',
    '/scissors_open.png',
    '/scissors_closed.png',
    '/parallax_bg.png',
    '/wefty_run_loop.mp3',
    '/wefty_game_over.mp3',
    '/wefty_powerup.mp3',
    '/needle_icon.png',
    '/spring_pad.png',
    '/glider_kite.png',
    '/double_jump.png',
    '/slowmo_yarn.png',
    '/yarn_shield.png',
    '/yarn_knot.png'
];

// Install: cache static assets. Do NOT auto-skipWaiting — we wait for the
// page to post {type:'SKIP_WAITING'} after the user clicks the reload
// banner so in-flight games don't get yanked mid-turn.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// Message from page: user confirmed they want the new version.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
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
