/**
 * Client-side caching utility for FPL bootstrap-static data
 * 
 * This module provides localStorage-based caching to reduce redundant API calls
 * to the /api/fpl/bootstrap-static endpoint. Data is cached with a timestamp
 * and can be force-refreshed when needed.
 */

const CACHE_KEY = 'fpl_bootstrap_data';
const CACHE_TIMESTAMP_KEY = 'fpl_bootstrap_timestamp';
// Cache for 1 hour (in milliseconds)
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * Fetches bootstrap-static data with caching support.
 * Uses localStorage to cache data and reduce network requests.
 * 
 * @param forceReload - If true, bypasses cache and fetches fresh data
 * @returns Promise resolving to bootstrap data or null on error
 */
export async function getBootstrapData(forceReload: boolean = false): Promise<any> {
  try {
    // Check if we should use cached data
    if (!forceReload) {
      const cachedData = localStorage.getItem(CACHE_KEY);
      const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      
      if (cachedData && cachedTimestamp) {
        const timestamp = parseInt(cachedTimestamp, 10);
        const age = Date.now() - timestamp;
        
        // Use cached data if it's still fresh
        if (age < CACHE_DURATION) {
          console.log('Using cached bootstrap data');
          return JSON.parse(cachedData);
        }
      }
    }
    
    // Fetch fresh data
    console.log('Fetching fresh bootstrap data');
    const res = await fetch('/api/fpl/bootstrap-static');
    
    if (!res.ok) {
      throw new Error(`Failed to fetch bootstrap data: ${res.status}`);
    }
    
    const data = await res.json();
    
    // Cache the fresh data
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    return data;
  } catch (error) {
    console.error('Error fetching bootstrap data:', error);
    return null;
  }
}

/**
 * Clears the bootstrap data cache.
 * Useful for manual cache invalidation or testing.
 */
export function clearBootstrapCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TIMESTAMP_KEY);
  console.log('Bootstrap cache cleared');
}
