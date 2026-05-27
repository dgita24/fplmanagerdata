import { describe, expect, it } from 'vitest'
import { calculateFTs } from '../../components/fts.js'

type HistoryRow = {
  gw: number
  transfers: number
  chipPlayed?: string
  FTsStartOfGW?: number
  FTsForNextGW?: number | string
}

describe('calculateFTs', () => {
  it('does not force a 5 FT reset in GW16', () => {
    const history: HistoryRow[] = [
      { gw: 14, transfers: 0 },
      { gw: 15, transfers: 0 },
      { gw: 16, transfers: 0 },
      { gw: 17, transfers: 0 },
    ]

    calculateFTs(history)

    expect(history.find((row) => row.gw === 15)?.FTsStartOfGW).toBe(2)
    expect(history.find((row) => row.gw === 16)?.FTsStartOfGW).toBe(3)
    expect(history.find((row) => row.gw === 17)?.FTsStartOfGW).toBe(4)
  })

  it('does not force next GW FT to 5 when max GW is 15', () => {
    const history: HistoryRow[] = [
      { gw: 14, transfers: 0 },
      { gw: 15, transfers: 0 },
    ]

    calculateFTs(history)

    expect(history.find((row) => row.gw === 15)?.FTsForNextGW).toBe(3)
  })

  it('preserves GW1 and WC/FH handling', () => {
    const history: HistoryRow[] = [
      { gw: 1, transfers: 0 },
      { gw: 2, transfers: 2, chipPlayed: 'WC' },
      { gw: 3, transfers: 0, chipPlayed: 'FH' },
      { gw: 4, transfers: 0 },
    ]

    calculateFTs(history)

    expect(history.find((row) => row.gw === 1)?.FTsStartOfGW).toBe(0)
    expect(history.find((row) => row.gw === 2)?.FTsStartOfGW).toBe(1)
    expect(history.find((row) => row.gw === 3)?.FTsStartOfGW).toBe(1)
    expect(history.find((row) => row.gw === 4)?.FTsStartOfGW).toBe(1)
  })
})
