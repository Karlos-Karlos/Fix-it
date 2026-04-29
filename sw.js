const CACHE = 'fixit-pwa-v2';
const PRECACHE = ['./index.html', './manifest.json'];

// API path prefixes — never intercept these
const API_PREFIXES = ['/api/', '/auth/', '/tracking/', '/wearable/', '/workouts/', '/nutrition/', '/users/', '/analysis/', '/coach/', '/gamification/', '/admin/'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req  = e.request;
    const url  = new URL(req.url);

    if (req.method !== 'GET') return;

    // Never intercept backend API calls
    if (API_PREFIXES.some(p => url.pathname.startsWith(p))) return;

    // script.js has a ?_=timestamp cache-buster: network first, any-version fallback
    if (url.pathname.endsWith('/script.js') || url.pathname === '/script.js') {
        e.respondWith(
            fetch(req)
                .then(res => {
                    caches.open(CACHE).then(c => c.put(req, res.clone()));
                    return res;
                })
                .catch(() => caches.match(req, { ignoreSearch: true }))
        );
        return;
    }

    // Everything else: serve from cache immediately, refresh in background (stale-while-revalidate)
    e.respondWith(
        caches.match(req).then(cached => {
            const fetchPromise = fetch(req)
                .then(res => {
                    try { caches.open(CACHE).then(c => c.put(req, res.clone())); } catch (_) {}
                    return res;
                })
                .catch(() => null);
            return cached || fetchPromise;
        })
    );
});
