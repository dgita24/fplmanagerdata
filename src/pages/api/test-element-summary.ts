export const prerender = false;

export async function GET({ url }) {
  // Get player ID from query param, default to Salah (player ID 328) as a test
  const playerId = url.searchParams.get('player') || '328';
  
  const target = `https://fantasy.premierleague.com/api/element-summary/${playerId}/`;

  console.log(`Testing element-summary for player ${playerId}`);

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
    
    // Return the full raw response so we can inspect all available fields
    return new Response(JSON.stringify({
      _info: {
        endpoint: target,
        playerId: playerId,
        description: "Raw FPL element-summary response - check for defensive action fields"
      },
      // Show what top-level keys exist
      _availableKeys: Object.keys(data),
      // Show sample of history if available
      _historyFieldsSample: data.history && data.history[0] ? Object.keys(data.history[0]) : [],
      _fixtureFieldsSample: data.fixtures && data.fixtures[0] ? Object.keys(data.fixtures[0]) : [],
      // Full raw data
      rawData: data
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