/**
 * Tests for ingest-player-history.ts helper functions.
 *
 * Covers:
 *   1. buildRevalidateGws — only uses recentGwRevalidate window (no unconditional latestGw).
 *   2. computeLivePlayerIds — selective revalidation from /event/{gw}/live response.
 *   3. deriveSeason, normalizeRow, parseArgs — unchanged helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRevalidateGws,
  computeLivePlayerIds,
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
// buildRevalidateGws — only handles recentGwRevalidate window
// The current unfinished GW is no longer forcibly added here; instead
// runIngest uses computeLivePlayerIds for selective per-player revalidation.
// --------------------------------------------------------------------------

describe('buildRevalidateGws', () => {
  it('returns empty set when recentGwRevalidate=0 (regardless of current GW state)', () => {
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
      makeEvent(30, true, false), // GW30: current, not finished
    ];
    const result = buildRevalidateGws(events, 30, 0);
    expect(result.size).toBe(0);
  });

  it('returns empty set when GW is finished and recentGwRevalidate=0', () => {
    const events = [
      makeEvent(29, false, true),
      makeEvent(30, true, true), // current & finished
    ];
    const result = buildRevalidateGws(events, 30, 0);
    expect(result.size).toBe(0);
  });

  it('includes N most-recent GWs when recentGwRevalidate=2', () => {
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

  it('includes all GWs in window when recentGwRevalidate spans multiple GWs', () => {
    const events = [
      makeEvent(29, false, true),
      makeEvent(30, true, false),
    ];
    const result = buildRevalidateGws(events, 30, 5);
    const arr = [...result].sort((a, b) => a - b);
    expect(arr).toEqual([26, 27, 28, 29, 30]);
  });

  it('handles no is_current event — returns empty when recentGwRevalidate=0', () => {
    const events = [
      makeEvent(28, false, true),
      makeEvent(29, false, true),
    ];
    const result = buildRevalidateGws(events, 29, 0);
    expect(result.size).toBe(0);
  });

  it('handles latestGw=1 at the start of a season with recentGwRevalidate=0', () => {
    const events = [
      makeEvent(1, true, false),
    ];
    const result = buildRevalidateGws(events, 1, 0);
    // No unconditional add for unfinished GW — must use recentGwRevalidate >= 1 to include it
    expect(result.size).toBe(0);
  });

  it('includes latestGw=1 when recentGwRevalidate=1', () => {
    const events = [
      makeEvent(1, true, false),
    ];
    const result = buildRevalidateGws(events, 1, 1);
    expect(result.has(1)).toBe(true);
    expect(result.size).toBe(1);
  });
});

// --------------------------------------------------------------------------
// computeLivePlayerIds — selective live-GW revalidation
// --------------------------------------------------------------------------

describe('computeLivePlayerIds', () => {
  it('returns IDs of players with minutes > 0', () => {
    const liveData = {
      elements: [
        { id: 1, stats: { minutes: 90 } },
        { id: 2, stats: { minutes: 0 } },
        { id: 3, stats: { minutes: 1 } },
        { id: 4, stats: { minutes: 45 } },
      ],
    };
    const result = computeLivePlayerIds(liveData);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(false); // 0 minutes — skip
    expect(result.has(3)).toBe(true);  // even 1 minute counts (e.g. sent off immediately)
    expect(result.has(4)).toBe(true);
    expect(result.size).toBe(3);
  });

  it('returns empty set when no players have played yet', () => {
    const liveData = {
      elements: [
        { id: 1, stats: { minutes: 0 } },
        { id: 2, stats: { minutes: 0 } },
      ],
    };
    const result = computeLivePlayerIds(liveData);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty elements array', () => {
    const liveData = { elements: [] };
    const result = computeLivePlayerIds(liveData);
    expect(result.size).toBe(0);
  });

  it('includes all players when all have played', () => {
    const liveData = {
      elements: [
        { id: 10, stats: { minutes: 90 } },
        { id: 20, stats: { minutes: 90 } },
        { id: 30, stats: { minutes: 60 } },
      ],
    };
    const result = computeLivePlayerIds(liveData);
    expect(result.size).toBe(3);
    expect(result.has(10)).toBe(true);
    expect(result.has(20)).toBe(true);
    expect(result.has(30)).toBe(true);
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
