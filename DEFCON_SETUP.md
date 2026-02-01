# DEFCON Points Tracking Setup

## Overview
This feature tracks DEFCON (Defensive Contribution) bonus points for FPL players. DEFCON awards 2 bonus points when a player reaches a threshold of combined defensive actions.

**DEFCON Rules:**
- **Defenders (position 2)**: Need 10+ defensive contributions for 2 points
- **Midfielders/Forwards (position 3/4)**: Need 12+ defensive contributions for 2 points
- **Goalkeepers (position 1)**: Not eligible for DEFCON

Defensive contribution = clearances + recoveries + tackles + interceptions + blocks

## Setup Instructions

### Step 1: Create Supabase Table
Run the SQL migration in your Supabase dashboard:

1. Go to the Supabase SQL Editor
2. Copy and run the contents of `supabase/migrations/create_player_defensive_stats.sql`

This creates the `player_defensive_stats` table with proper indexes.

### Step 2: Configure GitHub Secrets
Ensure these secrets are configured in your GitHub repository settings:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (not the anon key!)

### Step 3: Backfill Historical Data
After the table is created, you can backfill historical data:

1. Go to **Actions** tab in your GitHub repository
2. Select **Fetch DEFCON Stats** workflow
3. Click **Run workflow**
4. Enter:
   - **Start gameweek**: `1`
   - **End gameweek**: Current gameweek (e.g., `23`)
5. Click **Run workflow**

The workflow will fetch and store DEFCON stats for all specified gameweeks.

### Step 4: Verify Data
Check that data was inserted:
```sql
SELECT COUNT(*) FROM player_defensive_stats;
SELECT * FROM player_defensive_stats LIMIT 10;
```

## Usage

### Automatic Daily Updates
The workflow runs automatically every day at 3 AM UTC to fetch stats for the current gameweek.

### Manual Trigger
You can manually trigger the workflow at any time:
- Without inputs: Fetches current gameweek only
- With start_gw and end_gw: Backfills specified range

### Viewing DEFCON Stats
1. Navigate to the **Squads** page
2. Click on any outfield player's name
3. The player modal will display their DEFCON stats:
   - Number of games where they earned DEFCON points
   - Total DEFCON points accumulated this season

**Note:** DEFCON stats only appear for outfield players (DEF, MID, FWD). Goalkeepers are not eligible.

## Data Structure

The `player_defensive_stats` table stores:
- `player_id`: FPL player ID
- `gameweek`: Gameweek number (1-38)
- `position`: Player position (1=GK, 2=DEF, 3=MID, 4=FWD)
- `minutes`: Minutes played
- `defensive_contribution`: Total defensive actions (provided by FPL API)
- `defcon_points`: DEFCON points earned (0 or 2)
- `clearances`: Combined clearances + blocks + interceptions (FPL API provides these combined)
- `recoveries`: Ball recoveries
- `tackles`: Tackles made
- `interceptions`: Set to 0 (included in clearances)
- `blocks`: Set to 0 (included in clearances)

**Note:** The FPL API provides `clearances_blocks_interceptions` as a single combined value. This is stored in the `clearances` column, while `interceptions` and `blocks` are set to 0.

## Troubleshooting

### Workflow Fails
- Check GitHub Actions logs for error messages
- Verify secrets are correctly configured
- Ensure FPL API is accessible

### No DEFCON Stats Showing
- Verify data exists in `player_defensive_stats` table
- Ensure you've run the backfill for past gameweeks
- Check browser console for any errors

### Data Looks Wrong
- Re-run the workflow for specific gameweeks
- The workflow uses upsert, so it will overwrite existing data

## Technical Details

### API Endpoints Used
- `https://fantasy.premierleague.com/api/bootstrap-static/` - Player positions and current GW
- `https://fantasy.premierleague.com/api/event/{gw}/live/` - Live stats including defensive_contribution

### Calculation Logic
The workflow uses the `defensive_contribution` field directly from the FPL API, which already includes the sum of:
- Clearances
- Blocks
- Interceptions
- Recoveries
- Tackles

Then applies DEFCON thresholds based on player position.

## Future Enhancements
Possible improvements:
- Add DEFCON stats to other pages (Live, Stats)
- Show DEFCON trend over recent gameweeks
- Compare player DEFCON performance
- Add DEFCON to player comparison views
