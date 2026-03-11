-- Create table for storing per-player per-match FPL statistics
-- Used by the ingest-player-history pipeline as an optional secondary sink.
-- Primary key is (player_id, fixture_id) for idempotent upserts.

CREATE TABLE IF NOT EXISTS player_match_history (
  player_id     INTEGER NOT NULL,
  fixture_id    INTEGER NOT NULL,
  gw            INTEGER NOT NULL,
  was_home      BOOLEAN NOT NULL,
  opponent_team INTEGER NOT NULL,
  kickoff_time  TEXT,
  team_h_score  INTEGER,
  team_a_score  INTEGER,
  minutes       INTEGER NOT NULL DEFAULT 0,
  total_points  INTEGER NOT NULL DEFAULT 0,
  goals_scored  INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  bonus         INTEGER NOT NULL DEFAULT 0,
  bps           INTEGER NOT NULL DEFAULT 0,
  clean_sheets  INTEGER NOT NULL DEFAULT 0,
  goals_conceded INTEGER NOT NULL DEFAULT 0,
  own_goals     INTEGER NOT NULL DEFAULT 0,
  penalties_saved   INTEGER NOT NULL DEFAULT 0,
  penalties_missed  INTEGER NOT NULL DEFAULT 0,
  yellow_cards  INTEGER NOT NULL DEFAULT 0,
  red_cards     INTEGER NOT NULL DEFAULT 0,
  saves         INTEGER NOT NULL DEFAULT 0,
  clearances_blocks_interceptions INTEGER NOT NULL DEFAULT 0,
  tackles       INTEGER NOT NULL DEFAULT 0,
  recoveries    INTEGER NOT NULL DEFAULT 0,
  expected_goals             TEXT NOT NULL DEFAULT '0.00',
  expected_assists           TEXT NOT NULL DEFAULT '0.00',
  expected_goal_involvements TEXT NOT NULL DEFAULT '0.00',
  expected_goals_conceded    TEXT NOT NULL DEFAULT '0.00',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (player_id, fixture_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pmh_gw        ON player_match_history (gw);
CREATE INDEX IF NOT EXISTS idx_pmh_player    ON player_match_history (player_id);
CREATE INDEX IF NOT EXISTS idx_pmh_player_gw ON player_match_history (player_id, gw);
