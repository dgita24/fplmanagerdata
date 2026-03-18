/**
 * Lab: FPL API helpers
 *
 * Thin wrappers around the public FPL API with exponential-backoff retry and
 * optional jitter.  Mirrors the pattern from src/tools/ingest-player-history.ts.
 *
 * Base URL defaults to https://fantasy.premierleague.com/api
 * Override with LAB_FPL_BASE_URL for local proxying.
 */

const BASE_URL =
  process.env['LAB_FPL_BASE_URL'] ?? 'https://fantasy.premierleague.com/api'

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; fplmanagerdata-lab/1.0)',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jitter(ms: number): number {
  return Math.random() * ms
}

async function fetchWithRetry(
  url: string,
  maxAttempts = 4,
  baseDelayMs = 800,
): Promise<Response> {
  let lastError: Error = new Error('fetchWithRetry: no attempts made')

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter(250)
      console.warn(`  ⚠️  Retrying ${url} in ${Math.round(delay)} ms…`)
      await sleep(delay)
    }

    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS })

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelayMs * Math.pow(2, attempt)
        console.warn(`  ⚠️  429 Too Many Requests — waiting ${Math.round(delay)} ms…`)
        await sleep(delay)
        continue
      }

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`)
        if (res.status >= 500) continue
        throw lastError
      }

      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts - 1) continue
    }
  }

  throw lastError
}

// ─── public API ──────────────────────────────────────────────────────────────

export interface BootstrapEvent {
  id:      number
  name:    string
  is_dgw?: boolean
  is_bgw?: boolean
  finished: boolean
}

export interface BootstrapElement {
  id:              number
  web_name:        string
  element_type:    number   // 1=GK, 2=DEF, 3=MID, 4=FWD
  team:            number
  now_cost:        number
  selected_by_percent: string
}

export interface BootstrapData {
  events:   BootstrapEvent[]
  elements: BootstrapElement[]
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  const url = `${BASE_URL}/bootstrap-static/`
  const res = await fetchWithRetry(url)
  return res.json() as Promise<BootstrapData>
}

export interface EntryHistoryGw {
  event:               number
  points:              number
  total_points:        number
  rank:                number
  overall_rank:        number
  bank:                number
  value:               number
  event_transfers:     number
  event_transfers_cost: number
  points_on_bench:     number
}

export interface EntryHistoryChip {
  name:       string
  time:       string
  event:      number
}

export interface EntryHistory {
  current:  EntryHistoryGw[]
  chips:    EntryHistoryChip[]
}

export async function fetchEntryHistory(entryId: number): Promise<EntryHistory> {
  const url = `${BASE_URL}/entry/${entryId}/history/`
  const res = await fetchWithRetry(url)
  const data = await res.json() as { current: EntryHistoryGw[]; chips: EntryHistoryChip[] }
  return data
}

export interface Pick {
  element:        number
  position:       number
  multiplier:     number
  is_captain:     boolean
  is_vice_captain: boolean
  selling_price?: number
  purchase_price?: number
}

export interface EntryGwPicks {
  active_chip: string | null
  picks:       Pick[]
}

export async function fetchEntryGwPicks(
  entryId: number,
  gw: number,
): Promise<EntryGwPicks> {
  const url = `${BASE_URL}/entry/${entryId}/event/${gw}/picks/`
  const res = await fetchWithRetry(url)
  return res.json() as Promise<EntryGwPicks>
}

export interface Transfer {
  element_in:       number
  element_in_cost:  number
  element_out:      number
  element_out_cost: number
  event:            number
  time:             string
}

export async function fetchEntryTransfers(entryId: number): Promise<Transfer[]> {
  const url = `${BASE_URL}/entry/${entryId}/transfers/`
  const res = await fetchWithRetry(url)
  return res.json() as Promise<Transfer[]>
}

/** Polite delay between requests. */
export function politeDelay(ms = 600): Promise<void> {
  return sleep(ms + jitter(200))
}
