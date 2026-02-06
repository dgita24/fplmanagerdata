import { getOrSet } from '../../../lib/fpl/cache';
import {
  computeCacheKey,
  getTTLForPath,
  isPathAllowedForCache,
  getCurrentGWFromBootstrap,
} from '../../../lib/fpl/cachePolicy';

export const prerender = false;

export async function GET({ params, url, platform }: any) {
  const { path } = params;

  // Build the FPL API path from the URL segments
  const fplPath = path || '';
  const target = `https://fantasy.premierleague.com/api/${fplPath}${url.search}`;

  // Always mark responses so we can prove this route executed in production
  const markProxy = (res: Response) => {
    res.headers.set('X-FPL-Proxy', '1');
    return res;
  };

  // Determine if this path should use caching (allowlist)
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

  // If not eligible for caching, just proxy
  if (!useCache) {
    return markProxy(await fetcher());
  }

  // --- Determine currentGW dynamically (FAIL-SAFE) ---
  // If we cannot determine currentGW, we will not cache anything (live-safety > perf).
  let currentGW: number | null = null;
  try {
    const bootstrapRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { "User-Agent": "fpl-site/1.0", "Accept": "application/json" },
    });

    if (bootstrapRes.ok) {
      const bootstrap = await bootstrapRes.json();
      currentGW = getCurrentGWFromBootstrap(bootstrap);
    }
  } catch (e) {
    console.error('[CACHE] Failed to fetch bootstrap-static for currentGW:', e);
    currentGW = null;
  }

  // Fail-safe: if currentGW unknown, never cache
  if (currentGW === null) {
    const res = await fetcher();
    res.headers.set('X-Cache-Status', 'BYPASS_NO_GW');
    return markProxy(res);
  }

  const cacheKey = computeCacheKey(fplPath, url.search);
  const ttl = getTTLForPath(fplPath, url.search, currentGW);

  // Pass Cloudflare environment (contains KV binding + env vars)
  const env = platform?.env;

  const res = await getOrSet(cacheKey, ttl, fetcher, env);
  return markProxy(res);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      // Prove OPTIONS is served by this route too
      "X-FPL-Proxy": "1",
    },
  });
}
