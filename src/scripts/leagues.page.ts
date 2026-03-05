import {
  applyAutoSubsAndMultipliers,
  fetchFixtures,
  fetchLiveGW,
  getPlayerLiveComputed,
  getTeamGwStatus,
  type FixtureInfo,
  type LiveStatLine,
  type TeamStatus,
} from '../lib/fplLive.ts';

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

    // Left to Play
    const teamsWithFixture = new Set<number>();
    for (const f of fixturesCache) {
      teamsWithFixture.add(f.team_h);
      teamsWithFixture.add(f.team_a);
    }

    let ltp = finalTeam.reduce((sum, p) => {
      const mult = p.multiplier ?? 0;
      if (mult === 0) return sum;
      if (!teamsWithFixture.has(p.teamId)) return sum;
      if (p.minutes > 0) return sum;
      const { finished, finishedProvisional } = getTeamGwStatusLocal(p.teamId, gw);
      if (finished || finishedProvisional) return sum;
      return sum + mult;
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
          if (gk.minutes > 0) continue;
          const { finished, finishedProvisional } = getTeamGwStatusLocal(gk.teamId, gw);
          if (finished || finishedProvisional) continue;
          if (!teamsWithFixture.has(gk.teamId)) continue;
          ltp += 1;
          break;
        }
      }

      for (const cand of outfieldBench) {
        if (activeOutfield.length >= 10) break;
        if (cand.minutes > 0) continue;
        const { finished, finishedProvisional } = getTeamGwStatusLocal(cand.teamId, gw);
        if (finished || finishedProvisional) continue;
        if (!teamsWithFixture.has(cand.teamId)) continue;

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
            if (b.minutes > 0) return false;
            const { finished: f, finishedProvisional: fp } = getTeamGwStatusLocal(b.teamId, gw);
            return !f && !fp && teamsWithFixture.has(b.teamId);
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

function makeLiveTable(managers: any[], myEntryId: number | null): string {
  const sorted = [...managers].sort((a, b) => b.livePointsBeforeHits - a.livePointsBeforeHits);

  let maxGwPoints = -Infinity;
  for (const m of sorted) {
    if (m.livePoints > maxGwPoints) maxGwPoints = m.livePoints;
  }

  let html = `
    <div class="table-container">
      <div class="table-scroll">
        <table class="leagues-live-table">
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th class="col-manager">Manager</th>
              <th class="col-gw">GW</th>
              <th class="col-hit">Hit</th>
              <th class="col-ltp">LtP</th>
              <th class="col-total">Total</th>
            </tr>
          </thead>
          <tbody>
  `;

  let rank = 1;
  for (const m of sorted) {
    const isTop = m.livePoints === maxGwPoints;
    const isMe = myEntryId !== null && m.entryId === myEntryId;
    const rowClass = [
      isTop ? 'top-scorer-row' : '',
      isMe ? 'row-highlight' : '',
    ].filter(Boolean).join(' ');
    const hitClass = m.transferCost > 0 ? 'hit-highlight' : '';
    const name = escapeHtml(m.managerName || m.teamName || `Entry ${m.entryId}`);
    const chip = m.chipPlayed ? `<span class="badge" style="margin-left:4px;font-size:10px;padding:1px 4px;">${escapeHtml(m.chipPlayed)}</span>` : '';

    html += `
      <tr class="${rowClass}">
        <td class="col-rank">${rank}</td>
        <td class="col-manager" title="${name}">${name}${chip}</td>
        <td class="col-gw">${m.livePointsBeforeHits}</td>
        <td class="col-hit ${hitClass}">${m.transferCost}</td>
        <td class="col-ltp">${m.ltp ?? 0}</td>
        <td class="col-total">${m.totalPoints.toLocaleString()}</td>
      </tr>
    `;
    rank++;
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

let currentEntryId: number | null = null;
let leagues: LeagueInfo[] = [];
let selectedLeague: LeagueInfo | null = null;
let currentPage = 1;
let currentHasNext = false;
let currentHasPrev = false;

// ==============================
// DOM references
// ==============================

const entryInput = document.getElementById('leagues-entry-id') as HTMLInputElement;
const loadBtn = document.getElementById('leagues-load-btn') as HTMLButtonElement;
const loadStatus = document.getElementById('leagues-load-status') as HTMLElement;
const leaguesOutput = document.getElementById('leagues-output') as HTMLElement;
const overallRankEl = document.getElementById('overall-rank-value') as HTMLElement;
const overallLivePtsEl = document.getElementById('overall-live-pts-value') as HTMLElement;
const overallLtpEl = document.getElementById('overall-ltp-value') as HTMLElement;
const leaguesListEl = document.getElementById('leagues-list') as HTMLElement;
const standingsSection = document.getElementById('standings-section') as HTMLElement;
const standingsTitleEl = document.getElementById('standings-title') as HTMLElement;
const standingsSubtitleEl = document.getElementById('standings-subtitle') as HTMLElement;
const standingsStatusEl = document.getElementById('standings-status') as HTMLElement;
const standingsOutputEl = document.getElementById('standings-output') as HTMLElement;
const topBtn = document.getElementById('standings-top-btn') as HTMLButtonElement;
const meBtn = document.getElementById('standings-me-btn') as HTMLButtonElement;
const prevBtn = document.getElementById('standings-prev-btn') as HTMLButtonElement;
const nextBtn = document.getElementById('standings-next-btn') as HTMLButtonElement;

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
  standingsSection.style.display = '';
  standingsTitleEl.textContent = league.name || `League ${league.id}`;
  standingsSubtitleEl.textContent = league.type === 'h2h' ? 'Head-to-Head' : 'Classic';
  standingsOutputEl.innerHTML = '';
  standingsStatusEl.textContent = '';

  // Update "Me" button
  meBtn.disabled = league.entryRank <= 0;

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
      if (live) return live;
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
      };
    });

    const pageInfo = `Page ${currentPage}`;
    standingsSubtitleEl.textContent = `${selectedLeague.type === 'h2h' ? 'Head-to-Head' : 'Classic'} · ${pageInfo} · GW ${gw}`;

    standingsOutputEl.innerHTML = makeLiveTable(managers, currentEntryId);

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

async function loadEntry() {
  const raw = entryInput.value;
  const entryId = parseManagerIdFromInput(raw);

  if (!entryId || !Number.isFinite(entryId)) {
    loadStatus.textContent = 'Please enter a valid Entry ID.';
    return;
  }

  loadBtn.disabled = true;
  loadStatus.textContent = 'Loading...';
  leaguesOutput.style.display = 'none';
  leagues = [];
  selectedLeague = null;
  currentEntryId = entryId;
  currentPage = 1;
  currentHasNext = false;
  currentHasPrev = false;

  // Reset standings section
  standingsSection.style.display = 'none';
  standingsOutputEl.innerHTML = '';
  standingsStatusEl.textContent = '';

  try {
    await fetchBootstrapData();

    const gw = latestGW;
    await ensureLiveCaches(gw);

    const entryRes = await fetch(`/api/fpl/entry/${entryId}`, { cache: 'no-store' });
    if (!entryRes.ok) throw new Error(`Entry fetch failed (${entryRes.status})`);
    const entryData = await entryRes.json();

    // Overall rank
    const overallRank = Number(entryData.summary_overall_rank) || 0;
    overallRankEl.textContent = overallRank > 0 ? overallRank.toLocaleString() : '—';

    // Live GW data for the entry
    loadStatus.textContent = 'Computing live points...';
    const liveResult = await fetchManagerLive(entryId, gw);
    if (liveResult) {
      overallLivePtsEl.textContent = String(liveResult.livePoints);
      overallLtpEl.textContent = String(liveResult.ltp ?? 0);
    } else {
      overallLivePtsEl.textContent = '—';
      overallLtpEl.textContent = '—';
    }

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
    loadStatus.innerHTML = `<span class="text-success font-bold">✅ Loaded ${leagues.length} leagues for GW ${gw}</span>`;

  } catch (e) {
    console.error('loadEntry error', e);
    loadStatus.innerHTML = `<span class="status status--error">Could not load entry data. Check the ID and try again.</span>`;
    currentEntryId = null;
  } finally {
    loadBtn.disabled = false;
  }
}

// ==============================
// Event wiring
// ==============================

loadBtn.addEventListener('click', () => loadEntry());

entryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadEntry();
});

topBtn.addEventListener('click', () => {
  if (!selectedLeague) return;
  loadStandingsPage(1);
});

meBtn.addEventListener('click', () => {
  if (!selectedLeague || selectedLeague.entryRank <= 0) return;
  const myPage = Math.floor((selectedLeague.entryRank - 1) / STANDINGS_PAGE_SIZE) + 1;
  loadStandingsPage(myPage);
});

prevBtn.addEventListener('click', () => {
  if (!currentHasPrev) return;
  loadStandingsPage(currentPage - 1);
});

nextBtn.addEventListener('click', () => {
  if (!currentHasNext) return;
  loadStandingsPage(currentPage + 1);
});
