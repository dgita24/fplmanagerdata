# Private FPL Analysis Lab — Operator Guide

This document explains how to operate the private FPL analysis lab.
**Nothing described here is public-facing.**
No lab pages, routes, nav links, or UI components exist.

---

## Overview

The lab analyses a group of FPL managers whose IDs are stored in Supabase under a
single **dedicated analysis account** (`user_manager_lists.manager_ids`).

```
Dedicated analysis account
  └── user_manager_lists.manager_ids  ← single source of truth
         ↓
  src/lab/ingest-lab-data.ts          ← pulls data from FPL API → Supabase
         ↓
  lab_manager_gw_snapshots            ← GW summaries (points, chips, value …)
  lab_manager_gw_picks                ← squad picks per GW
  lab_manager_transfers               ← transfer history
         ↓
  src/lab/analysis/*.ts               ← analysis scripts
         ↓
  private/lab/*.json                  ← private outputs (git-ignored)
```

---

## One-time setup

### 1. Apply the migration

Paste the contents of
`supabase/migrations/20260318000001_lab_analysis_tables.sql`
into the Supabase SQL Editor and run it.

This creates three private tables:

| Table | Purpose |
|---|---|
| `lab_manager_gw_snapshots` | GW-level summary per manager |
| `lab_manager_gw_picks` | Per-pick per GW (squad + bench) |
| `lab_manager_transfers` | Full transfer history |

These tables are never exposed to public routes or the browser.

### 2. Create the dedicated analysis account

1. Sign up for an account at your app URL (or use an existing account).
2. Note the account's **UUID** — find it in Supabase > Authentication > Users.
3. Log in and save your initial list of manager IDs via the **Managers** page in the app.

### 3. Set environment variables

Add to your local `.env`:

```
SUPABASE_URL=https://fnehvaoqqmkrhxcqslta.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_secret>
LAB_ANALYSIS_USER_ID=<uuid-of-analysis-account>
```

> **Never commit `.env` to git.**  
> `SUPABASE_SERVICE_ROLE_KEY` must remain private.

---

## Updating manager IDs

To change which managers are analysed:

1. Log in to the app as the dedicated analysis account.
2. Go to the **Managers** page.
3. Edit the manager IDs list and save.

That's it. No code changes needed. The next ingestion run will automatically use
the updated list.

---

## Running ingestion

```bash
npx tsx src/lab/ingest-lab-data.ts
```

This fetches:
- GW-by-GW history for every manager (snapshots + chip data)
- Picks for every played GW
- Full transfer history

All data is upserted into Supabase, so re-running is safe and idempotent.

**Optional environment variables:**

| Variable | Default | Description |
|---|---|---|
| `LAB_DELAY_MS` | `800` | Delay (ms) between manager requests |
| `LAB_FPL_BASE_URL` | FPL API | Override base URL (e.g. local proxy) |

---

## Running analysis scripts

Each script reads from Supabase and writes a JSON file to `private/lab/`.
Run ingestion first.

### Transfer Strategy (Patience vs Kneejerking)

```bash
npx tsx src/lab/analysis/transfer-strategy.ts
```

Output: `private/lab/transfer-strategy.json`

What it analyses:
- Transfer hits per season and per GW
- Aggressiveness score (low/medium/high)
- Premium player sells: consecutive blanks before each sell
  (kneejerk = sold after ≤ 2 consecutive blanks; patient = 3+ blanks or no blanks)
- Group-level kneejerk rate

---

### Template Evolution

```bash
npx tsx src/lab/analysis/template-evolution.ts
```

Output: `private/lab/template-evolution.json`

What it analyses:
- Effective ownership (EO %) of every player per GW within the group
- Captain % per player per GW
- Group pivots: players with ≥ 20 pp ownership swing between consecutive GWs

---

### Captaincy Variance & Risk

```bash
npx tsx src/lab/analysis/captaincy.ts
```

Output: `private/lab/captaincy.json`

What it analyses:
- Captain picks per GW within the group
- Group consensus (most-picked captain and their share)
- Differential rate per GW and per manager
- Average GW score for managers picking each captain option

> Note: GW score is the manager's full GW total (captain multiplier included),
> not an isolated captain element return.

---

### Chip Strategy

```bash
npx tsx src/lab/analysis/chip-strategy.ts
```

Output: `private/lab/chip-strategy.json`

What it analyses:
- When each chip (WC, FH, BB, TC) was played per manager
- GW points on the chip GW
- DGW/BGW annotation (from bootstrap-static events)
- Cross-group: average GW points per chip type, DGW usage %

---

### Formation and Value Accumulation

```bash
npx tsx src/lab/analysis/formation-value.ts
```

Output: `private/lab/formation-value.json`

What it analyses:
- Team value (squad value + bank) per GW (focus GW1–15)
- Formation derived from starting XI positions (e.g. 3-5-2)
- Bench structure by element type (GK/DEF/MID/FWD) per GW
- Cross-group average value per GW and most-used formations

---

## Output locations

All outputs are written to `private/lab/` and are **git-ignored**.

| File | Script |
|---|---|
| `private/lab/chip-strategy.json` | chip-strategy.ts |
| `private/lab/transfer-strategy.json` | transfer-strategy.ts |
| `private/lab/template-evolution.json` | template-evolution.ts |
| `private/lab/captaincy.json` | captaincy.ts |
| `private/lab/formation-value.json` | formation-value.ts |

---

## Full run sequence

```bash
# 1. Ingest fresh data
npx tsx src/lab/ingest-lab-data.ts

# 2. Run all analyses
npx tsx src/lab/analysis/transfer-strategy.ts
npx tsx src/lab/analysis/template-evolution.ts
npx tsx src/lab/analysis/captaincy.ts
npx tsx src/lab/analysis/chip-strategy.ts
npx tsx src/lab/analysis/formation-value.ts
```

---

## Security notes

- The `private/` directory is excluded from git via `.gitignore`.
- Service-role key must never be committed or logged.
- Lab tables have RLS disabled — they rely on service-role-only access.
  No public API route reads from `lab_manager_gw_*` tables.
- No public page, route, nav link, or component references the lab.
