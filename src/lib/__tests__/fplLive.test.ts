import { describe, it, expect } from 'vitest';
import { bonusFromBpsRows, getPlayerLiveComputed, getTeamGwStatus } from '../fplLive';
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
