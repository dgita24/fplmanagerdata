import { describe, it, expect } from 'vitest';
import {
  computeMatchDC,
  filterHistoryRows,
  formatMatchDate,
  formatOpponentVenue,
  formatScore,
} from '../playerMatchHistory';
import type { MatchHistoryRow } from '../playerMatchHistory';

// Minimal stub for a MatchHistoryRow
function makeRow(overrides: Partial<MatchHistoryRow> = {}): MatchHistoryRow {
  return {
    fixture: 1,
    kickoff_time: '2025-08-16T14:00:00Z',
    round: 1,
    was_home: true,
    team_h_score: 2,
    team_a_score: 1,
    opponent_team: 1,
    total_points: 6,
    minutes: 90,
    bonus: 0,
    goals_scored: 1,
    assists: 0,
    saves: 0,
    penalties_saved: 0,
    clearances_blocks_interceptions: 0,
    tackles: 0,
    recoveries: 0,
    ...overrides,
  };
}

// ----------------------------------------------------------------
// computeMatchDC
// ----------------------------------------------------------------
describe('computeMatchDC — GK (elementType 1)', () => {
  it('always returns 0 regardless of stats', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 15, tackles: 5 }), 1)).toBe(0);
  });
});

describe('computeMatchDC — DEF (elementType 2)', () => {
  it('returns 2 when CBIT (cbi + tackles) >= 10', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 8, tackles: 2 }), 2)).toBe(2);
  });

  it('returns 2 when CBIT exactly equals 10', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 10, tackles: 0 }), 2)).toBe(2);
  });

  it('returns 0 when CBIT < 10', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 6, tackles: 3 }), 2)).toBe(0);
  });

  it('returns 0 when all defensive stats are 0', () => {
    expect(computeMatchDC(makeRow(), 2)).toBe(0);
  });
});

describe('computeMatchDC — MID (elementType 3)', () => {
  it('returns 2 when CBITR (cbi + tackles + recoveries) >= 12', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 5, tackles: 4, recoveries: 3 }), 3)).toBe(2);
  });

  it('returns 2 when CBITR exactly equals 12', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 6, tackles: 4, recoveries: 2 }), 3)).toBe(2);
  });

  it('returns 0 when CBITR < 12', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 4, tackles: 4, recoveries: 3 }), 3)).toBe(0);
  });
});

describe('computeMatchDC — FWD (elementType 4)', () => {
  it('returns 2 when CBITR >= 12', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 7, tackles: 3, recoveries: 2 }), 4)).toBe(2);
  });

  it('returns 0 when CBITR < 12', () => {
    expect(computeMatchDC(makeRow({ clearances_blocks_interceptions: 3, tackles: 2, recoveries: 4 }), 4)).toBe(0);
  });
});

// ----------------------------------------------------------------
// formatScore
// ----------------------------------------------------------------
describe('formatScore — home player', () => {
  it('shows h_score–a_score when was_home is true', () => {
    expect(formatScore(true, 3, 1)).toBe('3–1');
  });

  it('returns — when h_score is null', () => {
    expect(formatScore(true, null, 1)).toBe('—');
  });

  it('returns — when a_score is null', () => {
    expect(formatScore(true, 2, null)).toBe('—');
  });

  it('returns — when both scores are null', () => {
    expect(formatScore(true, null, null)).toBe('—');
  });
});

describe('formatScore — away player', () => {
  it('shows a_score–h_score when was_home is false', () => {
    expect(formatScore(false, 1, 2)).toBe('2–1');
  });

  it('returns — when scores are null', () => {
    expect(formatScore(false, null, null)).toBe('—');
  });

  it('handles 0–0 draw correctly', () => {
    expect(formatScore(true, 0, 0)).toBe('0–0');
    expect(formatScore(false, 0, 0)).toBe('0–0');
  });
});

// ----------------------------------------------------------------
// formatOpponentVenue
// ----------------------------------------------------------------
describe('formatOpponentVenue', () => {
  it('appends (H) when was_home is true', () => {
    expect(formatOpponentVenue('ARS', true)).toBe('ARS (H)');
  });

  it('appends (A) when was_home is false', () => {
    expect(formatOpponentVenue('CHE', false)).toBe('CHE (A)');
  });
});

// ----------------------------------------------------------------
// filterHistoryRows
// ----------------------------------------------------------------
describe('filterHistoryRows', () => {
  const home1 = makeRow({ fixture: 1, was_home: true });
  const home2 = makeRow({ fixture: 2, was_home: true });
  const away1 = makeRow({ fixture: 3, was_home: false });
  const rows = [home1, home2, away1];

  it('returns all rows when filter is "all"', () => {
    expect(filterHistoryRows(rows, 'all')).toHaveLength(3);
  });

  it('returns only home rows when filter is "home"', () => {
    const result = filterHistoryRows(rows, 'home');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.was_home === true)).toBe(true);
  });

  it('returns only away rows when filter is "away"', () => {
    const result = filterHistoryRows(rows, 'away');
    expect(result).toHaveLength(1);
    expect(result[0].was_home).toBe(false);
  });

  it('returns empty array when no rows match filter', () => {
    const awayOnly = [away1];
    expect(filterHistoryRows(awayOnly, 'home')).toHaveLength(0);
  });

  it('handles empty input array', () => {
    expect(filterHistoryRows([], 'home')).toHaveLength(0);
    expect(filterHistoryRows([], 'away')).toHaveLength(0);
    expect(filterHistoryRows([], 'all')).toHaveLength(0);
  });
});
describe('formatMatchDate', () => {
  it('returns — for null input', () => {
    expect(formatMatchDate(null)).toBe('—');
  });

  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatMatchDate('2025-08-16T14:00:00Z');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('—');
  });

  it('includes the month abbreviation for a known date', () => {
    const result = formatMatchDate('2025-08-16T14:00:00Z');
    expect(result).toMatch(/Aug/);
  });
});
