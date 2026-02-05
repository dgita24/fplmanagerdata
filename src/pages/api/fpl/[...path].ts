import { getOrSet } from '../../../lib/fpl/cache';
import { computeCacheKey, getTTLForPath, isPathAllowedForCache } from '../../../lib/fpl/cachePolicy';

export const prerender = false;

export async function GET({ params, url, platform }) {
  const { path } = params;
  
  // Build the FPL API path from the URL segments
  const fplPath = path || '';
  const target = `https://fantasy.premierleague.com/api/${fplPath}${url.search}`;

  console.log(`Proxying: ${url.pathname} → ${target}`);

  // Determine if this path should use caching
  const useCache = isPathAllowedForCache(fplPath);
  
  // Create the fetcher function that contains the original proxy logic
  const fetcher = async (): Promise<Response> => {
    try {
      const res = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: `FPL API error: ${res.status}` }), 
          {
            status: res.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const data = await res.json();
      
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.error('Proxy error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch from FPL API' }), 
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  // Route through cache if enabled and path is allowlisted, otherwise direct fetch
  if (useCache) {
    const cacheKey = computeCacheKey(fplPath, url.search);
    const ttl = getTTLForPath(fplPath);
    
    // Pass Cloudflare environment (contains KV binding)
    const env = platform?.env || {};
    
    return await getOrSet(cacheKey, ttl, fetcher, env);
  } else {
    return await fetcher();
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}