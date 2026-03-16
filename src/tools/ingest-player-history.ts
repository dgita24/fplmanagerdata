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
 *   --recentGwRevalidate=N    Force re-fetch of the N most-recent GWs for ALL players
 *                             even if already cached (default: 0 — use live-endpoint
 *                             selection instead; set to 2+ to force a full window refresh)
 *   --outDir=./data           Output directory (default: ./data)
 *   --baseUrl=<url>           FPL API base URL (default: https://fantasy.premierleague.com/api)
 *   --supabase                Enable Supabase upsert (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env)
 *
 * Anti-block / throttling options:
 *   --delayMs=N               Delay (ms) before each element-summary request (default: 800)
 *   --jitterMs=N              Random jitter (ms) added to delay (default: 200)
 *   --maxRequests=N           Optional cap on number of element-summary requests per run
 *
 * --- Nightly run behaviour (recentGwRevalidate=0, the default) ---
 *
 * For finished GWs:
 *   Fetches element-summary only for players who are missing a row for any
 *   finished GW (e.g. newly-added players or newly-finished GWs).
 *
 * For the current in-progress GW:
 *   1. Makes ONE call to /event/{gw}/live to check which players have
 *      minutes > 0 (i.e. have actually played a match since the last run).
 *   2. Fetches element-summary ONLY for those players.
 *   3. If /event/{gw}/live fails, falls back conservatively to revalidating
 *      the current GW for all players (logged clearly).
 *
 * Result when no games have been played since the last run:
 *   - /event/{gw}/live returns 0 players with minutes > 0.
 *   - 0 element-summary requests are made.
 *   - Snapshot and Supabase are unchanged.
 *   - Run completes in seconds.
 *
 * Supabase upsert:
 *   Only rows that were inserted or updated in this run are upserted (delta).
 *   When there are no changes, the upsert is skipped entirely.
 *
 * Examples:
 *   # Nightly run (only fetch players who need updating)
 *   npx tsx src/tools/ingest-player-history.ts --mode=nightly
 *
 *   # Nightly run + upsert to Supabase
 *   npx tsx src/tools/ingest-player-history.ts --mode=nightly --supabase
 *
 *   # Force re-fetch the last 2 GWs for all players (e.g. after a data issue)
 *   npx tsx src/tools/ingest-player-history.ts --mode=nightly --recentGwRevalidate=2
 *
 *   # Backfill GW 1–10
 *   npx tsx src/tools/ingest-player-history.ts --mode=backfill --startGw=1 --endGw=10
 *
 *   # Use local proxy instead of direct FPL API
 *   npx tsx src/tools/ingest-player-history.ts --baseUrl=http://localhost:4321/api/fpl
 *
 *   # Slow it down further (extra safe)
 *   npx tsx src/tools/ingest-player-history.ts --mode=nightly --delayMs=1200 --jitterMs=400
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
  /** When true, upsert rows to Supabase using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars. */
  supabase: boolean;

  /** Delay in ms before each element-summary request. */
  delayMs: number;
  /** Random jitter in ms added to delay. */
  jitterMs: number;
  /** Optional cap on number of element-summary requests per run. */
  maxRequests?: number;
}

// ── CLI argument parsing ───────────────────────────────────────────────────────

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  if (value.trim() === '') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseRequiredInt(name: string, value: string | undefined): number {
  const n = parseOptionalInt(value);
  if (n == null) throw new Error(`${name} must be an integer`);
  return n;
}

export function parseArgs(argv: string[]): IngestOptions {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      // Boolean flag: --supabase → args['supabase'] = 'true'
      args[arg.replace(/^--/, '')] = 'true';
      continue;
    }
    const key = arg.slice(0, eq).replace(/^--/, '');
    const val = arg.slice(eq + 1);
    args[key] = val;
  }

  const mode = (args['mode'] ?? 'nightly') as 'nightly' | 'backfill';
  if (mode !== 'nightly' && mode !== 'backfill') {
    throw new Error(`--mode must be "nightly" or "backfill", got "${mode}"`);
  }

  const startGw = parseOptionalInt(args['startGw']);
  const endGw = parseOptionalInt(args['endGw']);

  if (mode === 'backfill') {
    if (startGw === undefined || endGw === undefined) {
      throw new Error('--startGw and --endGw are required in backfill mode');
    }
    if (isNaN(startGw) || isNaN(endGw) || startGw < 1 || endGw > 38 || startGw > endGw) {
      throw new Error('--startGw and --endGw must be integers between 1–38 with start ≤ end');
    }
  }

  const recentGwRevalidate = parseOptionalInt(args['recentGwRevalidate']) ?? 0;
  const delayMs = parseOptionalInt(args['delayMs']) ?? 800;
  const jitterMs = parseOptionalInt(args['jitterMs']) ?? 200;
  const maxRequests = parseOptionalInt(args['maxRequests']);

  if (delayMs < 0) throw new Error('--delayMs must be >= 0');
  if (jitterMs < 0) throw new Error('--jitterMs must be >= 0');
  if (maxRequests != null && maxRequests <= 0) throw new Error('--maxRequests must be > 0');

  return {
    mode,
    startGw,
    endGw,
    recentGwRevalidate,
    outDir: args['outDir'] ?? './data',
    baseUrl: args['baseUrl'] ?? 'https://fantasy.premierleague.com/api',
    supabase: args['supabase'] === 'true',
    delayMs,
    jitterMs,
    maxRequests,
  };
}

// ── Rate-limiting & retry ──────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  if (ms <= 0) return 0;
  return Math.floor(Math.random() * (ms + 1));
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function defaultHeaders(): HeadersInit {
  return {
    'accept': 'application/json',
    // A stable, honest UA is better than looking like an anonymous script.
    'user-agent': 'fplmanagerdata-ingest/1.0 (+https://github.com/dgita24/fplmanagerdata)',
  };
}

function parseRetryAfterMs(res: Response): number | null {
  const ra = res.headers.get('retry-after');
  if (!ra) return null;

  // Retry-After can be seconds or a HTTP date. Handle seconds reliably.
  const seconds = parseInt(ra, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;

  const date = Date.parse(ra);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

export async function fetchWithRetry(
  url: string,
  retries = 3,
  baseDelayMs = 600,
): Promise<Response> {
  let lastError: Error = new Error('fetchWithRetry: no attempts made');

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: defaultHeaders() });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + jitter(250);
        console.warn(`  ⚠️  Network error for ${url}, retrying in ${Math.round(delay)}ms…`);
        await sleep(delay);
        continue;
      }
      break;
    }

    if (res.ok) return res;

    if (RETRYABLE_STATUSES.has(res.status) && attempt < retries) {
      // For 429, prefer server guidance via Retry-After.
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res) : null;

      // Use a larger base delay for 429s if no Retry-After provided.
      const effectiveBase = res.status === 429 ? Math.max(baseDelayMs, 2000) : baseDelayMs;

      const delay =
        (retryAfterMs ?? (effectiveBase * Math.pow(2, attempt) + jitter(500)));

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
  finished: boolean;
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

// ── GW live endpoint ───────────────────────────────────────────────────────────

/** Minimal typing for the /event/{gw}/live response. */
interface EventLiveStats {
  minutes: number;
}

interface EventLiveElement {
  id: number;
  stats: EventLiveStats;
}

interface EventLiveData {
  elements: EventLiveElement[];
}

/**
 * Fetch live stats for a specific GW from the FPL API.
 * Returns null if the fetch fails (caller should fall back conservatively).
 */
export async function fetchEventLive(
  baseUrl: string,
  gw: number,
): Promise<EventLiveData | null> {
  const url = `${baseUrl}/event/${gw}/live/`;
  console.log(`Fetching GW live data: ${url}`);
  try {
    const res = await fetchWithRetry(url);
    return res.json() as Promise<EventLiveData>;
  } catch (err) {
    console.warn(`  ⚠️  Failed to fetch /event/${gw}/live — will fall back conservatively:`, err);
    return null;
  }
}

/**
 * Compute the set of player IDs who have recorded minutes > 0 in GW live data.
 * These are players whose element-summary should be re-fetched for the current GW.
 */
export function computeLivePlayerIds(liveData: EventLiveData): Set<number> {
  const result = new Set<number>();
  for (const el of liveData.elements) {
    if (el.stats.minutes > 0) {
      result.add(el.id);
    }
  }
  return result;
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

// ── Supabase upsert (optional) ─────────────────────────────────────────────────

const SUPABASE_BATCH_SIZE = 500;

export async function upsertToSupabase(rows: MatchRow[]): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set for --supabase',
    );
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const total = rows.length;
  let upserted = 0;

  for (let i = 0; i < total; i += SUPABASE_BATCH_SIZE) {
    const batch = rows.slice(i, i + SUPABASE_BATCH_SIZE);

    const { error } = await supabase
      .from('player_match_history')
      .upsert(batch, { onConflict: 'player_id,fixture_id', ignoreDuplicates: false });

    if (error) {
      throw new Error(`Supabase upsert failed (batch starting at ${i}): ${error.message}`);
    }

    upserted += batch.length;
    console.log(`   Supabase: upserted ${upserted}/${total} rows…`);
  }

  console.log(`   Supabase: ✅ ${upserted} rows upserted to player_match_history`);
}

// ── Season derivation ──────────────────────────────────────────────────────────

export function deriveSeason(events: BootstrapEvent[]): string {
  const first = events[0];
  if (!first?.deadline_time) return 'unknown';
  const year = new Date(first.deadline_time).getFullYear();
  return `${year}-${String(year + 1).slice(2)}`;
}

// ── Revalidation window ────────────────────────────────────────────────────────

/**
 * Compute the set of GW IDs that should be re-fetched (revalidated) on this run
 * for ALL players (e.g. recently-finished GWs requested via --recentGwRevalidate).
 *
 * Note: the current (unfinished) GW is intentionally NOT added here.  Instead,
 * runIngest uses /event/{gw}/live to selectively revalidate only players who
 * have recorded minutes > 0, avoiding a full 820-player refresh every night.
 */
export function buildRevalidateGws(
  events: BootstrapEvent[],
  latestGw: number,
  recentGwRevalidate: number,
): Set<number> {
  const result = new Set<number>();
  for (
    let gw = Math.max(1, latestGw - recentGwRevalidate + 1);
    gw <= latestGw;
    gw++
  ) {
    result.add(gw);
  }
  return result;
}

// ── Main orchestration ─────────────────────────────────────────────────────────

export async function runIngest(opts: IngestOptions): Promise<void> {
  console.log('▶ Ingest options:', opts);

  fs.mkdirSync(opts.outDir, { recursive: true });

  const snapshotPath = path.join(opts.outDir, 'player-history.ndjson');
  const metaPath = path.join(opts.outDir, 'player-history-meta.json');

  const existingRows = await loadExistingSnapshot(snapshotPath);

  const bootstrap = await fetchBootstrap(opts.baseUrl);

  const currentEvent = bootstrap.events.find((e) => e.is_current);
  const finishedEvents = bootstrap.events.filter((e) => e.finished);
  const latestGw =
    currentEvent?.id ?? (finishedEvents.length > 0 ? finishedEvents[finishedEvents.length - 1].id : 1);

  console.log(`Current GW: ${latestGw} | Total players: ${bootstrap.elements.length}`);

  const revalidateGws = buildRevalidateGws(bootstrap.events, latestGw, opts.recentGwRevalidate);
  if (revalidateGws.size > 0) {
    console.log(`Will revalidate GWs (all players): ${[...revalidateGws].sort((a, b) => a - b).join(', ')}`);
  }

  // ── Live GW selective revalidation ────────────────────────────────────────
  // For the current unfinished GW, only re-fetch players who have minutes > 0
  // in the live endpoint, rather than hammering all 820 players every night.
  const currentGwFinished = currentEvent?.finished ?? true;
  let livePlayerIds: Set<number> | null = null;
  let liveEndpointFailed = false;

  if (!currentGwFinished) {
    const liveData = await fetchEventLive(opts.baseUrl, latestGw);
    if (liveData !== null) {
      livePlayerIds = computeLivePlayerIds(liveData);
      if (livePlayerIds.size === 0) {
        console.log(
          `GW${latestGw} live: no players have minutes > 0 yet — ` +
          `no matches played since last run. Skipping element-summary fetches for current GW.`,
        );
      } else {
        console.log(
          `GW${latestGw} live: ${livePlayerIds.size} players have minutes > 0 ` +
          `(will re-fetch element-summary for those players only)`,
        );
      }
    } else {
      // Fallback: live endpoint failed — revalidate latestGw for all players to
      // ensure we never miss data. This is the conservative path.
      liveEndpointFailed = true;
      console.warn(
        `⚠️  /event/${latestGw}/live failed. Falling back to revalidating GW${latestGw} ` +
        `for ALL players (conservative fallback). This may cause a full ~820-player refresh.`,
      );
      revalidateGws.add(latestGw);
    }
  } else {
    console.log(`GW${latestGw} is finished — no live-endpoint fetch needed.`);
  }

  const gwRangeStart = opts.mode === 'backfill' && opts.startGw ? opts.startGw : 1;
  const gwRangeEnd = opts.mode === 'backfill' && opts.endGw ? opts.endGw : latestGw;

  const existingByPlayerGw = new Map<string, boolean>();
  for (const row of existingRows.values()) {
    existingByPlayerGw.set(`${row.player_id}:${row.gw}`, true);
  }

  let processed = 0;
  let newRows = 0;
  let updatedRows = 0;

  let elementSummaryRequests = 0;

  // Track only rows that were inserted or updated this run (for delta upsert).
  const changedRows = new Map<string, MatchRow>();

  for (const player of bootstrap.elements) {
    processed++;
    if (processed % 100 === 0) {
      console.log(`  Progress: ${processed}/${bootstrap.elements.length} players…`);
    }

    // True when this specific player should have their current (unfinished) GW re-fetched
    // because they have recorded minutes > 0 in the live endpoint.
    const playerHasLiveMinutes =
      !currentGwFinished && !liveEndpointFailed && livePlayerIds !== null && livePlayerIds.has(player.id);

    let needFetch = false;

    for (let gw = gwRangeStart; gw <= gwRangeEnd; gw++) {
      // Revalidate this GW for all players (e.g. recent finished GWs or live-fallback).
      if (revalidateGws.has(gw)) {
        needFetch = true;
        break;
      }
      // For the current unfinished GW, only fetch if this player has live minutes.
      if (gw === latestGw && !currentGwFinished && !liveEndpointFailed) {
        if (playerHasLiveMinutes) {
          needFetch = true;
          break;
        }
        // Player has no live minutes yet — skip (no data to update).
        continue;
      }
      // For any finished GW: fetch if we're missing a row for this player.
      if (!existingByPlayerGw.has(`${player.id}:${gw}`)) {
        const event = bootstrap.events.find((e) => e.id === gw);
        if (event?.finished) {
          needFetch = true;
          break;
        }
      }
    }

    if (!needFetch) continue;

    if (opts.maxRequests != null && elementSummaryRequests >= opts.maxRequests) {
      console.warn(
        `Reached --maxRequests=${opts.maxRequests}. Stopping early to reduce load. ` +
        `Processed ${processed}/${bootstrap.elements.length} players.`,
      );
      break;
    }

    // Delay with jitter (anti-bot: avoid perfectly periodic pattern)
    await sleep(opts.delayMs + jitter(opts.jitterMs));

    try {
      elementSummaryRequests++;
      const summary = await fetchElementSummary(opts.baseUrl, player.id);
      const history = summary.history ?? [];

      for (const rawRow of history) {
        const gw = Number(rawRow['round']);
        if (gw < gwRangeStart || gw > gwRangeEnd) continue;

        const row = normalizeRow(player.id, rawRow);
        const key = rowKey(row);
        const isRevalidate =
          revalidateGws.has(gw) ||
          (gw === latestGw && playerHasLiveMinutes);

        if (!existingRows.has(key)) {
          existingRows.set(key, row);
          existingByPlayerGw.set(`${row.player_id}:${row.gw}`, true);
          changedRows.set(key, row);
          newRows++;
        } else if (isRevalidate) {
          existingRows.set(key, row);
          changedRows.set(key, row);
          updatedRows++;
        }
      }
    } catch (err) {
      console.error(`  ❌ Failed to fetch player ${player.id} (${player.web_name}):`, err);
    }
  }

  console.log(`\n✅ Ingest complete`);
  console.log(`   element-summary requests: ${elementSummaryRequests}`);
  console.log(`   New rows:     ${newRows}`);
  console.log(`   Updated rows: ${updatedRows}`);
  console.log(`   Changed rows (delta): ${changedRows.size}`);
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

  if (opts.supabase) {
    console.log(`\n▶ Upserting to Supabase (delta: ${changedRows.size} changed rows)…`);
    const rowsToUpsert = Array.from(changedRows.values());
    if (rowsToUpsert.length > 0) {
      await upsertToSupabase(rowsToUpsert);
    } else {
      console.log(`   Supabase: no changed rows — skipping upsert.`);
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runIngest(parseArgs(process.argv)).catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
