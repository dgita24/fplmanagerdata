# FPL Get Manager Data

Website version of my Excel/PowerQuery Fantasy Premier League tracker.

Built with Astro and deployed on Cloudflare Pages.

## Development

### Installation

```bash
npm install
```

### Running Locally

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Testing

This project uses [Vitest](https://vitest.dev/) for testing.

```bash
# Run tests in watch mode
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI
npm run test:ui
```

See [TESTING_CHARACTERIZATION.md](./TESTING_CHARACTERIZATION.md) for details about the test suite.

## Caching Infrastructure

This project includes a server-side caching infrastructure for FPL API responses. The caching system:
- Is controlled by the `FPL_CACHE_ENABLED` environment variable (default: `false`)
- When disabled: acts as a transparent passthrough (zero impact)
- When enabled: uses Cloudflare Workers Cache API with per-endpoint TTLs

See [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) for the phased rollout strategy.

## Player History Pipeline

An off-peak ingestion pipeline that fetches per-player per-match FPL stats (xG, xA, xGC, defensive stats, etc.) and stores them as a static NDJSON snapshot. Here is where every related file lives:

### Run it

```bash
# Nightly incremental update (only fetches what's new)
npx tsx src/tools/ingest-player-history.ts --mode=nightly

# Backfill a full season into the snapshot AND into Supabase
npx tsx src/tools/ingest-player-history.ts --mode=backfill --startGw=1 --endGw=38 --supabase
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your environment when using `--supabase`.

### File map

| What | Where |
|---|---|
| **Ingest script** (fetches FPL API → NDJSON + optional Supabase upsert) | [`src/tools/ingest-player-history.ts`](./src/tools/ingest-player-history.ts) |
| **Consumer helper** (parse, filter last-N GWs, compute averages) | [`src/lib/playerHistorySnapshot.ts`](./src/lib/playerHistorySnapshot.ts) |
| **Unit tests** for the consumer helper | [`src/lib/__tests__/playerHistorySnapshot.test.ts`](./src/lib/__tests__/playerHistorySnapshot.test.ts) |
| **GitHub Actions workflow** (nightly schedule + manual backfill dispatch) | [`.github/workflows/ingest-player-history.yml`](./.github/workflows/ingest-player-history.yml) |
| **Supabase migration** (creates `player_match_history` table) | [`supabase/migrations/create_player_match_history.sql`](./supabase/migrations/create_player_match_history.sql) |
| **Snapshot output** (generated at runtime, committed by CI) | [`data/player-history.ndjson`](./data/player-history.ndjson) · [`data/player-history-meta.json`](./data/player-history-meta.json) |
| **Full pipeline documentation** | [`docs/player-history-pipeline.md`](./docs/player-history-pipeline.md) |

See [`docs/player-history-pipeline.md`](./docs/player-history-pipeline.md) for the full architecture, all CLI options, Supabase setup steps, and how to consume the snapshot in both sites.

---

## Documentation

- [docs/player-history-pipeline.md](./docs/player-history-pipeline.md) - Player history pipeline: architecture, CLI options, Supabase + D1 + Turso setup
- [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) - Caching infrastructure rollout plan
- [TESTING_CHARACTERIZATION.md](./TESTING_CHARACTERIZATION.md) - Testing guide and test suite documentation
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [DEFCON_SETUP.md](./DEFCON_SETUP.md) - Deployment configuration