export interface FixtureInfo {
  id: number;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean;
  finished: boolean;
  finished_provisional: boolean;
}

export interface LiveStatLine {
  points: number;
  bonus: number;
  minutes: number;
  bps?: number;
  goals_scored?: number;
  assists?: number;
  clean_sheets?: number;
  goals_conceded?: number;
  own_goals?: number;
  penalties_saved?: number;
  penalties_missed?: number;
  yellow_cards?: number;
  red_cards?: number;
  saves?: number;
  clearances_blocks_interceptions?: number;
  recoveries?: number;
  tackles?: number;
  defensive_contribution?: number;
}

export interface TeamStatus {
  started: boolean;
  finished: boolean;
  finishedProvisional: boolean;
}

export interface FetchFixturesOptions {
  gw: number;
  fixturesCache: FixtureInfo[];
  projectedBonusCache: Map<string, number>;
  teamStatusCache: Map<string, TeamStatus>;
  includeFinishedProvisional?: boolean;
  cacheBuster?: string;
}

export interface FetchLiveGWOptions {
  gw: number;
  livePointsCache: Map<number, LiveStatLine>;
  includeExtendedStats?: boolean;
  cacheBuster?: string;
}

export interface GetPlayerLiveComputedOptions {
  playerId: number;
  teamId: number;
  gw: number;
  livePointsCache: Map<number, LiveStatLine>;
  projectedBonusCache: Map<string, number>;
  teamStatusCache: Map<string, TeamStatus>;
  bonusConfirmedOnProvisional?: boolean;
  projectedBonusDuringLive?: boolean;
  projectedBonusDuringProvisional?: boolean;
}

export function getTeamGwStatus(
  teamStatusCache: Map<string, TeamStatus>,
  teamId: number,
  gw: number
) {
  return (
    teamStatusCache.get(`${gw}:${teamId}`) || {
      started: false,
      finished: false,
      finishedProvisional: false
    }
  );
}

export function bonusFromBpsRows(bpsRows: any[]): Map<number, number> {
  const rows = (bpsRows || [])
    .filter(r => r && Number.isFinite(r.value) && Number.isFinite(r.element))
    .sort((a, b) => b.value - a.value);

  const out = new Map<number, number>();
  if (rows.length === 0) return out;

  const topVal = rows[0].value;
  const top = rows.filter(r => r.value === topVal);

  if (top.length >= 2) {
    for (const r of top) out.set(r.element, 3);
    if (top.length >= 3) return out;
    const next = rows.find(r => r.value < topVal);
    if (next) {
      const nextVal = next.value;
      for (const r of rows.filter(r => r.value === nextVal)) out.set(r.element, 1);
    }
    return out;
  }

  out.set(rows[0].element, 3);
  const secondRow = rows.find(r => r.value < topVal);
  if (!secondRow) return out;

  const secondVal = secondRow.value;
  const second = rows.filter(r => r.value === secondVal);

  if (second.length >= 2) {
    for (const r of second) out.set(r.element, 2);
    return out;
  }

  out.set(second[0].element, 2);
  const thirdRow = rows.find(r => r.value < secondVal);
  if (!thirdRow) return out;

  const thirdVal = thirdRow.value;
  for (const r of rows.filter(r => r.value === thirdVal)) out.set(r.element, 1);

  return out;
}

export async function fetchFixtures({
  gw,
  fixturesCache,
  projectedBonusCache,
  teamStatusCache,
  includeFinishedProvisional = true,
  cacheBuster
}: FetchFixturesOptions) {
  try {
    const v = cacheBuster || Date.now().toString();
    const res = await fetch(`/api/fpl/fixtures?event=${gw}&v=${v}`, {
      cache: 'no-store'
    });
    if (!res.ok) throw new Error("Failed to fetch fixtures");
    const fixtures: FixtureInfo[] = await res.json();

    fixturesCache.length = 0;
    fixturesCache.push(...fixtures);

    teamStatusCache.clear();
    projectedBonusCache.clear();

    const perTeam = new Map<
      number,
      { startedAny: boolean; finishedAll: boolean; finishedProvAll: boolean }
    >();
    function upsertTeam(
      teamId: number,
      started: boolean,
      finished: boolean,
      finishedProvisional: boolean
    ) {
      const cur =
        perTeam.get(teamId) || {
          startedAny: false,
          finishedAll: true,
          finishedProvAll: true
        };
      cur.startedAny = cur.startedAny || !!started || !!finished || !!finishedProvisional;
      cur.finishedAll = cur.finishedAll && !!finished;
      cur.finishedProvAll = cur.finishedProvAll && (!!finished || !!finishedProvisional);
      perTeam.set(teamId, cur);
    }

    for (const fx of fixtures) {
      const finishedProvisional = includeFinishedProvisional ? fx.finished_provisional : false;

      upsertTeam(fx.team_h, fx.started, fx.finished, finishedProvisional);
      upsertTeam(fx.team_a, fx.started, fx.finished, finishedProvisional);

      if (!fx.started || fx.finished) continue;

      const stats = (fx as any).stats;
      if (!Array.isArray(stats)) continue;

      const bpsStat = stats.find((s: any) => s && s.identifier === "bps");
      if (!bpsStat) continue;

      const h = Array.isArray(bpsStat.h) ? bpsStat.h : [];
      const a = Array.isArray(bpsStat.a) ? bpsStat.a : [];
      const all = [...h, ...a]
        .map(r => ({
          element: Number(r.element),
          value: Number(r.value)
        }))
        .filter(r => Number.isFinite(r.element) && Number.isFinite(r.value));

      const bonusMap = bonusFromBpsRows(all);

      for (const [playerId, bonus] of bonusMap.entries()) {
        const key = `${gw}:${playerId}`;
        projectedBonusCache.set(key, (projectedBonusCache.get(key) || 0) + bonus);
      }
    }

    for (const [teamId, st] of perTeam.entries()) {
      teamStatusCache.set(`${gw}:${teamId}`, {
        started: st.startedAny,
        finished: st.finishedAll,
        finishedProvisional: includeFinishedProvisional ? st.finishedProvAll : false
      });
    }

    return fixtures;
  } catch (e) {
    console.error("Error fetching fixtures:", e);
    return [];
  }
}

export async function fetchLiveGW({
  gw,
  livePointsCache,
  includeExtendedStats = false,
  cacheBuster
}: FetchLiveGWOptions) {
  try {
    const v = cacheBuster || Date.now().toString();
    const res = await fetch(`/api/fpl/event/${gw}/live?v=${v}`, {
      cache: 'no-store'
    });
    if (!res.ok) throw new Error("Failed to fetch live data");
    const data = await res.json();

    livePointsCache.clear();

    const elements = Array.isArray(data.elements) ? data.elements : [];
    for (const p of elements) {
      const stats = p.stats || {};
      livePointsCache.set(p.id, {
        points: Number(stats.total_points) || 0,
        bonus: Number(stats.bonus) || 0,
        minutes: Number(stats.minutes) || 0,
        ...(includeExtendedStats
          ? {
              bps: Number(stats.bps) || 0,
              goals_scored: Number(stats.goals_scored) || 0,
              assists: Number(stats.assists) || 0,
              clean_sheets: Number(stats.clean_sheets) || 0,
              goals_conceded: Number(stats.goals_conceded) || 0,
              own_goals: Number(stats.own_goals) || 0,
              penalties_saved: Number(stats.penalties_saved) || 0,
              penalties_missed: Number(stats.penalties_missed) || 0,
              yellow_cards: Number(stats.yellow_cards) || 0,
              red_cards: Number(stats.red_cards) || 0,
              saves: Number(stats.saves) || 0,
              clearances_blocks_interceptions: Number(stats.clearances_blocks_interceptions) || 0,
              recoveries: Number(stats.recoveries) || 0,
              tackles: Number(stats.tackles) || 0,
              defensive_contribution: Number(stats.defensive_contribution) || 0
            }
          : {})
      });
    }

    return data;
  } catch (e) {
    console.error("Error fetching live data:", e);
    return null;
  }
}

export function getPlayerLiveComputed({
  playerId,
  teamId,
  gw,
  livePointsCache,
  projectedBonusCache,
  teamStatusCache,
  bonusConfirmedOnProvisional = false,
  projectedBonusDuringLive = true,
  projectedBonusDuringProvisional = true
}: GetPlayerLiveComputedOptions) {
  const live = livePointsCache.get(playerId) || {
    points: 0,
    bonus: 0,
    minutes: 0
  };
  const { started, finished, finishedProvisional } = getTeamGwStatus(teamStatusCache, teamId, gw);

  const isFinishedForSubs = finished || finishedProvisional;
  const bonusConfirmed = bonusConfirmedOnProvisional ? (finished || finishedProvisional) : finished;

  const officialTotal = Number(live.points) || 0;
  const confirmedBonus = Number(live.bonus) || 0;
  const minutes = Number(live.minutes) || 0;

  let liveTotal: number;
  let projBonus: number;

  if (bonusConfirmed) {
    liveTotal = officialTotal;
    projBonus = 0;
  } else if (finishedProvisional && projectedBonusDuringProvisional) {
    const basePoints = officialTotal - confirmedBonus;
    projBonus = Number(projectedBonusCache.get(`${gw}:${playerId}`)) || 0;
    liveTotal = basePoints + projBonus;
  } else if (started && projectedBonusDuringLive) {
    const basePoints = officialTotal - confirmedBonus;
    projBonus = Number(projectedBonusCache.get(`${gw}:${playerId}`)) || 0;
    liveTotal = basePoints + projBonus;
  } else if (started || finishedProvisional) {
    liveTotal = officialTotal - confirmedBonus;
    projBonus = 0;
  } else {
    liveTotal = 0;
    projBonus = 0;
  }

  const status = isFinishedForSubs ? "Fin" : started ? "Live" : "NS";
  return { locked: liveTotal - projBonus, projBonus, liveTotal, status, minutes, confirmedBonus };
}

// Returns true if a player is confirmed DNP.
// gwComplete=false (active GW): require status === "Fin" to guard against NS/Live players.
// gwComplete=true (all fixtures done): minutes === 0 is sufficient — status may be stale/missing.
function playerIsDnp(p: any, gwComplete: boolean): boolean {
  return p.minutes === 0 && (gwComplete || p.status === "Fin");
}

export function applyAutoSubsAndMultipliers(teamPicks: any[], chipCode: string, gwComplete = false, autoSubs: any[] = []) {
  const isBB = chipCode === "BB";
  const isTC = chipCode === "TC";
  const capFactor = isTC ? 3 : 2;

  const sorted = [...teamPicks].sort((a, b) => a.position - b.position);
  const starters = sorted.slice(0, 11);
  const bench = sorted.slice(11);

  // Build a set of starters confirmed as DNP by FPL's automatic_subs API.
  // element_out is always a starter (position 1-11) replaced by a bench player,
  // so this set never contains bench players.
  const autoSubsOutSet = new Set(autoSubs.map(s => Number(s.element_out)));

  // Combined DNP check — any one signal is sufficient:
  //   1. FPL's official automatic_subs confirms the player was subbed out (most reliable;
  //      FPL sets this when finalising the game, often before finished_provisional).
  //   2. gwComplete=true (all GW fixtures done): minutes === 0 alone is sufficient —
  //      status may be stale (e.g. blank-GW team, stale teamStatusCache).
  //   3. gwComplete=false (active GW): require status === "Fin" to guard against
  //      NS/Live players whose fixture hasn't finished yet.
  const isDnp = (p: any): boolean =>
    (autoSubsOutSet.size > 0 && autoSubsOutSet.has(p.playerId)) ||
    playerIsDnp(p, gwComplete);

  // SAFETY/FPL RULE ENFORCEMENT:
  // Captain/vice-captain must be from original starting XI.
  const starterCapId = starters.find(p => p.is_captain)?.playerId ?? null;
  const starterVcId = starters.find(p => p.is_vice_captain)?.playerId ?? null;

  // Find the actual starter object (contains minutes + status)
  const starterCap = starterCapId !== null ? starters.find(p => p.playerId === starterCapId) : null;

  // CRITICAL RULE FIX:
  // Vice-captain takes over ONLY when the captain is confirmed "did not play" for the gameweek.
  const captainResolvedDidNotPlay = !!starterCap && isDnp(starterCap);

  // Captain is eligible for capFactor unless they are confirmed DNP.
  // When captain is confirmed DNP, VC immediately inherits captaincy regardless of whether
  // the VC has played yet — this ensures the ×2 multiplier is assigned for LtP and points
  // once the captain is confirmed out, even if the VC's match hasn't started.
  const eligibleCaptainId = captainResolvedDidNotPlay
    ? starterVcId
    : starterCapId;

  if (isBB) {
    // Bench Boost: all 15 score; no autosubs. Captaincy still restricted to XI.
    return sorted.map(p => ({
      ...p,
      multiplier: eligibleCaptainId && p.playerId === eligibleCaptainId ? capFactor : 1,
      autoSubStatus: null
    }));
  }

  const dnpStarters: number[] = [];
  const subbedIn: number[] = [];

  const gkStarter = starters.find(p => p.playingPosition === "GK");
  const outfieldStarters = starters.filter(p => p.playingPosition !== "GK");

  const gkBench = bench.filter(p => p.playingPosition === "GK");
  const outfieldBench = bench.filter(p => p.playingPosition !== "GK");

  let activeGK = gkStarter;
  const gkDnp = gkStarter && isDnp(gkStarter);

  if (gkDnp && gkStarter) {
    dnpStarters.push(gkStarter.playerId);
    const benchGK = gkBench.find(p => !isDnp(p));
    if (benchGK) {
      activeGK = benchGK;
      subbedIn.push(benchGK.playerId);
    } else {
      activeGK = null;
    }
  }

  let activeOutfield = outfieldStarters.filter(p => !isDnp(p));
  const outfieldDnp = outfieldStarters.filter(p => isDnp(p));

  for (const dnp of outfieldDnp) {
    dnpStarters.push(dnp.playerId);
  }

  for (const cand of outfieldBench) {
    if (activeOutfield.length >= 10) break;

    // Break if the bench player's match hasn't started (can't confirm participation order yet).
    // Also break if the match is live but the player has 0 min: we can't confirm DNP yet,
    // so we must not skip this player to use the next bench player.
    // When gwComplete=true, use minutes===0 alone (status may be stale).
    if (gwComplete) {
      if (cand.minutes === 0) continue; // GW done: 0 min = confirmed DNP, skip
    } else {
      if (cand.status === "NS") break;
      if (cand.minutes === 0) {
        if (cand.status !== "Fin") break; // live game, 0 min — can't confirm DNP yet
        continue; // finished, 0 min — confirmed DNP, try next bench player
      }
    }

    const testOutfield = [...activeOutfield, cand];
    const defCount = testOutfield.filter(p => p.playingPosition === "DEF").length;
    const midCount = testOutfield.filter(p => p.playingPosition === "MID").length;
    const fwdCount = testOutfield.filter(p => p.playingPosition === "FWD").length;

    const spotsLeft = 10 - testOutfield.length;

    if (spotsLeft === 0) {
      const isValid = defCount >= 3 && midCount >= 2 && fwdCount >= 1;
      if (isValid) {
        activeOutfield = testOutfield;
        subbedIn.push(cand.playerId);
      }
    } else {
      const needDef = Math.max(0, 3 - defCount);
      const needMid = Math.max(0, 2 - midCount);
      const needFwd = Math.max(0, 1 - fwdCount);

      const remainingIdx = outfieldBench.indexOf(cand);
      let usableBench: any[] = [];
      for (let j = remainingIdx + 1; j < outfieldBench.length; j++) {
        const p = outfieldBench[j];
        if (gwComplete) {
          // GW complete: 0 min = DNP (skip), >0 min = usable
          if (p.minutes > 0) usableBench.push(p);
        } else {
          if (p.status === "NS") break;
          if (p.minutes === 0 && p.status !== "Fin") break; // live, 0 min — can't confirm DNP
          if (p.minutes > 0) usableBench.push(p);
          // Fin + 0 min = confirmed DNP: continue without adding to usable
        }
      }

      const availDef = usableBench.filter(p => p.playingPosition === "DEF").length;
      const availMid = usableBench.filter(p => p.playingPosition === "MID").length;
      const availFwd = usableBench.filter(p => p.playingPosition === "FWD").length;

      const canComplete =
        availDef >= needDef &&
        availMid >= needMid &&
        availFwd >= needFwd;

      if (canComplete) {
        activeOutfield = testOutfield;
        subbedIn.push(cand.playerId);
      }
    }
  }

  const active: any[] = [];
  if (activeGK) active.push(activeGK);
  active.push(...activeOutfield);

  return sorted.map(p => {
    const isActive = active.some(a => a.playerId === p.playerId);
    const isDnpStarter = dnpStarters.includes(p.playerId);
    const isSubbedIn = subbedIn.includes(p.playerId);

    let multiplier = 0;
    if (isActive) {
      multiplier = eligibleCaptainId && p.playerId === eligibleCaptainId ? capFactor : 1;
    }

    return {
      ...p,
      multiplier,
      autoSubStatus: isDnpStarter ? "OUT" : isSubbedIn ? "IN" : null
    };
  });
}