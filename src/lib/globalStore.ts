import type { LiveStatLine, TeamStatus, FixtureInfo } from './fplLive';

export const globalCache = {
  // Common Data (Players, Teams)
  playerCache: new Map<number, any>(),
  teamCache: new Map<number, any>(),
  bootstrapData: null as any,

  // Page-Specific Caches
  live: {
    managerData: new Map<string, any>(),
    points: new Map<number, LiveStatLine>(),
    projectedBonus: new Map<string, number>(),
    teamStatus: new Map<string, TeamStatus>(),
    fixtures: [] as FixtureInfo[],
  },
  squads: {
    data: new Map<string, any>(), 
    history: new Map<string, any>(), 
  },
  transfers: {
    history: new Map<number, any>(), 
  },
  ownership: {
    squads: new Map<string, any>(), 
  },
  chips: {
    data: new Map<number, any>(), 
  },
  stats: {
    summary: new Map<string, any>(),
    history: new Map<string, any>(),
  }
};

export function clearCache(page: 'live' | 'squads' | 'transfers' | 'ownership' | 'chips' | 'stats' | 'all') {
  if (page === 'all') {
    globalCache.playerCache.clear();
    globalCache.teamCache.clear();
    globalCache.bootstrapData = null;
    clearCache('live');
    clearCache('squads');
    clearCache('transfers');
    clearCache('ownership');
    clearCache('chips');
    clearCache('stats');
    return;
  }

  if (page === 'live') {
    globalCache.live.managerData.clear();
    globalCache.live.points.clear();
    globalCache.live.projectedBonus.clear();
    globalCache.live.teamStatus.clear();
    globalCache.live.fixtures = [];
  }
  if (page === 'squads') globalCache.squads.data.clear();
  if (page === 'transfers') globalCache.transfers.history.clear();
  if (page === 'ownership') globalCache.ownership.squads.clear();
  if (page === 'chips') globalCache.chips.data.clear();
  if (page === 'stats') {
    globalCache.stats.summary.clear();
    globalCache.stats.history.clear();
  }
}
