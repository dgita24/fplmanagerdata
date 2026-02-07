import { getOrSet } from '../../../lib/fpl/cache';
import {
  computeCacheKey,
  getTTLForPath,
  isPathAllowedForCache,
  getCurrentGWFromBootstrap,
} from '../../../lib/fpl/cachePolicy';

export const prerender = false;

function pickEnv(ctx: any) {
  // Try every known place Astro/Cloudflare may expose env/bindings.
  const candidates: Array<{ name: string; env: any }> = [
    { name: 'platform.env', env: ctx?.platform?.env },
    { name: 'locals.runtime.env', env: ctx?.locals?.runtime?.env },
    { name: 'locals.env', env: ctx?.locals?.env },
    { name: 'runtime.env', env: ctx?.runtime?.env },
  ];

  for (const c of candidates) {
    if (c.env && typeof c.env === 'object') {
      return { env: c.env, source: c.name };
    }
  }
  return { env: undefined, source: 'none' };
}

export async function GET(ctx: any) {
  const { params, url } = ctx;
  const { path } = params;

  const fplPath = path || '';
  const target = `https://fantasy.premierleague.com/api/${fplPath}${url.search}`;

  const { env, source } = pickEnv(ctx);

  const markProxy = (res: Response) => {
    res.headers.set('X-FPL-Proxy', '1');
    res.headers.set('X-Env-Source', source);
    // Prove what keys exist (safe: only shows whether names exist, not secrets)
    res.headers.set('X-Env-Has', `FPL_CACHE=${env?.FPL_CACHE ? 'yes' : 'no'};FPL_CACHE_ENABLED=${env?.FPL_CACHE_ENABLED ? 'yes' : 'no'}`);
    return res;
  };

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
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  };

  if (!useCache) {
    return markProxy(await fetcher());
  }

  // Determine current GW dynamically (fail-safe)
  let currentGW: number | null = null;
  try {
    const bootstrapRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { "User-Agent": "fpl-site/1.0", "Accept": "application/json" },
    });

    if (bootstrapRes.ok) {
      const bootstrap = await bootstrapRes.json();
      currentGW = getCurrentGWFromBootstrap(bootstrap);
    }
  } catch {
    currentGW = null;
  }

  if (currentGW === null) {
    const res = await fetcher();
    res.headers.set('X-Cache-Status', 'BYPASS_NO_GW');
    return markProxy(res);
  }

  const cacheKey = computeCacheKey(fplPath, url.search);
  const ttl = getTTLForPath(fplPath, url.search, currentGW);

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
      "X-FPL-Proxy": "1",
    },
  });
}
