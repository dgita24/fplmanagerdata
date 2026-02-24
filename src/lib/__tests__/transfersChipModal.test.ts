import { describe, it, expect } from 'vitest';

/**
 * Characterization tests for chip-display logic in the Transfers page manager modal.
 * These cover the BB/TC click-through behaviour added alongside the existing FH/WC logic.
 */

// ---------------------------------------------------------------------------
// Chip-name helpers (extracted from transfers.astro)
// ---------------------------------------------------------------------------

function getChipDisplay(chip: string): string {
  return chip === 'wildcard' ? 'Wildcard' :
         chip === 'freehit'  ? 'Free Hit' :
         chip === 'bboost'   ? 'Bench Boost' :
         chip === '3xc'      ? 'Triple Captain' : chip;
}

function isClickableChip(chip: string): boolean {
  return chip === 'wildcard' || chip === 'freehit' || chip === 'bboost' || chip === '3xc';
}

// ---------------------------------------------------------------------------
// Squad-display helper (mirrors the BB/TC branch in showChipTransfers)
// ---------------------------------------------------------------------------

interface Pick {
  element: number;
  position: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

function buildSquadHtml(
  picks: Pick[],
  chipName: string,
  allPlayersMap: Record<number, string>
): string {
  const starters = picks.filter(p => p.position <= 11).sort((a, b) => a.position - b.position);
  const bench    = picks.filter(p => p.position > 11).sort((a, b) => a.position - b.position);

  let html = '';
  html += '<div class="chip-transfer-section chip-transfer-section--out">';
  html += '<div class="chip-transfer-header">Starting XI</div>';
  html += '<div class="chip-transfer-list">';
  starters.forEach(p => {
    const name  = allPlayersMap[p.element] ?? `Player ${p.element}`;
    const badge = p.is_captain
      ? (chipName === '3xc' ? ' <strong>(C×3)</strong>' : ' (C)')
      : p.is_vice_captain ? ' (V)' : '';
    html += `<div class="chip-transfer-item">${name}${badge}</div>`;
  });
  html += '</div></div>';

  html += '<div class="chip-transfer-section chip-transfer-section--in">';
  html += `<div class="chip-transfer-header">Bench${chipName === 'bboost' ? ' (Active)' : ''}</div>`;
  html += '<div class="chip-transfer-list">';
  bench.forEach(p => {
    const name = allPlayersMap[p.element] ?? `Player ${p.element}`;
    html += `<div class="chip-transfer-item">${name}</div>`;
  });
  html += '</div></div>';

  return html;
}

// ---------------------------------------------------------------------------
// Tests: isClickableChip
// ---------------------------------------------------------------------------

describe('transfers chip modal - isClickableChip', () => {
  it('should return true for wildcard', () => {
    expect(isClickableChip('wildcard')).toBe(true);
  });

  it('should return true for freehit', () => {
    expect(isClickableChip('freehit')).toBe(true);
  });

  it('should return true for bboost (Bench Boost)', () => {
    expect(isClickableChip('bboost')).toBe(true);
  });

  it('should return true for 3xc (Triple Captain)', () => {
    expect(isClickableChip('3xc')).toBe(true);
  });

  it('should return false for unknown chip names', () => {
    expect(isClickableChip('unknown')).toBe(false);
    expect(isClickableChip('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getChipDisplay
// ---------------------------------------------------------------------------

describe('transfers chip modal - getChipDisplay', () => {
  it('should display correct name for each chip', () => {
    expect(getChipDisplay('wildcard')).toBe('Wildcard');
    expect(getChipDisplay('freehit')).toBe('Free Hit');
    expect(getChipDisplay('bboost')).toBe('Bench Boost');
    expect(getChipDisplay('3xc')).toBe('Triple Captain');
  });

  it('should return the chip name unchanged for unknown chips', () => {
    expect(getChipDisplay('unknown')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Tests: squad HTML for BB (bboost)
// ---------------------------------------------------------------------------

describe('transfers chip modal - BB squad display', () => {
  const players: Record<number, string> = {
    1: 'Raya', 2: 'Alexander-Arnold', 3: 'Pedro Porro', 4: 'Mykolenko',
    5: 'Fabianski', 6: 'Saka', 7: 'Salah', 8: 'Palmer', 9: 'Mbeumo',
    10: 'Haaland', 11: 'Watkins', 12: 'Flekken', 13: 'Nketiah',
    14: 'Doku', 15: 'Rodri'
  };

  const picks: Pick[] = Array.from({ length: 15 }, (_, i) => ({
    element: i + 1,
    position: i + 1,
    is_captain: i + 1 === 10, // Haaland is captain
    is_vice_captain: i + 1 === 7,
  }));

  it('should include all 11 starters', () => {
    const html = buildSquadHtml(picks, 'bboost', players);
    expect(html).toContain('Starting XI');
    // All 11 starters must appear
    for (let i = 1; i <= 11; i++) {
      expect(html).toContain(players[i]);
    }
  });

  it('should label bench as "Bench (Active)" for BB', () => {
    const html = buildSquadHtml(picks, 'bboost', players);
    expect(html).toContain('Bench (Active)');
  });

  it('should include all 4 bench players', () => {
    const html = buildSquadHtml(picks, 'bboost', players);
    for (let i = 12; i <= 15; i++) {
      expect(html).toContain(players[i]);
    }
  });

  it('should show (C) badge for captain in BB (not ×3)', () => {
    const html = buildSquadHtml(picks, 'bboost', players);
    // Captain badge should be (C) not (C×3) for BB
    expect(html).toContain('Haaland (C)');
    expect(html).not.toContain('C×3');
  });

  it('should show (V) badge for vice-captain', () => {
    const html = buildSquadHtml(picks, 'bboost', players);
    expect(html).toContain('Salah (V)');
  });
});

// ---------------------------------------------------------------------------
// Tests: squad HTML for TC (3xc)
// ---------------------------------------------------------------------------

describe('transfers chip modal - TC squad display', () => {
  const players: Record<number, string> = {
    1: 'Raya', 2: 'Alexander-Arnold', 3: 'Pedro Porro', 4: 'Mykolenko',
    5: 'Fabianski', 6: 'Saka', 7: 'Salah', 8: 'Palmer', 9: 'Mbeumo',
    10: 'Haaland', 11: 'Watkins', 12: 'Flekken', 13: 'Nketiah',
    14: 'Doku', 15: 'Rodri'
  };

  const picks: Pick[] = Array.from({ length: 15 }, (_, i) => ({
    element: i + 1,
    position: i + 1,
    is_captain: i + 1 === 10,
    is_vice_captain: i + 1 === 7,
  }));

  it('should include all 11 starters', () => {
    const html = buildSquadHtml(picks, '3xc', players);
    expect(html).toContain('Starting XI');
    for (let i = 1; i <= 11; i++) {
      expect(html).toContain(players[i]);
    }
  });

  it('should label bench simply as "Bench" for TC', () => {
    const html = buildSquadHtml(picks, '3xc', players);
    expect(html).toContain('>Bench<');
    expect(html).not.toContain('Bench (Active)');
  });

  it('should show (C×3) badge for captain in TC', () => {
    const html = buildSquadHtml(picks, '3xc', players);
    expect(html).toContain('Haaland <strong>(C×3)</strong>');
  });

  it('should show (V) badge for vice-captain', () => {
    const html = buildSquadHtml(picks, '3xc', players);
    expect(html).toContain('Salah (V)');
  });

  it('should include all 4 bench players', () => {
    const html = buildSquadHtml(picks, '3xc', players);
    for (let i = 12; i <= 15; i++) {
      expect(html).toContain(players[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: fallback for unknown player IDs
// ---------------------------------------------------------------------------

describe('transfers chip modal - unknown player fallback', () => {
  const picks: Pick[] = [
    { element: 999, position: 1, is_captain: true, is_vice_captain: false },
    { element: 998, position: 12, is_captain: false, is_vice_captain: false },
  ];

  it('should fall back to "Player <id>" when player is not in map', () => {
    const html = buildSquadHtml(picks, 'bboost', {});
    expect(html).toContain('Player 999');
    expect(html).toContain('Player 998');
  });
});
