/**
 * Generic cache-aside wrapper for FPL API responses
 *
 * This module provides caching infrastructure with a feature flag.
 * When FPL_CACHE_ENABLED is false (default), it acts as a passthrough.
 * When enabled in Cloudflare Workers runtime, it uses caches.default.
 */

export interface CacheMetrics {
  key: string;
  type: 'hit' | 'miss' | 'stale' | 'error';
  timestamp: number;
  ttl?: number;
}

/**
 * Check if caching is enabled via environment variable
 * Default: false (passthrough mode)
 */
function isCacheEnabled(env?: any): boolean {
  // First check: import.meta.env (Astro provides this everywhere)
  if (import.meta.env.PUBLIC_FPL_CACHE_ENABLED === true || import.meta.env.PUBLIC_FPL_CACHE_ENABLED === 'true') {
    return true;
  }

  // Second check: passed environment (from Cloudflare Pages context)
  if (env?.FPL_CACHE_ENABLED === 'true' || env?.FPL_CACHE_ENABLED === true) {
    return true;
  }

  // Third check: Node.js process.env
  if (typeof process !== 'undefined' && process.env?.FPL_CACHE_ENABLED === 'true') {
    return true;
  }

  return false;
}

/**
 * Check if running in Cloudflare Workers runtime with cache API
 */
function hasCloudflareCache(): boolean {
  return typeof caches !== 'undefined' && caches.default !== undefined;
}

/**
 * Log cache metrics (hit/miss/stale/error)
 * Only logs at cache boundary to avoid altering other logs
 */
function logCacheMetric(metric: CacheMetrics): void {
  if (!isCacheEnabled()) {
    return; // Don't log if caching is disabled
  }

  const timestamp = new Date(metric.timestamp).toISOString();
  console.log(`[CACHE ${metric.type.toUpperCase()}] ${metric.key} at ${timestamp}${metric.ttl ? ` (TTL: ${metric.ttl}s)` : ''}`);
}

/**
 * Generic cache-aside wrapper
 *
 * @param key - Cache key (should include full path + query string)
 * @param ttlSeconds - Time-to-live in seconds
 * @param fetcher - Async function that fetches the data (returns Response)
 * @param env - Optional environment object (from Cloudflare Pages context)
 * @returns Promise<Response>
 *
 * When FPL_CACHE_ENABLED is false: Always calls fetcher (passthrough)
 * When FPL_CACHE_ENABLED is true: Checks cache first, falls back to fetcher
 */
export async function getOrSet(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<Response>,
  env?: any
): Promise<Response> {
  const enabled = isCacheEnabled(env);

  // Passthrough mode when caching is disabled
  if (!enabled) {
    return await fetcher();
  }

  // Caching enabled - check if we have Cloudflare cache available
  if (!hasCloudflareCache()) {
    // Log warning but continue with passthrough
    console.warn('[CACHE] Caching enabled but Cloudflare cache API not available, using passthrough');
    return await fetcher();
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/${key}`);

  try {
    // Try to get from cache
    const cached = await cache.match(cacheKey);

    if (cached) {
      // Check if cache is stale
      const cacheTime = cached.headers.get('X-Cache-Time');
      const now = Date.now();

      if (cacheTime) {
        const age = (now - parseInt(cacheTime, 10)) / 1000;
        if (age > ttlSeconds) {
          logCacheMetric({
            key,
            type: 'stale',
            timestamp: now,
            ttl: ttlSeconds,
          });
          // Cache is stale, fetch fresh data
        } else {
          logCacheMetric({
            key,
            type: 'hit',
            timestamp: now,
            ttl: ttlSeconds,
          });
          return cached;
        }
      } else {
        // No cache time header, return cached response
        logCacheMetric({
          key,
          type: 'hit',
          timestamp: now,
          ttl: ttlSeconds,
        });
        return cached;
      }
    }

    // Cache miss - fetch fresh data
    logCacheMetric({
      key,
      type: 'miss',
      timestamp: Date.now(),
      ttl: ttlSeconds,
    });

    const response = await fetcher();

    // Only cache successful responses (status 200-299)
    if (response.ok) {
      // Clone the response to cache it
      const responseToCache = response.clone();

      // Add cache metadata headers
      const headers = new Headers(responseToCache.headers);
      headers.set('X-Cache-Time', Date.now().toString());
      headers.set('X-Cache-TTL', ttlSeconds.toString());

      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers,
      });

      // Store in cache (fire and forget)
      cache.put(cacheKey, cachedResponse).catch((err) => {
        console.error('[CACHE] Failed to store in cache:', err);
      });
    }

    return response;
  } catch (error) {
    // Log cache error and fall back to fetcher
    logCacheMetric({
      key,
      type: 'error',
      timestamp: Date.now(),
      ttl: ttlSeconds,
    });
    console.error('[CACHE] Error accessing cache:', error);
    return await fetcher();
  }
}

/**
 * Clear cache for a specific key (optional utility for testing)
 */
export async function clearCache(key: string): Promise<boolean> {
  if (!isCacheEnabled() || !hasCloudflareCache()) {
    return false;
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/${key}`);

  try {
    return await cache.delete(cacheKey);
  } catch (error) {
    console.error('[CACHE] Error clearing cache:', error);
    return false;
  }
}