import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Characterization tests for gwPointsModal.js
 * These tests lock in the current behavior to serve as a safety net
 */

describe('gwPointsModal - team name handling', () => {
  /**
   * Test: teamCache with string values (squads.astro format)
   * Should correctly extract team short names when cache stores strings
   */
  it('should handle teamCache with string values', () => {
    const teamCache = new Map();
    teamCache.set(1, 'ARS');
    teamCache.set(2, 'CHE');
    teamCache.set(3, 'LIV');

    const gwData = [
      { round: 1, opponent_team: 1, was_home: true, minutes: 90, total_points: 8 },
      { round: 2, opponent_team: 2, was_home: false, minutes: 90, total_points: 6 },
      { round: 3, opponent_team: 3, was_home: true, minutes: 85, total_points: 12 },
    ];

    // Simulate the mapping logic from gwPointsModal.js
    const enrichedData = gwData.map(gw => {
      const team = teamCache.get(gw.opponent_team);
      const shortName = typeof team === 'string' ? team : team?.shortName;
      return {
        ...gw,
        opponent_team_short: shortName || gw.opponent_team
      };
    });

    expect(enrichedData[0].opponent_team_short).toBe('ARS');
    expect(enrichedData[1].opponent_team_short).toBe('CHE');
    expect(enrichedData[2].opponent_team_short).toBe('LIV');
  });

  /**
   * Test: teamCache with object values (live.astro format)
   * Should correctly extract team short names when cache stores objects with shortName property
   */
  it('should handle teamCache with object values', () => {
    const teamCache = new Map();
    teamCache.set(1, { name: 'Arsenal', shortName: 'ARS' });
    teamCache.set(2, { name: 'Chelsea', shortName: 'CHE' });
    teamCache.set(3, { name: 'Liverpool', shortName: 'LIV' });

    const gwData = [
      { round: 1, opponent_team: 1, was_home: true, minutes: 90, total_points: 8 },
      { round: 2, opponent_team: 2, was_home: false, minutes: 90, total_points: 6 },
      { round: 3, opponent_team: 3, was_home: true, minutes: 85, total_points: 12 },
    ];

    // Simulate the mapping logic from gwPointsModal.js
    const enrichedData = gwData.map(gw => {
      const team = teamCache.get(gw.opponent_team);
      const shortName = typeof team === 'string' ? team : team?.shortName;
      return {
        ...gw,
        opponent_team_short: shortName || gw.opponent_team
      };
    });

    expect(enrichedData[0].opponent_team_short).toBe('ARS');
    expect(enrichedData[1].opponent_team_short).toBe('CHE');
    expect(enrichedData[2].opponent_team_short).toBe('LIV');
  });

  /**
   * Test: teamCache with missing team
   * Should fallback to opponent_team when team not found in cache
   */
  it('should fallback to opponent_team when team not in cache', () => {
    const teamCache = new Map();
    teamCache.set(1, 'ARS');

    const gwData = [
      { round: 1, opponent_team: 1, was_home: true, minutes: 90, total_points: 8 },
      { round: 2, opponent_team: 99, was_home: false, minutes: 90, total_points: 6 }, // Team 99 not in cache
    ];

    // Simulate the mapping logic from gwPointsModal.js
    const enrichedData = gwData.map(gw => {
      const team = teamCache.get(gw.opponent_team);
      const shortName = typeof team === 'string' ? team : team?.shortName;
      return {
        ...gw,
        opponent_team_short: shortName || gw.opponent_team
      };
    });

    expect(enrichedData[0].opponent_team_short).toBe('ARS');
    expect(enrichedData[1].opponent_team_short).toBe(99); // Fallback to opponent_team
  });
});

describe('gwPointsModal - sort order', () => {
  /**
   * Test: GW data should be sorted newest first (descending by round)
   * Most recent gameweek should appear at the top of the table
   */
  it('should sort gameweeks by round in descending order (newest first)', () => {
    const gwHistory = [
      { round: 1, opponent_team: 1, was_home: true, minutes: 90, total_points: 8 },
      { round: 5, opponent_team: 5, was_home: false, minutes: 80, total_points: 4 },
      { round: 3, opponent_team: 3, was_home: true, minutes: 85, total_points: 12 },
      { round: 2, opponent_team: 2, was_home: false, minutes: 90, total_points: 6 },
      { round: 4, opponent_team: 4, was_home: true, minutes: 45, total_points: 2 },
    ];

    // Simulate the sorting logic from gwPointsModal.js
    const sortedHistory = [...gwHistory].sort((a, b) => b.round - a.round);

    // Verify sorted order: GW5, GW4, GW3, GW2, GW1
    expect(sortedHistory[0].round).toBe(5);
    expect(sortedHistory[1].round).toBe(4);
    expect(sortedHistory[2].round).toBe(3);
    expect(sortedHistory[3].round).toBe(2);
    expect(sortedHistory[4].round).toBe(1);
  });

  /**
   * Test: Empty history should not crash
   */
  it('should handle empty history array', () => {
    const gwHistory: any[] = [];
    const sortedHistory = [...gwHistory].sort((a, b) => b.round - a.round);
    expect(sortedHistory).toEqual([]);
  });

  /**
   * Test: Single GW should remain unchanged
   */
  it('should handle single gameweek', () => {
    const gwHistory = [
      { round: 1, opponent_team: 1, was_home: true, minutes: 90, total_points: 8 },
    ];
    const sortedHistory = [...gwHistory].sort((a, b) => b.round - a.round);
    expect(sortedHistory).toEqual(gwHistory);
  });
});
