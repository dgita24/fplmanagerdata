import type { APIRoute } from "astro";

type StandingRow = {
  rank: number;
  entryId: number;
  entryName: string;
  playerName?: string | null;
  total: number;
  eventTotal: number;
};

export const GET: APIRoute = async ({ params, url }) => {
  const leagueId = params.leagueId;
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return new Response(JSON.stringify({ error: "Invalid leagueId" }), { status: 400 });
  }

  const page = url.searchParams.get("page") || "1";

  const upstream = `https://fantasy.premierleague.com/api/leagues-h2h/${leagueId}/standings/?page_standings=${encodeURIComponent(page)}`;
  const res = await fetch(upstream, { headers: { "accept": "application/json" } });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Upstream error", status: res.status }), { status: 502 });
  }

  const data = await res.json();

  const results = Array.isArray(data?.standings?.results) ? data.standings.results : [];
  const rows: StandingRow[] = results.map((r: any) => ({
    rank: Number(r.rank),
    entryId: Number(r.entry),
    entryName: String(r.entry_name ?? ""),
    playerName: r.player_name ? String(r.player_name) : null,
    total: Number(r.total ?? 0),
    // H2H leagues use `points_for` for the GW score; classic leagues use `event_total`.
    eventTotal: Number(r.points_for ?? r.event_total ?? 0),
  }));

  return new Response(
    JSON.stringify({
      league: { id: Number(leagueId), name: data?.league?.name ?? null },
      page: Number(page),
      hasNext: Boolean(data?.standings?.has_next),
      hasPrev: Boolean(data?.standings?.has_previous),
      results: rows,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
