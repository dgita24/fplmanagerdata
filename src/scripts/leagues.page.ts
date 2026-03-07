import {
  applyAutoSubsAndMultipliers,
  computePlayerLtpContribution,
  fetchFixtures,
  fetchLiveGW,
  getPlayerLiveComputed,
  getTeamGwStatus,
  type FixtureInfo,
  type LiveStatLine,
  type TeamStatus,
} from '../lib/fplLive.ts';
import { supabase } from '../lib/supabase.ts';

// ==============================
// Constants
// ==============================

const STANDINGS_PAGE_SIZE = 50;
const MAX_CONCURRENT_REQUESTS = 4;

// ==============================
// Helpers
// ==============================

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function parseManagerIdFromInput(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/\/entry\/(\d+)(?:\/|$)/i);
  if (m?.[1]) return Number(m[1]);
  const n = s.match(/\b(\d{3,})\b/);
  if (n?.[1]) return Number(n[1]);
  return null;
}

function positionLabel(elementType: number): string {
  if (elementType === 1) return 'GK';
  if (elementType === 2) return 'DEF';
  if (elementType === 3) return 'MID';
  return 'FWD';
}

// ==============================
// Caches
// ==============================

interface PlayerInfo { name: string; position: number; team: number; }
interface TeamInfo { name: string; shortName: string; }

let playerCache = new Map<number, PlayerInfo>();
let teamCache = new Map<number, TeamInfo>();
let livePointsCache = new Map<number, LiveStatLine>();
let projectedBonusCache = new Map<string, number>();
let teamStatusCache = new Map<string, TeamStatus>();
let fixturesCache: FixtureInfo[] = [];
let managerPicksCache = new Map<string, any>();

let latestGW = 1;
let bootstrapLoaded = false;

async function fetchBootstrapData() {
  if (bootstrapLoaded) return;
  try {
    const res = await fetch(`/api/fpl/bootstrap-static?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('bootstrap failed');
    const data = await res.json();

    data.elements.forEach((p: any) => {
      playerCache.set(p.id, { name: p.web_name, position: p.element_type, team: p.team });
    });
    data.teams.forEach((t: any) => {
      teamCache.set(t.id, { name: t.name, shortName: t.short_name });
    });

    const activeEvent = data.events.filter((e: any) => new Date(e.deadline_time) < new Date()).pop();
    latestGW = activeEvent ? activeEvent.id : 1;
    bootstrapLoaded = true;
  } catch (e) {
    console.error('Bootstrap fetch failed', e);
  }
}

async function ensureLiveCaches(gw: number) {
  if (fixturesCache.length > 0 && livePointsCache.size > 0) return;
  fixturesCache = [];
  livePointsCache.clear();
  projectedBonusCache.clear();
  teamStatusCache.clear();

  await Promise.all([
    fetchFixtures({ gw, fixturesCache, projectedBonusCache, teamStatusCache, includeFinishedProvisional: true }),
    fetchLiveGW({ gw, livePointsCache, includeExtendedStats: false }),
  ]);
}

// ==============================
// Live computation (mirrors live.page.ts)
// ==============================

function getTeamGwStatusLocal(teamId: number, gw: number) {
  return getTeamGwStatus(teamStatusCache, teamId, gw);
}

function getPlayerLiveComputedLocal(playerId: number, teamId: number, gw: number) {
  return getPlayerLiveComputed({
    playerId, teamId, gw,
    livePointsCache, projectedBonusCache, teamStatusCache,
    bonusConfirmedOnProvisional: false,
  });
}

async function fetchManagerLive(entryId: number, gw: number): Promise<{
  entryId: number;
  managerName: string;
  teamName: string;
  chipPlayed: string;
  transferCost: number;
  livePointsBeforeHits: number;
  livePoints: number;
  ltp: number;
  totalPoints: number;
} | null> {
  try {
    const cacheKey = `${entryId}:${gw}`;
    let rawData = managerPicksCache.get(cacheKey);

    if (!rawData) {
      const [picksRes, summaryRes, historyRes] = await Promise.all([
        fetch(`/api/fpl/entry/${entryId}/event/${gw}/picks`, { cache: 'no-store' }),
        fetch(`/api/fpl/entry/${entryId}`, { cache: 'no-store' }),
        fetch(`/api/fpl/entry/${entryId}/history`, { cache: 'no-store' }),
      ]);
      if (!picksRes.ok || !summaryRes.ok || !historyRes.ok) return null;
      const picksData = await picksRes.json();
      const summaryData = await summaryRes.json();
      const historyData = await historyRes.json();
      rawData = { picksData, summaryData, historyData };
      managerPicksCache.set(cacheKey, rawData);
    }

    const { picksData, summaryData, historyData } = rawData;

    const chipName = (historyData.chips || []).find((c: any) => c.event === gw)?.name || '';
    const chipCode =
      chipName === 'bboost' ? 'BB' :
      chipName === '3xc' ? 'TC' :
      chipName === 'wildcard' ? 'WC' :
      chipName === 'freehit' ? 'FH' : 'None';

    const rawPicks = Array.isArray(picksData.picks) ? picksData.picks : [];
    const rawAutoSubs = Array.isArray((picksData as any).automatic_subs)
      ? (picksData as any).automatic_subs : [];

    const subInIds = new Set<number>(rawAutoSubs.map((s: any) => Number(s.element_in)).filter(Boolean));
    const subOutIds = new Set<number>(rawAutoSubs.map((s: any) => Number(s.element_out)).filter(Boolean));

    const picks = rawPicks.map((p: any) => {
      const player = playerCache.get(p.element) || { name: '', position: 4, team: 0 };
      const teamId = Number(player.team) || 0;
      const computed = getPlayerLiveComputedLocal(p.element, teamId, gw);
      return {
        playerId: Number(p.element),
        position: Number(p.position),
        is_captain: !!(p.is_captain ?? p.iscaptain) || Number(p.multiplier) >= 2,
        is_vice_captain: !!(p.is_vice_captain ?? p.isvicecaptain),
        web_name: player.name || '',
        teamId,
        playingPosition: positionLabel(player.position),
        minutes: computed.minutes,
        status: computed.status,
        lockedPoints: computed.locked,
        projBonus: computed.projBonus,
        liveTotal: computed.liveTotal,
      };
    });

    const computedTeam = applyAutoSubsAndMultipliers(picks, chipCode);

    const finalTeam = computedTeam.map(p => {
      if (p.autoSubStatus === 'IN' || p.autoSubStatus === 'OUT') return p;
      const apiStatus = subOutIds.has(p.playerId) ? 'OUT' : subInIds.has(p.playerId) ? 'IN' : null;
      return { ...p, autoSubStatus: apiStatus };
    });

    const livePointsBeforeHits = finalTeam.reduce(
      (sum, p) => sum + (p.liveTotal * (p.multiplier || 0)), 0
    );

    const historyRows = Array.isArray(historyData.current) ? historyData.current : [];
    const transferCost =
      Number(historyRows.find((h: any) => Number(h.event) === Number(gw))?.event_transfers_cost) || 0;

    const liveNet = livePointsBeforeHits - transferCost;

    // Left to Play (DGW-aware)
    const teamsWithFixture = new Set<number>();
    for (const f of fixturesCache) {
      teamsWithFixture.add(f.team_h);
      teamsWithFixture.add(f.team_a);
    }

    let ltp = finalTeam.reduce((sum, p) => {
      return sum + computePlayerLtpContribution(p.teamId, p.minutes, p.multiplier ?? 0, fixturesCache);
    }, 0);

    // Speculative subs (non-BB only)
    if (chipCode !== 'BB') {
      const ltpSorted = [...finalTeam].sort((a, b) => a.position - b.position);
      const ltpBench = ltpSorted.slice(11);
      let activeOutfield = ltpSorted.filter(p => (p.multiplier ?? 0) > 0 && p.playingPosition !== 'GK');
      const outfieldBench = ltpBench.filter(p => p.playingPosition !== 'GK' && p.autoSubStatus !== 'IN');
      const gkBench = ltpBench.filter(p => p.playingPosition === 'GK');
      const gkActive = ltpSorted.find(p => (p.multiplier ?? 0) > 0 && p.playingPosition === 'GK');
      const gkStarterDnp = ltpSorted.find(p => p.position <= 11 && p.playingPosition === 'GK' && p.autoSubStatus === 'OUT');

      if (gkStarterDnp && !gkActive) {
        for (const gk of gkBench) {
          if (gk.autoSubStatus === 'IN') continue;
          // DGW-aware: bench GK who played in F1 but has F2 upcoming is still eligible.
          if (computePlayerLtpContribution(gk.teamId, gk.minutes, 1, fixturesCache) === 0) continue;
          ltp += 1;
          break;
        }
      }

      for (const cand of outfieldBench) {
        if (activeOutfield.length >= 10) break;
        // DGW-aware: bench player who played in F1 but has F2 upcoming is still eligible.
        if (computePlayerLtpContribution(cand.teamId, cand.minutes, 1, fixturesCache) === 0) continue;

        const testOutfield = [...activeOutfield, cand];
        const defCount = testOutfield.filter(p => p.playingPosition === 'DEF').length;
        const midCount = testOutfield.filter(p => p.playingPosition === 'MID').length;
        const fwdCount = testOutfield.filter(p => p.playingPosition === 'FWD').length;
        const spotsLeft = 10 - testOutfield.length;

        let canSub = false;
        if (spotsLeft === 0) {
          canSub = defCount >= 3 && midCount >= 2 && fwdCount >= 1;
        } else {
          const needDef = Math.max(0, 3 - defCount);
          const needMid = Math.max(0, 2 - midCount);
          const needFwd = Math.max(0, 1 - fwdCount);
          const candidateIndex = outfieldBench.indexOf(cand);
          const remainingCandidates = outfieldBench.slice(candidateIndex + 1).filter(b => {
            return computePlayerLtpContribution(b.teamId, b.minutes, 1, fixturesCache) > 0;
          });
          canSub =
            remainingCandidates.filter(p => p.playingPosition === 'DEF').length >= needDef &&
            remainingCandidates.filter(p => p.playingPosition === 'MID').length >= needMid &&
            remainingCandidates.filter(p => p.playingPosition === 'FWD').length >= needFwd;
        }

        if (canSub) {
          activeOutfield = testOutfield;
          ltp += 1;
        }
      }
    }

    // Total points
    let totalPoints = 0;
    if (Number(gw) === Number(latestGW)) {
      const prevGw = Number(gw) - 1;
      const prevRow = prevGw >= 1 ? historyRows.find((h: any) => Number(h.event) === prevGw) : null;
      const startOverall = Number(prevRow?.total_points) || 0;
      totalPoints = startOverall + liveNet;
    } else {
      const gwRow = historyRows.find((h: any) => Number(h.event) === Number(gw));
      totalPoints = Number(gwRow?.total_points) || 0;
    }

    return {
      entryId,
      managerName: `${summaryData.player_first_name || ''} ${summaryData.player_last_name || ''}`.trim(),
      teamName: summaryData.name || '',
      chipPlayed: chipCode === 'None' ? '' : chipCode,
      transferCost,
      livePointsBeforeHits,
      livePoints: liveNet,
      ltp,
      totalPoints,
    };
  } catch (e) {
    console.error(`fetchManagerLive error for ${entryId}:`, e);
    return null;
  }
}

// ==============================
// Concurrency helper
// ==============================

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R | null>,
  onProgress?: (completed: number, total: number) => void
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let currentIndex = 0;
  let completed = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        results[index] = await fn(items[index]);
      } catch { results[index] = null; }
      completed++;
      if (onProgress) onProgress(completed, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ==============================
// Live table HTML rendering
// ==============================

function makeLiveTable(
  managers: any[],
  myEntryId: number | null,
  rankOffset: number,
  pinnedMe?: { manager: any; leagueRank: number } | null
): string {
  // Sort by live total points descending so the rank column matches the points column
  const sorted = [...managers].sort((a, b) => {
    const diff = b.totalPoints - a.totalPoints;
    if (diff !== 0) return diff;
    // Tie-break: higher live GW points first
    return b.livePoints - a.livePoints;
  });

  let html = `
    <div class="table-container">
      <div class="table-scroll">
        <table class="leagues-live-table">
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th class="col-manager">Manager</th>
              <th class="col-gw">GW</th>
              <th class="col-total">Total</th>
            </tr>
          </thead>
          <tbody>
  `;

  sorted.forEach((m, idx) => {
    const isMe = myEntryId !== null && m.entryId === myEntryId;
    const rowClass = isMe ? 'row-highlight' : '';
    const name = escapeHtml(m.managerName || m.teamName || `Entry ${m.entryId}`);
    const chip = m.chipPlayed ? `<span class="badge" style="margin-left:4px;font-size:10px;padding:1px 4px;">${escapeHtml(m.chipPlayed)}</span>` : '';
    const rankDisplay = rankOffset + idx + 1;

    html += `
      <tr class="${rowClass}"${isMe ? ' id="standings-me-row"' : ''}>
        <td class="col-rank">${rankDisplay}</td>
        <td class="col-manager" title="${name}">${name}${chip}</td>
        <td class="col-gw">${m.livePointsBeforeHits}</td>
        <td class="col-total">${m.totalPoints.toLocaleString()}</td>
      </tr>
    `;
  });

  // Pinned "Me" row — appended when user is not on the current page
  if (pinnedMe) {
    const pm = pinnedMe.manager;
    const name = escapeHtml(pm.managerName || pm.teamName || `Entry ${pm.entryId}`);
    const chip = pm.chipPlayed ? `<span class="badge" style="margin-left:4px;font-size:10px;padding:1px 4px;">${escapeHtml(pm.chipPlayed)}</span>` : '';
    html += `
      <tr class="me-separator-row">
        <td colspan="4" class="me-separator-cell">· · · my position · · ·</td>
      </tr>
      <tr class="row-highlight me-pinned-row" id="standings-me-row">
        <td class="col-rank">${pinnedMe.leagueRank > 0 ? pinnedMe.leagueRank : '—'}</td>
        <td class="col-manager" title="${name}">📍 ${name}${chip}</td>
        <td class="col-gw">${pm.livePointsBeforeHits}</td>
        <td class="col-total">${pm.totalPoints.toLocaleString()}</td>
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;
  return html;
}

// ==============================
// State
// ==============================

interface LeagueInfo {
  id: number;
  name: string;
  type: 'classic' | 'h2h';
  entryRank: number;
}

// ==============================
// localStorage leagues snapshot cache
// ==============================

const LEAGUES_SNAPSHOT_KEY = 'fpl_leagues_snapshot';
const LEAGUES_SNAPSHOT_VERSION = 1;

interface LeaguesSnapshot {
  version: number;
  entryId: number;
  overallRank: number;
  leagues: LeagueInfo[];
  cachedAt: number;
}

function saveLeaguesSnapshot(entryId: number, overallRank: number, leaguesList: LeagueInfo[]): void {
  try {
    const snapshot: LeaguesSnapshot = {
      version: LEAGUES_SNAPSHOT_VERSION,
      entryId,
      overallRank,
      leagues: leaguesList,
      cachedAt: Date.now(),
    };
    localStorage.setItem(LEAGUES_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('Failed to save leagues snapshot:', e);
  }
}

function loadLeaguesSnapshot(entryId: number): LeaguesSnapshot | null {
  try {
    const raw = localStorage.getItem(LEAGUES_SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LeaguesSnapshot>;
    if (
      data.version !== LEAGUES_SNAPSHOT_VERSION ||
      Number(data.entryId) !== entryId ||
      !Array.isArray(data.leagues) ||
      typeof data.overallRank !== 'number' ||
      typeof data.cachedAt !== 'number'
    ) return null;
    return data as LeaguesSnapshot;
  } catch {
    return null;
  }
}

function applyLeaguesSnapshot(snapshot: LeaguesSnapshot): void {
  currentEntryId = snapshot.entryId;
  leagues = snapshot.leagues;
  overallRankEl.textContent = snapshot.overallRank > 0 ? snapshot.overallRank.toLocaleString() : '—';
  renderLeaguesList();
  leaguesOutput.style.display = '';
  loadStatus.innerHTML = `<span class="text-muted">Refreshing data&hellip;</span>`;
  collapseEntryCard(snapshot.entryId);
}

let currentEntryId: number | null = null;
let currentUser: { id: string } | null = null;
let leagues: LeagueInfo[] = [];
let selectedLeague: LeagueInfo | null = null;
let currentPage = 1;
let currentHasNext = false;
let currentHasPrev = false;

// ==============================
// DOM references
// ==============================

// ==============================
// DOM elements — auth state
// ==============================

const leaguesLoadingEl = document.getElementById('leagues-loading') as HTMLElement;
const leaguesRequireLoginEl = document.getElementById('leagues-require-login') as HTMLElement;
const leaguesAuthContentEl = document.getElementById('leagues-auth-content') as HTMLElement;

// ==============================
// DOM elements — page content
// ==============================

const entryIdCard = document.getElementById('entry-id-card') as HTMLElement;
const entryIdCardValueEl = document.getElementById('entry-id-card-value') as HTMLElement;
const entryIdCardExpandBtn = document.getElementById('entry-id-card-expand') as HTMLButtonElement;
const entryInput = document.getElementById('leagues-entry-id') as HTMLInputElement;
const loadBtn = document.getElementById('leagues-load-btn') as HTMLButtonElement;
const loadStatus = document.getElementById('leagues-load-status') as HTMLElement;
const leaguesOutput = document.getElementById('leagues-output') as HTMLElement;
const overallRankEl = document.getElementById('overall-rank-value') as HTMLElement;
const overallLivePtsEl = document.getElementById('overall-live-pts-value') as HTMLElement;
const overallLtpEl = document.getElementById('overall-ltp-value') as HTMLElement;
const leaguesListEl = document.getElementById('leagues-list') as HTMLElement;
const leaguesListCard = document.getElementById('leagues-list-card') as HTMLElement;
const leaguesListSummaryNameEl = document.getElementById('leagues-list-summary-name') as HTMLElement;
const leaguesListExpandBtn = document.getElementById('leagues-list-expand-btn') as HTMLButtonElement;
const standingsSection = document.getElementById('standings-section') as HTMLElement;
const standingsTitleEl = document.getElementById('standings-title') as HTMLElement;
const standingsSubtitleEl = document.getElementById('standings-subtitle') as HTMLElement;
const standingsStatusEl = document.getElementById('standings-status') as HTMLElement;
const standingsOutputEl = document.getElementById('standings-output') as HTMLElement;
const topBtn = document.getElementById('standings-top-btn') as HTMLButtonElement;
const meBtn = document.getElementById('standings-me-btn') as HTMLButtonElement;
const prevBtn = document.getElementById('standings-prev-btn') as HTMLButtonElement;
const nextBtn = document.getElementById('standings-next-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('standings-close-btn') as HTMLButtonElement;

// ==============================
// Close standings panel
// ==============================

function closeStandings() {
  selectedLeague = null;
  standingsSection.style.display = 'none';
  standingsOutputEl.innerHTML = '';
  standingsStatusEl.textContent = '';
  expandLeaguesList(); // restore leagues list when standings close
  renderLeaguesList(); // clear active state
}

// ==============================
// Entry ID card collapse/expand
// ==============================

function collapseEntryCard(entryId: number) {
  entryIdCardValueEl.textContent = String(entryId);
  entryIdCard.classList.add('is-collapsed');
}

function expandEntryCard() {
  entryIdCard.classList.remove('is-collapsed');
}

entryIdCardExpandBtn.addEventListener('click', () => expandEntryCard());

// ==============================
// Leagues list collapse/expand
// ==============================

function collapseLeaguesList(league: LeagueInfo) {
  leaguesListSummaryNameEl.textContent = league.name || `League ${league.id}`;
  leaguesListCard.classList.add('is-collapsed');
}

function expandLeaguesList() {
  leaguesListCard.classList.remove('is-collapsed');
}

leaguesListExpandBtn.addEventListener('click', () => expandLeaguesList());

// ==============================
// Render leagues list
// ==============================

function renderLeaguesList() {
  if (leagues.length === 0) {
    leaguesListEl.innerHTML = `<p class="status status--warning">No leagues found for this entry.</p>`;
    return;
  }

  const sections: Array<{ label: string; type: 'classic' | 'h2h' }> = [
    { label: 'Classic leagues', type: 'classic' },
    { label: 'Head-to-head leagues', type: 'h2h' },
  ];

  let html = '';
  sections.forEach(({ label, type }) => {
    const items = leagues.filter(l => l.type === type);
    if (items.length === 0) return;

    html += `<div class="league-section-title">${escapeHtml(label)}</div>`;
    items.forEach(l => {
      const name = escapeHtml(l.name || `League ${l.id}`);
      const rankText = l.entryRank > 0 ? `Rank #${l.entryRank}` : '';
      const badgeClass = type === 'h2h' ? 'league-item__badge--h2h' : '';
      const isActive = selectedLeague?.id === l.id && selectedLeague?.type === l.type;
      html += `
        <button type="button"
          class="league-item${isActive ? ' is-active' : ''}"
          data-league-id="${l.id}"
          data-league-type="${l.type}"
        >
          <span class="league-item__name">${name}</span>
          ${rankText ? `<span class="league-item__rank">${rankText}</span>` : ''}
          <span class="league-item__badge ${badgeClass}">${type === 'h2h' ? 'H2H' : 'Classic'}</span>
        </button>
      `;
    });
  });

  leaguesListEl.innerHTML = html;

  leaguesListEl.querySelectorAll<HTMLButtonElement>('button.league-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.leagueId);
      const type = btn.dataset.leagueType as 'classic' | 'h2h';
      const league = leagues.find(l => l.id === id && l.type === type);
      if (!league) return;
      // Toggle: clicking the active league closes it
      if (selectedLeague?.id === league.id && selectedLeague?.type === league.type) {
        closeStandings();
        return;
      }
      selectLeague(league);
    });
  });
}

// ==============================
// Select a league + load page 1
// ==============================

function selectLeague(league: LeagueInfo) {
  selectedLeague = league;
  renderLeaguesList(); // re-render to update active state
  collapseLeaguesList(league); // collapse the list to bring standings into view
  standingsSection.style.display = '';
  standingsTitleEl.textContent = league.name || `League ${league.id}`;
  standingsSubtitleEl.textContent = league.type === 'h2h' ? 'Head-to-Head' : 'Classic';
  standingsOutputEl.innerHTML = '';
  standingsStatusEl.textContent = '';

  // Update "Me" button
  meBtn.disabled = league.entryRank <= 0;
  // Reset to "Top" being the active nav button
  meBtn.classList.remove('standings-nav-btn--primary');
  topBtn.classList.add('standings-nav-btn--primary');

  // Scroll to standings section
  standingsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  loadStandingsPage(1);
}

// ==============================
// Load standings page
// ==============================

async function loadStandingsPage(page: number) {
  if (!selectedLeague || !currentEntryId) return;

  standingsStatusEl.textContent = `Loading page ${page}...`;
  standingsOutputEl.innerHTML = '';
  topBtn.disabled = true;
  meBtn.disabled = true;
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    const gw = latestGW;
    await ensureLiveCaches(gw);

    const endpoint = selectedLeague.type === 'h2h'
      ? `/api/fpl/league/${selectedLeague.id}/h2h-standings?page=${page}`
      : `/api/fpl/league/${selectedLeague.id}/standings?page=${page}`;

    const standingsRes = await fetch(endpoint, { cache: 'no-store' });
    if (!standingsRes.ok) throw new Error(`Standings fetch failed (${standingsRes.status})`);

    const standings = await standingsRes.json();
    const rows: Array<{ entryId: number; entryName: string; rank: number }> = standings.results || [];

    if (rows.length === 0) {
      standingsStatusEl.textContent = 'No entries found on this page.';
      return;
    }

    currentPage = Number(standings.page) || page;
    currentHasNext = Boolean(standings.hasNext);
    currentHasPrev = Boolean(standings.hasPrev);

    standingsStatusEl.textContent = `Loading live data for ${rows.length} entries...`;

    const entryIds = rows.map(r => r.entryId);

    const liveResults = await mapWithConcurrency(
      entryIds,
      MAX_CONCURRENT_REQUESTS,
      (id) => fetchManagerLive(id, gw),
      (completed, total) => {
        standingsStatusEl.textContent = `Loading live data... ${completed}/${total}`;
      }
    );

    const liveMap = new Map<number, any>();
    liveResults.forEach((result, i) => {
      if (result) liveMap.set(entryIds[i], result);
    });

    // Build manager list, falling back to standings row info when live fetch failed
    const managers = rows.map(r => {
      const live = liveMap.get(r.entryId);
      if (live) return { ...live, leagueRank: r.rank };
      return {
        entryId: r.entryId,
        managerName: r.entryName || `Entry ${r.entryId}`,
        teamName: r.entryName || `Entry ${r.entryId}`,
        chipPlayed: '',
        transferCost: 0,
        livePointsBeforeHits: 0,
        livePoints: 0,
        ltp: 0,
        totalPoints: 0,
        leagueRank: r.rank,
      };
    });

    // Pinned "Me" row: shown at the bottom when the user is not on this page
    let pinnedMe: { manager: any; leagueRank: number } | null = null;
    const myInPage = currentEntryId !== null && managers.some(m => m.entryId === currentEntryId);
    if (!myInPage && currentEntryId && selectedLeague) {
      const myLive = await fetchManagerLive(currentEntryId, gw);
      if (myLive) {
        pinnedMe = { manager: myLive, leagueRank: selectedLeague.entryRank };
      }
    }

    const pageInfo = `Page ${currentPage}`;
    standingsSubtitleEl.textContent = `${selectedLeague.type === 'h2h' ? 'Head-to-Head' : 'Classic'} · ${pageInfo} · GW ${gw}`;

    standingsOutputEl.innerHTML = makeLiveTable(managers, currentEntryId, (currentPage - 1) * STANDINGS_PAGE_SIZE, pinnedMe);

    standingsStatusEl.innerHTML = `<span class="text-success font-bold">✅ Loaded ${managers.length} entries</span>`;

  } catch (e) {
    console.error('loadStandingsPage error', e);
    standingsStatusEl.innerHTML = `<span class="status status--error">Error loading standings. Please try again.</span>`;
  } finally {
    topBtn.disabled = false;
    meBtn.disabled = !selectedLeague || selectedLeague.entryRank <= 0;
    prevBtn.disabled = !currentHasPrev;
    nextBtn.disabled = !currentHasNext;
  }
}

// ==============================
// Main load entry handler
// ==============================

async function loadEntry(opts: { silentRefresh?: boolean } = {}) {
  const raw = entryInput.value;
  const entryId = parseManagerIdFromInput(raw);

  if (!entryId || !Number.isFinite(entryId)) {
    if (!opts.silentRefresh) loadStatus.textContent = 'Please enter a valid Entry ID.';
    return;
  }

  if (!opts.silentRefresh) {
    loadBtn.disabled = true;
    loadStatus.textContent = 'Loading...';
    leaguesOutput.style.display = 'none';
    leagues = [];
    selectedLeague = null;
    currentPage = 1;
    currentHasNext = false;
    currentHasPrev = false;

    // Reset standings section
    standingsSection.style.display = 'none';
    standingsOutputEl.innerHTML = '';
    standingsStatusEl.textContent = '';
  }

  currentEntryId = entryId;

  try {
    // Phase 1: Fetch entry data and render league list without waiting for live data
    const entryRes = await fetch(`/api/fpl/entry/${entryId}`, { cache: 'no-store' });
    if (!entryRes.ok) throw new Error(`Entry fetch failed (${entryRes.status})`);
    const entryData = await entryRes.json();

    // Overall rank
    const overallRank = Number(entryData.summary_overall_rank) || 0;
    overallRankEl.textContent = overallRank > 0 ? overallRank.toLocaleString() : '—';

    // Build leagues list
    const classicLeagues = Array.isArray(entryData.leagues?.classic) ? entryData.leagues.classic : [];
    const h2hLeagues = Array.isArray(entryData.leagues?.h2h) ? entryData.leagues.h2h : [];

    leagues = [
      ...classicLeagues.map((l: any): LeagueInfo => ({
        id: Number(l.id),
        name: l.name ? String(l.name) : `League ${l.id}`,
        type: 'classic',
        entryRank: Number(l.entry_rank) || 0,
      })),
      ...h2hLeagues.map((l: any): LeagueInfo => ({
        id: Number(l.id),
        name: l.name ? String(l.name) : `League ${l.id}`,
        type: 'h2h',
        entryRank: Number(l.entry_rank) || 0,
      })),
    ].filter(l => Number.isFinite(l.id) && l.id > 0);

    renderLeaguesList();
    leaguesOutput.style.display = '';

    if (!opts.silentRefresh) {
      loadStatus.innerHTML = `<span class="text-success font-bold">✅ Loaded ${leagues.length} leagues</span>`;
      collapseEntryCard(entryId);
    }

    // Persist snapshot to localStorage (non-blocking)
    saveLeaguesSnapshot(entryId, overallRank, leagues);

    // Persist the entry ID to Supabase (non-blocking)
    void saveEntryId(entryId);

    // Phase 2: Bootstrap + live data — runs in background, does not block league list rendering
    void (async () => {
      try {
        await fetchBootstrapData();
        const gw = latestGW;
        await ensureLiveCaches(gw);

        // Only update UI if the user hasn't switched to a different entry
        if (currentEntryId !== entryId) return;

        loadStatus.innerHTML = `<span class="text-success font-bold">✅ Loaded ${leagues.length} leagues for GW ${gw}</span>`;

        const liveResult = await fetchManagerLive(entryId, gw);
        if (currentEntryId !== entryId) return;
        if (liveResult) {
          overallLivePtsEl.textContent = String(liveResult.livePoints);
          overallLtpEl.textContent = String(liveResult.ltp ?? 0);
        } else {
          overallLivePtsEl.textContent = '—';
          overallLtpEl.textContent = '—';
        }
      } catch (e) {
        console.error('Live data refresh error', e);
      }
    })();

  } catch (e) {
    if (!opts.silentRefresh) {
      console.error('loadEntry error', e);
      loadStatus.innerHTML = `<span class="status status--error">Could not load entry data. Check the ID and try again.</span>`;
      currentEntryId = null;
    } else {
      console.error('Background refresh error', e);
    }
  } finally {
    if (!opts.silentRefresh) {
      loadBtn.disabled = false;
    }
  }
}

// ==============================
// Event wiring
// ==============================

loadBtn.addEventListener('click', () => loadEntry());

entryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadEntry();
});

function setMeActive(active: boolean) {
  meBtn.classList.toggle('standings-nav-btn--primary', active);
  topBtn.classList.toggle('standings-nav-btn--primary', !active);
}

topBtn.addEventListener('click', () => {
  if (!selectedLeague) return;
  setMeActive(false);
  loadStandingsPage(1);
});

meBtn.addEventListener('click', () => {
  if (!selectedLeague || selectedLeague.entryRank <= 0) return;
  setMeActive(true);
  // Scroll to the user's row if it is already visible in the current page
  // (either highlighted naturally or as the pinned "Me" row at the bottom)
  const meRow = standingsOutputEl.querySelector<HTMLElement>('#standings-me-row');
  if (meRow) {
    meRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // Fall back to page 1; the pinned "Me" row will be appended since the user
  // is very unlikely to be in the top results on page 1
  loadStandingsPage(1);
});

prevBtn.addEventListener('click', () => {
  if (!currentHasPrev) return;
  setMeActive(false);
  loadStandingsPage(currentPage - 1);
});

nextBtn.addEventListener('click', () => {
  if (!currentHasNext) return;
  setMeActive(false);
  loadStandingsPage(currentPage + 1);
});

closeBtn.addEventListener('click', () => closeStandings());

// ==============================
// Supabase helpers — entry ID persistence
// ==============================

async function saveEntryId(entryId: number): Promise<void> {
  if (!currentUser) return;
  try {
    const { error } = await supabase
      .from('user_profiles')
      .upsert(
        { user_id: currentUser.id, fpl_entry_id: entryId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) console.error('Failed to save entry ID:', error);
  } catch (e) {
    console.error('saveEntryId error:', e);
  }
}

async function loadSavedEntryId(): Promise<number | null> {
  if (!currentUser) return null;
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('fpl_entry_id')
      .eq('user_id', currentUser.id)
      .single();
    if (error || !data) return null;
    const id = Number(data.fpl_entry_id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.error('loadSavedEntryId error:', e);
    return null;
  }
}

// ==============================
// Auth guard — initialise page
// ==============================

async function checkAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  leaguesLoadingEl.style.display = 'none';
  if (user) {
    currentUser = user;
    leaguesAuthContentEl.style.display = 'flex';
    // Restore previously saved entry ID and auto-load
    const savedId = await loadSavedEntryId();
    if (savedId) {
      entryInput.value = String(savedId);
      const snapshot = loadLeaguesSnapshot(savedId);
      if (snapshot) {
        // Render cached data immediately for an instant-feeling restore
        applyLeaguesSnapshot(snapshot);
        // Refresh from FPL in the background without blocking the UI
        void loadEntry({ silentRefresh: true });
      } else {
        await loadEntry();
      }
    }
  } else {
    leaguesRequireLoginEl.style.display = 'block';
  }
}

(async () => { await checkAuth(); })();
