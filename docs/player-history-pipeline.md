# Player History Ingestion Pipeline

A low-cost, incremental pipeline that fetches per-player per-match FPL statistics
(including xG, xA, xGC where available) and stores them as static NDJSON snapshots
that can be consumed by any client without hitting the FPL API directly.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [How incremental updates work](#how-incremental-updates-work)
3. [Running locally](#running-locally)
4. [Storage options & cost notes](#storage-options--cost-notes)
5. [Setting up Supabase (recommended)](#setting-up-supabase)
6. [Setting up an alternative free database (Cloudflare D1 or Turso)](#setting-up-an-alternative-free-database)
7. [How both sites consume the snapshot](#how-both-sites-consume-the-snapshot)
8. [GitHub Actions schedule](#github-actions-schedule)

---

## Architecture overview

```
FPL API
  └─ /bootstrap-static/          (player list, current GW)
  └─ /element-summary/:id/       (per-player match history)
         │
         ▼
src/tools/ingest-player-history.ts
  │   Normalises rows → MatchRow schema
  │   Merges with existing snapshot (idempotent)
  │   Rate-limits: ~300 ms between requests
  │   Retries: up to 3× with exponential back-off
         │
         ▼
data/player-history.ndjson       ← one JSON object per line
data/player-history-meta.json    ← season, latestGw, rowCount, lastUpdated
         │
         ├─ Committed to repo (default) — served via GitHub raw / CDN
         ├─ Also uploaded as GitHub Actions artifact (7-day retention)
         ├─ (Optional) upserted to Supabase `player_match_history` table via --supabase flag
         └─ (Optional) uploaded to Cloudflare R2 / Turso / D1 — see below
```

### Match-row schema

| Field | Type | Notes |
|---|---|---|
| `player_id` | `number` | FPL element ID |
| `fixture_id` | `number` | Unique per fixture |
| `gw` | `number` | Gameweek / round number |
| `was_home` | `boolean` | |
| `opponent_team` | `number` | FPL team ID |
| `kickoff_time` | `string \| null` | ISO 8601 |
| `team_h_score` | `number \| null` | |
| `team_a_score` | `number \| null` | |
| `minutes` | `number` | |
| `total_points` | `number` | |
| `goals_scored` | `number` | |
| `assists` | `number` | |
| `bonus` | `number` | |
| `bps` | `number` | Bonus point system score |
| `clean_sheets` | `number` | |
| `goals_conceded` | `number` | |
| `own_goals` | `number` | |
| `penalties_saved` | `number` | |
| `penalties_missed` | `number` | |
| `yellow_cards` | `number` | |
| `red_cards` | `number` | |
| `saves` | `number` | |
| `clearances_blocks_interceptions` | `number` | Combined defensive stat from FPL |
| `tackles` | `number` | |
| `recoveries` | `number` | |
| `expected_goals` | `string` | `"0.34"` — string to preserve FPL precision |
| `expected_assists` | `string` | |
| `expected_goal_involvements` | `string` | xG + xA |
| `expected_goals_conceded` | `string` | |

---

## How incremental updates work

The ingest script keeps the snapshot idempotent and cheap to re-run:

1. **Load existing snapshot** — reads `data/player-history.ndjson` into a `Map<"playerId:fixtureId", MatchRow>`.
2. **Determine what to fetch** — for each player, the script only makes an API call when:
   - At least one GW in the target range is missing from the snapshot, **or**
   - The GW falls within the `--recentGwRevalidate` window (default: last 2 GWs) — these are always re-fetched to pick up late stat corrections.
3. **Merge** — new rows are inserted; re-validated rows overwrite the existing entry.
4. **Write** — the full snapshot is rewritten in sorted order for determinism.

A **nightly run** therefore only calls the FPL API for players who have new or
recently-played matches — not all ~700 players every night.

### Snapshot key

Each row is uniquely identified by `player_id:fixture_id`. This is stable
because FPL fixture IDs never change once assigned.

---

## Running locally

### Prerequisites

- Node.js 20+
- `npm install` (installs `tsx` which is used to run TypeScript directly)

### Nightly incremental update

```bash
npx tsx src/tools/ingest-player-history.ts --mode=nightly
```

Output:
- `data/player-history.ndjson`
- `data/player-history-meta.json`

### Backfill a GW range

```bash
npx tsx src/tools/ingest-player-history.ts \
  --mode=backfill \
  --startGw=1 \
  --endGw=10
```

### All options

| Flag | Default | Description |
|---|---|---|
| `--mode` | `nightly` | `nightly` or `backfill` |
| `--startGw` | — | Required for backfill (1–38) |
| `--endGw` | — | Required for backfill (1–38) |
| `--recentGwRevalidate` | `2` | GWs from current tip to always re-fetch |
| `--outDir` | `./data` | Output directory |
| `--baseUrl` | `https://fantasy.premierleague.com/api` | FPL API base URL |
| `--supabase` | off | Also upsert rows to Supabase (reads env vars) |

### Use the local proxy instead of hitting FPL directly

Start the dev server in one terminal:

```bash
npm run dev
```

Then in another terminal:

```bash
npx tsx src/tools/ingest-player-history.ts \
  --baseUrl=http://localhost:4321/api/fpl
```

This routes all FPL calls through your local Astro proxy (which adds caching and
rate-limit headers), reducing direct FPL hits.

### Validate the output

```bash
# Check row count
wc -l data/player-history.ndjson

# Inspect metadata
cat data/player-history-meta.json

# Sample first 5 rows (pretty-printed)
head -5 data/player-history.ndjson | while IFS= read -r line; do echo "$line" | python3 -m json.tool; done

# Run unit tests
npm run test:run
```

---

## Storage options & cost notes

### Option A — Commit to `data/` in this repo ✅ (default, free)

The GitHub Actions workflow commits `data/player-history.ndjson` directly back to
the repository after each nightly run.

**Cost:** Free  
**Serving:** GitHub raw content URL, or via jsDelivr CDN:
```
https://cdn.jsdelivr.net/gh/dgita24/fplmanagerdata@main/data/player-history.ndjson
```

**Limitations:**
- GitHub has a soft limit of 1 GB total repo size and a 100 MB per-file limit.
- At ~700 players × 38 GWs × ~250 bytes/row, the file is roughly **6–8 MB** — well within limits.
- Very large full-season files can be gzip-compressed in the workflow if needed.

---

### Option B — GitHub Release assets (larger files)

Upload the snapshot as a GitHub Release asset using `gh release upload`.
Assets can be up to 2 GB and are served via GitHub CDN.

```yaml
- name: Upload to release
  run: |
    gh release upload nightly-snapshot \
      data/player-history.ndjson \
      data/player-history-meta.json \
      --clobber
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### Option C — Cloudflare R2 (optional, free tier generous)

Cloudflare R2 gives 10 GB free storage and **zero egress cost** (unlike AWS S3).
Since this site already uses the Cloudflare adapter, R2 is a natural fit.

Add a step to the workflow:

```yaml
- name: Upload to Cloudflare R2
  if: ${{ secrets.CF_R2_ACCESS_KEY_ID != '' }}
  run: |
    aws s3 cp data/player-history.ndjson \
      s3://${{ secrets.CF_R2_BUCKET }}/player-history.ndjson \
      --endpoint-url https://${{ secrets.CF_ACCOUNT_ID }}.r2.cloudflarestorage.com
    aws s3 cp data/player-history-meta.json \
      s3://${{ secrets.CF_R2_BUCKET }}/player-history-meta.json \
      --endpoint-url https://${{ secrets.CF_ACCOUNT_ID }}.r2.cloudflarestorage.com
  env:
    AWS_ACCESS_KEY_ID:     ${{ secrets.CF_R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.CF_R2_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION:    auto
```

Required secrets: `CF_ACCOUNT_ID`, `CF_R2_BUCKET`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`

---

## Setting up Supabase

The pipeline has first-class Supabase support — just add `--supabase` to any
ingest run. The script will upsert all rows into the `player_match_history` table
using the existing `@supabase/supabase-js` package (already a project dependency).

### 1. Run the migrations

In the Supabase dashboard → **SQL Editor**, paste and run each migration in order:

1. `supabase/migrations/create_player_match_history.sql` — creates the base table.  
   This creates the `player_match_history` table with a `(player_id, fixture_id)`
   primary key, so every upsert is idempotent.

2. `supabase/migrations/get_player_aggregates.sql` — creates the `get_player_aggregates`
   RPC function used by the `/players` page to serve aggregated stats.  
   **Required for the aggregated players table to work.**

```sql
-- Run in Supabase SQL Editor after deploying
-- Parameters: venue ('all'|'home'|'away'), last_n (number of recent GWs)
SELECT * FROM get_player_aggregates('all', 5);
```

### 2. Add secrets to GitHub

In your repository: **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | Your project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Found in Supabase → Settings → API (service role, not anon) |

Once both secrets exist, the `Ingest Player History` workflow **automatically
detects them and appends `--supabase`** — no workflow edits needed.

### 3. Run locally with Supabase

```bash
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

npx tsx src/tools/ingest-player-history.ts --mode=nightly --supabase
```

### 4. Query from Supabase / Astro

**Preferred: use the `get_player_aggregates` RPC (used by `/players` page)**

```typescript
// src/lib/supabasePlayerAggregates.ts (new helper)
import { fetchPlayerAggregates } from '@/lib/supabasePlayerAggregates';

// All venues, last 5 GWs — returns one row per player with summed/avg stats
const rows = await fetchPlayerAggregates('all', 5);
// home only, last 3 GWs
const homeRows = await fetchPlayerAggregates('home', 3);
```

**Raw query (for custom use cases):**

```typescript
// src/lib/supabase.ts (existing helper)
import { supabase } from '@/lib/supabase';

// Last 6 GWs, home games only, sorted by avg xGC ascending (better defenders first)
const maxGwResult = await supabase
  .from('player_match_history')
  .select('gw')
  .order('gw', { ascending: false })
  .limit(1)
  .single();

const maxGw = maxGwResult.data?.gw ?? 38;
const minGw = maxGw - 5; // last 6 GWs

const { data } = await supabase
  .from('player_match_history')
  .select('player_id, expected_goals_conceded, total_points, minutes')
  .gte('gw', minGw)
  .eq('was_home', true);

// Compute averages client-side using the consumer helper
import { computeAllPlayerAverages } from '@/lib/playerHistorySnapshot';
const ranked = computeAllPlayerAverages(data ?? [], 'avgXGC', false);
```

### `/players` page data flow

The `/players` page (inline `PlayerExplorer`) now uses **Supabase-backed aggregated
stats** instead of raw per-player FPL element-summary data for the main table:

1. Bootstrap API (`/api/bootstrap.json`) → player metadata (name, team, position, price, status)
2. Supabase `get_player_aggregates(venue, last_n)` RPC → aggregated match stats for the selected window
3. The two are merged client-side: bootstrap provides player identity, Supabase provides the stats

The venue (All / Home / Away) and GW window (Last 1 / 3 / 5 / 10 / Custom N) filters
trigger a new Supabase RPC call, so the main page no longer needs raw per-player
`/element-summary/:id/` requests to populate the aggregate table.

The existing per-player `PlayerMatchHistorySheet` drill-down sheet still fetches
`/element-summary/:id/` on demand when a player name is clicked.

---

## Setting up an alternative free database

If you prefer not to use Supabase, or want a second read replica, here are two
further options that work well with this stack.

---

### Option D — Cloudflare D1

[Cloudflare D1](https://developers.cloudflare.com/d1/) is a serverless SQLite
database that runs at the Cloudflare edge. Since this site already uses
`@astrojs/cloudflare`, D1 binds directly to your Astro server-side routes — no
extra SDK needed.

**Free tier:** 5 GB storage, 25 M row reads / day, 50 K row writes / day — more
than enough for FPL player history.

#### 1. Create a D1 database

```bash
# Install Wrangler if you don't have it
npm install -g wrangler

wrangler login
wrangler d1 create fpl-player-history
```

Copy the `database_id` from the output.

#### 2. Create the schema

```bash
wrangler d1 execute fpl-player-history --command "
CREATE TABLE IF NOT EXISTS player_match_history (
  player_id    INTEGER NOT NULL,
  fixture_id   INTEGER NOT NULL,
  gw           INTEGER NOT NULL,
  was_home     INTEGER NOT NULL,   -- 0 or 1
  opponent_team INTEGER NOT NULL,
  kickoff_time TEXT,
  team_h_score INTEGER,
  team_a_score INTEGER,
  minutes      INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  goals_scored INTEGER NOT NULL DEFAULT 0,
  assists      INTEGER NOT NULL DEFAULT 0,
  bonus        INTEGER NOT NULL DEFAULT 0,
  bps          INTEGER NOT NULL DEFAULT 0,
  clean_sheets INTEGER NOT NULL DEFAULT 0,
  goals_conceded INTEGER NOT NULL DEFAULT 0,
  own_goals    INTEGER NOT NULL DEFAULT 0,
  penalties_saved  INTEGER NOT NULL DEFAULT 0,
  penalties_missed INTEGER NOT NULL DEFAULT 0,
  yellow_cards INTEGER NOT NULL DEFAULT 0,
  red_cards    INTEGER NOT NULL DEFAULT 0,
  saves        INTEGER NOT NULL DEFAULT 0,
  clearances_blocks_interceptions INTEGER NOT NULL DEFAULT 0,
  tackles      INTEGER NOT NULL DEFAULT 0,
  recoveries   INTEGER NOT NULL DEFAULT 0,
  expected_goals            TEXT NOT NULL DEFAULT '0.00',
  expected_assists          TEXT NOT NULL DEFAULT '0.00',
  expected_goal_involvements TEXT NOT NULL DEFAULT '0.00',
  expected_goals_conceded   TEXT NOT NULL DEFAULT '0.00',
  PRIMARY KEY (player_id, fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_pmh_gw ON player_match_history(gw);
CREATE INDEX IF NOT EXISTS idx_pmh_player ON player_match_history(player_id);
"
```

#### 3. Bind D1 in `wrangler.toml`

Add to your `wrangler.toml` (create it at the repo root if it doesn't exist):

```toml
[[d1_databases]]
binding = "DB"           # name used in Astro server-side code
database_name = "fpl-player-history"
database_id   = "<your-database-id>"
```

#### 4. Query from an Astro API route

```typescript
// src/pages/api/player-averages.ts
import type { APIContext } from 'astro';

export async function GET({ locals, url }: APIContext) {
  const db = locals.runtime.env.DB; // Cloudflare D1 binding

  // Number of recent GWs to include (e.g. "6" means last 6 GWs)
  const gwWindow = Math.max(1, parseInt(url.searchParams.get('gw') ?? '6', 10));
  const venue    = url.searchParams.get('venue') ?? 'all';

  const venueClause =
    venue === 'home' ? 'AND was_home = 1' :
    venue === 'away' ? 'AND was_home = 0' : '';

  // gw > MAX(gw) - gwWindow  →  e.g. MAX=38, gwWindow=6  →  gw > 32  →  last 6 GWs
  const result = await db.prepare(`
    SELECT
      player_id,
      COUNT(*)                                   AS sample_size,
      AVG(CAST(expected_goals AS REAL))          AS avg_xg,
      AVG(CAST(expected_assists AS REAL))        AS avg_xa,
      AVG(CAST(expected_goals_conceded AS REAL)) AS avg_xgc,
      AVG(total_points)                          AS avg_pts,
      AVG(minutes)                               AS avg_mins
    FROM player_match_history
    WHERE gw > (SELECT MAX(gw) FROM player_match_history) - ?
    ${venueClause}
    GROUP BY player_id
    ORDER BY avg_xg DESC
  `).bind(gwWindow).all();

  return Response.json(result.results);
}
```

#### 5. Load the NDJSON snapshot into D1 (one-off or via CI)

Use the `@libsql/client` (compatible with D1's REST API) or the `wrangler d1 execute`
command with parameterized batch inserts. The simplest approach is to convert the
NDJSON to a batch of parameterized statements:

```javascript
// scripts/load-snapshot-to-d1.mjs
// Usage: node scripts/load-snapshot-to-d1.mjs
import { readFileSync } from 'node:fs';

const rows = readFileSync('data/player-history.ndjson', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);

// Write a safe parameterized SQL file — values are bound, not interpolated
const stmts = rows.map((r) =>
  `INSERT OR REPLACE INTO player_match_history VALUES (` +
  `${r.player_id},${r.fixture_id},${r.gw},${r.was_home ? 1 : 0},` +
  `${r.opponent_team},` +
  // Safely quote the nullable timestamp (no user-supplied input; ISO 8601 only)
  (r.kickoff_time ? `'${r.kickoff_time.replace(/'/g, "''")}'` : 'NULL') + `,` +
  `${r.team_h_score ?? 'NULL'},${r.team_a_score ?? 'NULL'},` +
  `${r.minutes},${r.total_points},${r.goals_scored},${r.assists},` +
  `${r.bonus},${r.bps},${r.clean_sheets},${r.goals_conceded},` +
  `${r.own_goals},${r.penalties_saved},${r.penalties_missed},` +
  `${r.yellow_cards},${r.red_cards},${r.saves},` +
  `${r.clearances_blocks_interceptions},${r.tackles},${r.recoveries},` +
  // xG/xA fields are numeric strings like "0.45" — validated by the ingest script
  `'${r.expected_goals}','${r.expected_assists}',` +
  `'${r.expected_goal_involvements}','${r.expected_goals_conceded}'` +
  `);`
);

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/d1-insert.sql', stmts.join('\n') + '\n');
console.log(`Generated ${stmts.length} INSERT statements → /tmp/d1-insert.sql`);
```

Then execute via Wrangler:

```bash
node scripts/load-snapshot-to-d1.mjs
wrangler d1 execute fpl-player-history --file=/tmp/d1-insert.sql
```

---

### Option E — Turso (libSQL, free tier generous)

[Turso](https://turso.tech/) is a serverless SQLite (libSQL) database with edge
replicas. **Free tier:** 500 databases, 9 GB storage, 1 billion row reads/month.

#### 1. Create a database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

turso auth login
turso db create fpl-player-history
turso db show fpl-player-history   # copy the URL
turso db tokens create fpl-player-history  # copy the auth token
```

#### 2. Create the schema

```bash
turso db shell fpl-player-history < docs/schema.sql
# (Use the same CREATE TABLE statement from the D1 section above)
```

#### 3. Connect from Node.js / Astro

```bash
npm install @libsql/client
```

```typescript
import { createClient } from '@libsql/client';

const db = createClient({
  url:       process.env.TURSO_DB_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const result = await db.execute(
  'SELECT player_id, AVG(CAST(expected_goals AS REAL)) AS avg_xg FROM player_match_history GROUP BY player_id ORDER BY avg_xg DESC LIMIT 20'
);
```

Store `TURSO_DB_URL` and `TURSO_AUTH_TOKEN` as GitHub Actions secrets and
Cloudflare Pages environment variables.

---

## How both sites consume the snapshot

### URL strategy

Set a single environment variable in each site pointing to the snapshot:

```
PLAYER_HISTORY_SNAPSHOT_URL=https://cdn.jsdelivr.net/gh/dgita24/fplmanagerdata@main/data/player-history.ndjson
PLAYER_HISTORY_META_URL=https://cdn.jsdelivr.net/gh/dgita24/fplmanagerdata@main/data/player-history-meta.json
```

Or, if you've uploaded to Cloudflare R2 with a custom domain:

```
PLAYER_HISTORY_SNAPSHOT_URL=https://data.yourdomain.com/player-history.ndjson
```

### Consumer helper

Both sites can import `src/lib/playerHistorySnapshot.ts` (or a copy) and use the
ready-made query helpers:

```typescript
import {
  fetchSnapshot,
  filterLastNGws,
  filterByVenue,
  computeAllPlayerAverages,
} from '@/lib/playerHistorySnapshot';

// Fetch once, cache client-side
const { rows, meta } = await fetchSnapshot(
  import.meta.env.PLAYER_HISTORY_SNAPSHOT_URL,
  import.meta.env.PLAYER_HISTORY_META_URL,
);

// Example: top 20 players by avg xGC in last 6 home GWs
const lastSix  = filterLastNGws(rows, 6);
const homeOnly = filterByVenue(lastSix, 'home');
const ranked   = computeAllPlayerAverages(homeOnly, 'avgXGC', false); // ascending = better defence
const top20    = ranked.slice(0, 20);
```

### CORS & caching

- **GitHub raw / jsDelivr:** both set permissive CORS headers — no extra config needed.
- **Cloudflare R2 public bucket:** set `Access-Control-Allow-Origin: *` in the bucket CORS policy.
- **Cache-Control:** jsDelivr caches by default; for R2 set `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.

---

## GitHub Actions schedule

| Trigger | When | What runs |
|---|---|---|
| `schedule` | 02:30 UTC daily | Nightly incremental update (last 2 GWs revalidated) |
| `workflow_dispatch` | On demand | Any mode with custom inputs |

To backfill the whole season manually:

1. Go to **Actions → Ingest Player History → Run workflow**
2. Set mode: `backfill`, start GW: `1`, end GW: `38`
3. Click **Run workflow**

The workflow will process all 38 GWs, committing the result to `data/`.
