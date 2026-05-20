import { createClient } from '@supabase/supabase-js'

export const prerender = false

interface AnalysisRequestBody {
  groupId?: string
  startGw?: number
  endGw?: number
  metrics?: {
    rankHistory?: boolean
    transfers?: boolean
    captaincy?: boolean
    chipTiming?: boolean
  }
}

interface EntryHistoryCurrent {
  event?: number
  overall_rank?: number
  event_transfers?: number
  event_transfers_cost?: number
}

interface EntryHistoryChip {
  event?: number
  name?: string
}

interface EntryHistoryResponse {
  current?: EntryHistoryCurrent[]
  chips?: EntryHistoryChip[]
}

interface EntryPicksResponse {
  picks?: Array<{ element?: number; is_captain?: boolean }>
}

interface EntryTransferResponseItem {
  event?: number
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

function pickEnv(ctx: any) {
  const candidates: Array<{ name: string; env: any }> = [
    { name: 'platform.env', env: ctx?.platform?.env },
    { name: 'locals.runtime.env', env: ctx?.locals?.runtime?.env },
    { name: 'locals.env', env: ctx?.locals?.env },
    { name: 'runtime.env', env: ctx?.runtime?.env },
  ]

  for (const c of candidates) {
    if (c.env && typeof c.env === 'object') {
      return c.env
    }
  }

  return undefined
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonWithRetry(url: string): Promise<any> {
  const retries = 2
  let attempt = 0

  while (true) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    })

    if (res.ok) {
      return res.json()
    }

    if (attempt >= retries || !RETRY_STATUS.has(res.status)) {
      throw new Error(`Upstream FPL API error: ${res.status}`)
    }

    const jitter = Math.floor(Math.random() * 200)
    const delay = 400 * Math.pow(2, attempt) + jitter
    await sleep(delay)
    attempt++
  }
}

function normalizeChipName(chip: string): string {
  const key = chip.trim().toLowerCase()
  if (key === 'wildcard' || key === 'wildcard2') return 'WC'
  if (key === 'freehit' || key === 'free_hit') return 'FH'
  if (key === 'bboost' || key === 'bench_boost') return 'BB'
  if (key === '3xc' || key === 'triple_captain') return 'TC'
  if (key === 'manager' || key === 'assistant_manager') return 'AM'
  return chip.toUpperCase()
}

function parseBody(raw: AnalysisRequestBody) {
  const groupId = String(raw.groupId || '').trim()
  const startGw = Math.max(1, Math.min(38, Number(raw.startGw) || 1))
  const endGw = Math.max(1, Math.min(38, Number(raw.endGw) || 38))

  const metrics = {
    rankHistory: Boolean(raw.metrics?.rankHistory),
    transfers: Boolean(raw.metrics?.transfers),
    captaincy: Boolean(raw.metrics?.captaincy),
    chipTiming: Boolean(raw.metrics?.chipTiming),
  }

  if (!groupId) {
    throw new Error('Missing groupId')
  }

  if (startGw > endGw) {
    throw new Error('startGw must be <= endGw')
  }

  if (!Object.values(metrics).some(Boolean)) {
    throw new Error('At least one metric must be selected')
  }

  return { groupId, startGw, endGw, metrics }
}

async function fetchManagerBundle(entryId: number, startGw: number, endGw: number, needCaptaincy: boolean) {
  const historyPromise = fetchJsonWithRetry(`https://fantasy.premierleague.com/api/entry/${entryId}/history/`) as Promise<EntryHistoryResponse>
  const transfersPromise = fetchJsonWithRetry(`https://fantasy.premierleague.com/api/entry/${entryId}/transfers/`) as Promise<EntryTransferResponseItem[]>

  const picksPromises: Array<Promise<{ gw: number; data: EntryPicksResponse }>> = []
  if (needCaptaincy) {
    for (let gw = startGw; gw <= endGw; gw++) {
      const p = fetchJsonWithRetry(`https://fantasy.premierleague.com/api/entry/${entryId}/event/${gw}/picks/`)
        .then((data) => ({ gw, data: data as EntryPicksResponse }))
      picksPromises.push(p)
    }
  }

  const [history, transfers, picksByGw] = await Promise.all([
    historyPromise,
    transfersPromise,
    picksPromises.length ? Promise.all(picksPromises) : Promise.resolve([]),
  ])

  const captainByGw = new Map<number, number>()
  for (const item of picksByGw) {
    const picks = Array.isArray(item.data?.picks) ? item.data.picks : []
    const captain = picks.find((p) => p?.is_captain && Number.isFinite(Number(p?.element)))
    if (captain?.element) {
      captainByGw.set(item.gw, Number(captain.element))
    }
  }

  const transferCountByGw = new Map<number, number>()
  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    const gw = Number(transfer?.event)
    if (!Number.isInteger(gw) || gw < startGw || gw > endGw) continue
    transferCountByGw.set(gw, (transferCountByGw.get(gw) || 0) + 1)
  }

  return {
    historyCurrent: Array.isArray(history?.current) ? history.current : [],
    historyChips: Array.isArray(history?.chips) ? history.chips : [],
    captainByGw,
    transferCountByGw,
  }
}

function average(nums: number[]): number | null {
  if (!nums.length) return null
  return nums.reduce((acc, n) => acc + n, 0) / nums.length
}

function toSortedRows<T>(map: Map<number, T>, startGw: number, endGw: number, buildFallback: (gw: number) => T): T[] {
  const rows: T[] = []
  for (let gw = startGw; gw <= endGw; gw++) {
    rows.push(map.get(gw) ?? buildFallback(gw))
  }
  return rows
}

export async function POST(ctx: any): Promise<Response> {
  const env = pickEnv(ctx)
  const supabaseUrl = env?.SUPABASE_URL || 'https://fnehvaoqqmkrhxcqslta.supabase.co'
  const anonKey = env?.SUPABASE_ANON_KEY || 'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'
  const serviceRoleKey = env?.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfiguration: missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  const authHeader = String(ctx.request.headers.get('authorization') || '')
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing bearer token' }, 401)
  }
  const token = authHeader.slice(7).trim()
  if (!token) {
    return jsonResponse({ error: 'Missing bearer token' }, 401)
  }

  let body: AnalysisRequestBody
  try {
    body = (await ctx.request.json()) as AnalysisRequestBody
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  let parsed: ReturnType<typeof parseBody>
  try {
    parsed = parseBody(body)
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid request payload' }, 400)
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  const { data: accessData, error: accessError } = await supabaseAdmin
    .from('analysis_lab_access')
    .select('user_id')
    .eq('user_id', user.id)
    .single()

  if (accessError || !accessData?.user_id) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const { data: group, error: groupError } = await supabaseAdmin
    .from('analysis_manager_groups')
    .select('id, name, season, manager_ids')
    .eq('id', parsed.groupId)
    .eq('user_id', user.id)
    .single()

  if (groupError || !group) {
    return jsonResponse({ error: 'Group not found' }, 404)
  }

  const managerIds = (Array.isArray(group.manager_ids) ? group.manager_ids : [])
    .map((id: unknown) => Number(id))
    .filter((id: number) => Number.isInteger(id) && id > 0)
    .slice(0, 50)

  if (!managerIds.length) {
    return jsonResponse({
      group: {
        id: group.id,
        name: group.name,
        season: group.season,
        managerCount: 0,
      },
      range: {
        startGw: parsed.startGw,
        endGw: parsed.endGw,
      },
      metrics: parsed.metrics,
      rows: [],
    })
  }

  const bundles = await Promise.all(
    managerIds.map((entryId: number) => fetchManagerBundle(entryId, parsed.startGw, parsed.endGw, parsed.metrics.captaincy))
  )

  type AggRow = {
    gw: number
    managerCount: number
    rankValues: number[]
    transferValues: number[]
    hitCount: number
    captainCounts: Map<number, number>
    chips: Record<string, number>
  }

  const gwMap = new Map<number, AggRow>()
  for (let gw = parsed.startGw; gw <= parsed.endGw; gw++) {
    gwMap.set(gw, {
      gw,
      managerCount: 0,
      rankValues: [],
      transferValues: [],
      hitCount: 0,
      captainCounts: new Map<number, number>(),
      chips: {},
    })
  }

  for (const bundle of bundles) {
    const historyByGw = new Map<number, EntryHistoryCurrent>()
    for (const row of bundle.historyCurrent) {
      const gw = Number(row?.event)
      if (Number.isInteger(gw) && gw >= parsed.startGw && gw <= parsed.endGw) {
        historyByGw.set(gw, row)
      }
    }

    const chipByGw = new Map<number, string>()
    for (const chip of bundle.historyChips) {
      const gw = Number(chip?.event)
      const name = String(chip?.name || '')
      if (!name) continue
      if (Number.isInteger(gw) && gw >= parsed.startGw && gw <= parsed.endGw) {
        chipByGw.set(gw, normalizeChipName(name))
      }
    }

    for (let gw = parsed.startGw; gw <= parsed.endGw; gw++) {
      const agg = gwMap.get(gw)
      if (!agg) continue

      agg.managerCount += 1

      const history = historyByGw.get(gw)
      const overallRank = Number(history?.overall_rank)
      if (Number.isFinite(overallRank) && overallRank > 0) {
        agg.rankValues.push(overallRank)
      }

      const eventTransfersFromHistory = Number(history?.event_transfers)
      const eventTransfersFromTransfers = bundle.transferCountByGw.get(gw)
      const eventTransfers = Number.isFinite(Number(eventTransfersFromTransfers))
        ? Number(eventTransfersFromTransfers)
        : eventTransfersFromHistory
      if (Number.isFinite(eventTransfers) && eventTransfers >= 0) {
        agg.transferValues.push(Number(eventTransfers))
      }

      const transferCost = Number(history?.event_transfers_cost)
      if (Number.isFinite(transferCost) && transferCost > 0) {
        agg.hitCount += 1
      }

      const captainElement = bundle.captainByGw.get(gw)
      if (captainElement && Number.isFinite(captainElement)) {
        agg.captainCounts.set(captainElement, (agg.captainCounts.get(captainElement) || 0) + 1)
      }

      const chipName = chipByGw.get(gw)
      if (chipName) {
        agg.chips[chipName] = (agg.chips[chipName] || 0) + 1
      }
    }
  }

  const rows = toSortedRows(
    gwMap,
    parsed.startGw,
    parsed.endGw,
    (gw) => ({
      gw,
      managerCount: 0,
      rankValues: [],
      transferValues: [],
      hitCount: 0,
      captainCounts: new Map<number, number>(),
      chips: {},
    })
  ).map((row) => {
    let captainTopElement: number | null = null
    let captainTopCount = 0
    for (const [element, count] of row.captainCounts.entries()) {
      if (count > captainTopCount) {
        captainTopCount = count
        captainTopElement = element
      }
    }

    const captainTopPct = row.managerCount > 0 ? (captainTopCount / row.managerCount) * 100 : null
    const hitRatePct = row.managerCount > 0 ? (row.hitCount / row.managerCount) * 100 : null

    return {
      gw: row.gw,
      managerCount: row.managerCount,
      avgOverallRank: average(row.rankValues),
      avgEventTransfers: average(row.transferValues),
      hitRatePct,
      captainTopElement,
      captainTopPct,
      chips: row.chips,
    }
  })

  return jsonResponse({
    group: {
      id: group.id,
      name: group.name,
      season: group.season,
      managerCount: managerIds.length,
    },
    range: {
      startGw: parsed.startGw,
      endGw: parsed.endGw,
    },
    metrics: parsed.metrics,
    rows,
  })
}
