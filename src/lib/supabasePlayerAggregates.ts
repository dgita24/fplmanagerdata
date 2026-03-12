/**
 * Browser-side helper for fetching per-player aggregated stats from Supabase.
 * Calls the `get_player_aggregates` RPC function.
 *
 * Used by PlayerExplorer (inline mode on /players) to populate the main
 * aggregated stats table without pulling all raw match rows client-side.
 */
import { supabase } from './supabase';

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
  min_gw: number;
  max_gw: number;
}

/**
 * Fetch aggregated player stats from Supabase via the `get_player_aggregates` RPC.
 *
 * @param venue  'all' | 'home' | 'away'
 * @param lastN  Number of most-recent GWs to include (e.g. 5 = last 5 GWs)
 */
export async function fetchPlayerAggregates(
  venue: VenueFilter = 'all',
  lastN: number = 5,
): Promise<PlayerAggregate[]> {
  const { data, error } = await supabase.rpc('get_player_aggregates', {
    p_venue: venue,
    p_last_n: lastN,
  });
  if (error) throw error;
  return (data ?? []) as PlayerAggregate[];
}
