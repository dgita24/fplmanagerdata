# DEFCON Points Tracking - Pull Request Summary

## Overview
This PR implements a complete DEFCON (Defensive Contribution) points tracking system for the FPL Manager Data project. DEFCON awards 2 bonus points when players reach specific thresholds of defensive actions based on their position.

## What is DEFCON?
DEFCON (Defensive Contribution) is a bonus point system in Fantasy Premier League:
- **Defenders**: Need 10+ defensive contributions for 2 points
- **Midfielders/Forwards**: Need 12+ defensive contributions for 2 points
- **Goalkeepers**: Not eligible for DEFCON points

Defensive contribution = clearances + blocks + interceptions + recoveries + tackles

## Implementation Details

### 1. Database Schema
**File:** `supabase/migrations/create_player_defensive_stats.sql`

Created a new table to track defensive statistics per player per gameweek:
```sql
CREATE TABLE player_defensive_stats (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  gameweek INTEGER NOT NULL,
  position INTEGER NOT NULL,
  minutes INTEGER DEFAULT 0,
  clearances INTEGER DEFAULT 0,
  recoveries INTEGER DEFAULT 0,
  tackles INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,
  blocks INTEGER DEFAULT 0,
  defensive_contribution INTEGER DEFAULT 0,
  defcon_points INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(player_id, gameweek)
);
```

**Key Features:**
- Unique constraint prevents duplicate entries
- Indexes on player_id and gameweek for fast queries
- Stores both raw defensive stats and calculated DEFCON points

### 2. GitHub Action Workflow
**File:** `.github/workflows/fetch-defcon-stats.yml`

Automated workflow that:
- **Runs daily** at 3 AM UTC to fetch current gameweek stats
- **Manual trigger** with inputs for backfilling historical data
- **Fetches data** from FPL API endpoints:
  - `bootstrap-static` for player positions
  - `event/{gw}/live` for defensive statistics
- **Calculates** DEFCON points based on position and defensive_contribution
- **Upserts** to Supabase (updates existing or inserts new records)

**Workflow Features:**
- Proper error handling and logging
- Rate limiting between requests (1 second delay)
- Detailed console output for debugging
- Secure permissions (contents: read only)

**Usage:**
- Automatic: Runs daily, no action needed
- Manual: Go to Actions tab → "Fetch DEFCON Stats" → Run workflow
- Backfill: Enter start_gw and end_gw (e.g., 1 to 23)

### 3. UI Integration
**File:** `src/pages/squads.astro`

Enhanced the player modal to display DEFCON statistics:

**New Function:**
```javascript
async function fetchPlayerDefconStats(playerId) {
  // Queries Supabase for all gameweeks for this player
  // Returns: { totalDefcon: number, gamesWithDefcon: number }
}
```

**Updated Modal:**
- Shows DEFCON stats for outfield players only (DEF, MID, FWD)
- Displays: "X games" with "+Y" points in green
- Gracefully handles missing data (shows nothing if no DEFCON points)
- Only appears when player has earned DEFCON points

**Display Format:**
```
DEFCON Points    5 games    +10
```

### 4. Documentation
**File:** `DEFCON_SETUP.md`

Complete setup and usage guide including:
- Step-by-step setup instructions
- How to run SQL migration
- How to backfill historical data
- Troubleshooting tips
- Technical details and API information

## Setup Instructions for User

### Step 1: Create Database Table
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/create_player_defensive_stats.sql`
3. Execute the SQL
4. Verify table created: `SELECT * FROM player_defensive_stats LIMIT 1;`

### Step 2: Verify GitHub Secrets
Ensure these secrets exist in repository settings:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (not anon key!)

### Step 3: Backfill Historical Data
1. Go to GitHub repository → Actions tab
2. Select "Fetch DEFCON Stats" workflow
3. Click "Run workflow"
4. Enter:
   - Start gameweek: `1`
   - End gameweek: Current gameweek (e.g., `23`)
5. Click "Run workflow" button
6. Wait for completion (~1-2 minutes)

### Step 4: Verify Data
Check Supabase SQL Editor:
```sql
-- Count total records
SELECT COUNT(*) FROM player_defensive_stats;

-- See sample data
SELECT * FROM player_defensive_stats 
ORDER BY defcon_points DESC 
LIMIT 10;

-- Check specific player
SELECT * FROM player_defensive_stats 
WHERE player_id = 123;
```

### Step 5: View in UI
1. Navigate to Squads page
2. Select any gameweek
3. Click on an outfield player's name
4. Player modal shows DEFCON stats (if they've earned any)

## Technical Notes

### API Integration
The workflow uses official FPL API endpoints:
- **Bootstrap Static**: `https://fantasy.premierleague.com/api/bootstrap-static/`
  - Provides player positions and current gameweek
  
- **Live Event Data**: `https://fantasy.premierleague.com/api/event/{gw}/live/`
  - Provides defensive_contribution already calculated
  - Provides individual stats (clearances_blocks_interceptions, recoveries, tackles)

### Data Storage Strategy
- **Combined Stats**: FPL API provides `clearances_blocks_interceptions` as one value
  - We store this in the `clearances` column
  - `interceptions` and `blocks` columns are set to 0
- **Defensive Contribution**: Used directly from API (already calculated)
- **DEFCON Points**: Calculated in workflow based on position thresholds

### Position Mapping
- Position 1 = Goalkeeper (GK)
- Position 2 = Defender (DEF)
- Position 3 = Midfielder (MID)
- Position 4 = Forward (FWD)

## Testing

### Workflow Testing
The workflow can be tested by:
1. Manual trigger for a single gameweek
2. Check GitHub Actions logs for errors
3. Verify data in Supabase

### UI Testing
Test the player modal by:
1. Opening Squads page
2. Clicking various player names
3. Verifying DEFCON shows for outfield players with qualifying stats
4. Verifying GKs don't show DEFCON section

## Maintenance

### Daily Operation
- Workflow runs automatically at 3 AM UTC
- Fetches stats for current gameweek
- Upserts data (updates if already exists)

### Manual Re-fetch
If data needs correction:
1. Re-run workflow for specific gameweek
2. Upsert will replace existing data

### Monitoring
Check GitHub Actions logs to:
- Verify daily runs complete successfully
- See how many records processed
- Identify any API failures

## Future Enhancements

Possible future improvements:
- Add DEFCON to Live standings page
- Show DEFCON trend chart over time
- Add DEFCON filter to Stats page
- Compare DEFCON across players
- Add DEFCON to ownership analysis

## Security & Quality

✅ **Security Scan Passed**: CodeQL found no vulnerabilities
✅ **Permissions**: Workflow uses minimal permissions (contents: read)
✅ **Error Handling**: Proper try-catch blocks throughout
✅ **Code Review**: All feedback addressed
✅ **Build**: Successful with no errors
✅ **Documentation**: Comprehensive setup guide provided

## Files Changed Summary

| File | Change Type | Purpose |
|------|-------------|---------|
| `supabase/migrations/create_player_defensive_stats.sql` | New | Database schema |
| `.github/workflows/fetch-defcon-stats.yml` | New | GitHub Action workflow |
| `src/pages/squads.astro` | Modified | UI integration |
| `DEFCON_SETUP.md` | New | User documentation |

## Questions?

See `DEFCON_SETUP.md` for detailed information or check the inline code comments.
