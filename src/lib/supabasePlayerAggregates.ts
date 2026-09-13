/**
 * Browser-side helper for fetching per-player aggregated stats from Supabase.
 * Queries the `player_match_history` table directly and aggregates client-side.
 *
 * No custom SQL function is required — this works with the base table that the
 * ingest pipeline writes to.
 *
 * Used by PlayerExplorer (inline mode on /players) to populate the main
 * aggregated stats table without pulling all raw match rows client-side.
 */
import { supabase } from './supabase';
import { computeMatchDC } from './playerMatchHistory';

export type VenueFilter = 'all' | 'home' | 'away';

export interface PlayerAggregate {
  player_id: number;
  matches: number;
  total_points: number;
  avg_points: number;
  goals_scored: number;
  assists: number;
  bonus: number;
  minutes: number;
  clean_sheets: number;
  goals_conceded: number;
  saves: number;
  yellow_cards: number;
  red_cards: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  expected_goals: number;
  expected_assists: number;
  expected_goal_involvements: number;
  expected_goals_conceded: number;
  defcon_points: number;
  min_gw: number;
  max_gw: number;
}

const SELECTED_COLS = [
  'player_id', 'fixture_id', 'gw', 'was_home', 'opponent_team',
  'total_points', 'goals_scored', 'assists', 'bonus', 'minutes',
  'clean_sheets', 'goals_conceded', 'saves',
  'yellow_cards', 'red_cards', 'own_goals',
  'penalties_saved', 'penalties_missed',
  'expected_goals', 'expected_assists',
  'expected_goal_involvements', 'expected_goals_conceded',
  'clearances_blocks_interceptions', 'tackles', 'recoveries',
].join(',');

const PAGE_SIZE = 1000;

/**
 * Fetch aggregated player stats by querying `player_match_history` directly.
 * Aggregation is performed client-side over the N most-recent GW window.
 *
 * DC (DEFCON) points are NOT computed here — they are derived separately in
 * PlayerExplorer from FPL live event data (defconByGW), which is the same
 * authoritative source as the season DC column. This avoids window-anchor
 * drift when the Supabase table lags behind the FPL API by one GW.
 *
 * @param venue  'all' | 'home' | 'away'
 * @param lastN  Number of most-recent GWs to include (e.g. 5 = last 5 GWs).
 *               GWs are determined by the max GW in the table minus lastN.
 */
export async function fetchPlayerAggregates(
  venue: VenueFilter = 'all',
  lastN: number = 5,
  elementTypeByPlayerId: Map<number, number> = new Map(),
): Promise<PlayerAggregate[]> {
  const { data: maxGwRow, error: maxGwErr } = await supabase
    .from('player_match_history')
    .select('gw')
    .order('gw', { ascending: false })
    .limit(1)
    .single();

  if (maxGwErr) throw maxGwErr;

  const maxGw: number = maxGwRow.gw;
  const minGw: number = Math.max(1, maxGw - lastN + 1);

  const buildQuery = (offset: number) => {
    const base = supabase
      .from('player_match_history')
      .select(SELECTED_COLS)
      .gte('gw', minGw)
      .lte('gw', maxGw)
      .order('player_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (venue === 'home') return base.eq('was_home', true);
    if (venue === 'away') return base.eq('was_home', false);
    return base;
  };

  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery(offset);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const aggMap = new Map<number, PlayerAggregate>();

  for (const row of allRows) {
    const pid = Number(row.player_id);
    const elementType = Number(elementTypeByPlayerId.get(pid) ?? 0);

    const pts = Number(row.total_points ?? 0);
    const gs  = Number(row.goals_scored ?? 0);
    const ast = Number(row.assists ?? 0);
    const bon = Number(row.bonus ?? 0);
    const min = Number(row.minutes ?? 0);
    const cs  = Number(row.clean_sheets ?? 0);
    const gc  = Number(row.goals_conceded ?? 0);
    const svs = Number(row.saves ?? 0);
    const yc  = Number(row.yellow_cards ?? 0);
    const rc  = Number(row.red_cards ?? 0);
    const og  = Number(row.own_goals ?? 0);
    const ps  = Number(row.penalties_saved ?? 0);
    const pm  = Number(row.penalties_missed ?? 0);
    const xg  = parseFloat(String(row.expected_goals ?? '0'));
    const xa  = parseFloat(String(row.expected_assists ?? '0'));
    const xgi = parseFloat(String(row.expected_goal_involvements ?? '0'));
    const xgc = parseFloat(String(row.expected_goals_conceded ?? '0'));

    const dc = elementType >= 1
      ? computeMatchDC(
          {
            fixture: Number(row.fixture_id ?? 0),
            kickoff_time: null,
            round: Number(row.gw ?? 0),
            was_home: Boolean(row.was_home),
            team_h_score: null,
            team_a_score: null,
            opponent_team: Number(row.opponent_team ?? 0),
            total_points: pts,
            minutes: min,
            bonus: bon,
            goals_scored: gs,
            assists: ast,
            saves: svs,
            penalties_saved: ps,
            clearances_blocks_interceptions: Number(row.clearances_blocks_interceptions ?? 0),
            tackles: Number(row.tackles ?? 0),
            recoveries: Number(row.recoveries ?? 0),
          },
          elementType
        )
      : 0;

    const existing = aggMap.get(pid);

    if (!existing) {
      aggMap.set(pid, {
        player_id: pid,
        matches: 1,
        total_points: pts,
        avg_points: pts,
        goals_scored: gs,
        assists: ast,
        bonus: bon,
        minutes: min,
        clean_sheets: cs,
        goals_conceded: gc,
        saves: svs,
        yellow_cards: yc,
        red_cards: rc,
        own_goals: og,
        penalties_saved: ps,
        penalties_missed: pm,
        expected_goals: xg,
        expected_assists: xa,
        expected_goal_involvements: xgi,
        expected_goals_conceded: xgc,
        defcon_points: dc,
        min_gw: minGw,
        max_gw: maxGw,
      });
    } else {
      existing.matches += 1;
      existing.total_points += pts;
      existing.goals_scored += gs;
      existing.assists += ast;
      existing.bonus += bon;
      existing.minutes += min;
      existing.clean_sheets += cs;
      existing.goals_conceded += gc;
      existing.saves += svs;
      existing.yellow_cards += yc;
      existing.red_cards += rc;
      existing.own_goals += og;
      existing.penalties_saved += ps;
      existing.penalties_missed += pm;
      existing.expected_goals += xg;
      existing.expected_assists += xa;
      existing.expected_goal_involvements += xgi;
      existing.expected_goals_conceded += xgc;
      existing.defcon_points += dc;
    }
  }

  for (const agg of aggMap.values()) {
    agg.avg_points = Math.round((agg.total_points / agg.matches) * 100) / 100;
    agg.expected_goals = Math.round(agg.expected_goals * 100) / 100;
    agg.expected_assists = Math.round(agg.expected_assists * 100) / 100;
    agg.expected_goal_involvements = Math.round(agg.expected_goal_involvements * 100) / 100;
    agg.expected_goals_conceded = Math.round(agg.expected_goals_conceded * 100) / 100;
  }

  return Array.from(aggMap.values());
}
