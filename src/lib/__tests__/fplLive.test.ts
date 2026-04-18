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
   * Test: Race condition — finished=true but bonus not yet in total_points
   * FPL sets finished=true before baking bonus into total_points.
   * confirmedBonus (live.bonus) is still 0, but BPS data shows projected bonus.
   * Expected: fall back to officialTotal + projBonus.
   */
  it('should add projected bonus when finished=true but confirmedBonus is 0 (race condition)', () => {
    const livePointsCache = new Map<number, LiveStatLine>([
      [100, { points: 5, bonus: 0, minutes: 90 }], // bonus not yet baked into total_points
    ]);
    const projectedBonusCache = new Map<string, number>([
      ['10:100', 3], // BPS data shows player earned 3 bonus
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

    expect(result.liveTotal).toBe(8); // 5 base + 3 projected bonus
    expect(result.projBonus).toBe(3);
    expect(result.locked).toBe(5);
    expect(result.status).toBe('Fin');
    expect(result.confirmedBonus).toBe(0); // live.bonus is still 0 during race window
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

describe('applyAutoSubsAndMultipliers - captain eligibility', () => {
  /**
   * Bug 1 fix: when captain is confirmed DNP (Fin, 0 min) and VC hasn't played yet (NS),
   * the VC should immediately inherit the captain multiplier.
   * Previously, the code required starterVcPlayed before assigning eligibleCaptainId to VC,
   * so VC got multiplier=1 (not 2) and LtP was wrong.
   */
  it('VC inherits captain multiplier immediately when captain is confirmed DNP (even if VC is NS)', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes:  0, status: 'Fin', is_captain: true }), // DNP
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes:  0, status: 'NS',  is_vice_captain: true }), // NS — hasn't played yet
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Captain (p6) is confirmed DNP — multiplier=0
    const p6 = result.find(p => p.playerId === 6)!;
    expect(p6.multiplier).toBe(0);
    expect(p6.autoSubStatus).toBe('OUT');

    // VC (p7) is NS but should inherit captain multiplier (×2)
    const p7 = result.find(p => p.playerId === 7)!;
    expect(p7.multiplier).toBe(2);
  });

  /**
   * VC that has already played should also get the captain multiplier (existing behaviour preserved).
   */
  it('VC who has played gets captain multiplier when captain is confirmed DNP', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes:  0, status: 'Fin', is_captain: true }), // DNP
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 75, status: 'Fin', is_vice_captain: true }), // played
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    const p7 = result.find(p => p.playerId === 7)!;
    expect(p7.multiplier).toBe(2);
  });

  /**
   * Captain NS (hasn't played yet): must NOT switch to VC.
   * Captain keeps multiplier=2 until confirmed DNP.
   */
  it('captain NS keeps multiplier; VC does NOT inherit yet', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes:  0, status: 'NS',  is_captain: true }), // NS — not DNP
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }), // played
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Captain (NS) still gets ×2
    const p6 = result.find(p => p.playerId === 6)!;
    expect(p6.multiplier).toBe(2);

    // VC does NOT inherit — keeps multiplier=1
    const p7 = result.find(p => p.playerId === 7)!;
    expect(p7.multiplier).toBe(1);
  });

  /**
   * TC chip: VC inherits ×3 when captain is confirmed DNP and VC hasn't played yet.
   */
  it('VC inherits ×3 (TC) when captain is confirmed DNP', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes:  0, status: 'Fin', is_captain: true }), // DNP
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes:  0, status: 'NS',  is_vice_captain: true }), // NS
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'TC');

    const p7 = result.find(p => p.playerId === 7)!;
    expect(p7.multiplier).toBe(3);
  });
});

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

describe('applyAutoSubsAndMultipliers - live-match bench autosub (ON badge timing)', () => {
  /**
   * Core fix: bench player in a LIVE match who has already played (minutes > 0) should
   * receive autoSubStatus='IN' and multiplier=1 when the starter is confirmed DNP.
   * Previously the code broke on any non-Fin bench player, preventing the ON badge.
   */
  it('awards ON badge to a bench player who is Live with minutes > 0 when starter is DNP', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // Haaland (FWD, starter): confirmed DNP — status Fin, minutes 0
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      // Anderson (MID, bench 12): in a live match, already playing (minutes 45)
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes: 45, status: 'Live' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'NS' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Haaland (p11): confirmed DNP — must be OUT
    const p11 = result.find(p => p.playerId === 11)!;
    expect(p11.autoSubStatus).toBe('OUT');
    expect(p11.multiplier).toBe(0);

    // Anderson (p12): live match, 45 min — should be IN with multiplier 1
    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.autoSubStatus).toBe('IN');
    expect(p12.multiplier).toBe(1);

    // Exactly 11 active players
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(11);
  });

  /**
   * A bench player in a Live match with 0 minutes must NOT be auto-subbed in — we
   * cannot yet confirm they are DNP, so the slot stays vacant and no subsequent bench
   * player should leapfrog them.
   */
  it('does not award ON badge when bench player is Live with 0 minutes (DNP not confirmed)', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // Starter DNP
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      // Bench 12: live match but hasn't played yet (0 min) — can't confirm DNP
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'Live' }),
      // Bench 13: live with 45 min — would be valid if 12 were skipped (but 12 blocks it)
      makePick({ playerId: 13, position: 13, playingPosition: 'FWD', minutes: 45, status: 'Live' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Bench 12 blocks any autosub — no one should have IN status
    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.autoSubStatus).toBeNull();
    expect(p12.multiplier).toBe(0);

    const p13 = result.find(p => p.playerId === 13)!;
    expect(p13.autoSubStatus).toBeNull();
    expect(p13.multiplier).toBe(0);

    // Only 10 active outfield players (GK + 9 starters)
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(10);
  });

  /**
   * A bench player with status NS (not started) must NOT be awarded ON and must also
   * prevent any subsequent bench player from being considered, same as the Live-0-min case.
   */
  it('does not award ON badge when bench player is NS and blocks subsequent bench players', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // Starter DNP
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      // Bench 12: NS — blocks the autosub chain
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'NS' }),
      // Bench 13: finished and played — would be valid, but is blocked by bench 12
      makePick({ playerId: 13, position: 13, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Bench 12 (NS) blocks — no one gets IN
    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.autoSubStatus).toBeNull();
    expect(p12.multiplier).toBe(0);

    const p13 = result.find(p => p.playerId === 13)!;
    expect(p13.autoSubStatus).toBeNull();
    expect(p13.multiplier).toBe(0);

    // 10 active players: GK + 9 starters
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(10);
  });

  /**
   * Confirmed DNP bench player (Fin, 0 min) should be skipped and the NEXT bench player
   * who is Live with minutes > 0 should be autosubbed in instead.
   */
  it('skips a DNP bench player and subs in the next Live bench player with minutes > 0', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // Starter DNP (Haaland / FWD)
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      // Bench 12: DNP (finished, 0 min) — skip
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes:  0, status: 'Fin' }),
      // Bench 13: live match, Muñoz / playing (45 min) — should come on
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes: 45, status: 'Live' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.autoSubStatus).toBeNull(); // confirmed DNP bench player
    expect(p12.multiplier).toBe(0);

    // Muñoz (p13): Live, 45 min — should be the sub
    const p13 = result.find(p => p.playerId === 13)!;
    expect(p13.autoSubStatus).toBe('IN');
    expect(p13.multiplier).toBe(1);

    // 11 active players
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(11);
  });

  /**
   * LtP consistency: when the autosub bench player is Live with minutes > 0,
   * they should NOT contribute to LtP (they're already playing).
   *
   * Setup mirrors the reported "Cameron: LtP expected 3 (Gabriel/Timber/Rice)" scenario.
   * Formation 3-5-2:
   *   - GK + 3 DEF played, 2 MID played (cap/vc), 3 MID not started (LtP candidates),
   *     1 FWD played, 1 FWD = Haaland (DNP)
   *   - Bench 12: Anderson (MID, Live, 45 min) — effective autosub
   *
   * After the fix the effective XI is 11 players. The 3 NS MID starters are the only
   * players still "left to play" (multiplier > 0, minutes = 0, status ≠ 'Fin').
   * Anderson (multiplier=1, min=45) is excluded from LtP by the min > 0 check.
   */
  it('LtP scenario: autosub playing Live counts as active, not left-to-play', () => {
    const picks = [
      makePick({ playerId: 1,  position: 1,  playingPosition: 'GK',  minutes: 90, status: 'Fin' }),
      makePick({ playerId: 2,  position: 2,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 3,  position: 3,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      makePick({ playerId: 4,  position: 4,  playingPosition: 'DEF', minutes: 90, status: 'Fin' }),
      // Captain / vice-captain played
      makePick({ playerId: 5,  position: 5,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_captain: true }),
      makePick({ playerId: 6,  position: 6,  playingPosition: 'MID', minutes: 90, status: 'Fin', is_vice_captain: true }),
      // 3 NS MID starters — Gabriel / Timber / Rice proxies (these are the expected LtP)
      makePick({ playerId: 7,  position: 7,  playingPosition: 'MID', minutes:  0, status: 'NS' }),
      makePick({ playerId: 8,  position: 8,  playingPosition: 'MID', minutes:  0, status: 'NS' }),
      makePick({ playerId: 9,  position: 9,  playingPosition: 'MID', minutes:  0, status: 'NS' }),
      // Second FWD played
      makePick({ playerId: 10, position: 10, playingPosition: 'FWD', minutes: 90, status: 'Fin' }),
      // Haaland (FWD): confirmed DNP — the only vacant starter slot
      makePick({ playerId: 11, position: 11, playingPosition: 'FWD', minutes:  0, status: 'Fin' }),
      // Anderson (MID, bench 12): live match, already playing — valid 3-6-1 formation
      makePick({ playerId: 12, position: 12, playingPosition: 'MID', minutes: 45, status: 'Live' }),
      makePick({ playerId: 13, position: 13, playingPosition: 'MID', minutes:  0, status: 'NS' }),
      makePick({ playerId: 14, position: 14, playingPosition: 'FWD', minutes:  0, status: 'NS' }),
      makePick({ playerId: 15, position: 15, playingPosition: 'GK',  minutes:  0, status: 'Fin' }),
    ];

    const result = applyAutoSubsAndMultipliers(picks, 'None');

    // Anderson (p12): autosub confirmed — IN, multiplier=1, already playing (minutes=45)
    const p12 = result.find(p => p.playerId === 12)!;
    expect(p12.autoSubStatus).toBe('IN');
    expect(p12.multiplier).toBe(1);

    // Haaland (p11): confirmed OUT
    const p11 = result.find(p => p.playerId === 11)!;
    expect(p11.autoSubStatus).toBe('OUT');
    expect(p11.multiplier).toBe(0);

    // Effective XI = 11 players active
    const activeCount = result.filter(p => p.multiplier > 0).length;
    expect(activeCount).toBe(11);

    // Players "left to play" (multiplier>0 AND minutes===0 AND status!='Fin'):
    //   p7, p8, p9 (NS MID starters) → 3 players (Gabriel/Timber/Rice proxies)
    // Anderson (p12) has minutes=45 → NOT left to play
    const leftToPlay = result.filter(
      p => (p.multiplier ?? 0) > 0 && p.minutes === 0 && p.status !== 'Fin'
    );
    expect(leftToPlay).toHaveLength(3);
    expect(leftToPlay.every(p => [7, 8, 9].includes(p.playerId))).toBe(true);
  });
});

// ============================================================
// computePlayerLtpContribution – DGW-aware LtP helper
// ============================================================

import { computePlayerLtpContribution } from '../fplLive';
import type { FixtureInfo } from '../fplLive';

/** Helper to build a FixtureInfo object. */
function makeFixture(overrides: Partial<FixtureInfo> & { id: number; team_h: number; team_a: number }): FixtureInfo {
  return {
    team_h_score: null,
    team_a_score: null,
    started: false,
    finished: false,
    finished_provisional: false,
    ...overrides,
  };
}

describe('computePlayerLtpContribution', () => {
  const TEAM = 1;
  const OTHER_TEAM = 99;

  // ── Single-GW: preserves existing behaviour ──────────────────────────────

  it('returns 0 when multiplier is 0', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false })];
    expect(computePlayerLtpContribution(TEAM, 0, 0, fx)).toBe(0);
  });

  it('returns 0 when team has no fixture this GW', () => {
    const fx = [makeFixture({ id: 1, team_h: 5, team_a: 6 })];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(0);
  });

  it('single GW – fixture not started, 0 min → multiplier (will play)', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false })];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(1);
  });

  it('single GW – fixture live, 0 min → multiplier (not yet played)', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true })];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(1);
  });

  it('single GW – fixture live, 45 min → 0 (already playing)', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true })];
    expect(computePlayerLtpContribution(TEAM, 45, 1, fx)).toBe(0);
  });

  it('single GW – fixture finished, 90 min → 0 (played and done)', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, finished: true, started: true })];
    expect(computePlayerLtpContribution(TEAM, 90, 1, fx)).toBe(0);
  });

  it('single GW – fixture finished, 0 min → 0 (DNP and done)', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, finished: true, started: true })];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(0);
  });

  it('single GW – fixture finished_provisional, 0 min → 0', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished_provisional: true })];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(0);
  });

  it('captain multiplier (2) is applied correctly', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false })];
    expect(computePlayerLtpContribution(TEAM, 0, 2, fx)).toBe(2);
  });

  it('triple captain multiplier (3) is applied correctly', () => {
    const fx = [makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false })];
    expect(computePlayerLtpContribution(TEAM, 0, 3, fx)).toBe(3);
  });

  // ── DGW: two fixtures ────────────────────────────────────────────────────

  it('DGW – both fixtures not started, 0 min → 2× multiplier', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(2);
  });

  it('DGW captain – both not started → 4 (2 fixtures × multiplier 2)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    expect(computePlayerLtpContribution(TEAM, 0, 2, fx)).toBe(4);
  });

  it('DGW – F1 finished (90 min), F2 not started → multiplier (still has F2)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    // Player played 90 in F1; F2 not started → LtP = 1
    expect(computePlayerLtpContribution(TEAM, 90, 1, fx)).toBe(1);
  });

  it('DGW – F1 finished (DNP, 0 min), F2 not started → multiplier (still has F2)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(1);
  });

  it('DGW – F1 live (0 min), F2 not started → 2× multiplier (neither played yet)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(2);
  });

  it('DGW – F1 live (45 min), F2 not started → multiplier (playing F1, F2 still ahead)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: false }),
    ];
    expect(computePlayerLtpContribution(TEAM, 45, 1, fx)).toBe(1);
  });

  it('DGW – F1 finished (90 min), F2 live (0 min) → multiplier (not yet played in F2)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: true }),
    ];
    // 90 min attributed to F1; F2 live with minutesInF2 = max(0, 90-120) = 0 → ltp += 1
    expect(computePlayerLtpContribution(TEAM, 90, 1, fx)).toBe(1);
  });

  it('DGW – F1 finished (90 min), F2 live (45 min) → 0 (playing F2 now)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: true }),
    ];
    // minutesAttributed = 120 after F1; minutesInF2 = max(0, 135-120) = 15 > 0 → no LtP
    expect(computePlayerLtpContribution(TEAM, 135, 1, fx)).toBe(0);
  });

  it('DGW – both fixtures finished → 0 (all done)', () => {
    const fx = [
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: true, finished: true }),
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: true, finished: true }),
    ];
    expect(computePlayerLtpContribution(TEAM, 180, 1, fx)).toBe(0);
  });

  it('fixtures are sorted by id regardless of array order', () => {
    // F2 (id=2, finished) listed before F1 (id=1, not started) – should still work correctly
    const fx = [
      makeFixture({ id: 2, team_h: OTHER_TEAM, team_a: TEAM, started: true, finished: true }),
      makeFixture({ id: 1, team_h: TEAM, team_a: OTHER_TEAM, started: false }),
    ];
    // After sorting by id: F1 (id=1, not started) → ltp += 1; F2 (id=2, finished) → no ltp
    expect(computePlayerLtpContribution(TEAM, 0, 1, fx)).toBe(1);
  });
});

// ============================================================
// computeSpeculativeLtpSubs – blank-GW autosub LtP fix
// ============================================================

import { computeSpeculativeLtpSubs } from '../fplLive';

/**
 * Build a finalTeam pick (output of applyAutoSubsAndMultipliers) for
 * computeSpeculativeLtpSubs and computeSpeculativePointsAdjustment tests.
 * Position 1-11 = starter, 12-15 = bench.
 */
function makeTeamPick(opts: {
  playerId: number;
  position: number;
  playingPosition: 'GK' | 'DEF' | 'MID' | 'FWD';
  teamId: number;
  minutes: number;
  status: 'Fin' | 'Live' | 'NS';
  multiplier?: number;
  autoSubStatus?: string | null;
  is_captain?: boolean;
  is_vice_captain?: boolean;
  liveTotal?: number;
  chanceOfPlayingThisRound?: number | null;
}) {
  return {
    playerId: opts.playerId,
    position: opts.position,
    playingPosition: opts.playingPosition,
    teamId: opts.teamId,
    minutes: opts.minutes,
    status: opts.status,
    multiplier: opts.multiplier ?? (opts.position <= 11 ? 1 : 0),
    autoSubStatus: opts.autoSubStatus ?? null,
    is_captain: !!opts.is_captain,
    is_vice_captain: !!opts.is_vice_captain,
    liveTotal: opts.liveTotal ?? 0,
    chanceOfPlayingThisRound: opts.chanceOfPlayingThisRound ?? undefined,
  };
}

describe('computeSpeculativeLtpSubs – blank-GW autosub LtP fix', () => {
  /**
   * Team IDs used across tests:
   *   BLANK_TEAM_1, BLANK_TEAM_2, BLANK_TEAM_3 – teams with no GW fixture
   *   NS_TEAM_10 … NS_TEAM_25            – teams with a not-yet-started fixture
   */
  const BLANK = 1;  // Arsenal proxy  (no fixture)
  const BLANK2 = 2; // Man City proxy  (no fixture)

  /** GW fixtures: only teams 10-25 have a fixture this week. */
  function makeNsFixtures(teamIds: number[]): FixtureInfo[] {
    return teamIds.map((tid, i) =>
      makeFixture({ id: 100 + i, team_h: tid, team_a: 99, started: false })
    );
  }

  // ──────────────────────────────────────────────────────────────
  // (d) Control: no blank-GW starters – speculative adjustment = 0
  // ──────────────────────────────────────────────────────────────
  it('returns 0 when all starters have fixtures (no blank-GW starters)', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0, status: 'NS' }),
      // Bench
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0, status: 'NS' }),
    ];
    const fixtures2 = makeNsFixtures([10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]);
    expect(computeSpeculativeLtpSubs(team, 'None', fixtures2)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // (a) Harry Daniels scenario: GK (blank) + DEF (blank) + FWD (blank)
  //     3 bench players with fixtures should sub in speculatively.
  //     Mirrors the reported GW31 bug where LtP was incorrectly shown as 8.
  // ──────────────────────────────────────────────────────────────
  it('(Harry Daniels GW31) blank GK + blank DEF + blank FWD → speculative adjustment = 3', () => {
    // Teams 10-24 have NS fixtures; BLANK (1) and BLANK2 (2) have no fixture.
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

    // Formation 3-4-3.  Starters with no fixture: GK(BLANK), DEF(BLANK), FWD(BLANK2).
    // applyAutoSubsAndMultipliers gives blank starters multiplier=1 (it cannot detect blank GW).
    const team = [
      // Blank starters – guaranteed non-playing (no fixture)
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS' }), // Raya
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: BLANK,  minutes: 0, status: 'NS' }), // Gabriel
      // Normal starters (have fixtures)
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 16,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS' }),
      // Blank starter – guaranteed non-playing (no fixture)
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: BLANK2, minutes: 0, status: 'NS' }), // Haaland
      // Bench (all have fixtures)
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 18,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 19,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 20,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 21,     minutes: 0, status: 'NS' }),
    ];

    // Speculative subs: bench GK replaces Raya (+1), bench DEF replaces Gabriel (+1),
    // bench MID or FWD fills Haaland's slot (+1) → total = 3.
    expect(computeSpeculativeLtpSubs(team, 'None', fixtures)).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────
  // (c) Combined LtP = base + speculative matches expected total
  // ──────────────────────────────────────────────────────────────
  it('combined base-LtP + speculative matches expected total for blank-GW scenario', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

    // Same team as Harry Daniels test above
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: BLANK,  minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 16,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: BLANK2, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 18,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 19,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 20,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 21,     minutes: 0, status: 'NS' }),
    ];

    // Base LtP: only effective (multiplier > 0) players with fixtures contribute.
    // Starters p1 (GK,BLANK), p2 (DEF,BLANK), p11 (FWD,BLANK2) return 0; bench returns 0.
    // The remaining 8 normal starters each return 1.
    const baseLtp = team.reduce(
      (sum, p) => sum + computePlayerLtpContribution(p.teamId, p.minutes, p.multiplier, fixtures),
      0
    );
    expect(baseLtp).toBe(8); // 8 normal starters × multiplier 1

    const speculative = computeSpeculativeLtpSubs(team, 'None', fixtures);
    expect(speculative).toBe(3);

    // After the fix, total LtP = 11 (was incorrectly 8 before the fix).
    expect(baseLtp + speculative).toBe(11);
  });

  // ──────────────────────────────────────────────────────────────
  // (b) Multiple blank starters: blank GK + 2 blank DEF starters
  //     Formation: 5-3-2 → extra DEF means one bench DEF needed
  // ──────────────────────────────────────────────────────────────
  it('blank GK + two blank DEF starters → bench covers both DEF slots + GK slot', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

    // Formation: GK + 5 DEF + 3 MID + 2 FWD (5-3-2)
    // 3 blanks: GK, DEF×2
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS' }), // blank GK
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: BLANK,  minutes: 0, status: 'NS' }), // blank DEF
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: BLANK2, minutes: 0, status: 'NS' }), // blank DEF
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'DEF', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 16,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS' }),
      // Bench
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 18,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 19,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'DEF', teamId: 20,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'MID', teamId: 21,     minutes: 0, status: 'NS' }),
    ];

    // Expected: blank GK → bench GK (+1); blank DEF×2 → bench DEF×2 (+2) = 3 total.
    expect(computeSpeculativeLtpSubs(team, 'None', fixtures)).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────
  // Bench Boost chip: no auto-subs → always 0
  // ──────────────────────────────────────────────────────────────
  it('returns 0 under Bench Boost chip regardless of blank starters', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17]);

    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS' }), // blank GK
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 16,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: BLANK,  minutes: 0, status: 'NS' }), // blank FWD
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 14,     minutes: 0, status: 'NS' }),
    ];

    expect(computeSpeculativeLtpSubs(team, 'BB', fixtures)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // Blank bench player has no fixture → not counted as eligible sub
  // ──────────────────────────────────────────────────────────────
  it('blank-GW bench player is ineligible and is skipped when looking for speculative subs', () => {
    // Only team 10 has a fixture. Bench GK (BLANK) is ineligible; no eligible GK sub.
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS' }), // blank GK starter
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 12,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 16,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 18,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 19,     minutes: 0, status: 'NS' }),
      // Bench GK also blank → not eligible
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: BLANK2, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 20,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 21,     minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 22,     minutes: 0, status: 'NS' }),
    ];

    const fixtures2 = makeNsFixtures([10,11,12,13,14,15,16,17,18,19,20,21,22]);
    // GK slot is DNP but bench GK is also blank → no GK speculative sub (+0).
    // All 10 outfield starters have fixtures → no outfield subs needed.
    expect(computeSpeculativeLtpSubs(team, 'None', fixtures2)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // 0% chance-of-playing: soft non-play condition
  // ──────────────────────────────────────────────────────────────
  it('0%-chance starter (minutes=0) is treated as speculative non-playing → speculative sub applies', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0, status: 'NS' }),
      // 0%-chance starter (has a fixture but won't play)
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 0, status: 'NS', chanceOfPlayingThisRound: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0, status: 'NS' }),
      // Bench
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0, status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0, status: 'NS' }),
    ];
    const allFixtures = makeNsFixtures([10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]);

    // 0%-chance DEF at position 4 is speculative non-playing → bench DEF sub (+1).
    expect(computeSpeculativeLtpSubs(team, 'None', allFixtures)).toBe(1);
  });

  it('0%-chance starter fallback: if player gets minutes (>0) speculation is withdrawn', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);

    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0,  status: 'NS' }),
      // Was 0%-chance but miraculously played → minutes > 0 → fallback kicks in
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 45, status: 'Live', chanceOfPlayingThisRound: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0,  status: 'NS' }),
      // Bench
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0,  status: 'NS' }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0,  status: 'NS' }),
    ];

    // Player got minutes → no longer speculative non-playing → no speculative sub.
    expect(computeSpeculativeLtpSubs(team, 'None', fixtures)).toBe(0);
  });
});

// ============================================================
// computeSpeculativePointsAdjustment
// ============================================================

import { computeSpeculativePointsAdjustment } from '../fplLive';

describe('computeSpeculativePointsAdjustment – blank-GW and 0%-chance point fix', () => {
  const BLANK = 1;
  const BLANK2 = 2;

  function makeNsFixtures(teamIds: number[]): FixtureInfo[] {
    return teamIds.map((tid, i) =>
      makeFixture({ id: 200 + i, team_h: tid, team_a: 99, started: false })
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Control: no blank-GW starters → adjustment = 0
  // ──────────────────────────────────────────────────────────────
  it('returns 0 when no starters are blank-GW (all have fixtures)', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0, status: 'NS', liveTotal: 2 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0, status: 'NS', liveTotal: 3 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0, status: 'NS', liveTotal: 1 }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0, status: 'NS', liveTotal: 4 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0, status: 'NS', liveTotal: 5 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 0, status: 'NS', liveTotal: 3 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0, status: 'NS', liveTotal: 2 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0, status: 'NS', liveTotal: 1 }),
    ];
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // Bench Boost chip → always 0
  // ──────────────────────────────────────────────────────────────
  it('returns 0 under Bench Boost chip regardless of blank starters', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 10,    minutes: 0, status: 'NS', liveTotal: 2 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 11,    minutes: 0, status: 'NS', liveTotal: 1 }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 12,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 13,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 14,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 15,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 16,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 17,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 10,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 11,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 12,    minutes: 0, status: 'NS', liveTotal: 6 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 13,    minutes: 0, status: 'NS', liveTotal: 4 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 14,    minutes: 0, status: 'NS', liveTotal: 3 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 15,    minutes: 0, status: 'NS', liveTotal: 2 }),
    ];
    expect(computeSpeculativePointsAdjustment(team, 'BB', fixtures)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // Harry Daniels scenario: bench player points added for blank starters
  //   Before GW kicks off: bench players have liveTotal=0 → adjustment=0
  //   After bench players play: bench players have liveTotal>0 → adjustment>0
  // ──────────────────────────────────────────────────────────────
  it('blank-GW starters: adds bench player liveTotal for each speculative sub (pre-match: 0)', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: BLANK,  minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 10,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 11,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 12,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 13,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 14,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 15,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 16,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 17,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: BLANK2, minutes: 0, status: 'NS', liveTotal: 0 }),
      // Bench: liveTotal=0 (games not started yet)
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 18,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 19,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 20,     minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 21,     minutes: 0, status: 'NS', liveTotal: 0 }),
    ];
    // Bench all have liveTotal=0 before their games start → adjustment = 0.
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures)).toBe(0);
  });

  it('blank-GW starters: adds bench player liveTotal after bench players have played', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK,  minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: BLANK,  minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 10,     minutes: 90, status: 'Fin', liveTotal: 6 }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 11,     minutes: 90, status: 'Fin', liveTotal: 2 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 12,     minutes: 90, status: 'Fin', liveTotal: 3 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 13,     minutes: 90, status: 'Fin', liveTotal: 1 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 14,     minutes: 90, status: 'Fin', liveTotal: 5 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 15,     minutes: 90, status: 'Fin', liveTotal: 2 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 16,     minutes: 90, status: 'Fin', liveTotal: 8 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 17,     minutes: 90, status: 'Fin', liveTotal: 3 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: BLANK2, minutes: 0,  status: 'NS', liveTotal: 0 }),
      // Bench: games finished, bench players have real points
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 18, minutes: 90, status: 'Fin', liveTotal: 6 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 19, minutes: 90, status: 'Fin', liveTotal: 4 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 20, minutes: 90, status: 'Fin', liveTotal: 2 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 21, minutes: 90, status: 'Fin', liveTotal: 5 }),
    ];
    // 3 blank starters (GK, DEF, FWD) → bench GK(6) + bench DEF(4) + bench MID(2) = 12.
    // (Formation 3 DEF + 5 MID + 2 FWD is valid; bench MID fills before bench FWD per bench order.)
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures)).toBe(12);
  });

  // ──────────────────────────────────────────────────────────────
  // 0%-chance speculative case with fallback
  // ──────────────────────────────────────────────────────────────
  it('0%-chance starter (minutes=0): adds bench player liveTotal speculatively', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0,  status: 'NS', liveTotal: 0 }),
      // 0%-chance DEF (has fixture but is rated 0% chance of playing)
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 0,  status: 'NS', liveTotal: 0, chanceOfPlayingThisRound: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0,  status: 'NS', liveTotal: 0 }),
      // Bench: first bench player (position 13) is a DEF with a played game
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 90, status: 'Fin', liveTotal: 7 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0,  status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0,  status: 'NS', liveTotal: 0 }),
    ];
    // 0%-chance DEF → bench DEF subs in (liveTotal=7) → adjustment = 7.
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures)).toBe(7);
  });

  it('0%-chance starter fallback: player gets minutes → speculation withdrawn (adjustment = 0)', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: 10, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 11, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 12, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      // Was 0%-chance but unexpectedly started → minutes > 0 → fallback: no speculation
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 13, minutes: 60, status: 'Live', liveTotal: 2, chanceOfPlayingThisRound: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 14, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 15, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 16, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 17, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 18, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 19, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 20, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: 21, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 22, minutes: 90, status: 'Fin',  liveTotal: 7 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 23, minutes: 0,  status: 'NS',   liveTotal: 0 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 24, minutes: 0,  status: 'NS',   liveTotal: 0 }),
    ];
    // Player got minutes → isSpeculativeNonPlaying = false → no sub → adjustment = 0.
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // Blank bench player → ineligible (no fixture) → not credited
  // ──────────────────────────────────────────────────────────────
  it('blank-GW bench player is ineligible and not credited', () => {
    const fixtures = makeNsFixtures([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const team = [
      makeTeamPick({ playerId: 1,  position: 1,  playingPosition: 'GK',  teamId: BLANK, minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 2,  position: 2,  playingPosition: 'DEF', teamId: 10,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 3,  position: 3,  playingPosition: 'DEF', teamId: 11,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 4,  position: 4,  playingPosition: 'DEF', teamId: 12,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 5,  position: 5,  playingPosition: 'MID', teamId: 13,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 6,  position: 6,  playingPosition: 'MID', teamId: 14,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 7,  position: 7,  playingPosition: 'MID', teamId: 15,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 8,  position: 8,  playingPosition: 'MID', teamId: 16,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 9,  position: 9,  playingPosition: 'FWD', teamId: 17,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 10, position: 10, playingPosition: 'FWD', teamId: 18,    minutes: 0, status: 'NS', liveTotal: 0 }),
      makeTeamPick({ playerId: 11, position: 11, playingPosition: 'FWD', teamId: 19,    minutes: 0, status: 'NS', liveTotal: 0 }),
      // Bench GK is also blank → not eligible
      makeTeamPick({ playerId: 12, position: 12, playingPosition: 'GK',  teamId: BLANK2, minutes: 0, status: 'NS', liveTotal: 8 }),
      makeTeamPick({ playerId: 13, position: 13, playingPosition: 'DEF', teamId: 20,    minutes: 0, status: 'NS', liveTotal: 4 }),
      makeTeamPick({ playerId: 14, position: 14, playingPosition: 'MID', teamId: 21,    minutes: 0, status: 'NS', liveTotal: 3 }),
      makeTeamPick({ playerId: 15, position: 15, playingPosition: 'FWD', teamId: 22,    minutes: 0, status: 'NS', liveTotal: 2 }),
    ];
    const fixtures2 = makeNsFixtures([10,11,12,13,14,15,16,17,18,19,20,21,22]);
    // Blank-GW GK starter, but bench GK is also blank → no GK adjustment.
    // All outfield starters have fixtures → no outfield adjustment.
    expect(computeSpeculativePointsAdjustment(team, 'None', fixtures2)).toBe(0);
  });
});
