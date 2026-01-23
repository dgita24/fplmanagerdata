export const prerender = false;

// Usage: /api/manager.json?id=XXXXX
export async function GET({ url }) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid manager id" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Official FPL API URL for a manager summary
  const apiUrl = `https://fantasy.premierleague.com/api/entry/${id}/`;

  const res = await fetch(apiUrl, {
    headers: { "User-Agent": "fpl-site/1.0", "Accept": "application/json" },
  });

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream error: ${res.status}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "s-maxage=60",
    },
  });
}
