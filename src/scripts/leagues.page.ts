import {
  fetchFixtures,
  fetchLiveGW,
  getPlayerLiveComputed,
  applyAutoSubsAndMultipliers,
  type FixtureInfo,
  type LiveStatLine,
  type TeamStatus,
} from '../lib/fplLive.ts'
import { parseManagerIdFromInput } from '../lib/parseManagerId.ts'

// ==============================
// Types
// ==============================
interface PlayerInfo {
  name: string
  position: number
  team: number
}

interface TeamInfo {
  name: string
  shortName: string
}

interface RawLeague {
  id: number
  name: string
  short_name?: string
  entry_rank?: number
  entry_last_rank?: number
  league_type?: string
  scoring?: string
}

interface LeagueState {
  id: number
  name: string
  type: 'classic' | 'h2h' | 'overall'
  entryRank: number
  currentPage: number
  hasNext: boolean
  hasPrev: boolean
}

interface StandingRow {
  rank: number
  entryId: number
  entryName: string
  playerName?: string | null
  total: number
  eventTotal: number
}

interface LiveStandingRow extends StandingRow {
  liveGwPts: number | null
  projectedTotal: number | null
  isMe: boolean
}

// ==============================
// Constants
// ==============================
const LIVE_CACHES_TTL_MS = 60_000 // 60s: balance between live freshness and API load
const STANDINGS_PAGE_SIZE = 50    // FPL returns 50 entries per standings page
const MAX_CONCURRENT_LIVE_REQUESTS = 4 // limit concurrent picks fetches per standings page

// ==============================
// Global caches (shared across all standings loads)
// ==============================
let latestGW = 1
const playerCache = new Map<number, PlayerInfo>()
const teamCache = new Map<number, TeamInfo>()
const livePointsCache = new Map<number, LiveStatLine>()
const projectedBonusCache = new Map<string, number>()
const teamStatusCache = new Map<string, TeamStatus>()
let fixturesCache: FixtureInfo[] = []
let liveCachesGw: number | null = null
let liveCachesLoadedAt = 0

async function ensureLiveCaches(gw: number, force = false) {
  const now = Date.now()
  const stale = now - liveCachesLoadedAt > LIVE_CACHES_TTL_MS
  const wrongGw = liveCachesGw !== gw
  if (!force && !wrongGw && !stale && livePointsCache.size > 0 && fixturesCache.length > 0) return

  fixturesCache = []
  livePointsCache.clear()
  projectedBonusCache.clear()
  teamStatusCache.clear()

  await Promise.all([
    fetchFixtures({ gw, fixturesCache, projectedBonusCache, teamStatusCache, includeFinishedProvisional: true }),
    fetchLiveGW({ gw, livePointsCache, includeExtendedStats: false }),
  ])
  liveCachesGw = gw
  liveCachesLoadedAt = now
}

async function loadBootstrap() {
  try {
    const res = await fetch(`/api/fpl/bootstrap-static?v=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to fetch bootstrap')
    const data = await res.json()

    data.elements?.forEach((p: any) => {
      playerCache.set(p.id, { name: p.web_name, position: p.element_type, team: p.team })
    })
    data.teams?.forEach((t: any) => {
      teamCache.set(t.id, { name: t.name, shortName: t.short_name })
    })

    const activeEvent = data.events?.filter((e: any) => new Date(e.deadline_time) < new Date()).pop()
    latestGW = activeEvent ? activeEvent.id : 1
  } catch (e) {
    console.error('loadBootstrap error:', e)
  }
}

function positionLabel(elementType: number): string {
  if (elementType === 1) return 'GK'
  if (elementType === 2) return 'DEF'
  if (elementType === 3) return 'MID'
  return 'FWD'
}

// ==============================
// Per-entry live points computation
// ==============================
async function computeEntryLivePoints(
  entryId: number,
  gw: number,
  prevTotal: number
): Promise<{ liveGwNet: number; projectedTotal: number } | null> {
  try {
    const picksRes = await fetch(`/api/fpl/entry/${entryId}/event/${gw}/picks?v=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!picksRes.ok) return null
    const picksData = await picksRes.json()

    const chipName: string = picksData.active_chip ?? ''
    const chipCode =
      chipName === 'bboost' ? 'BB'
      : chipName === '3xc' ? 'TC'
      : chipName === 'wildcard' ? 'WC'
      : chipName === 'freehit' ? 'FH'
      : 'None'

    const rawPicks: any[] = Array.isArray(picksData.picks) ? picksData.picks : []
    const rawAutoSubs: any[] = Array.isArray(picksData.automatic_subs) ? picksData.automatic_subs : []

    const subInIds = new Set<number>(rawAutoSubs.map((s: any) => Number(s.element_in)).filter(Boolean))
    const subOutIds = new Set<number>(rawAutoSubs.map((s: any) => Number(s.element_out)).filter(Boolean))

    const picks = rawPicks.map((p: any) => {
      const player = playerCache.get(p.element) ?? { name: '', position: 4, team: 0 }
      const teamId = Number(player.team) || 0
      const computed = getPlayerLiveComputed({
        playerId: Number(p.element),
        teamId,
        gw,
        livePointsCache,
        projectedBonusCache,
        teamStatusCache,
        bonusConfirmedOnProvisional: false,
      })

      return {
        playerId: Number(p.element),
        position: Number(p.position),
        is_captain: !!(p.is_captain ?? p.iscaptain) || Number(p.multiplier) >= 2,
        is_vice_captain: !!(p.is_vice_captain ?? p.isvicecaptain),
        playingPosition: positionLabel(player.position),
        teamId,
        minutes: computed.minutes,
        status: computed.status,
        liveTotal: computed.liveTotal,
      }
    })

    const computedTeam = applyAutoSubsAndMultipliers(picks, chipCode)
    const finalTeam = computedTeam.map((p) => ({
      ...p,
      autoSubStatus: subOutIds.has(p.playerId) ? 'OUT' : subInIds.has(p.playerId) ? 'IN' : null,
    }))

    const liveGwGross = finalTeam.reduce((sum, p) => sum + p.liveTotal * (p.multiplier || 0), 0)
    const transferCost = Number(picksData.entry_history?.event_transfers_cost) || 0
    const liveGwNet = liveGwGross - transferCost

    return {
      liveGwNet,
      projectedTotal: prevTotal + liveGwNet,
    }
  } catch (e) {
    console.error(`computeEntryLivePoints(${entryId}):`, e)
    return null
  }
}

// ==============================
// Concurrency helper
// ==============================
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R | null>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      try {
        results[i] = await fn(items[i])
      } catch {
        results[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ==============================
// Standings fetching
// ==============================
async function fetchStandingsPage(leagueState: LeagueState, page: number) {
  const url =
    leagueState.type === 'h2h'
      ? `/api/fpl/h2h/${leagueState.id}/standings?page=${page}`
      : `/api/fpl/league/${leagueState.id}/standings?page=${page}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load standings (${res.status})`)
  return res.json() as Promise<{
    league: { id: number; name: string }
    page: number
    hasNext: boolean
    hasPrev: boolean
    results: StandingRow[]
  }>
}

// ==============================
// HTML helpers
// ==============================
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return ch
    }
  })
}

function fmtNum(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString()
}

// ==============================
// Standings rendering
// ==============================
function renderStandingsTable(rows: LiveStandingRow[]): string {
  if (rows.length === 0) return '<div class="standings-loading">No results.</div>'

  const rowsHtml = rows
    .map((r) => {
      const meClass = r.isMe ? ' standings-row--me' : ''
      const liveDisplay = r.liveGwPts !== null ? r.liveGwPts : '—'
      const totalDisplay = r.projectedTotal !== null ? fmtNum(r.projectedTotal) : fmtNum(r.total)
      return `
        <tr class="${meClass}">
          <td class="standings-rank">${r.rank}</td>
          <td class="standings-entry">
            <div class="standings-entry-name">${escapeHtml(r.entryName)}</div>
            ${r.playerName ? `<div class="standings-player-name">${escapeHtml(r.playerName)}</div>` : ''}
          </td>
          <td class="standings-pts standings-pts--live">${liveDisplay}</td>
          <td class="standings-pts standings-pts--total">${totalDisplay}</td>
        </tr>`
    })
    .join('')

  return `
    <div class="standings-table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th class="standings-rank">Rank</th>
            <th>Team / Manager</th>
            <th class="standings-pts">Live GW</th>
            <th class="standings-pts">Proj. Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`
}

function buildPaginationControls(state: LeagueState, meTargetPage: number, entryId: number): string {
  const prevDisabled = !state.hasPrev ? 'disabled' : ''
  const nextDisabled = !state.hasNext ? 'disabled' : ''
  const meDisabled = meTargetPage < 1 ? 'disabled' : ''

  return `
    <div class="standings-controls">
      <button class="btn-page" data-action="top" data-league="${state.id}" data-type="${state.type}">⬆ Top</button>
      <button class="btn-page btn-page--accent" ${meDisabled} data-action="me" data-league="${state.id}" data-type="${state.type}" data-me-page="${meTargetPage}" data-entry="${entryId}">👤 Me</button>
      <button class="btn-page" ${prevDisabled} data-action="prev" data-league="${state.id}" data-type="${state.type}">◀ Prev</button>
      <button class="btn-page" ${nextDisabled} data-action="next" data-league="${state.id}" data-type="${state.type}">Next ▶</button>
      <span class="standings-page-info">Page ${state.currentPage}</span>
    </div>`
}

// ==============================
// Per-league panel state & rendering
// ==============================
const leagueStates = new Map<string, LeagueState>()
let currentEntryId = 0

function leagueKey(id: number, type: string) {
  return `${type}:${id}`
}

async function loadAndRenderStandingsPage(leagueId: number, type: 'classic' | 'h2h', page: number, entryId: number) {
  const key = leagueKey(leagueId, type)
  const panelEl = document.getElementById(`league-panel-${key}`)
  if (!panelEl) return

  panelEl.innerHTML = '<div class="standings-loading">Loading standings…</div>'

  try {
    const state = leagueStates.get(key)
    if (!state) return

    const data = await fetchStandingsPage(state, page)
    state.currentPage = data.page
    state.hasNext = data.hasNext
    state.hasPrev = data.hasPrev

    await ensureLiveCaches(latestGW)

    // Compute live points for each entry concurrently
    const liveRows = await mapWithConcurrency<StandingRow, LiveStandingRow>(
      data.results,
      MAX_CONCURRENT_LIVE_REQUESTS,
      async (row) => {
        const prevTotal = row.total - row.eventTotal
        const live = await computeEntryLivePoints(row.entryId, latestGW, prevTotal)
        return {
          ...row,
          liveGwPts: live ? live.liveGwNet : null,
          projectedTotal: live ? live.projectedTotal : null,
          isMe: row.entryId === entryId,
        }
      }
    )

    const meTargetPage = Math.ceil((state.entryRank || 0) / STANDINGS_PAGE_SIZE)
    const controls = buildPaginationControls(state, meTargetPage, entryId)
    const table = renderStandingsTable(liveRows.filter(Boolean) as LiveStandingRow[])
    panelEl.innerHTML = controls + table

    attachPaginationHandlers(panelEl, entryId)
  } catch (e) {
    console.error(e)
    panelEl.innerHTML = `<div class="standings-error">Failed to load standings. Try again.</div>`
  }
}

function attachPaginationHandlers(container: HTMLElement, entryId: number) {
  container.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action!
      const leagueId = Number(btn.dataset.league)
      const type = btn.dataset.type as 'classic' | 'h2h'
      const key = leagueKey(leagueId, type)
      const state = leagueStates.get(key)
      if (!state) return

      let page = state.currentPage
      if (action === 'top') page = 1
      else if (action === 'next') page = state.currentPage + 1
      else if (action === 'prev') page = state.currentPage - 1
      else if (action === 'me') page = Number(btn.dataset.mePage) || 1

      await loadAndRenderStandingsPage(leagueId, type, page, entryId)
    })
  })
}

// ==============================
// Overall live stats
// ==============================
async function loadOverallLiveStats(entryId: number): Promise<{ liveGwNet: number; projectedTotal: number } | null> {
  try {
    const histRes = await fetch(`/api/fpl/entry/${entryId}/history?v=${Date.now()}`, { cache: 'no-store' })
    if (!histRes.ok) return null
    const histData = await histRes.json()
    const histRows: any[] = Array.isArray(histData.current) ? histData.current : []
    const prevGw = latestGW - 1
    const prevRow = prevGw >= 1 ? histRows.find((h: any) => Number(h.event) === prevGw) : null
    const prevTotal = Number(prevRow?.total_points) || 0

    return computeEntryLivePoints(entryId, latestGW, prevTotal)
  } catch {
    return null
  }
}

// ==============================
// Main rendering
// ==============================
function renderLeagueCard(league: LeagueState, entryId: number): string {
  const key = leagueKey(league.id, league.type)
  const rankLabel = league.entryRank > 0 ? `Rank ${fmtNum(league.entryRank)}` : ''
  return `
    <div class="league-item" id="league-item-${key}" data-league-id="${league.id}" data-league-type="${league.type}" data-entry="${entryId}">
      <div class="league-item-header">
        <span class="league-item-toggle">▶</span>
        <span class="league-item-name">${escapeHtml(league.name)}</span>
        ${rankLabel ? `<span class="league-item-meta">${rankLabel}</span>` : ''}
      </div>
      <div class="league-standings">
        <div id="league-panel-${key}" class="standings-loading">Click to load standings</div>
      </div>
    </div>`
}

function attachLeagueToggle(el: HTMLElement, entryId: number) {
  const header = el.querySelector<HTMLElement>('.league-item-header')
  if (!header) return

  header.addEventListener('click', async () => {
    const isOpen = el.classList.contains('league-item--open')
    el.classList.toggle('league-item--open', !isOpen)

    if (!isOpen) {
      const leagueId = Number(el.dataset.leagueId)
      const type = el.dataset.leagueType as 'classic' | 'h2h'
      const key = leagueKey(leagueId, type)
      const state = leagueStates.get(key)
      if (!state) return

      // Load if panel shows placeholder text
      const panel = document.getElementById(`league-panel-${key}`)
      if (panel && panel.textContent?.trim() === 'Click to load standings') {
        const meTargetPage = Math.ceil((state.entryRank || 0) / STANDINGS_PAGE_SIZE)
        const startPage = meTargetPage > 0 ? meTargetPage : 1
        await loadAndRenderStandingsPage(leagueId, type, startPage, entryId)
      }
    }
  })
}

// ==============================
// Page bootstrap
// ==============================
const entryInput = document.getElementById('leagues-entry-input') as HTMLInputElement
const fetchBtn = document.getElementById('leagues-fetch-btn') as HTMLButtonElement
const statusEl = document.getElementById('leagues-status') as HTMLElement
const outputEl = document.getElementById('leagues-output') as HTMLElement

async function onFetch() {
  const entryId = parseManagerIdFromInput(entryInput.value)
  if (!entryId || !Number.isFinite(entryId)) {
    statusEl.textContent = 'Enter a valid Manager ID or FPL URL.'
    return
  }

  fetchBtn.disabled = true
  statusEl.textContent = 'Loading…'
  outputEl.innerHTML = ''
  currentEntryId = entryId
  leagueStates.clear()

  try {
    // Kick off bootstrap in parallel with entry lookup
    const [entryRes] = await Promise.all([
      fetch(`/api/fpl/entry/${entryId}/?v=${Date.now()}`, { cache: 'no-store' }),
      loadBootstrap(),
    ])

    if (!entryRes.ok) throw new Error(`Entry lookup failed (${entryRes.status})`)
    const entryData = await entryRes.json()

    const managerName = `${entryData.player_first_name ?? ''} ${entryData.player_last_name ?? ''}`.trim()
    const teamName = entryData.name ?? ''

    const rawClassic: RawLeague[] = Array.isArray(entryData.leagues?.classic) ? entryData.leagues.classic : []
    const rawH2h: RawLeague[] = Array.isArray(entryData.leagues?.h2h) ? entryData.leagues.h2h : []

    // Separate overall from other classic leagues
    const overallLeague = rawClassic.find((l) => l.short_name === 'overall' || l.league_type === 's')
    const miniClassic = rawClassic.filter((l) => l.short_name !== 'overall' && l.league_type !== 's')

    // Register league states
    miniClassic.forEach((l) => {
      const key = leagueKey(l.id, 'classic')
      leagueStates.set(key, {
        id: l.id,
        name: l.name,
        type: 'classic',
        entryRank: Number(l.entry_rank) || 0,
        currentPage: 1,
        hasNext: false,
        hasPrev: false,
      })
    })
    rawH2h.forEach((l) => {
      const key = leagueKey(l.id, 'h2h')
      leagueStates.set(key, {
        id: l.id,
        name: l.name,
        type: 'h2h',
        entryRank: Number(l.entry_rank) || 0,
        currentPage: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    // Load overall live stats (async, don't block rendering)
    statusEl.textContent = ''

    // --- Render skeleton ---
    let html = `
      <div class="card">
        <div class="card-body">
          <div class="leagues-entry-info">
            <span class="leagues-entry-name">${escapeHtml(managerName)}</span>
            <span class="leagues-entry-team">${escapeHtml(teamName)}</span>
          </div>
        </div>
      </div>`

    // Overall card placeholder
    if (overallLeague) {
      const officialRank = fmtNum(Number(overallLeague.entry_rank) || 0)
      html += `
        <div class="card" id="overall-card">
          <div class="card-body">
            <div class="card-title card-title--small">🌍 Overall Rank</div>
            <div class="overall-card">
              <div class="overall-stat">
                <div class="overall-stat__label">Official Rank</div>
                <div class="overall-stat__value">${officialRank}</div>
              </div>
              <div class="overall-stat">
                <div class="overall-stat__label">Live GW Pts</div>
                <div class="overall-stat__value overall-stat__value--accent" id="overall-live-gw">…</div>
              </div>
              <div class="overall-stat">
                <div class="overall-stat__label">Proj. Total</div>
                <div class="overall-stat__value" id="overall-proj-total">…</div>
              </div>
            </div>
          </div>
        </div>`
    }

    // Classic leagues
    if (miniClassic.length > 0) {
      html += `
        <div class="card">
          <div class="card-body">
            <div class="leagues-section-title">Classic Leagues (${miniClassic.length})</div>
            ${miniClassic.map((l) => renderLeagueCard(leagueStates.get(leagueKey(l.id, 'classic'))!, entryId)).join('')}
          </div>
        </div>`
    }

    // H2H leagues
    if (rawH2h.length > 0) {
      html += `
        <div class="card">
          <div class="card-body">
            <div class="leagues-section-title">Head-to-Head Leagues (${rawH2h.length})</div>
            ${rawH2h.map((l) => renderLeagueCard(leagueStates.get(leagueKey(l.id, 'h2h'))!, entryId)).join('')}
          </div>
        </div>`
    }

    outputEl.innerHTML = html

    // Attach toggle handlers
    outputEl.querySelectorAll<HTMLElement>('.league-item').forEach((el) => {
      attachLeagueToggle(el, entryId)
    })

    // Populate overall live stats
    if (overallLeague) {
      loadOverallLiveStats(entryId).then((stats) => {
        const liveGwEl = document.getElementById('overall-live-gw')
        const projTotalEl = document.getElementById('overall-proj-total')
        if (liveGwEl) liveGwEl.textContent = stats ? String(stats.liveGwNet) : '—'
        if (projTotalEl) projTotalEl.textContent = stats ? fmtNum(stats.projectedTotal) : '—'
      })
    }
  } catch (e) {
    console.error(e)
    statusEl.textContent = 'Could not load leagues. Please check the ID and try again.'
  } finally {
    fetchBtn.disabled = false
  }
}

fetchBtn.addEventListener('click', onFetch)
entryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') onFetch()
})
