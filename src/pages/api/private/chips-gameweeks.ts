import {
  buildChipGameweeksCsv,
  extractChipGameweeks,
  type ChipGameweekExportRow,
} from '../../../lib/chipGameweeks'
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

const FETCH_CONCURRENCY = 5

async function fetchManagerChipGameweeks(origin: string, entryId: number): Promise<ChipGameweekExportRow | null> {
  try {
    const [entryRes, historyRes] = await Promise.all([
      fetch(`${origin}/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/history`, { cache: 'no-store' }),
    ])

    if (!entryRes.ok || !historyRes.ok) return null

    const [entryData, historyData] = await Promise.all([
      entryRes.json(),
      historyRes.json(),
    ])

    const managerName = `${entryData?.player_first_name || ''} ${entryData?.player_last_name || ''}`.trim() || `Manager ${entryId}`
    const teamName = entryData?.name || ''
    const summary = extractChipGameweeks(Array.isArray(historyData?.chips) ? historyData.chips : [])

    return {
      entryId,
      managerName,
      teamName,
      allChipGws: summary.allChipGws,
      wildcardGws: summary.byChip.WC,
      benchBoostGws: summary.byChip.BB,
      tripleCaptainGws: summary.byChip.TC,
      freeHitGws: summary.byChip.FH,
      assistantManagerGws: summary.byChip.AM,
    }
  } catch {
    return null
  }
}

export async function GET(ctx: RouteContext) {
  const { request, url } = ctx
  const config = getSupabaseConfig(ctx)
  if (!config) {
    return json({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)
  }

  const token = getBearerToken(request)
  if (!token) {
    return json({ error: 'Missing bearer token' }, 401)
  }

  const user = await getSupabaseUser(token, config)
  if (!user) {
    return json({ error: 'Unauthorized' }, 401)
  }

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
    const rows = (await mapWithConcurrency(managerIds, FETCH_CONCURRENCY, (entryId) => fetchManagerChipGameweeks(origin, entryId)))
      .filter((row): row is ChipGameweekExportRow => row !== null)
      .sort((a, b) => a.managerName.localeCompare(b.managerName))

    if (url.searchParams.get('format') === 'csv') {
      const csv = buildChipGameweeksCsv(rows)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="chip-gameweeks-current-season.csv"',
        },
      })
    }

    return json({
      season: 'current',
      generatedAt: new Date().toISOString(),
      managerCount: rows.length,
      managers: rows,
    })
  } catch (error) {
    console.error('[chips-gameweeks] request failed', error)
    return json({ error: 'Failed to load chip gameweek export' }, 500)
  }
}
