import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrSet, clearCache } from '../cache';

describe('cache - getOrSet', () => {
  let mockFetcher: ReturnType<typeof vi.fn>;
  let originalEnv: any;
  
  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Create mock fetcher
    mockFetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    
    // Reset console mocks
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });
  
  /**
   * Test: Passthrough when FPL_CACHE_ENABLED is false (default)
   */
  it('should act as passthrough when cache is disabled (default)', async () => {
    // Ensure cache is disabled (default state)
    delete process.env.FPL_CACHE_ENABLED;
    
    const key = 'test-key';
    const ttl = 60;
    
    const response = await getOrSet(key, ttl, mockFetcher);
    const data = await response.json();
    
    // Should call fetcher
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(data).toEqual({ data: 'test' });
    
    // Should not log anything when disabled
    expect(console.log).not.toHaveBeenCalled();
  });
  
  /**
   * Test: Passthrough when FPL_CACHE_ENABLED is explicitly false
   */
  it('should act as passthrough when cache is explicitly disabled', async () => {
    process.env.FPL_CACHE_ENABLED = 'false';
    
    const key = 'test-key';
    const ttl = 60;
    
    const response = await getOrSet(key, ttl, mockFetcher);
    await response.json();
    
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });
  
  /**
   * Test: Warning when cache enabled but Cloudflare cache unavailable
   */
  it('should warn and use passthrough when cache enabled but CF cache unavailable', async () => {
    process.env.FPL_CACHE_ENABLED = 'true';
    
    // Ensure caches is not available (simulating non-CF environment)
    const originalCaches = (globalThis as any).caches;
    delete (globalThis as any).caches;
    
    const key = 'test-key';
    const ttl = 60;
    
    const response = await getOrSet(key, ttl, mockFetcher);
    await response.json();
    
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Caching enabled but Cloudflare cache API not available')
    );
    
    // Restore
    (globalThis as any).caches = originalCaches;
  });
  
  /**
   * Test: Multiple calls with cache disabled always fetch
   */
  it('should fetch on every call when cache is disabled', async () => {
    delete process.env.FPL_CACHE_ENABLED;
    
    const key = 'test-key';
    const ttl = 60;
    
    // Call three times
    await getOrSet(key, ttl, mockFetcher);
    await getOrSet(key, ttl, mockFetcher);
    await getOrSet(key, ttl, mockFetcher);
    
    // Should fetch all three times
    expect(mockFetcher).toHaveBeenCalledTimes(3);
  });
  
  /**
   * Test: Fetcher errors are propagated
   */
  it('should propagate fetcher errors', async () => {
    delete process.env.FPL_CACHE_ENABLED;
    
    const error = new Error('Fetch failed');
    const failingFetcher = vi.fn().mockRejectedValue(error);
    
    await expect(getOrSet('test-key', 60, failingFetcher)).rejects.toThrow('Fetch failed');
  });
});

describe('cache - clearCache', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  /**
   * Test: clearCache returns false when cache disabled
   */
  it('should return false when cache is disabled', async () => {
    delete process.env.FPL_CACHE_ENABLED;
    
    const result = await clearCache('test-key');
    
    expect(result).toBe(false);
  });
});
