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
  element_out_name: string
}

type FplTransferRow = {
  event?: number
  time?: string
  element_in?: number
  element_out?: number
  element_in_cost?: number
  element_out_cost?: number
}

function csvCell(value: string | number): string {
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
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
    'element_out_name',
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
      row.element_out_name,
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
    const [entryRes, transfersRes, bootstrapRes] = await Promise.all([
      fetch(`${origin}/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/entry/${entryId}/transfers`, { cache: 'no-store' }),
      fetch(`${origin}/api/fpl/bootstrap-static`, { cache: 'no-store' }),
    ])

    if (!entryRes.ok || !transfersRes.ok || !bootstrapRes.ok) return []

    const [entryData, transfersData, bootstrapData] = await Promise.all([
      entryRes.json(),
      transfersRes.json(),
      bootstrapRes.json(),
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
    return transfers
      .map((row) => {
        const gw = Number(row?.event)
        const elementIn = Number(row?.element_in)
        const elementOut = Number(row?.element_out)
        if (!Number.isInteger(gw) || gw <= 0) return null
        if (!Number.isInteger(elementIn) || elementIn <= 0) return null
        if (!Number.isInteger(elementOut) || elementOut <= 0) return null

        return {
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
          element_out_name: playerNameMap.get(elementOut) || `Player ${elementOut}`,
        }
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
