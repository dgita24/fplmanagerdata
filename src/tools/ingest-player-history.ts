/**
 * FPL Player History Ingest Script
 *
 * Fetches per-player per-match FPL stats (including xG/xA/xGC) and writes
 * an incremental NDJSON snapshot to disk.
 *
 * Usage:
 *   npx tsx src/tools/ingest-player-history.ts [options]
 *
 * Options:
 *   --mode=nightly|backfill   (default: nightly)
 *   --startGw=N               Required for backfill mode
 *   --endGw=N                 Required for backfill mode
 *   --recentGwRevalidate=N    Number of recent GWs to re-fetch even if cached (default: 2)
 *   --outDir=./data           Output directory (default: ./data)
 *   --baseUrl=<url>           FPL API base URL (default: https://fantasy.premierleague.com/api)
 *
 * Examples:
 *   # Nightly run (only missing/recent GWs)
 *   npx tsx src/tools/ingest-player-history.ts --mode=nightly
 *
 *   # Backfill GW 1–10
 *   npx tsx src/tools/ingest-player-history.ts --mode=backfill --startGw=1 --endGw=10
 *
 *   # Use local proxy instead of direct FPL API
 *   npx tsx src/tools/ingest-player-history.ts --baseUrl=http://localhost:4321/api/fpl
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchRow {
  player_id: number;
  fixture_id: number;
  gw: number;
  was_home: boolean;
  opponent_team: number;
  kickoff_time: string | null;
  team_h_score: number | null;
  team_a_score: number | null;
  minutes: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  bonus: number;
  bps: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  clearances_blocks_interceptions: number;
  tackles: number;
  recoveries: number;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
}

export interface SnapshotMeta {
  season: string;
  lastUpdated: string;
  latestGw: number;
  playerCount: number;
  rowCount: number;
}

export interface IngestOptions {
  mode: 'nightly' | 'backfill';
  startGw?: number;
  endGw?: number;
  recentGwRevalidate: number;
  outDir: string;
  baseUrl: string;
}

// ── CLI argument parsing ───────────────────────────────────────────────────────

export function parseArgs(argv: string[]): IngestOptions {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const key = arg.slice(0, eq).replace(/^--/, '');
    const val = arg.slice(eq + 1);
    args[key] = val;
  }

  const mode = (args['mode'] ?? 'nightly') as 'nightly' | 'backfill';
  if (mode !== 'nightly' && mode !== 'backfill') {
    throw new Error(`--mode must be "nightly" or "backfill", got "${mode}"`);
  }

  const startGw = args['startGw'] !== undefined ? parseInt(args['startGw'], 10) : undefined;
  const endGw = args['endGw'] !== undefined ? parseInt(args['endGw'], 10) : undefined;

  if (mode === 'backfill') {
    if (startGw === undefined || endGw === undefined) {
      throw new Error('--startGw and --endGw are required in backfill mode');
    }
    if (isNaN(startGw) || isNaN(endGw) || startGw < 1 || endGw > 38 || startGw > endGw) {
      throw new Error('--startGw and --endGw must be integers between 1–38 with start ≤ end');
    }
  }

  return {
    mode,
    startGw,
    endGw,
    recentGwRevalidate:
      args['recentGwRevalidate'] !== undefined
        ? parseInt(args['recentGwRevalidate'], 10)
        : 2,
    outDir: args['outDir'] ?? './data',
    baseUrl: args['baseUrl'] ?? 'https://fantasy.premierleague.com/api',
  };
}

// ── Rate-limiting & retry ──────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  url: string,
  retries = 3,
  baseDelayMs = 600,
): Promise<Response> {
  let lastError: Error = new Error('fetchWithRetry: no attempts made');

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
        console.warn(`  ⚠️  Network error for ${url}, retrying in ${Math.round(delay)}ms…`);
        await sleep(delay);
        continue;
      }
      break;
    }

    if (res.ok) return res;

    if (RETRYABLE_STATUSES.has(res.status) && attempt < retries) {
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`  ⚠️  HTTP ${res.status} for ${url}, retrying in ${Math.round(delay)}ms…`);
      await sleep(delay);
      lastError = new Error(`HTTP ${res.status}`);
      continue;
    }

    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  throw lastError;
}

// ── FPL API helpers ────────────────────────────────────────────────────────────

interface BootstrapElement {
  id: number;
  element_type: number;
  team: number;
  web_name: string;
}

interface BootstrapEvent {
  id: number;
  is_current: boolean;
  is_finished: boolean;
  deadline_time: string;
}

interface BootstrapData {
  elements: BootstrapElement[];
  events: BootstrapEvent[];
}

export async function fetchBootstrap(baseUrl: string): Promise<BootstrapData> {
  const url = `${baseUrl}/bootstrap-static/`;
  console.log(`Fetching bootstrap: ${url}`);
  const res = await fetchWithRetry(url);
  return res.json() as Promise<BootstrapData>;
}

export async function fetchElementSummary(
  baseUrl: string,
  playerId: number,
): Promise<{ history: Array<Record<string, unknown>> }> {
  const url = `${baseUrl}/element-summary/${playerId}/`;
  const res = await fetchWithRetry(url);
  return res.json() as Promise<{ history: Array<Record<string, unknown>> }>;
}

// ── Row normalisation ──────────────────────────────────────────────────────────

export function normalizeRow(
  playerId: number,
  raw: Record<string, unknown>,
): MatchRow {
  const n = (k: string): number => Number(raw[k]) || 0;
  const nNullable = (k: string): number | null =>
    raw[k] == null ? null : Number(raw[k]);
  const s = (k: string): string =>
    raw[k] != null ? String(raw[k]) : '0.00';

  return {
    player_id: playerId,
    fixture_id: n('fixture'),
    gw: n('round'),
    was_home: raw['was_home'] === true,
    opponent_team: n('opponent_team'),
    kickoff_time: (raw['kickoff_time'] as string | null | undefined) ?? null,
    team_h_score: nNullable('team_h_score'),
    team_a_score: nNullable('team_a_score'),
    minutes: n('minutes'),
    total_points: n('total_points'),
    goals_scored: n('goals_scored'),
    assists: n('assists'),
    bonus: n('bonus'),
    bps: n('bps'),
    clean_sheets: n('clean_sheets'),
    goals_conceded: n('goals_conceded'),
    own_goals: n('own_goals'),
    penalties_saved: n('penalties_saved'),
    penalties_missed: n('penalties_missed'),
    yellow_cards: n('yellow_cards'),
    red_cards: n('red_cards'),
    saves: n('saves'),
    clearances_blocks_interceptions: n('clearances_blocks_interceptions'),
    tackles: n('tackles'),
    recoveries: n('recoveries'),
    expected_goals: s('expected_goals'),
    expected_assists: s('expected_assists'),
    expected_goal_involvements: s('expected_goal_involvements'),
    expected_goals_conceded: s('expected_goals_conceded'),
  };
}

// ── Snapshot key ───────────────────────────────────────────────────────────────

export function rowKey(row: Pick<MatchRow, 'player_id' | 'fixture_id'>): string {
  return `${row.player_id}:${row.fixture_id}`;
}

// ── Snapshot I/O ───────────────────────────────────────────────────────────────

/**
 * Load an existing NDJSON snapshot into a Map keyed by "player_id:fixture_id".
 * Returns an empty Map if the file does not exist.
 */
export async function loadExistingSnapshot(
  snapshotPath: string,
): Promise<Map<string, MatchRow>> {
  const map = new Map<string, MatchRow>();
  if (!fs.existsSync(snapshotPath)) return map;

  const rl = createInterface({
    input: fs.createReadStream(snapshotPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as MatchRow;
      map.set(rowKey(row), row);
    } catch {
      // skip malformed lines
    }
  }

  console.log(`Loaded ${map.size} existing rows from ${snapshotPath}`);
  return map;
}

/**
 * Write all rows to an NDJSON file, sorted by player_id then gw for determinism.
 */
export function writeSnapshot(snapshotPath: string, rows: Map<string, MatchRow>): void {
  const sorted = Array.from(rows.values()).sort(
    (a, b) => a.player_id - b.player_id || a.gw - b.gw || a.fixture_id - b.fixture_id,
  );
  const lines = sorted.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(snapshotPath, lines + '\n', 'utf8');
}

export function writeMeta(metaPath: string, meta: SnapshotMeta): void {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

// ── Season derivation ──────────────────────────────────────────────────────────

/**
 * Derive the FPL season string (e.g. "2025-26") from the first event deadline.
 */
export function deriveSeason(events: BootstrapEvent[]): string {
  const first = events[0];
  if (!first?.deadline_time) return 'unknown';
  const year = new Date(first.deadline_time).getFullYear();
  return `${year}-${String(year + 1).slice(2)}`;
}

// ── Main orchestration ─────────────────────────────────────────────────────────

export async function runIngest(opts: IngestOptions): Promise<void> {
  console.log('▶ Ingest options:', opts);

  fs.mkdirSync(opts.outDir, { recursive: true });

  const snapshotPath = path.join(opts.outDir, 'player-history.ndjson');
  const metaPath = path.join(opts.outDir, 'player-history-meta.json');

  // Load existing data
  const existingRows = await loadExistingSnapshot(snapshotPath);

  // Fetch bootstrap
  const bootstrap = await fetchBootstrap(opts.baseUrl);

  const currentEvent = bootstrap.events.find((e) => e.is_current);
  const finishedEvents = bootstrap.events.filter((e) => e.is_finished);
  const latestGw =
    currentEvent?.id ?? (finishedEvents.length > 0 ? finishedEvents[finishedEvents.length - 1].id : 1);

  console.log(`Current GW: ${latestGw} | Total players: ${bootstrap.elements.length}`);

  // Determine the set of GWs to revalidate (always re-fetch even if rows exist)
  const revalidateGws = new Set<number>();
  for (
    let gw = Math.max(1, latestGw - opts.recentGwRevalidate + 1);
    gw <= latestGw;
    gw++
  ) {
    revalidateGws.add(gw);
  }
  if (revalidateGws.size > 0) {
    console.log(`Will revalidate GWs: ${[...revalidateGws].sort((a, b) => a - b).join(', ')}`);
  }

  // Determine GW range to consider
  const gwRangeStart = opts.mode === 'backfill' && opts.startGw ? opts.startGw : 1;
  const gwRangeEnd = opts.mode === 'backfill' && opts.endGw ? opts.endGw : latestGw;

  // Build an index of which (player, gw) combos we already have
  const existingByPlayerGw = new Map<string, boolean>();
  for (const row of existingRows.values()) {
    existingByPlayerGw.set(`${row.player_id}:${row.gw}`, true);
  }

  const RATE_LIMIT_DELAY_MS = 300; // ~3 req/s — conservative, adjust if needed
  let processed = 0;
  let newRows = 0;
  let updatedRows = 0;

  for (const player of bootstrap.elements) {
    processed++;
    if (processed % 100 === 0) {
      console.log(`  Progress: ${processed}/${bootstrap.elements.length} players…`);
    }

    // Decide whether we need to fetch this player
    let needFetch = false;

    for (let gw = gwRangeStart; gw <= gwRangeEnd; gw++) {
      if (revalidateGws.has(gw)) {
        needFetch = true;
        break;
      }
      if (!existingByPlayerGw.has(`${player.id}:${gw}`)) {
        // Missing data — but a player may not have played every GW (benched/injured),
        // so only trigger a fetch if the GW has finished.
        const event = bootstrap.events.find((e) => e.id === gw);
        if (event?.is_finished) {
          needFetch = true;
          break;
        }
      }
    }

    if (!needFetch) continue;

    await sleep(RATE_LIMIT_DELAY_MS);

    try {
      const summary = await fetchElementSummary(opts.baseUrl, player.id);
      const history = summary.history ?? [];

      for (const rawRow of history) {
        const gw = Number(rawRow['round']);

        // Apply GW range filter
        if (gw < gwRangeStart || gw > gwRangeEnd) continue;

        const row = normalizeRow(player.id, rawRow);
        const key = rowKey(row);
        const isRevalidate = revalidateGws.has(gw);

        if (!existingRows.has(key)) {
          existingRows.set(key, row);
          existingByPlayerGw.set(`${row.player_id}:${row.gw}`, true);
          newRows++;
        } else if (isRevalidate) {
          existingRows.set(key, row);
          updatedRows++;
        }
      }
    } catch (err) {
      console.error(`  ❌ Failed to fetch player ${player.id} (${player.web_name}):`, err);
    }
  }

  console.log(`\n✅ Ingest complete`);
  console.log(`   New rows:     ${newRows}`);
  console.log(`   Updated rows: ${updatedRows}`);
  console.log(`   Total rows:   ${existingRows.size}`);

  writeSnapshot(snapshotPath, existingRows);
  console.log(`   Snapshot:     ${snapshotPath}`);

  const playerIds = new Set(Array.from(existingRows.values()).map((r) => r.player_id));
  const meta: SnapshotMeta = {
    season: deriveSeason(bootstrap.events),
    lastUpdated: new Date().toISOString(),
    latestGw,
    playerCount: playerIds.size,
    rowCount: existingRows.size,
  };
  writeMeta(metaPath, meta);
  console.log(`   Metadata:     ${metaPath}`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

// Detect whether this file is being executed directly (not imported by tests).
// pathToFileURL gives a reliable cross-platform comparison in ESM.
const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runIngest(parseArgs(process.argv)).catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
