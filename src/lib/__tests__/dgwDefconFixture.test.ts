/**
 * Unit tests for DGW per-fixture DEFCON calculation logic.
 *
 * The logic is mirrored here from live.page.ts (fetchPerFixtureDefconMap /
 * computeRawDefcon) to keep tests self-contained without requiring the full
 * Astro page environment.
 *
 * Background:
 *   livePointsCache stores *cumulative* GW stats for every player.  For a team
 *   with a double gameweek (DGW) this means the cache accumulates stats from
 *   both fixtures.  When the player modal renders the DEFCON table for the 2nd
 *   fixture, we must subtract the finished 1st-fixture stats (from
 *   element-summary history) to recover the 2nd-fixture-only contributions.
 */

import { describe, it, expect } from 'vitest';

// --------------------------------------------------------------------------
// Helpers mirrored from live.page.ts (keep in sync with the source)
// --------------------------------------------------------------------------

/**
 * Compute the raw DEFCON-eligible defensive contribution for a player.
 * GKs are excluded (position === 1 returns 0).
 * DEFs (position 2) use CBI + tackles only.
 * MIDs/FWDs (position 3/4) also add recoveries.
 */
function computeRawDefcon(
  cbi: number,
  tackles: number,
  recoveries: number,
  position: number
): number {
  if (position === 1) return 0;
  const cbit = cbi + tackles;
  if (position === 2) return cbit;
  return cbit + recoveries;
}

interface PriorFixtureStats {
  clearances_blocks_interceptions: number;
  tackles: number;
  recoveries: number;
}

/**
 * Compute the per-fixture defensive contribution for a player in a DGW by
 * subtracting the prior finished-fixture stats from the cumulative GW totals.
 * Clamps each component to ≥ 0 to guard against rounding/timing edge cases.
 */
function computePerFixtureRawDefcon(
  cumulativeCBI: number,
  cumulativeTackles: number,
  cumulativeRecoveries: number,
  priorStats: PriorFixtureStats[],
  position: number
): number {
  let prevCBI = 0;
  let prevTackles = 0;
  let prevRecoveries = 0;

  for (const prior of priorStats) {
    prevCBI += prior.clearances_blocks_interceptions;
    prevTackles += prior.tackles;
    prevRecoveries += prior.recoveries;
  }

  const cbi = Math.max(0, cumulativeCBI - prevCBI);
  const tackles = Math.max(0, cumulativeTackles - prevTackles);
  const recoveries = Math.max(0, cumulativeRecoveries - prevRecoveries);

  return computeRawDefcon(cbi, tackles, recoveries, position);
}

// --------------------------------------------------------------------------
// computeRawDefcon
// --------------------------------------------------------------------------

describe('computeRawDefcon', () => {
  it('returns 0 for a GK regardless of stats', () => {
    expect(computeRawDefcon(10, 5, 3, 1)).toBe(0);
  });

  it('DEF: returns CBI + tackles (no recoveries)', () => {
    expect(computeRawDefcon(6, 2, 4, 2)).toBe(8);
  });

  it('MID: returns CBI + tackles + recoveries', () => {
    expect(computeRawDefcon(4, 1, 5, 3)).toBe(10);
  });

  it('FWD: returns CBI + tackles + recoveries', () => {
    expect(computeRawDefcon(2, 0, 3, 4)).toBe(5);
  });

  it('returns 0 when all stats are zero', () => {
    expect(computeRawDefcon(0, 0, 0, 2)).toBe(0);
  });
});

// --------------------------------------------------------------------------
// computePerFixtureRawDefcon – single-GW (no prior fixtures)
// --------------------------------------------------------------------------

describe('computePerFixtureRawDefcon – non-DGW (no prior fixtures)', () => {
  it('returns cumulative value unchanged when there are no prior fixtures', () => {
    // DEF: 6 CBI + 2 tackles, no prior stats → per-fixture = 8
    expect(computePerFixtureRawDefcon(6, 2, 0, [], 2)).toBe(8);
  });

  it('returns cumulative MID value unchanged when there are no prior fixtures', () => {
    // MID: 4 CBI + 1 tackle + 5 recoveries → 10
    expect(computePerFixtureRawDefcon(4, 1, 5, [], 3)).toBe(10);
  });

  it('returns 0 for GK regardless of cumulative values', () => {
    expect(computePerFixtureRawDefcon(10, 5, 3, [], 1)).toBe(0);
  });
});

// --------------------------------------------------------------------------
// computePerFixtureRawDefcon – DGW: 2nd fixture (subtract prior F1 stats)
// --------------------------------------------------------------------------

describe('computePerFixtureRawDefcon – DGW 2nd fixture', () => {
  it('DEF: subtracts F1 stats from cumulative to give F2-only contribution', () => {
    // F1 finished: DEF got 4 CBI + 1 tackle
    // Cumulative after both games: 10 CBI + 3 tackles
    // Expected F2: (10-4) CBI + (3-1) tackles = 6 + 2 = 8
    const prior = [{ clearances_blocks_interceptions: 4, tackles: 1, recoveries: 0 }];
    expect(computePerFixtureRawDefcon(10, 3, 0, prior, 2)).toBe(8);
  });

  it('MID: subtracts F1 stats (including recoveries) from cumulative', () => {
    // F1: 3 CBI + 1 tackle + 4 recoveries
    // Cumulative: 7 CBI + 3 tackles + 8 recoveries
    // Expected F2: (7-3)=4 CBI + (3-1)=2 tackles + (8-4)=4 recoveries = 10
    const prior = [{ clearances_blocks_interceptions: 3, tackles: 1, recoveries: 4 }];
    expect(computePerFixtureRawDefcon(7, 3, 8, prior, 3)).toBe(10);
  });

  it('returns 0 when a player contributed only in F1 (not in F2)', () => {
    // DEF made 5 CBI + 2 tackles in F1, cumulative matches → F2 = 0
    const prior = [{ clearances_blocks_interceptions: 5, tackles: 2, recoveries: 0 }];
    expect(computePerFixtureRawDefcon(5, 2, 0, prior, 2)).toBe(0);
  });

  it('clamps to 0 when prior stats somehow exceed cumulative (data race guard)', () => {
    // Prior stats exceed cumulative (e.g., API lag) → clamp to 0
    const prior = [{ clearances_blocks_interceptions: 8, tackles: 3, recoveries: 0 }];
    expect(computePerFixtureRawDefcon(5, 2, 0, prior, 2)).toBe(0);
  });

  it('handles multiple prior fixtures (Triple Gameweek: two prior finished fixtures)', () => {
    // Two prior finished fixtures:
    //   F1: 3 CBI + 1 tackle
    //   F2: 2 CBI + 1 tackle
    // Cumulative after all 3: 10 CBI + 4 tackles
    // Expected F3 only: (10-5)=5 CBI + (4-2)=2 tackles = 7
    const prior = [
      { clearances_blocks_interceptions: 3, tackles: 1, recoveries: 0 },
      { clearances_blocks_interceptions: 2, tackles: 1, recoveries: 0 },
    ];
    expect(computePerFixtureRawDefcon(10, 4, 0, prior, 2)).toBe(7);
  });

  it('GK always returns 0 even in a DGW context', () => {
    const prior = [{ clearances_blocks_interceptions: 2, tackles: 1, recoveries: 0 }];
    expect(computePerFixtureRawDefcon(8, 4, 2, prior, 1)).toBe(0);
  });
});

// --------------------------------------------------------------------------
// DEFCON threshold validation (scoring rule sanity checks)
// --------------------------------------------------------------------------

describe('DEFCON scoring thresholds', () => {
  it('DEF achieves DEFCON bonus at exactly 10 defensive contribution', () => {
    // threshold for DEF is 10 (CBI + tackles)
    const rawDc = computeRawDefcon(8, 2, 0, 2);
    expect(rawDc).toBe(10);
    expect(rawDc >= 10).toBe(true);
  });

  it('MID/FWD achieves DEFCON bonus at exactly 12 defensive contribution', () => {
    // threshold for MID/FWD is 12 (CBI + tackles + recoveries)
    const rawDc = computeRawDefcon(5, 2, 5, 3);
    expect(rawDc).toBe(12);
    expect(rawDc >= 12).toBe(true);
  });

  it('DGW DEF: correctly determines F2 achieves threshold after subtraction', () => {
    // F1: 3 CBI + 1 tackle = 4 (below threshold)
    // Cumulative: 12 CBI + 2 tackles = 14
    // F2 per-fixture: (12-3)=9 CBI + (2-1)=1 tackle = 10 → threshold met
    const prior = [{ clearances_blocks_interceptions: 3, tackles: 1, recoveries: 0 }];
    const f2Dc = computePerFixtureRawDefcon(12, 2, 0, prior, 2);
    expect(f2Dc).toBe(10);
    expect(f2Dc >= 10).toBe(true); // DEFCON bonus earned in F2
  });

  it('DGW DEF: cumulative would falsely suggest threshold met but per-fixture does not', () => {
    // F1: 7 CBI + 3 tackles = 10 (threshold met in F1)
    // Cumulative: 9 CBI + 4 tackles = 13 (≥10, misleadingly suggests F2 also earns DEFCON)
    // F2 per-fixture: (9-7)=2 CBI + (4-3)=1 tackle = 3 (below threshold)
    const prior = [{ clearances_blocks_interceptions: 7, tackles: 3, recoveries: 0 }];
    const cumulativeDc = computeRawDefcon(9, 4, 0, 2);
    const f2Dc = computePerFixtureRawDefcon(9, 4, 0, prior, 2);
    expect(cumulativeDc).toBeGreaterThanOrEqual(10); // cumulative: misleading
    expect(f2Dc).toBeLessThan(10);                   // F2 per-fixture: correctly below threshold
  });
});
