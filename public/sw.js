// Service Worker for FPL Manager Data PWA
// Strategy:
//   - Cross-origin requests (Supabase API, CDN, etc.) → pass through, no interception
//   - Navigation requests (HTML pages) → pass through, no caching (auth-sensitive)
//   - Static assets (JS, CSS, images, fonts) → CacheFirst

const CACHE_VERSION = 'v1'
const STATIC_CACHE = `fpl-static-${CACHE_VERSION}`

const STATIC_ASSET_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf']

function isStaticAsset(url) {
  return STATIC_ASSET_EXTENSIONS.some(ext => url.pathname.endsWith(ext))
}

// Install: activate immediately
self.addEventListener('install', event => {
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // 1. Let cross-origin requests (Supabase API, CDN, etc.) pass through untouched.
  //    This is critical: do NOT call event.respondWith() so the browser sends the
  //    request natively, preserving Authorization headers and credentials.
  if (url.origin !== self.location.origin) {
    return
  }

  // 2. Let navigation requests (HTML pages) pass through untouched.
  //    HTML pages carry auth state checks; caching them causes stale-auth issues.
  if (event.request.mode === 'navigate') {
    return
  }

  // 3. CacheFirst for same-origin static assets
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached
          return fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone())
            }
            return response
          })
        })
      )
    )
  }
})
