import { describe, it, expect } from 'vitest'

/**
 * Pure helper: determines which managers should be pre-selected (checked) for
 * removal when a league is being removed.
 *
 * A manager is pre-selected only if they have NO other league associations
 * (i.e., they were uniquely imported via the league being removed).
 */
function computeRemovalPreselection(
  importedManagerIds: number[],
  otherLeagueManagerIds: Set<number>,
): Set<number> {
  return new Set(importedManagerIds.filter((id) => !otherLeagueManagerIds.has(id)))
}

/**
 * Pure helper: given the current manager ID list and a set of IDs to remove,
 * returns the updated list with those IDs filtered out.
 */
function applyManagerRemoval(currentIds: number[], idsToRemove: Set<number>): number[] {
  return currentIds.filter((id) => !idsToRemove.has(id))
}

describe('computeRemovalPreselection', () => {
  it('pre-selects all managers when none are shared with other leagues', () => {
    const result = computeRemovalPreselection([1, 2, 3], new Set())
    expect(result).toEqual(new Set([1, 2, 3]))
  })

  it('does not pre-select managers that also appear in other leagues', () => {
    const result = computeRemovalPreselection([1, 2, 3], new Set([2]))
    expect(result).toEqual(new Set([1, 3]))
  })

  it('pre-selects no managers when all are shared with other leagues', () => {
    const result = computeRemovalPreselection([1, 2], new Set([1, 2]))
    expect(result).toEqual(new Set())
  })

  it('returns an empty set for an empty input list', () => {
    const result = computeRemovalPreselection([], new Set())
    expect(result).toEqual(new Set())
  })

  it('handles a single uniquely-associated manager', () => {
    const result = computeRemovalPreselection([42], new Set([7, 99]))
    expect(result).toEqual(new Set([42]))
  })

  it('handles a single shared manager', () => {
    const result = computeRemovalPreselection([42], new Set([42]))
    expect(result).toEqual(new Set())
  })
})

describe('applyManagerRemoval', () => {
  it('removes specified managers from the list', () => {
    const result = applyManagerRemoval([1, 2, 3, 4], new Set([2, 4]))
    expect(result).toEqual([1, 3])
  })

  it('keeps all managers when the removal set is empty', () => {
    const result = applyManagerRemoval([1, 2, 3], new Set())
    expect(result).toEqual([1, 2, 3])
  })

  it('removes all managers when the full list is selected for removal', () => {
    const result = applyManagerRemoval([1, 2], new Set([1, 2]))
    expect(result).toEqual([])
  })

  it('handles an empty current list', () => {
    const result = applyManagerRemoval([], new Set([1, 2]))
    expect(result).toEqual([])
  })

  it('is a no-op when the removal set contains IDs not in the list', () => {
    const result = applyManagerRemoval([10, 20], new Set([99, 100]))
    expect(result).toEqual([10, 20])
  })
})
