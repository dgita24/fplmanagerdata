import { describe, it, expect } from 'vitest';

/**
 * Characterization tests for ownership page logic (ownership.astro).
 * The functions are inlined here because they live in a <script> tag inside an
 * Astro component and cannot be imported directly.
 */

// ---------------------------------------------------------------------------
// Helpers extracted from ownership.astro
// ---------------------------------------------------------------------------

interface ManagerSquad {
  entryId: number;
  managerName: string;
  isFreeHit: boolean;
  picks: number[];
}

interface ManagerEntry {
  id: number;
  name: string;
}

interface PlayerOwnership {
  playerId: number;
  playerName: string;
  position: string;
  teamName: string;
  ownedBy: number[]; // manager entry IDs
  count: number;
}

function calculateOwnership(managerSquads: ManagerSquad[]): PlayerOwnership[] {
  const ownership = new Map<number, PlayerOwnership>();

  for (const manager of managerSquads) {
    for (const playerId of manager.picks) {
      if (!ownership.has(playerId)) {
        ownership.set(playerId, {
          playerId,
          playerName: `Player${playerId}`,
          position: 'MID',
          teamName: 'TST',
          ownedBy: [],
          count: 0,
        });
      }
      const entry = ownership.get(playerId)!;
      entry.ownedBy.push(Number(manager.entryId));
      entry.count++;
    }
  }

  return Array.from(ownership.values());
}

/**
 * Simulates the modal classification logic: given a list of owner IDs and
 * the full list of managers, return which managers own the player and which
 * do not, using ID-based comparison (not name-based).
 */
function classifyOwnership(
  ownedByList: number[],
  allManagers: ManagerEntry[]
): { ownedBy: ManagerEntry[]; notOwnedBy: ManagerEntry[] } {
  const notOwnedBy = allManagers
    .filter(m => !ownedByList.includes(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ownedBy = allManagers
    .filter(m => ownedByList.includes(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ownedBy, notOwnedBy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateOwnership - duplicate manager names', () => {
  it('tracks ownership by entryId, not by name', () => {
    const squads: ManagerSquad[] = [
      { entryId: 1, managerName: 'David Nash', isFreeHit: false, picks: [101] },
      { entryId: 2, managerName: 'David Nash', isFreeHit: false, picks: [102] },
    ];

    const result = calculateOwnership(squads);

    // Player 101 is owned only by manager 1
    const player101 = result.find(p => p.playerId === 101)!;
    expect(player101.ownedBy).toEqual([1]);
    expect(player101.count).toBe(1);

    // Player 102 is owned only by manager 2
    const player102 = result.find(p => p.playerId === 102)!;
    expect(player102.ownedBy).toEqual([2]);
    expect(player102.count).toBe(1);
  });

  it('stores entryId as a number even when managers share a name', () => {
    const squads: ManagerSquad[] = [
      { entryId: 10, managerName: 'Alice', isFreeHit: false, picks: [200] },
      { entryId: 20, managerName: 'Alice', isFreeHit: false, picks: [200] },
    ];

    const result = calculateOwnership(squads);
    const player = result.find(p => p.playerId === 200)!;
    expect(player.ownedBy).toEqual([10, 20]);
    expect(player.count).toBe(2);
  });
});

describe('classifyOwnership - duplicate manager names', () => {
  it('correctly splits two same-named managers into Owned / Not owned', () => {
    const allManagers: ManagerEntry[] = [
      { id: 1, name: 'David Nash' },
      { id: 2, name: 'David Nash' },
    ];

    // Only manager 1 owns the player
    const ownedByList = [1];

    const { ownedBy, notOwnedBy } = classifyOwnership(ownedByList, allManagers);

    expect(ownedBy).toHaveLength(1);
    expect(ownedBy[0].id).toBe(1);

    expect(notOwnedBy).toHaveLength(1);
    expect(notOwnedBy[0].id).toBe(2);
  });

  it('places both same-named managers in Owned when both own the player', () => {
    const allManagers: ManagerEntry[] = [
      { id: 1, name: 'David Nash' },
      { id: 2, name: 'David Nash' },
    ];

    const ownedByList = [1, 2];

    const { ownedBy, notOwnedBy } = classifyOwnership(ownedByList, allManagers);

    expect(ownedBy).toHaveLength(2);
    expect(notOwnedBy).toHaveLength(0);
  });

  it('places both same-named managers in Not owned when neither owns the player', () => {
    const allManagers: ManagerEntry[] = [
      { id: 1, name: 'David Nash' },
      { id: 2, name: 'David Nash' },
    ];

    const ownedByList: number[] = [];

    const { ownedBy, notOwnedBy } = classifyOwnership(ownedByList, allManagers);

    expect(ownedBy).toHaveLength(0);
    expect(notOwnedBy).toHaveLength(2);
  });

  it('handles non-duplicate managers correctly (no regression)', () => {
    const allManagers: ManagerEntry[] = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ];

    const ownedByList = [1, 3];

    const { ownedBy, notOwnedBy } = classifyOwnership(ownedByList, allManagers);

    expect(ownedBy.map(m => m.id)).toEqual([1, 3]);
    expect(notOwnedBy.map(m => m.id)).toEqual([2]);
  });

  it('handles same name and same team (another duplicate scenario)', () => {
    const allManagers: ManagerEntry[] = [
      { id: 100, name: 'John Smith' },
      { id: 200, name: 'John Smith' },
      { id: 300, name: 'Jane Doe' },
    ];

    // Manager 200 and 300 own the player; manager 100 does not
    const ownedByList = [200, 300];

    const { ownedBy, notOwnedBy } = classifyOwnership(ownedByList, allManagers);

    expect(ownedBy.map(m => m.id).sort()).toEqual([200, 300]);
    expect(notOwnedBy.map(m => m.id)).toEqual([100]);
  });
});
