export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // CORS preflight
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

  // Remove "/api/fpl" prefix
  const fplPath = url.pathname.replace(/^\/api\/fpl/, "");
  const target = `https://fantasy.premierleague.com/api${fplPath}${url.search}`;

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

  const ct = res.headers.get("Content-Type");
  if (ct) newRes.headers.set("Content-Type", ct);

  return newRes;
}
