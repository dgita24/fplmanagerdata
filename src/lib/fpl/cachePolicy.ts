/**
 * Cache policy definitions for FPL API endpoints
 * 
 * Centralizes TTL configuration and cache key computation
 */

/**
 * Default TTL values (in seconds) for different endpoint types
 */
export const DEFAULT_TTLS = {
  // Static/rarely changing data
  BOOTSTRAP_STATIC: 3600, // 1 hour - team/player lists change infrequently
  
  // Live data during gameweek
  EVENT_LIVE: 30, // 30 seconds - near real-time acceptable for live scores
  
  // Fixtures
  FIXTURES: 300, // 5 minutes - fixture list changes occasionally
  
  // Manager/team data
  ENTRY: 60, // 1 minute - manager data changes during transfers
  ENTRY_HISTORY: 300, // 5 minutes - historical data doesn't change often
  ENTRY_EVENT: 60, // 1 minute - current GW picks/points
  
  // Element (player) summary
  ELEMENT_SUMMARY: 300, // 5 minutes - player history/upcoming fixtures
  
  // Default fallback for unknown endpoints
  DEFAULT: 60, // 1 minute - conservative default
} as const;

/**
 * Determine TTL for a given FPL API path
 * 
 * @param path - The FPL API path (e.g., "bootstrap-static", "event/10/live")
 * @returns TTL in seconds
 */
export function getTTLForPath(path: string): number {
  // Normalize path
  const normalizedPath = path.toLowerCase().trim();
  
  // Match specific patterns
  if (normalizedPath === 'bootstrap-static') {
    return DEFAULT_TTLS.BOOTSTRAP_STATIC;
  }
  
  if (normalizedPath.match(/^event\/\d+\/live$/)) {
    return DEFAULT_TTLS.EVENT_LIVE;
  }
  
  if (normalizedPath === 'fixtures') {
    return DEFAULT_TTLS.FIXTURES;
  }
  
  if (normalizedPath.match(/^entry\/\d+$/)) {
    return DEFAULT_TTLS.ENTRY;
  }
  
  if (normalizedPath.match(/^entry\/\d+\/history$/)) {
    return DEFAULT_TTLS.ENTRY_HISTORY;
  }
  
  if (normalizedPath.match(/^entry\/\d+\/event\/\d+$/)) {
    return DEFAULT_TTLS.ENTRY_EVENT;
  }
  
  if (normalizedPath.match(/^element-summary\/\d+$/)) {
    return DEFAULT_TTLS.ELEMENT_SUMMARY;
  }
  
  // Default TTL for unknown paths
  return DEFAULT_TTLS.DEFAULT;
}

/**
 * Compute cache key from upstream path and query string
 * 
 * @param path - The FPL API path
 * @param queryString - Query string (including leading '?') or empty string
 * @returns Cache key string
 */
export function computeCacheKey(path: string, queryString: string): string {
  // Normalize and create a consistent cache key
  const normalizedPath = path.toLowerCase().trim();
  const normalizedQuery = queryString.trim();
  
  return `fpl:${normalizedPath}${normalizedQuery}`;
}

/**
 * Determine if a response should be cached
 * 
 * @param response - The Response object
 * @returns true if response should be cached, false otherwise
 * 
 * Rules:
 * - Only cache successful responses (status 200-299)
 * - Don't cache error responses (4xx, 5xx)
 */
export function shouldCacheResponse(response: Response): boolean {
  return response.ok && response.status >= 200 && response.status < 300;
}

/**
 * Cache allowlist - which endpoints have caching enabled
 * 
 * This allows for gradual rollout of caching per endpoint.
 * When FPL_CACHE_ENABLED is true, only paths in this set will be cached.
 * 
 * Initial rollout:
 * 1. bootstrap-static (long TTL, rarely changes)
 * 2. event/{gw}/live (30s TTL, live data)
 * 
 * Future rollout:
 * 3. fixtures
 * 4. element-summary/{id}
 * 5. entry/{id}/* endpoints
 */
export const CACHE_ALLOWLIST = new Set<string>([
  // Phase 1: Static data
  'bootstrap-static',
  
  // Phase 2: Live data (to be enabled after validation)
  // 'event/*/live', // Pattern matching handled in isPathAllowedForCache
  
  // Phase 3+: Other endpoints (to be enabled after validation)
  // 'fixtures',
  // 'element-summary/*',
  // 'entry/*',
]);

/**
 * Check if a path is allowed for caching
 * 
 * @param path - The FPL API path
 * @returns true if path is in allowlist, false otherwise
 */
export function isPathAllowedForCache(path: string): boolean {
  const normalizedPath = path.toLowerCase().trim();
  
  // Direct match
  if (CACHE_ALLOWLIST.has(normalizedPath)) {
    return true;
  }
  
  // Pattern matching for dynamic paths
  // Uncomment as more endpoints are rolled out
  
  // if (CACHE_ALLOWLIST.has('event/*/live') && normalizedPath.match(/^event\/\d+\/live$/)) {
  //   return true;
  // }
  
  return false;
}
