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

type BootstrapElement = {
  id?: number
  web_name?: string
  first_name?: string
  second_name?: string
}

type PicksResponse = {
  picks?: Array<{
    element?: number
    multiplier?: number
  }>
  entry_history?: {
    event?: number
  }
}

type ManagerSummaryResponse = {
  id?: number
  name?: string // team name
  player_first_name?: string
  player_last_name?: string
  summary_event_points?: number
  summary_overall_points?: number
}

type ResolvedPlayer = {
  id: number
  web_name: string
  full_name: string
}

type ManagerMatch = {
  entry_id: number
  manager_name: string
  team_name: string
  owns_all_selected_players: boolean
  matched_player_ids: number[]
  matched_player_names: string[]
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

function buildCsv(
  selectedPlayers: ResolvedPlayer[],
  rows: ManagerMatch[]
): string {
  const header = [
    'entry_id',
    'manager_name',
    'team_name',
    'owns_all_selected_players',
    'matched_player_ids',
    'matched_player_names',
    'selected_player_ids',
    'selected_player_names',
  ]

  const selectedIds = selectedPlayers.map((p) => p.id).join(';')
  const selectedNames = selectedPlayers.map((p) => p.web_name).join(';')

  const lines = rows.map((row) =>
    [
      row.entry_id,
      row.manager_name,
      row.team_name,
      row.owns_all_selected_players,
      row.matched_player_ids.join(';'),
      row.matched_player_names.join(';'),
      selectedIds,
      selectedNames,
    ]
      .map(csvCell)
      .join(',')
  )

  return [header.join(','), ...lines].join('\n')
}

async function fetchJson(url: string): Promise<{ ok: true; data: any } | { ok: false; status?: number }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, data: await res.json() }
  } catch {
    return { ok: false }
  }
}

function resolveSelectedPlayers(
  elements: BootstrapElement[],
  idsParam: string | null,
  namesParam: string | null
): { players: ResolvedPlayer[]; unresolvedNames: string[] } {
  const byId = new Map<number, ResolvedPlayer>()
  const byName = new Map<string, ResolvedPlayer>()

  for (const el of elements) {
    const id = Number(el?.id)
    if (!Number.isFinite(id)) continue
    const webName = String(el?.web_name || '').trim()
    const fullName = `${String(el?.first_name || '').trim()} ${String(el?.second_name || '').trim()}`.trim()
    const resolved: ResolvedPlayer = {
      id,
      web_name: webName || fullName || `Player ${id}`,
      full_name: fullName || webName || `Player ${id}`,
    }
    byId.set(id, resolved)

    if (webName) byName.set(normalize(webName), resolved)
    if (fullName) byName.set(normalize(fullName), resolved)
  }

  const selected = new Map<number, ResolvedPlayer>()
  const unresolvedNames: string[] = []

  if (idsParam) {
    const ids = idsParam
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0)

    for (const id of ids) {
      const found = byId.get(id)
      if (found) selected.set(found.id, found)
    }
  }

  if (namesParam) {
    const names = namesParam
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)

    for (const name of names) {
      const found = byName.get(normalize(name))
      if (found) {
        selected.set(found.id, found)
      } else {
        unresolvedNames.push(name)
      }
    }
  }

  return {
    players: [...selected.values()].sort((a, b) => a.web_name.localeCompare(b.web_name)),
    unresolvedNames,
  }
}

async function getCurrentGw(origin: string): Promise<number | null> {
  const res = await fetchJson(`${origin}/api/fpl/bootstrap-static`)
  if (!res.ok) return null

  const events = Array.isArray(res.data?.events) ? res.data.events : []
  const current = events.find((e: any) => e?.is_current) || events.find((e: any) => e?.is_next)
  const gw = Number(current?.id)
  if (!Number.isFinite(gw) || gw <= 0) return null
  return gw
}

export async function GET(ctx: RouteContext) {
  const { request, url } = ctx
  const config = getSupabaseConfig(ctx)
  if (!config) {
    return json({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)
  }

  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing bearer token' }, 401)

  const user = await getSupabaseUser(token, config)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  try {
    let managerIds: number[] = []
    try {
      managerIds = await getAuthorizedManagerIds(user.id, token, config)
    } catch (error) {
      if ((error as Error)?.message === 'ACCESS_DENIED') {
        return json({ error: 'Access denied' }, 403)
      }
      throw error
    }

    const origin = url.origin

    const bootstrapRes = await fetchJson(`${origin}/api/fpl/bootstrap-static`)
    if (!bootstrapRes.ok) {
      return json({ error: 'Failed to load bootstrap data' }, 502)
    }

    const elements: BootstrapElement[] = Array.isArray(bootstrapRes.data?.elements) ? bootstrapRes.data.elements : []

    const idsParam = url.searchParams.get('player_ids')
    const namesParam = url.searchParams.get('player_names')
    const mode = (url.searchParams.get('mode') || 'all').toLowerCase() // 'all' | 'any'

    const { players: selectedPlayers, unresolvedNames } = resolveSelectedPlayers(elements, idsParam, namesParam)

    if (selectedPlayers.length === 0) {
      return json({
        error: 'No valid players selected. Provide player_ids or player_names.',
        unresolved_names: unresolvedNames,
      }, 400)
    }

    const currentGw = await getCurrentGw(origin)
    if (!currentGw) {
      return json({ error: 'Could not determine current gameweek.' }, 502)
    }

    const selectedIdSet = new Set(selectedPlayers.map((p) => p.id))
    const selectedNameById = new Map(selectedPlayers.map((p) => [p.id, p.web_name]))

    const managerRows = await mapWithConcurrency(managerIds, FETCH_CONCURRENCY, async (entryId) => {
      const [summaryRes, picksRes] = await Promise.all([
        fetchJson(`${origin}/api/fpl/entry/${entryId}/`),
        fetchJson(`${origin}/api/fpl/entry/${entryId}/event/${currentGw}/picks/`),
      ])

      if (!summaryRes.ok || !picksRes.ok) return null

      const summary = (summaryRes.data || {}) as ManagerSummaryResponse
      const picks = (picksRes.data || {}) as PicksResponse
      const pickList = Array.isArray(picks.picks) ? picks.picks : []

      const ownedElements = pickList
        .map((p) => Number(p?.element))
        .filter((id) => Number.isFinite(id) && id > 0)

      const matchedIds = ownedElements.filter((id) => selectedIdSet.has(id))
      const uniqueMatchedIds = [...new Set(matchedIds)].sort((a, b) => a - b)
      const matchedNames = uniqueMatchedIds.map((id) => selectedNameById.get(id) || `Player ${id}`)

      const ownsAll = uniqueMatchedIds.length === selectedPlayers.length
      const ownsAny = uniqueMatchedIds.length > 0
      const pass = mode === 'any' ? ownsAny : ownsAll

      const managerName = `${summary.player_first_name || ''} ${summary.player_last_name || ''}`.trim() || `Entry ${entryId}`
      const teamName = String(summary.name || '').trim() || '-'

      return {
        entry_id: entryId,
        manager_name: managerName,
        team_name: teamName,
        owns_all_selected_players: ownsAll,
        matched_player_ids: uniqueMatchedIds,
        matched_player_names: matchedNames,
        pass,
      }
    })

    const filtered = managerRows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.pass)
      .map(({ pass, ...rest }) => rest)
      .sort((a, b) => a.manager_name.localeCompare(b.manager_name))

    const ownersByPlayer = selectedPlayers.map((player) => {
      const owners = filtered
        .filter((m) => m.matched_player_ids.includes(player.id))
        .map((m) => ({
          entry_id: m.entry_id,
          manager_name: m.manager_name,
          team_name: m.team_name,
        }))
      return {
        player_id: player.id,
        player_name: player.web_name,
        owners,
      }
    })

    if (url.searchParams.get('format') === 'csv') {
      const csv = buildCsv(selectedPlayers, filtered)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="manager-player-group-owners.csv"',
        },
      })
    }

    return json({
      generated_at: new Date().toISOString(),
      gameweek: currentGw,
      filter_mode: mode === 'any' ? 'any' : 'all',
      manager_count_scanned: managerIds.length,
      selected_players: selectedPlayers.map((p) => ({
        id: p.id,
        web_name: p.web_name,
        full_name: p.full_name,
      })),
      unresolved_names: unresolvedNames,
      match_count: filtered.length,
      matching_managers: filtered,
      owners_by_player: ownersByPlayer,
    })
  } catch (error) {
    console.error('[manager-player-group-owners] request failed', error)
    return json({ error: 'Failed to load manager player-group ownership export' }, 500)
  }
}
