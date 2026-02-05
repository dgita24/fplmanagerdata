/**
 * Cache policy definitions for FPL API endpoints
 * 
 * Centralizes TTL configuration, cache key computation, and GW-aware caching logic
 */

/**
 * TTL values (in seconds) for different endpoint types
 * 
 * Special values:
 * - 0 = Don't cache (current GW live data)
 * - -1 = Cache forever (past GW data never changes)
 */
export const DEFAULT_TTLS = {
  // Static/rarely changing data
  BOOTSTRAP_STATIC: 300, // 5 minutes
  
  // Live data - depends on GW
  EVENT_LIVE_CURRENT: 0, // Don't cache current GW
  EVENT_LIVE_PAST: -1, // Cache past GWs forever
  
  // Fixtures
  FIXTURES_CURRENT: 0, // Don't cache current GW fixtures
  FIXTURES_PAST: -1, // Cache finished fixtures forever
  
  // Manager data
  ENTRY: 120, // 2 minutes - manager name
  ENTRY_HISTORY_CURRENT: 0, // Don't cache (GW points change live)
  ENTRY_HISTORY_PAST: 300, // 5 minutes for past data
  ENTRY_EVENT_CURRENT: 0, // Don't cache current GW picks
  ENTRY_EVENT_PAST: -1, // Cache past GW picks forever
  ENTRY_TRANSFERS: 300, // 5 minutes
  
  // Element (player) summary
  ELEMENT_SUMMARY: 300, // 5 minutes
  
  // Default fallback
  DEFAULT: 60,
} as const;

/**
 * Extract gameweek number from API path
 * 
 * @param path - The FPL API path (e.g., "entry/123/event/24/picks")
 * @returns Gameweek number or null if not found
 */
export function extractGWFromPath(path: string): number | null {
  // Match patterns like "event/24/live" or "entry/123/event/24/picks"
  const eventMatch = path.match(/event\/(\d+)/);
  if (eventMatch) {
    return parseInt(eventMatch[1], 10);
  }
  
  return null;
}

/**
 * Get current gameweek from bootstrap-static data
 * 
 * This should be called once at startup and cached.
 * For now, we'll hardcode GW 24 as current (you'll need to fetch this dynamically)
 * 
 * @returns Current gameweek number
 */
export function getCurrentGW(): number {
  // TODO: Fetch this from bootstrap-static and cache it
  // For now, return 24 (you can update this manually each week)
  return 24;
}

/**
 * Determine TTL for a given FPL API path with GW awareness
 * 
 * @param path - The FPL API path (e.g., "bootstrap-static", "event/10/live")
 * @param currentGW - Current gameweek number (optional, defaults to getCurrentGW())
 * @returns TTL in seconds (0 = don't cache, -1 = cache forever, >0 = cache with TTL)
 */
export function getTTLForPath(path: string, currentGW?: number): number {
  const normalizedPath = path.toLowerCase().trim();
  const gw = extractGWFromPath(normalizedPath);
  const current = currentGW ?? getCurrentGW();
  
  // Bootstrap-static: always cache
  if (normalizedPath === 'bootstrap-static') {
    return DEFAULT_TTLS.BOOTSTRAP_STATIC;
  }
  
  // Event live data: GW-aware
  if (normalizedPath.match(/^event\/\d+\/live$/)) {
    if (gw === null) return DEFAULT_TTLS.DEFAULT;
    return gw < current 
      ? DEFAULT_TTLS.EVENT_LIVE_PAST    // Past GW: cache forever
      : DEFAULT_TTLS.EVENT_LIVE_CURRENT; // Current GW: don't cache
  }
  
  // Fixtures: GW-aware (if query includes event parameter)
  if (normalizedPath === 'fixtures') {
    // Note: fixtures endpoint uses query param ?event=24
    // This will be handled in computeCacheKey
    return DEFAULT_TTLS.DEFAULT;
  }
  
  // Entry summary: cache name/team (doesn't change during GW)
  if (normalizedPath.match(/^entry\/\d+$/)) {
    return DEFAULT_TTLS.ENTRY;
  }
  
  // Entry history: GW-aware (current GW points change live)
  if (normalizedPath.match(/^entry\/\d+\/history$/)) {
    // History endpoint includes current GW data
    // Conservative: don't cache during current GW
    return DEFAULT_TTLS.ENTRY_HISTORY_CURRENT;
  }
  
  // Entry event picks: GW-aware
  if (normalizedPath.match(/^entry\/\d+\/event\/\d+(\/picks)?$/)) {
    if (gw === null) return DEFAULT_TTLS.DEFAULT;
    return gw < current
      ? DEFAULT_TTLS.ENTRY_EVENT_PAST    // Past GW: cache forever
      : DEFAULT_TTLS.ENTRY_EVENT_CURRENT; // Current GW: don't cache
  }
  
  // Entry transfers: cache (transfers finalized after deadline)
  if (normalizedPath.match(/^entry\/\d+\/transfers$/)) {
    return DEFAULT_TTLS.ENTRY_TRANSFERS;
  }
  
  // Element summary
  if (normalizedPath.match(/^element-summary\/\d+$/)) {
    return DEFAULT_TTLS.ELEMENT_SUMMARY;
  }
  
  // Default TTL for unknown paths
  return DEFAULT_TTLS.DEFAULT;
}

/**
 * Compute cache key from upstream path and query string
 */
export function computeCacheKey(path: string, queryString: string): string {
  const normalizedPath = path.toLowerCase().trim();
  const normalizedQuery = queryString.trim();
  
  return `fpl:${normalizedPath}${normalizedQuery}`;
}

/**
 * Determine if a response should be cached
 */
export function shouldCacheResponse(response: Response): boolean {
  return response.ok && response.status >= 200 && response.status < 300;
}

/**
 * Cache allowlist - which endpoints have caching enabled
 * 
 * Enable all major endpoints now that we have KV
 */
export const CACHE_ALLOWLIST = new Set<string>([
  'bootstrap-static',
  'event/*/live',
  'fixtures',
  'entry/*',
  'element-summary/*',
]);

/**
 * Check if a path is allowed for caching
 */
export function isPathAllowedForCache(path: string): boolean {
  const normalizedPath = path.toLowerCase().trim();
  
  // Direct match
  if (CACHE_ALLOWLIST.has(normalizedPath)) {
    return true;
  }
  
  // Pattern matching for dynamic paths
  if (CACHE_ALLOWLIST.has('event/*/live') && normalizedPath.match(/^event\/\d+\/live$/)) {
    return true;
  }
  
  if (CACHE_ALLOWLIST.has('entry/*') && normalizedPath.match(/^entry\/\d+/)) {
    return true;
  }
  
  if (CACHE_ALLOWLIST.has('element-summary/*') && normalizedPath.match(/^element-summary\/\d+$/)) {
    return true;
  }
  
  return false;
}