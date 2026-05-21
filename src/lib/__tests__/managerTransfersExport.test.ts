import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildManagerTransfersCsv, fetchManagerTransfersRows, type ManagerTransferRow } from '../managerTransfersExport'

describe('buildManagerTransfersCsv', () => {
  it('includes chip_played immediately after element_in_name in header and row output', () => {
    const rows: ManagerTransferRow[] = [
      {
        season: 'current',
        gw: 6,
        entry_id: 123,
        entry_name: 'Team A',
        player_name: 'Manager A',
        time: '2026-09-10T10:00:00Z',
        element_in: 99,
        element_out: 42,
        purchase_price: 80,
        selling_price: 75,
        element_in_name: 'Player In',
        chip_played: 'WC',
        element_out_name: 'Player Out',
        element_in_prev_gw_points: 5,
        element_out_prev_gw_points: 2,
        element_out_gws_held: 3,
        element_in_pts_above5_last6: 1,
        element_out_pts_above5_last6: 0,
        element_in_avg_pts_last6: 4.2,
        element_out_avg_pts_last6: 3.5,
      },
    ]

    const [header, row] = buildManagerTransfersCsv(rows).split('\n')
    expect(header).toContain('element_in_name,chip_played,element_out_name')
    expect(row).toContain('Player In,WC,Player Out')
  })
})

describe('fetchManagerTransfersRows', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('seeds GW1 picks for element_out_gws_held and maps WC/FH chips per GW', async () => {
    const entryId = 123
    const origin = 'https://example.com'

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === `${origin}/api/fpl/entry/${entryId}`) {
        return {
          ok: true,
          json: async () => ({
            name: 'Team A',
            player_first_name: 'First',
            player_last_name: 'Last',
          }),
        }
      }
      if (url === `${origin}/api/fpl/entry/${entryId}/transfers`) {
        return {
          ok: true,
          json: async () => ([
            {
              event: 6,
              time: '2026-09-10T10:00:00Z',
              element_in: 99,
              element_out: 42,
              element_in_cost: 80,
              element_out_cost: 75,
            },
            {
              event: 6,
              time: '2026-09-10T11:00:00Z',
              element_in: 100,
              element_out: 99,
              element_in_cost: 81,
              element_out_cost: 80,
            },
          ]),
        }
      }
      if (url === `${origin}/api/fpl/bootstrap-static`) {
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: 42, web_name: 'Original Squad Player' },
              { id: 99, web_name: 'Transfer In Player' },
              { id: 100, web_name: 'Second Transfer In Player' },
            ],
          }),
        }
      }
      if (url === `${origin}/api/fpl/entry/${entryId}/history`) {
        return {
          ok: true,
          json: async () => ({
            chips: [{ name: 'wildcard', event: 6 }],
          }),
        }
      }
      if (url === `${origin}/api/fpl/entry/${entryId}/event/1/picks`) {
        return {
          ok: true,
          json: async () => ({
            picks: [{ element: 42 }],
          }),
        }
      }
      if (/\/api\/fpl\/event\/\d+\/live$/.test(url)) {
        return {
          ok: true,
          json: async () => ({ elements: [] }),
        }
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    const rows = await fetchManagerTransfersRows(origin, entryId, 'current')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.chip_played).toBe('WC')
    expect(rows[1]?.chip_played).toBe('WC')
    expect(rows[0]?.element_out_name).toBe('Original Squad Player')
    expect(rows[0]?.element_out_gws_held).toBe(5)
    expect(rows[1]?.element_out_name).toBe('Transfer In Player')
    expect(rows[1]?.element_out_gws_held).toBe(0)
  })

  it('reuses provided bootstrap data and shared GW live promises across managers', async () => {
    const origin = 'https://example.com'
    const managerA = 123
    const managerB = 456
    const liveFetchCount = new Map<number, number>()

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      const entryMatch = url.match(new RegExp(`${origin}/api/fpl/entry/(\\d+)$`))
      if (entryMatch) {
        const entryId = Number(entryMatch[1])
        return {
          ok: true,
          json: async () => ({
            name: `Team ${entryId}`,
            player_first_name: 'First',
            player_last_name: String(entryId),
          }),
        }
      }
      const transfersMatch = url.match(new RegExp(`${origin}/api/fpl/entry/(\\d+)/transfers$`))
      if (transfersMatch) {
        return {
          ok: true,
          json: async () => ([
            {
              event: 3,
              time: '2026-09-10T10:00:00Z',
              element_in: 99,
              element_out: 42,
              element_in_cost: 80,
              element_out_cost: 75,
            },
          ]),
        }
      }
      const historyMatch = url.match(new RegExp(`${origin}/api/fpl/entry/(\\d+)/history$`))
      if (historyMatch) {
        return {
          ok: true,
          json: async () => ({ chips: [] }),
        }
      }
      const gw1PicksMatch = url.match(new RegExp(`${origin}/api/fpl/entry/(\\d+)/event/1/picks$`))
      if (gw1PicksMatch) {
        return {
          ok: true,
          json: async () => ({ picks: [{ element: 42 }] }),
        }
      }
      const liveMatch = url.match(/\/api\/fpl\/event\/(\d+)\/live$/)
      if (liveMatch) {
        const gw = Number(liveMatch[1])
        liveFetchCount.set(gw, (liveFetchCount.get(gw) ?? 0) + 1)
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: 42, stats: { total_points: 2 } },
              { id: 99, stats: { total_points: 6 } },
            ],
          }),
        }
      }
      if (url === `${origin}/api/fpl/bootstrap-static`) {
        throw new Error('bootstrap-static should not be fetched when bootstrapData option is provided')
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    const sharedGwLivePromises = new Map<number, Promise<Map<number, number>>>()
    const bootstrapData = {
      elements: [
        { id: 42, web_name: 'Original Squad Player' },
        { id: 99, web_name: 'Transfer In Player' },
      ],
    }

    const [rowsA, rowsB] = await Promise.all([
      fetchManagerTransfersRows(origin, managerA, 'current', { bootstrapData, sharedGwLivePromises }),
      fetchManagerTransfersRows(origin, managerB, 'current', { bootstrapData, sharedGwLivePromises }),
    ])

    expect(rowsA).toHaveLength(1)
    expect(rowsB).toHaveLength(1)
    expect(liveFetchCount.get(1)).toBe(1)
    expect(liveFetchCount.get(2)).toBe(1)
    expect(rowsA[0]?.element_in_prev_gw_points).toBe(6)
    expect(rowsA[0]?.element_out_prev_gw_points).toBe(2)
  })
})
