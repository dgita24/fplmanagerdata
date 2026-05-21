import {
  buildManagerTransfersCsv,
  fetchManagerTransfersRows,
  type ManagerTransferRow,
} from '../../../lib/managerTransfersExport'
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
    const groupedRows = await mapWithConcurrency(managerIds, FETCH_CONCURRENCY, (entryId) =>
      fetchManagerTransfersRows(origin, entryId)
    )
    const rows = groupedRows
      .flat()
      .sort((a: ManagerTransferRow, b: ManagerTransferRow) => {
        const managerCompare = a.player_name.localeCompare(b.player_name)
        if (managerCompare !== 0) return managerCompare
        const gwDelta = a.gw - b.gw
        if (gwDelta !== 0) return gwDelta
        return a.time.localeCompare(b.time)
      })

    if (url.searchParams.get('format') === 'csv') {
      const csv = buildManagerTransfersCsv(rows)
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="manager-transfers-current-season.csv"',
        },
      })
    }

    return json({
      season: 'current',
      generated_at: new Date().toISOString(),
      manager_count: managerIds.length,
      row_count: rows.length,
      rows,
    })
  } catch (error) {
    console.error('[manager-transfers] request failed', error)
    return json({ error: 'Failed to load manager transfers export' }, 500)
  }
}
