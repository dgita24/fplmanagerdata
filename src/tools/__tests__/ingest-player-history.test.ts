/**
 * Tests for ingest-player-history.ts helper functions.
 *
 * Focuses on the two bugs that caused GW30 data to be missing from Supabase:
 *   1. Wrong field name (`is_finished` vs `finished`) on BootstrapEvent.
 *   2. Current (non-finished) GW never included in revalidateGws when
 *      recentGwRevalidate=0 (the nightly scheduled-run default).
 */

import { describe, it, expect } from 'vitest';
import {
  buildRevalidateGws,
  deriveSeason,
  normalizeRow,
  parseArgs,
} from '../ingest-player-history';

// --------------------------------------------------------------------------
// Minimal BootstrapEvent factory
// --------------------------------------------------------------------------
function makeEvent(
  id: number,
  is_current: boolean,
  finished: boolean,
  deadline_time = '2025-08-16T11:00:00Z',
) {
  return { id, is_current, finished, deadline_time };
}

// --------------------------------------------------------------------------
// buildRevalidateGws — the core fix
// --------------------------------------------------------------------------

describe('buildRevalidateGws — current GW always included when not finished', () => {
  it('includes current GW (not finished) even when recentGwRevalidate=0', () => {
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
      makeEvent(30, true, false), // GW30: current, not finished
    ];
    const result = buildRevalidateGws(events, 30, 0);
    expect(result.has(30)).toBe(true);
  });

  it('does NOT duplicate current GW when it is already finished and revalidate=0', () => {
    const events = [
      makeEvent(29, false, true),
      makeEvent(30, true, true), // GW30: current AND finished
    ];
    const result = buildRevalidateGws(events, 30, 0);
    // finished + is_current: not added via the "live" path, but may be added via revalidate window
    // With revalidate=0, loop covers gw=31..30 (no iterations) → not added
    expect(result.has(30)).toBe(false);
  });

  it('returns empty set when GW is finished and recentGwRevalidate=0', () => {
    const events = [
      makeEvent(29, false, true),
      makeEvent(30, true, true), // current & finished
    ];
    const result = buildRevalidateGws(events, 30, 0);
    expect(result.size).toBe(0);
  });

  it('includes current GW plus N most-recent when recentGwRevalidate=2', () => {
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
      makeEvent(30, true, false),
    ];
    const result = buildRevalidateGws(events, 30, 2);
    expect([...result].sort((a, b) => a - b)).toEqual([29, 30]);
  });

  it('includes only N most-recent GWs when all are finished', () => {
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
      makeEvent(30, true, true), // finished
    ];
    const result = buildRevalidateGws(events, 30, 2);
    expect([...result].sort((a, b) => a - b)).toEqual([29, 30]);
  });

  it('includes all GWs up to latestGw when recentGwRevalidate spans the full season', () => {
    const events = [
      makeEvent(29, false, true),
      makeEvent(30, true, false),
    ];
    const result = buildRevalidateGws(events, 30, 5);
    // revalidate covers GW26-30; current (30) also added by live-GW logic
    const arr = [...result].sort((a, b) => a - b);
    expect(arr).toEqual([26, 27, 28, 29, 30]);
  });

  it('handles no is_current event — treats current GW as finished (conservative)', () => {
    // If no event has is_current=true, currentGwFinished defaults to true → no forced add
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
    ];
    const result = buildRevalidateGws(events, 29, 0);
    expect(result.size).toBe(0);
  });

  it('handles latestGw=1 at the start of a season', () => {
    const events = [
      makeEvent(1, true, false),
    ];
    const result = buildRevalidateGws(events, 1, 0);
    expect(result.has(1)).toBe(true);
    expect(result.size).toBe(1);
  });
});

// --------------------------------------------------------------------------
// deriveSeason
// --------------------------------------------------------------------------

describe('deriveSeason', () => {
  it('derives correct season from deadline_time', () => {
    const events = [makeEvent(1, false, false, '2025-08-01T11:00:00Z')];
    expect(deriveSeason(events)).toBe('2025-26');
  });

  it('returns "unknown" for empty events', () => {
    expect(deriveSeason([])).toBe('unknown');
  });
});

// --------------------------------------------------------------------------
// normalizeRow — verify finished-game fields mapped correctly
// --------------------------------------------------------------------------

describe('normalizeRow', () => {
  it('maps basic fields from element-summary history entry', () => {
    const raw: Record<string, unknown> = {
      fixture: 123,
      round: 30,
      was_home: true,
      opponent_team: 7,
      kickoff_time: '2026-03-14T15:00:00Z',
      team_h_score: 2,
      team_a_score: 1,
      total_points: 9,
      goals_scored: 1,
      assists: 1,
      bonus: 3,
      bps: 35,
      clean_sheets: 0,
      goals_conceded: 1,
      own_goals: 0,
      penalties_saved: 0,
      penalties_missed: 0,
      yellow_cards: 0,
      red_cards: 0,
      saves: 0,
      clearances_blocks_interceptions: 3,
      tackles: 1,
      recoveries: 2,
      minutes: 90,
      expected_goals: '0.42',
      expected_assists: '0.17',
      expected_goal_involvements: '0.59',
      expected_goals_conceded: '1.23',
    };

    const row = normalizeRow(101, raw);

    expect(row.player_id).toBe(101);
    expect(row.gw).toBe(30);
    expect(row.fixture_id).toBe(123);
    expect(row.was_home).toBe(true);
    expect(row.total_points).toBe(9);
    expect(row.goals_scored).toBe(1);
    expect(row.assists).toBe(1);
    expect(row.expected_goals).toBe('0.42');
  });
});

// --------------------------------------------------------------------------
// parseArgs — basic sanity
// --------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to nightly mode with recentGwRevalidate=2', () => {
    const opts = parseArgs(['node', 'script.ts']);
    expect(opts.mode).toBe('nightly');
    expect(opts.recentGwRevalidate).toBe(2);
    expect(opts.supabase).toBe(false);
  });

  it('parses --recentGwRevalidate=0 correctly', () => {
    const opts = parseArgs(['node', 'script.ts', '--recentGwRevalidate=0']);
    expect(opts.recentGwRevalidate).toBe(0);
  });

  it('parses --supabase flag', () => {
    const opts = parseArgs(['node', 'script.ts', '--supabase']);
    expect(opts.supabase).toBe(true);
  });
});
