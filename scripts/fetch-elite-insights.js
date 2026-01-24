import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (i === retries - 1) throw new Error(`Failed to fetch: ${url}`);
        await delay(1000 * (i + 1));
        continue;
      }
      return await res.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
}

async function getCurrentGW() {
  console.log('Checking current gameweek...');
  const data = await fetchWithRetry('https://fantasy.premierleague.com/api/bootstrap-static/');
  
  // Find events where finished === true AND deadline has passed
  const now = new Date();
  const completedEvents = data.events.filter(e => {
    const deadlinePassed = new Date(e.deadline_time) < now;
    return e.finished === true && deadlinePassed;
  });
  
  if (completedEvents.length === 0) {
    console.log('No gameweeks have been fully completed yet.');
    return null;
  }
  
  const lastCompletedGW = Math.max(...completedEvents.map(e => e.id));
  console.log(`Last completed gameweek: ${lastCompletedGW}`);
  
  return { lastFinishedGW: lastCompletedGW, allPlayers: data.elements };
}

async function checkIfDataExists(gameweek) {
  console.log(`Checking if data exists for GW ${gameweek}...`);
  
  const { data, error } = await supabase
    .from('top_50_aggregates')
    .select('gameweek')
    .eq('gameweek', gameweek)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Error checking data:', error);
    return false;
  }
  
  return data !== null;
}

async function fetchBootstrapData() {
  console.log('Fetching bootstrap data...');
  const data = await fetchWithRetry('https://fantasy.premierleague.com/api/bootstrap-static/');
  return data;
}

async function fetchManagerInsights(managerId, targetGW, allPlayers) {
  console.log(`Fetching manager ${managerId}...`);
  
  const summaryRes = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${managerId}/`);
  const historyRes = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${managerId}/history/`);
  
  const managerName = `${summaryRes.player_first_name} ${summaryRes.player_last_name}`;
  
  const pointsBreakdown = {
    goals: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
    assists: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
    cleanSheets: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
    bonus: 0,
    other: 0,
  };
  
  const formations = {};
  let totalTransfers = 0;
  let hitsCount = 0;
  let hitsCost = 0;
  
  // Process each gameweek up to the target GW
  for (let gw = 1; gw <= targetGW; gw++) {
    try {
      const picksData = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${gw}/picks/`);
      await delay(100);
      
      const picks = picksData.picks.filter(p => p.position <= 11);
      
      // Calculate formation
      let defCount = 0, midCount = 0, fwdCount = 0;
      
      for (const pick of picks) {
        const player = allPlayers.find(p => p.id === pick.element);
        if (!player) continue;
        
        if (player.element_type === 2) defCount++;
        else if (player.element_type === 3) midCount++;
        else if (player.element_type === 4) fwdCount++;
        
        const position = player.element_type === 1 ? 'GK' :
                        player.element_type === 2 ? 'DEF' :
                        player.element_type === 3 ? 'MID' : 'FWD';
        
        // Fetch player's GW stats
        try {
          const playerData = await fetchWithRetry(`https://fantasy.premierleague.com/api/element-summary/${pick.element}/`);
          const gwHistory = playerData.history.find(h => h.round === gw);
          
          if (gwHistory) {
            const multiplier = pick.is_captain ? (pick.multiplier || 2) : 1;
            
            pointsBreakdown.goals[position] += (gwHistory.goals_scored || 0) * multiplier;
            pointsBreakdown.assists[position] += (gwHistory.assists || 0) * multiplier;
            pointsBreakdown.cleanSheets[position] += (gwHistory.clean_sheets || 0) * multiplier;
            pointsBreakdown.bonus += (gwHistory.bonus || 0) * multiplier;
          }
          
          await delay(100);
        } catch (e) {
          console.error(`Error fetching player ${pick.element}:`, e);
        }
      }
      
      const formation = `${defCount}-${midCount}-${fwdCount}`;
      formations[formation] = (formations[formation] || 0) + 1;
      
    } catch (e) {
      console.error(`Error processing GW ${gw} for manager ${managerId}:`, e);
    }
  }
  
  // Calculate transfers and hits
  if (historyRes.current) {
    for (const gwHistory of historyRes.current) {
      if (gwHistory.event > targetGW) break; // Only count up to target GW
      
      totalTransfers += gwHistory.event_transfers || 0;
      const cost = gwHistory.event_transfers_cost || 0;
      if (cost > 0) {
        hitsCount += Math.floor(cost / 4);
        hitsCost += cost;
      }
    }
  }
  
  const mostUsedFormation = Object.entries(formations)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';
  
  const totalFromBreakdown = 
    Object.values(pointsBreakdown.goals).reduce((a, b) => a + b, 0) +
    Object.values(pointsBreakdown.assists).reduce((a, b) => a + b, 0) +
    Object.values(pointsBreakdown.cleanSheets).reduce((a, b) => a + b, 0) +
    pointsBreakdown.bonus;
  
  pointsBreakdown.other = summaryRes.summary_overall_points - totalFromBreakdown;
  
  return {
    manager_id: managerId,
    manager_name: managerName,
    gameweek: targetGW,
    total_points: summaryRes.summary_overall_points,
    overall_rank: summaryRes.summary_overall_rank,
    goals_gk: pointsBreakdown.goals.GK,
    goals_def: pointsBreakdown.goals.DEF,
    goals_mid: pointsBreakdown.goals.MID,
    goals_fwd: pointsBreakdown.goals.FWD,
    assists_gk: pointsBreakdown.assists.GK,
    assists_def: pointsBreakdown.assists.DEF,
    assists_mid: pointsBreakdown.assists.MID,
    assists_fwd: pointsBreakdown.assists.FWD,
    cs_gk: pointsBreakdown.cleanSheets.GK,
    cs_def: pointsBreakdown.cleanSheets.DEF,
    cs_mid: pointsBreakdown.cleanSheets.MID,
    cs_fwd: pointsBreakdown.cleanSheets.FWD,
    bonus_points: pointsBreakdown.bonus,
    other_points: pointsBreakdown.other,
    total_transfers: totalTransfers,
    hits_count: hitsCount,
    hits_cost: hitsCost,
    formations: formations,
    most_used_formation: mostUsedFormation,
  };
}

async function fetchAndStoreTop50() {
  console.log('=== Elite Insights Data Fetcher ===');
  
  // Check current GW
  const gwInfo = await getCurrentGW();
  if (!gwInfo || !gwInfo.lastFinishedGW) {
    console.log('❌ No finished gameweeks found. Exiting.');
    return;
  }
  
  const { lastFinishedGW, allPlayers } = gwInfo;
  
  // Check if we already have data for this GW
  const dataExists = await checkIfDataExists(lastFinishedGW);
  if (dataExists) {
    console.log(`✅ Data already exists for GW ${lastFinishedGW}. Nothing to do!`);
    return;
  }
  
  console.log(`📊 Fetching Top 50 data for GW ${lastFinishedGW}...`);
  
  // Fetch Top 50 standings
  const standingsData = await fetchWithRetry('https://fantasy.premierleague.com/api/leagues-classic/314/standings/?page_standings=1');
  const top50Ids = standingsData.standings.results.slice(0, 50).map(m => m.entry);
  
  const insights = [];
  
  for (let i = 0; i < top50Ids.length; i++) {
    console.log(`Processing Top 50: ${i + 1}/50`);
    try {
      const insight = await fetchManagerInsights(top50Ids[i], lastFinishedGW, allPlayers);
      insight.is_top_50 = true;
      insights.push(insight);
      await delay(200);
    } catch (e) {
      console.error(`Error fetching manager ${top50Ids[i]}:`, e);
    }
  }
  
  // Store individual manager insights
  console.log('Storing manager insights...');
  for (const insight of insights) {
    const { error } = await supabase
      .from('elite_manager_insights')
      .upsert(insight, { onConflict: 'manager_id,gameweek' });
    
    if (error) console.error('Error storing insight:', error);
  }
  
  // Calculate and store aggregate
  console.log('Calculating Top 50 aggregate...');
  const count = insights.length;
  const aggregate = {
    gameweek: lastFinishedGW,
    avg_goals_gk: Math.round(insights.reduce((sum, i) => sum + i.goals_gk, 0) / count),
    avg_goals_def: Math.round(insights.reduce((sum, i) => sum + i.goals_def, 0) / count),
    avg_goals_mid: Math.round(insights.reduce((sum, i) => sum + i.goals_mid, 0) / count),
    avg_goals_fwd: Math.round(insights.reduce((sum, i) => sum + i.goals_fwd, 0) / count),
    avg_assists_gk: Math.round(insights.reduce((sum, i) => sum + i.assists_gk, 0) / count),
    avg_assists_def: Math.round(insights.reduce((sum, i) => sum + i.assists_def, 0) / count),
    avg_assists_mid: Math.round(insights.reduce((sum, i) => sum + i.assists_mid, 0) / count),
    avg_assists_fwd: Math.round(insights.reduce((sum, i) => sum + i.assists_fwd, 0) / count),
    avg_cs_gk: Math.round(insights.reduce((sum, i) => sum + i.cs_gk, 0) / count),
    avg_cs_def: Math.round(insights.reduce((sum, i) => sum + i.cs_def, 0) / count),
    avg_cs_mid: Math.round(insights.reduce((sum, i) => sum + i.cs_mid, 0) / count),
    avg_cs_fwd: Math.round(insights.reduce((sum, i) => sum + i.cs_fwd, 0) / count),
    avg_bonus_points: Math.round(insights.reduce((sum, i) => sum + i.bonus_points, 0) / count),
    avg_other_points: Math.round(insights.reduce((sum, i) => sum + i.other_points, 0) / count),
    avg_transfers: Math.round(insights.reduce((sum, i) => sum + i.total_transfers, 0) / count),
    avg_hits_count: Math.round(insights.reduce((sum, i) => sum + i.hits_count, 0) / count),
    avg_hits_cost: Math.round(insights.reduce((sum, i) => sum + i.hits_cost, 0) / count),
    managers_analyzed: count,
  };
  
  // Calculate formation distribution
  const allFormations = {};
  for (const insight of insights) {
    Object.entries(insight.formations).forEach(([formation, count]) => {
      allFormations[formation] = (allFormations[formation] || 0) + count;
    });
  }
  aggregate.formation_distribution = allFormations;
  aggregate.most_common_formation = Object.entries(allFormations)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';
  
  const { error: aggError } = await supabase
    .from('top_50_aggregates')
    .upsert(aggregate, { onConflict: 'gameweek' });
  
  if (aggError) console.error('Error storing aggregate:', aggError);
  
  console.log(`✅ Top 50 data for GW ${lastFinishedGW} stored successfully!`);
}

// Run the script
fetchAndStoreTop50().catch(console.error);