-- Supabase RPC: aggregated player stats for the /players page.
-- Parameters:
--   p_venue  TEXT    'all' | 'home' | 'away'
--   p_last_n INTEGER number of most-recent distinct GWs to include
--
-- Returns one row per player with summed/averaged stats over the window.
--
-- NOTE: Run this migration in your Supabase project (SQL Editor or supabase db push)
-- before deploying the new /players aggregated UI.
--
-- Example: SELECT * FROM get_player_aggregates('home', 5);

CREATE OR REPLACE FUNCTION get_player_aggregates(
  p_venue  TEXT    DEFAULT 'all',
  p_last_n INTEGER DEFAULT 5
)
RETURNS TABLE (
  player_id                    INTEGER,
  matches                      INTEGER,
  total_points                 INTEGER,
  avg_points                   NUMERIC,
  goals_scored                 INTEGER,
  assists                      INTEGER,
  bonus                        INTEGER,
  minutes                      INTEGER,
  clean_sheets                 INTEGER,
  goals_conceded               INTEGER,
  saves                        INTEGER,
  yellow_cards                 INTEGER,
  red_cards                    INTEGER,
  own_goals                    INTEGER,
  penalties_saved              INTEGER,
  penalties_missed             INTEGER,
  expected_goals               NUMERIC,
  expected_assists             NUMERIC,
  expected_goal_involvements   NUMERIC,
  expected_goals_conceded      NUMERIC,
  min_gw                       INTEGER,
  max_gw                       INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH recent_gws AS (
    -- Identify the N most-recent distinct GWs present in the data
    SELECT DISTINCT gw
    FROM   player_match_history
    ORDER  BY gw DESC
    LIMIT  p_last_n
  ),
  filtered AS (
    -- Join to those GWs and apply venue filter
    SELECT h.*
    FROM   player_match_history h
    JOIN   recent_gws rg USING (gw)
    WHERE  p_venue = 'all'
        OR (p_venue = 'home' AND h.was_home = TRUE)
        OR (p_venue = 'away' AND h.was_home = FALSE)
  )
  SELECT
    player_id,
    COUNT(*)::INTEGER                                        AS matches,
    SUM(total_points)::INTEGER                               AS total_points,
    ROUND(AVG(total_points::NUMERIC), 2)                     AS avg_points,
    SUM(goals_scored)::INTEGER                               AS goals_scored,
    SUM(assists)::INTEGER                                    AS assists,
    SUM(bonus)::INTEGER                                      AS bonus,
    SUM(minutes)::INTEGER                                    AS minutes,
    SUM(clean_sheets)::INTEGER                               AS clean_sheets,
    SUM(goals_conceded)::INTEGER                             AS goals_conceded,
    SUM(saves)::INTEGER                                      AS saves,
    SUM(yellow_cards)::INTEGER                               AS yellow_cards,
    SUM(red_cards)::INTEGER                                  AS red_cards,
    SUM(own_goals)::INTEGER                                  AS own_goals,
    SUM(penalties_saved)::INTEGER                            AS penalties_saved,
    SUM(penalties_missed)::INTEGER                           AS penalties_missed,
    ROUND(SUM(expected_goals::NUMERIC), 2)                   AS expected_goals,
    ROUND(SUM(expected_assists::NUMERIC), 2)                 AS expected_assists,
    ROUND(SUM(expected_goal_involvements::NUMERIC), 2)       AS expected_goal_involvements,
    ROUND(SUM(expected_goals_conceded::NUMERIC), 2)          AS expected_goals_conceded,
    MIN(gw)::INTEGER                                         AS min_gw,
    MAX(gw)::INTEGER                                         AS max_gw
  FROM filtered
  GROUP BY player_id;
$$;
