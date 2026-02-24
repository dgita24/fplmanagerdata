import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TTLS,
  getTTLForPath,
  computeCacheKey,
  shouldCacheResponse,
  isPathAllowedForCache,
} from '../cachePolicy';

describe('cachePolicy - getTTLForPath', () => {
  /**
   * Test: Bootstrap static endpoint
   */
  it('should return long TTL for bootstrap-static', () => {
    expect(getTTLForPath('bootstrap-static')).toBe(DEFAULT_TTLS.BOOTSTRAP_STATIC);
    expect(getTTLForPath('BOOTSTRAP-STATIC')).toBe(DEFAULT_TTLS.BOOTSTRAP_STATIC);
    expect(getTTLForPath(' bootstrap-static ')).toBe(DEFAULT_TTLS.BOOTSTRAP_STATIC);
  });
  
  /**
   * Test: Event live endpoints
   */
  it('should return short TTL for event live endpoints', () => {
    expect(getTTLForPath('event/10/live')).toBe(DEFAULT_TTLS.EVENT_LIVE);
    expect(getTTLForPath('event/1/live')).toBe(DEFAULT_TTLS.EVENT_LIVE);
    expect(getTTLForPath('EVENT/10/LIVE')).toBe(DEFAULT_TTLS.EVENT_LIVE);
  });
  
  /**
   * Test: Fixtures endpoints
   */
  it('should return TTL for fixtures', () => {
    expect(getTTLForPath('fixtures')).toBe(DEFAULT_TTLS.FIXTURES);
    // Query strings are handled separately via computeCacheKey, not in path
  });
  
  /**
   * Test: Entry endpoints
   */
  it('should return TTL for entry endpoints', () => {
    expect(getTTLForPath('entry/12345')).toBe(DEFAULT_TTLS.ENTRY);
    expect(getTTLForPath('entry/12345/history')).toBe(DEFAULT_TTLS.ENTRY_HISTORY);
    expect(getTTLForPath('entry/12345/event/10')).toBe(DEFAULT_TTLS.ENTRY_EVENT);
  });
  
  /**
   * Test: Element summary endpoints
   */
  it('should return TTL for element-summary', () => {
    expect(getTTLForPath('element-summary/123')).toBe(DEFAULT_TTLS.ELEMENT_SUMMARY);
    expect(getTTLForPath('ELEMENT-SUMMARY/456')).toBe(DEFAULT_TTLS.ELEMENT_SUMMARY);
  });
  
  /**
   * Test: Default TTL for unknown paths
   */
  it('should return default TTL for unknown paths', () => {
    expect(getTTLForPath('unknown/endpoint')).toBe(DEFAULT_TTLS.DEFAULT);
    expect(getTTLForPath('some/random/path')).toBe(DEFAULT_TTLS.DEFAULT);
  });
});

describe('cachePolicy - computeCacheKey', () => {
  /**
   * Test: Basic path without query
   */
  it('should compute cache key from path without query', () => {
    const key = computeCacheKey('bootstrap-static', '');
    expect(key).toBe('fpl:bootstrap-static');
  });
  
  /**
   * Test: Path with query string
   */
  it('should include query string in cache key', () => {
    const key = computeCacheKey('fixtures', '?event=10');
    expect(key).toBe('fpl:fixtures?event=10');
  });
  
  /**
   * Test: Normalization (case and whitespace)
   */
  it('should normalize path case and whitespace', () => {
    const key1 = computeCacheKey('BOOTSTRAP-STATIC', '');
    const key2 = computeCacheKey(' bootstrap-static ', '');
    expect(key1).toBe('fpl:bootstrap-static');
    expect(key2).toBe('fpl:bootstrap-static');
  });
  
  /**
   * Test: Different query strings produce different keys
   */
  it('should produce different keys for different query strings', () => {
    const key1 = computeCacheKey('fixtures', '?event=10');
    const key2 = computeCacheKey('fixtures', '?event=11');
    expect(key1).not.toBe(key2);
    expect(key1).toBe('fpl:fixtures?event=10');
    expect(key2).toBe('fpl:fixtures?event=11');
  });
});

// ─── New tests for requirements A, B, C, D ──────────────────────────────────

describe('cachePolicy - computeCacheKey canonicalization', () => {
  /**
   * Requirement A: v param is stripped from cache key, event param is kept.
   */
  it('should strip v param and keep event param', () => {
    const key = computeCacheKey('fixtures', '?event=10&v=1234567890');
    expect(key).toBe('fpl:fixtures?event=10');
  });

  it('should strip _ and t cache-buster params', () => {
    expect(computeCacheKey('fixtures', '?event=10&_=999')).toBe('fpl:fixtures?event=10');
    expect(computeCacheKey('fixtures', '?event=10&t=999')).toBe('fpl:fixtures?event=10');
  });

  it('should produce the same cache key for different v timestamps (fixtures past GW)', () => {
    const key1 = computeCacheKey('fixtures', '?event=10&v=1700000000');
    const key2 = computeCacheKey('fixtures', '?event=10&v=1799999999');
    expect(key1).toBe(key2);
    expect(key1).toBe('fpl:fixtures?event=10');
  });

  it('should produce the same cache key for different v timestamps (event live past GW)', () => {
    const key1 = computeCacheKey('event/10/live', '?v=1700000000');
    const key2 = computeCacheKey('event/10/live', '?v=1799999999');
    expect(key1).toBe(key2);
    expect(key1).toBe('fpl:event/10/live');
  });

  it('should produce the same cache key for different v timestamps (past picks)', () => {
    const key1 = computeCacheKey('entry/717348/event/8/picks', '?v=1700000000');
    const key2 = computeCacheKey('entry/717348/event/8/picks', '?v=1799999999');
    expect(key1).toBe(key2);
    expect(key1).toBe('fpl:entry/717348/event/8/picks');
  });

  it('should return empty query when only cache-buster params are present', () => {
    const key = computeCacheKey('event/10/live', '?v=123&_=456');
    expect(key).toBe('fpl:event/10/live');
  });

  it('should keep non-buster params that appear alongside v', () => {
    const key = computeCacheKey('fixtures', '?v=ts&event=5&extra=x');
    expect(key).toBe('fpl:fixtures?event=5&extra=x');
  });
});

describe('cachePolicy - TTL policy for past picks (Requirement B)', () => {
  it('picks for a past GW should use TTL of 30 days (2592000 s)', () => {
    const ttl = getTTLForPath('entry/123/event/5/picks', '', 10);
    expect(ttl).toBe(2592000);
    expect(DEFAULT_TTLS.ENTRY_EVENT_PAST).toBe(2592000);
  });

  it('picks for current GW should use TTL 0 (no-cache)', () => {
    const ttl = getTTLForPath('entry/123/event/10/picks', '', 10);
    expect(ttl).toBe(0);
    expect(DEFAULT_TTLS.ENTRY_EVENT_CURRENT).toBe(0);
  });
});

describe('cachePolicy - current GW endpoints stay fresh (Requirement C)', () => {
  it('event/live for current GW should have TTL 0', () => {
    expect(getTTLForPath('event/10/live', '', 10)).toBe(0);
  });

  it('fixtures for current GW should have TTL 0', () => {
    expect(getTTLForPath('fixtures', '?event=10', 10)).toBe(0);
  });
});

describe('cachePolicy - shouldCacheResponse', () => {
  /**
   * Test: Should cache successful responses
   */
  it('should cache successful responses (200-299)', () => {
    const response200 = new Response('{}', { status: 200 });
    const response201 = new Response('{}', { status: 201 });
    const response204 = new Response(null, { status: 204 });
    
    expect(shouldCacheResponse(response200)).toBe(true);
    expect(shouldCacheResponse(response201)).toBe(true);
    expect(shouldCacheResponse(response204)).toBe(true);
  });
  
  /**
   * Test: Should not cache client errors
   */
  it('should not cache client error responses (4xx)', () => {
    const response404 = new Response('{}', { status: 404 });
    const response400 = new Response('{}', { status: 400 });
    
    expect(shouldCacheResponse(response404)).toBe(false);
    expect(shouldCacheResponse(response400)).toBe(false);
  });
  
  /**
   * Test: Should not cache server errors
   */
  it('should not cache server error responses (5xx)', () => {
    const response500 = new Response('{}', { status: 500 });
    const response503 = new Response('{}', { status: 503 });
    
    expect(shouldCacheResponse(response500)).toBe(false);
    expect(shouldCacheResponse(response503)).toBe(false);
  });
  
  /**
   * Test: Should not cache redirects
   */
  it('should not cache redirect responses (3xx)', () => {
    const response301 = new Response('{}', { status: 301 });
    const response302 = new Response('{}', { status: 302 });
    
    expect(shouldCacheResponse(response301)).toBe(false);
    expect(shouldCacheResponse(response302)).toBe(false);
  });
});

describe('cachePolicy - isPathAllowedForCache', () => {
  /**
   * Test: Bootstrap-static is in initial allowlist
   */
  it('should allow bootstrap-static in initial allowlist', () => {
    expect(isPathAllowedForCache('bootstrap-static')).toBe(true);
    expect(isPathAllowedForCache('BOOTSTRAP-STATIC')).toBe(true);
    expect(isPathAllowedForCache(' bootstrap-static ')).toBe(true);
  });
  
  /**
   * Test: Other endpoints not in initial allowlist
   */
  it('should not allow endpoints not in allowlist', () => {
    expect(isPathAllowedForCache('event/10/live')).toBe(false);
    expect(isPathAllowedForCache('fixtures')).toBe(false);
    expect(isPathAllowedForCache('entry/12345')).toBe(false);
  });
  
  /**
   * Test: Unknown paths not allowed
   */
  it('should not allow unknown paths', () => {
    expect(isPathAllowedForCache('unknown/path')).toBe(false);
    expect(isPathAllowedForCache('random/endpoint')).toBe(false);
  });
});
