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
  element_out_acquired_gw: number | null
  element_out_acquired_via: 'initial_squad' | 'transfer' | 'wildcard' | 'free_hit' | 'unknown'
  element_out_pre_transfer_owned: boolean
  element_in_pre_transfer_owned: boolean
  element_in_is_new_ownership: boolean
  transfer_group_id: string
  transfer_group_size: number
  transfer_group_index: number
  element_in_pts_above5_last6: number | null
  element_out_pts_above5_last6: number | null
  element_in_avg_pts_last6: number | null
  element_out_avg_pts_last6: number | null
}

export type FetchManagerTransfersOptions = {
  bootstrapData?: unknown
  sharedGwLivePromises?: Map<number, Promise<Map<number, number>>>
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

type FplPicksResponse = {
  picks?: Array<{ element?: number }>
}

type AcquisitionVia = ManagerTransferRow['element_out_acquired_via']

function normalizeChipCode(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'wildcard') return 'WC'
  if (value === 'freehit') return 'FH'
  return null
}

function csvCell(value: string | number | boolean | null): string {
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

function picksElementSet(data: unknown): Set<number> {
  const picks = Array.isArray((data as FplPicksResponse | null | undefined)?.picks)
    ? (data as FplPicksResponse).picks
    : []
  const result = new Set<number>()
  for (const pick of picks) {
    const elementId = Number(pick?.element)
    if (!Number.isInteger(elementId) || elementId <= 0) continue
    result.add(elementId)
  }
  return result
}

function inferAcquisitionGw(
  elementId: number,
  startedEvent: number,
  everBoughtByTransfer: Set<number>,
  acquisitionGwByElement: Map<number, number>
): number | null {
  const knownAcquiredGw = acquisitionGwByElement.get(elementId)
  if (knownAcquiredGw !== undefined) return knownAcquiredGw
  if (everBoughtByTransfer.has(elementId)) return null
  return startedEvent
}

function inferAcquisitionVia(
  elementId: number,
  everBoughtByTransfer: Set<number>,
  acquisitionViaByElement: Map<number, AcquisitionVia>
): AcquisitionVia {
  const knownAcquiredVia = acquisitionViaByElement.get(elementId)
  if (knownAcquiredVia !== undefined) return knownAcquiredVia
  if (everBoughtByTransfer.has(elementId)) return 'unknown'
  return 'initial_squad'
}

function acquiredViaFromChipCode(chipCode: string | null): AcquisitionVia {
  if (chipCode === 'WC') return 'wildcard'
  if (chipCode === 'FH') return 'free_hit'
  return 'transfer'
}

/**
 * Within a group of transfers sharing the same GW, apply a topological sort so
 * that if row A buys element X and row B sells element X, row A is always
 * processed before row B.
 *
 * This prevents false-blank `element_out_gws_held` values that arise when the
 * FPL API returns same-GW transfers in an order where the sell of a player
 * appears before the buy of that player in the same session (e.g. WC/FH churn
 * where a manager buys then immediately re-sells a player, even when the FPL
 * API records slightly different timestamps for each transfer).
 *
 * Grouping by the whole GW (rather than only same-GW AND same-timestamp) is
 * necessary because the FPL API sometimes assigns slightly different timestamps
 * to logically-chained transfers within a single WC/FH session.  A purely
 * time-based sort would then place a "sell X" row before the "buy X" row,
 * producing a false blank.
 *
 * Within topologically-equivalent sets the stable tie-break is (timestamp,
 * original API index) so the output is deterministic and chronologically
 * sensible.
 */
function topoSortSameGwGroup(
  group: Array<{ row: FplTransferRow; origIdx: number }>
): FplTransferRow[] {
  const n = group.length
  if (n <= 1) return group.map((g) => g.row)

  // Build a directed graph: edge i→j means row i must be processed before row j
  // (row i buys the element that row j sells).
  const adj: number[][] = Array.from({ length: n }, () => [])
  const inDegree = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    const elemIn = Number(group[i].row.element_in)
    if (!Number.isInteger(elemIn) || elemIn <= 0) continue
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const elemOut = Number(group[j].row.element_out)
      if (elemIn === elemOut) {
        adj[i].push(j)
        inDegree[j]++
      }
    }
  }

  // Kahn's algorithm — stable tie-break by (timestamp, original API index)
  const cmpEntry = (
    a: { row: FplTransferRow; origIdx: number },
    b: { row: FplTransferRow; origIdx: number }
  ): number => {
    const timeCmp = String(a.row?.time || '').localeCompare(String(b.row?.time || ''))
    if (timeCmp !== 0) return timeCmp
    return a.origIdx - b.origIdx
  }
  const cmp = (a: number, b: number): number => cmpEntry(group[a], group[b])

  const result: FplTransferRow[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) ready.push(i)
  }
  ready.sort(cmp)

  while (ready.length > 0) {
    const i = ready.shift()!
    result.push(group[i].row)
    const newReady: number[] = []
    for (const j of adj[i]) {
      inDegree[j]--
      if (inDegree[j] === 0) newReady.push(j)
    }
    newReady.sort(cmp)
    ready.push(...newReady)
  }

  // Safety net for cycles (should not occur with real FPL data) — append remaining
  // rows in (timestamp, original-index) order so output is still deterministic.
  if (result.length < n) {
    const resultSet = new Set(result)
    const remaining = group.filter((g) => !resultSet.has(g.row))
    remaining.sort(cmpEntry)
    for (const { row } of remaining) result.push(row)
  }

  return result
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
    'element_out_acquired_gw',
    'element_out_acquired_via',
    'element_out_pre_transfer_owned',
    'element_in_pre_transfer_owned',
    'element_in_is_new_ownership',
    'transfer_group_id',
    'transfer_group_size',
    'transfer_group_index',
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
      row.element_out_acquired_gw,
      row.element_out_acquired_via,
      row.element_out_pre_transfer_owned,
      row.element_in_pre_transfer_owned,
      row.element_in_is_new_ownership,
      row.transfer_group_id,
      row.transfer_group_size,
      row.transfer_group_index,
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
  season = 'current',
  options?: FetchManagerTransfersOptions
): Promise<ManagerTransferRow[]> {
  try {
    const [entryRes, transfersRes, historyRes, gw1PicksRes] = await Promise.all([
      fetch(`${origin}/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/transfers`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/history`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/event/1/picks`, { cache: 'no-store' }),
    ])

    let bootstrapData: unknown = options?.bootstrapData ?? null
    if (!bootstrapData) {
      const bootstrapRes = await fetch(`${origin}/api/fpl/bootstrap-static`, { cache: 'no-store' })
      if (!bootstrapRes.ok) return []
      bootstrapData = await bootstrapRes.json()
    }

    if (!entryRes.ok || !transfersRes.ok) return []

    const [entryData, transfersData, historyData] = await Promise.all([
      entryRes.json(),
      transfersRes.json(),
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

    const gwLiveMap = new Map<number, Map<number, number>>()
    const sharedGwLivePromises = options?.sharedGwLivePromises
    await Promise.all(
      Array.from(prevGwSet).map(async (prevGw) => {
        try {
          let promise: Promise<Map<number, number>>
          if (sharedGwLivePromises?.has(prevGw)) {
            promise = sharedGwLivePromises.get(prevGw)!
          } else {
            promise = fetch(`${origin}/api/fpl/event/${prevGw}/live`, { cache: 'no-store' })
              .then(async (liveRes) => {
                if (!liveRes.ok) return new Map<number, number>()
                const liveData = await liveRes.json()
                const elements = Array.isArray(liveData?.elements) ? liveData.elements as FplLiveElement[] : []
                const elementPointsMap = new Map<number, number>()
                for (const el of elements) {
                  const id = Number(el?.id)
                  if (!Number.isInteger(id) || id <= 0) continue
                  const pts = Number(el?.stats?.total_points)
                  if (Number.isInteger(pts)) elementPointsMap.set(id, pts)
                }
                return elementPointsMap
              })
              .catch(() => new Map<number, number>())
            if (sharedGwLivePromises) {
              sharedGwLivePromises.set(prevGw, promise)
            }
          }
          const elementPointsMap = await promise
          if (elementPointsMap.size > 0) gwLiveMap.set(prevGw, elementPointsMap)
        } catch {
          // leave entry absent — will resolve to null
        }
      })
    )

    // Track when each element was last bought by this manager (for gws_held calculation).
    // Sort transfers chronologically so lastBoughtGwByElement is populated in the right order.
    //
    // For transfers that share the same GW (common during WC/FH when a manager makes many
    // changes in one session), a plain time-sort is insufficient because the FPL API sometimes
    // assigns slightly different timestamps to logically-chained transfers in the same session.
    // For example, "buy P99 at 10:00:01, sell P99 at 10:00:00" would be sorted as sell-before-buy
    // by time, causing the sell to see null provenance and emit a false blank.
    //
    // We fix this by:
    //   1. Sorting by (gw, time, original-index) for a fully deterministic initial order.
    //   2. Within each same-GW group (not just same-timestamp), applying a topological sort so
    //      that a row that buys element X is always processed before the row that sells element X,
    //      regardless of their individual timestamps.
    const indexedTransfers = transfers.map((row, origIdx) => ({ row, origIdx }))
    indexedTransfers.sort((a, b) => {
      const gwA = Number(a.row?.event) || 0
      const gwB = Number(b.row?.event) || 0
      if (gwA !== gwB) return gwA - gwB
      const timeCmp = String(a.row?.time || '').localeCompare(String(b.row?.time || ''))
      if (timeCmp !== 0) return timeCmp
      return a.origIdx - b.origIdx // stable tie-break preserves original API order for equal times
    })

    // Apply topological sort within each same-GW group
    const sortedTransfers: FplTransferRow[] = []
    let gi = 0
    while (gi < indexedTransfers.length) {
      const gwKey = Number(indexedTransfers[gi].row?.event) || 0
      let gj = gi + 1
      while (
        gj < indexedTransfers.length &&
        (Number(indexedTransfers[gj].row?.event) || 0) === gwKey
      ) {
        gj++
      }
      sortedTransfers.push(...topoSortSameGwGroup(indexedTransfers.slice(gi, gj)))
      gi = gj
    }

    // Determine the GW when this manager first participated (handles mid-season joiners).
    // Default to 1 if the field is absent or unparseable.
    const startedEvent = Math.max(1, Number(entryData?.started_event) || 1)

    // Seed ownership from the manager's initial squad picks.  For GW-1 joiners we reuse the
    // already-fetched picks; for mid-season joiners we fetch their actual first-GW picks so
    // their initial squad players are correctly provenanced at `startedEvent` rather than 1.
    let initialPicksRes: Response = gw1PicksRes
    if (startedEvent > 1) {
      initialPicksRes = await fetch(
        `${origin}/api/fpl/entry/${entryId}/event/${startedEvent}/picks`,
        { cache: 'no-store' }
      )
    }

    const lastBoughtGwByElement = new Map<number, number>()
    const acquisitionGwByElement = new Map<number, number>()
    const acquisitionViaByElement = new Map<number, AcquisitionVia>()
    const unknownOwnedElements = new Set<number>()
    const everBoughtByTransfer = new Set<number>()
    if (initialPicksRes.ok) {
      try {
        const initialOwned = picksElementSet(await initialPicksRes.json())
        for (const elementId of initialOwned) {
          lastBoughtGwByElement.set(elementId, startedEvent)
          acquisitionGwByElement.set(elementId, startedEvent)
          acquisitionViaByElement.set(elementId, 'initial_squad')
        }
      } catch {
        // Graceful fallback when initial picks are unavailable (e.g., season not started)
      }
    }

    const transfersByGw = new Map<number, FplTransferRow[]>()
    for (const row of sortedTransfers) {
      const gw = Number(row?.event)
      if (!Number.isInteger(gw) || gw <= 0) continue
      if (!transfersByGw.has(gw)) transfersByGw.set(gw, [])
      transfersByGw.get(gw)!.push(row)
    }

    const postGwOwnedByGw = new Map<number, Set<number>>()
    await Promise.all(
      Array.from(transfersByGw.keys()).map(async (gw) => {
        try {
          const picksRes = await fetch(`${origin}/api/fpl/entry/${entryId}/event/${gw}/picks`, { cache: 'no-store' })
          if (!picksRes.ok) return
          const owned = picksElementSet(await picksRes.json())
          postGwOwnedByGw.set(gw, owned)
        } catch {
          // Keep unavailable; we will fall back to transfer replay state.
        }
      })
    )

    const outputRows: ManagerTransferRow[] = []
    const sortedGws = Array.from(transfersByGw.keys()).sort((a, b) => a - b)
    const isCurrentlyOwned = (elementId: number): boolean =>
      lastBoughtGwByElement.has(elementId) || unknownOwnedElements.has(elementId)
    for (const gw of sortedGws) {
      const gwRows = transfersByGw.get(gw) ?? []
      const postGwOwned = postGwOwnedByGw.get(gw)
      let preGwOwned: Set<number> | null = null
      if (postGwOwned) {
        preGwOwned = new Set(postGwOwned)
        // Reverse replay each same-GW transfer against the post-transfer squad snapshot
        // to reconstruct the squad that existed immediately before the GW transfer batch.
        for (let i = gwRows.length - 1; i >= 0; i--) {
          const row = gwRows[i]
          const elementIn = Number(row?.element_in)
          const elementOut = Number(row?.element_out)
          if (Number.isInteger(elementIn) && elementIn > 0) preGwOwned.delete(elementIn)
          if (Number.isInteger(elementOut) && elementOut > 0) preGwOwned.add(elementOut)
        }

        // Align in-memory ownership with reconstructed pre-GW ownership.
        for (const elementId of Array.from(lastBoughtGwByElement.keys())) {
          if (!preGwOwned.has(elementId)) lastBoughtGwByElement.delete(elementId)
        }
        for (const elementId of Array.from(unknownOwnedElements)) {
          if (!preGwOwned.has(elementId)) unknownOwnedElements.delete(elementId)
        }
        for (const elementId of preGwOwned) {
          if (lastBoughtGwByElement.has(elementId) || unknownOwnedElements.has(elementId)) continue
          const inferredAcquiredGw = inferAcquisitionGw(
            elementId,
            startedEvent,
            everBoughtByTransfer,
            acquisitionGwByElement
          )
          if (inferredAcquiredGw !== null) {
            lastBoughtGwByElement.set(elementId, inferredAcquiredGw)
            acquisitionGwByElement.set(elementId, inferredAcquiredGw)
            acquisitionViaByElement.set(
              elementId,
              inferAcquisitionVia(elementId, everBoughtByTransfer, acquisitionViaByElement)
            )
          } else {
            unknownOwnedElements.add(elementId)
            acquisitionViaByElement.set(elementId, 'unknown')
          }
        }
      }

      const transfer_group_id = `${entryId}:${gw}`
      const transfer_group_size = gwRows.length
      const gwOutputRows = gwRows
        .map((row, rowIndex) => {
        const gw = Number(row?.event)
        const elementIn = Number(row?.element_in)
        const elementOut = Number(row?.element_out)
        if (!Number.isInteger(gw) || gw <= 0) return null
        if (!Number.isInteger(elementIn) || elementIn <= 0) return null
        if (!Number.isInteger(elementOut) || elementOut <= 0) return null

        const element_out_pre_transfer_owned = isCurrentlyOwned(elementOut)
        const element_in_pre_transfer_owned = isCurrentlyOwned(elementIn)
        const element_in_is_new_ownership = !element_in_pre_transfer_owned
        const priorBuyGw = lastBoughtGwByElement.get(elementOut) ?? null
        // If the player is unexpectedly not owned at sell-time, keep provenance as
        // explicit 'unknown' for analysis/debugging instead of inferring a false source.
        const element_out_acquired_via = element_out_pre_transfer_owned
          ? (acquisitionViaByElement.get(elementOut) ?? 'unknown')
          : 'unknown'
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
          element_out_acquired_gw: priorBuyGw,
          element_out_acquired_via,
          element_out_pre_transfer_owned,
          element_in_pre_transfer_owned,
          element_in_is_new_ownership,
          transfer_group_id,
          transfer_group_size,
          transfer_group_index: rowIndex + 1,
          element_in_pts_above5_last6: inForm.above5,
          element_out_pts_above5_last6: outForm.above5,
          element_in_avg_pts_last6: inForm.avg,
          element_out_avg_pts_last6: outForm.avg,
        }

          // Update ownership state AFTER reading priorBuyGw.
          lastBoughtGwByElement.delete(elementOut)
          unknownOwnedElements.delete(elementOut)
          lastBoughtGwByElement.set(elementIn, gw)
          acquisitionGwByElement.set(elementIn, gw)
          acquisitionViaByElement.set(elementIn, acquiredViaFromChipCode(chipByGw.get(gw) ?? null))
          everBoughtByTransfer.add(elementIn)
          unknownOwnedElements.delete(elementIn)

        return result
      })
      .filter((row): row is ManagerTransferRow => row !== null)
      outputRows.push(...gwOutputRows)
    }

    return outputRows.sort((a, b) => {
      const gwDelta = a.gw - b.gw
      if (gwDelta !== 0) return gwDelta
      const indexDelta = a.transfer_group_index - b.transfer_group_index
      if (indexDelta !== 0) return indexDelta
      const timeDelta = a.time.localeCompare(b.time)
      if (timeDelta !== 0) return timeDelta
      const outDelta = a.element_out - b.element_out
      if (outDelta !== 0) return outDelta
      return a.element_in - b.element_in
    })
  } catch {
    return []
  }
}
