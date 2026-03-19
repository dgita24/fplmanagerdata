/**
 * Lab: Generate human-friendly reports (Markdown + CSV) from analysis JSON outputs.
 *
 * Reads from: private/lab/*.json
 * Writes to:  private/lab/reports/*
 *
 * Usage (Windows recommended):
 *   npx tsx src/lab/analysis/generate-reports.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const LAB_DIR = path.resolve('private', 'lab')
const REPORTS_DIR = path.join(LAB_DIR, 'reports')

const INPUT_FILES = {
  transfer: path.join(LAB_DIR, 'transfer-strategy.json'),
  template: path.join(LAB_DIR, 'template-evolution.json'),
  captaincy: path.join(LAB_DIR, 'captaincy.json'),
  chips: path.join(LAB_DIR, 'chip-strategy.json'),
  formation: path.join(LAB_DIR, 'formation-value.json'),
} as const

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true })
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as T
}

function writeText(filePath: string, contents: string) {
  fs.writeFileSync(filePath, contents, 'utf8')
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function writeCsv(filePath: string, headers: string[], rows: Array<Record<string, unknown>>) {
  const lines: string[] = []
  lines.push(headers.map(csvEscape).join(','))
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','))
  }
  writeText(filePath, lines.join('\n') + '\n')
}

// -----------------------------------------------------------------------------
// Transfer Strategy
// -----------------------------------------------------------------------------

type TransferStrategyJson = {
  generated_at: string
  manager_count: number
  premium_threshold: string
  blank_threshold: string
  note: string
  cross_group: {
    avg_hits_per_gw: number
    kneejerk_rate_pct: number
    total_premium_sells: number
    sells_with_history: number
  }
  manager_results: Array<{
    entry_id: number
    gws_played: number
    total_hits: number
    hits_per_gw: number
    kneejerk_count: number
    patient_count: number
    kneejerk_rate_pct: number
    aggressiveness: string
    premium_sells: Array<{
      gw: number
      element_out: number
      element_name: string
      sell_price: number | null
      blanks_before_sell: number | null
      is_kneejerk: boolean | null
      player_history_available: boolean
    }>
  }>
}

function generateTransferReports(data: TransferStrategyJson) {
  const rowsManagers = data.manager_results.map(m => ({
    entry_id: m.entry_id,
    gws_played: m.gws_played,
    total_hits: m.total_hits,
    hits_per_gw: m.hits_per_gw,
    kneejerk_count: m.kneejerk_count,
    patient_count: m.patient_count,
    kneejerk_rate_pct: m.kneejerk_rate_pct,
    aggressiveness: m.aggressiveness,
  }))

  writeCsv(
    path.join(REPORTS_DIR, 'transfer-managers.csv'),
    [
      'entry_id',
      'gws_played',
      'total_hits',
      'hits_per_gw',
      'kneejerk_count',
      'patient_count',
      'kneejerk_rate_pct',
      'aggressiveness',
    ],
    rowsManagers,
  )

  const rowsSells = data.manager_results.flatMap(m =>
    m.premium_sells.map(s => ({
      entry_id: m.entry_id,
      gw: s.gw,
      element_out: s.element_out,
      element_name: s.element_name,
      sell_price: s.sell_price,
      blanks_before_sell: s.blanks_before_sell,
      is_kneejerk: s.is_kneejerk,
      player_history_available: s.player_history_available,
    })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'transfer-premium-sells.csv'),
    [
      'entry_id',
      'gw',
      'element_out',
      'element_name',
      'sell_price',
      'blanks_before_sell',
      'is_kneejerk',
      'player_history_available',
    ],
    rowsSells,
  )

  // Markdown summary bits
  const sellCounts = new Map<string, number>()
  for (const r of rowsSells) {
    const name = String(r.element_name)
    sellCounts.set(name, (sellCounts.get(name) ?? 0) + 1)
  }
  const topSold = [...sellCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

  const md = [
    `## ?? Transfer Strategy`,
    ``,
    `**Group:** ${data.manager_count} managers`,
    `- Avg hits per GW: **${data.cross_group.avg_hits_per_gw}**`,
    `- Kneejerk rate (premium sells after <=2 blanks): **${data.cross_group.kneejerk_rate_pct}%**`,
    `- Premium sells: **${data.cross_group.total_premium_sells}** (history available for **${data.cross_group.sells_with_history}**)`,
    ``,
    `**Top premium sells (count):**`,
    ...topSold.map(([name, count]) => `- ${name}: ${count}`),
    ``,
  ].join('\n')

  return md
}

// -----------------------------------------------------------------------------
// Template Evolution
// -----------------------------------------------------------------------------

type TemplateEvolutionJson = {
  generated_at: string
  manager_count: number
  gws_analysed: number
  pivot_threshold: string
  gw_snapshots: Array<{
    gw: number
    ownership: Record<string, number>
    captain_pct: Record<string, number>
    top_owned: Array<{ element: number; name: string; eo_pct: number }>
    top_captained: Array<{ element: number; name: string; captain_pct: number }>
  }>
  pivots: Array<{
    gw_from: number
    gw_to: number
    element: number
    name: string
    eo_from: number
    eo_to: number
    swing: number
    direction: 'onto' | 'off'
  }>
}

function generateTemplateReports(data: TemplateEvolutionJson) {
  const topOwnedRows = data.gw_snapshots.flatMap(s =>
    s.top_owned.map((r, idx) => ({
      gw: s.gw,
      rank: idx + 1,
      element: r.element,
      name: r.name,
      eo_pct: r.eo_pct,
    })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'template-gw-top-owned.csv'),
    ['gw', 'rank', 'element', 'name', 'eo_pct'],
    topOwnedRows,
  )

  const topCaptainedRows = data.gw_snapshots.flatMap(s =>
    s.top_captained.map((r, idx) => ({
      gw: s.gw,
      rank: idx + 1,
      element: r.element,
      name: r.name,
      captain_pct: r.captain_pct,
    })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'template-gw-top-captained.csv'),
    ['gw', 'rank', 'element', 'name', 'captain_pct'],
    topCaptainedRows,
  )

  const pivotRows = data.pivots.map(p => ({
    gw_from: p.gw_from,
    gw_to: p.gw_to,
    element: p.element,
    name: p.name,
    eo_from: p.eo_from,
    eo_to: p.eo_to,
    swing: p.swing,
    direction: p.direction,
  }))

  writeCsv(
    path.join(REPORTS_DIR, 'template-pivots.csv'),
    ['gw_from', 'gw_to', 'element', 'name', 'eo_from', 'eo_to', 'swing', 'direction'],
    pivotRows,
  )

  const md = [
    `## ?? Template Evolution`,
    ``,
    `**Group:** ${data.manager_count} managers`,
    `- GWs analysed: **${data.gws_analysed}**`,
    `- Pivot threshold: **${data.pivot_threshold}**`,
    `- Pivots detected: **${data.pivots.length}**`,
    ``,
  ].join('\n')

  return md
}

// -----------------------------------------------------------------------------
// Captaincy
// -----------------------------------------------------------------------------

type CaptaincyJson = {
  generated_at: string
  manager_count: number
  gws_analysed: number
  note: string
  gw_results: Array<{
    gw: number
    managers_in_gw: number
    consensus_element: number
    consensus_name: string
    consensus_pct: number
    differential_rate_pct: number
    captain_breakdown: Array<{
      element: number
      name: string
      count: number
      pct: number
      avg_manager_gw_pts: number | null
    }>
  }>
  manager_results: Array<{
    entry_id: number
    season_captaincies: Array<{ gw: number; element: number; name: string; manager_gw_pts: number }>
    consensus_count: number
    differential_count: number
    differential_rate_pct: number
  }>
}

function generateCaptaincyReports(data: CaptaincyJson) {
  const gwSummaryRows = data.gw_results.map(r => ({
    gw: r.gw,
    managers_in_gw: r.managers_in_gw,
    consensus_element: r.consensus_element,
    consensus_name: r.consensus_name,
    consensus_pct: r.consensus_pct,
    differential_rate_pct: r.differential_rate_pct,
    unique_captains: r.captain_breakdown.length,
  }))

  writeCsv(
    path.join(REPORTS_DIR, 'captaincy-gw-summary.csv'),
    [
      'gw',
      'managers_in_gw',
      'consensus_element',
      'consensus_name',
      'consensus_pct',
      'differential_rate_pct',
      'unique_captains',
    ],
    gwSummaryRows,
  )

  const managerSummaryRows = data.manager_results.map(m => ({
    entry_id: m.entry_id,
    consensus_count: m.consensus_count,
    differential_count: m.differential_count,
    differential_rate_pct: m.differential_rate_pct,
  }))

  writeCsv(
    path.join(REPORTS_DIR, 'captaincy-manager-summary.csv'),
    ['entry_id', 'consensus_count', 'differential_count', 'differential_rate_pct'],
    managerSummaryRows,
  )

  const managerPickRows = data.manager_results.flatMap(m =>
    m.season_captaincies.map(c => ({
      entry_id: m.entry_id,
      gw: c.gw,
      element: c.element,
      name: c.name,
      manager_gw_pts: c.manager_gw_pts,
    })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'captaincy-manager-picks.csv'),
    ['entry_id', 'gw', 'element', 'name', 'manager_gw_pts'],
    managerPickRows,
  )

  const avgConsensusPct =
    data.gw_results.length > 0
      ? Math.round((data.gw_results.reduce((s, r) => s + r.consensus_pct, 0) / data.gw_results.length) * 10) / 10
      : 0

  const md = [
    `## © Captaincy (Group Risk Profile)`,
    ``,
    `**Group:** ${data.manager_count} managers`,
    `- GWs analysed: **${data.gws_analysed}**`,
    `- Avg consensus share: **${avgConsensusPct}%**`,
    ``,
    `**Interpretation:** differential_rate_pct is % of managers *not* captaining the group consensus pick.`,
    ``,
  ].join('\n')

  return md
}

// -----------------------------------------------------------------------------
// Chip Strategy
// -----------------------------------------------------------------------------

type ChipStrategyJson = {
  generated_at: string
  manager_count: number
  note: string
  manager_results: Array<{
    entry_id: number
    chips_used: string[]
    chips: Array<{
      gw: number
      chip: string
      label: string
      gw_points: number
      is_dgw: boolean
      is_bgw: boolean
    }>
  }>
  cross_group_chips: Record<
    string,
    {
      chip: string
      label: string
      usages: Array<{ entry_id: number; gw: number; gw_points: number; is_dgw: boolean; is_bgw: boolean }>
      avg_gw_points: number | null
      dgw_usage_pct: number
    }
  >
}

function generateChipReports(data: ChipStrategyJson) {
  const usageRows = Object.values(data.cross_group_chips).flatMap(ch =>
    ch.usages.map(u => ({
      chip: ch.chip,
      label: ch.label,
      entry_id: u.entry_id,
      gw: u.gw,
      gw_points: u.gw_points,
      is_dgw: u.is_dgw,
      is_bgw: u.is_bgw,
    })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'chip-usages.csv'),
    ['chip', 'label', 'entry_id', 'gw', 'gw_points', 'is_dgw', 'is_bgw'],
    usageRows,
  )

  const summaryRows = Object.values(data.cross_group_chips).map(ch => ({
    chip: ch.chip,
    label: ch.label,
    usage_count: ch.usages.length,
    avg_gw_points: ch.avg_gw_points,
    dgw_usage_pct: ch.dgw_usage_pct,
  }))

  writeCsv(
    path.join(REPORTS_DIR, 'chip-summary.csv'),
    ['chip', 'label', 'usage_count', 'avg_gw_points', 'dgw_usage_pct'],
    summaryRows,
  )

  const md = [
    `## ??? Chip Strategy`,
    ``,
    `**Group:** ${data.manager_count} managers`,
    `- Chip usages recorded: **${usageRows.length}**`,
    `- Chip types seen: **${Object.keys(data.cross_group_chips).length}**`,
    ``,
  ].join('\n')

  return md
}

// -----------------------------------------------------------------------------
// Formation & Value
// -----------------------------------------------------------------------------

type FormationValueJson = {
  generated_at: string
  manager_count: number
  value_note: string
  cross_group: {
    avg_value_per_gw: Array<{ gw: number; avg_value: number; n: number }>
    top_formations: Array<{ formation: string; count: number }>
  }
  manager_results: Array<{
    entry_id: number
    avg_value_gw1_15: number | null
    formation_usage: Record<string, number>
    gw_records: Array<{
      gw: number
      team_value: number | null
      bank: number | null
      formation: string | null
      bench_structure: string | null
    }>
  }>
}

function generateFormationReports(data: FormationValueJson) {
  const managerSummaryRows = data.manager_results.map(m => {
    const topFormation = Object.entries(m.formation_usage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    return {
      entry_id: m.entry_id,
      avg_value_gw1_15: m.avg_value_gw1_15,
      top_formation: topFormation,
    }
  })

  writeCsv(
    path.join(REPORTS_DIR, 'formation-manager-summary.csv'),
    ['entry_id', 'avg_value_gw1_15', 'top_formation'],
    managerSummaryRows,
  )

  writeCsv(
    path.join(REPORTS_DIR, 'formation-top-formations.csv'),
    ['formation', 'count'],
    data.cross_group.top_formations.map(f => ({ formation: f.formation, count: f.count })),
  )

  writeCsv(
    path.join(REPORTS_DIR, 'formation-avg-value-per-gw.csv'),
    ['gw', 'avg_value', 'n'],
    data.cross_group.avg_value_per_gw.map(v => ({ gw: v.gw, avg_value: v.avg_value, n: v.n })),
  )

  const md = [
    `## ?? Formation & Value (GW1–15 focus)`,
    ``,
    `**Group:** ${data.manager_count} managers`,
    `- ${data.value_note}`,
    ``,
    `**Most common formations (top 5):**`,
    ...data.cross_group.top_formations.slice(0, 5).map(f => `- ${f.formation}: ${f.count}`),
    ``,
  ].join('\n')

  return md
}

// -----------------------------------------------------------------------------
// Main
// -------------------------------------------------???---------------------------

function run(): void {
  console.log('----------------------------------------')
  console.log('  Lab: Generate Reports (MD + CSV)      ')
  console.log('----------------------------------------')

  ensureDir(REPORTS_DIR)

  const transfer = readJsonIfExists<TransferStrategyJson>(INPUT_FILES.transfer)
  const template = readJsonIfExists<TemplateEvolutionJson>(INPUT_FILES.template)
  const captaincy = readJsonIfExists<CaptaincyJson>(INPUT_FILES.captaincy)
  const chips = readJsonIfExists<ChipStrategyJson>(INPUT_FILES.chips)
  const formation = readJsonIfExists<FormationValueJson>(INPUT_FILES.formation)

  const missing: string[] = []
  for (const [k, v] of Object.entries(INPUT_FILES)) {
    if (!fs.existsSync(v)) missing.push(`${k}: ${v}`)
  }

  const sections: string[] = []
  sections.push(`# FPL Lab Report`)
  sections.push(``)
  sections.push(`Generated at: ${new Date().toISOString()}`)
  sections.push(``)
  if (missing.length > 0) {
    sections.push(`## ?? Missing inputs`)
    sections.push(`The following JSON files were not found, so those report sections were skipped:`)
    for (const m of missing) sections.push(`- ${m}`)
    sections.push(``)
  }

  if (transfer) sections.push(generateTransferReports(transfer))
  if (template) sections.push(generateTemplateReports(template))
  if (captaincy) sections.push(generateCaptaincyReports(captaincy))
  if (chips) sections.push(generateChipReports(chips))
  if (formation) sections.push(generateFormationReports(formation))

  writeText(path.join(REPORTS_DIR, 'lab-summary.md'), sections.join('\n'))

  console.log(`\n? Wrote: ${path.join(REPORTS_DIR, 'lab-summary.md')}`)
  console.log(`? Wrote CSVs into: ${REPORTS_DIR}`)
  if (missing.length > 0) {
    console.log(`\n?? Some inputs were missing; re-run analyses then re-run this script.`)
  }
}

run()
