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

## Documentation

- [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) - Caching infrastructure rollout plan
- [TESTING_CHARACTERIZATION.md](./TESTING_CHARACTERIZATION.md) - Testing guide and test suite documentation
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [DEFCON_SETUP.md](./DEFCON_SETUP.md) - Deployment configuration