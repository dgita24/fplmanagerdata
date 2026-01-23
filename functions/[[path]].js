export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
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

  // Only proxy requests starting with /api/fpl
  if (!url.pathname.startsWith('/api/fpl')) {
    return new Response('Not found', { status: 404 });
  }

  // Remove "/api/fpl" prefix to get the FPL API path
  const fplPath = url.pathname.replace(/^\/api\/fpl/, '');
  const target = `https://fantasy.premierleague.com/api${fplPath}${url.search}`;

  console.log(`Proxying: ${url.pathname} → ${target}`);

  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    });

    const newRes = new Response(res.body, res);
    newRes.headers.set("Access-Control-Allow-Origin", "*");
    newRes.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    newRes.headers.set("Access-Control-Allow-Headers", "Content-Type");

    return newRes;
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy failed' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}