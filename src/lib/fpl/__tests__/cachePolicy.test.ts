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
    expect(getTTLForPath('fixtures?event=10')).toBe(DEFAULT_TTLS.FIXTURES);
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
