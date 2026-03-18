/**
 * Lab analysis: Chip Strategy
 *
 * For each manager in the lab group:
 *   - Records when each chip (WC, FH, BB, TC) was played
 *   - Records GW points achieved on that chip GW
 *   - Annotates whether the GW was a DGW or BGW (from bootstrap-static)
 *
 * Cross-group summary:
 *   - For each chip type: average GW points, DGW usage %, all usages
 *
 * Reads from: lab_manager_gw_snapshots + FPL bootstrap-static
 *
 * Usage:
 *   npx tsx src/lab/analysis/chip-strategy.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 * Output: private/lab/chip-strategy.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from '../lab-manager-ids.js'
import { createServiceClient } from '../supabase-server.js'
import { fetchBootstrap } from '../fpl-api.js'

const OUT_DIR  = path.resolve('private/lab')
const OUT_FILE = path.join(OUT_DIR, 'chip-strategy.json')

const CHIP_LABELS: Record<string, string> = {
  wildcard: 'Wildcard (WC)',
  freehit:  'Free Hit (FH)',
  bboost:   'Bench Boost (BB)',
  '3xc':    'Triple Captain (TC)',
}

interface SnapshotRow {
  entry_id:    number
  gw:          number
  chip_played: string | null
  gw_points:   number
}

interface ChipUsage {
  entry_id:  number
  gw:        number
  gw_points: number
  is_dgw:    boolean
  is_bgw:    boolean
}

interface ChipTypeSummary {
  chip:           string
  label:          string
  usages:         ChipUsage[]
  avg_gw_points:  number | null
  dgw_usage_pct:  number
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Chip Strategy               ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  // Load only rows where a chip was played
  const { data: snapshots, error } = await supabase
    .from('lab_manager_gw_snapshots')
    .select('entry_id, gw, chip_played, gw_points')
    .in('entry_id', managerIds)
    .not('chip_played', 'is', null)
    .order('entry_id')
    .order('gw')

  if (error) throw new Error(`lab_manager_gw_snapshots: ${error.message}`)

  // Fetch bootstrap for DGW/BGW metadata
  console.log('Fetching bootstrap-static for GW metadata…')
  const bootstrap = await fetchBootstrap()

  const gwMeta = new Map<number, { is_dgw: boolean; is_bgw: boolean }>()
  for (const ev of bootstrap.events) {
    gwMeta.set(ev.id, {
      is_dgw: ev.is_dgw === true,
      is_bgw: ev.is_bgw === true,
    })
  }

  // Group by manager
  const chipsByManager = new Map<
    number,
    Array<{
      gw:        number
      chip:      string
      label:     string
      gw_points: number
      is_dgw:    boolean
      is_bgw:    boolean
    }>
  >()

  for (const row of (snapshots as SnapshotRow[])) {
    if (!row.chip_played) continue
    const meta  = gwMeta.get(row.gw)
    const entry = {
      gw:        row.gw,
      chip:      row.chip_played,
      label:     CHIP_LABELS[row.chip_played] ?? row.chip_played,
      gw_points: row.gw_points,
      is_dgw:    meta?.is_dgw ?? false,
      is_bgw:    meta?.is_bgw ?? false,
    }
    const existing = chipsByManager.get(row.entry_id) ?? []
    existing.push(entry)
    chipsByManager.set(row.entry_id, existing)
  }

  // Cross-group chip type analysis
  const chipTypeMap = new Map<string, ChipTypeSummary>()

  for (const [entryId, chips] of chipsByManager.entries()) {
    for (const c of chips) {
      if (!chipTypeMap.has(c.chip)) {
        chipTypeMap.set(c.chip, {
          chip:          c.chip,
          label:         c.label,
          usages:        [],
          avg_gw_points: null,
          dgw_usage_pct: 0,
        })
      }
      chipTypeMap.get(c.chip)!.usages.push({
        entry_id:  entryId,
        gw:        c.gw,
        gw_points: c.gw_points,
        is_dgw:    c.is_dgw,
        is_bgw:    c.is_bgw,
      })
    }
  }

  // Compute averages and DGW pct per chip type
  const crossGroupChips: Record<string, ChipTypeSummary> = {}
  for (const [chip, data] of chipTypeMap.entries()) {
    const returns    = data.usages.map(u => u.gw_points)
    const dgwCount   = data.usages.filter(u => u.is_dgw).length
    data.avg_gw_points =
      returns.length > 0
        ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 10) / 10
        : null
    data.dgw_usage_pct =
      data.usages.length > 0
        ? Math.round((dgwCount / data.usages.length) * 1000) / 10
        : 0
    crossGroupChips[chip] = data
  }

  const managerResults = managerIds.map(entryId => ({
    entry_id:   entryId,
    chips_used: (chipsByManager.get(entryId) ?? []).map(c => c.chip),
    chips:      chipsByManager.get(entryId) ?? [],
  }))

  const output = {
    generated_at:        new Date().toISOString(),
    manager_count:       managerIds.length,
    note:                'is_dgw/is_bgw sourced from bootstrap-static events; field may be absent from FPL API for some seasons.',
    manager_results:     managerResults,
    cross_group_chips:   crossGroupChips,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')

  const totalChipUsages = managerResults.reduce((s, m) => s + m.chips.length, 0)
  console.log(`\n✅ Output: ${OUT_FILE}`)
  console.log(`   Total chip usages recorded: ${totalChipUsages}`)
  console.log(`   Chip types seen: ${[...chipTypeMap.keys()].join(', ') || '(none yet)'}`)
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  run().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
