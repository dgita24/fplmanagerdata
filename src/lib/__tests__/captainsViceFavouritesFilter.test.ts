import { describe, it, expect } from 'vitest';

/**
 * Tests for the Captains & Vice modal favourites filtering logic.
 *
 * The captainsBtn click handler in live.page.ts applies:
 *   const dataForCaptains = showFavouritesOnly
 *     ? liveData.filter(m => favouriteIds.has(m.entryId))
 *     : liveData;
 *
 * These tests verify that filtering produces the correct subset of managers.
 */

type ManagerEntry = {
  entryId: number;
  managerName: string;
  captainName?: string;
  vcName?: string;
};

function filterCaptainsData(
  liveData: ManagerEntry[],
  showFavouritesOnly: boolean,
  favouriteIds: Set<number>
): ManagerEntry[] {
  return showFavouritesOnly
    ? liveData.filter(m => favouriteIds.has(m.entryId))
    : liveData;
}

const allManagers: ManagerEntry[] = [
  { entryId: 1, managerName: 'Alice', captainName: 'Salah', vcName: 'Haaland' },
  { entryId: 2, managerName: 'Bob',   captainName: 'Haaland', vcName: 'Salah' },
  { entryId: 3, managerName: 'Carol', captainName: 'Palmer', vcName: 'Saka' },
];

describe('Captains & Vice modal — favourites filtering', () => {
  it('returns all managers when favourites is OFF', () => {
    const result = filterCaptainsData(allManagers, false, new Set([1]));
    expect(result).toHaveLength(3);
    expect(result).toEqual(allManagers);
  });

  it('returns only favourited managers when favourites is ON', () => {
    const favouriteIds = new Set([1, 3]);
    const result = filterCaptainsData(allManagers, true, favouriteIds);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.entryId)).toEqual([1, 3]);
    expect(result.map(m => m.managerName)).toEqual(['Alice', 'Carol']);
  });

  it('returns a single manager when only one is favourited', () => {
    const favouriteIds = new Set([2]);
    const result = filterCaptainsData(allManagers, true, favouriteIds);
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe(2);
    expect(result[0].managerName).toBe('Bob');
  });

  it('returns an empty array when favourites is ON but no favourites are set', () => {
    const result = filterCaptainsData(allManagers, true, new Set());
    expect(result).toHaveLength(0);
  });

  it('returns all managers when favourites is OFF and favourites set is empty', () => {
    const result = filterCaptainsData(allManagers, false, new Set());
    expect(result).toHaveLength(3);
  });

  it('does not mutate the original liveData array', () => {
    const data = [...allManagers];
    filterCaptainsData(data, true, new Set([1]));
    expect(data).toHaveLength(3);
  });

  it('toggling favourites ON then OFF returns full list', () => {
    const favouriteIds = new Set([1]);
    const withFav = filterCaptainsData(allManagers, true, favouriteIds);
    expect(withFav).toHaveLength(1);

    const withoutFav = filterCaptainsData(allManagers, false, favouriteIds);
    expect(withoutFav).toHaveLength(3);
  });
});
