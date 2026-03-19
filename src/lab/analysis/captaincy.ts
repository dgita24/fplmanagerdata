/**
 * Lab analysis: Captaincy Variance & Risk
 *
 * For each GW:
 *   - Captain picks within the analysed group (element, name, count, %)
 *   - Group Consensus % (most-picked captain's share within the group)
 *   - Global Consensus (the overall most_captained player from FPL API)
 *   - Differential rate (% of managers captaining someone other than group consensus)
 *
 * Per-manager:
 *   - All captain choices across the season
 *   - Risk Profile 1: How often they followed GROUP consensus vs. went differential
 *   - Risk Profile 2: How often they followed GLOBAL consensus vs. went differential
 *
 * Reads from: lab_manager_gw_picks, lab_manager_gw_snapshots, bootstrap-static
 *
 * Usage:
 *   npx tsx src/lab/analysis/captaincy.ts
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
  group_consensus_element: number
  group_consensus_name:   string
  group_consensus_pct:    number
  global_consensus_element: number | null
  global_consensus_name:    string | null
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
  group_consensus_count:      number
  group_differential_count:   number
  group_differential_rate_pct: number
  global_consensus_count:     number
  global_differential_count:  number
  global_differential_rate_pct: number
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Captaincy Variance & Risk   ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  console.log('Fetching bootstrap-static for element names and global stats…')
  const bootstrap  = await fetchBootstrap()
  const elementMap = new Map(bootstrap.elements.map(e => [e.id, e]))
  
  // Map GW to the global most_captained element ID
  const globalCaptainMap = new Map<number, number | null>()
  for (const ev of bootstrap.events) {
    // most_captained is provided by the FPL API for completed/current GWs
    globalCaptainMap.set(ev.id, ev.most_captained ?? null)
  }

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

    // Find group consensus (most-picked within your lab group)
    let groupConsensusEl = 0
    let groupConsensusCount = 0
    for (const [el, cnt] of countMap.entries()) {
      if (cnt > groupConsensusCount) {
        groupConsensusCount = cnt
        groupConsensusEl   = el
      }
    }

    const groupConsensusPct = Math.round((groupConsensusCount / n) * 1000) / 10
    const groupDifferentialCount = n - groupConsensusCount
    const groupDifferentialRate  = Math.round((groupDifferentialCount / n) * 1000) / 10

    const globalCapEl = globalCaptainMap.get(gw) ?? null

    const breakdown = [...countMap.entries()]
      .map(([el, cnt]) => {
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
      managers_in_gw:           n,
      group_consensus_element:  groupConsensusEl,
      group_consensus_name:     elementMap.get(groupConsensusEl)?.web_name ?? `#${groupConsensusEl}`,
      group_consensus_pct:      groupConsensusPct,
      global_consensus_element: globalCapEl,
      global_consensus_name:    globalCapEl ? (elementMap.get(globalCapEl)?.web_name ?? `#${globalCapEl}`) : null,
      differential_rate_pct:    groupDifferentialRate,
      captain_breakdown:        breakdown,
    })
  }

  // Per-manager analysis (Risk Profiles)
  const managerResults: ManagerCaptaincy[] = managerIds.map(entryId => {
    const myCaps = captainPicks.filter(p => p.entry_id === entryId)

    const seasonCaptaincies = myCaps.map(c => ({
      gw:             c.gw,
      element:        c.element,
      name:           elementMap.get(c.element)?.web_name ?? `#${c.element}`,
      manager_gw_pts: snapMap.get(entryId)?.get(c.gw) ?? 0,
    }))

    let groupConsensusCount    = 0
    let groupDifferentialCount = 0
    let globalConsensusCount   = 0
    let globalDifferentialCount = 0

    for (const c of myCaps) {
      const gwRes = gwResults.find(r => r.gw === c.gw)
      if (!gwRes) continue
      
      // Group Risk Profile
      if (c.element === gwRes.group_consensus_element) groupConsensusCount++
      else groupDifferentialCount++
      
      // Global Risk Profile
      if (gwRes.global_consensus_element !== null) {
        if (c.element === gwRes.global_consensus_element) globalConsensusCount++
        else globalDifferentialCount++
      }
    }

    const totalGroup = groupConsensusCount + groupDifferentialCount
    const totalGlobal = globalConsensusCount + globalDifferentialCount

    return {
      entry_id:              entryId,
      season_captaincies:    seasonCaptaincies.sort((a, b) => a.gw - b.gw),
      group_consensus_count:       groupConsensusCount,
      group_differential_count:    groupDifferentialCount,
      group_differential_rate_pct: totalGroup > 0 ? Math.round((groupDifferentialCount / totalGroup) * 1000) / 10 : 0,
      global_consensus_count:      globalConsensusCount,
      global_differential_count:   globalDifferentialCount,
      global_differential_rate_pct: totalGlobal > 0 ? Math.round((globalDifferentialCount / totalGlobal) * 1000) / 10 : 0,
    }
  })

  const output = {
    generated_at:  new Date().toISOString(),
    manager_count: managerIds.length,
    gws_analysed:  gwSet.length,
    note:          'Global consensus is the overall most_captained player globally. Group consensus is the most captained player in the lab group.',
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
