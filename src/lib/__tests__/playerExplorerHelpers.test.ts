/**
 * Unit tests for pure helper logic extracted from PlayerExplorer.astro.
 * These helpers are mirrored here to keep tests self-contained without
 * requiring Astro component rendering.
 *
 * Covers:
 *   - buildDcWindowGWs: builds sequential GW IDs from a Supabase min/max window
 *   - buildSubtitleLabel: constructs the subtitle text including "(GWxx live)" indicator
 *   - resolveGwsToFetch: builds the list of GWs to fetch for DEFCON (finished + current)
 */

import { describe, it, expect } from 'vitest';

// --------------------------------------------------------------------------
// Helpers mirrored from PlayerExplorer.astro (keep in sync with component)
// --------------------------------------------------------------------------

/**
 * Build the array of GW IDs that form the DC scoring window.
 * Uses the Supabase-derived min_gw..max_gw range from player aggregates,
 * so the window includes the current (live) GW when Supabase has rows for it.
 */
function buildDcWindowGWs(minGw: number, maxGw: number): number[] {
  return Array.from({ length: maxGw - minGw + 1 }, (_, i) => minGw + i);
}

interface BootstrapEvent {
  id: number;
  is_current: boolean;
  finished: boolean;
}

/**
 * Build the subtitle label for the Player Explorer inline view.
 * Appends "(GWxx live)" when max_gw is the current GW and is not yet finished.
 */
function buildSubtitleLabel(
  playerCount: number,
  minGw: number | undefined,
  maxGw: number | undefined,
  events: BootstrapEvent[],
): string {
  const base = `${playerCount} player${playerCount !== 1 ? 's' : ''}`;
  if (minGw == null || maxGw == null) return base;

  let gwRange = ` · GW ${minGw}–${maxGw}`;
  const maxGwEvent = events.find(e => e.id === maxGw);
  if (maxGwEvent?.is_current && !maxGwEvent.finished) {
    gwRange += ` (GW${maxGw} live)`;
  }
  return `${base}${gwRange}`;
}

/**
 * Build the list of GW IDs to fetch for DEFCON live data.
 * Includes all finished GWs plus the current GW (even if not finished).
 */
function resolveGwsToFetch(events: BootstrapEvent[]): number[] {
  const finishedGWs = events.filter(e => e.finished).map(e => e.id);
  const currentEvent =
    events.find(e => e.is_current) ??
    events.filter(e => e.finished).at(-1);
  const currentGw = currentEvent?.id ?? null;

  const gwsToFetch = [...finishedGWs];
  if (currentGw != null && !finishedGWs.includes(currentGw)) {
    gwsToFetch.push(currentGw);
  }
  return gwsToFetch;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('buildDcWindowGWs', () => {
  it('returns a single-element array when minGw === maxGw', () => {
    expect(buildDcWindowGWs(30, 30)).toEqual([30]);
  });

  it('returns sequential IDs for a 3-GW window', () => {
    expect(buildDcWindowGWs(28, 30)).toEqual([28, 29, 30]);
  });

  it('returns sequential IDs for a 5-GW window', () => {
    expect(buildDcWindowGWs(26, 30)).toEqual([26, 27, 28, 29, 30]);
  });

  it('handles window starting from GW 1', () => {
    expect(buildDcWindowGWs(1, 3)).toEqual([1, 2, 3]);
  });
});

describe('buildSubtitleLabel', () => {
  const finishedEvents: BootstrapEvent[] = [
    { id: 28, is_current: false, finished: true },
    { id: 29, is_current: false, finished: true },
    { id: 30, is_current: false, finished: true },
  ];

  const liveEvents: BootstrapEvent[] = [
    { id: 28, is_current: false, finished: true },
    { id: 29, is_current: false, finished: true },
    { id: 30, is_current: true, finished: false },
  ];

  it('shows plain GW range when all GWs are finished', () => {
    expect(buildSubtitleLabel(820, 28, 30, finishedEvents))
      .toBe('820 players · GW 28–30');
  });

  it('appends "(GWxx live)" when max_gw is current and not finished', () => {
    expect(buildSubtitleLabel(820, 28, 30, liveEvents))
      .toBe('820 players · GW 28–30 (GW30 live)');
  });

  it('does not append live label when max_gw is finished (even if is_current)', () => {
    const events: BootstrapEvent[] = [
      { id: 29, is_current: false, finished: true },
      { id: 30, is_current: true, finished: true }, // current but finished
    ];
    expect(buildSubtitleLabel(820, 28, 30, events))
      .toBe('820 players · GW 28–30');
  });

  it('returns base label only when minGw/maxGw are undefined', () => {
    expect(buildSubtitleLabel(100, undefined, undefined, liveEvents))
      .toBe('100 players');
  });

  it('uses singular "player" for a single result', () => {
    expect(buildSubtitleLabel(1, 30, 30, finishedEvents))
      .toBe('1 player · GW 30–30');
  });

  it('handles empty events array (no live label added)', () => {
    expect(buildSubtitleLabel(820, 28, 30, []))
      .toBe('820 players · GW 28–30');
  });
});

describe('resolveGwsToFetch', () => {
  it('returns only finished GWs when all GWs are finished and none is_current', () => {
    const events: BootstrapEvent[] = [
      { id: 28, is_current: false, finished: true },
      { id: 29, is_current: false, finished: true },
    ];
    expect(resolveGwsToFetch(events)).toEqual([28, 29]);
  });

  it('appends current GW when it is not finished', () => {
    const events: BootstrapEvent[] = [
      { id: 28, is_current: false, finished: true },
      { id: 29, is_current: false, finished: true },
      { id: 30, is_current: true, finished: false },
    ];
    expect(resolveGwsToFetch(events)).toEqual([28, 29, 30]);
  });

  it('does not duplicate current GW when it is already finished', () => {
    const events: BootstrapEvent[] = [
      { id: 29, is_current: false, finished: true },
      { id: 30, is_current: true, finished: true },
    ];
    expect(resolveGwsToFetch(events)).toEqual([29, 30]);
  });

  it('falls back to last finished GW as current when no is_current flag', () => {
    const events: BootstrapEvent[] = [
      { id: 27, is_current: false, finished: true },
      { id: 28, is_current: false, finished: true },
      { id: 29, is_current: false, finished: false }, // started but not current/finished
    ];
    // Falls back to last finished (28); 29 is not included since it's neither current nor finished
    expect(resolveGwsToFetch(events)).toEqual([27, 28]);
  });

  it('returns empty array when no events', () => {
    expect(resolveGwsToFetch([])).toEqual([]);
  });

  it('returns empty array when no finished or current events', () => {
    const events: BootstrapEvent[] = [
      { id: 30, is_current: false, finished: false },
    ];
    expect(resolveGwsToFetch(events)).toEqual([]);
  });
});
