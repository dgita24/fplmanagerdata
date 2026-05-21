export type ChipCode = 'WC' | 'BB' | 'TC' | 'FH' | 'AM'

export type RawChipEntry = {
  name?: string | null
  event?: number | null
}

export type ChipGameweekSummary = {
  allChipGws: number[]
  byChip: Record<ChipCode, number[]>
}

export type ChipGameweekExportRow = {
  entryId: number
  managerName: string
  teamName: string
  allChipGws: number[]
  wildcardGws: number[]
  benchBoostGws: number[]
  tripleCaptainGws: number[]
  freeHitGws: number[]
  assistantManagerGws: number[]
}

const CHIP_NAME_MAP: Record<string, ChipCode> = {
  wildcard: 'WC',
  bboost: 'BB',
  '3xc': 'TC',
  freehit: 'FH',
  manager: 'AM',
  assistant_manager: 'AM',
}

function normalizeChipCode(value: string | null | undefined): ChipCode | null {
  if (!value) return null
  return CHIP_NAME_MAP[value] ?? null
}

function normalizeGw(value: number | null | undefined): number | null {
  const gw = Number(value)
  if (!Number.isInteger(gw) || gw <= 0) return null
  return gw
}

function uniqSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

export function extractChipGameweeks(chips: RawChipEntry[]): ChipGameweekSummary {
  const byChip: Record<ChipCode, number[]> = {
    WC: [],
    BB: [],
    TC: [],
    FH: [],
    AM: [],
  }

  for (const chip of chips) {
    const chipCode = normalizeChipCode(chip?.name)
    const gw = normalizeGw(chip?.event)
    if (!chipCode || gw === null) continue
    byChip[chipCode].push(gw)
  }

  const normalizedByChip: Record<ChipCode, number[]> = {
    WC: uniqSorted(byChip.WC),
    BB: uniqSorted(byChip.BB),
    TC: uniqSorted(byChip.TC),
    FH: uniqSorted(byChip.FH),
    AM: uniqSorted(byChip.AM),
  }

  return {
    byChip: normalizedByChip,
    allChipGws: uniqSorted([
      ...normalizedByChip.WC,
      ...normalizedByChip.BB,
      ...normalizedByChip.TC,
      ...normalizedByChip.FH,
      ...normalizedByChip.AM,
    ]),
  }
}

function csvCell(value: string | number): string {
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

function joinGws(gws: number[]): string {
  return gws.join(';')
}

export function buildChipGameweeksCsv(rows: ChipGameweekExportRow[]): string {
  const header = [
    'entry_id',
    'manager_name',
    'team_name',
    'all_chip_gws',
    'wildcard_gws',
    'bench_boost_gws',
    'triple_captain_gws',
    'free_hit_gws',
    'assistant_manager_gws',
  ]

  const lines = rows.map((row) => {
    return [
      row.entryId,
      row.managerName,
      row.teamName,
      joinGws(row.allChipGws),
      joinGws(row.wildcardGws),
      joinGws(row.benchBoostGws),
      joinGws(row.tripleCaptainGws),
      joinGws(row.freeHitGws),
      joinGws(row.assistantManagerGws),
    ].map(csvCell).join(',')
  })

  return [header.join(','), ...lines].join('\n')
}
