import { describe, expect, it } from 'vitest'
import {
  buildChipGameweeksCsv,
  extractChipGameweeks,
  type RawChipEntry,
} from '../chipGameweeks'

describe('extractChipGameweeks', () => {
  it('maps chip names to chip codes and returns sorted gameweeks', () => {
    const chips: RawChipEntry[] = [
      { name: '3xc', event: 20 },
      { name: 'wildcard', event: 6 },
      { name: 'wildcard', event: 2 },
      { name: 'freehit', event: 29 },
      { name: 'bboost', event: 37 },
      { name: 'assistant_manager', event: 31 },
    ]

    const result = extractChipGameweeks(chips)

    expect(result.byChip.WC).toEqual([2, 6])
    expect(result.byChip.BB).toEqual([37])
    expect(result.byChip.TC).toEqual([20])
    expect(result.byChip.FH).toEqual([29])
    expect(result.byChip.AM).toEqual([31])
    expect(result.allChipGws).toEqual([2, 6, 20, 29, 31, 37])
  })

  it('ignores invalid chip rows and deduplicates gameweeks', () => {
    const result = extractChipGameweeks([
      { name: 'wildcard', event: 3 },
      { name: 'wildcard', event: 3 },
      { name: 'unknown', event: 9 },
      { name: 'bboost', event: 0 },
      { name: null, event: 12 },
      { name: 'freehit', event: 18 },
    ])

    expect(result.byChip.WC).toEqual([3])
    expect(result.byChip.FH).toEqual([18])
    expect(result.allChipGws).toEqual([3, 18])
  })
})

describe('buildChipGameweeksCsv', () => {
  it('creates a CSV export row with semicolon-separated GW lists', () => {
    const csv = buildChipGameweeksCsv([
      {
        entryId: 44,
        managerName: 'Andy "LTFPL"',
        teamName: 'Hello, Team',
        allChipGws: [2, 20],
        wildcardGws: [2],
        benchBoostGws: [],
        tripleCaptainGws: [20],
        freeHitGws: [],
        assistantManagerGws: [],
      },
    ])

    const [header, row] = csv.split('\n')
    expect(header).toContain('entry_id,manager_name,team_name')
    expect(row).toContain('"Andy ""LTFPL"""')
    expect(row).toContain('"Hello, Team"')
    expect(row).toContain('2;20')
  })
})
