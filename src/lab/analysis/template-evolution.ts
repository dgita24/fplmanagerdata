/**
 * Lab analysis: Template Evolution
 *
 * For each GW:
 *   - Effective ownership (EO) of every player within the analysed group
 *   - Captain pick frequency within the group
 *   - Group pivots: players where ownership swings >= 20 pp between consecutive GWs
 *
 * Reads from: lab_manager_gw_picks
 *
 * Usage:
 *   npx tsx src/lab/analysis/template-evolution.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 * Output: private/lab/template-evolution.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from '../lab-manager-ids.js'
import { createServiceClient } from '../supabase-server.js'
import { fetchBootstrap } from '../fpl-api.js'

const OUT_DIR  = path.resolve('private/lab')
const OUT_FILE = path.join(OUT_DIR, 'template-evolution.json')

/** Minimum ownership swing (pp) between GWs to count as a group pivot. */
const PIVOT_THRESHOLD_PP = 20

interface PickRow {
  entry_id:       number
  gw:             number
  element:        number
  multiplier:     number
  is_captain:     boolean
  position:       number
}

interface GwSnapshot {
  gw:                  number
  ownership:           Record<number, number>   // element_id → EO %
  captain_pct:         Record<number, number>   // element_id → captain %
  top_owned:           Array<{ element: number; name: string; eo_pct: number }>
  top_captained:       Array<{ element: number; name: string; captain_pct: number }>
}

interface Pivot {
  gw_from:    number
  gw_to:      number
  element:    number
  name:       string
  eo_from:    number
  eo_to:      number
  swing:      number
  direction:  'onto' | 'off'
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Template Evolution          ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  console.log('Fetching bootstrap-static for element names…')
  const bootstrap  = await fetchBootstrap()
  const elementMap = new Map(bootstrap.elements.map(e => [e.id, e]))

  // Load all picks (starting XI + bench), ordered by gw then entry
  const { data: picks, error } = await supabase
    .from('lab_manager_gw_picks')
    .select('entry_id, gw, element, multiplier, is_captain, position')
    .in('entry_id', managerIds)
    .order('gw')
    .order('entry_id')

  if (error) throw new Error(`lab_manager_gw_picks: ${error.message}`)

  const allPicks = picks as PickRow[]
  const gwSet = [...new Set(allPicks.map(p => p.gw))].sort((a, b) => a - b)

  const gwSnapshots: GwSnapshot[] = []

  for (const gw of gwSet) {
    const gwPicks   = allPicks.filter(p => p.gw === gw)
    const managersInGw = new Set(gwPicks.map(p => p.entry_id))
    const n         = managersInGw.size
    if (n === 0) continue

    // EO: element is owned iff it's in the squad (position 1–15);
    // captains count double (multiplier = 2 or 3 for TC)
    const eoMap      = new Map<number, number>()  // element → effective squad count
    const captainMap = new Map<number, number>()  // element → captain count

    for (const pick of gwPicks) {
      // Squad ownership (position 1–15 = in squad)
      eoMap.set(pick.element, (eoMap.get(pick.element) ?? 0) + 1)

      // Captain
      if (pick.is_captain) {
        captainMap.set(pick.element, (captainMap.get(pick.element) ?? 0) + 1)
      }
    }

    const ownershipPct: Record<number, number> = {}
    for (const [el, count] of eoMap.entries()) {
      ownershipPct[el] = Math.round((count / n) * 1000) / 10
    }

    const captainPct: Record<number, number> = {}
    for (const [el, count] of captainMap.entries()) {
      captainPct[el] = Math.round((count / n) * 1000) / 10
    }

    const sortedOwnership = Object.entries(ownershipPct)
      .map(([el, pct]) => ({ element: Number(el), name: elementMap.get(Number(el))?.web_name ?? `#${el}`, eo_pct: pct }))
      .sort((a, b) => b.eo_pct - a.eo_pct)

    const sortedCaptain = Object.entries(captainPct)
      .map(([el, pct]) => ({ element: Number(el), name: elementMap.get(Number(el))?.web_name ?? `#${el}`, captain_pct: pct }))
      .sort((a, b) => b.captain_pct - a.captain_pct)

    gwSnapshots.push({
      gw,
      ownership:     ownershipPct,
      captain_pct:   captainPct,
      top_owned:     sortedOwnership.slice(0, 20),
      top_captained: sortedCaptain.slice(0, 10),
    })
  }

  // Detect pivots between consecutive GWs
  const pivots: Pivot[] = []

  for (let i = 1; i < gwSnapshots.length; i++) {
    const prev = gwSnapshots[i - 1]!
    const curr = gwSnapshots[i]!

    // All elements that appeared in either GW
    const elements = new Set([
      ...Object.keys(prev.ownership).map(Number),
      ...Object.keys(curr.ownership).map(Number),
    ])

    for (const el of elements) {
      const eoFrom = prev.ownership[el] ?? 0
      const eoTo   = curr.ownership[el] ?? 0
      const swing  = eoTo - eoFrom

      if (Math.abs(swing) >= PIVOT_THRESHOLD_PP) {
        pivots.push({
          gw_from:   prev.gw,
          gw_to:     curr.gw,
          element:   el,
          name:      elementMap.get(el)?.web_name ?? `#${el}`,
          eo_from:   eoFrom,
          eo_to:     eoTo,
          swing:     Math.round(swing * 10) / 10,
          direction: swing > 0 ? 'onto' : 'off',
        })
      }
    }
  }

  const output = {
    generated_at:    new Date().toISOString(),
    manager_count:   managerIds.length,
    gws_analysed:    gwSet.length,
    pivot_threshold: `>= ${PIVOT_THRESHOLD_PP}pp swing between GWs`,
    gw_snapshots:    gwSnapshots,
    pivots:          pivots.sort((a, b) => a.gw_to - b.gw_to || Math.abs(b.swing) - Math.abs(a.swing)),
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')

  console.log(`\n✅ Output: ${OUT_FILE}`)
  console.log(`   GWs analysed: ${gwSet.length}`)
  console.log(`   Group pivots detected: ${pivots.length}`)
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
