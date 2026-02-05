/**
 * KV-based cache wrapper for FPL API responses
 * 
 * This module provides caching infrastructure using Cloudflare Workers KV.
 * When FPL_CACHE_ENABLED is false (default), it acts as a passthrough.
 * When enabled, it uses the FPL_CACHE KV namespace.
 */

export interface CacheMetrics {
  key: string;
  type: 'hit' | 'miss' | 'stale' | 'error' | 'skip';
  timestamp: number;
  ttl?: number;
}

/**
 * Check if caching is enabled via environment variable
 * Default: false (passthrough mode)
 */
function isCacheEnabled(env: any): boolean {
  return env?.FPL_CACHE_ENABLED === 'true';
}

/**
 * Check if KV namespace is available
 */
function hasKVNamespace(env: any): boolean {
  return env?.FPL_CACHE !== undefined;
}

/**
 * Log cache metrics (hit/miss/stale/error/skip)
 */
function logCacheMetric(metric: CacheMetrics): void {
  const timestamp = new Date(metric.timestamp).toISOString();
  console.log(`[CACHE ${metric.type.toUpperCase()}] ${metric.key} at ${timestamp}${metric.ttl ? ` (TTL: ${metric.ttl}s)` : ''}`);
}

/**
 * KV cache-aside wrapper
 * 
 * @param key - Cache key (should include full path + query string)
 * @param ttlSeconds - Time-to-live in seconds (0 = don't cache, -1 = cache forever)
 * @param fetcher - Async function that fetches the data (returns Response)
 * @param env - Cloudflare environment object with FPL_CACHE binding
 * @returns Promise<Response>
 * 
 * When FPL_CACHE_ENABLED is false: Always calls fetcher (passthrough)
 * When FPL_CACHE_ENABLED is true: Checks KV first, falls back to fetcher
 * When ttlSeconds is 0: Always calls fetcher (cache skip)
 */
export async function getOrSet(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<Response>,
  env: any
): Promise<Response> {
  const enabled = isCacheEnabled(env);
  
  // Passthrough mode when caching is disabled
  if (!enabled) {
    return await fetcher();
  }
  
  // Skip cache if TTL is 0 (explicit no-cache for current GW data)
  if (ttlSeconds === 0) {
    logCacheMetric({
      key,
      type: 'skip',
      timestamp: Date.now(),
      ttl: ttlSeconds,
    });
    return await fetcher();
  }
  
  // Check if KV namespace is available
  if (!hasKVNamespace(env)) {
    console.warn('[CACHE] Caching enabled but FPL_CACHE KV namespace not available, using passthrough');
    return await fetcher();
  }
  
  const kv = env.FPL_CACHE;
  
  try {
    // Try to get from KV
    const cachedText = await kv.get(key, { type: 'text' });
    
    if (cachedText) {
      // Cache hit
      logCacheMetric({
        key,
        type: 'hit',
        timestamp: Date.now(),
        ttl: ttlSeconds,
      });
      
      // Parse cached data and reconstruct Response
      try {
        const cachedData = JSON.parse(cachedText);
        return new Response(JSON.stringify(cachedData), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-Cache-Status": "HIT",
          },
        });
      } catch (parseError) {
        console.error('[CACHE] Failed to parse cached data:', parseError);
        // Fall through to fetch fresh data
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
      // Clone and extract JSON
      const dataToCache = await response.clone().json();
      
      // Store in KV
      const putOptions = ttlSeconds > 0 
        ? { expirationTtl: ttlSeconds }  // TTL in seconds
        : {};  // No expiration (cache forever)
      
      // Fire and forget - don't wait for KV write
      kv.put(key, JSON.stringify(dataToCache), putOptions).catch((err: any) => {
        console.error('[CACHE] Failed to store in KV:', err);
      });
      
      // Return response with cache status header
      return new Response(JSON.stringify(dataToCache), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Cache-Status": "MISS",
        },
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
    console.error('[CACHE] Error accessing KV:', error);
    return await fetcher();
  }
}

/**
 * Clear cache for a specific key (optional utility for testing)
 */
export async function clearCache(key: string, env: any): Promise<boolean> {
  if (!isCacheEnabled(env) || !hasKVNamespace(env)) {
    return false;
  }
  
  try {
    await env.FPL_CACHE.delete(key);
    return true;
  } catch (error) {
    console.error('[CACHE] Error clearing cache:', error);
    return false;
  }
}