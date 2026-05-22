import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildManagerTransfersCsv, fetchManagerTransfersRows, type ManagerTransferRow } from '../managerTransfersExport'

// ---------------------------------------------------------------------------
// Helper: build a minimal but complete fetch mock from a URL→response map.
// Pattern matching rules (applied in order):
//   - pattern contains '*' → treat as a regex with \d+ replacing ALL '*'
//     (other regex special chars are escaped so only '*' is wildcarded)
//   - pattern starts with '/' → url must end with that path
//   - otherwise → exact URL match
// Any unrecognised URL throws so tests fail loudly instead of silently.
// ---------------------------------------------------------------------------
function makeFetchMock(responses: Record<string, unknown>) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input)
    for (const [pattern, body] of Object.entries(responses)) {
      let matched: boolean
      if (pattern.includes('*')) {
        // Escape all regex special chars except '*', then replace each '*' with '\d+'
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\d+')
        matched = new RegExp(escaped).test(url)
      } else if (pattern.startsWith('/')) {
        matched = url.endsWith(pattern)
      } else {
        matched = url === pattern
      }
      if (matched) {
        if (body === null) return { ok: false, status: 404, json: async () => ({}) }
        return { ok: true, json: async () => body }
      }
    }
    if (/\/api\/fpl\/entry\/\d+\/event\/\d+\/picks$/.test(url)) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`)
  })
}

const BASE = 'https://example.com'
const ENTRY_ID = 123

const ENTRY_BODY = { name: 'Team A', player_first_name: 'First', player_last_name: 'Last' }
const BOOTSTRAP_BODY = {
  elements: [
    { id: 16, web_name: 'Initial Player' },
    { id: 42, web_name: 'Original Squad Player' },
    { id: 99, web_name: 'Transfer In Player' },
    { id: 100, web_name: 'Second Transfer In Player' },
    { id: 200, web_name: 'Multi GW Player' },
  ],
}
const EMPTY_HISTORY = { chips: [] }
const EMPTY_LIVE = { elements: [] }

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
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === `${BASE}/api/fpl/entry/${ENTRY_ID}`) {
        return {
          ok: true,
          json: async () => ({
            name: 'Team A',
            player_first_name: 'First',
            player_last_name: 'Last',
          }),
        }
      }
      if (url === `${BASE}/api/fpl/entry/${ENTRY_ID}/transfers`) {
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
      if (url === `${BASE}/api/fpl/bootstrap-static`) {
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
      if (url === `${BASE}/api/fpl/entry/${ENTRY_ID}/history`) {
        return {
          ok: true,
          json: async () => ({
            chips: [{ name: 'wildcard', event: 6 }],
          }),
        }
      }
      if (url === `${BASE}/api/fpl/entry/${ENTRY_ID}/event/1/picks`) {
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
    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.chip_played).toBe('WC')
    expect(rows[1]?.chip_played).toBe('WC')
    expect(rows[0]?.element_out_name).toBe('Original Squad Player')
    expect(rows[0]?.element_out_gws_held).toBe(5)
    expect(rows[1]?.element_out_name).toBe('Transfer In Player')
    expect(rows[1]?.element_out_gws_held).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // New test: same-GW same-timestamp transfers in REVERSED API order
  //
  // Scenario: WC session in GW6 where:
  //   Transfer A: Buy P99, Sell P16 (P16 was in GW1 squad)
  //   Transfer B: Buy P100, Sell P99 (P99 was just bought in Transfer A)
  //
  // The FPL API returns them in reversed order [B, A] — same timestamp on both.
  // Without the topological sort, processing B first makes P99's sell see
  // lastBoughtGwByElement[P99]=undefined and emit null (blank).
  // With the topological sort, A is always processed before B.
  // ---------------------------------------------------------------------------
  it('topological sort: same-GW same-timestamp reversed API order still gives correct gws_held', async () => {
    const SAME_TIME = '2024-10-15T10:00:00Z'

    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // API returns B first (the sell), then A (the buy) — same timestamp
        { event: 6, time: SAME_TIME, element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
        { event: 6, time: SAME_TIME, element_in: 99,  element_out: 16, element_in_cost: 75, element_out_cost: 74 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 16 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)

    // Row for (Buy P99, Sell P16): P16 was in GW1 squad → gws_held = 6 - 1 = 5
    const sellP16 = rows.find((r) => r.element_out === 16)
    expect(sellP16?.element_out_gws_held).toBe(5)

    // Row for (Buy P100, Sell P99): P99 was bought in the same GW → gws_held = 0
    const sellP99 = rows.find((r) => r.element_out === 99)
    expect(sellP99?.element_out_gws_held).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // New test: normal multi-GW hold returns a positive integer
  //
  // Player 200 is in the initial GW1 squad (seeded at GW1).
  // Sold for the first time in GW5.
  // Expected: gws_held = 5 - 1 = 4.
  // ---------------------------------------------------------------------------
  it('normal multi-GW hold returns correct positive gws_held', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 5, time: '2024-10-08T09:00:00Z', element_in: 99, element_out: 200, element_in_cost: 80, element_out_cost: 85 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 200 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.element_out).toBe(200)
    expect(rows[0]?.element_out_gws_held).toBe(4) // 5 - 1 = 4
  })

  // ---------------------------------------------------------------------------
  // New test: player bought mid-season then sold several GWs later
  //
  // Player 99 not in initial squad; bought in GW2, sold in GW7.
  // Expected: gws_held = 7 - 2 = 5.
  // ---------------------------------------------------------------------------
  it('mid-season buy then sell later returns correct gws_held', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 2, time: '2024-08-27T14:00:00Z', element_in: 99,  element_out: 42, element_in_cost: 70, element_out_cost: 68 },
        { event: 7, time: '2024-10-22T11:00:00Z', element_in: 100, element_out: 99, element_in_cost: 75, element_out_cost: 73 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    const sellP99 = rows.find((r) => r.element_out === 99)
    expect(sellP99?.element_out_gws_held).toBe(5) // 7 - 2 = 5
  })

  // ---------------------------------------------------------------------------
  // New test: unknown provenance → null
  //
  // Player 42 is sold, but:
  //   - GW1 picks endpoint returns 404 (not ok)
  //   - Player 42 was never an element_in in the transfers data
  //
  // Per rule 4: "If no provenance exists at all, output blank (null)."
  // ---------------------------------------------------------------------------
  it('unknown provenance (GW1 picks fail, never bought) returns null gws_held', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 4, time: '2024-09-17T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 70, element_out_cost: 68 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      // GW1 picks endpoint returns 404 → not ok → no seeding
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      // GW4 picks also unavailable, so provenance is truly unknown.
      [`/api/fpl/entry/${ENTRY_ID}/event/4/picks`]: null,
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(1)
    // P42 has no provenance (GW1 picks failed, never bought) → null
    expect(rows[0]?.element_out).toBe(42)
    expect(rows[0]?.element_out_gws_held).toBeNull()
    // P99 was bought in this transfer so it IS tracked, but it's the element_in here (not sold)
  })

  // ---------------------------------------------------------------------------
  // New test: GW1 picks fail, but player WAS bought via transfer → still non-null
  //
  // Even if GW1 picks fail, a player who was explicitly bought via transfer has
  // known provenance and should produce a valid (non-null) gws_held.
  // ---------------------------------------------------------------------------
  it('GW1 picks fail but player bought via transfer still yields non-null gws_held', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 3, time: '2024-09-10T10:00:00Z', element_in: 99, element_out: 42,  element_in_cost: 70, element_out_cost: 68 },
        { event: 8, time: '2024-11-05T10:00:00Z', element_in: 100, element_out: 99, element_in_cost: 75, element_out_cost: 72 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      // GW1 picks endpoint 404 → no seeding of initial squad
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    // P42 sold in GW3 with no provenance (GW1 picks failed) → null
    const sellP42 = rows.find((r) => r.element_out === 42)
    expect(sellP42?.element_out_gws_held).toBeNull()

    // P99 was bought in GW3 (via transfer), sold in GW8 → gws_held = 8 - 3 = 5
    const sellP99 = rows.find((r) => r.element_out === 99)
    expect(sellP99?.element_out_gws_held).toBe(5)
  })

  it('reconstructs pre-GW ownership from GW picks when initial picks are unavailable (original squad sold in GW3 => 2)', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 3, time: '2024-09-10T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 70, element_out_cost: 68 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      // Post-GW3 squad contains element_in (99), allowing reverse replay to infer pre-GW ownership of 42.
      [`/api/fpl/entry/${ENTRY_ID}/event/3/picks`]: { picks: [{ element: 99 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.element_out).toBe(42)
    expect(rows[0]?.element_out_gws_held).toBe(2)
  })

  // ---------------------------------------------------------------------------
  // New test: same-GW buy then sell in correct API order returns 0
  //
  // This is the "valid zero" case: buy and sell happen in the same GW.
  // ---------------------------------------------------------------------------
  it('same-GW buy then sell (correct API order) returns gws_held = 0', async () => {
    const SAME_TIME = '2024-10-15T10:00:00Z'

    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // Correct API order: buy first, then sell
        { event: 6, time: SAME_TIME, element_in: 99,  element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: SAME_TIME, element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 6 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.element_out === 42)?.element_out_gws_held).toBe(5) // 6 - 1
    expect(rows.find((r) => r.element_out === 99)?.element_out_gws_held).toBe(0) // same GW
    expect(rows.every((r) => r.chip_played === 'WC')).toBe(true)
  })

  it('free-hit week followed by next-GW sell uses reverted ownership timeline correctly', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 2, time: '2024-08-27T10:00:00Z', element_in: 99,  element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        { event: 3, time: '2024-09-03T10:00:00Z', element_in: 100, element_out: 42, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'freehit', event: 2 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/2/picks`]: { picks: [{ element: 99 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/3/picks`]: { picks: [{ element: 100 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.gw === 2)?.chip_played).toBe('FH')
    expect(rows.find((r) => r.gw === 2)?.element_out_gws_held).toBe(1) // 2 - 1
    expect(rows.find((r) => r.gw === 3)?.element_out_gws_held).toBe(2) // 3 - 1
  })

  // ---------------------------------------------------------------------------
  // New test: same-GW different-timestamp transfers where buy has LATER timestamp
  // than sell (i.e., sort-by-time alone would process sell before buy, causing blank).
  //
  // Scenario: WC session in GW6 where the FPL API assigns slightly different
  // timestamps to logically-chained transfers:
  //   Transfer A: Buy P99, Sell P16  (P16 in GW1 squad) — timestamp T2 = 10:00:01
  //   Transfer B: Buy P100, Sell P99 (P99 just bought in A) — timestamp T1 = 10:00:00
  //
  // The FPL API returns them ordered [A, B] but T(A)=10:00:01 > T(B)=10:00:00.
  // A plain time-sort would reorder to [B, A], so B (sell P99) would be processed
  // before A (buy P99), yielding blank for P99 sell.
  // The same-GW topological sort must detect the buy→sell chain and enforce A before B
  // regardless of their individual timestamps.
  // ---------------------------------------------------------------------------
  it('same-GW different-timestamp: later-timestamp buy is processed before earlier-timestamp sell to avoid blank', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // API returns A first but A has a LATER timestamp than B
        { event: 6, time: '2024-10-15T10:00:01Z', element_in: 99,  element_out: 16, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 16 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(2)
    // P16 was in GW1 squad, sold in GW6 → gws_held = 6 - 1 = 5
    const sellP16 = rows.find((r) => r.element_out === 16)
    expect(sellP16?.element_out_gws_held).toBe(5)
    // P99 was bought in GW6 (same GW), sold in GW6 → gws_held = 0
    const sellP99 = rows.find((r) => r.element_out === 99)
    expect(sellP99?.element_out_gws_held).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // New test: mid-season joiner — started_event > 1
  //
  // A manager who joined in GW5 has no GW1 picks.  The code must use their
  // actual first-GW picks (event/5/picks) and seed ownership at GW5 so that
  // a player sold in GW8 produces gws_held = 8 - 5 = 3 (not null).
  // ---------------------------------------------------------------------------
  it('mid-season joiner (started_event=5): initial squad player sold later gives correct gws_held', async () => {
    const MID_SEASON_ENTRY_BODY = {
      ...ENTRY_BODY,
      started_event: 5,
    }
    const PLAYER_300 = 300

    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: MID_SEASON_ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 8, time: '2024-10-29T14:00:00Z', element_in: 99, element_out: PLAYER_300, element_in_cost: 80, element_out_cost: 85 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: {
        elements: [
          { id: PLAYER_300, web_name: 'Mid-Season Player' },
          { id: 99, web_name: 'Transfer In Player' },
        ],
      },
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      // GW1 picks return 404 (manager wasn't registered at GW1)
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      // GW5 picks contain the initial squad including PLAYER_300
      [`/api/fpl/entry/${ENTRY_ID}/event/5/picks`]: { picks: [{ element: PLAYER_300 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.element_out).toBe(PLAYER_300)
    // Player was in initial GW5 squad, sold in GW8 → gws_held = 8 - 5 = 3
    expect(rows[0]?.element_out_gws_held).toBe(3)
  })

  it('reuses provided bootstrap data and shared GW live promises across managers', async () => {
    const managerA = 123
    const managerB = 456
    const liveFetchCount = new Map<number, number>()

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      const entryMatch = url.match(new RegExp(`${BASE}/api/fpl/entry/(\\d+)$`))
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
      const transfersMatch = url.match(new RegExp(`${BASE}/api/fpl/entry/(\\d+)/transfers$`))
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
      const historyMatch = url.match(new RegExp(`${BASE}/api/fpl/entry/(\\d+)/history$`))
      if (historyMatch) {
        return {
          ok: true,
          json: async () => ({ chips: [] }),
        }
      }
      const gw1PicksMatch = url.match(new RegExp(`${BASE}/api/fpl/entry/(\\d+)/event/1/picks$`))
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
      if (url === `${BASE}/api/fpl/bootstrap-static`) {
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
      fetchManagerTransfersRows(BASE, managerA, 'current', { bootstrapData, sharedGwLivePromises }),
      fetchManagerTransfersRows(BASE, managerB, 'current', { bootstrapData, sharedGwLivePromises }),
    ])

    expect(rowsA).toHaveLength(1)
    expect(rowsB).toHaveLength(1)
    expect(liveFetchCount.get(1)).toBe(1)
    expect(liveFetchCount.get(2)).toBe(1)
    expect(rowsA[0]?.element_in_prev_gw_points).toBe(6)
    expect(rowsA[0]?.element_out_prev_gw_points).toBe(2)
  })
})
