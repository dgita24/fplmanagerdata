import { describe, it, expect } from 'vitest';
import {
  parseNdjson,
  filterLastNGws,
  filterLastNMatches,
  filterByVenue,
  groupByPlayer,
  computePlayerAverages,
  computeAllPlayerAverages,
} from '../playerHistorySnapshot';
import type { MatchRow, PlayerAverages } from '../playerHistorySnapshot';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    player_id: 1,
    fixture_id: 100,
    gw: 1,
    was_home: true,
    opponent_team: 2,
    kickoff_time: '2025-08-16T14:00:00Z',
    team_h_score: 2,
    team_a_score: 1,
    minutes: 90,
    total_points: 6,
    goals_scored: 1,
    assists: 0,
    bonus: 2,
    bps: 22,
    clean_sheets: 0,
    goals_conceded: 1,
    own_goals: 0,
    penalties_saved: 0,
    penalties_missed: 0,
    yellow_cards: 0,
    red_cards: 0,
    saves: 0,
    clearances_blocks_interceptions: 0,
    tackles: 0,
    recoveries: 0,
    expected_goals: '0.45',
    expected_assists: '0.12',
    expected_goal_involvements: '0.57',
    expected_goals_conceded: '0.80',
    ...overrides,
  };
}

// ── parseNdjson ───────────────────────────────────────────────────────────────

describe('parseNdjson', () => {
  it('parses a single valid line', () => {
    const row = makeRow();
    const text = JSON.stringify(row) + '\n';
    const result = parseNdjson(text);
    expect(result).toHaveLength(1);
    expect(result[0].player_id).toBe(1);
  });

  it('parses multiple lines', () => {
    const rows = [makeRow({ fixture_id: 1 }), makeRow({ fixture_id: 2 })];
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    expect(parseNdjson(text)).toHaveLength(2);
  });

  it('skips blank lines', () => {
    const row = makeRow();
    const text = '\n' + JSON.stringify(row) + '\n\n';
    expect(parseNdjson(text)).toHaveLength(1);
  });

  it('skips malformed lines', () => {
    const text = 'not-json\n' + JSON.stringify(makeRow()) + '\n{bad}';
    expect(parseNdjson(text)).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseNdjson('')).toHaveLength(0);
    expect(parseNdjson('\n\n\n')).toHaveLength(0);
  });
});

// ── filterLastNGws ────────────────────────────────────────────────────────────

describe('filterLastNGws', () => {
  const rows = [
    makeRow({ gw: 1, fixture_id: 1 }),
    makeRow({ gw: 2, fixture_id: 2 }),
    makeRow({ gw: 3, fixture_id: 3 }),
    makeRow({ gw: 4, fixture_id: 4 }),
    makeRow({ gw: 5, fixture_id: 5 }),
  ];

  it('returns the last 3 GWs', () => {
    const result = filterLastNGws(rows, 3);
    const gws = result.map((r) => r.gw).sort((a, b) => a - b);
    expect(gws).toEqual([3, 4, 5]);
  });

  it('returns all rows when n >= total GW count', () => {
    expect(filterLastNGws(rows, 10)).toHaveLength(5);
  });

  it('returns all rows when n === 0 (disabled)', () => {
    expect(filterLastNGws(rows, 0)).toHaveLength(5);
  });

  it('handles rows from multiple players with the same GW', () => {
    const multi = [
      makeRow({ player_id: 1, gw: 5, fixture_id: 10 }),
      makeRow({ player_id: 2, gw: 5, fixture_id: 11 }),
      makeRow({ player_id: 1, gw: 4, fixture_id: 8 }),
      makeRow({ player_id: 2, gw: 3, fixture_id: 6 }),
    ];
    const result = filterLastNGws(multi, 2);
    // Should include GW 5 and GW 4 only
    const gws = new Set(result.map((r) => r.gw));
    expect(gws.has(5)).toBe(true);
    expect(gws.has(4)).toBe(true);
    expect(gws.has(3)).toBe(false);
  });

  it('handles empty input', () => {
    expect(filterLastNGws([], 3)).toHaveLength(0);
  });
});

// ── filterLastNMatches ────────────────────────────────────────────────────────

describe('filterLastNMatches', () => {
  const p1rows = [1, 2, 3, 4].map((gw) => makeRow({ player_id: 1, gw, fixture_id: gw }));
  const p2rows = [2, 3].map((gw) => makeRow({ player_id: 2, gw, fixture_id: gw + 10 }));
  const rows = [...p1rows, ...p2rows];

  it('keeps only the last N matches per player', () => {
    const result = filterLastNMatches(rows, 2);
    const p1 = result.filter((r) => r.player_id === 1);
    const p2 = result.filter((r) => r.player_id === 2);
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(2);
    // player 1 should have GW 3 and 4
    const p1Gws = p1.map((r) => r.gw).sort((a, b) => a - b);
    expect(p1Gws).toEqual([3, 4]);
  });

  it('returns all matches when n >= player match count', () => {
    const result = filterLastNMatches(rows, 10);
    expect(result).toHaveLength(6);
  });

  it('handles empty input', () => {
    expect(filterLastNMatches([], 3)).toHaveLength(0);
  });
});

// ── filterByVenue ─────────────────────────────────────────────────────────────

describe('filterByVenue', () => {
  const home1 = makeRow({ fixture_id: 1, was_home: true });
  const home2 = makeRow({ fixture_id: 2, was_home: true });
  const away1 = makeRow({ fixture_id: 3, was_home: false });
  const rows = [home1, home2, away1];

  it('returns all rows for "all"', () => {
    expect(filterByVenue(rows, 'all')).toHaveLength(3);
  });

  it('returns only home rows for "home"', () => {
    const result = filterByVenue(rows, 'home');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.was_home)).toBe(true);
  });

  it('returns only away rows for "away"', () => {
    const result = filterByVenue(rows, 'away');
    expect(result).toHaveLength(1);
    expect(result[0].was_home).toBe(false);
  });

  it('returns empty array when no rows match', () => {
    expect(filterByVenue([home1, home2], 'away')).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(filterByVenue([], 'home')).toHaveLength(0);
  });
});

// ── groupByPlayer ─────────────────────────────────────────────────────────────

describe('groupByPlayer', () => {
  it('groups rows by player_id', () => {
    const rows = [
      makeRow({ player_id: 1, fixture_id: 1 }),
      makeRow({ player_id: 2, fixture_id: 2 }),
      makeRow({ player_id: 1, fixture_id: 3 }),
    ];
    const map = groupByPlayer(rows);
    expect(map.size).toBe(2);
    expect(map.get(1)).toHaveLength(2);
    expect(map.get(2)).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    expect(groupByPlayer([])).toEqual(new Map());
  });
});

// ── computePlayerAverages ─────────────────────────────────────────────────────

describe('computePlayerAverages', () => {
  it('returns zeros for empty row array', () => {
    const avg = computePlayerAverages(99, []);
    expect(avg.sampleSize).toBe(0);
    expect(avg.avgPoints).toBe(0);
    expect(avg.avgXG).toBe(0);
  });

  it('computes correct averages for a single row', () => {
    const row = makeRow({
      player_id: 5,
      total_points: 8,
      goals_scored: 2,
      assists: 1,
      expected_goals: '1.20',
      expected_assists: '0.30',
    });
    const avg = computePlayerAverages(5, [row]);
    expect(avg.player_id).toBe(5);
    expect(avg.sampleSize).toBe(1);
    expect(avg.avgPoints).toBe(8);
    expect(avg.avgGoals).toBe(2);
    expect(avg.avgAssists).toBe(1);
    expect(avg.avgXG).toBeCloseTo(1.2);
    expect(avg.avgXA).toBeCloseTo(0.3);
  });

  it('computes correct averages for multiple rows', () => {
    const rows = [
      makeRow({ total_points: 6, goals_scored: 1, expected_goals: '0.50' }),
      makeRow({ total_points: 2, goals_scored: 0, expected_goals: '0.10' }),
      makeRow({ total_points: 10, goals_scored: 2, expected_goals: '1.20' }),
    ];
    const avg = computePlayerAverages(1, rows);
    expect(avg.sampleSize).toBe(3);
    expect(avg.avgPoints).toBeCloseTo(6); // (6+2+10)/3
    expect(avg.avgGoals).toBeCloseTo(1); // (1+0+2)/3
    expect(avg.avgXG).toBeCloseTo(0.6); // (0.5+0.1+1.2)/3
    expect(avg.totalGoals).toBe(3);
  });

  it('handles string xG values correctly', () => {
    const row = makeRow({ expected_goals: '0.75', expected_goals_conceded: '1.50' });
    const avg = computePlayerAverages(1, [row]);
    expect(avg.avgXG).toBeCloseTo(0.75);
    expect(avg.avgXGC).toBeCloseTo(1.5);
  });
});

// ── computeAllPlayerAverages ──────────────────────────────────────────────────

describe('computeAllPlayerAverages', () => {
  const rows = [
    makeRow({ player_id: 1, total_points: 10, expected_goals: '1.0' }),
    makeRow({ player_id: 2, total_points: 4, expected_goals: '0.2' }),
    makeRow({ player_id: 3, total_points: 7, expected_goals: '0.6' }),
  ];

  it('returns one entry per player', () => {
    const result = computeAllPlayerAverages(rows);
    expect(result).toHaveLength(3);
  });

  it('sorts by avgPoints descending by default', () => {
    const result = computeAllPlayerAverages(rows);
    const pts = result.map((r) => r.avgPoints);
    expect(pts[0]).toBeGreaterThanOrEqual(pts[1]);
    expect(pts[1]).toBeGreaterThanOrEqual(pts[2]);
  });

  it('sorts by avgXG descending when requested', () => {
    const result = computeAllPlayerAverages(rows, 'avgXG');
    const xgs = result.map((r) => r.avgXG);
    expect(xgs[0]).toBeGreaterThanOrEqual(xgs[1]);
    expect(xgs[1]).toBeGreaterThanOrEqual(xgs[2]);
  });

  it('sorts ascending when descending=false', () => {
    const result = computeAllPlayerAverages(rows, 'avgPoints', false);
    const pts = result.map((r) => r.avgPoints);
    expect(pts[0]).toBeLessThanOrEqual(pts[1]);
  });

  it('returns empty array for empty input', () => {
    expect(computeAllPlayerAverages([])).toHaveLength(0);
  });

  it('handles a player with no rows (sampleSize 0)', () => {
    // Simulate by calling computePlayerAverages directly
    const avg: PlayerAverages = computePlayerAverages(99, []);
    expect(avg.sampleSize).toBe(0);
    expect(avg.avgPoints).toBe(0);
  });
});

// ── Integration: filter chain ─────────────────────────────────────────────────

describe('filter chain integration', () => {
  it('last 3 GWs + home only → correct player averages sorted by xGC', () => {
    const rows = [
      // Player 1: GW 4 home (xGC=0.5), GW 5 away (xGC=1.2), GW 3 home (xGC=0.3)
      makeRow({ player_id: 1, gw: 3, fixture_id: 1, was_home: true, expected_goals_conceded: '0.30' }),
      makeRow({ player_id: 1, gw: 4, fixture_id: 2, was_home: true, expected_goals_conceded: '0.50' }),
      makeRow({ player_id: 1, gw: 5, fixture_id: 3, was_home: false, expected_goals_conceded: '1.20' }),
      // Player 2: GW 4 home (xGC=0.1), GW 5 home (xGC=0.2)
      makeRow({ player_id: 2, gw: 4, fixture_id: 4, was_home: true, expected_goals_conceded: '0.10' }),
      makeRow({ player_id: 2, gw: 5, fixture_id: 5, was_home: true, expected_goals_conceded: '0.20' }),
      // Player 1 old GW (should be excluded)
      makeRow({ player_id: 1, gw: 1, fixture_id: 0, was_home: true, expected_goals_conceded: '3.00' }),
    ];

    const recent = filterLastNGws(rows, 3); // GWs 3, 4, 5
    const homeOnly = filterByVenue(recent, 'home');
    const ranked = computeAllPlayerAverages(homeOnly, 'avgXGC', false); // ascending (lower xGC = better)

    // Player 2 home avg xGC = (0.1 + 0.2) / 2 = 0.15
    // Player 1 home avg xGC = (0.3 + 0.5) / 2 = 0.40
    expect(ranked[0].player_id).toBe(2);
    expect(ranked[0].avgXGC).toBeCloseTo(0.15);
    expect(ranked[1].player_id).toBe(1);
    expect(ranked[1].avgXGC).toBeCloseTo(0.40);
  });
});
