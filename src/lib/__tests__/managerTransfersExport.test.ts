import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildManagerTransfersCsv, fetchManagerTransfersRows, type ManagerTransferRow, type ExitReason, type EntryReason, type OwnershipChangeScope, type CanonicalTransferInterpretation } from '../managerTransfersExport'

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
        element_out_acquired_gw: 3,
        element_out_acquired_via: 'transfer',
        element_out_pre_transfer_owned: true,
        element_in_pre_transfer_owned: false,
        element_in_is_new_ownership: true,
        transfer_group_id: '123:6',
        transfer_group_size: 2,
        transfer_group_index: 1,
        element_in_pts_above5_last6: 1,
        element_out_pts_above5_last6: 0,
        element_in_avg_pts_last6: 4.2,
        element_out_avg_pts_last6: 3.5,
        transfer_context: 'wildcard',
        is_chip_transfer: true,
        is_same_gw_churn: false,
        is_reliable_for_hold_analysis: true,
        element_out_exit_reason: 'wildcard_reset',
        element_in_entry_reason: 'wildcard_add',
        ownership_change_scope: 'permanent',
        is_permanent_squad_change: true,
        canonical_transfer_interpretation: 'permanent_team_change',
      },
    ]

    const [header, row] = buildManagerTransfersCsv(rows).split('\n')
    expect(header).toContain('element_in_name,chip_played,element_out_name')
    expect(header).toContain('element_out_gws_held,element_out_acquired_gw,element_out_acquired_via')
    expect(header).toContain('transfer_group_id,transfer_group_size,transfer_group_index')
    expect(header).toContain('transfer_context,is_chip_transfer,is_same_gw_churn,is_reliable_for_hold_analysis')
    expect(header).toContain('element_out_exit_reason,element_in_entry_reason,ownership_change_scope,is_permanent_squad_change,canonical_transfer_interpretation')
    expect(row).toContain('Player In,WC,Player Out')
    expect(row).toContain(',3,transfer,true,false,true,123:6,2,1,')
    expect(row).toContain('wildcard,true,false,true')
    expect(row).toContain('wildcard_reset,wildcard_add,permanent,true,permanent_team_change')
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
    expect(rows[0]?.element_out_acquired_gw).toBe(1)
    expect(rows[0]?.element_out_acquired_via).toBe('initial_squad')
    expect(rows[0]?.element_out_pre_transfer_owned).toBe(true)
    expect(rows[0]?.element_in_pre_transfer_owned).toBe(false)
    expect(rows[0]?.element_in_is_new_ownership).toBe(true)
    expect(rows[1]?.element_out_name).toBe('Transfer In Player')
    expect(rows[1]?.element_out_gws_held).toBe(0)
    expect(rows[1]?.element_out_acquired_gw).toBe(6)
    expect(rows[1]?.element_out_acquired_via).toBe('wildcard')
    expect(rows[1]?.transfer_group_id).toBe(`${ENTRY_ID}:6`)
    expect(rows[1]?.transfer_group_size).toBe(2)
    expect(rows[1]?.transfer_group_index).toBe(2)
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
    expect(sellP16?.transfer_group_id).toBe(`${ENTRY_ID}:6`)
    expect(sellP16?.transfer_group_size).toBe(2)
    expect(sellP16?.transfer_group_index).toBe(1)
    expect(sellP16?.element_out_acquired_via).toBe('initial_squad')

    // Row for (Buy P100, Sell P99): P99 was bought in the same GW → gws_held = 0
    const sellP99 = rows.find((r) => r.element_out === 99)
    expect(sellP99?.element_out_gws_held).toBe(0)
    expect(sellP99?.transfer_group_id).toBe(`${ENTRY_ID}:6`)
    expect(sellP99?.transfer_group_size).toBe(2)
    expect(sellP99?.transfer_group_index).toBe(2)
    expect(sellP99?.element_out_acquired_via).toBe('transfer')
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
    expect(sellP99?.element_out_acquired_gw).toBe(2)
    expect(sellP99?.element_out_acquired_via).toBe('transfer')
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
      // GW4 post-transfer picks are unavailable too, so pre-GW ownership cannot be reconstructed.
      [`/api/fpl/entry/${ENTRY_ID}/event/4/picks`]: null,
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')

    expect(rows).toHaveLength(1)
    // P42 has no provenance (GW1 picks failed, never bought) → null
    expect(rows[0]?.element_out).toBe(42)
    expect(rows[0]?.element_out_gws_held).toBeNull()
    expect(rows[0]?.element_out_acquired_gw).toBeNull()
    expect(rows[0]?.element_out_acquired_via).toBe('unknown')
    expect(rows[0]?.element_out_pre_transfer_owned).toBe(false)
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
    expect(rows.find((r) => r.gw === 2)?.element_out_acquired_via).toBe('initial_squad')
    expect(rows.find((r) => r.gw === 3)?.element_out_acquired_via).toBe('initial_squad')
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

  // ============================================================================
  // transfer_context + is_chip_transfer + is_same_gw_churn + is_reliable_for_hold_analysis
  // ============================================================================

  // ---------------------------------------------------------------------------
  // Context: standard — regular transfer, no chip, positive hold, known ownership
  // ---------------------------------------------------------------------------
  it('transfer_context is standard for a regular transfer with positive gws_held', async () => {
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
    expect(rows[0]?.transfer_context).toBe('standard')
    expect(rows[0]?.is_chip_transfer).toBe(false)
    expect(rows[0]?.is_same_gw_churn).toBe(false)
    expect(rows[0]?.is_reliable_for_hold_analysis).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Context: wildcard — chip_played is WC, regardless of gws_held
  // ---------------------------------------------------------------------------
  it('transfer_context is wildcard when WC chip is active and is_chip_transfer is true', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 80, element_out_cost: 75 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 6 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.transfer_context).toBe('wildcard')
    expect(rows[0]?.is_chip_transfer).toBe(true)
    expect(rows[0]?.is_same_gw_churn).toBe(false)
    expect(rows[0]?.is_reliable_for_hold_analysis).toBe(true) // WC with known hold is still reliable
  })

  // ---------------------------------------------------------------------------
  // Context: free_hit — chip_played is FH
  // FH transfers are NOT reliable for hold analysis (squad is temporary).
  // ---------------------------------------------------------------------------
  it('transfer_context is free_hit and is_reliable_for_hold_analysis is false for FH rows', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 4, time: '2024-09-24T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 78, element_out_cost: 72 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'freehit', event: 4 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.transfer_context).toBe('free_hit')
    expect(rows[0]?.is_chip_transfer).toBe(true)
    expect(rows[0]?.is_reliable_for_hold_analysis).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Context: same_gw_churn — bought and sold within the same GW (no chip)
  // ---------------------------------------------------------------------------
  it('transfer_context is same_gw_churn when gws_held is 0 and no chip is active', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // P42 is in initial squad; P99 is bought first then immediately re-sold
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99,  element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: '2024-10-15T11:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY, // no chip
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)

    const sellP42 = rows.find((r) => r.element_out === 42)
    // P42 is from initial squad — normal sell, positive hold
    expect(sellP42?.transfer_context).toBe('standard')
    expect(sellP42?.is_same_gw_churn).toBe(false)

    const sellP99 = rows.find((r) => r.element_out === 99)
    // P99 was bought and sold in the same GW with no chip → same_gw_churn
    expect(sellP99?.transfer_context).toBe('same_gw_churn')
    expect(sellP99?.is_same_gw_churn).toBe(true)
    expect(sellP99?.is_chip_transfer).toBe(false)
    // Same-GW churn has gws_held = 0 which is not null, so reliable for hold study
    expect(sellP99?.is_reliable_for_hold_analysis).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Context: chip_reversal — selling in a normal GW a player acquired via WC
  // ---------------------------------------------------------------------------
  it('transfer_context is chip_reversal when selling a player acquired via wildcard in a later GW', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // GW3 WC: sell P42, buy P99
        { event: 3, time: '2024-09-10T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        // GW7 standard: sell P99 (originally WC acquisition) — chip_reversal
        { event: 7, time: '2024-10-22T10:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 78 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 3 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)

    const wcRow = rows.find((r) => r.gw === 3)
    expect(wcRow?.transfer_context).toBe('wildcard')
    expect(wcRow?.element_out_acquired_via).toBe('initial_squad')

    const reversalRow = rows.find((r) => r.gw === 7)
    // P99 was acquired via wildcard in GW3, now sold in a standard-transfer GW
    expect(reversalRow?.transfer_context).toBe('chip_reversal')
    expect(reversalRow?.is_chip_transfer).toBe(false)
    expect(reversalRow?.is_same_gw_churn).toBe(false)
    expect(reversalRow?.element_out_acquired_via).toBe('wildcard')
    expect(reversalRow?.is_reliable_for_hold_analysis).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Context: unknown_provenance — player not confirmed owned, no chip active
  // ---------------------------------------------------------------------------
  it('transfer_context is unknown_provenance and is_reliable_for_hold_analysis is false when provenance is missing', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 4, time: '2024-09-17T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 70, element_out_cost: 68 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      // GW1 picks 404 → no seeding
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      [`/api/fpl/entry/${ENTRY_ID}/event/4/picks`]: null,
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.transfer_context).toBe('unknown_provenance')
    expect(rows[0]?.is_chip_transfer).toBe(false)
    expect(rows[0]?.is_same_gw_churn).toBe(false)
    expect(rows[0]?.is_reliable_for_hold_analysis).toBe(false)
    expect(rows[0]?.element_out_gws_held).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // WC same-GW churn: context is wildcard (chip takes precedence over gws_held=0)
  // ---------------------------------------------------------------------------
  it('transfer_context is wildcard (not same_gw_churn) when WC chip is active even if gws_held is 0', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // WC session: buy P99 sell P16, then immediately sell P99 in same session
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99,  element_out: 16, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: '2024-10-15T11:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 6 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 16 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)

    const sellP99 = rows.find((r) => r.element_out === 99)
    // P99 was bought and sold within the same WC GW.
    // is_same_gw_churn is a raw flag (gws_held===0) and is true regardless of chip.
    // transfer_context is the authoritative categorization: chip takes priority,
    // so it is 'wildcard' rather than 'same_gw_churn'.
    expect(sellP99?.element_out_gws_held).toBe(0)
    expect(sellP99?.is_same_gw_churn).toBe(true)   // raw flag: gws_held===0
    expect(sellP99?.transfer_context).toBe('wildcard') // authoritative: chip overrides churn label
    expect(sellP99?.is_chip_transfer).toBe(true)
  })

  // ============================================================================
  // element_out_exit_reason / element_in_entry_reason / ownership_change_scope /
  // is_permanent_squad_change — PR3 ownership-transition classification fields
  // ============================================================================

  // ---------------------------------------------------------------------------
  // Classification: standard transfer — long-held player sold, normal replacement
  // ---------------------------------------------------------------------------
  it('standard transfer: correct exit/entry reasons, permanent scope, is_permanent_squad_change=true', async () => {
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
    const row = rows[0]
    expect(row?.element_out_exit_reason).toBe<ExitReason>('standard_sale')
    expect(row?.element_in_entry_reason).toBe<EntryReason>('standard_buy')
    expect(row?.ownership_change_scope).toBe<OwnershipChangeScope>('permanent')
    expect(row?.is_permanent_squad_change).toBe(true)
    expect(row?.canonical_transfer_interpretation).toBe<CanonicalTransferInterpretation>('permanent_team_change')
  })

  // ---------------------------------------------------------------------------
  // Classification: wildcard — squad reset rows
  // ---------------------------------------------------------------------------
  it('wildcard: exit=wildcard_reset, entry=wildcard_add, scope=permanent, is_permanent=true', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 80, element_out_cost: 75 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 6 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.element_out_exit_reason).toBe<ExitReason>('wildcard_reset')
    expect(row?.element_in_entry_reason).toBe<EntryReason>('wildcard_add')
    expect(row?.ownership_change_scope).toBe<OwnershipChangeScope>('permanent')
    expect(row?.is_permanent_squad_change).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Classification: free hit — temporary squad rows
  // ---------------------------------------------------------------------------
  it('free hit: exit=free_hit_temp_out, entry=free_hit_temp_in, scope=temporary, is_permanent=false', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 4, time: '2024-09-24T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 78, element_out_cost: 72 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'freehit', event: 4 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.element_out_exit_reason).toBe<ExitReason>('free_hit_temp_out')
    expect(row?.element_in_entry_reason).toBe<EntryReason>('free_hit_temp_in')
    expect(row?.ownership_change_scope).toBe<OwnershipChangeScope>('temporary')
    expect(row?.is_permanent_squad_change).toBe(false)
    expect(row?.canonical_transfer_interpretation).toBe<CanonicalTransferInterpretation>('chip_temporary_move')
  })

  // ---------------------------------------------------------------------------
  // Classification: chip reversal — selling a WC/FH-acquired player in a
  // later standard-transfer GW
  // ---------------------------------------------------------------------------
  it('chip reversal: exit=chip_reversal_sale, entry=chip_reversal_buy, scope=reversal, is_permanent=true', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // GW3 WC: sell P42, buy P99
        { event: 3, time: '2024-09-10T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        // GW7 standard: sell P99 (WC acquisition) — chip_reversal
        { event: 7, time: '2024-10-22T10:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 78 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 3 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)
    const reversalRow = rows.find((r) => r.gw === 7)
    expect(reversalRow?.element_out_exit_reason).toBe<ExitReason>('chip_reversal_sale')
    expect(reversalRow?.element_in_entry_reason).toBe<EntryReason>('chip_reversal_buy')
    expect(reversalRow?.ownership_change_scope).toBe<OwnershipChangeScope>('reversal')
    // chip_reversal is a durable squad change (the result persists), so is_permanent is true
    expect(reversalRow?.is_permanent_squad_change).toBe(true)
    expect(reversalRow?.canonical_transfer_interpretation).toBe<CanonicalTransferInterpretation>('post_chip_reversal')
    // WC row itself: wildcard_reset / wildcard_add / permanent / true
    const wcRow = rows.find((r) => r.gw === 3)
    expect(wcRow?.element_out_exit_reason).toBe<ExitReason>('wildcard_reset')
    expect(wcRow?.element_in_entry_reason).toBe<EntryReason>('wildcard_add')
    expect(wcRow?.ownership_change_scope).toBe<OwnershipChangeScope>('permanent')
    expect(wcRow?.is_permanent_squad_change).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Classification: same-GW churn — net-zero, scope=unknown, is_permanent=false
  // ---------------------------------------------------------------------------
  it('same-GW churn: exit=same_gw_churn_sale, entry=same_gw_churn_buy, scope=unknown, is_permanent=false', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        // P42 sold (initial squad), P99 bought → then P99 immediately sold (same GW, no chip)
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99,  element_out: 42, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: '2024-10-15T11:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY, // no chip
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 42 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)

    // The standard sell row (P42 — long-held initial-squad player)
    const standardRow = rows.find((r) => r.element_out === 42)
    expect(standardRow?.element_out_exit_reason).toBe<ExitReason>('standard_sale')
    expect(standardRow?.element_in_entry_reason).toBe<EntryReason>('standard_buy')
    expect(standardRow?.ownership_change_scope).toBe<OwnershipChangeScope>('permanent')
    expect(standardRow?.is_permanent_squad_change).toBe(true)

    // The same-GW churn row (P99 — bought then immediately re-sold in same GW)
    const churnRow = rows.find((r) => r.element_out === 99)
    expect(churnRow?.element_out_exit_reason).toBe<ExitReason>('same_gw_churn_sale')
    expect(churnRow?.element_in_entry_reason).toBe<EntryReason>('same_gw_churn_buy')
    expect(churnRow?.ownership_change_scope).toBe<OwnershipChangeScope>('unknown')
    expect(churnRow?.is_permanent_squad_change).toBe(false)
    expect(churnRow?.canonical_transfer_interpretation).toBe<CanonicalTransferInterpretation>('same_gw_churn')
  })

  // ---------------------------------------------------------------------------
  // Classification: unknown provenance — scope=unknown, is_permanent=false
  // ---------------------------------------------------------------------------
  it('unknown_provenance: exit=unknown, entry=unknown, scope=unknown, is_permanent=false', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 4, time: '2024-09-17T10:00:00Z', element_in: 99, element_out: 42, element_in_cost: 70, element_out_cost: 68 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: EMPTY_HISTORY,
      // GW1 picks 404 → no seeding; no post-GW picks either
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: null,
      [`/api/fpl/entry/${ENTRY_ID}/event/4/picks`]: null,
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.transfer_context).toBe('unknown_provenance')
    expect(row?.element_out_exit_reason).toBe<ExitReason>('unknown')
    expect(row?.element_in_entry_reason).toBe<EntryReason>('unknown')
    expect(row?.ownership_change_scope).toBe<OwnershipChangeScope>('unknown')
    expect(row?.is_permanent_squad_change).toBe(false)
    expect(row?.canonical_transfer_interpretation).toBe<CanonicalTransferInterpretation>('unresolved_provenance_gap')
  })

  // ---------------------------------------------------------------------------
  // Classification: WC same-GW churn — chip takes priority; still classified as
  // wildcard_reset / wildcard_add / permanent even when gws_held===0
  // ---------------------------------------------------------------------------
  it('WC same-GW churn: exit=wildcard_reset, entry=wildcard_add, scope=permanent (chip overrides churn)', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      [`${BASE}/api/fpl/entry/${ENTRY_ID}`]: ENTRY_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/transfers`]: [
        { event: 6, time: '2024-10-15T10:00:00Z', element_in: 99,  element_out: 16, element_in_cost: 75, element_out_cost: 74 },
        { event: 6, time: '2024-10-15T11:00:00Z', element_in: 100, element_out: 99, element_in_cost: 80, element_out_cost: 79 },
      ],
      [`${BASE}/api/fpl/bootstrap-static`]: BOOTSTRAP_BODY,
      [`/api/fpl/entry/${ENTRY_ID}/history`]: { chips: [{ name: 'wildcard', event: 6 }] },
      [`/api/fpl/entry/${ENTRY_ID}/event/1/picks`]: { picks: [{ element: 16 }] },
      '/api/fpl/event/*/live': EMPTY_LIVE,
    }))

    const rows = await fetchManagerTransfersRows(BASE, ENTRY_ID, 'current')
    expect(rows).toHaveLength(2)

    // Both rows are in a WC GW — chip takes priority over the raw gws_held===0 flag
    for (const row of rows) {
      expect(row.element_out_exit_reason).toBe<ExitReason>('wildcard_reset')
      expect(row.element_in_entry_reason).toBe<EntryReason>('wildcard_add')
      expect(row.ownership_change_scope).toBe<OwnershipChangeScope>('permanent')
      expect(row.is_permanent_squad_change).toBe(true)
    }
  })
})
