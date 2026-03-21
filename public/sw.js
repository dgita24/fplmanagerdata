// Service Worker for FPL Manager Watch PWA
const STATIC_CACHE = 'fpl-static-v1';

// Asset types that are safe to cache (content-hashed by the build)
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font']);

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Take control immediately so updates apply without waiting for all tabs to close.
  // This is especially important in PWA standalone mode where tabs may never close.
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // CRITICAL: Never intercept cross-origin requests (especially Supabase auth).
  // Let the browser handle these natively to preserve Authorization headers.
  if (url.origin !== self.location.origin) {
    return; // Do NOT call event.respondWith() — browser handles it natively
  }

  // API routes → never cache, pass through to network
  if (url.pathname.startsWith('/api/')) {
    return; // Let browser handle natively
  }

  // Static assets → CacheFirst (they are content-hashed by the build)
  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation and all other requests → pass through to network.
  // Do NOT cache HTML pages — they depend on auth state and caching
  // them causes stale auth UI to be served after session changes.
});

// ── Cache helpers ─────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network failed and nothing cached — let it propagate as a network error
    throw new Error(`Network request failed for ${request.url}: ${err.message || err}`);
  }
}
