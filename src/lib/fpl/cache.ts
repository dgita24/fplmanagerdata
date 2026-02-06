/**
 * KV-based cache wrapper for FPL API responses (Cloudflare Pages-safe)
 *
 * This version is designed for:
 * - Cloudflare Pages Functions / Astro SSR
 * - Deterministic debugging via headers (key/env/status)
 * - Correct KV persistence (awaits kv.put)
 *
 * Headers added:
 * - X-Cache-Status: HIT | MISS | SKIP | BYPASS | NO_KV | MISS_NO_STORE | ERROR
 * - X-Cache-Env: flag=<true|false|unset>;kv=<present|missing>;ttl=<n>
 * - X-Cache-Key: <final KV key used>
 */

type AnyEnv = Record<string, any>;

function readFlag(env: AnyEnv | undefined, name: string): string | undefined {
  const fromPlatformEnv = env?.[name];
  const fromProcessEnv = (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  const v = (fromPlatformEnv ?? fromProcessEnv) as unknown;

  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return undefined;
}

function isCacheEnabled(env: AnyEnv | undefined): boolean {
  return readFlag(env, 'FPL_CACHE_ENABLED') === 'true';
}

function getKV(env: AnyEnv | undefined): KVNamespace | null {
  const kv = env?.FPL_CACHE as KVNamespace | undefined;
  if (!kv) return null;

  // Minimal sanity check
  if (typeof (kv as any).get !== 'function') return null;
  if (typeof (kv as any).put !== 'function') return null;

  return kv;
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

export async function getOrSet(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<Response>,
  env?: AnyEnv
): Promise<Response> {
  const flag = readFlag(env, 'FPL_CACHE_ENABLED') ?? 'unset';
  const kvPresent = env?.FPL_CACHE ? 'present' : 'missing';
  const envDebug = `flag=${flag};kv=${kvPresent};ttl=${ttlSeconds}`;

  // Rule: TTL=0 means "never cache" (live-sensitive)
  if (ttlSeconds === 0) {
    const res = await fetcher();
    return withHeaders(res, {
      'X-Cache-Status': 'SKIP',
      'X-Cache-Env': envDebug,
      'X-Cache-Key': key,
    });
  }

  // If feature flag is off, passthrough
  if (!isCacheEnabled(env)) {
    const res = await fetcher();
    return withHeaders(res, {
      'X-Cache-Status': 'BYPASS',
      'X-Cache-Env': envDebug,
      'X-Cache-Key': key,
    });
  }

  const kv = getKV(env);
  if (!kv) {
    const res = await fetcher();
    return withHeaders(res, {
      'X-Cache-Status': 'NO_KV',
      'X-Cache-Env': envDebug,
      'X-Cache-Key': key,
    });
  }

  try {
    // READ
    const cached = await kv.get(key, { type: 'text' });

    if (cached) {
      // Return cached payload as-is (must be JSON text)
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Cache-Status': 'HIT',
          'X-Cache-Env': envDebug,
          'X-Cache-Key': key,
        },
      });
    }

    // MISS -> fetch upstream
    const upstream = await fetcher();

    // Only cache successful responses
    if (upstream.ok) {
      const text = await upstream.clone().text();

      // WRITE (awaited so it must persist, and errors will be caught)
      if (ttlSeconds > 0) {
        await kv.put(key, text, { expirationTtl: ttlSeconds });
      } else {
        // ttlSeconds < 0 means "cache forever" (no expiration)
        await kv.put(key, text);
      }

      return withHeaders(upstream, {
        'X-Cache-Status': 'MISS',
        'X-Cache-Env': envDebug,
        'X-Cache-Key': key,
      });
    }

    // Upstream not ok -> don’t cache
    return withHeaders(upstream, {
      'X-Cache-Status': 'MISS_NO_STORE',
      'X-Cache-Env': envDebug,
      'X-Cache-Key': key,
    });
  } catch (err: any) {
    console.error('[CACHE] KV error:', err);
    const res = await fetcher();
    return withHeaders(res, {
      'X-Cache-Status': 'ERROR',
      'X-Cache-Env': envDebug,
      'X-Cache-Key': key,
    });
  }
}
