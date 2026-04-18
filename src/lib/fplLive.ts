export interface FixtureInfo {
  id: number;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean;
  finished: boolean;
  finished_provisional: boolean;
  kickoff_time?: string;
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
      // IMPORTANT:
      // Keep official `finished` separate from `finished_provisional`.
      // During the FT -> bonus-confirmed window we still want projected bonus
      // to count, so only true official finished fixtures should set finishedAll......adding this to force deploy on cloudflare
      cur.finishedAll = cur.finishedAll && !!finished;
      cur.finishedProvAll = cur.finishedProvAll && (!!finished || !!finishedProvisional);
      perTeam.set(teamId, cur);
    }

    for (const fx of fixtures) {
      const finishedProvisional = includeFinishedProvisional ? fx.finished_provisional : false;

      upsertTeam(fx.team_h, fx.started, fx.finished, finishedProvisional);
      upsertTeam(fx.team_a, fx.started, fx.finished, finishedProvisional);

      if (!fx.started) continue;

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

  const { started, finished, finishedProvisional } = getTeamGwStatus(
    teamStatusCache,
    teamId,
    gw
  );

  const isFinishedForSubs = finished || finishedProvisional;

  // "Bonus confirmed" means: trust FPL's total_points as final (includes confirmed bonus).
  const bonusConfirmed = bonusConfirmedOnProvisional
    ? (finished || finishedProvisional)
    : finished;

  const officialTotal = Number(live.points) || 0;
  const confirmedBonus = Number(live.bonus) || 0;
  const minutes = Number(live.minutes) || 0;

  const projBonus = Number(projectedBonusCache.get(`${gw}:${playerId}`)) || 0;

  let liveTotal: number;
  let projBonusUsed: number;

  const isInScopeForLivePoints = started || finishedProvisional;

  const shouldUseProjectedBonus =
    !bonusConfirmed &&
    (
      (finishedProvisional && projectedBonusDuringProvisional) ||
      (!finishedProvisional && started && projectedBonusDuringLive)
    );

  if (bonusConfirmed) {
    if (confirmedBonus === 0 && projBonus > 0) {
      // Race condition: FPL set finished=true but hasn't updated total_points with bonus yet.
      // Fall back to projected bonus from BPS data.
      liveTotal = officialTotal + projBonus;
      projBonusUsed = projBonus;
    } else {
      // Once confirmed, use official total as-is.
      liveTotal = officialTotal;
      projBonusUsed = 0;
    }
  } else if (shouldUseProjectedBonus) {
    // Before confirmation, replace any embedded/partial bonus with projected bonus.
    liveTotal = officialTotal - confirmedBonus + projBonus;
    projBonusUsed = projBonus;
  } else if (isInScopeForLivePoints) {
    // Live/provisional but projection disabled for this phase: show points excluding bonus.
    liveTotal = officialTotal - confirmedBonus;
    projBonusUsed = 0;
  } else {
    // Not started
    liveTotal = 0;
    projBonusUsed = 0;
  }

  const status = isFinishedForSubs ? "Fin" : started ? "Live" : "NS";

  return {
    locked: liveTotal - projBonusUsed,
    projBonus: projBonusUsed,
    liveTotal,
    status,
    minutes,
    confirmedBonus
  };
}


export function applyAutoSubsAndMultipliers(teamPicks: any[], chipCode: string) {
  const isBB = chipCode === "BB";
  const isTC = chipCode === "TC";
  const capFactor = isTC ? 3 : 2;

  const sorted = [...(teamPicks ?? [])].sort((a, b) => a.position - b.position);
  const starters = sorted.slice(0, 11);
  const bench = sorted.slice(11);

  // Captain / VC MUST be from original starting XI (positions 1-11)
  const starterCapId = starters.find(p => !!p.is_captain)?.playerId ?? null;
  const starterVcId = starters.find(p => !!p.is_vice_captain)?.playerId ?? null;

  const starterCap =
    starterCapId !== null ? starters.find(p => p.playerId === starterCapId) : null;

  // VC takeover ONLY when captain is confirmed DNP (finished + 0 minutes)
  const captainResolvedDidNotPlay =
    !!starterCap && starterCap.status === "Fin" && starterCap.minutes === 0;

  // If VC is missing for any reason, do NOT switch away from captain
  const eligibleCaptainId = captainResolvedDidNotPlay
    ? (starterVcId ?? starterCapId)
    : starterCapId;

  if (isBB) {
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
  const gkDnp = gkStarter && gkStarter.minutes === 0 && gkStarter.status === "Fin";

  if (gkDnp && gkStarter) {
    dnpStarters.push(gkStarter.playerId);
    const benchGK = gkBench.find(p => !(p.minutes === 0 && p.status === "Fin"));
    if (benchGK) {
      activeGK = benchGK;
      subbedIn.push(benchGK.playerId);
    } else {
      activeGK = null;
    }
  }

  let activeOutfield = outfieldStarters.filter(p => !(p.minutes === 0 && p.status === "Fin"));
  const outfieldDnp = outfieldStarters.filter(p => p.minutes === 0 && p.status === "Fin");

  for (const dnp of outfieldDnp) dnpStarters.push(dnp.playerId);

  for (const cand of outfieldBench) {
    if (activeOutfield.length >= 10) break;

    if (cand.status === "NS") break;
    if (cand.minutes === 0) {
      if (cand.status !== "Fin") break;
      continue;
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
      const usableBench: any[] = [];

      for (let j = remainingIdx + 1; j < outfieldBench.length; j++) {
        const p = outfieldBench[j];
        if (p.status === "NS") break;
        if (p.minutes === 0 && p.status !== "Fin") break;
        if (p.minutes > 0) usableBench.push(p);
      }

      const availDef = usableBench.filter(p => p.playingPosition === "DEF").length;
      const availMid = usableBench.filter(p => p.playingPosition === "MID").length;
      const availFwd = usableBench.filter(p => p.playingPosition === "FWD").length;

      const canComplete = availDef >= needDef && availMid >= needMid && availFwd >= needFwd;

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

/**
 * Computes the speculative LtP auto-sub adjustment for a manager's team.
 *
 * For each starting slot that is guaranteed to be unfilled — either a confirmed
 * DNP (fixture finished with 0 minutes) or a blank-GW starter (team has no
 * fixture in fixturesCache) — the next eligible bench player is counted
 * speculatively (+1 to LtP) provided their team has a fixture yet to play.
 *
 * Formation constraints (min 3 DEF, 2 MID, 1 FWD) are respected and bench
 * order is honoured.  Bench Boost (BB) has no auto-subs so returns 0.
 *
 * This function is the single source of truth for speculative-sub LtP and is
 * used by both the Live page and the Leagues page so that both surfaces always
 * show consistent values.
 *
 * @param finalTeam   - Picks array after applyAutoSubsAndMultipliers; each
 *                      entry must have: position, multiplier, autoSubStatus,
 *                      playingPosition, teamId, minutes.
 *                      availabilityStatus (optional) – players with value "s"
 *                      (suspended) are skipped.
 *                      chanceOfPlayingThisRound (optional) – FPL percentage
 *                      (0-100 or null); value of 0 with minutes===0 is treated
 *                      as soft non-play (automatic fallback: ignored if player
 *                      later registers minutes > 0).
 * @param chipCode    - Active chip ("BB", "TC", "WC", "FH", or "None").
 * @param fixturesCache - GW fixtures (used to detect blank-GW teams).
 * @returns The number of speculative subs to add to the base LtP sum.
 */
export function computeSpeculativeLtpSubs(
  finalTeam: any[],
  chipCode: string,
  fixturesCache: FixtureInfo[]
): number {
  // Bench Boost: all 15 players active, no auto-subs apply.
  if (chipCode === 'BB') return 0;

  const ltpSorted = [...finalTeam].sort((a, b) => a.position - b.position);
  const ltpBench = ltpSorted.slice(11);

  // Helper: does the team have any fixture in the current GW?
  const hasFixture = (teamId: number): boolean =>
    fixturesCache.some(f => f.team_h === teamId || f.team_a === teamId);

  // Helper: is a starter speculatively non-playing?
  // Hard condition: team has no fixture this GW (blank GW → guaranteed non-playing).
  // Soft condition: 0% chance-of-playing metadata with automatic fallback —
  //   if the player later registers minutes > 0 the condition is no longer met
  //   and the speculation is automatically withdrawn on the next poll.
  const isSpeculativeNonPlaying = (p: any): boolean => {
    if (!hasFixture(p.teamId)) return true;
    return p.chanceOfPlayingThisRound === 0 && (p.minutes ?? 0) === 0;
  };

  // Active outfield: starters / confirmed subs with multiplier > 0 who are
  // expected to play.  Blank-GW and 0%-chance starters are excluded.
  let activeOutfield = ltpSorted.filter(p =>
    (p.multiplier ?? 0) > 0 &&
    p.playingPosition !== 'GK' &&
    !isSpeculativeNonPlaying(p)
  );

  const outfieldBench = ltpBench.filter(
    p => p.playingPosition !== 'GK' && p.autoSubStatus !== 'IN'
  );
  const gkBench = ltpBench.filter(p => p.playingPosition === 'GK');

  // A GK slot is considered "active" only when the GK is expected to play.
  const gkActive = ltpSorted.find(
    p => (p.multiplier ?? 0) > 0 && p.playingPosition === 'GK' && !isSpeculativeNonPlaying(p)
  );

  // A GK starter slot is DNP when:
  //   (a) confirmed DNP via autoSubStatus === 'OUT' (fixture finished, 0 min),
  //   (b) team has no fixture this GW (blank GW → guaranteed non-playing), or
  //   (c) 0% chance-of-playing with minutes === 0 (soft non-play with fallback).
  const gkStarterDnp = ltpSorted.find(
    p =>
      p.position <= 11 &&
      p.playingPosition === 'GK' &&
      (p.autoSubStatus === 'OUT' || isSpeculativeNonPlaying(p))
  );

  let adjustment = 0;

  // Speculative GK sub: blank-GW or confirmed-DNP GK starter with no active replacement.
  if (gkStarterDnp && !gkActive) {
    for (const gk of gkBench) {
      if (gk.autoSubStatus === 'IN') continue;
      if (gk.availabilityStatus === 's') continue;
      if (computePlayerLtpContribution(gk.teamId, gk.minutes, 1, fixturesCache) === 0) continue;
      adjustment += 1;
      break;
    }
  }

  // Speculative outfield subs: for each empty outfield slot, find the next
  // eligible bench player (bench order, formation-valid).
  for (const cand of outfieldBench) {
    if (activeOutfield.length >= 10) break;
    if (cand.availabilityStatus === 's') continue;
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
        if (b.availabilityStatus === 's') return false;
        return computePlayerLtpContribution(b.teamId, b.minutes, 1, fixturesCache) > 0;
      });
      canSub =
        remainingCandidates.filter(p => p.playingPosition === 'DEF').length >= needDef &&
        remainingCandidates.filter(p => p.playingPosition === 'MID').length >= needMid &&
        remainingCandidates.filter(p => p.playingPosition === 'FWD').length >= needFwd;
    }

    if (canSub) {
      activeOutfield = testOutfield;
      adjustment += 1;
    }
  }

  return adjustment;
}

/**
 * Computes the speculative points adjustment for blank-GW and 0%-chance
 * non-playing starters, adding each eligible bench replacement's current
 * liveTotal to the team's projected/live score.
 *
 * This mirrors the logic of computeSpeculativeLtpSubs but returns the sum of
 * bench players' live point totals rather than a count.  Apply the result to
 * livePointsBeforeHits so that the displayed GW score reflects bench players
 * who are guaranteed to replace non-playing starters.
 *
 * Speculative non-play conditions (same as computeSpeculativeLtpSubs):
 *   Hard: starter's team has no fixture this GW (blank GW).
 *   Soft: chanceOfPlayingThisRound === 0 AND minutes === 0 (automatic fallback:
 *         if the player later registers any minutes the condition is no longer
 *         met and the speculation is withdrawn on the next data poll).
 *
 * Formation constraints and bench order are respected.  Bench Boost returns 0.
 *
 * @param finalTeam   - Picks after applyAutoSubsAndMultipliers; each entry must
 *                      have: position, multiplier, autoSubStatus, playingPosition,
 *                      teamId, minutes, liveTotal.
 *                      chanceOfPlayingThisRound (optional, number|null).
 *                      availabilityStatus (optional) – "s" = suspended, skip.
 * @param chipCode    - Active chip ("BB", "TC", "WC", "FH", or "None").
 * @param fixturesCache - GW fixtures array.
 * @returns Points adjustment to add to livePointsBeforeHits.
 */
export function computeSpeculativePointsAdjustment(
  finalTeam: any[],
  chipCode: string,
  fixturesCache: FixtureInfo[]
): number {
  // Bench Boost: all 15 players contribute, no auto-subs possible.
  if (chipCode === 'BB') return 0;

  const sorted = [...finalTeam].sort((a, b) => a.position - b.position);
  const bench = sorted.slice(11);

  const hasFixture = (teamId: number): boolean =>
    fixturesCache.some(f => f.team_h === teamId || f.team_a === teamId);

  // Speculative non-play: hard (blank GW) or soft (0% chance, minutes still 0).
  const isSpeculativeNonPlaying = (p: any): boolean => {
    if (!hasFixture(p.teamId)) return true;
    return p.chanceOfPlayingThisRound === 0 && (p.minutes ?? 0) === 0;
  };

  // Active outfield contributors (starters / confirmed subs who are expected to play).
  let activeOutfield = sorted.filter(p =>
    (p.multiplier ?? 0) > 0 &&
    p.playingPosition !== 'GK' &&
    !isSpeculativeNonPlaying(p)
  );

  const outfieldBench = bench.filter(
    p => p.playingPosition !== 'GK' && p.autoSubStatus !== 'IN'
  );
  const gkBench = bench.filter(p => p.playingPosition === 'GK');

  const gkActive = sorted.find(
    p => (p.multiplier ?? 0) > 0 && p.playingPosition === 'GK' && !isSpeculativeNonPlaying(p)
  );

  const gkStarterDnp = sorted.find(
    p =>
      p.position <= 11 &&
      p.playingPosition === 'GK' &&
      (p.autoSubStatus === 'OUT' || isSpeculativeNonPlaying(p))
  );

  let adjustment = 0;

  // Speculative GK sub: add the bench GK's liveTotal when the GK slot is vacated.
  if (gkStarterDnp && !gkActive) {
    for (const gk of gkBench) {
      if (gk.autoSubStatus === 'IN') continue;
      if (gk.availabilityStatus === 's') continue;
      // Bench GK must have a fixture in this GW to be eligible.
      if (!hasFixture(gk.teamId)) continue;
      adjustment += (gk.liveTotal ?? 0);
      break;
    }
  }

  // Speculative outfield subs: add each eligible bench player's liveTotal.
  for (const cand of outfieldBench) {
    if (activeOutfield.length >= 10) break;
    if (cand.availabilityStatus === 's') continue;
    // Bench player must have a fixture to be eligible for speculative sub.
    if (!hasFixture(cand.teamId)) continue;

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
        if (b.availabilityStatus === 's') return false;
        return hasFixture(b.teamId);
      });
      canSub =
        remainingCandidates.filter(p => p.playingPosition === 'DEF').length >= needDef &&
        remainingCandidates.filter(p => p.playingPosition === 'MID').length >= needMid &&
        remainingCandidates.filter(p => p.playingPosition === 'FWD').length >= needFwd;
    }

    if (canSub) {
      activeOutfield = testOutfield;
      adjustment += (cand.liveTotal ?? 0);
    }
  }

  return adjustment;
}

/**
 * Computes a player's Left-to-Play (LtP) contribution for the current GW,
 * correctly handling Double Gameweeks (DGWs) by evaluating each fixture
 * individually rather than relying on aggregate team status.
 *
 * Rules (preserving existing single-GW behaviour):
 * - Players with multiplier === 0 (benched / subbed out) never contribute.
 * - Players whose team has no fixture this GW return 0.
 * - Finished/provisional fixtures do not contribute to LtP.
 * - Not-yet-started fixtures always contribute `multiplier` to LtP.
 * - Live fixtures: estimate whether the player has played in this specific
 *   fixture by subtracting minutes attributed to earlier finished fixtures
 *   (120 per finished fixture to cover extra time). If estimated minutes
 *   in the live fixture are 0 the player is still "left to play" and
 *   contributes `multiplier`; if > 0 they are already playing and do not.
 *
 * DGW example: F1 finished (player had 90 min), F2 not started →
 *   minutesAttributed = 120 after F1; F2 not started → ltp += multiplier.
 *   Result: multiplier (player still has one fixture left to play).
 */
export function computePlayerLtpContribution(
  teamId: number,
  playerMinutes: number,
  multiplier: number,
  fixturesCache: FixtureInfo[]
): number {
  if (multiplier === 0) return 0;

  // Filter to this team's fixtures and sort by id (chronological within GW).
  const teamFixtures = fixturesCache
  .filter(f => f.team_h === teamId || f.team_a === teamId)
  .sort((a, b) => {
    const aTime = a.kickoff_time ? new Date(a.kickoff_time).getTime() : 0;
    const bTime = b.kickoff_time ? new Date(b.kickoff_time).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });

  if (teamFixtures.length === 0) return 0;

  let ltp = 0;
  // Track minutes "attributed" to completed fixtures so we can estimate
  // whether the player has already appeared in a subsequent live fixture.
  // 120 covers standard time plus extra time in knockout scenarios.
  let minutesAttributed = 0;

  for (const fx of teamFixtures) {
    if (fx.finished || fx.finished_provisional) {
      // Fixture is over – no LtP contribution; account for potential minutes.
      minutesAttributed += 120;
      continue;
    }

    if (!fx.started) {
      // Fixture has not kicked off – player cannot have played here yet.
      ltp += multiplier;
      continue;
    }

    // Live fixture: estimate the player's minutes in this specific match.
    const minutesInThisFixture = Math.max(0, playerMinutes - minutesAttributed);
    if (minutesInThisFixture === 0) {
      // Player has not appeared in this live fixture yet → still left to play.
      ltp += multiplier;
    }
    // If minutesInThisFixture > 0 the player is already playing → no LtP.
  }

  return ltp;
}
