-- Create table for storing player defensive statistics per gameweek
CREATE TABLE IF NOT EXISTS player_defensive_stats (
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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_player_defensive_stats_player_id ON player_defensive_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_defensive_stats_gameweek ON player_defensive_stats(gameweek);
