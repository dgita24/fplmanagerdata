/**
 * Lab analysis: Transfer Strategy (Patience vs Kneejerking)
 *
 * For each manager in the lab group:
 *   - Total transfer hits taken over the season
 *   - Aggressiveness score (hits per GW played)
 *   - For each transfer out of a premium player (value >= 90, i.e. £9.0m+):
 *       consecutive GWs before the sell where the individual player scored <= 3 points
 *       (kneejerk indicator: sold after 1–2 blanks vs patient: 3+ blanks or no blanks)
 *       Uses player_match_history for per-player GW points (requires ingest-player-history to be run).
 *       Falls back to a 'data_unavailable' flag if player history is absent.
 *
 * Cross-group summary:
 *   - Average hits per GW
 *   - Kneejerk rate (% of premium sells after <= 2 consecutive blanks)
 *
 * Reads from: lab_manager_gw_snapshots, lab_manager_transfers, player_match_history
 * Bootstrap element data for premium threshold.
 *
 * Usage:
 *   npx tsx src/lab/analysis/transfer-strategy.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 * Output: private/lab/transfer-strategy.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from '../lab-manager-ids.js'
import { createServiceClient } from '../supabase-server.js'
import { fetchBootstrap } from '../fpl-api.js'

const OUT_DIR  = path.resolve('private/lab')
const OUT_FILE = path.join(OUT_DIR, 'transfer-strategy.json')

/** Elements priced >= this (tenths of £) are treated as "premium". */
const PREMIUM_THRESHOLD = 90   // £9.0m
/** Points threshold: <= this counts as a blank for kneejerk analysis. */
const BLANK_THRESHOLD   = 3

interface SnapshotRow {
  entry_id:             number
  gw:                   number
  event_transfers:      number
  event_transfers_cost: number
}

interface TransferRow {
  entry_id:        number
  gw:              number
  element_out:     number
  element_out_cost: number | null
}

interface PlayerHistoryRow {
  player_id:    number
  gw:           number
  total_points: number
}

interface ManagerResult {
  entry_id:          number
  gws_played:        number
  total_hits:        number
  hits_per_gw:       number
  premium_sells:     PremiumSell[]
  kneejerk_count:    number
  patient_count:     number
  kneejerk_rate_pct: number
  aggressiveness:    'low' | 'medium' | 'high'
}

interface PremiumSell {
  gw:                    number
  element_out:           number
  element_name:          string
  sell_price:            number | null
  blanks_before_sell:    number | null  // null if player history unavailable
  is_kneejerk:           boolean | null // null if player history unavailable
  player_history_available: boolean
}

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Analysis: Transfer Strategy           ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  // Fetch bootstrap for element names and costs
  console.log('Fetching bootstrap-static…')
  const bootstrap = await fetchBootstrap()
  const elementMap = new Map(bootstrap.elements.map(e => [e.id, e]))

  // Load snapshots (for transfer cost data)
  const { data: snapshots, error: snapErr } = await supabase
    .from('lab_manager_gw_snapshots')
    .select('entry_id, gw, event_transfers, event_transfers_cost')
    .in('entry_id', managerIds)
    .order('entry_id')
    .order('gw')

  if (snapErr) throw new Error(`lab_manager_gw_snapshots: ${snapErr.message}`)

  // Load transfers
  const { data: transfers, error: xferErr } = await supabase
    .from('lab_manager_transfers')
    .select('entry_id, gw, element_out, element_out_cost')
    .in('entry_id', managerIds)
    .order('entry_id')
    .order('gw')

  if (xferErr) throw new Error(`lab_manager_transfers: ${xferErr.message}`)

  // Gather premium player IDs sold by the group
  const premiumElementIds = new Set<number>()
  for (const xfer of (transfers as TransferRow[])) {
    const el = elementMap.get(xfer.element_out)
    const sellPrice = xfer.element_out_cost ?? el?.now_cost ?? 0
    if (sellPrice >= PREMIUM_THRESHOLD) premiumElementIds.add(xfer.element_out)
  }

  // Load player_match_history for those premium elements
  // player_match_history uses player_id which matches FPL element id
  const { data: playerHistory, error: phErr } = await supabase
    .from('player_match_history')
    .select('player_id, gw, total_points')
    .in('player_id', [...premiumElementIds])
    .order('player_id')
    .order('gw')

  if (phErr) {
    console.warn(`⚠️  player_match_history unavailable: ${phErr.message}. Kneejerk analysis will be skipped.`)
  }

  // Build player GW points map: element_id → gw → total_points
  // Note: player_match_history may have multiple fixtures per GW (DGWs).
  // Sum all fixture points for the GW.
  const playerGwPoints = new Map<number, Map<number, number>>()
  for (const row of ((playerHistory ?? []) as PlayerHistoryRow[])) {
    if (!playerGwPoints.has(row.player_id)) playerGwPoints.set(row.player_id, new Map())
    const gwMap = playerGwPoints.get(row.player_id)!
    gwMap.set(row.gw, (gwMap.get(row.gw) ?? 0) + row.total_points)
  }

  // Build per-manager snapshot maps: entry_id → gw → SnapshotRow
  const snapshotsByEntry = new Map<number, Map<number, SnapshotRow>>()
  for (const row of (snapshots as SnapshotRow[])) {
    if (!snapshotsByEntry.has(row.entry_id)) snapshotsByEntry.set(row.entry_id, new Map())
    snapshotsByEntry.get(row.entry_id)!.set(row.gw, row)
  }

  // Build per-manager transfers: entry_id → TransferRow[]
  const transfersByEntry = new Map<number, TransferRow[]>()
  for (const row of (transfers as TransferRow[])) {
    if (!transfersByEntry.has(row.entry_id)) transfersByEntry.set(row.entry_id, [])
    transfersByEntry.get(row.entry_id)!.push(row)
  }

  const managerResults: ManagerResult[] = []

  for (const entryId of managerIds) {
    const gwMap = snapshotsByEntry.get(entryId) ?? new Map<number, SnapshotRow>()
    const xfers = transfersByEntry.get(entryId) ?? []

    const sortedGws = [...gwMap.values()].sort((a, b) => a.gw - b.gw)
    const gwsPlayed = sortedGws.length

    const totalHits = sortedGws.reduce((sum, r) => sum + r.event_transfers_cost / 4, 0)

    // Aggressiveness: proportion of GWs where a hit was taken
    const hitGws = sortedGws.filter(r => r.event_transfers_cost > 0).length
    const hitsPerGw = gwsPlayed > 0 ? Math.round((hitGws / gwsPlayed) * 100) / 100 : 0

    const premiumSells: PremiumSell[] = []

    for (const xfer of xfers) {
      const el = elementMap.get(xfer.element_out)
      if (!el) continue

      const sellPrice = xfer.element_out_cost ?? el.now_cost
      if (sellPrice < PREMIUM_THRESHOLD) continue

      const playerGwMap = playerGwPoints.get(xfer.element_out)
      const historyAvailable = playerGwMap !== undefined && playerGwMap.size > 0

      let consecutiveBlanks: number | null = null
      let isKneejerk: boolean | null = null

      if (historyAvailable && playerGwMap) {
        // Count consecutive GWs immediately before the sell GW where the
        // INDIVIDUAL PLAYER scored <= BLANK_THRESHOLD
        consecutiveBlanks = 0
        let checkGw = xfer.gw - 1
        while (checkGw >= 1) {
          const pts = playerGwMap.get(checkGw)
          if (pts === undefined) break  // no history for this GW — stop
          if (pts <= BLANK_THRESHOLD) {
            consecutiveBlanks++
            checkGw--
          } else {
            break
          }
        }
        isKneejerk = consecutiveBlanks <= 2
      }

      premiumSells.push({
        gw:                       xfer.gw,
        element_out:              xfer.element_out,
        element_name:             el.web_name,
        sell_price:               xfer.element_out_cost,
        blanks_before_sell:       consecutiveBlanks,
        is_kneejerk:              isKneejerk,
        player_history_available: historyAvailable,
      })
    }

    const sellsWithData    = premiumSells.filter(s => s.is_kneejerk !== null)
    const kneejerkCount    = sellsWithData.filter(s => s.is_kneejerk === true).length
    const patientCount     = sellsWithData.filter(s => s.is_kneejerk === false).length
    const kneejerkRate     = sellsWithData.length > 0
      ? Math.round((kneejerkCount / sellsWithData.length) * 1000) / 10
      : 0

    let aggressiveness: 'low' | 'medium' | 'high' = 'low'
    if (hitsPerGw >= 0.25)      aggressiveness = 'high'
    else if (hitsPerGw >= 0.12) aggressiveness = 'medium'

    managerResults.push({
      entry_id:          entryId,
      gws_played:        gwsPlayed,
      total_hits:        Math.round(totalHits),
      hits_per_gw:       hitsPerGw,
      premium_sells:     premiumSells,
      kneejerk_count:    kneejerkCount,
      patient_count:     patientCount,
      kneejerk_rate_pct: kneejerkRate,
      aggressiveness,
    })
  }

  // Cross-group summary
  const groupAvgHitsPerGw =
    managerResults.length > 0
      ? Math.round(
          (managerResults.reduce((s, m) => s + m.hits_per_gw, 0) / managerResults.length) * 100,
        ) / 100
      : 0

  const allPremiumSells   = managerResults.flatMap(m => m.premium_sells)
  const sellsWithHistory  = allPremiumSells.filter(s => s.is_kneejerk !== null)
  const groupKneejerkRate =
    sellsWithHistory.length > 0
      ? Math.round(
          (sellsWithHistory.filter(s => s.is_kneejerk === true).length / sellsWithHistory.length) * 1000,
        ) / 10
      : 0

  const output = {
    generated_at:      new Date().toISOString(),
    manager_count:     managerIds.length,
    premium_threshold: `£${PREMIUM_THRESHOLD / 10}m`,
    blank_threshold:   `<= ${BLANK_THRESHOLD} pts (individual player score from player_match_history)`,
    note:              'blanks_before_sell and is_kneejerk are null when player_match_history data is unavailable for the element. Run ingest-player-history.ts first.',
    cross_group: {
      avg_hits_per_gw:         groupAvgHitsPerGw,
      kneejerk_rate_pct:       groupKneejerkRate,
      total_premium_sells:     allPremiumSells.length,
      sells_with_history:      sellsWithHistory.length,
    },
    manager_results:   managerResults,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')

  console.log(`\n✅ Output: ${OUT_FILE}`)
  console.log(`   Premium sells analysed: ${allPremiumSells.length} (${sellsWithHistory.length} with player history)`)
  console.log(`   Group kneejerk rate: ${groupKneejerkRate}%`)
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

