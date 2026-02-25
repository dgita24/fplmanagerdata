/**
 * Client-side bootstrap-static cache module.
 * Fetches `/api/fpl/bootstrap-static` once, caches in-memory and persists
 * to localStorage with a configurable TTL.
 *
 * Usage:
 *   import { getBootstrapData, clearBootstrapCache } from '../lib/fpl/bootstrapCache';
 *   const data = await getBootstrapData(); // uses cache if fresh
 *   clearBootstrapCache();                 // manual refresh
 */

const STORAGE_KEY = 'fpl_bootstrap_cache_v1';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface BootstrapCache {
  data: BootstrapStatic;
  fetchedAt: number; // ms timestamp
}

export interface BootstrapTeam {
  id: number;
  name: string;
  short_name: string;
}

export interface BootstrapElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  element_type: number; // 1=GK, 2=DEF, 3=MID, 4=FWD
  team: number;
  now_cost: number; // cost in tenths of £1m
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  selected_by_percent: string;
  transfers_in: number;
  transfers_out: number;
  transfers_in_event: number;
  transfers_out_event: number;
  event_points: number;
  form: string;
  points_per_game: string;
  value_form: string;
  value_season: string;
  clearances_blocks_interceptions: number;
  recoveries: number;
  tackles: number;
  status: string; // 'a'=available, 'd'=doubtful, 'i'=injured, 's'=suspended, 'u'=unavailable, 'n'=not in squad
  news: string;
  chance_of_playing_next_round: number | null;
}

export interface BootstrapStatic {
  elements: BootstrapElement[];
  teams: BootstrapTeam[];
  element_types: Array<{ id: number; singular_name_short: string; singular_name: string }>;
  events: Array<{ id: number; is_current: boolean; is_next: boolean; finished: boolean }>;
}

// In-memory cache (module-level singleton)
let memCache: BootstrapCache | null = null;

function readFromStorage(): BootstrapCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: BootstrapCache = JSON.parse(raw);
    if (!parsed?.data || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeToStorage(cache: BootstrapCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable or full; ignore
  }
}

function isFresh(cache: BootstrapCache | null, ttlMs = DEFAULT_TTL_MS): boolean {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < ttlMs;
}

/**
 * Fetch bootstrap-static from the API, bypassing all caches.
 */
async function fetchBootstrapFromAPI(): Promise<BootstrapStatic> {
  const res = await fetch('/api/fpl/bootstrap-static', { cache: 'no-store' });
  if (!res.ok) throw new Error(`bootstrap-static fetch failed: ${res.status}`);
  return res.json() as Promise<BootstrapStatic>;
}

/**
 * Get bootstrap-static data. Uses in-memory cache first, then localStorage,
 * then fetches from the API.
 *
 * @param ttlMs  How long (ms) a cached value is considered fresh. Default 6h.
 * @param force  If true, bypasses all caches and forces a network fetch.
 */
export async function getBootstrapData(
  ttlMs = DEFAULT_TTL_MS,
  force = false
): Promise<BootstrapStatic> {
  if (!force) {
    // 1. In-memory
    if (isFresh(memCache, ttlMs)) return memCache!.data;

    // 2. localStorage
    const stored = readFromStorage();
    if (isFresh(stored, ttlMs)) {
      memCache = stored;
      return stored!.data;
    }
  }

  // 3. Network
  const data = await fetchBootstrapFromAPI();
  const entry: BootstrapCache = { data, fetchedAt: Date.now() };
  memCache = entry;
  writeToStorage(entry);
  return data;
}

/**
 * Evict in-memory and localStorage caches so the next call fetches fresh data.
 */
export function clearBootstrapCache(): void {
  memCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns the age of the current cache entry in milliseconds,
 * or null if there is no cached entry.
 */
export function getBootstrapCacheAge(): number | null {
  const cache = memCache ?? readFromStorage();
  if (!cache) return null;
  return Date.now() - cache.fetchedAt;
}

// ------------------------------------------------------------------
// DEFCON (Defensive Contribution points) calculation
// ------------------------------------------------------------------
//
// 2025/26 FPL rule (per match):
//   DEF: +2 DC if CBI(T) >= 10
//   MID/FWD: +2 DC if (CBIT + recoveries) >= 12
//   GK: not eligible
//
// bootstrap-static only provides season-to-date TOTALS, not per-match.
// We therefore compute a PROXY / APPROXIMATION:
//
//   DEF:     proxyDEFCON = 2 × ⌊ clearances_blocks_interceptions / 10 ⌋
//   MID/FWD: proxyDEFCON = 2 × ⌊ (clearances_blocks_interceptions + recoveries) / 12 ⌋
//   GK:      proxyDEFCON = 0
//
// This treats the season totals as if every `threshold` defensive actions
// across the season represents one "qualifying match" for DC purposes.
// It is NOT the official per-match DC points and is clearly labelled as
// an approximation in the UI.
// ------------------------------------------------------------------

export const DEFCON_NOTE = '⚠ Approx. (season-total CBI÷10 or CBIrec÷12, not per-match DC)';

export function computeProxyDEFCON(el: BootstrapElement): number {
  const pos = el.element_type;
  if (pos === 1) return 0; // GK not eligible

  const cbi = el.clearances_blocks_interceptions ?? 0;

  if (pos === 2) {
    // DEF: floor(CBI / 10) * 2
    return Math.floor(cbi / 10) * 2;
  }

  // MID / FWD: floor((CBI + recoveries) / 12) * 2
  const rec = el.recoveries ?? 0;
  return Math.floor((cbi + rec) / 12) * 2;
}
