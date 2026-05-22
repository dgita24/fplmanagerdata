/**
 * Categorises each transfer row to help analysts distinguish real transfer
 * decisions from chip-driven squad churn and ambiguous provenance rows.
 *
 * Values:
 *   standard           – normal transfer (no chip, known ownership, gws_held > 0)
 *   wildcard           – chip_played is WC (whole-squad rebuild week)
 *   free_hit           – chip_played is FH (temporary squad for one GW)
 *   same_gw_churn      – no chip, but player was bought and sold in the same GW
 *                        (gws_held === 0); not chip-driven
 *   chip_reversal      – no chip, but the element_out was originally acquired
 *                        during a WC or FH week and is now being sold in a later
 *                        standard-transfer GW (undoing a prior chip pick)
 *   unknown_provenance – no chip AND the player's ownership cannot be confirmed
 *                        (gws_held is null); treat these rows with caution
 */
export type TransferContext =
  | 'standard'
  | 'wildcard'
  | 'free_hit'
  | 'same_gw_churn'
  | 'chip_reversal'
  | 'unknown_provenance'

/**
 * Why the player being sold left the squad on this transfer row.
 *
 *   standard_sale      – regular single-player transfer out of a durable squad
 *   wildcard_reset     – sold as part of a wildcard squad rebuild
 *   free_hit_temp_out  – sold as part of a temporary free-hit squad (not durable)
 *   chip_reversal_sale – sold in a normal GW but was originally acquired via WC/FH
 *                        (unwinding a prior chip pick)
 *   same_gw_churn_sale – bought and sold in the same GW (net-zero churn)
 *   unknown            – provenance gap; cannot classify with confidence
 */
export type ExitReason =
  | 'standard_sale'
  | 'wildcard_reset'
  | 'free_hit_temp_out'
  | 'chip_reversal_sale'
  | 'same_gw_churn_sale'
  | 'unknown'

/**
 * Why the player being bought entered the squad on this transfer row.
 *
 *   standard_buy      – regular single-player transfer into a durable squad
 *   wildcard_add      – added as part of a wildcard squad rebuild
 *   free_hit_temp_in  – added as part of a temporary free-hit squad (not durable)
 *   chip_reversal_buy – bought in a normal GW to replace a chip-era pick
 *                       (the out-player was originally acquired via WC/FH)
 *   same_gw_churn_buy – bought and sold in the same GW (net-zero churn)
 *   unknown           – provenance gap; cannot classify with confidence
 */
export type EntryReason =
  | 'standard_buy'
  | 'wildcard_add'
  | 'free_hit_temp_in'
  | 'chip_reversal_buy'
  | 'same_gw_churn_buy'
  | 'unknown'

/**
 * Characterises the durability of the squad ownership change this row represents.
 *
 *   permanent – both the exit and entry reflect durable long-term squad changes
 *               (standard, wildcard, chip_reversal contexts)
 *   temporary – the squad change is transient; the free-hit squad is not kept
 *   reversal  – the exit unwinds a prior chip-era acquisition (chip_reversal context)
 *   unknown   – cannot determine scope with confidence (same-GW churn, missing
 *               provenance)
 */
export type OwnershipChangeScope = 'permanent' | 'temporary' | 'reversal' | 'unknown'

/**
 * Group-level transfer context: the single TransferContext value if every row in
 * the group shares the same context, or 'mixed' when the group contains rows of
 * different contexts (e.g. a standard GW that has both 'standard' and
 * 'chip_reversal' rows).  'mixed' signals that the group cannot be treated as a
 * uniform event and individual rows must be inspected.
 */
export type TransferGroupContext = TransferContext | 'mixed'

export type ManagerTransferRow = {
  season: string
  gw: number
  entry_id: number
  entry_name: string
  player_name: string
  time: string
  element_in: number
  element_out: number
  purchase_price: number
  selling_price: number
  element_in_name: string
  chip_played: string | null
  element_out_name: string
  element_in_prev_gw_points: number | null
  element_out_prev_gw_points: number | null
  element_out_gws_held: number | null
  element_out_acquired_gw: number | null
  element_out_acquired_via: 'initial_squad' | 'transfer' | 'wildcard' | 'free_hit' | 'unknown'
  element_out_pre_transfer_owned: boolean
  element_in_pre_transfer_owned: boolean
  element_in_is_new_ownership: boolean
  transfer_group_id: string
  transfer_group_size: number
  transfer_group_index: number
  // ── Group-level transfer analytics ───────────────────────────────────────
  /**
   * The uniform TransferContext of all rows in this transfer group, or 'mixed'
   * when rows span more than one context (e.g. 'standard' and 'chip_reversal'
   * in the same GW).  Use this field to classify a whole transfer window
   * without aggregating per-row transfer_context values yourself.
   * See TransferGroupContext for full value semantics.
   */
  transfer_group_context: TransferGroupContext
  /**
   * Net expenditure for this transfer group: total purchase_price minus total
   * selling_price across all transfers in the group.  Positive means the
   * manager spent more than received; negative means a net budget gain.
   * Uses the same 0.1 M-unit scale as purchase_price and selling_price.
   */
  transfer_group_net_spend: number
  /**
   * True when one or more rows in this transfer group have
   * transfer_context = 'unknown_provenance'.  Signals that the group's
   * analysis may be incomplete and individual rows should be checked.
   */
  transfer_group_has_unknown_provenance: boolean
  /**
   * Count of rows in this transfer group where is_permanent_squad_change is
   * true.  Together with transfer_group_size this gives the fraction of the
   * window's changes that represent durable long-term squad decisions.
   */
  transfer_group_permanent_change_count: number
  element_in_pts_above5_last6: number | null
  element_out_pts_above5_last6: number | null
  element_in_avg_pts_last6: number | null
  element_out_avg_pts_last6: number | null
  // ── Transfer-context / analysis-confidence fields ─────────────────────────
  /**
   * Authoritative transfer categorization. Use this field to separate transfer
   * types in downstream analysis. See TransferContext for full value semantics.
   * Note: `is_same_gw_churn` is a raw flag (gws_held === 0) that can be true
   * even when transfer_context is 'wildcard' or 'free_hit'; use transfer_context
   * for definitive categorization.
   */
  transfer_context: TransferContext
  /** True when a chip (WC or FH) was active this GW. */
  is_chip_transfer: boolean
  /**
   * True when element_out was bought and sold within the same GW (gws_held === 0).
   * This is a raw data flag — use transfer_context for the authoritative
   * categorization (e.g. same-GW churn inside a WC session has transfer_context
   * 'wildcard', not 'same_gw_churn').
   */
  is_same_gw_churn: boolean
  /**
   * True when this row is analytically reliable for hold-duration and
   * transfer-behaviour studies: the element_out's provenance is known
   * (gws_held is not null) AND the transfer was not a temporary Free Hit move.
   * Rows with unknown_provenance or free_hit context should be excluded or
   * flagged when computing hold-duration statistics.
   */
  is_reliable_for_hold_analysis: boolean
  // ── Ownership-transition / event-classification fields ────────────────────
  /**
   * Why the sold player left the squad. Self-describing label for downstream
   * analysis without requiring consumers to interpret multi-field combinations.
   * See ExitReason for full value semantics.
   */
  element_out_exit_reason: ExitReason
  /**
   * Why the bought player entered the squad. Symmetric counterpart to
   * element_out_exit_reason; both are derived from the same transfer_context.
   * See EntryReason for full value semantics.
   */
  element_in_entry_reason: EntryReason
  /**
   * Characterises how durable this squad change is.
   *   permanent – durable long-term change (standard, wildcard, chip_reversal)
   *   temporary – transient squad state (free hit)
   *   reversal  – undoes a prior chip-era pick (chip_reversal)
   *   unknown   – cannot determine with confidence (same-GW churn, missing provenance)
   * See OwnershipChangeScope for full value semantics.
   */
  ownership_change_scope: OwnershipChangeScope
  /**
   * True when this row represents a durable change to the manager's long-term
   * squad (standard, wildcard, or chip_reversal transfers). False for free-hit
   * (temporary), same-GW churn (net-zero), or unknown-provenance rows.
   * Use this flag to filter to rows that actually reflect lasting ownership
   * decisions without having to inspect transfer_context manually.
   */
  is_permanent_squad_change: boolean
}

export type FetchManagerTransfersOptions = {
  bootstrapData?: unknown
  sharedGwLivePromises?: Map<number, Promise<Map<number, number>>>
}

type FplLiveElement = {
  id?: number
  stats?: {
    total_points?: number
  }
}

type FplTransferRow = {
  event?: number
  time?: string
  element_in?: number
  element_out?: number
  element_in_cost?: number
  element_out_cost?: number
}

type FplChipRow = {
  name?: string | null
  event?: number
}

type FplPicksResponse = {
  picks?: Array<{ element?: number }>
}

type AcquisitionVia = ManagerTransferRow['element_out_acquired_via']

function normalizeChipCode(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'wildcard') return 'WC'
  if (value === 'freehit') return 'FH'
  return null
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const str = String(value)
  if (!/[",\n]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

async function fetchJsonWithRetry(
  url: string,
  retries = 2
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) continue
      return { ok: true, data: await res.json() }
    } catch {
      // Retry transient network failures; the caller handles the final fallback.
    }
  }

  return { ok: false }
}

function formStats(
  elementId: number,
  transferGw: number,
  gwLiveMap: Map<number, Map<number, number>>
): { above5: number | null; avg: number | null } {
  const pts: number[] = []
  for (let g = Math.max(1, transferGw - 6); g < transferGw; g++) {
    const p = gwLiveMap.get(g)?.get(elementId)
    if (p !== undefined) pts.push(p)
  }
  if (pts.length === 0) return { above5: null, avg: null }
  const above5 = pts.filter((p) => p > 5).length
  const avg = Math.round((pts.reduce((s, p) => s + p, 0) / pts.length) * 10) / 10
  return { above5, avg }
}

function picksElementSet(data: unknown): Set<number> {
  const picks = Array.isArray((data as FplPicksResponse | null | undefined)?.picks)
    ? (data as FplPicksResponse).picks
    : []
  const result = new Set<number>()
  for (const pick of picks) {
    const elementId = Number(pick?.element)
    if (!Number.isInteger(elementId) || elementId <= 0) continue
    result.add(elementId)
  }
  return result
}

function inferAcquisitionGw(
  elementId: number,
  startedEvent: number,
  everBoughtByTransfer: Set<number>,
  acquisitionGwByElement: Map<number, number>
): number | null {
  const knownAcquiredGw = acquisitionGwByElement.get(elementId)
  if (knownAcquiredGw !== undefined) return knownAcquiredGw
  if (everBoughtByTransfer.has(elementId)) return null
  return startedEvent
}

function inferAcquisitionVia(
  elementId: number,
  everBoughtByTransfer: Set<number>,
  acquisitionViaByElement: Map<number, AcquisitionVia>
): AcquisitionVia {
  const knownAcquiredVia = acquisitionViaByElement.get(elementId)
  if (knownAcquiredVia !== undefined) return knownAcquiredVia
  if (everBoughtByTransfer.has(elementId)) return 'unknown'
  return 'initial_squad'
}

function acquiredViaFromChipCode(chipCode: string | null): AcquisitionVia {
  if (chipCode === 'WC') return 'wildcard'
  if (chipCode === 'FH') return 'free_hit'
  return 'transfer'
}

/**
 * Derive the transfer_context value for a single transfer row.
 *
 * Priority (highest → lowest):
 *   1. Chip played this GW  → 'wildcard' or 'free_hit'
 *   2. Player not confirmed owned at sell-time → 'unknown_provenance'
 *   3. Bought and sold in the same GW (gws_held === 0) → 'same_gw_churn'
 *   4. Player was originally acquired during a chip week  → 'chip_reversal'
 *   5. Everything else → 'standard'
 */
function deriveTransferContext(
  chipPlayed: string | null,
  elementOutGwsHeld: number | null,
  elementOutPreTransferOwned: boolean,
  elementOutAcquiredVia: AcquisitionVia
): TransferContext {
  if (chipPlayed === 'WC') return 'wildcard'
  if (chipPlayed === 'FH') return 'free_hit'
  if (!elementOutPreTransferOwned) return 'unknown_provenance'
  if (elementOutGwsHeld === 0) return 'same_gw_churn'
  if (elementOutAcquiredVia === 'wildcard' || elementOutAcquiredVia === 'free_hit') return 'chip_reversal'
  return 'standard'
}

/**
 * Derive the exit-reason label for the sold player from the transfer context.
 * Provides a self-describing, analyst-friendly classification that avoids the
 * need to interpret multi-field combinations.
 */
function deriveExitReason(transferContext: TransferContext): ExitReason {
  if (transferContext === 'wildcard') return 'wildcard_reset'
  if (transferContext === 'free_hit') return 'free_hit_temp_out'
  if (transferContext === 'chip_reversal') return 'chip_reversal_sale'
  if (transferContext === 'same_gw_churn') return 'same_gw_churn_sale'
  if (transferContext === 'standard') return 'standard_sale'
  return 'unknown' // unknown_provenance
}

/**
 * Derive the entry-reason label for the bought player from the transfer context.
 * Symmetric counterpart to deriveExitReason.
 */
function deriveEntryReason(transferContext: TransferContext): EntryReason {
  if (transferContext === 'wildcard') return 'wildcard_add'
  if (transferContext === 'free_hit') return 'free_hit_temp_in'
  if (transferContext === 'chip_reversal') return 'chip_reversal_buy'
  if (transferContext === 'same_gw_churn') return 'same_gw_churn_buy'
  if (transferContext === 'standard') return 'standard_buy'
  return 'unknown' // unknown_provenance
}

/**
 * Characterise how durable the squad change is.
 *   permanent – standard, wildcard (durable rebuild), or chip_reversal (durable sale)
 *   temporary – free_hit (squad reverts after one GW)
 *   reversal  – chip_reversal specifically (undoing a chip-era pick)
 *   unknown   – same-GW churn (net-zero change) or unknown provenance
 *
 * Note: chip_reversal is classified as 'reversal' rather than 'permanent' because
 * it has a distinct analytical meaning (undoing a chip-era pick) even though the
 * resulting squad change is durable.  Use is_permanent_squad_change for a simple
 * durable/not-durable boolean without that distinction.
 */
function deriveOwnershipChangeScope(transferContext: TransferContext): OwnershipChangeScope {
  if (transferContext === 'standard' || transferContext === 'wildcard') return 'permanent'
  if (transferContext === 'free_hit') return 'temporary'
  if (transferContext === 'chip_reversal') return 'reversal'
  return 'unknown' // same_gw_churn or unknown_provenance
}

/**
 * Returns true when the transfer represents a durable change to the manager's
 * long-term squad: standard, wildcard, or chip_reversal contexts.
 * Returns false for free-hit (temporary), same-GW churn (net-zero), or
 * unknown-provenance rows.
 */
function deriveIsPermanentSquadChange(transferContext: TransferContext): boolean {
  return (
    transferContext === 'standard' ||
    transferContext === 'wildcard' ||
    transferContext === 'chip_reversal'
  )
}

/**
 * Derive the group-level context for a set of transfer rows that share the same
 * transfer_group_id.  Returns the single shared TransferContext value when all
 * rows agree, or 'mixed' when the group contains more than one distinct context
 * (e.g. a standard GW with both 'standard' and 'chip_reversal' rows).
 */
function deriveTransferGroupContext(contexts: TransferContext[]): TransferGroupContext {
  if (contexts.length === 0) return 'standard'
  const unique = new Set(contexts)
  return unique.size === 1 ? (Array.from(unique)[0] as TransferGroupContext) : 'mixed'
}

/**
 * Within a group of transfers sharing the same GW, apply a topological sort so
 * that if row A buys element X and row B sells element X, row A is always
 * processed before row B.
 *
 * This prevents false-blank `element_out_gws_held` values that arise when the
 * FPL API returns same-GW transfers in an order where the sell of a player
 * appears before the buy of that player in the same session (e.g. WC/FH churn
 * where a manager buys then immediately re-sells a player, even when the FPL
 * API records slightly different timestamps for each transfer).
 *
 * Grouping by the whole GW (rather than only same-GW AND same-timestamp) is
 * necessary because the FPL API sometimes assigns slightly different timestamps
 * to logically-chained transfers within a single WC/FH session.  A purely
 * time-based sort would then place a "sell X" row before the "buy X" row,
 * producing a false blank.
 *
 * Within topologically-equivalent sets the stable tie-break is (timestamp,
 * original API index) so the output is deterministic and chronologically
 * sensible.
 */
function topoSortSameGwGroup(
  group: Array<{ row: FplTransferRow; origIdx: number }>
): FplTransferRow[] {
  const n = group.length
  if (n <= 1) return group.map((g) => g.row)

  // Build a directed graph: edge i→j means row i must be processed before row j
  // (row i buys the element that row j sells).
  const adj: number[][] = Array.from({ length: n }, () => [])
  const inDegree = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    const elemIn = Number(group[i].row.element_in)
    if (!Number.isInteger(elemIn) || elemIn <= 0) continue
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const elemOut = Number(group[j].row.element_out)
      if (elemIn === elemOut) {
        adj[i].push(j)
        inDegree[j]++
      }
    }
  }

  // Kahn's algorithm — stable tie-break by (timestamp, original API index)
  const cmpEntry = (
    a: { row: FplTransferRow; origIdx: number },
    b: { row: FplTransferRow; origIdx: number }
  ): number => {
    const timeCmp = String(a.row?.time || '').localeCompare(String(b.row?.time || ''))
    if (timeCmp !== 0) return timeCmp
    return a.origIdx - b.origIdx
  }
  const cmp = (a: number, b: number): number => cmpEntry(group[a], group[b])

  const result: FplTransferRow[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) ready.push(i)
  }
  ready.sort(cmp)

  while (ready.length > 0) {
    const i = ready.shift()!
    result.push(group[i].row)
    const newReady: number[] = []
    for (const j of adj[i]) {
      inDegree[j]--
      if (inDegree[j] === 0) newReady.push(j)
    }
    newReady.sort(cmp)
    ready.push(...newReady)
  }

  // Safety net for cycles (should not occur with real FPL data) — append remaining
  // rows in (timestamp, original-index) order so output is still deterministic.
  if (result.length < n) {
    const resultSet = new Set(result)
    const remaining = group.filter((g) => !resultSet.has(g.row))
    remaining.sort(cmpEntry)
    for (const { row } of remaining) result.push(row)
  }

  return result
}

export function buildManagerTransfersCsv(rows: ManagerTransferRow[]): string {
  const header = [
    'season',
    'gw',
    'entry_id',
    'entry_name',
    'player_name',
    'time',
    'element_in',
    'element_out',
    'purchase_price',
    'selling_price',
    'element_in_name',
    'chip_played',
    'element_out_name',
    'element_in_prev_gw_points',
    'element_out_prev_gw_points',
    'element_out_gws_held',
    'element_out_acquired_gw',
    'element_out_acquired_via',
    'element_out_pre_transfer_owned',
    'element_in_pre_transfer_owned',
    'element_in_is_new_ownership',
    'transfer_group_id',
    'transfer_group_size',
    'transfer_group_index',
    'transfer_group_context',
    'transfer_group_net_spend',
    'transfer_group_has_unknown_provenance',
    'transfer_group_permanent_change_count',
    'element_in_pts_above5_last6',
    'element_out_pts_above5_last6',
    'element_in_avg_pts_last6',
    'element_out_avg_pts_last6',
    'transfer_context',
    'is_chip_transfer',
    'is_same_gw_churn',
    'is_reliable_for_hold_analysis',
    'element_out_exit_reason',
    'element_in_entry_reason',
    'ownership_change_scope',
    'is_permanent_squad_change',
  ]

  const lines = rows.map((row) =>
    [
      row.season,
      row.gw,
      row.entry_id,
      row.entry_name,
      row.player_name,
      row.time,
      row.element_in,
      row.element_out,
      row.purchase_price,
      row.selling_price,
      row.element_in_name,
      row.chip_played,
      row.element_out_name,
      row.element_in_prev_gw_points,
      row.element_out_prev_gw_points,
      row.element_out_gws_held,
      row.element_out_acquired_gw,
      row.element_out_acquired_via,
      row.element_out_pre_transfer_owned,
      row.element_in_pre_transfer_owned,
      row.element_in_is_new_ownership,
      row.transfer_group_id,
      row.transfer_group_size,
      row.transfer_group_index,
      row.transfer_group_context,
      row.transfer_group_net_spend,
      row.transfer_group_has_unknown_provenance,
      row.transfer_group_permanent_change_count,
      row.element_in_pts_above5_last6,
      row.element_out_pts_above5_last6,
      row.element_in_avg_pts_last6,
      row.element_out_avg_pts_last6,
      row.transfer_context,
      row.is_chip_transfer,
      row.is_same_gw_churn,
      row.is_reliable_for_hold_analysis,
      row.element_out_exit_reason,
      row.element_in_entry_reason,
      row.ownership_change_scope,
      row.is_permanent_squad_change,
    ].map(csvCell).join(',')
  )

  return `\uFEFF${[header.join(','), ...lines].join('\n')}`
}

export async function fetchManagerTransfersRows(
  origin: string,
  entryId: number,
  season = 'current',
  options?: FetchManagerTransfersOptions
): Promise<ManagerTransferRow[]> {
  try {
    const [entryResult, transfersResult, historyResult, gw1PicksResult] = await Promise.all([
      fetchJsonWithRetry(`${origin}/api/fpl/entry/${entryId}`),
      fetchJsonWithRetry(`${origin}/api/fpl/entry/${entryId}/transfers`),
      fetchJsonWithRetry(`${origin}/api/fpl/entry/${entryId}/history`),
      fetchJsonWithRetry(`${origin}/api/fpl/entry/${entryId}/event/1/picks`),
    ])

    let bootstrapData: unknown = options?.bootstrapData ?? null
    if (!bootstrapData) {
      const bootstrapResult = await fetchJsonWithRetry(`${origin}/api/fpl/bootstrap-static`)
      if (!bootstrapResult.ok) {
        console.error('[managerTransfersExport] Failed to load bootstrap-static for manager export')
        return []
      }
      bootstrapData = bootstrapResult.data
    }

    if (!entryResult.ok || !transfersResult.ok) {
      console.error(`[managerTransfersExport] Failed to load manager ${entryId} entry or transfers data`)
      return []
    }

    const entryData = entryResult.data
    const transfersData = transfersResult.data
    const historyData = historyResult.ok ? historyResult.data : null

    const entry_name = String(entryData?.name || '')
    const player_name = `${entryData?.player_first_name || ''} ${entryData?.player_last_name || ''}`.trim() || `Manager ${entryId}`

    const elements = Array.isArray(bootstrapData?.elements) ? bootstrapData.elements : []
    const playerNameMap = new Map<number, string>()
    for (const el of elements) {
      const id = Number(el?.id)
      if (!Number.isInteger(id) || id <= 0) continue
      playerNameMap.set(id, String(el?.web_name || `Player ${id}`))
    }

    const transfers = Array.isArray(transfersData) ? transfersData as FplTransferRow[] : []
    const chipByGw = new Map<number, string>()
    const chips = Array.isArray(historyData?.chips) ? historyData.chips as FplChipRow[] : []
    for (const chip of chips) {
      const gw = Number(chip?.event)
      const normalized = normalizeChipCode(chip?.name ?? null)
      if (!Number.isInteger(gw) || gw <= 0) continue
      if (!normalized) continue
      chipByGw.set(gw, normalized)
    }

    // Collect unique GWs needed for live data (gw-6 to gw-1) for all transfers
    const prevGwSet = new Set<number>()
    for (const row of transfers) {
      const gw = Number(row?.event)
      if (!Number.isInteger(gw) || gw <= 1) continue
      for (let g = Math.max(1, gw - 6); g < gw; g++) {
        prevGwSet.add(g)
      }
    }

    const gwLiveMap = new Map<number, Map<number, number>>()
    const sharedGwLivePromises = options?.sharedGwLivePromises
    await Promise.all(
      Array.from(prevGwSet).map(async (prevGw) => {
        try {
          let promise: Promise<Map<number, number>>
          if (sharedGwLivePromises?.has(prevGw)) {
            promise = sharedGwLivePromises.get(prevGw)!
          } else {
            promise = fetchJsonWithRetry(`${origin}/api/fpl/event/${prevGw}/live`)
              .then((liveResult) => {
                if (!liveResult.ok) return new Map<number, number>()
                const liveData = liveResult.data
                const elements = Array.isArray(liveData?.elements) ? liveData.elements as FplLiveElement[] : []
                const elementPointsMap = new Map<number, number>()
                for (const el of elements) {
                  const id = Number(el?.id)
                  if (!Number.isInteger(id) || id <= 0) continue
                  const pts = Number(el?.stats?.total_points)
                  if (Number.isInteger(pts)) elementPointsMap.set(id, pts)
                }
                return elementPointsMap
              })
              .catch(() => new Map<number, number>())
            if (sharedGwLivePromises) {
              sharedGwLivePromises.set(prevGw, promise)
            }
          }
          const elementPointsMap = await promise
          if (elementPointsMap.size > 0) gwLiveMap.set(prevGw, elementPointsMap)
        } catch {
          // leave entry absent — will resolve to null
        }
      })
    )

    // Track when each element was last bought by this manager (for gws_held calculation).
    // Sort transfers chronologically so lastBoughtGwByElement is populated in the right order.
    //
    // For transfers that share the same GW (common during WC/FH when a manager makes many
    // changes in one session), a plain time-sort is insufficient because the FPL API sometimes
    // assigns slightly different timestamps to logically-chained transfers in the same session.
    // For example, "buy P99 at 10:00:01, sell P99 at 10:00:00" would be sorted as sell-before-buy
    // by time, causing the sell to see null provenance and emit a false blank.
    //
    // We fix this by:
    //   1. Sorting by (gw, time, original-index) for a fully deterministic initial order.
    //   2. Within each same-GW group (not just same-timestamp), applying a topological sort so
    //      that a row that buys element X is always processed before the row that sells element X,
    //      regardless of their individual timestamps.
    const indexedTransfers = transfers.map((row, origIdx) => ({ row, origIdx }))
    indexedTransfers.sort((a, b) => {
      const gwA = Number(a.row?.event) || 0
      const gwB = Number(b.row?.event) || 0
      if (gwA !== gwB) return gwA - gwB
      const timeCmp = String(a.row?.time || '').localeCompare(String(b.row?.time || ''))
      if (timeCmp !== 0) return timeCmp
      return a.origIdx - b.origIdx // stable tie-break preserves original API order for equal times
    })

    // Apply topological sort within each same-GW group
    const sortedTransfers: FplTransferRow[] = []
    let gi = 0
    while (gi < indexedTransfers.length) {
      const gwKey = Number(indexedTransfers[gi].row?.event) || 0
      let gj = gi + 1
      while (
        gj < indexedTransfers.length &&
        (Number(indexedTransfers[gj].row?.event) || 0) === gwKey
      ) {
        gj++
      }
      sortedTransfers.push(...topoSortSameGwGroup(indexedTransfers.slice(gi, gj)))
      gi = gj
    }

    // Determine the GW when this manager first participated (handles mid-season joiners).
    // Default to 1 if the field is absent or unparseable.
    const startedEvent = Math.max(1, Number(entryData?.started_event) || 1)

    // Seed ownership from the manager's initial squad picks.  For GW-1 joiners we reuse the
    // already-fetched picks; for mid-season joiners we fetch their actual first-GW picks so
    // their initial squad players are correctly provenanced at `startedEvent` rather than 1.
    let initialPicksData: unknown = gw1PicksResult.ok ? gw1PicksResult.data : null
    if (startedEvent > 1) {
      const startedEventPicksResult = await fetchJsonWithRetry(
        `${origin}/api/fpl/entry/${entryId}/event/${startedEvent}/picks`
      )
      initialPicksData = startedEventPicksResult.ok ? startedEventPicksResult.data : null
    }

    const lastBoughtGwByElement = new Map<number, number>()
    const acquisitionGwByElement = new Map<number, number>()
    const acquisitionViaByElement = new Map<number, AcquisitionVia>()
    const unknownOwnedElements = new Set<number>()
    const everBoughtByTransfer = new Set<number>()
    if (initialPicksData) {
      try {
        const initialOwned = picksElementSet(initialPicksData)
        for (const elementId of initialOwned) {
          lastBoughtGwByElement.set(elementId, startedEvent)
          acquisitionGwByElement.set(elementId, startedEvent)
          acquisitionViaByElement.set(elementId, 'initial_squad')
        }
      } catch {
        // Graceful fallback when initial picks are unavailable (e.g., season not started)
      }
    }

    const transfersByGw = new Map<number, FplTransferRow[]>()
    for (const row of sortedTransfers) {
      const gw = Number(row?.event)
      if (!Number.isInteger(gw) || gw <= 0) continue
      if (!transfersByGw.has(gw)) transfersByGw.set(gw, [])
      transfersByGw.get(gw)!.push(row)
    }

    const postGwOwnedByGw = new Map<number, Set<number>>()
    await Promise.all(
      Array.from(transfersByGw.keys()).map(async (gw) => {
        try {
          const picksResult = await fetchJsonWithRetry(
            `${origin}/api/fpl/entry/${entryId}/event/${gw}/picks`
          )
          if (!picksResult.ok) return
          const owned = picksElementSet(picksResult.data)
          postGwOwnedByGw.set(gw, owned)
        } catch {
          // Keep unavailable; we will fall back to transfer replay state.
        }
      })
    )

    const outputRows: ManagerTransferRow[] = []
    const sortedGws = Array.from(transfersByGw.keys()).sort((a, b) => a - b)
    const isCurrentlyOwned = (elementId: number): boolean =>
      lastBoughtGwByElement.has(elementId) || unknownOwnedElements.has(elementId)
    for (const gw of sortedGws) {
      const gwRows = transfersByGw.get(gw) ?? []
      const postGwOwned = postGwOwnedByGw.get(gw)
      let preGwOwned: Set<number> | null = null
      if (postGwOwned) {
        preGwOwned = new Set(postGwOwned)
        // Reverse replay each same-GW transfer against the post-transfer squad snapshot
        // to reconstruct the squad that existed immediately before the GW transfer batch.
        for (let i = gwRows.length - 1; i >= 0; i--) {
          const row = gwRows[i]
          const elementIn = Number(row?.element_in)
          const elementOut = Number(row?.element_out)
          if (Number.isInteger(elementIn) && elementIn > 0) preGwOwned.delete(elementIn)
          if (Number.isInteger(elementOut) && elementOut > 0) preGwOwned.add(elementOut)
        }

        // Align in-memory ownership with reconstructed pre-GW ownership.
        for (const elementId of Array.from(lastBoughtGwByElement.keys())) {
          if (!preGwOwned.has(elementId)) lastBoughtGwByElement.delete(elementId)
        }
        for (const elementId of Array.from(unknownOwnedElements)) {
          if (!preGwOwned.has(elementId)) unknownOwnedElements.delete(elementId)
        }
        for (const elementId of preGwOwned) {
          if (lastBoughtGwByElement.has(elementId) || unknownOwnedElements.has(elementId)) continue
          const inferredAcquiredGw = inferAcquisitionGw(
            elementId,
            startedEvent,
            everBoughtByTransfer,
            acquisitionGwByElement
          )
          if (inferredAcquiredGw !== null) {
            lastBoughtGwByElement.set(elementId, inferredAcquiredGw)
            acquisitionGwByElement.set(elementId, inferredAcquiredGw)
            acquisitionViaByElement.set(
              elementId,
              inferAcquisitionVia(elementId, everBoughtByTransfer, acquisitionViaByElement)
            )
          } else {
            unknownOwnedElements.add(elementId)
            acquisitionViaByElement.set(elementId, 'unknown')
          }
        }
      }

      const transfer_group_id = `${entryId}:${gw}`
      const transfer_group_size = gwRows.length
      // ── Pass 1: build per-row data (group-level fields filled with placeholders) ──
      const gwBaseRows = gwRows
        .map((row, rowIndex) => {
        const gw = Number(row?.event)
        const elementIn = Number(row?.element_in)
        const elementOut = Number(row?.element_out)
        if (!Number.isInteger(gw) || gw <= 0) return null
        if (!Number.isInteger(elementIn) || elementIn <= 0) return null
        if (!Number.isInteger(elementOut) || elementOut <= 0) return null

        const element_out_pre_transfer_owned = isCurrentlyOwned(elementOut)
        const element_in_pre_transfer_owned = isCurrentlyOwned(elementIn)
        const element_in_is_new_ownership = !element_in_pre_transfer_owned
        const priorBuyGw = lastBoughtGwByElement.get(elementOut) ?? null
        // If the player is unexpectedly not owned at sell-time, keep provenance as
        // explicit 'unknown' for analysis/debugging instead of inferring a false source.
        const element_out_acquired_via = element_out_pre_transfer_owned
          ? (acquisitionViaByElement.get(elementOut) ?? 'unknown')
          : 'unknown'
        const element_out_gws_held = priorBuyGw !== null ? gw - priorBuyGw : null
        const chip_played = chipByGw.get(gw) ?? null

        // Derived analysis-confidence fields
        const transfer_context = deriveTransferContext(
          chip_played,
          element_out_gws_held,
          element_out_pre_transfer_owned,
          element_out_acquired_via
        )
        const is_chip_transfer = chip_played !== null
        const is_same_gw_churn = element_out_gws_held === 0
        // Reliable for hold-duration/transfer-behaviour studies when provenance is
        // known (gws_held is not null) AND the transfer was not a temporary FH move.
        const is_reliable_for_hold_analysis = element_out_gws_held !== null && chip_played !== 'FH'

        // Ownership-transition / event-classification fields
        const element_out_exit_reason = deriveExitReason(transfer_context)
        const element_in_entry_reason = deriveEntryReason(transfer_context)
        const ownership_change_scope = deriveOwnershipChangeScope(transfer_context)
        const is_permanent_squad_change = deriveIsPermanentSquadChange(transfer_context)

        const inForm = formStats(elementIn, gw, gwLiveMap)
        const outForm = formStats(elementOut, gw, gwLiveMap)

        const result = {
          season,
          gw,
          entry_id: entryId,
          entry_name,
          player_name,
          time: String(row?.time || ''),
          element_in: elementIn,
          element_out: elementOut,
          purchase_price: Number(row?.element_in_cost) || 0,
          selling_price: Number(row?.element_out_cost) || 0,
          element_in_name: playerNameMap.get(elementIn) || `Player ${elementIn}`,
          chip_played,
          element_out_name: playerNameMap.get(elementOut) || `Player ${elementOut}`,
          element_in_prev_gw_points: gw > 1 ? (gwLiveMap.get(gw - 1)?.get(elementIn) ?? null) : null,
          element_out_prev_gw_points: gw > 1 ? (gwLiveMap.get(gw - 1)?.get(elementOut) ?? null) : null,
          element_out_gws_held,
          element_out_acquired_gw: priorBuyGw,
          element_out_acquired_via,
          element_out_pre_transfer_owned,
          element_in_pre_transfer_owned,
          element_in_is_new_ownership,
          transfer_group_id,
          transfer_group_size,
          transfer_group_index: rowIndex + 1,
          // Group-level analytics — placeholders filled in pass 2 below
          transfer_group_context: transfer_context as TransferGroupContext,
          transfer_group_net_spend: 0,
          transfer_group_has_unknown_provenance: false,
          transfer_group_permanent_change_count: 0,
          element_in_pts_above5_last6: inForm.above5,
          element_out_pts_above5_last6: outForm.above5,
          element_in_avg_pts_last6: inForm.avg,
          element_out_avg_pts_last6: outForm.avg,
          transfer_context,
          is_chip_transfer,
          is_same_gw_churn,
          is_reliable_for_hold_analysis,
          element_out_exit_reason,
          element_in_entry_reason,
          ownership_change_scope,
          is_permanent_squad_change,
        }

          // Update ownership state AFTER reading priorBuyGw.
          lastBoughtGwByElement.delete(elementOut)
          unknownOwnedElements.delete(elementOut)
          lastBoughtGwByElement.set(elementIn, gw)
          acquisitionGwByElement.set(elementIn, gw)
          acquisitionViaByElement.set(elementIn, acquiredViaFromChipCode(chipByGw.get(gw) ?? null))
          everBoughtByTransfer.add(elementIn)
          unknownOwnedElements.delete(elementIn)

        return result
      })
      .filter((row): row is ManagerTransferRow => row !== null)

      // ── Pass 2: compute group-level analytics from the finalised per-row data ──
      const transfer_group_context = deriveTransferGroupContext(
        gwBaseRows.map((r) => r.transfer_context)
      )
      const transfer_group_net_spend = gwBaseRows.reduce(
        (sum, r) => sum + r.purchase_price - r.selling_price, 0
      )
      const transfer_group_has_unknown_provenance = gwBaseRows.some(
        (r) => r.transfer_context === 'unknown_provenance'
      )
      const transfer_group_permanent_change_count = gwBaseRows.filter(
        (r) => r.is_permanent_squad_change
      ).length

      // Merge group-level fields into each row
      const gwOutputRows = gwBaseRows.map((r) => ({
        ...r,
        transfer_group_context,
        transfer_group_net_spend,
        transfer_group_has_unknown_provenance,
        transfer_group_permanent_change_count,
      }))

      outputRows.push(...gwOutputRows)
    }

    return outputRows.sort((a, b) => {
      const gwDelta = a.gw - b.gw
      if (gwDelta !== 0) return gwDelta
      const indexDelta = a.transfer_group_index - b.transfer_group_index
      if (indexDelta !== 0) return indexDelta
      const timeDelta = a.time.localeCompare(b.time)
      if (timeDelta !== 0) return timeDelta
      const outDelta = a.element_out - b.element_out
      if (outDelta !== 0) return outDelta
      return a.element_in - b.element_in
    })
  } catch (error) {
    console.error(`[managerTransfersExport] Failed to fetch manager ${entryId} transfers`, error)
    return []
  }
}
