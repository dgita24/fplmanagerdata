const CACHE_IMPL_VERSION = "2026-02-06-v3";

type AnyEnv = Record<string, any>;

function readFlag(env: AnyEnv | undefined, name: string): string | undefined {
  const fromEnv = env?.[name];
  const fromProcess = (typeof process !== "undefined" ? process.env?.[name] : undefined);
  const v = (fromEnv ?? fromProcess) as any;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return undefined;
}

function isCacheEnabled(env: AnyEnv | undefined): boolean {
  return readFlag(env, "FPL_CACHE_ENABLED") === "true";
}

function getKV(env: AnyEnv | undefined): KVNamespace | null {
  const kv = env?.FPL_CACHE as KVNamespace | undefined;
  if (!kv) return null;
  if (typeof (kv as any).get !== "function") return null;
  if (typeof (kv as any).put !== "function") return null;
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

  const baseHeaders = {
    "X-Cache-Impl": CACHE_IMPL_VERSION,
    "X-Cache-Env": envDebug,
    "X-Cache-Key": key,
  };

  // TTL=0 => never cache
  if (ttlSeconds === 0) {
    const res = await fetcher();
    return withHeaders(res, { ...baseHeaders, "X-Cache-Status": "SKIP" });
  }

  if (!isCacheEnabled(env)) {
    const res = await fetcher();
    return withHeaders(res, { ...baseHeaders, "X-Cache-Status": "BYPASS" });
  }

  const kv = getKV(env);
  if (!kv) {
    const res = await fetcher();
    return withHeaders(res, { ...baseHeaders, "X-Cache-Status": "NO_KV" });
  }

  try {
    const cached = await kv.get(key, { type: "text" });
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...baseHeaders,
          "X-Cache-Status": "HIT",
        },
      });
    }

    const upstream = await fetcher();

    if (upstream.ok) {
      const text = await upstream.clone().text();

      // IMPORTANT: awaited write
      if (ttlSeconds > 0) {
        await kv.put(key, text, { expirationTtl: ttlSeconds });
      } else {
        await kv.put(key, text);
      }

      return withHeaders(upstream, { ...baseHeaders, "X-Cache-Status": "MISS" });
    }

    return withHeaders(upstream, { ...baseHeaders, "X-Cache-Status": "MISS_NO_STORE" });
  } catch (err) {
    console.error("[CACHE] KV error:", err);
    const res = await fetcher();
    return withHeaders(res, { ...baseHeaders, "X-Cache-Status": "ERROR" });
  }
}
