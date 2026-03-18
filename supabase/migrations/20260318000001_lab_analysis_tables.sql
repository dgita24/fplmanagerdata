-- Private FPL Analysis Lab — schema
-- Date: 2026-03-18
--
-- Three private tables, accessed ONLY via the service-role key from
-- private scripts (src/lab/*).  No public UI, page, or route reads
-- these tables.  RLS is intentionally disabled because all access is
-- service-role only; enabling RLS with no policies would just add noise.
--
-- Tables:
--   lab_manager_gw_snapshots  — GW-level summary per manager
--   lab_manager_gw_picks      — Per-pick row per manager per GW
--   lab_manager_transfers     — Transfer history per manager

-- ─────────────────────────────────────────────────────────────────────────────
-- lab_manager_gw_snapshots
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists lab_manager_gw_snapshots (
  entry_id              integer     not null,
  gw                    integer     not null,

  -- Points
  gw_points             integer     not null default 0,
  total_points          integer     not null default 0,
  points_on_bench       integer     not null default 0,

  -- Rank
  rank                  integer,
  overall_rank          integer,

  -- Squad value
  value                 integer     not null default 0,
  bank                  integer     not null default 0,

  -- Transfers
  event_transfers       integer     not null default 0,
  event_transfers_cost  integer     not null default 0,

  -- Chips
  chip_played           text,

  ingested_at           timestamptz not null default now(),

  primary key (entry_id, gw)
);

create index if not exists idx_lab_snapshots_gw
  on lab_manager_gw_snapshots (gw);

create index if not exists idx_lab_snapshots_entry
  on lab_manager_gw_snapshots (entry_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- lab_manager_gw_picks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists lab_manager_gw_picks (
  entry_id          integer     not null,
  gw                integer     not null,
  position          integer     not null,   -- 1=GK, 2–11=outfield starters, 12–15=bench

  element           integer     not null,
  multiplier        integer     not null default 1,
  is_captain        boolean     not null default false,
  is_vice_captain   boolean     not null default false,

  selling_price     integer,
  purchase_price    integer,

  ingested_at       timestamptz not null default now(),

  primary key (entry_id, gw, position)
);

create index if not exists idx_lab_picks_gw_element
  on lab_manager_gw_picks (gw, element);

create index if not exists idx_lab_picks_entry
  on lab_manager_gw_picks (entry_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- lab_manager_transfers
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists lab_manager_transfers (
  entry_id          integer     not null,
  gw                integer     not null,
  element_in        integer     not null,
  element_out       integer     not null,

  element_in_cost   integer,
  element_out_cost  integer,

  transfer_time     timestamptz,

  ingested_at       timestamptz not null default now(),

  primary key (entry_id, gw, element_in, element_out)
);

create index if not exists idx_lab_transfers_entry_gw
  on lab_manager_transfers (entry_id, gw);

create index if not exists idx_lab_transfers_elements
  on lab_manager_transfers (gw, element_in, element_out);
