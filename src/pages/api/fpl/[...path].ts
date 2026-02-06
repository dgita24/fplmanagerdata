import { getOrSet } from '../../../lib/fpl/cache';
import {
  computeCacheKey,
  getTTLForPath,
  isPathAllowedForCache,
  getCurrentGWFromBootstrap,
} from '../../../lib/fpl/cachePolicy';

export const prerender = false;

export async function GET({ params, url, platform }) {
  const { path } = params;

  const fplPath = path || '';
  const target = `https://fantasy.premierleague.com/api/${fplPath}${url.search}`;

  // Determine if this path is even eligible for caching
  const useCache = isPathAllowedForCache(fplPath);

  const fetcher = async (): Promise<Response> => {
    const res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `FPL API error: ${res.status}` }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  };

  if (!useCache) {
    return await fetcher();
  }

  // --- CRITICAL: derive currentGW dynamically (no hardcoding) ---
  // We do this by calling bootstrap-static and extracting events[].is_current.
  // This ensures "current GW never cached" cannot silently break.
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
    // If we cannot determine currentGW, fail SAFE: treat as no-cache.
    currentGW = null;
  }

  // Fail safe: if currentGW unknown, do not cache anything (live-safety > perf)
  if (currentGW === null) {
    return await fetcher();
  }

  const cacheKey = computeCacheKey(fplPath, url.search);
  const ttl = getTTLForPath(fplPath, url.search, currentGW);

  // IMPORTANT: do not cache when ttl=0 (your getOrSet respects ttl=0 as SKIP)
  const env = platform?.env;
  return await getOrSet(cacheKey, ttl, fetcher, env);
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
