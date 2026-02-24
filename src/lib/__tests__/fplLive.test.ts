import { describe, it, expect } from 'vitest';
import { applyAutoSubsAndMultipliers, bonusFromBpsRows, getPlayerLiveComputed, getTeamGwStatus } from '../fplLive';
import type { LiveStatLine, TeamStatus } from '../fplLive';

/**
 * Characterization tests for fplLive.ts computation functions
 * These tests lock in the current behavior to serve as a safety net during refactoring
 */
describe('fplLive - bonusFromBpsRows', () => {
  /**
   * Test: Normal bonus distribution
   * Top scorer gets 3, second gets 2, third gets 1
   */
  it('should distribute bonus 3-2-1 for distinct top 3 BPS scores', () => {
    const bpsRows = [
      { element: 100, value: 50 }, // 3 bonus
      { element: 200, value: 40 }, // 2 bonus
      { element: 300, value: 30 }, // 1 bonus
      { element: 400, value: 20 }, // 0 bonus
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(2);
    expect(result.get(300)).toBe(1);
    expect(result.get(400)).toBeUndefined();
    expect(result.size).toBe(3);
  });

  /**
   * Test: Two-way tie for first place
   * Both players get 3 bonus, next player gets 1
   */
  it('should give 3 bonus to tied top scorers and 1 to next', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: 200, value: 50 }, // Tied for first
      { element: 300, value: 30 },
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(3);
    expect(result.get(300)).toBe(1);
    expect(result.size).toBe(3);
  });

  /**
   * Test: Three-way tie for first place
   * All three get 3 bonus, no other players get bonus
   */
  it('should give 3 bonus to all three tied top scorers', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: 200, value: 50 },
      { element: 300, value: 50 }, // All tied for first
      { element: 400, value: 30 },
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(3);
    expect(result.get(300)).toBe(3);
    expect(result.get(400)).toBeUndefined();
    expect(result.size).toBe(3);
  });

  /**
   * Test: Two-way tie for second place
   * Top scorer gets 3, tied players both get 2
   */
  it('should give 3 to top and 2 to tied second place', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: 200, value: 40 },
      { element: 300, value: 40 }, // Tied for second
      { element: 400, value: 30 },
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(2);
    expect(result.get(300)).toBe(2);
    expect(result.get(400)).toBeUndefined();
    expect(result.size).toBe(3);
  });

  /**
   * Test: Only one player has BPS
   * Single player gets 3 bonus
   */
  it('should give 3 bonus to single player with BPS', () => {
    const bpsRows = [{ element: 100, value: 50 }];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.size).toBe(1);
  });

  /**
   * Test: Empty BPS array
   * No bonus awarded
   */
  it('should return empty map for empty BPS array', () => {
    const result = bonusFromBpsRows([]);
    expect(result.size).toBe(0);
  });

  /**
   * Test: Invalid data filtering
   * Should filter out invalid entries (non-numeric values)
   */
  it('should filter out invalid BPS entries', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: null, value: 40 }, // Invalid element
      { element: 200, value: NaN }, // Invalid value
      { element: 300, value: 30 },
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(300)).toBe(2);
    expect(result.size).toBe(2);
  });

  /**
   * Test: Two players only
   * First gets 3, second gets 2
   */
  it('should distribute 3-2 bonus for two players', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: 200, value: 40 },
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(2);
    expect(result.size).toBe(2);
  });

  /**
   * Test: Multiple ties for third place
   * Top gets 3, second gets 2, all tied thirds get 1
   */
  it('should give 1 bonus to multiple tied third place players', () => {
    const bpsRows = [
      { element: 100, value: 50 },
      { element: 200, value: 40 },
      { element: 300, value: 30 },
      { element: 400, value: 30 }, // Tied for third
      { element: 500, value: 30 }, // Tied for third
    ];

    const result = bonusFromBpsRows(bpsRows);

    expect(result.get(100)).toBe(3);
    expect(result.get(200)).toBe(2);
    expect(result.get(300)).toBe(1);
    expect(result.get(400)).toBe(1);
    expect(result.get(500)).toBe(1);
    expect(result.size).toBe(5);
  });
});

describe('fplLive - getPlayerLiveComputed', () => {
  /**
   * Test: Player in finished match with confirmed bonus
   * Should return official total points
   */
  it('should return official points for finished match with confirmed bonus', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 8, bonus: 2, minutes: 90 }],
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3], // Projected bonus different from actual
    ]);
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: true, finishedProvisional: false }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: false,
      projectedBonusDuringLive: true,
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(8); // Official points
    expect(result.projBonus).toBe(0); // No projection
    expect(result.locked).toBe(8);
    expect(result.status).toBe('Fin');
    expect(result.confirmedBonus).toBe(2);
  });

  /**
   * Test: Player in live match with projected bonus
   * Should show base points + projected bonus
   */
  it('should show projected bonus for player in live match', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 6, bonus: 0, minutes: 75 }],
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3],
    ]);
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: false, finishedProvisional: false }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: false,
      projectedBonusDuringLive: true,
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(9); // 6 base + 3 projected
    expect(result.projBonus).toBe(3);
    expect(result.locked).toBe(6);
    expect(result.status).toBe('Live');
  });

  /**
   * Test: Player not started
   * Should return 0 points
   */
  it('should return 0 points for player not started', () => {
    const livePointsCache = new Map<number, LiveStatLine>();
    const projectedBonusCache = new Map<string, number>();
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: false, finished: false, finishedProvisional: false }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: false,
      projectedBonusDuringLive: true,
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(0);
    expect(result.projBonus).toBe(0);
    expect(result.locked).toBe(0);
    expect(result.status).toBe('NS');
  });

  /**
   * Test: Player in finished provisional match with bonus confirmed on provisional
   * Should return official points including bonus
   */
  it('should confirm bonus for provisional finish when flag enabled', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 8, bonus: 2, minutes: 90 }],
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3], // Different from actual
    ]);
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: false, finishedProvisional: true }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: true, // Treat provisional as confirmed
      projectedBonusDuringLive: true,
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(8); // Official points
    expect(result.projBonus).toBe(0); // No projection
    expect(result.locked).toBe(8);
    expect(result.status).toBe('Fin');
  });

  /**
   * Test: Player in finished provisional match without bonus confirmed on provisional
   * Should show projected bonus
   */
  it('should show projected bonus for provisional finish when flag disabled', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 6, bonus: 0, minutes: 90 }],
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3],
    ]);
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: false, finishedProvisional: true }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: false, // Don't treat provisional as confirmed
      projectedBonusDuringLive: true,
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(9); // 6 + 3 projected
    expect(result.projBonus).toBe(3);
    expect(result.locked).toBe(6);
    expect(result.status).toBe('Fin'); // Still marked as finished for subs
  });

  /**
   * Test: Disable projected bonus during live
   * Should not show projected bonus even when match is live
   */
  it('should not show projected bonus when disabled during live', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 6, bonus: 0, minutes: 75 }],
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3],
    ]);
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: false, finishedProvisional: false }],
    ]);

    const result = getPlayerLiveComputed({
      playerId: 100,
      teamId: 1,
      gw: 10,
      livePointsCache,
      projectedBonusCache,
      teamStatusCache,
      bonusConfirmedOnProvisional: false,
      projectedBonusDuringLive: false, // Disabled
      projectedBonusDuringProvisional: true,
    });

    expect(result.liveTotal).toBe(6); // No projected bonus added
    expect(result.projBonus).toBe(0);
    expect(result.locked).toBe(6);
    expect(result.status).toBe('Live');
  });
});

describe('fplLive - getTeamGwStatus', () => {
  /**
   * Test: Team status lookup
   */
  it('should return team status from cache', () => {
    const teamStatusCache = new Map<string, TeamStatus>([
      ['10:1', { started: true, finished: true, finishedProvisional: false }],
    ]);

    const status = getTeamGwStatus(teamStatusCache, 1, 10);

    expect(status.started).toBe(true);
    expect(status.finished).toBe(true);
    expect(status.finishedProvisional).toBe(false);
  });

  /**
   * Test: Missing team status
   * Should return default not-started status
   */
  it('should return default status for missing team', () => {
    const teamStatusCache = new Map<string, TeamStatus>();

    const status = getTeamGwStatus(teamStatusCache, 99, 10);

    expect(status.started).toBe(false);
    expect(status.finished).toBe(false);
    expect(status.finishedProvisional).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: build a minimal pick object for applyAutoSubsAndMultipliers tests
// ---------------------------------------------------------------------------
function makePick(opts: {
  playerId: number;
  position: number; // 1-11 = starter, 12-15 = bench
  playingPosition: 'GK' | 'DEF' | 'MID' | 'FWD';
  minutes: number;
  status: 'Fin' | 'Live' | 'NS';
  is_captain?: boolean;
  is_vice_captain?: boolean;
}) {
  return {
    playerId: opts.playerId,
    position: opts.position,
    playingPosition: opts.playingPosition,
    minutes: opts.minutes,
    status: opts.status,
    is_captain: !!opts.is_captain,
    is_vice_captain: !!opts.is_vice_captain,
  };
}

describe('applyAutoSubsAndMultipliers - formation rules', () => {
  /**
   * Regression test: a DNP bench player sitting between two valid replacements must
   * NOT block those replacements from coming on.
   *
   * Setup:
   *   Starters: GK + 3 DEF + 3 MID + 1 FWD (all played) + 2 DNP (DEF + FWD)
   *   Bench:    FWD-12 (played), DEF-13 (DNP 0-min), MID-14 (played), GK-15 (DNP)
   *
   * The old canComplete condition `usableBench.length >= spotsLeft` would count only
   * [MID-14] as usable after FWD-12, giving length=1 < spotsLeft=2, and incorrectly
   * block FWD-12 (and then MID-14 was also blocked). Both valid subs must come on.
   */
  it('subs in both valid bench players even when a DNP bench player sits between them', () => {
    const picks = [
      // starters
      makePick({ playerId: 1, position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2, position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3, position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4, position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5, position: 5,  playingPosition: 'DEF', minutes:  0, status: 'Fin' }), // DNP
      makePick({ playerId: 6, position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7, position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8, position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9, position: 9,  playingPosition: 'MID', minutes:  0, status: 'Fin' }), // DNP
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }), // DNP
      // bench (priority order: 12 → 13 → 14 → 15)
      makePick({ playerId: 12, position: 12, playingPosition: 'FWD', minutes: 90, status: 'Fin' }), // played → valid sub
      makePick({ playerId: 13, position: 13, playingPosition: 'DEF', minutes:  0, status: 'Fin' }), // DNP bench player
      makePick({ playerId: 14, position: 14, playingPosition: 'MID', minutes: 90, status: 'Fin' }), // played → valid sub
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }), // bench GK DNP
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Both played bench players should have multiplier 1 (subbed on)
    const p12 = result.find(p => p.playerId === 12)!;
    const p14 = result.find(p => p.playerId === 14)!;
    expect(p12.multiplier).toBe(1);
    expect(p12.autoSubStatus).toBe('IN');
    expect(p14.multiplier).toBe(1);
    expect(p14.autoSubStatus).toBe('IN');

    // DNP starters should have multiplier 0
    const p5 = result.find(p => p.playerId === 5)!;
    const p9 = result.find(p => p.playerId === 9)!;
    const p11 = result.find(p => p.playerId === 11)!;
    expect(p5.multiplier).toBe(0);
    expect(p9.multiplier).toBe(0);
    expect(p11.multiplier).toBe(0);

    // DNP bench player stays on bench (no sub status)
    const p13 = result.find(p => p.playerId === 13)!;
    expect(p13.multiplier).toBe(0);
    expect(p13.autoSubStatus).toBeNull();
  });

  /**
   * A bench player whose position would violate ≥3 DEF minimum must NOT come on.
   * Setup: activeOutfield = 2 DEF + 5 MID + 1 FWD (one starter DNP DEF)
   *        bench: MID (played) — adding MID leaves only 2 DEF = INVALID, must skip.
   */
  it('does not sub in a bench player that would leave fewer than 3 DEF with no remedy', () => {
    const picks = [
      makePick({ playerId: 1, position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2, position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3, position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4, position: 4,  playingPosition: 'DEF', minutes:  0, status: 'Fin', is_captain: true }), // DNP
      makePick({ playerId: 5, position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 6, position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 7, position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 8, position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9, position: 9,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // bench: only a MID — can't replace the DNP DEF without dropping below ≥3 DEF
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // No outfield bench player should have come on — adding any of them leaves 2 DEF
    const p12 = result.find(p => p.playerId === 12)!;
    const p13 = result.find(p => p.playerId === 13)!;
    const p14 = result.find(p => p.playerId === 14)!;
    expect(p12.multiplier).toBe(0);
    expect(p13.multiplier).toBe(0);
    expect(p14.multiplier).toBe(0);

    // DNP starter remains out
    const p4 = result.find(p => p.playerId === 4)!;
    expect(p4.multiplier).toBe(0);
    expect(p4.autoSubStatus).toBe('OUT');
  });

  /**
   * A valid DEF bench player CAN come on to replace a DNP DEF starter.
   * Verifies the ≥3 DEF check approves a DEF sub when defCount would stay ≥3.
   */
  it('subs in a DEF bench player to replace a DNP DEF starter (formation stays valid)', () => {
    const picks = [
      makePick({ playerId: 1, position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2, position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3, position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4, position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5, position: 5,  playingPosition: 'DEF', minutes:  0, status: 'Fin' }), // DNP
      makePick({ playerId: 6, position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7, position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8, position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9, position: 9,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'DEF', minutes: 90, status: 'Fin' }), // DEF bench → valid
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.multiplier).toBe(1);
    expect(p12.autoSubStatus).toBe('IN');

    const p5 = result.find(p => p.playerId === 5)!;
    expect(p5.multiplier).toBe(0);
    expect(p5.autoSubStatus).toBe('OUT');
  });

  /**
   * Bench Boost: all 15 players score, no auto-subs applied.
   */
  it('gives all 15 players multiplier 1 under Bench Boost', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'DEF', minutes:  0, status: 'Fin' }), // DNP but BB
      makePick({ playerId: 14, position: 14, playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'BB');

    // All 15 get multiplier ≥ 1; no autoSubStatus set
    result.forEach(p => {
      expect(p.multiplier).toBeGreaterThanOrEqual(1);
      expect(p.autoSubStatus).toBeNull();
    });
  });

  /**
   * 4-4-2 formation: one DEF starter DNPs. Bench order is [MID(b12), DEF(b13)].
   * FPL rule: highest bench priority wins, subject to formation validity.
   * MID(b12) results in 3-5-2 = valid, so MID comes on — NOT the DEF(b13).
   * The DEF bench player must NOT take priority just because it matches the DNP's position.
   */
  it('in 4-4-2 with DNP DEF, the higher-priority MID bench replaces the DNP DEF (not the DEF bench)', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'DEF', minutes:  0, status: 'Fin' }), // DNP
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // bench priority order: MID first, then DEF
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes: 90, status: 'Fin' }), // b1 — higher priority
      makePick({ playerId: 13, position: 13, playingPosition: 'DEF', minutes: 90, status: 'Fin' }), // b2 — lower priority
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // MID(b12) is the sub — 3-5-2 is valid
    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.multiplier).toBe(1);
    expect(p12.autoSubStatus).toBe('IN');

    // DEF(b13) does NOT come on — MID already filled the one vacant slot
    const p13 = result.find(p => p.playerId === 13)!;
    expect(p13.multiplier).toBe(0);
    expect(p13.autoSubStatus).toBeNull();

    // DNP DEF starter is out
    const p5 = result.find(p => p.playerId === 5)!;
    expect(p5.multiplier).toBe(0);
    expect(p5.autoSubStatus).toBe('OUT');

    // Final lineup = GK + 3DEF + 5MID + 2FWD (3-5-2) — valid formation
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(11);
  });
});
