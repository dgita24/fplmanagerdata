/**
 * Lab analysis: Captaincy Variance & Risk
 *
 * For each GW:
 *   - Captain picks within the analysed group (element, name, count, %)
 *   - Consensus % (most-picked captain's share)
 *   - Differential rate (% of managers captaining someone other than the consensus)
 *   - Average GW points returned by the captain pick (from snapshots — proxy via total gw_points)
 *
 * Per-manager:
 *   - All captain choices across the season
 *   - How often they followed group consensus vs. went differential
 *
 * Note: GW points in lab_manager_gw_snapshots are the manager's *total* GW score
 * (captain multiplier already included in FPL scoring).  True captain-only return
 * is not directly available without live fixture data, so we report manager GW score
 * as a proxy and flag this clearly in the output.
 *
 * Reads from: lab_manager_gw_picks, lab_manager_gw_snapshots
 *
 * Usage:
 *   npx tsx src/lab/analysis/captaincy.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 * Output: private/lab/captaincy.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from '../lab-manager-ids.js'
import { createServiceClient } from '../supabase-server.js'
import { fetchBootstrap } from '../fpl-api.js'

const OUT_DIR  = path.resolve('private/lab')
const OUT_FILE = path.join(OUT_DIR, 'captaincy.json')

interface PickRow {
  entry_id:   number
  gw:         number
  element:    number
  is_captain: boolean
}

interface SnapshotRow {
  entry_id:  number
  gw:        number
  gw_points: number
}

interface GwCaptaincy {
  gw:               number
  managers_in_gw:   number
  consensus_element: number
  consensus_name:   string
  consensus_pct:    number
  differential_rate_pct: number
  captain_breakdown: Array<{
    element:   number
    name:      string
    count:     number
    pct:       number
    avg_manager_gw_pts: number | null
  }>
}

interface ManagerCaptaincy {
  entry_id:             number
  season_captaincies:   Array<{ gw: number; element: number; name: string; manager_gw_pts: number }>
  consensus_count:      number
  differential_count:   number
  differential_rate_pct: number
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Captaincy Variance & Risk   ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  console.log('Fetching bootstrap-static for element names…')
  const bootstrap  = await fetchBootstrap()
  const elementMap = new Map(bootstrap.elements.map(e => [e.id, e]))

  // Load captain picks
  const { data: picks, error: pickErr } = await supabase
    .from('lab_manager_gw_picks')
    .select('entry_id, gw, element, is_captain')
    .in('entry_id', managerIds)
    .eq('is_captain', true)
    .order('gw')
    .order('entry_id')

  if (pickErr) throw new Error(`lab_manager_gw_picks: ${pickErr.message}`)

  // Load snapshots for GW scores
  const { data: snapshots, error: snapErr } = await supabase
    .from('lab_manager_gw_snapshots')
    .select('entry_id, gw, gw_points')
    .in('entry_id', managerIds)
    .order('gw')

  if (snapErr) throw new Error(`lab_manager_gw_snapshots: ${snapErr.message}`)

  // Index snapshots: entry → gw → gw_points
  const snapMap = new Map<number, Map<number, number>>()
  for (const s of (snapshots as SnapshotRow[])) {
    if (!snapMap.has(s.entry_id)) snapMap.set(s.entry_id, new Map())
    snapMap.get(s.entry_id)!.set(s.gw, s.gw_points)
  }

  const captainPicks = picks as PickRow[]
  const gwSet = [...new Set(captainPicks.map(p => p.gw))].sort((a, b) => a - b)

  const gwResults: GwCaptaincy[] = []

  for (const gw of gwSet) {
    const gwCaps = captainPicks.filter(p => p.gw === gw)
    const n = gwCaps.length
    if (n === 0) continue

    // Count per element
    const countMap = new Map<number, number>()
    for (const c of gwCaps) {
      countMap.set(c.element, (countMap.get(c.element) ?? 0) + 1)
    }

    // Find consensus (most-picked)
    let consensusEl = 0
    let consensusCount = 0
    for (const [el, cnt] of countMap.entries()) {
      if (cnt > consensusCount) {
        consensusCount = cnt
        consensusEl   = el
      }
    }

    const consensusPct = Math.round((consensusCount / n) * 1000) / 10
    const differentialCount = n - consensusCount
    const differentialRate  = Math.round((differentialCount / n) * 1000) / 10

    const breakdown = [...countMap.entries()]
      .map(([el, cnt]) => {
        // Average GW points for managers who captained this element
        const managerPts = gwCaps
          .filter(c => c.element === el)
          .map(c => snapMap.get(c.entry_id)?.get(gw) ?? null)
          .filter((v): v is number => v !== null)

        return {
          element:              el,
          name:                 elementMap.get(el)?.web_name ?? `#${el}`,
          count:                cnt,
          pct:                  Math.round((cnt / n) * 1000) / 10,
          avg_manager_gw_pts:   managerPts.length > 0
            ? Math.round((managerPts.reduce((a, b) => a + b, 0) / managerPts.length) * 10) / 10
            : null,
        }
      })
      .sort((a, b) => b.count - a.count)

    gwResults.push({
      gw,
      managers_in_gw:        n,
      consensus_element:     consensusEl,
      consensus_name:        elementMap.get(consensusEl)?.web_name ?? `#${consensusEl}`,
      consensus_pct:         consensusPct,
      differential_rate_pct: differentialRate,
      captain_breakdown:     breakdown,
    })
  }

  // Per-manager analysis
  const managerResults: ManagerCaptaincy[] = managerIds.map(entryId => {
    const myCaps = captainPicks.filter(p => p.entry_id === entryId)

    const seasonCaptaincies = myCaps.map(c => ({
      gw:             c.gw,
      element:        c.element,
      name:           elementMap.get(c.element)?.web_name ?? `#${c.element}`,
      manager_gw_pts: snapMap.get(entryId)?.get(c.gw) ?? 0,
    }))

    let consensusCount    = 0
    let differentialCount = 0

    for (const c of myCaps) {
      const gwRes = gwResults.find(r => r.gw === c.gw)
      if (!gwRes) continue
      if (c.element === gwRes.consensus_element) consensusCount++
      else differentialCount++
    }

    const total = consensusCount + differentialCount

    return {
      entry_id:              entryId,
      season_captaincies:    seasonCaptaincies.sort((a, b) => a.gw - b.gw),
      consensus_count:       consensusCount,
      differential_count:    differentialCount,
      differential_rate_pct: total > 0 ? Math.round((differentialCount / total) * 1000) / 10 : 0,
    }
  })

  const output = {
    generated_at:  new Date().toISOString(),
    manager_count: managerIds.length,
    gws_analysed:  gwSet.length,
    note:          'avg_manager_gw_pts is the captain manager\'s full GW score (captain multiplier included); not a raw captain element return.',
    gw_results:    gwResults,
    manager_results: managerResults,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')

  console.log(`\n✅ Output: ${OUT_FILE}`)
  console.log(`   GWs analysed: ${gwSet.length}`)
  console.log(`   Total captain picks recorded: ${captainPicks.length}`)
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
