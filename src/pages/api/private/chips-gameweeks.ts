import {
  buildChipGameweeksCsv,
  extractChipGameweeks,
  type ChipGameweekExportRow,
} from '../../../lib/chipGameweeks'

export const prerender = false

type SupabaseConfig = {
  url: string
  anonKey: string
}

type RuntimeEnv = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

type RouteContext = {
  request: Request
  url: URL
  locals?: {
    runtime?: { env?: RuntimeEnv }
    env?: RuntimeEnv
  }
  platform?: {
    env?: RuntimeEnv
  }
}

type SupabaseUser = {
  id: string
  email?: string
}

type AnalysisLabAccessRow = {
  user_id: string
}

type UserManagerListRow = {
  manager_ids: number[] | null
}

const FETCH_CONCURRENCY = 5

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!auth?.toLowerCase().startsWith('bearer ')) return null
  return auth.slice(7).trim() || null
}

function pickEnv(ctx: RouteContext): RuntimeEnv | null {
  return (
    ctx?.locals?.runtime?.env ||
    ctx?.platform?.env ||
    ctx?.locals?.env ||
    null
  )
}

function getSupabaseConfig(ctx: RouteContext): SupabaseConfig | null {
  const runtimeEnv = pickEnv(ctx)
  const url = runtimeEnv?.SUPABASE_URL || process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL
  const anonKey = runtimeEnv?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY

  if (!url || !anonKey) return null
  return { url, anonKey }
}

async function getSupabaseUser(token: string, config: SupabaseConfig): Promise<SupabaseUser | null> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) return null
  const data = await res.json()
  if (!data?.id) return null
  return { id: data.id, email: data.email }
}

async function supabaseRestGet<T>(path: string, token: string, config: SupabaseConfig): Promise<T[]> {
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Supabase REST error ${res.status}`)
  }

  return (await res.json()) as T[]
}

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

async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn) => Promise<TOut>
): Promise<TOut[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TOut>(items.length)
  let nextIndex = 0

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
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
    const accessRows = await supabaseRestGet<AnalysisLabAccessRow>(
      `analysis_lab_access?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token,
      config
    )

    if (!Array.isArray(accessRows) || accessRows.length === 0) {
      return json({ error: 'Access denied' }, 403)
    }

    const managerRows = await supabaseRestGet<UserManagerListRow>(
      `user_manager_lists?select=manager_ids&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token,
      config
    )

    const managerIds = Array.isArray(managerRows?.[0]?.manager_ids)
      ? managerRows[0].manager_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : []

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
