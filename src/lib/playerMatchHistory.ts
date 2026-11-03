/**
 * Player Match History helpers.
 * Pure functions for DC calculation, score/venue formatting, date formatting.
 * Used by PlayerMatchHistorySheet and unit tests.
 */

export interface MatchHistoryRow {
  fixture: number;
  kickoff_time: string | null;
  round: number;
  was_home: boolean;
  team_h_score: number | null;
  team_a_score: number | null;
  opponent_team: number;
  total_points: number;
  minutes: number;
  bonus: number;
  goals_scored: number;
  assists: number;
  saves: number;
  penalties_saved: number;
  clearances_blocks_interceptions: number;
  tackles: number;
  recoveries: number;
  expected_goals?: string;
  expected_assists?: string;
  [key: string]: unknown;
}

/**
 * Raw defensive contribution total for a single match row.
 *   GK (1):        0
 *   DEF (2):       CBIT  = clearances_blocks_interceptions + tackles
 *   MID/FWD (3,4): CBITR = CBIT + recoveries
 */
export function computeMatchDCRaw(row: MatchHistoryRow, elementType: number): number {
  if (elementType === 1) return 0;

  const cbit = (row.clearances_blocks_interceptions ?? 0) + (row.tackles ?? 0);

  if (elementType === 2) return cbit;

  return cbit + (row.recoveries ?? 0);
}

/**
 * Compute DC (DEFCON) points for a single match row.
 * +2 if raw total >= 10 (DEF) or >= 12 (MID/FWD); GK always 0.
 */
export function computeMatchDC(row: MatchHistoryRow, elementType: number): number {
  if (elementType === 1) return 0;

  const threshold = elementType === 2 ? 10 : 12;
  return computeMatchDCRaw(row, elementType) >= threshold ? 2 : 0;
}

/**
 * Format a kickoff_time ISO string to a human-friendly date/time.
 * e.g. "2025-08-16T14:00:00Z" → "16 Aug, 14:00"
 */
export function formatMatchDate(kickoffTime: string | null): string {
  if (!kickoffTime) return '—';
  try {
    const d = new Date(kickoffTime);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date}, ${time}`;
  } catch {
    return kickoffTime;
  }
}

/**
 * Format opponent + venue indicator.
 * e.g. "ARS (H)" or "CHE (A)"
 */
export function formatOpponentVenue(opponentShortName: string, wasHome: boolean): string {
  return `${opponentShortName} (${wasHome ? 'H' : 'A'})`;
}

/**
 * Filter match history rows by venue.
 *   'all'  → all rows unchanged
 *   'home' → rows where was_home === true
 *   'away' → rows where was_home === false
 */
export type VenueFilter = 'all' | 'home' | 'away';

export function filterHistoryRows(
  rows: MatchHistoryRow[],
  filter: VenueFilter,
): MatchHistoryRow[] {
  if (filter === 'home') return rows.filter((r) => r.was_home === true);
  if (filter === 'away') return rows.filter((r) => r.was_home === false);
  return rows;
}

/**
 * Format score from the player's perspective.
 *   was_home=true  → team_h_score – team_a_score
 *   was_home=false → team_a_score – team_h_score
 * Returns '—' when either score is null (e.g. postponed or future fixture).
 */
export function formatScore(
  wasHome: boolean,
  teamHScore: number | null,
  teamAScore: number | null,
): string {
  if (teamHScore === null || teamAScore === null) return '—';
  return wasHome
    ? `${teamHScore}–${teamAScore}`
    : `${teamAScore}–${teamHScore}`;
}
