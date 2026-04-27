// WordWeft Service Worker — caches static assets for offline shell
const CACHE_NAME = 'wordweft-v149';
// 2026-04-27 20:46Z is replaced by the sync-wordweft-web workflow
// at deploy time with the UTC timestamp of the sync (e.g.
// "2026-04-23 21:45Z"). When running from source it stays as the
// placeholder and the page shows "(dev)" instead.
const BUILD_TIMESTAMP = '2026-04-27 20:46Z';
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
    '/wefty-scores.html',
    '/wefty-climb.html',
    '/wefty-controls.html',
    '/music.html',
    '/climb_bg_green.png',
    '/climb_bg_brown.png',
    '/climb_bg_snow.png',
    '/climb_ledge_green_v0.png',
    '/climb_ledge_green_v1.png',
    '/climb_ledge_green_v2.png',
    '/climb_ledge_green_v3.png',
    '/climb_ledge_brown_v0.png',
    '/climb_ledge_brown_v1.png',
    '/climb_ledge_brown_v2.png',
    '/climb_ledge_brown_v3.png',
    '/climb_ledge_snow_v0.png',
    '/climb_ledge_snow_v1.png',
    '/climb_ledge_snow_v2.png',
    '/climb_ledge_snow_v3.png',
    '/run_ledge_meadow_v0.png',
    '/run_ledge_meadow_v1.png',
    '/run_ledge_meadow_v2.png',
    '/run_ledge_meadow_v3.png',
    '/run_ledge_storm_v0.png',
    '/tut_meet_wefty.svg',
    '/tut_bridge_gaps.svg',
    '/tut_tap_jump.svg',
    '/tut_dodge_scissors.svg',
    '/tut_spell_wefty.svg',
    '/tut_spring_pad.svg',
    '/tut_powerups.svg',
    '/tut_storm.svg',
    '/tut_keys.svg',
    '/tut_best.svg',
    '/fraunces.ttf',
    '/nunito.ttf',
    '/jetbrains_mono.ttf',
    '/wefty_run_a.png',
    '/wefty_run_b.png',
    '/wefty_fall.png',
    '/scissors_hazard.png',
    '/scissors_open.png',
    '/scissors_closed.png',
    '/parallax_bg.png',
    '/parallax_woodland.png',
    '/wefty_run_loop.mp3',
    '/wefty_climb_loop.mp3',
    '/jazz_loop.mp3',
    '/chiptune_loop.mp3',
    '/lullaby_loop.mp3',
    '/bossa_loop.mp3',
    '/blues_loop.mp3',
    '/wefty_game_over.mp3',
    '/wefty_powerup.mp3',
    '/needle_icon.png',
    '/spring_pad.png',
    '/spring_pad_v2.png',
    '/glider_kite.png',
    '/double_jump.png',
    '/slowmo_yarn.png',
    '/yarn_shield.png',
    '/yarn_knot.png',
    '/lasso.png',
    '/rope_texture.png',
    '/wefty_glider.png',
    '/wefty_shield.png',
    '/wefty_spring.png',
    '/wefty_whoosh.png',
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
    } else if (event.data && event.data.type === 'GET_VERSION') {
        // Respond to page's version query so the home-screen badge can
        // show what SW is actually active + when it was deployed.
        // Client sends a MessageChannel port in event.ports[0]; reply
        // through that so the client's chan.port1.onmessage fires.
        const ts = BUILD_TIMESTAMP.startsWith('__BUILD') ? '(dev)' : BUILD_TIMESTAMP;
        const reply = {
            type: 'VERSION',
            version: CACHE_NAME,
            buildTimestamp: ts,
        };
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage(reply);
        } else if (event.source) {
            event.source.postMessage(reply);
        }
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

    // Skip ALL non-same-origin requests — Firebase, Google APIs, Cloud
    // Functions, CDNs, etc. The SW should only handle this app's own
    // static assets. Wrapping cross-origin fetches was mangling CORS
    // responses (gradeStory in particular: the SW would re-fetch the
    // preflight, cache.put() would throw on the POST, and the client
    // would see ERR_FAILED + "Failed to convert value to 'Response'").
    if (url.origin !== self.location.origin) {
        return;
    }

    // Never cache non-GET (POST/PUT/DELETE can't live in CacheStorage).
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only cache full 200 responses. 206 (Partial Content) from
                // Range requests on mp3/mp4 throws "Partial response is
                // unsupported" in Cache API. 3xx redirects also unsafe to
                // cache as-is. Skip anything non-200.
                if (response.status === 200) {
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
