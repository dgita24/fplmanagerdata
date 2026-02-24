import { describe, it, expect } from 'vitest';

/**
 * Tests for OR history modal rank-change arrow logic.
 * Mirrors the logic in populateORHistoryModal (stats.astro).
 */

type HistoryRow = { event: number; overall_rank: number };

/**
 * Returns the arrow indicator for a given row compared to the previous week's row.
 * Mirrors the inline logic used when building arrowHtml in stats.astro.
 */
function getRankArrow(row: HistoryRow, prevRow: HistoryRow | undefined): 'up' | 'down' | 'neutral' | 'none' {
  if (prevRow === undefined || row.event <= 1) return 'none';
  if (row.overall_rank < prevRow.overall_rank) return 'up';
  if (row.overall_rank > prevRow.overall_rank) return 'down';
  return 'neutral';
}

describe('OR history modal - rank change arrow logic', () => {
  it('should return "none" for week 1 (no previous week)', () => {
    const row: HistoryRow = { event: 1, overall_rank: 100000 };
    expect(getRankArrow(row, undefined)).toBe('none');
  });

  it('should return "none" for week 1 even if a prevRow is somehow provided', () => {
    const row: HistoryRow = { event: 1, overall_rank: 100000 };
    const prevRow: HistoryRow = { event: 0, overall_rank: 200000 };
    expect(getRankArrow(row, prevRow)).toBe('none');
  });

  it('should return "up" (improved) when rank number decreases vs previous week', () => {
    const row: HistoryRow = { event: 3, overall_rank: 50000 };
    const prevRow: HistoryRow = { event: 2, overall_rank: 100000 };
    expect(getRankArrow(row, prevRow)).toBe('up');
  });

  it('should return "down" (worsened) when rank number increases vs previous week', () => {
    const row: HistoryRow = { event: 3, overall_rank: 200000 };
    const prevRow: HistoryRow = { event: 2, overall_rank: 100000 };
    expect(getRankArrow(row, prevRow)).toBe('down');
  });

  it('should return "neutral" when rank is unchanged vs previous week', () => {
    const row: HistoryRow = { event: 3, overall_rank: 100000 };
    const prevRow: HistoryRow = { event: 2, overall_rank: 100000 };
    expect(getRankArrow(row, prevRow)).toBe('neutral');
  });

  it('should return "none" when there is no previous row (latest available gw is first in history)', () => {
    const row: HistoryRow = { event: 5, overall_rank: 75000 };
    expect(getRankArrow(row, undefined)).toBe('none');
  });

  it('should correctly compute arrows for a descending-sorted history array', () => {
    // Sorted descending (latest first) — mirrors validHistory in populateORHistoryModal
    const validHistory: HistoryRow[] = [
      { event: 4, overall_rank: 60000 },  // improved from GW3
      { event: 3, overall_rank: 90000 },  // worsened from GW2
      { event: 2, overall_rank: 80000 },  // improved from GW1
      { event: 1, overall_rank: 100000 }, // no arrow (week 1)
    ];

    const arrows = validHistory.map((row, i) => getRankArrow(row, validHistory[i + 1]));

    expect(arrows[0]).toBe('up');      // GW4: 60000 < 90000 → improved
    expect(arrows[1]).toBe('down');    // GW3: 90000 > 80000 → worsened
    expect(arrows[2]).toBe('up');     // GW2: 80000 < 100000 → improved
    expect(arrows[3]).toBe('none');   // GW1: no arrow
  });
});
