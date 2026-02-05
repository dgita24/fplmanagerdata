# Characterization Testing Guide

## Overview

This document describes the characterization test suite created to lock in the current behavior of the FPL data-fetching and computation code. These tests serve as a "safety net" during refactoring to ensure no observable behavior changes are introduced.

## What are Characterization Tests?

Characterization tests (also known as "golden tests" or "snapshot tests") capture the existing behavior of a system without requiring detailed specifications. They are particularly useful when:
- Refactoring legacy code
- Adding test coverage to untested code
- Ensuring behavior preservation during architectural changes

## Test Suite Structure

### 1. API Proxy Tests (`src/pages/api/fpl/__tests__/proxy.test.ts`)

Tests for the FPL API proxy endpoint (`src/pages/api/fpl/[...path].ts`):

- **Successful proxy passthrough**: Verifies that successful responses from the upstream FPL API are correctly forwarded
- **Upstream non-ok error response**: Tests handling of HTTP error status codes (404, 500, etc.)
- **Thrown fetch error behavior**: Validates error handling when fetch throws an exception
- **Query string passthrough**: Ensures query parameters are preserved in proxied requests
- **Headers preservation**: Documents and validates response header behavior

### 2. FPL Live Computation Tests (`src/lib/__tests__/fplLive.test.ts`)

Tests for pure computation functions in `src/lib/fplLive.ts`:

#### `bonusFromBpsRows` Tests
- Normal 3-2-1 bonus distribution
- Two-way tie for first place (both get 3, next gets 1)
- Three-way tie for first place (all get 3)
- Two-way tie for second place (top gets 3, tied get 2)
- Single player scenarios
- Empty input handling
- Invalid data filtering
- Multiple ties for third place

#### `getPlayerLiveComputed` Tests
- Finished match with confirmed bonus
- Live match with projected bonus
- Player not started (should return 0)
- Finished provisional with bonus confirmed on provisional flag
- Finished provisional without bonus confirmed (shows projection)
- Disabled projected bonus during live matches

#### `getTeamGwStatus` Tests
- Team status lookup from cache
- Missing team status (returns default)

## Running the Tests

### Prerequisites

```bash
npm install
```

This will install Vitest and related dependencies.

### Running Tests

```bash
# Run tests in watch mode (interactive)
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI
npm run test:ui
```

### Test Output

Tests use Vitest's assertion library. A passing test suite means:
- All documented behaviors are preserved
- No regressions have been introduced
- The refactoring is safe to proceed

## Test Coverage

The characterization tests cover:
1. **API proxy handler**: All success/error paths
2. **Bonus calculation**: Edge cases including ties and invalid data
3. **Live computation**: Various game states and configuration flags

## Using Tests During Refactoring

### Before Making Changes
1. Ensure all characterization tests pass
2. Review test cases to understand current behavior
3. Run `npm run test:run` to establish baseline

### While Refactoring
1. Make small, incremental changes
2. Run tests frequently: `npm test` (in watch mode)
3. If a test fails, either:
   - Fix your change to preserve behavior, OR
   - If intentional, update the test with documentation

### After Changes
1. Verify all tests still pass
2. Add new tests for new functionality
3. Update documentation if behavior intentionally changed

## Adding New Characterization Tests

When adding new tests:
1. Document the behavior being locked in
2. Use descriptive test names explaining the scenario
3. Include edge cases and error conditions
4. Add comments explaining why the behavior is expected

Example:
```typescript
/**
 * Test: Two-way tie for first place
 * Both players get 3 bonus, next player gets 1
 */
it('should give 3 bonus to tied top scorers and 1 to next', () => {
  // Test implementation
});
```

## Continuous Integration

These tests should run:
- On every commit
- Before merging pull requests
- As part of the deployment pipeline

## Troubleshooting

### Test Failures After Refactoring

1. **Review the failure**: Understand what behavior changed
2. **Check if intentional**: Is this a bug fix or feature change?
3. **Update or fix**:
   - If unintentional: Fix your code
   - If intentional: Update test with clear documentation

### Flaky Tests

If tests are intermittent:
1. Check for timing issues or async problems
2. Ensure proper test isolation (no shared state)
3. Use Vitest's retry mechanisms if needed

### Adding Dependencies

The test suite uses:
- `vitest`: Test runner and assertions
- `@vitest/ui`: Optional UI for test exploration
- `happy-dom`: Browser-like environment for tests

To add more:
```bash
npm install --save-dev <package-name>
```

## References

- [Vitest Documentation](https://vitest.dev/)
- [Characterization Testing (Working Effectively with Legacy Code)](https://en.wikipedia.org/wiki/Characterization_test)
