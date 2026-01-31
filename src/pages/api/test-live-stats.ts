export const prerender = false;

export async function GET({ url }) {
  // Get GW from query param, default to 24
  const gw = url.searchParams.get('gw') || '24';
  
  const target = `https://fantasy.premierleague.com/api/event/${gw}/live/`;

  console.log(`Testing live endpoint for GW ${gw}`);

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `FPL API error: ${res.status}` }), 
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = await res.json();
    
    // Find a player with minutes to show their stats
    const elements = data.elements || [];
    const playerWithMinutes = elements.find((p: any) => p.stats && p.stats.minutes > 0);
    
    // Get all unique stat keys
    const allStatKeys = new Set<string>();
    elements.forEach((p: any) => {
      if (p.stats) {
        Object.keys(p.stats).forEach(key => allStatKeys.add(key));
      }
    });

    // Check specifically for DEFCON fields
    const defconFields = {
      clearances_blocks_interceptions: allStatKeys.has('clearances_blocks_interceptions'),
      recoveries: allStatKeys.has('recoveries'),
      tackles: allStatKeys.has('tackles'),
      defensive_contribution: allStatKeys.has('defensive_contribution'),
    };

    // Find Gabriel (ID 5) specifically to compare with element-summary
    const gabriel = elements.find((p: any) => p.id === 5);

    return new Response(JSON.stringify({
      _info: {
        endpoint: target,
        gw: gw,
        description: "Checking if live endpoint has DEFCON fields"
      },
      _defconFieldsAvailable: defconFields,
      _allAvailableStats: Array.from(allStatKeys).sort(),
      _samplePlayerWithMinutes: playerWithMinutes ? {
        id: playerWithMinutes.id,
        stats: playerWithMinutes.stats
      } : null,
      _gabrielStats: gabriel ? {
        id: gabriel.id,
        stats: gabriel.stats
      } : "Gabriel not found"
    }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch from FPL API', details: String(error) }), 
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}