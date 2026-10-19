import {
  getAuthorizedManagerIds,
  getBearerToken,
  getSupabaseConfig,
  getSupabaseUser,
  json,
  mapWithConcurrency,
  type RouteContext,
} from '../../../lib/privateExportAuth'

export const prerender = false

const FETCH_CONCURRENCY = 4

async function fetchJson(url: string): Promise<{ ok: true; data: any } | { ok: false }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false }
    return { ok: true, data: await res.json() }
  } catch {
    return { ok: false }
  }
}

function csvCell(value: string | number): string {
  const str = String(value)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export async function GET(ctx: RouteContext) {
  const { request, url } = ctx
  const config = getSupabaseConfig(ctx)
  if (!config) return json({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)

  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing bearer token' }, 401)

  const user = await getSupabaseUser(token, config)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  try {
    let managerIds: number[] = []
    try {
      managerIds = await getAuthorizedManagerIds(user.id, token, config)
    } catch (error) {
      if ((error as Error)?.message === 'ACCESS_DENIED') return json({ error: 'Access denied' }, 403)
      throw error
    }

    const teamId = Number(url.searchParams.get('team_id'))
    const count = Number(url.searchParams.get('count'))
    const mode = url.searchParams.get('mode') === 'atleast' ? 'atleast' : 'exact'

    if (!Number.isInteger(teamId) || teamId <= 0) return json({ error: 'Invalid team_id' }, 400)
    if (!Number.isInteger(count) || count < 1 || count > 3) return json({ error: 'count must be 1, 2 or 3' }, 400)

    const origin = url.origin
    const bootstrap = await fetchJson(`${origin}/api/fpl/bootstrap-static`)
    if (!bootstrap.ok) return json({ error: 'Failed to load bootstrap data' }, 502)

    const teams: any[] = Array.isArray(bootstrap.data?.teams) ? bootstrap.data.teams : []
    const events: any[] = Array.isArray(bootstrap.data?.events) ? bootstrap.data.events : []
    const team = teams.find((t) => Number(t?.id) === teamId)
    if (!team) return json({ error: 'Club not found' }, 400)

    const currentEvent = events.find((e) => e?.is_current) || events.find((e) => e?.is_next)
    const gw = Number(currentEvent?.id)
    if (!Number.isFinite(gw) || gw <= 0) return json({ error: 'Could not determine current gameweek' }, 502)

    const clubPlayers = new Map<number, string>()
    for (const el of bootstrap.data?.elements ?? []) {
      if (Number(el?.team) === teamId) clubPlayers.set(Number(el.id), String(el.web_name))
    }

    const results = await mapWithConcurrency(managerIds, FETCH_CONCURRENCY, async (entryId) => {
      const [summary, picks] = await Promise.all([
        fetchJson(`${origin}/api/fpl/entry/${entryId}/`),
        fetchJson(`${origin}/api/fpl/entry/${entryId}/event/${gw}/picks/`),
      ])
      if (!summary.ok || !picks.ok) return null

      const owned = (Array.isArray(picks.data?.picks) ? picks.data.picks : [])
        .map((p: any) => Number(p?.element))
        .filter((id: number) => clubPlayers.has(id))
      const uniq: number[] = [...new Set<number>(owned)]

      const matches = mode === 'atleast' ? uniq.length >= count : uniq.length === count
      if (!matches) return null

      return {
        entry_id: entryId,
        manager_name:
          `${summary.data?.player_first_name || ''} ${summary.data?.player_last_name || ''}`.trim() || `Entry ${entryId}`,
        team_name: String(summary.data?.name || '-'),
        club_player_count: uniq.length,
        players: uniq.map((id) => clubPlayers.get(id) as string).sort(),
      }
    })

    const rows = results
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.club_player_count - a.club_player_count || a.manager_name.localeCompare(b.manager_name))

    if (url.searchParams.get('format') === 'csv') {
      const header = ['entry_id', 'manager_name', 'team_name', 'club', 'club_player_count', 'players']
      const lines = rows.map((r) =>
        [r.entry_id, r.manager_name, r.team_name, team.name, r.club_player_count, r.players.join('; ')]
          .map(csvCell)
          .join(',')
      )
      return new Response([header.join(','), ...lines].join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="manager-club-ownership.csv"',
        },
      })
    }

    return json({
      generated_at: new Date().toISOString(),
      gameweek: gw,
      club: team.name,
      count,
      mode,
      manager_count_scanned: managerIds.length,
      match_count: rows.length,
      rows,
    })
  } catch (error) {
    console.error('[manager-club-ownership] request failed', error)
    return json({ error: 'Failed to load club ownership export' }, 500)
  }
}
