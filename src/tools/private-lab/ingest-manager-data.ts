/**
 * Private Lab — Ingest Manager Data
 *
 * Fetches FPL data for all managers in a named set (or the active set) and
 * upserts into the private analysis tables:
 *   - fpl_entry_gw_meta   (GW-by-GW points, rank, chips, captain)
 *   - fpl_entry_gw_picks  (per-GW squad picks)
 *   - fpl_entry_transfers (all transfers)
 *
 * Usage:
 *   npx tsx src/tools/private-lab/ingest-manager-data.ts [options]
 *
 * Options:
 *   --userId=<uuid>           Analysis account's Supabase user ID (required)
 *   --set=<slug>              Manager set name; defaults to the active set
 *   --season=<text>           Season label, e.g. 2025-26 (required)
 *   --startGw=N               First GW to ingest (default: 1)
 *   --endGw=N                 Last GW to ingest (default: 38)
 *   --delayMs=N               Delay between API requests in ms (default: 800)
 *   --jitterMs=N              Random jitter added to delay in ms (default: 200)
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Examples:
 *   # Ingest the active set for GWs 1–38
 *   npx tsx src/tools/private-lab/ingest-manager-data.ts \
 *     --userId=abc-123 --season=2025-26
 *
 *   # Ingest a specific set, GW 1–10 only
 *   npx tsx src/tools/private-lab/ingest-manager-data.ts \
 *     --userId=abc-123 --set=top50-world-2025-26 --season=2025-26 \
 *     --startGw=1 --endGw=10
 *
 *   # Run with slower throttle for safety
 *   npx tsx src/tools/private-lab/ingest-manager-data.ts \
 *     --userId=abc-123 --season=2025-26 --delayMs=1200 --jitterMs=400
 */

import { pathToFileURL } from 'node:url';
import { sleep, fetchWithRetry } from '../ingest-player-history.js';
import { resolveActiveGroup } from '../../lib/private-lab/manager-sets.js';
import { getServiceClient } from '../../lib/private-lab/supabase-service.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EntryHistoryGw {
  event: number;
  points: number;
  total_points: number;
  rank: number;
  rank_sort: number;
  overall_rank: number;
  percentile_rank?: number;
  bank: number;
  value: number;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
}

interface EntryHistoryChip {
  name: string;
  time: string;
  event: number;
}

interface EntryHistoryResponse {
  current: EntryHistoryGw[];
  chips: EntryHistoryChip[];
}

interface PicksResponse {
  active_chip: string | null;
  entry_history: {
    event: number;
    points: number;
    total_points: number;
    rank: number;
    rank_sort: number;
    overall_rank: number;
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  };
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
    purchase_price?: number;
    selling_price?: number;
  }[];
}

interface TransferResponse {
  element_in: number;
  element_out: number;
  element_in_cost: number;
  element_out_cost: number;
  entry: number;
  time: string;
  event: number;
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

interface IngestManagerOptions {
  userId: string;
  setSlug?: string;
  season: string;
  startGw: number;
  endGw: number;
  delayMs: number;
  jitterMs: number;
  baseUrl: string;
}

function parseArgs(argv: string[]): IngestManagerOptions {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      args[arg.replace(/^--/, '')] = 'true';
    } else {
      args[arg.slice(0, eq).replace(/^--/, '')] = arg.slice(eq + 1);
    }
  }

  const userId = args['userId'];
  if (!userId) throw new Error('--userId is required');

  const season = args['season'];
  if (!season) throw new Error('--season is required (e.g. --season=2025-26)');

  const parseOptInt = (k: string, def: number): number => {
    const v = args[k];
    if (!v) return def;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`--${k} must be an integer`);
    return n;
  };

  const startGw = parseOptInt('startGw', 1);
  const endGw = parseOptInt('endGw', 38);
  if (startGw < 1 || endGw > 38 || startGw > endGw) {
    throw new Error('--startGw/--endGw must be 1–38 with start ≤ end');
  }

  return {
    userId,
    setSlug: args['set'],
    season,
    startGw,
    endGw,
    delayMs: parseOptInt('delayMs', 800),
    jitterMs: parseOptInt('jitterMs', 200),
    baseUrl: args['baseUrl'] ?? 'https://fantasy.premierleague.com/api',
  };
}

// ── FPL API fetchers ──────────────────────────────────────────────────────────

function jitter(ms: number): number {
  if (ms <= 0) return 0;
  return Math.floor(Math.random() * (ms + 1));
}

async function fetchEntryHistory(
  baseUrl: string,
  entryId: number,
): Promise<EntryHistoryResponse> {
  const url = `${baseUrl}/entry/${entryId}/history/`;
  const res = await fetchWithRetry(url);
  return res.json() as Promise<EntryHistoryResponse>;
}

async function fetchEntryPicks(
  baseUrl: string,
  entryId: number,
  gw: number,
): Promise<PicksResponse | null> {
  const url = `${baseUrl}/entry/${entryId}/event/${gw}/picks/`;
  try {
    const res = await fetchWithRetry(url);
    return res.json() as Promise<PicksResponse>;
  } catch (err) {
    // GW may not exist yet (e.g. future GW) — treat as missing
    console.warn(`    ⚠️  No picks for entry ${entryId} GW${gw}: ${String(err)}`);
    return null;
  }
}

async function fetchEntryTransfers(
  baseUrl: string,
  entryId: number,
): Promise<TransferResponse[]> {
  const url = `${baseUrl}/entry/${entryId}/transfers/`;
  const res = await fetchWithRetry(url);
  return res.json() as Promise<TransferResponse[]>;
}

// ── Supabase upserts ──────────────────────────────────────────────────────────

const BATCH_SIZE = 200;

async function upsertGwMeta(rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getServiceClient();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('fpl_entry_gw_meta')
      .upsert(batch, { onConflict: 'season,gw,entry_id' });
    if (error) throw new Error(`fpl_entry_gw_meta upsert failed: ${error.message}`);
  }
}

async function upsertGwPicks(rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getServiceClient();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('fpl_entry_gw_picks')
      .upsert(batch, { onConflict: 'season,gw,entry_id,element' });
    if (error) throw new Error(`fpl_entry_gw_picks upsert failed: ${error.message}`);
  }
}

async function upsertTransfers(rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getServiceClient();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('fpl_entry_transfers')
      .upsert(batch, { onConflict: 'season,gw,entry_id,time,element_in,element_out' });
    if (error) throw new Error(`fpl_entry_transfers upsert failed: ${error.message}`);
  }
}

// ── Chip detection helpers ────────────────────────────────────────────────────

const CHIP_NAMES = new Set(['wildcard', '3xc', 'bboost', 'freehit', 'manager']);

function detectChips(
  chips: EntryHistoryChip[],
  gw: number,
): {
  wildcard: boolean;
  triple_captain: boolean;
  bench_boost: boolean;
  freehit: boolean;
  assistant_manager: boolean;
} {
  const chipsThisGw = chips.filter((c) => c.event === gw).map((c) => c.name);
  return {
    wildcard: chipsThisGw.includes('wildcard'),
    triple_captain: chipsThisGw.includes('3xc'),
    bench_boost: chipsThisGw.includes('bboost'),
    freehit: chipsThisGw.includes('freehit'),
    assistant_manager: chipsThisGw.includes('manager'),
  };
}

// ── Main orchestration ────────────────────────────────────────────────────────

export async function runIngestManagerData(opts: IngestManagerOptions): Promise<void> {
  console.log('▶ Resolving manager set…');
  const group = await resolveActiveGroup(opts.userId, opts.setSlug);
  console.log(`   Set: "${group.name}" (${group.manager_ids.length} managers)`);
  console.log(`   Season: ${opts.season} | GWs: ${opts.startGw}–${opts.endGw}`);

  const managerIds = group.manager_ids;
  const total = managerIds.length;
  let processed = 0;
  let errored = 0;

  for (const entryId of managerIds) {
    processed++;
    console.log(`\n[${processed}/${total}] Entry ${entryId}…`);

    await sleep(opts.delayMs + jitter(opts.jitterMs));

    try {
      // 1. Fetch full history (GW meta + chips)
      const history = await fetchEntryHistory(opts.baseUrl, entryId);

      const gwMetaRows: object[] = [];
      const gwPickRows: object[] = [];

      for (const gw of history.current) {
        if (gw.event < opts.startGw || gw.event > opts.endGw) continue;

        const chips = detectChips(history.chips, gw.event);
        gwMetaRows.push({
          season: opts.season,
          gw: gw.event,
          entry_id: entryId,
          overall_rank: gw.overall_rank,
          overall_points: gw.total_points,
          points: gw.points,
          points_on_bench: gw.points_on_bench,
          event_transfers: gw.event_transfers,
          event_transfers_cost: gw.event_transfers_cost,
          bank: gw.bank,
          value: gw.value,
          wildcard: chips.wildcard,
          freehit: chips.freehit,
          bench_boost: chips.bench_boost,
          triple_captain: chips.triple_captain,
          assistant_manager: chips.assistant_manager,
          updated_at: new Date().toISOString(),
        });
      }

      // 2. Fetch per-GW picks (captain + picks + active chip)
      for (const gw of history.current) {
        if (gw.event < opts.startGw || gw.event > opts.endGw) continue;

        await sleep(opts.delayMs + jitter(opts.jitterMs));
        const picks = await fetchEntryPicks(opts.baseUrl, entryId, gw.event);
        if (!picks) continue;

        // Patch GW meta with captain info from picks
        const captainPick = picks.picks.find((p) => p.is_captain);
        const vcPick = picks.picks.find((p) => p.is_vice_captain);
        const metaRow = gwMetaRows.find(
          (r) => (r as { gw: number }).gw === gw.event,
        ) as Record<string, unknown> | undefined;
        if (metaRow) {
          metaRow['captain_element'] = captainPick?.element ?? null;
          metaRow['vice_captain_element'] = vcPick?.element ?? null;
          // active_chip from picks overrides chip detection from history
          if (picks.active_chip) {
            metaRow['wildcard'] = picks.active_chip === 'wildcard';
            metaRow['freehit'] = picks.active_chip === 'freehit';
            metaRow['bench_boost'] = picks.active_chip === 'bboost';
            metaRow['triple_captain'] = picks.active_chip === '3xc';
            metaRow['assistant_manager'] = picks.active_chip === 'manager';
          }
        }

        for (const pick of picks.picks) {
          gwPickRows.push({
            season: opts.season,
            gw: gw.event,
            entry_id: entryId,
            element: pick.element,
            position: pick.position,
            multiplier: pick.multiplier,
            is_captain: pick.is_captain,
            is_vice_captain: pick.is_vice_captain,
            purchase_price: pick.purchase_price ?? null,
            selling_price: pick.selling_price ?? null,
          });
        }
      }

      // 3. Fetch transfers
      await sleep(opts.delayMs + jitter(opts.jitterMs));
      const transfers = await fetchEntryTransfers(opts.baseUrl, entryId);
      const transferRows = transfers
        .filter((t) => t.event >= opts.startGw && t.event <= opts.endGw)
        .map((t) => ({
          season: opts.season,
          gw: t.event,
          entry_id: entryId,
          time: t.time,
          element_in: t.element_in,
          element_out: t.element_out,
          purchase_price: t.element_in_cost ?? null,
          selling_price: t.element_out_cost ?? null,
        }));

      // 4. Upsert all data
      await upsertGwMeta(gwMetaRows);
      await upsertGwPicks(gwPickRows);
      await upsertTransfers(transferRows);

      console.log(
        `   ✅ ${gwMetaRows.length} GW rows | ${gwPickRows.length} picks | ${transferRows.length} transfers`,
      );
    } catch (err) {
      errored++;
      console.error(`   ❌ Failed for entry ${entryId}:`, err);
    }
  }

  console.log(`\n✅ Ingestion complete`);
  console.log(`   Processed: ${processed - errored}/${total}`);
  if (errored > 0) {
    console.log(`   Errors:    ${errored} (check logs above)`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let opts: IngestManagerOptions;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error('Argument error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  runIngestManagerData(opts).catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
