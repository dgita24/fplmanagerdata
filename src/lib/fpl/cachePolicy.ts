/**
 * Cache policy definitions for FPL API endpoints
 *
 * CRITICAL GOAL:
 * Never serve stale data for anything that can affect live/current GW views.
 *
 * Strategy:
 * - Current GW live-sensitive endpoints => TTL 0 (never KV-cache)
 * - Past GW immutable endpoints => TTL -1 (cache forever)
 * - Truly static endpoints => short TTL (bootstrap-static)
 * - Other endpoints => conservative TTL or 0
 */

export const DEFAULT_TTLS = {
  // Static/rarely changing data
  BOOTSTRAP_STATIC: 300, // 5 minutes

  // Live data - GW aware
  EVENT_LIVE_CURRENT: 0,
  EVENT_LIVE_PAST: -1,
  // Simple alias (used when no GW context available)
  EVENT_LIVE: 0,

  // Fixtures - GW aware via query ?event=
  FIXTURES_CURRENT: 0,
  FIXTURES_PAST: -1,
  // Simple alias
  FIXTURES: 0,

  // Manager data
  // NOTE: short TTL (60s) to reduce 429s without materially affecting live UX
  ENTRY: 60, // short cache to reduce upstream load (seconds) // Change to 0 for CRITICAL: never cache entry/{id} (contains OR/Total/etc)
  ENTRY_HISTORY_CURRENT: 60, // change to 0 if above changed to 0
  ENTRY_HISTORY_PAST: -1, // not used unless you later split history into past-only endpoint
  // Simple alias
  ENTRY_HISTORY: 60,

  // Picks
  ENTRY_EVENT_CURRENT: 0,
  // 30 days: past GW picks are immutable but we bound storage growth on this public site
  ENTRY_EVENT_PAST: 2592000,
  // Simple alias
  ENTRY_EVENT: 0,

  // Transfers
  ENTRY_TRANSFERS: 300, // 5 minutes

  // Element summary
  ELEMENT_SUMMARY: 300, // 5 minutes

  // Default fallback
  DEFAULT: 0, // CRITICAL: default to no-cache unless explicitly safe
} as const;

export function extractGWFromPath(path: string): number | null {
  const eventMatch = path.match(/event\/(\d+)/);
  if (eventMatch) return parseInt(eventMatch[1], 10);
  return null;
}

export function extractEventFromQuery(queryString: string): number | null {
  // queryString is like "?event=24" or ""
  try {
    const qs = queryString?.startsWith('?') ? queryString : `?${queryString ?? ''}`;
    const url = new URL(`https://example.invalid/${qs}`);
    const ev = url.searchParams.get('event');
    if (!ev) return null;
    const n = parseInt(ev, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Determine current GW from bootstrap-static payload.
 * This is the only safe way to avoid hardcoding.
 */
export function getCurrentGWFromBootstrap(bootstrap: any): number | null {
  const events = bootstrap?.events;
  if (!Array.isArray(events)) return null;
  const current = events.find((e: any) => e?.is_current === true);
  const id = current?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * TTL decision, GW-aware.
 *
 * queryString and currentGW are optional.  When omitted (e.g. in tests), the
 * current-GW (no-cache, TTL=0) variants are returned for live-sensitive endpoints,
 * which is the safe conservative default.
 */
export function getTTLForPath(path: string, queryString?: string, currentGW?: number): number {
  const normalizedPath = path.toLowerCase().trim();
  const gwFromPath = extractGWFromPath(normalizedPath);

  // bootstrap-static: cache briefly
  if (normalizedPath === 'bootstrap-static') {
    return DEFAULT_TTLS.BOOTSTRAP_STATIC;
  }

  // event/{gw}/live
  if (normalizedPath.match(/^event\/\d+\/live$/)) {
    if (gwFromPath === null) return DEFAULT_TTLS.DEFAULT;
    return gwFromPath < currentGW ? DEFAULT_TTLS.EVENT_LIVE_PAST : DEFAULT_TTLS.EVENT_LIVE_CURRENT;
  }

  // fixtures?event={gw}  (GW is in QUERY, not path)
  if (normalizedPath === 'fixtures') {
    const event = extractEventFromQuery(queryString);
    if (event === null) {
      // If event isn't specified, play it safe: don't cache.
      return DEFAULT_TTLS.DEFAULT;
    }
    return event < currentGW ? DEFAULT_TTLS.FIXTURES_PAST : DEFAULT_TTLS.FIXTURES_CURRENT;
  }

  // entry/{id}  (contains live-sensitive totals/ranks)
  if (normalizedPath.match(/^entry\/\d+$/)) {
    return DEFAULT_TTLS.ENTRY;
  }

  // entry/{id}/history  (contains current GW info)
  if (normalizedPath.match(/^entry\/\d+\/history$/)) {
    return DEFAULT_TTLS.ENTRY_HISTORY_CURRENT;
  }

  // entry/{id}/event/{gw}/picks (or without /picks)
  if (normalizedPath.match(/^entry\/\d+\/event\/\d+(\/picks)?$/)) {
    if (gwFromPath === null) return DEFAULT_TTLS.DEFAULT;
    return gwFromPath < currentGW ? DEFAULT_TTLS.ENTRY_EVENT_PAST : DEFAULT_TTLS.ENTRY_EVENT_CURRENT;
  }

  // entry/{id}/transfers
  if (normalizedPath.match(/^entry\/\d+\/transfers$/)) {
    return DEFAULT_TTLS.ENTRY_TRANSFERS;
  }

  // element-summary/{id}
  if (normalizedPath.match(/^element-summary\/\d+$/)) {
    return DEFAULT_TTLS.ELEMENT_SUMMARY;
  }

  // Unknown: do not cache (safe-by-default)
  return DEFAULT_TTLS.DEFAULT;
}

/**
 * Cache-buster params that are stripped before computing the KV key.
 *
 * Why: clients append e.g. `?v=<timestamp>` to break the browser/CDN cache
 * on current-GW pages.  If we include these in the KV key every unique
 * timestamp creates a brand-new entry → perpetual MISS and unbounded storage
 * growth.  Stripping them keeps keys stable while still letting meaningful
 * params (e.g. `event=10` for fixtures) influence the key.
 *
 * Force-refresh without key pollution: current-GW endpoints already have
 * TTL = 0, so they are never stored in KV regardless of the `v` param.
 * Past-GW endpoints have immutable data; their canonical (v-stripped) key
 * will produce a cache HIT, which is the desired behaviour.
 */
const CACHE_BUSTER_PARAMS = new Set(['v', '_', 't']);

export function computeCacheKey(path: string, queryString: string): string {
  const normalizedPath = path.toLowerCase().trim();
  const qs = (queryString ?? '').trim();

  // Strip cache-buster params, keep all others (e.g. event=10 for fixtures)
  let canonicalQuery = '';
  if (qs && qs !== '?') {
    const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
    for (const key of CACHE_BUSTER_PARAMS) {
      params.delete(key);
    }
    const cleaned = params.toString();
    canonicalQuery = cleaned ? `?${cleaned}` : '';
  }

  return `fpl:${normalizedPath}${canonicalQuery}`;
}

/**
 * Allowlist: only cache endpoints we have explicitly classified.
 * Note: event/live and fixtures endpoints are intentionally excluded from this
 * static allowlist to ensure live/current-GW data is always fetched fresh.
 */
export const CACHE_ALLOWLIST = new Set<string>([
  'bootstrap-static',
  'entry/*/event/*/picks',
  'entry/*/transfers',
  'element-summary/*',
]);

export function isPathAllowedForCache(path: string): boolean {
  const p = path.toLowerCase().trim();

  if (CACHE_ALLOWLIST.has(p)) return true;

  if (CACHE_ALLOWLIST.has('entry/*/event/*/picks') && p.match(/^entry\/\d+\/event\/\d+\/picks$/)) return true;
  if (CACHE_ALLOWLIST.has('entry/*/transfers') && p.match(/^entry\/\d+\/transfers$/)) return true;
  if (CACHE_ALLOWLIST.has('element-summary/*') && p.match(/^element-summary\/\d+$/)) return true;

  return false;
}

/**
 * Returns true if the HTTP response should be stored in the cache.
 * Only successful (2xx) responses are cached.
 */
export function shouldCacheResponse(response: Response): boolean {
  return response.ok;
}
