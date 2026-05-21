export type ManagerTransferRow = {
  season: string
  gw: number
  entry_id: number
  entry_name: string
  player_name: string
  time: string
  element_in: number
  element_out: number
  purchase_price: number
  selling_price: number
  element_in_name: string
  chip_played: string | null
  element_out_name: string
  element_in_prev_gw_points: number | null
  element_out_prev_gw_points: number | null
  element_out_gws_held: number | null
  element_in_pts_above5_last6: number | null
  element_out_pts_above5_last6: number | null
  element_in_avg_pts_last6: number | null
  element_out_avg_pts_last6: number | null
}

type FplLiveElement = {
  id?: number
  stats?: {
    total_points?: number
  }
}

type FplTransferRow = {
  event?: number
  time?: string
  element_in?: number
  element_out?: number
  element_in_cost?: number
  element_out_cost?: number
}

type FplChipRow = {
  name?: string | null
  event?: number
}

function normalizeChipCode(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'wildcard') return 'WC'
  if (value === 'freehit') return 'FH'
  return null
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

function formStats(
  elementId: number,
  transferGw: number,
  gwLiveMap: Map<number, Map<number, number>>
): { above5: number | null; avg: number | null } {
  const pts: number[] = []
  for (let g = Math.max(1, transferGw - 6); g < transferGw; g++) {
    const p = gwLiveMap.get(g)?.get(elementId)
    if (p !== undefined) pts.push(p)
  }
  if (pts.length === 0) return { above5: null, avg: null }
  const above5 = pts.filter((p) => p > 5).length
  const avg = Math.round((pts.reduce((s, p) => s + p, 0) / pts.length) * 10) / 10
  return { above5, avg }
}

export function buildManagerTransfersCsv(rows: ManagerTransferRow[]): string {
  const header = [
    'season',
    'gw',
    'entry_id',
    'entry_name',
    'player_name',
    'time',
    'element_in',
    'element_out',
    'purchase_price',
    'selling_price',
    'element_in_name',
    'chip_played',
    'element_out_name',
    'element_in_prev_gw_points',
    'element_out_prev_gw_points',
    'element_out_gws_held',
    'element_in_pts_above5_last6',
    'element_out_pts_above5_last6',
    'element_in_avg_pts_last6',
    'element_out_avg_pts_last6',
  ]

  const lines = rows.map((row) =>
    [
      row.season,
      row.gw,
      row.entry_id,
      row.entry_name,
      row.player_name,
      row.time,
      row.element_in,
      row.element_out,
      row.purchase_price,
      row.selling_price,
      row.element_in_name,
      row.chip_played,
      row.element_out_name,
      row.element_in_prev_gw_points,
      row.element_out_prev_gw_points,
      row.element_out_gws_held,
      row.element_in_pts_above5_last6,
      row.element_out_pts_above5_last6,
      row.element_in_avg_pts_last6,
      row.element_out_avg_pts_last6,
    ].map(csvCell).join(',')
  )

  return [header.join(','), ...lines].join('\n')
}

export async function fetchManagerTransfersRows(
  origin: string,
  entryId: number,
  season = 'current'
): Promise<ManagerTransferRow[]> {
  try {
    const [entryRes, transfersRes, bootstrapRes, historyRes, gw1PicksRes] = await Promise.all([
      fetch(`${origin}/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/transfers`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/bootstrap-static`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/history`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/event/1/picks`, { cache: 'no-store' }),
    ])

    if (!entryRes.ok || !transfersRes.ok || !bootstrapRes.ok) return []

    const [entryData, transfersData, bootstrapData, historyData] = await Promise.all([
      entryRes.json(),
      transfersRes.json(),
      bootstrapRes.json(),
      historyRes.ok ? historyRes.json() : Promise.resolve(null),
    ])

    const entry_name = String(entryData?.name || '')
    const player_name = `${entryData?.player_first_name || ''} ${entryData?.player_last_name || ''}`.trim() || `Manager ${entryId}`

    const elements = Array.isArray(bootstrapData?.elements) ? bootstrapData.elements : []
    const playerNameMap = new Map<number, string>()
    for (const el of elements) {
      const id = Number(el?.id)
      if (!Number.isInteger(id) || id <= 0) continue
      playerNameMap.set(id, String(el?.web_name || `Player ${id}`))
    }

    const transfers = Array.isArray(transfersData) ? transfersData as FplTransferRow[] : []
    const chipByGw = new Map<number, string>()
    const chips = Array.isArray(historyData?.chips) ? historyData.chips as FplChipRow[] : []
    for (const chip of chips) {
      const gw = Number(chip?.event)
      const normalized = normalizeChipCode(chip?.name ?? null)
      if (!Number.isInteger(gw) || gw <= 0) continue
      if (!normalized) continue
      chipByGw.set(gw, normalized)
    }

    // Collect unique GWs needed for live data (gw-6 to gw-1) for all transfers
    const prevGwSet = new Set<number>()
    for (const row of transfers) {
      const gw = Number(row?.event)
      if (!Number.isInteger(gw) || gw <= 1) continue
      for (let g = Math.max(1, gw - 6); g < gw; g++) {
        prevGwSet.add(g)
      }
    }

    // Fetch live data for each unique prev GW in parallel
    const gwLiveMap = new Map<number, Map<number, number>>()
    await Promise.all(
      Array.from(prevGwSet).map(async (prevGw) => {
        try {
          const liveRes = await fetch(`${origin}/api/fpl/event/${prevGw}/live`, { cache: 'no-store' })
          if (!liveRes.ok) return
          const liveData = await liveRes.json()
          const elements = Array.isArray(liveData?.elements) ? liveData.elements as FplLiveElement[] : []
          const elementPointsMap = new Map<number, number>()
          for (const el of elements) {
            const id = Number(el?.id)
            if (!Number.isInteger(id) || id <= 0) continue
            const pts = Number(el?.stats?.total_points)
            if (Number.isInteger(pts)) elementPointsMap.set(id, pts)
          }
          gwLiveMap.set(prevGw, elementPointsMap)
        } catch {
          // leave entry absent — will resolve to null
        }
      })
    )

    // Track when each element was last bought by this manager (for gws_held calculation)
    // Pre-sort transfers chronologically so lastBoughtGwByElement is populated in the right order
    const sortedTransfers = [...transfers].sort((a, b) => {
      const gwA = Number(a?.event) || 0
      const gwB = Number(b?.event) || 0
      if (gwA !== gwB) return gwA - gwB
      return String(a?.time || '').localeCompare(String(b?.time || ''))
    })
    const lastBoughtGwByElement = new Map<number, number>()
    if (gw1PicksRes.ok) {
      try {
        const gw1PicksData = await gw1PicksRes.json()
        const picks = Array.isArray(gw1PicksData?.picks) ? gw1PicksData.picks : []
        for (const pick of picks) {
          const elementId = Number(pick?.element)
          if (!Number.isInteger(elementId) || elementId <= 0) continue
          lastBoughtGwByElement.set(elementId, 1)
        }
      } catch {
        // Graceful fallback when GW1 picks are unavailable (e.g., season not started)
      }
    }

    return sortedTransfers
      .map((row) => {
        const gw = Number(row?.event)
        const elementIn = Number(row?.element_in)
        const elementOut = Number(row?.element_out)
        if (!Number.isInteger(gw) || gw <= 0) return null
        if (!Number.isInteger(elementIn) || elementIn <= 0) return null
        if (!Number.isInteger(elementOut) || elementOut <= 0) return null

        const priorBuyGw = lastBoughtGwByElement.get(elementOut) ?? null
        const element_out_gws_held = priorBuyGw !== null ? gw - priorBuyGw : null

        const inForm = formStats(elementIn, gw, gwLiveMap)
        const outForm = formStats(elementOut, gw, gwLiveMap)

        const result = {
          season,
          gw,
          entry_id: entryId,
          entry_name,
          player_name,
          time: String(row?.time || ''),
          element_in: elementIn,
          element_out: elementOut,
          purchase_price: Number(row?.element_in_cost) || 0,
          selling_price: Number(row?.element_out_cost) || 0,
          element_in_name: playerNameMap.get(elementIn) || `Player ${elementIn}`,
          chip_played: chipByGw.get(gw) ?? null,
          element_out_name: playerNameMap.get(elementOut) || `Player ${elementOut}`,
          element_in_prev_gw_points: gw > 1 ? (gwLiveMap.get(gw - 1)?.get(elementIn) ?? null) : null,
          element_out_prev_gw_points: gw > 1 ? (gwLiveMap.get(gw - 1)?.get(elementOut) ?? null) : null,
          element_out_gws_held,
          element_in_pts_above5_last6: inForm.above5,
          element_out_pts_above5_last6: outForm.above5,
          element_in_avg_pts_last6: inForm.avg,
          element_out_avg_pts_last6: outForm.avg,
        }

        // Update tracking AFTER reading priorBuyGw (so element_out lookup is unaffected if
        // elementIn happens to equal a previously sold element_out for a different transfer)
        lastBoughtGwByElement.set(elementIn, gw)

        return result
      })
      .filter((row): row is ManagerTransferRow => row !== null)
      .sort((a, b) => {
        const gwDelta = a.gw - b.gw
        if (gwDelta !== 0) return gwDelta
        return a.time.localeCompare(b.time)
      })
  } catch {
    return []
  }
}
