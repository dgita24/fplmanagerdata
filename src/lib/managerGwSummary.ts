type FplHistoryCurrentRow = {
  event?: number
  points?: number
  total_points?: number
  overall_rank?: number
  rank?: number
  points_on_bench?: number
  event_transfers?: number
  event_transfers_cost?: number
  bank?: number
  value?: number
}

type FplHistoryChip = {
  name?: string | null
  event?: number | null
}

type FplPicksResponse = {
  picks?: Array<{
    element?: number
    is_captain?: boolean
    is_vice_captain?: boolean
  }>
}

export type ManagerGwSummaryRow = {
  season: string
  gw: number
  entry_id: number
  entry_name: string
  player_name: string
  overall_rank: number
  overall_points: number
  points_on_bench: number
  points: number
  gw_rank: number
  event_transfers: number
  event_transfers_cost: number
  bank: number
  value: number
  free_transfers: number
  wildcard: boolean
  freehit: boolean
  bench_boost: boolean
  triple_captain: boolean
  assistant_manager: boolean
  captain_element: number | null
  vice_captain_element: number | null
}

type FreeTransfersInputRow = {
  gw: number
  chipPlayed: string
  transfers: number
}

function normalizeGw(value: unknown): number | null {
  const gw = Number(value)
  if (!Number.isInteger(gw) || gw <= 0) return null
  return gw
}

function normalizeChipCode(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'wildcard') return 'WC'
  if (value === 'bboost') return 'BB'
  if (value === '3xc') return 'TC'
  if (value === 'freehit') return 'FH'
  if (value === 'manager' || value === 'assistant_manager') return 'AM'
  return null
}

function deriveFreeTransfersByGw(rows: FreeTransfersInputRow[]): Map<number, number> {
  const out = new Map<number, number>()
  if (rows.length === 0) return out

  // Preserve existing FT derivation behavior from transfers.astro (calculateFTs):
  // GW16 is treated as the first GW after the five-FT reset.
  const FIVE_FREE_TRANSFERS_RESET_GW = 16
  const MAX_FREE_TRANSFERS = 5

  const byGW = new Map<number, FreeTransfersInputRow>()
  rows.forEach((row) => byGW.set(row.gw, row))

  for (const row of rows) {
    const currentGw = Number(row.gw)
    let freeTransfersForGw = 1
    const previousGwRow = byGW.get(currentGw - 1)

    if (currentGw === FIVE_FREE_TRANSFERS_RESET_GW) {
      freeTransfersForGw = MAX_FREE_TRANSFERS
    } else if (currentGw === 1) {
      freeTransfersForGw = 0
    } else if (!previousGwRow) {
      freeTransfersForGw = 1
    } else {
      const previousChip = previousGwRow.chipPlayed || ''
      const previousFreeTransfers = Number(out.get(currentGw - 1) ?? 1)
      const previousTransfersMade = Number(previousGwRow.transfers)

      if (previousChip === 'WC' || previousChip === 'FH') {
        freeTransfersForGw = Math.max(1, previousFreeTransfers - previousTransfersMade)
      } else {
        freeTransfersForGw = Math.min(
          Math.max(1, previousFreeTransfers - previousTransfersMade + 1),
          MAX_FREE_TRANSFERS
        )
      }
    }
    out.set(currentGw, freeTransfersForGw)
  }

  return out
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

export function buildManagerGwSummaryCsv(rows: ManagerGwSummaryRow[]): string {
  const header = [
    'season',
    'gw',
    'entry_id',
    'entry_name',
    'player_name',
    'overall_rank',
    'overall_points',
    'points_on_bench',
    'points',
    'gw_rank',
    'event_transfers',
    'event_transfers_cost',
    'bank',
    'value',
    'free_transfers',
    'wildcard',
    'freehit',
    'bench_boost',
    'triple_captain',
    'assistant_manager',
    'captain_element',
    'vice_captain_element',
  ]

  const lines = rows.map((row) =>
    [
      row.season,
      row.gw,
      row.entry_id,
      row.entry_name,
      row.player_name,
      row.overall_rank,
      row.overall_points,
      row.points_on_bench,
      row.points,
      row.gw_rank,
      row.event_transfers,
      row.event_transfers_cost,
      row.bank,
      row.value,
      row.free_transfers,
      row.wildcard,
      row.freehit,
      row.bench_boost,
      row.triple_captain,
      row.assistant_manager,
      row.captain_element,
      row.vice_captain_element,
    ].map(csvCell).join(',')
  )

  return [header.join(','), ...lines].join('\n')
}

export async function fetchManagerGwSummaryRows(
  origin: string,
  entryId: number,
  season = 'current'
): Promise<ManagerGwSummaryRow[]> {
  try {
    const [entryRes, historyRes] = await Promise.all([
      fetch(`${origin}/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/history`, { cache: 'no-store' }),
    ])
    if (!entryRes.ok || !historyRes.ok) return []

    const [entryData, historyData] = await Promise.all([entryRes.json(), historyRes.json()])

    const entry_name = String(entryData?.name || '')
    const player_name = `${entryData?.player_first_name || ''} ${entryData?.player_last_name || ''}`.trim() || `Manager ${entryId}`

    const currentRows = Array.isArray(historyData?.current) ? historyData.current as FplHistoryCurrentRow[] : []
    const chips = Array.isArray(historyData?.chips) ? historyData.chips as FplHistoryChip[] : []

    const chipByGw = new Map<number, Set<string>>()
    for (const chip of chips) {
      const gw = normalizeGw(chip?.event)
      const code = normalizeChipCode(chip?.name ?? null)
      if (gw === null || !code) continue
      if (!chipByGw.has(gw)) chipByGw.set(gw, new Set<string>())
      chipByGw.get(gw)!.add(code)
    }

    const normalizedHistory = currentRows
      .map((row) => {
        const gw = normalizeGw(row?.event)
        if (gw === null) return null
        const chipSet = chipByGw.get(gw) ?? new Set<string>()
        const chipCode = chipSet.has('WC')
          ? 'WC'
          : chipSet.has('FH')
            ? 'FH'
            : chipSet.has('BB')
              ? 'BB'
              : chipSet.has('TC')
                ? 'TC'
                : chipSet.has('AM')
                  ? 'AM'
                  : ''
        return {
          gw,
          row,
          chipSet,
          chipCode,
        }
      })
      .filter((v): v is { gw: number; row: FplHistoryCurrentRow; chipSet: Set<string>; chipCode: string } => v !== null)
      .sort((a, b) => a.gw - b.gw)

    const freeTransfersByGw = deriveFreeTransfersByGw(
      normalizedHistory.map((item) => ({
        gw: item.gw,
        chipPlayed: item.chipCode,
        transfers: Number(item.row?.event_transfers) || 0,
      }))
    )

    const captainViceByGw = new Map<number, { captain: number | null; vice: number | null }>()

    await Promise.all(
      normalizedHistory.map(async ({ gw }) => {
        try {
          const picksRes = await fetch(`${origin}/api/fpl/entry/${entryId}/event/${gw}/picks`, { cache: 'no-store' })
          if (!picksRes.ok) {
            captainViceByGw.set(gw, { captain: null, vice: null })
            return
          }
          const picksData = await picksRes.json() as FplPicksResponse
          const picks = Array.isArray(picksData?.picks) ? picksData.picks : []
          const captainPick = picks.find((p) => p?.is_captain)
          const vicePick = picks.find((p) => p?.is_vice_captain)
          captainViceByGw.set(gw, {
            captain: Number.isInteger(Number(captainPick?.element)) ? Number(captainPick?.element) : null,
            vice: Number.isInteger(Number(vicePick?.element)) ? Number(vicePick?.element) : null,
          })
        } catch {
          captainViceByGw.set(gw, { captain: null, vice: null })
        }
      })
    )

    return normalizedHistory.map(({ gw, row, chipSet }) => {
      const capVice = captainViceByGw.get(gw) ?? { captain: null, vice: null }
      return {
        season,
        gw,
        entry_id: entryId,
        entry_name,
        player_name,
        overall_rank: Number(row?.overall_rank) || 0,
        overall_points: Number(row?.total_points) || 0,
        points_on_bench: Number(row?.points_on_bench) || 0,
        points: Number(row?.points) || 0,
        gw_rank: Number(row?.rank) || 0,
        event_transfers: Number(row?.event_transfers) || 0,
        event_transfers_cost: Number(row?.event_transfers_cost) || 0,
        bank: Number(row?.bank) || 0,
        value: Number(row?.value) || 0,
        free_transfers: Number(freeTransfersByGw.get(gw) ?? 0),
        wildcard: chipSet.has('WC'),
        freehit: chipSet.has('FH'),
        bench_boost: chipSet.has('BB'),
        triple_captain: chipSet.has('TC'),
        assistant_manager: chipSet.has('AM'),
        captain_element: capVice.captain,
        vice_captain_element: capVice.vice,
      }
    })
  } catch {
    return []
  }
}
