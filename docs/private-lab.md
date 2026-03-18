# Private Analysis Lab — Operator Guide

> **This feature is private and internal only.**
> There is no public UI, no navigation link, and no user-visible indicator of its existence.
> It is accessible only to someone reading the repository or running the scripts directly.

---

## Architecture overview

The private analysis lab lets you maintain **multiple named manager sets** under a single dedicated analysis account on the site, ingest FPL data for each set, and run private analyses — all without changing code when you switch groups.

```
supabase/migrations/
  20260318_private_analysis_lab.sql   ← all private schema

src/lib/private-lab/
  supabase-service.ts    ← service-role Supabase client (never used in public pages)
  manager-sets.ts        ← CRUD helpers for named manager sets

src/tools/private-lab/
  manage-manager-set.ts  ← CLI: create / update / list / delete named sets
  set-active-set.ts      ← CLI: mark one set as the active default
  ingest-manager-data.ts ← CLI: ingest FPL data for a set into analysis tables
  analyse-captaincy.ts   ← CLI: captaincy variance report (stdout + optional file)

docs/
  private-lab.md         ← this file
```

---

## Database schema

The migration adds **private-only tables** with Row Level Security configured for service-role access only from scripts:

| Table | Purpose |
|---|---|
| `analysis_lab_access` | Allowlist of user IDs authorised for lab features |
| `analysis_manager_groups` | Named manager sets (e.g. `top50-world-2025-26`) |
| `analysis_user_settings` | Tracks which group is currently "active" per user |
| `fpl_entry_gw_meta` | GW-by-GW history for each manager (points, rank, chips, captain) |
| `fpl_entry_gw_picks` | Per-GW squad picks for each manager |
| `fpl_entry_transfers` | All transfers per manager |
| `analysis_group_gw_metrics` | Pre-computed per-GW aggregate metrics per group |

---

## Required env vars

All private-lab scripts use the **service role key** — never the anon/publishable key.
Create a `.env` file (never commit it) or set these in your environment before running scripts:

```sh
export SUPABASE_URL=https://<your-project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
```

> **Warning**: The service role key bypasses all RLS. Keep it out of source code and CI logs.

---

## Step 1 — Run the migration

Apply the migration to your Supabase project:

```sh
# Via Supabase CLI (recommended)
supabase db push

# Or via the Supabase Dashboard SQL editor — paste the contents of:
supabase/migrations/20260318_private_analysis_lab.sql
```

---

## Step 2 — Find your analysis user ID

Log in to your dedicated analysis account on the site.
Retrieve the user UUID from the Supabase Dashboard → Authentication → Users.

```sh
# Store it for convenience:
export ANALYSIS_USER_ID=<your-uuid-here>
```

Optionally grant explicit lab access:

```sql
insert into analysis_lab_access (user_id) values ('<your-uuid>');
```

---

## Step 3 — Create a named manager set

Provide a comma-separated list of FPL entry IDs (manager IDs):

```sh
npx tsx src/tools/private-lab/manage-manager-set.ts upsert \
  --userId=$ANALYSIS_USER_ID \
  --set=top50-world-2025-26 \
  --ids=123456,234567,345678,...  \
  --season=2025-26 \
  --description="World top 50 after GW38 2025-26"
```

You can maintain multiple sets:

```sh
npx tsx src/tools/private-lab/manage-manager-set.ts upsert \
  --userId=$ANALYSIS_USER_ID \
  --set=top50-all-time \
  --ids=99999,88888,...
```

### List all sets

```sh
npx tsx src/tools/private-lab/manage-manager-set.ts list \
  --userId=$ANALYSIS_USER_ID
```

### Delete a set

```sh
npx tsx src/tools/private-lab/manage-manager-set.ts delete \
  --userId=$ANALYSIS_USER_ID --set=top50-world-2025-26
```

---

## Step 4 — Mark a set as active

Once a set is marked active, all scripts use it by default (no `--set` needed):

```sh
npx tsx src/tools/private-lab/set-active-set.ts \
  --userId=$ANALYSIS_USER_ID \
  --set=top50-world-2025-26
```

### Switching groups without code changes

```sh
# Switch to all-time set
npx tsx src/tools/private-lab/set-active-set.ts \
  --userId=$ANALYSIS_USER_ID \
  --set=top50-all-time

# From this point, all scripts without --set will use top50-all-time
```

---

## Step 5 — Ingest manager data

Ingests entry history, per-GW picks, and transfers for all managers in the active set.

```sh
# Full season
npx tsx src/tools/private-lab/ingest-manager-data.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26

# Specific GW range
npx tsx src/tools/private-lab/ingest-manager-data.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26 \
  --startGw=1 --endGw=10

# Specific named set (overrides active)
npx tsx src/tools/private-lab/ingest-manager-data.ts \
  --userId=$ANALYSIS_USER_ID \
  --set=top50-all-time \
  --season=2024-25 \
  --startGw=1 --endGw=38

# Slower throttle for extra safety
npx tsx src/tools/private-lab/ingest-manager-data.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26 \
  --delayMs=1200 --jitterMs=400
```

The ingestion is **idempotent** — safe to re-run. Existing rows are upserted via uniqueness constraints.

---

## Step 6 — Run captaincy analysis

```sh
# Full season report (stdout only)
npx tsx src/tools/private-lab/analyse-captaincy.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26

# Save to local JSON file (never served publicly)
npx tsx src/tools/private-lab/analyse-captaincy.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26 \
  --out=./data/private-lab/captaincy-2025-26.json

# Specific GW range
npx tsx src/tools/private-lab/analyse-captaincy.ts \
  --userId=$ANALYSIS_USER_ID \
  --season=2025-26 \
  --startGw=1 --endGw=20
```

The report outputs:
- Per-GW captain pick distribution (top picks + % of group)
- Captaincy entropy (how diverse vs consensus the group was each GW)
- Top 10 most-captained players overall
- Summary: most contested GW, most consensus GW, GWs with >50% consensus

---

## Season-to-season workflow

At the start of a new season:

1. Create a new named set with the new group of manager IDs:
   ```sh
   npx tsx src/tools/private-lab/manage-manager-set.ts upsert \
     --userId=$ANALYSIS_USER_ID \
     --set=top50-world-2026-27 \
     --ids=... --season=2026-27
   ```

2. Mark it active:
   ```sh
   npx tsx src/tools/private-lab/set-active-set.ts \
     --userId=$ANALYSIS_USER_ID \
     --set=top50-world-2026-27
   ```

3. Run ingestion with the new season label:
   ```sh
   npx tsx src/tools/private-lab/ingest-manager-data.ts \
     --userId=$ANALYSIS_USER_ID \
     --season=2026-27
   ```

4. Run analysis. Previous seasons' data remains in the tables.

No code changes are needed between seasons.

---

## Extending the lab

To add more analysis scripts:

1. Create `src/tools/private-lab/analyse-<topic>.ts`
2. Import helpers from `src/lib/private-lab/`:
   - `getServiceClient()` for Supabase access
   - `resolveActiveGroup()` for the manager set
3. Query `fpl_entry_gw_meta`, `fpl_entry_gw_picks`, `fpl_entry_transfers`
4. Print to stdout or write to `./data/private-lab/` (not served publicly)

Suggested next analyses:
- `analyse-transfers.ts` — transfer hit aggressiveness, patience/kneejerking
- `analyse-ownership.ts` — template evolution and effective ownership by GW
- `analyse-chips.ts` — chip timing vs DGW/BGW outcomes
- `analyse-value.ts` — team value accumulation and bench spend

---

## Security notes

- No public page, route, or nav element references private-lab code.
- The service-role key is **never** in public JavaScript or committed to the repo.
- Analysis output files go under `./data/private-lab/` (add to `.gitignore` if desired).
- RLS on all private tables prevents authenticated users from reading other users' data.
  Service-role scripts bypass RLS intentionally.
