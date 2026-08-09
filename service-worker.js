const CACHE_NAME = 'weather-pwa';
const DATA_CACHE_NAME = 'weather-data';

// The core files needed to load the UI
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

// 1. Install Event: Cache the static app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// 2. Activate Event: Clean up old caches if the version name changes
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

// 3. Fetch Event: Intercept network requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // If the request is for the NWS API, use Network-First, fallback to Cache
    if (url.origin === 'https://api.weather.gov') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Clone the response and save it to the data cache
                    const clonedResponse = response.clone();
                    caches.open(DATA_CACHE_NAME).then((cache) => {
                        cache.put(event.request, clonedResponse);
                    });
                    return response;
                })
                .catch(() => {
                    // If network fails (offline), try to return cached data
                    return caches.match(event.request);
                })
        );
    } else {
        // For static assets (HTML, JS, CSS, images), use Cache-First, fallback to Network
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                return cachedResponse || fetch(event.request);
            })
        );
    }
});
