/**
 * Lab analysis: Formation and Value Accumulation
 *
 * For each manager in the lab group:
 *   - Team value (squad value + bank) from GW1 to GW15
 *   - Formation usage across the season (from starting XI positions)
 *   - Bench structure by element type (GK/DEF/MID/FWD) per GW
 *
 * Cross-group:
 *   - Average team value per GW (GW1–15)
 *   - Most common formations
 *   - Average bench value by type
 *
 * Formation is derived by counting DEF/MID/FWD in positions 1–11
 * (position 1 = GK, positions 2–11 = outfield).
 * Bench = positions 12–15.
 *
 * Reads from: lab_manager_gw_picks, lab_manager_gw_snapshots
 *
 * Usage:
 *   npx tsx src/lab/analysis/formation-value.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 * Output: private/lab/formation-value.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from '../lab-manager-ids.js'
import { createServiceClient } from '../supabase-server.js'
import { fetchBootstrap } from '../fpl-api.js'

const OUT_DIR  = path.resolve('private/lab')
const OUT_FILE = path.join(OUT_DIR, 'formation-value.json')

const VALUE_GWS = 15   // GW1–15 for value accumulation analysis

interface PickRow {
  entry_id:      number
  gw:            number
  element:       number
  position:      number
  is_captain:    boolean
  is_vice_captain: boolean
}

interface SnapshotRow {
  entry_id: number
  gw:       number
  value:    number
  bank:     number
}

function deriveFormation(outfieldElements: Array<{ element_type: number }>): string {
  const counts = { def: 0, mid: 0, fwd: 0 }
  for (const e of outfieldElements) {
    if (e.element_type === 2) counts.def++
    else if (e.element_type === 3) counts.mid++
    else if (e.element_type === 4) counts.fwd++
  }
  return `${counts.def}-${counts.mid}-${counts.fwd}`
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Formation & Value           ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  console.log('Fetching bootstrap-static for element types…')
  const bootstrap  = await fetchBootstrap()
  const elementMap = new Map(bootstrap.elements.map(e => [e.id, e]))

  // Load all picks
  const { data: picks, error: pickErr } = await supabase
    .from('lab_manager_gw_picks')
    .select('entry_id, gw, element, position, is_captain, is_vice_captain')
    .in('entry_id', managerIds)
    .order('entry_id')
    .order('gw')
    .order('position')

  if (pickErr) throw new Error(`lab_manager_gw_picks: ${pickErr.message}`)

  // Load snapshots (for value + bank)
  const { data: snapshots, error: snapErr } = await supabase
    .from('lab_manager_gw_snapshots')
    .select('entry_id, gw, value, bank')
    .in('entry_id', managerIds)
    .order('entry_id')
    .order('gw')

  if (snapErr) throw new Error(`lab_manager_gw_snapshots: ${snapErr.message}`)

  // Index snapshots
  const snapIndex = new Map<number, Map<number, SnapshotRow>>()
  for (const s of (snapshots as SnapshotRow[])) {
    if (!snapIndex.has(s.entry_id)) snapIndex.set(s.entry_id, new Map())
    snapIndex.get(s.entry_id)!.set(s.gw, s)
  }

  // Index picks: entry → gw → PickRow[]
  const pickIndex = new Map<number, Map<number, PickRow[]>>()
  for (const p of (picks as PickRow[])) {
    if (!pickIndex.has(p.entry_id)) pickIndex.set(p.entry_id, new Map())
    const gwMap = pickIndex.get(p.entry_id)!
    if (!gwMap.has(p.gw)) gwMap.set(p.gw, [])
    gwMap.get(p.gw)!.push(p)
  }

  // Per-manager analysis
  interface ManagerGwRecord {
    gw:             number
    team_value:     number | null
    bank:           number | null
    formation:      string | null
    bench_structure: string | null  // e.g. "GK,DEF,MID,MID"
  }

  interface ManagerResult {
    entry_id:          number
    gw_records:        ManagerGwRecord[]
    formation_usage:   Record<string, number>
    avg_value_gw1_15:  number | null
  }

  const managerResults: ManagerResult[] = []

  for (const entryId of managerIds) {
    const gwPickMap = pickIndex.get(entryId) ?? new Map<number, PickRow[]>()
    const gwSnapMap = snapIndex.get(entryId) ?? new Map<number, SnapshotRow>()

    const allGws = [...new Set([...gwPickMap.keys(), ...gwSnapMap.keys()])].sort((a, b) => a - b)
    const formationUsage: Record<string, number> = {}
    const gwRecords: ManagerGwRecord[] = []

    const earlyValues: number[] = []

    for (const gw of allGws) {
      const snap = gwSnapMap.get(gw)
      const gwPicks = gwPickMap.get(gw) ?? []

      // Starting XI = positions 1–11
      const startingXI = gwPicks.filter(p => p.position >= 1 && p.position <= 11)
      const bench      = gwPicks.filter(p => p.position >= 12 && p.position <= 15)
        .sort((a, b) => a.position - b.position)

      // Formation
      const outfield = startingXI.filter(p => {
        const el = elementMap.get(p.element)
        return el && el.element_type !== 1  // not GK
      }).map(p => ({ element_type: elementMap.get(p.element)?.element_type ?? 0 }))

      let formation: string | null = null
      if (outfield.length >= 10) {
        formation = deriveFormation(outfield)
        formationUsage[formation] = (formationUsage[formation] ?? 0) + 1
      }

      // Bench structure
      const benchTypeNames: Record<number, string> = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }
      const benchStructure = bench.length > 0
        ? bench.map(p => benchTypeNames[elementMap.get(p.element)?.element_type ?? 0] ?? '?').join(',')
        : null

      // Team value (in tenths of £m, e.g. 1000 = £100m)
      const teamValue = snap ? snap.value + snap.bank : null

      if (gw <= VALUE_GWS && teamValue !== null) earlyValues.push(teamValue)

      gwRecords.push({
        gw,
        team_value:      teamValue,
        bank:            snap?.bank ?? null,
        formation,
        bench_structure: benchStructure,
      })
    }

    const avgValueGw1_15 =
      earlyValues.length > 0
        ? Math.round((earlyValues.reduce((a, b) => a + b, 0) / earlyValues.length) * 10) / 10
        : null

    managerResults.push({
      entry_id:         entryId,
      gw_records:       gwRecords,
      formation_usage:  formationUsage,
      avg_value_gw1_15: avgValueGw1_15,
    })
  }

  // Cross-group value per GW (GW1–15)
  const groupValueByGw: Record<number, number[]> = {}
  for (const mgr of managerResults) {
    for (const rec of mgr.gw_records) {
      if (rec.gw <= VALUE_GWS && rec.team_value !== null) {
        if (!groupValueByGw[rec.gw]) groupValueByGw[rec.gw] = []
        groupValueByGw[rec.gw]!.push(rec.team_value)
      }
    }
  }

  const avgValuePerGw = Object.entries(groupValueByGw)
    .map(([gw, values]) => ({
      gw:         Number(gw),
      avg_value:  Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
      n:          values.length,
    }))
    .sort((a, b) => a.gw - b.gw)

  // Cross-group formation frequency
  const allFormations: Record<string, number> = {}
  for (const mgr of managerResults) {
    for (const [form, count] of Object.entries(mgr.formation_usage)) {
      allFormations[form] = (allFormations[form] ?? 0) + count
    }
  }

  const topFormations = Object.entries(allFormations)
    .map(([f, c]) => ({ formation: f, count: c }))
    .sort((a, b) => b.count - a.count)

  const output = {
    generated_at:    new Date().toISOString(),
    manager_count:   managerIds.length,
    value_note:      `value and bank in FPL tenths (e.g. 1050 = £105.0m). avg_value_gw1_15 covers GW1–${VALUE_GWS} only.`,
    cross_group: {
      avg_value_per_gw: avgValuePerGw,
      top_formations:   topFormations,
    },
    manager_results: managerResults,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')

  console.log(`\n✅ Output: ${OUT_FILE}`)
  console.log(`   Top formation: ${topFormations[0]?.formation ?? 'n/a'} (${topFormations[0]?.count ?? 0} GWs across group)`)
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
