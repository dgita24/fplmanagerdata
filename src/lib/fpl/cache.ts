/**
 * KV-based cache wrapper for FPL API responses (Cloudflare Pages-safe)
 *
 * Guarantees:
 * - If caching is disabled or KV missing, behaves as passthrough.
 * - TTL=0 always bypasses cache (live-sensitive).
 * - Adds X-Cache-Status + X-Cache-Env for runtime verification.
 */

type AnyEnv = Record<string, any>;

function readFlag(env: AnyEnv | undefined, name: string): string | undefined {
  const fromPlatformEnv = env?.[name];
  const fromProcessEnv = (typeof process !== "undefined" ? process.env?.[name] : undefined);
  const v = (fromPlatformEnv ?? fromProcessEnv) as any;
  return typeof v === "string" ? v : undefined;
}

function isCacheEnabled(env: AnyEnv | undefined): boolean {
  return readFlag(env, "FPL_CACHE_ENABLED") === "true";
}

function getKV(env: AnyEnv | undefined): KVNamespace | null {
  const kv = env?.FPL_CACHE as KVNamespace | undefined;
  if (!kv) return null;
  if (typeof (kv as any).get !== "function" || typeof (kv as any).put !== "function") return null;
  return kv;
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function getOrSet(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<Response>,
  env?: AnyEnv
): Promise<Response> {
  const flag = readFlag(env, "FPL_CACHE_ENABLED") ?? "unset";
  const kvPresent = env?.FPL_CACHE ? "present" : "missing";
  const envDebug = `flag=${flag};kv=${kvPresent};ttl=${ttlSeconds}`;

  // Never cache live-sensitive requests
  if (ttlSeconds === 0) {
    const res = await fetcher();
    return withHeaders(res, { "X-Cache-Status": "SKIP", "X-Cache-Env": envDebug });
  }

  // If not enabled, passthrough
  if (!isCacheEnabled(env)) {
    const res = await fetcher();
    return withHeaders(res, { "X-Cache-Status": "BYPASS", "X-Cache-Env": envDebug });
  }

  const kv = getKV(env);
  if (!kv) {
    const res = await fetcher();
    return withHeaders(res, { "X-Cache-Status": "NO_KV", "X-Cache-Env": envDebug });
  }

  try {
    const cached = await kv.get(key, { type: "text" });
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Cache-Status": "HIT",
          "X-Cache-Env": envDebug,
        },
      });
    }

    const upstream = await fetcher();

    // Only cache successful responses
    if (upstream.ok) {
      const text = await upstream.clone().text();

      // ttlSeconds < 0 means "forever" in your policy -> KV put with no expiration
      if (ttlSeconds > 0) {
        await kv.put(key, text, { expirationTtl: ttlSeconds });
      } else {
        await kv.put(key, text);
      }

      return withHeaders(upstream, { "X-Cache-Status": "MISS", "X-Cache-Env": envDebug });
    }

    return withHeaders(upstream, { "X-Cache-Status": "MISS_NO_STORE", "X-Cache-Env": envDebug });
  } catch (err) {
    console.error("[CACHE] KV error:", err);
    const res = await fetcher();
    return withHeaders(res, { "X-Cache-Status": "ERROR", "X-Cache-Env": envDebug });
  }
}
