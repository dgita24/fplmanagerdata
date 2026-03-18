-- Private FPL analysis lab schema
-- Date: 2026-03-18

create extension if not exists pgcrypto;

create table if not exists analysis_lab_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table analysis_lab_access enable row level security;
create policy "analysis_lab_access_self_select"
on analysis_lab_access for select
using (auth.uid() = user_id);

create table if not exists analysis_manager_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  season text,
  manager_ids integer[] not null default '{}'::integer[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_manager_groups_unique_name unique (user_id, name),
  constraint analysis_manager_groups_max_50 check (coalesce(array_length(manager_ids, 1), 0) <= 50)
);
create index if not exists idx_analysis_manager_groups_user on analysis_manager_groups(user_id);

alter table analysis_manager_groups enable row level security;
create policy "analysis_manager_groups_owner_select"
on analysis_manager_groups for select
using (auth.uid() = user_id);
create policy "analysis_manager_groups_owner_insert"
on analysis_manager_groups for insert
with check (auth.uid() = user_id);
create policy "analysis_manager_groups_owner_update"
on analysis_manager_groups for update
using (auth.uid() = user_id);
create policy "analysis_manager_groups_owner_delete"
on analysis_manager_groups for delete
using (auth.uid() = user_id);

create table if not exists analysis_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_group_id uuid references analysis_manager_groups(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table analysis_user_settings enable row level security;
create policy "analysis_user_settings_owner_select"
on analysis_user_settings for select
using (auth.uid() = user_id);
create policy "analysis_user_settings_owner_insert"
on analysis_user_settings for insert
with check (auth.uid() = user_id);
create policy "analysis_user_settings_owner_update"
on analysis_user_settings for update
using (auth.uid() = user_id);

create table if not exists fpl_entry_gw_meta (
  season text not null,
  gw integer not null,
  entry_id integer not null,

  entry_name text,
  player_name text,

  overall_rank integer,
  overall_points integer,
  points_on_bench integer,
  points integer,

  event_transfers integer,
  event_transfers_cost integer,

  bank integer,
  value integer,
  free_transfers integer,

  wildcard boolean not null default false,
  freehit boolean not null default false,
  bench_boost boolean not null default false,
  triple_captain boolean not null default false,
  assistant_manager boolean not null default false,

  captain_element integer,
  vice_captain_element integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season, gw, entry_id)
);
create index if not exists idx_fpl_entry_gw_meta_entry on fpl_entry_gw_meta(entry_id);
create index if not exists idx_fpl_entry_gw_meta_season_gw on fpl_entry_gw_meta(season, gw);

create table if not exists fpl_entry_gw_picks (
  season text not null,
  gw integer not null,
  entry_id integer not null,

  element integer not null,
  position integer not null,
  multiplier integer not null,

  is_captain boolean not null,
  is_vice_captain boolean not null,

  purchase_price integer,
  selling_price integer,

  created_at timestamptz not null default now(),

  primary key (season, gw, entry_id, element)
);
create index if not exists idx_fpl_entry_gw_picks_season_gw_element on fpl_entry_gw_picks(season, gw, element);
create index if not exists idx_fpl_entry_gw_picks_entry on fpl_entry_gw_picks(entry_id);

create table if not exists fpl_entry_transfers (
  season text not null,
  gw integer not null,
  entry_id integer not null,

  time timestamptz not null,
  element_in integer not null,
  element_out integer not null,

  purchase_price integer,
  selling_price integer,

  created_at timestamptz not null default now(),

  primary key (season, gw, entry_id, time, element_in, element_out)
);
create index if not exists idx_fpl_entry_transfers_entry_season_gw on fpl_entry_transfers(entry_id, season, gw);
create index if not exists idx_fpl_entry_transfers_time on fpl_entry_transfers(time);

create table if not exists analysis_group_gw_metrics (
  group_id uuid not null references analysis_manager_groups(id) on delete cascade,
  season text not null,
  gw integer not null,

  avg_transfers numeric not null default 0,
  avg_hits numeric not null default 0,
  pct_hit_taken numeric not null default 0,
  pct_early_transfer numeric not null default 0,

  template_top1_element integer,
  template_top1_ownership numeric not null default 0,
  template_top5_json jsonb not null default '[]'::jsonb,
  effective_ownership_top10_json jsonb not null default '[]'::jsonb,

  captain_unique_count integer not null default 0,
  captain_entropy numeric not null default 0,
  captain_top_pick_element integer,
  captain_top_pick_pct numeric not null default 0,

  wc_count integer not null default 0,
  fh_count integer not null default 0,
  bb_count integer not null default 0,
  tc_count integer not null default 0,
  am_count integer not null default 0,

  avg_team_value numeric not null default 0,
  avg_bank numeric not null default 0,
  avg_starting_xi_defenders numeric not null default 0,
  avg_starting_xi_midfielders numeric not null default 0,
  avg_starting_xi_forwards numeric not null default 0,

  is_christmas_period boolean not null default false,

  computed_at timestamptz not null default now(),

  primary key (group_id, season, gw)
);
create index if not exists idx_analysis_group_gw_metrics_group_season on analysis_group_gw_metrics(group_id, season);

alter table analysis_group_gw_metrics enable row level security;
create policy "analysis_group_gw_metrics_select_if_owns_group"
on analysis_group_gw_metrics for select
using (
  exists (
    select 1
    from analysis_manager_groups g
    where g.id = analysis_group_gw_metrics.group_id
      and g.user_id = auth.uid()
  )
);
