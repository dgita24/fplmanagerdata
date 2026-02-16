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

  // Fixtures - GW aware via query ?event=
  FIXTURES_CURRENT: 0,
  FIXTURES_PAST: -1,

  // Manager data
  // NOTE: short TTL (30s) to reduce 429s without materially affecting live UX
  ENTRY: 30, // short cache to reduce upstream load (seconds) // Change to 0 for CRITICAL: never cache entry/{id} (contains OR/Total/etc)
  ENTRY_HISTORY_CURRENT: 30, // change to 0 if above changed to 0
  ENTRY_HISTORY_PAST: -1, // not used unless you later split history into past-only endpoint

  // Picks
  ENTRY_EVENT_CURRENT: 0,
  ENTRY_EVENT_PAST: -1,

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
 * IMPORTANT: takes queryString so fixtures can be correct.
 */
export function getTTLForPath(path: string, queryString: string, currentGW: number): number {
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

export function computeCacheKey(path: string, queryString: string): string {
  const normalizedPath = path.toLowerCase().trim();
  let normalizedQuery = (queryString ?? '').trim();
  
  // NORMALIZE: Treat "?" (empty query) same as "" (empty string)
  if (normalizedQuery === '?') {
    normalizedQuery = '';
  }

  return `fpl:${normalizedPath}${normalizedQuery}`;
}

/**
 * Allowlist: only cache endpoints we have explicitly classified.
 */
export const CACHE_ALLOWLIST = new Set<string>([
  'bootstrap-static',
  'event/*/live',
  'fixtures',
  'entry/*/event/*/picks',
  'entry/*/transfers',
  'element-summary/*',
]);

export function isPathAllowedForCache(path: string): boolean {
  const p = path.toLowerCase().trim();

  if (CACHE_ALLOWLIST.has(p)) return true;

  if (CACHE_ALLOWLIST.has('event/*/live') && p.match(/^event\/\d+\/live$/)) return true;
  if (CACHE_ALLOWLIST.has('fixtures') && p === 'fixtures') return true;
  if (CACHE_ALLOWLIST.has('entry/*/event/*/picks') && p.match(/^entry\/\d+\/event\/\d+\/picks$/)) return true;
  if (CACHE_ALLOWLIST.has('entry/*/transfers') && p.match(/^entry\/\d+\/transfers$/)) return true;
  if (CACHE_ALLOWLIST.has('element-summary/*') && p.match(/^element-summary\/\d+$/)) return true;

  return false;
}
