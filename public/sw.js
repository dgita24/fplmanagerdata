/**
 * FPL Manager Watch – Service Worker
 *
 * Strategy rationale
 * ------------------
 * This is a production app serving live FPL data.  Aggressive caching would
 * cause users to see stale data, so we use the most conservative approach
 * that still gives a meaningful installed-app experience:
 *
 *  • /api/*            → NetworkOnly   (never cache; always live data)
 *  • navigation (HTML) → NetworkFirst  (try network first; serve cache only
 *                                       when offline so the page loads)
 *  • static assets     → CacheFirst    (JS/CSS/fonts/images are content-
 *                                       hashed so stale is never an issue)
 *
 * Rollback: remove the <script> block that registers this SW from
 * src/layouts/Layout.astro and delete this file.
 */

const CACHE_VERSION = 'v2';
const STATIC_CACHE  = `fpl-static-${CACHE_VERSION}`;
const NAV_CACHE     = `fpl-nav-${CACHE_VERSION}`;

// request.destination values that represent cacheable static assets.
// Using destination is more robust than extension-matching (handles
// query-strings, extensionless paths, etc.)
const STATIC_DESTINATIONS = new Set([
  'script', 'style', 'font', 'image', 'manifest', 'worker',
]);

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Do NOT call skipWaiting() here.
  //
  // skipWaiting() forces the new SW to activate immediately, even while an
  // existing page load is in progress.  Combined with clients.claim() this
  // can cause a race where the SW takes control mid-load and the new fetch
  // handler starts intercepting requests the page has already sent —
  // resulting in those requests hanging (seen on mobile Brave and some
  // Android WebViews).
  //
  // Normal lifecycle without skipWaiting():
  //   • First install (no previous SW): activates immediately ✓
  //   • SW update: waits for all controlled pages to close, then
  //     takes over on the next fresh page load ✓
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Remove caches from older SW versions then claim clients.
  // clients.claim() is safe here because — without skipWaiting() — the SW
  // only activates once every tab using the *old* SW is closed.  There is
  // no in-progress page load to race against.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== NAV_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // API routes → always go to the network; never cache.
  //
  // IMPORTANT: we call event.respondWith(fetch(...)) explicitly rather than
  // simply `return`-ing.  Some mobile browsers (Brave on Android/iOS and
  // certain Android WebViews) have a bug where a SW fetch handler that
  // returns without calling event.respondWith() causes the request to hang
  // indefinitely instead of falling through to the native network path.
  // Being explicit avoids this entirely.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request.clone()));
    return;
  }

  // Static assets → CacheFirst (they are content-hashed by the build).
  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigation / HTML → NetworkFirst with offline cache fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNav(request));
    return;
  }

  // All other same-origin requests (e.g. JS fetch() calls to /data/* files,
  // inline XHR, etc.) — pass through explicitly for the same reason as
  // the /api/* case above.
  event.respondWith(fetch(request.clone()));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * CacheFirst: return cached response if available, otherwise fetch and cache.
 */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Static asset unavailable offline – nothing useful to return.
    console.warn('[SW] Static asset unavailable offline:', request.url, _err);
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * NetworkFirst for navigation: always try the network; fall back to a cached
 * version of the same URL (from a previous online visit) when offline.
 */
async function networkFirstNav(request) {
  const cache = await caches.open(NAV_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Network unavailable – try the navigation cache for this URL.
    console.warn('[SW] Navigation network fetch failed, trying cache:', request.url, _err);
    const cached = await cache.match(request);
    if (cached) return cached;

    // Last resort: minimal offline notice (not a full page, but better than
    // a browser error).  Users on a live connection will never see this.
    return new Response(
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f172a">
  <title>FPL Manager Watch – Offline</title>
  <style>
    body { background:#0f172a; color:#f1f5f9; font-family:sans-serif;
           display:flex; align-items:center; justify-content:center;
           min-height:100vh; margin:0; text-align:center; padding:1rem; }
    h1 { font-size:1.5rem; margin-bottom:.5rem; }
    p  { color:#94a3b8; }
  </style>
</head>
<body>
  <div>
    <h1>You're offline</h1>
    <p>Please check your internet connection and try again.</p>
  </div>
</body>
</html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
