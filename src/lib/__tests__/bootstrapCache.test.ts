import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeProxyDEFCON, DEFCON_NOTE } from '../../lib/fpl/bootstrapCache';
import type { BootstrapElement } from '../../lib/fpl/bootstrapCache';

// Minimal stub of a BootstrapElement
function makeElement(overrides: Partial<BootstrapElement> = {}): BootstrapElement {
  return {
    id: 1,
    web_name: 'Test',
    first_name: 'Test',
    second_name: 'Player',
    element_type: 2, // DEF by default
    team: 1,
    now_cost: 50,
    total_points: 100,
    minutes: 900,
    goals_scored: 2,
    assists: 3,
    clean_sheets: 5,
    goals_conceded: 10,
    own_goals: 0,
    penalties_saved: 0,
    penalties_missed: 0,
    yellow_cards: 2,
    red_cards: 0,
    saves: 0,
    bonus: 5,
    bps: 200,
    influence: '100',
    creativity: '50',
    threat: '80',
    ict_index: '50',
    selected_by_percent: '10.0',
    transfers_in: 100000,
    transfers_out: 50000,
    transfers_in_event: 1000,
    transfers_out_event: 500,
    event_points: 6,
    form: '5.0',
    points_per_game: '5.5',
    value_form: '1.0',
    value_season: '2.0',
    clearances_blocks_interceptions: 0,
    recoveries: 0,
    tackles: 0,
    status: 'a',
    news: '',
    chance_of_playing_next_round: 100,
    ...overrides,
  };
}

describe('computeProxyDEFCON', () => {
  it('returns 0 for GK (element_type 1)', () => {
    const el = makeElement({ element_type: 1, clearances_blocks_interceptions: 50, recoveries: 30 });
    expect(computeProxyDEFCON(el)).toBe(0);
  });

  it('returns 0 for DEF with CBI < 10', () => {
    const el = makeElement({ element_type: 2, clearances_blocks_interceptions: 9, recoveries: 100 });
    expect(computeProxyDEFCON(el)).toBe(0);
  });

  it('returns 2 for DEF with CBI = 10', () => {
    const el = makeElement({ element_type: 2, clearances_blocks_interceptions: 10, recoveries: 0 });
    expect(computeProxyDEFCON(el)).toBe(2);
  });

  it('returns 4 for DEF with CBI = 20', () => {
    const el = makeElement({ element_type: 2, clearances_blocks_interceptions: 20, recoveries: 0 });
    expect(computeProxyDEFCON(el)).toBe(4);
  });

  it('returns 4 for DEF with CBI = 25 (floor(25/10)*2 = 4)', () => {
    const el = makeElement({ element_type: 2, clearances_blocks_interceptions: 25, recoveries: 0 });
    expect(computeProxyDEFCON(el)).toBe(4);
  });

  it('ignores recoveries for DEF', () => {
    const elNoRec = makeElement({ element_type: 2, clearances_blocks_interceptions: 10, recoveries: 0 });
    const elWithRec = makeElement({ element_type: 2, clearances_blocks_interceptions: 10, recoveries: 100 });
    expect(computeProxyDEFCON(elNoRec)).toBe(computeProxyDEFCON(elWithRec));
  });

  it('returns 0 for MID with CBI + recoveries < 12', () => {
    const el = makeElement({ element_type: 3, clearances_blocks_interceptions: 5, recoveries: 6 });
    expect(computeProxyDEFCON(el)).toBe(0);
  });

  it('returns 2 for MID with CBI + recoveries = 12', () => {
    const el = makeElement({ element_type: 3, clearances_blocks_interceptions: 6, recoveries: 6 });
    expect(computeProxyDEFCON(el)).toBe(2);
  });

  it('returns 4 for MID with CBI + recoveries = 24', () => {
    const el = makeElement({ element_type: 3, clearances_blocks_interceptions: 12, recoveries: 12 });
    expect(computeProxyDEFCON(el)).toBe(4);
  });

  it('returns 2 for FWD with CBI + recoveries = 15 (floor(15/12)*2 = 2)', () => {
    const el = makeElement({ element_type: 4, clearances_blocks_interceptions: 8, recoveries: 7 });
    expect(computeProxyDEFCON(el)).toBe(2);
  });

  it('returns 0 for FWD with no defensive actions', () => {
    const el = makeElement({ element_type: 4, clearances_blocks_interceptions: 0, recoveries: 0 });
    expect(computeProxyDEFCON(el)).toBe(0);
  });

  it('handles missing clearances_blocks_interceptions (treats as 0)', () => {
    const el = makeElement({ element_type: 2 });
    (el as any).clearances_blocks_interceptions = undefined;
    expect(computeProxyDEFCON(el)).toBe(0);
  });
});

describe('DEFCON_NOTE', () => {
  it('is a non-empty string warning label', () => {
    expect(typeof DEFCON_NOTE).toBe('string');
    expect(DEFCON_NOTE.length).toBeGreaterThan(0);
  });
});
