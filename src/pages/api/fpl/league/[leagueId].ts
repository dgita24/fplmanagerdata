import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ params }) => {
  const leagueId = params.leagueId;
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return new Response(JSON.stringify({ error: "Invalid leagueId" }), { status: 400 });
  }

  const url = `https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`;
  const res = await fetch(url, {
    headers: { "accept": "application/json" },
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Upstream error", status: res.status }), { status: 502 });
  }

  const data = await res.json();
  const leagueName = data?.league?.name ?? null;

  return new Response(
    JSON.stringify({
      leagueId: Number(leagueId),
      leagueName,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
