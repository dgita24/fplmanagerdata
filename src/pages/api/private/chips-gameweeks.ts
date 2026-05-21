import {
  buildChipGameweeksCsv,
  extractChipGameweeks,
  type ChipGameweekExportRow,
} from '../../../lib/chipGameweeks'

export const prerender = false

const SUPABASE_URL = 'https://fnehvaoqqmkrhxcqslta.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'

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

async function getSupabaseUser(token: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) return null
  const data = await res.json()
  if (!data?.id) return null
  return { id: data.id, email: data.email }
}

async function supabaseRestGet(path: string, token: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Supabase REST error ${res.status}`)
  }

  return (await res.json()) as any[]
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

export async function GET({ request, url }: { request: Request; url: URL }) {
  const token = getBearerToken(request)
  if (!token) {
    return json({ error: 'Missing bearer token' }, 401)
  }

  const user = await getSupabaseUser(token)
  if (!user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const accessRows = await supabaseRestGet(
      `analysis_lab_access?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token
    )

    if (!Array.isArray(accessRows) || accessRows.length === 0) {
      return json({ error: 'Access denied' }, 403)
    }

    const managerRows = await supabaseRestGet(
      `user_manager_lists?select=manager_ids&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      token
    )

    const managerIds = Array.isArray(managerRows?.[0]?.manager_ids)
      ? managerRows[0].manager_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : []

    const origin = new URL(request.url).origin
    const rows = (await Promise.all(managerIds.map((entryId: number) => fetchManagerChipGameweeks(origin, entryId))))
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
  } catch {
    return json({ error: 'Failed to load chip gameweek export' }, 500)
  }
}
