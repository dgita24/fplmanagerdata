/**
 * Player History Snapshot — consumer helper
 *
 * Provides utilities for loading, filtering, and aggregating the NDJSON
 * player history snapshot produced by the ingest script.
 *
 * Intended for use in both dgita24/fplmanagerdata and dgita24/FPLPlanner.
 * No UI dependencies — pure data utilities.
 *
 * Example (browser / Astro):
 *   import { fetchSnapshot, filterLastNGws, computeAllPlayerAverages } from '@/lib/playerHistorySnapshot';
 *
 *   const { rows } = await fetchSnapshot('/data/player-history.ndjson');
 *   const last6 = filterLastNGws(rows, 6);
 *   const ranked = computeAllPlayerAverages(last6, 'avgXG');
 *
 * Example (Node / CI):
 *   import { loadSnapshotFromFile, filterByVenue } from './playerHistorySnapshot';
 *   const rows = await loadSnapshotFromFile('./data/player-history.ndjson');
 */

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

export interface SnapshotData {
  rows: MatchRow[];
  meta: SnapshotMeta | null;
}

export interface PlayerAverages {
  player_id: number;
  sampleSize: number;
  avgMinutes: number;
  avgPoints: number;
  avgGoals: number;
  avgAssists: number;
  avgBonus: number;
  avgBps: number;
  avgCleanSheets: number;
  avgGoalsConceded: number;
  avgSaves: number;
  avgXG: number;
  avgXA: number;
  avgXGI: number;
  avgXGC: number;
  totalGoals: number;
  totalAssists: number;
}

export type VenueFilter = 'all' | 'home' | 'away';

export type SortableAvgKey = keyof PlayerAverages;

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse NDJSON text (one JSON object per line) into an array of MatchRow objects.
 * Malformed lines are silently skipped.
 */
export function parseNdjson(text: string): MatchRow[] {
  const rows: MatchRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as MatchRow);
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

// ── Data loading ──────────────────────────────────────────────────────────────

/**
 * Fetch snapshot from a URL (browser or server-side).
 * Optionally also fetches the metadata JSON.
 *
 * @param snapshotUrl  URL to the player-history.ndjson file
 * @param metaUrl      Optional URL to the player-history-meta.json file
 */
export async function fetchSnapshot(
  snapshotUrl: string,
  metaUrl?: string,
): Promise<SnapshotData> {
  const requests: [Promise<Response>, Promise<Response | null>] = [
    fetch(snapshotUrl),
    metaUrl ? fetch(metaUrl) : Promise.resolve(null),
  ];

  const [ndjsonRes, metaRes] = await Promise.all(requests);

  if (!ndjsonRes.ok) {
    throw new Error(`Failed to fetch snapshot: HTTP ${ndjsonRes.status} from ${snapshotUrl}`);
  }

  const text = await ndjsonRes.text();
  const rows = parseNdjson(text);

  let meta: SnapshotMeta | null = null;
  if (metaRes?.ok) {
    meta = (await metaRes.json()) as SnapshotMeta;
  }

  return { rows, meta };
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Filter rows to the last N distinct gameweeks (highest round numbers) across
 * all players in the dataset.
 *
 * Useful for "show all players from the last 6 GWs" views.
 */
export function filterLastNGws(rows: MatchRow[], n: number): MatchRow[] {
  if (n <= 0) return rows;
  const gws = [...new Set(rows.map((r) => r.gw))].sort((a, b) => b - a);
  const topGws = new Set(gws.slice(0, n));
  return rows.filter((r) => topGws.has(r.gw));
}

/**
 * Filter rows to the last N matches *per player* (most recent N fixtures for
 * each individual player).
 *
 * Useful when you want every player represented by exactly N rows.
 */
export function filterLastNMatches(rows: MatchRow[], n: number): MatchRow[] {
  if (n <= 0) return rows;

  const byPlayer = groupByPlayer(rows);
  const result: MatchRow[] = [];

  for (const playerRows of byPlayer.values()) {
    const sorted = [...playerRows].sort(
      (a, b) => b.gw - a.gw || b.fixture_id - a.fixture_id,
    );
    result.push(...sorted.slice(0, n));
  }

  return result;
}

/**
 * Filter rows by venue.
 *   'all'  → return all rows
 *   'home' → rows where the player was at home
 *   'away' → rows where the player was away
 */
export function filterByVenue(rows: MatchRow[], venue: VenueFilter): MatchRow[] {
  if (venue === 'home') return rows.filter((r) => r.was_home);
  if (venue === 'away') return rows.filter((r) => !r.was_home);
  return rows;
}

// ── Grouping ──────────────────────────────────────────────────────────────────

/**
 * Group rows by player_id into a Map.
 */
export function groupByPlayer(rows: MatchRow[]): Map<number, MatchRow[]> {
  const map = new Map<number, MatchRow[]>();
  for (const row of rows) {
    const bucket = map.get(row.player_id);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.player_id, [row]);
    }
  }
  return map;
}

// ── Averages ──────────────────────────────────────────────────────────────────

/**
 * Compute aggregate/average statistics for a single player from an array of
 * their match rows.
 */
export function computePlayerAverages(
  playerId: number,
  rows: MatchRow[],
): PlayerAverages {
  if (rows.length === 0) {
    return {
      player_id: playerId,
      sampleSize: 0,
      avgMinutes: 0,
      avgPoints: 0,
      avgGoals: 0,
      avgAssists: 0,
      avgBonus: 0,
      avgBps: 0,
      avgCleanSheets: 0,
      avgGoalsConceded: 0,
      avgSaves: 0,
      avgXG: 0,
      avgXA: 0,
      avgXGI: 0,
      avgXGC: 0,
      totalGoals: 0,
      totalAssists: 0,
    };
  }

  const n = rows.length;
  const sumNum = (key: keyof MatchRow): number =>
    rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  return {
    player_id: playerId,
    sampleSize: n,
    avgMinutes: sumNum('minutes') / n,
    avgPoints: sumNum('total_points') / n,
    avgGoals: sumNum('goals_scored') / n,
    avgAssists: sumNum('assists') / n,
    avgBonus: sumNum('bonus') / n,
    avgBps: sumNum('bps') / n,
    avgCleanSheets: sumNum('clean_sheets') / n,
    avgGoalsConceded: sumNum('goals_conceded') / n,
    avgSaves: sumNum('saves') / n,
    avgXG: sumNum('expected_goals') / n,
    avgXA: sumNum('expected_assists') / n,
    avgXGI: sumNum('expected_goal_involvements') / n,
    avgXGC: sumNum('expected_goals_conceded') / n,
    totalGoals: sumNum('goals_scored'),
    totalAssists: sumNum('assists'),
  };
}

/**
 * Compute per-player averages for all players in a (pre-filtered) row set,
 * returning an array sorted by the specified metric.
 *
 * @param rows       Pre-filtered rows (e.g. last 6 GWs, home only)
 * @param sortBy     Column to sort by (default: 'avgPoints')
 * @param descending Sort descending (default: true)
 */
export function computeAllPlayerAverages(
  rows: MatchRow[],
  sortBy: SortableAvgKey = 'avgPoints',
  descending = true,
): PlayerAverages[] {
  const byPlayer = groupByPlayer(rows);

  const averages = Array.from(byPlayer.entries()).map(([pid, playerRows]) =>
    computePlayerAverages(pid, playerRows),
  );

  averages.sort((a, b) => {
    const diff = (b[sortBy] as number) - (a[sortBy] as number);
    return descending ? diff : -diff;
  });

  return averages;
}
