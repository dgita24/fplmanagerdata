export const prerender = false;

export async function GET() {
  const url = "https://fantasy.premierleague.com/api/bootstrap-static/";
  const res = await fetch(url, {
    headers: { "User-Agent": "fpl-site/1.0", "Accept": "application/json" },
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: `Upstream error: ${res.status}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "s-maxage=60",
    },
  });
}
