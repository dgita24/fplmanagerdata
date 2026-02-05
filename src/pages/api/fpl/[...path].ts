import { getOrSet } from '../../../lib/fpl/cache';
import { computeCacheKey, getTTLForPath, isPathAllowedForCache } from '../../../lib/fpl/cachePolicy';

export const prerender = false;

export async function GET({ params, url, locals }) {
  const { path } = params;

  // TEMPORARY: Return diagnostic info for bootstrap-static only
  if (path === 'bootstrap-static') {
    const diagnostics = {
      debug: 'Environment diagnostic',
      locals_exists: !!locals,
      locals_keys: locals ? Object.keys(locals) : [],
      runtime_exists: !!locals?.runtime,
      runtime_keys: locals?.runtime ? Object.keys(locals.runtime) : [],
      env_exists: !!locals?.runtime?.env,
      env_keys: locals?.runtime?.env ? Object.keys(locals.runtime.env) : [],
      FPL_CACHE_ENABLED: locals?.runtime?.env?.FPL_CACHE_ENABLED,
      import_meta_env: import.meta.env,
    };
    
    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

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
          "Cache-Control": "public, s-maxage=60",
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
    return await getOrSet(cacheKey, ttl, fetcher, locals?.runtime?.env);
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