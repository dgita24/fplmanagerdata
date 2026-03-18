/**
 * Lab Ingestion Script
 *
 * Fetches FPL data for all manager IDs stored in user_manager_lists for the
 * dedicated analysis account (LAB_ANALYSIS_USER_ID) and upserts into:
 *
 *   lab_manager_gw_snapshots  — GW-level summary (points, chips, rank, value …)
 *   lab_manager_gw_picks      — Per-pick per GW (elements, captain, positions …)
 *   lab_manager_transfers     — Full transfer history
 *
 * Manager IDs are the ONLY input — sourced entirely from Supabase.
 * No CSV, no CLI IDs flag.
 *
 * Usage:
 *   npx tsx src/lab/ingest-lab-data.ts
 *
 * Optional env:
 *   LAB_FPL_BASE_URL   — override FPL API base (e.g. local proxy)
 *   LAB_DELAY_MS       — delay between manager requests (default: 800)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LAB_ANALYSIS_USER_ID
 */

import { pathToFileURL } from 'node:url'
import { loadLabManagerIds } from './lab-manager-ids.js'
import { createServiceClient } from './supabase-server.js'
import {
  fetchEntryHistory,
  fetchEntryGwPicks,
  fetchEntryTransfers,
  politeDelay,
} from './fpl-api.js'

const DELAY_MS = parseInt(process.env['LAB_DELAY_MS'] ?? '800', 10)

// ─────────────────────────────────────────────────────────────────────────────

async function ingestEntry(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: number,
): Promise<void> {
  console.log(`  → entry ${entryId}`)

  // 1. Fetch history (current GW summaries + chips)
  const history = await fetchEntryHistory(entryId)
  await politeDelay(DELAY_MS)

  const chipsByGw = new Map<number, string>()
  for (const chip of history.chips) {
    chipsByGw.set(chip.event, chip.name)
  }

  // 2. Upsert snapshots
  const snapshotRows = history.current.map(gw => ({
    entry_id:             entryId,
    gw:                   gw.event,
    gw_points:            gw.points,
    total_points:         gw.total_points,
    points_on_bench:      gw.points_on_bench,
    rank:                 gw.rank,
    overall_rank:         gw.overall_rank,
    value:                gw.value,
    bank:                 gw.bank,
    event_transfers:      gw.event_transfers,
    event_transfers_cost: gw.event_transfers_cost,
    chip_played:          chipsByGw.get(gw.event) ?? null,
    ingested_at:          new Date().toISOString(),
  }))

  if (snapshotRows.length > 0) {
    const { error: snapErr } = await supabase
      .from('lab_manager_gw_snapshots')
      .upsert(snapshotRows, { onConflict: 'entry_id,gw' })
    if (snapErr) throw new Error(`snapshot upsert for entry ${entryId}: ${snapErr.message}`)
  }

  // 3. Fetch picks for each GW that has been played
  const finishedGws = history.current.map(g => g.event)
  for (const gw of finishedGws) {
    try {
      const gwData = await fetchEntryGwPicks(entryId, gw)
      await politeDelay(DELAY_MS)

      const pickRows = gwData.picks.map(p => ({
        entry_id:        entryId,
        gw,
        position:        p.position,
        element:         p.element,
        multiplier:      p.multiplier,
        is_captain:      p.is_captain,
        is_vice_captain: p.is_vice_captain,
        selling_price:   p.selling_price ?? null,
        purchase_price:  p.purchase_price ?? null,
        ingested_at:     new Date().toISOString(),
      }))

      if (pickRows.length > 0) {
        const { error: pickErr } = await supabase
          .from('lab_manager_gw_picks')
          .upsert(pickRows, { onConflict: 'entry_id,gw,position' })
        if (pickErr) throw new Error(`picks upsert for entry ${entryId} gw ${gw}: ${pickErr.message}`)
      }
    } catch (err) {
      // Some GWs may 404 for entries who weren't active — log and continue
      console.warn(`    ⚠️  picks for entry ${entryId} gw ${gw}: ${(err as Error).message}`)
    }
  }

  // 4. Upsert transfers
  const transfers = await fetchEntryTransfers(entryId)
  await politeDelay(DELAY_MS)

  if (transfers.length > 0) {
    const transferRows = transfers.map(t => ({
      entry_id:         entryId,
      gw:               t.event,
      element_in:       t.element_in,
      element_out:      t.element_out,
      element_in_cost:  t.element_in_cost,
      element_out_cost: t.element_out_cost,
      transfer_time:    t.time,
      ingested_at:      new Date().toISOString(),
    }))

    const { error: xferErr } = await supabase
      .from('lab_manager_transfers')
      .upsert(transferRows, { onConflict: 'entry_id,gw,element_in,element_out' })
    if (xferErr) throw new Error(`transfers upsert for entry ${entryId}: ${xferErr.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('════════════════════════════════════════')
  console.log('  Lab Data Ingestion                    ')
  console.log('════════════════════════════════════════')

  const supabase   = createServiceClient()
  const managerIds = await loadLabManagerIds()

  console.log(`\nIngesting ${managerIds.length} manager(s)…\n`)

  let ok = 0
  let failed = 0

  for (const entryId of managerIds) {
    try {
      await ingestEntry(supabase, entryId)
      ok++
    } catch (err) {
      console.error(`  ✗ entry ${entryId}: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n✅ Ingestion complete — ${ok} succeeded, ${failed} failed`)
  if (failed > 0) process.exit(1)
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
