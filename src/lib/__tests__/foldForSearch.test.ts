/**
 * Tests for the foldForSearch accent-normalisation logic used in PlayerExplorer.
 * The function itself lives in src/components/PlayerExplorer.astro (client script),
 * so we mirror it here to keep the test self-contained.
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of foldForSearch from PlayerExplorer.astro.
 * Keep in sync with the component implementation.
 *
 * Two-pass approach:
 *   1. Explicit char map for characters that don't decompose under NFD
 *      (Ø, å, Æ, ð, þ, ß …)
 *   2. NFD + strip combining marks for the rest (é→e, ü→u, ç→c …)
 */
function foldForSearch(s: string): string {
  const charMap: Record<string, string> = {
    'ø': 'o', 'Ø': 'o',
    'å': 'a', 'Å': 'a',
    'æ': 'ae', 'Æ': 'ae',
    'ð': 'd', 'Ð': 'd',
    'þ': 'th', 'Þ': 'th',
    'ß': 'ss',
  };
  let str = (s ?? '').toString();
  for (const [from, to] of Object.entries(charMap)) {
    str = str.split(from).join(to);
  }
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function matches(playerName: string, query: string): boolean {
  return foldForSearch(playerName).includes(foldForSearch(query));
}

describe('foldForSearch — atomic non-decomposable characters', () => {
  it('Ø → o: "odegaard" matches "Ødegaard"', () => {
    expect(matches('Ødegaard', 'odegaard')).toBe(true);
  });

  it('Ø → o: "norgaard" matches "Nørgaard"', () => {
    expect(matches('Nørgaard', 'norgaard')).toBe(true);
  });

  it('Ø → o: "sorloth" matches "Sørloth"', () => {
    expect(matches('Sørloth', 'sorloth')).toBe(true);
  });

  it('å → a: "haland" matches "Håland"', () => {
    expect(matches('Håland', 'haland')).toBe(true);
  });

  it('Æ → ae: "ae" matches "Æ"', () => {
    expect(matches('Ræstad', 'raestad')).toBe(true);
  });

  it('ß → ss: "ss" matches "ß"', () => {
    expect(matches('Straßer', 'strasser')).toBe(true);
  });
});

describe('foldForSearch — NFD-decomposable characters (accented vowels)', () => {
  it('ö → o: "gyokeres" matches "Gyökeres"', () => {
    expect(matches('Gyökeres', 'gyokeres')).toBe(true);
  });

  it('é → e: "Edouard" matches "Édouard"', () => {
    expect(matches('Édouard', 'Edouard')).toBe(true);
  });

  it('ü → u: "Muller" matches "Müller"', () => {
    expect(matches('Müller', 'Muller')).toBe(true);
  });

  it('ñ → n: "Fernandez" matches "Fernández"', () => {
    expect(matches('Fernández', 'Fernandez')).toBe(true);
  });

  it('ç → c: "Cancelo" matches "Çançelo"', () => {
    expect(matches('Çançelo', 'Cancelo')).toBe(true);
  });
});

describe('foldForSearch — ASCII names unaffected', () => {
  it('plain ASCII exact match', () => {
    expect(matches('Salah', 'salah')).toBe(true);
  });

  it('partial match still works', () => {
    expect(matches('Haaland', 'aal')).toBe(true);
  });

  it('non-matching name returns false', () => {
    expect(matches('Kane', 'salah')).toBe(false);
  });
});

describe('foldForSearch — edge cases', () => {
  it('empty query matches anything', () => {
    expect(matches('Ødegaard', '')).toBe(true);
  });

  it('exact special char query works', () => {
    expect(matches('Ødegaard', 'Ødegaard')).toBe(true);
  });
});
