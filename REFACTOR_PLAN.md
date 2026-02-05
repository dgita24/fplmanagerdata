# Refactor Plan: FPL Data-Fetching Modularization & Caching Infrastructure

## Overview

This document outlines the phased approach to introducing server-side caching with per-endpoint TTLs to the FPL Manager Data application. The implementation follows a "safety-first" strategy with feature flags and gradual rollout.

## Goals

1. **Modularize** FPL data-fetching code for better maintainability
2. **Introduce** server-side caching infrastructure using Cloudflare Workers Cache API
3. **Reduce** upstream API load while maintaining data freshness
4. **Preserve** all existing behavior - no changes to API responses, UI, or error handling
5. **Enable** per-endpoint TTL configuration for flexible caching policies

## Architectural Changes

### Before
```
Client Request → API Proxy → FPL API → Response
```

### After (Feature Flag ON)
```
Client Request → API Proxy → Cache Wrapper → Cache Check → FPL API → Response
                                           ↓
                                    Cache Hit → Response
```

### New Components

1. **`src/lib/fpl/cache.ts`**: Generic cache-aside wrapper with feature flag
2. **`src/lib/fpl/cachePolicy.ts`**: TTL definitions and cache key management
3. **Characterization Tests**: Safety net for behavior preservation

## Implementation Phases

### Phase 1: Foundation & Safety Net ✅ COMPLETED
**Commit 1**: Add Vitest and characterization tests

- Added Vitest testing framework
- Created 22 characterization tests for API proxy and fplLive.ts functions
- Documented testing approach in TESTING_CHARACTERIZATION.md
- All tests passing, establishing baseline behavior

**Risk Level**: 🟢 None (no code changes)

---

### Phase 2: Cache Infrastructure ✅ COMPLETED
**Commit 2**: Cache modules with feature flag OFF

- Implemented `src/lib/fpl/cache.ts` with `getOrSet()` function
- Implemented `src/lib/fpl/cachePolicy.ts` with TTL definitions
- Added 23 unit tests for cache modules
- Feature flag `FPL_CACHE_ENABLED` defaults to `false` (passthrough mode)
- When disabled: zero impact, acts as direct passthrough

**Risk Level**: 🟢 None (passthrough mode, no behavior change)

---

### Phase 3: Proxy Integration ✅ COMPLETED
**Commit 3**: Wire API proxy to cache wrapper with flag OFF

- Updated `src/pages/api/fpl/[...path].ts` to route through cache
- Preserved all existing behavior:
  - Status codes (200, 404, 500, etc.)
  - Response headers (Content-Type, CORS, Cache-Control)
  - Error handling and messages
  - Logging behavior
- Cache operates in passthrough mode (flag OFF)
- All 45 tests passing
- Application builds successfully

**Risk Level**: 🟢 None (passthrough mode, verified by tests)

---

### Phase 4: Controlled Rollout (Future Commits)

#### Commit 4: Enable caching for bootstrap-static endpoint

**What**:
- Update `CACHE_ALLOWLIST` in `cachePolicy.ts` to enable caching for `bootstrap-static`
- Set environment variable `FPL_CACHE_ENABLED=true` in Cloudflare Pages deployment
- TTL: 3600 seconds (1 hour)

**Rationale**:
- Bootstrap-static contains team/player lists that change infrequently
- Long TTL (1 hour) is safe and provides significant load reduction
- Low-risk first endpoint to validate caching infrastructure

**Testing**:
1. Deploy to preview environment
2. Verify cache hit/miss logs in Cloudflare Pages logs
3. Confirm response is identical to uncached version
4. Monitor for 24 hours for issues
5. If successful, merge to production

**Rollback**: Set `FPL_CACHE_ENABLED=false` in environment

**Risk Level**: 🟡 Low (static data, long TTL, easily rolled back)

---

#### Commit 5: Enable caching for event/{gw}/live endpoint

**What**:
- Update `CACHE_ALLOWLIST` to enable pattern `event/*/live`
- TTL: 30 seconds (near real-time)

**Rationale**:
- Live gameweek data changes frequently but 30s staleness is acceptable
- Most frequently accessed endpoint during live matches
- Highest potential for load reduction

**Testing**:
1. Deploy to preview during live gameweek
2. Verify live scores update within 30 seconds
3. Compare cached vs uncached responses for consistency
4. Monitor cache hit rate and response times
5. Validate during high-traffic period (multiple simultaneous matches)

**Rollback**: Remove `event/*/live` from allowlist

**Risk Level**: 🟡 Medium (live data, requires validation during gameweek)

---

#### Commit 6: Enable caching for fixtures endpoint

**What**:
- Add `fixtures` to `CACHE_ALLOWLIST`
- TTL: 300 seconds (5 minutes)

**Testing**:
1. Deploy to preview
2. Verify fixture updates appear within 5 minutes
3. Test with various query parameters (`?event=10`, etc.)

**Risk Level**: 🟢 Low (fixture data changes infrequently)

---

#### Commit 7: Enable caching for remaining endpoints

**What**:
- Add patterns for:
  - `element-summary/*` (TTL: 300s)
  - `entry/*` (TTL: 60-300s depending on subpath)

**Testing**:
- Comprehensive end-to-end testing of all features
- User acceptance testing
- Performance monitoring

**Risk Level**: 🟡 Medium (broader impact, requires thorough testing)

---

## Configuration Management

### Environment Variables

```bash
# Feature flag (default: false)
FPL_CACHE_ENABLED=true|false
```

### Cloudflare Pages Configuration

**Development/Preview**:
- Set `FPL_CACHE_ENABLED=true` in preview environment variables
- Test each phase in preview before production

**Production**:
- Enable flag only after successful preview validation
- Monitor Cloudflare Analytics for cache hit rates
- Watch error rates in Cloudflare Pages logs

## Monitoring & Metrics

### Cache Metrics Logged

When `FPL_CACHE_ENABLED=true`, the cache logs:
```
[CACHE HIT] fpl:bootstrap-static at 2026-02-05T10:30:00.000Z (TTL: 3600s)
[CACHE MISS] fpl:event/10/live at 2026-02-05T10:30:01.000Z (TTL: 30s)
[CACHE STALE] fpl:fixtures?event=10 at 2026-02-05T10:30:02.000Z (TTL: 300s)
[CACHE ERROR] fpl:bootstrap-static at 2026-02-05T10:30:03.000Z (TTL: 3600s)
```

### Key Performance Indicators

1. **Cache Hit Rate**: Target >70% for bootstrap-static, >50% for live data
2. **Response Time**: Should improve or stay same (never degrade)
3. **Error Rate**: Must not increase
4. **Upstream API Calls**: Should decrease proportional to hit rate

### Alerting

Monitor for:
- Increased 5xx error rates
- Cache operation failures
- Unexpected cache misses
- Response time degradation

## Deployment Process

### PR Preview Environment

**Important**: Opening this PR creates a Cloudflare Pages **preview deployment**, not a production deployment. The preview:
- Has its own isolated environment
- Does not affect production users
- Safe for testing and validation
- Accessible via `<branch-name>.fplmanagerdata.pages.dev`

**Production Deployment**: Only happens after PR is **merged** to main branch.

### Deployment Steps

1. **PR Created**: Preview deployment auto-created by Cloudflare Pages
2. **Testing**: Validate in preview environment
3. **Review**: Code review and approval
4. **Merge**: PR merged to main
5. **Production**: Cloudflare Pages auto-deploys to production

### Gradual Rollout in Production

After merge to main:

1. **Day 1**: Deploy with `FPL_CACHE_ENABLED=false` (no-op)
2. **Day 2**: Enable flag, add bootstrap-static to allowlist
3. **Day 3-4**: Monitor metrics, validate behavior
4. **Day 5**: Add event/{gw}/live to allowlist
5. **Week 2**: Monitor during full gameweek
6. **Week 3+**: Gradually enable remaining endpoints

## Rollback Procedures

### Immediate Rollback (Emergency)
```bash
# In Cloudflare Pages dashboard, set:
FPL_CACHE_ENABLED=false
```
Effect: Instant passthrough mode, zero caching impact

### Per-Endpoint Rollback
Remove endpoint from `CACHE_ALLOWLIST` in `cachePolicy.ts`:
1. Remove entry from allowlist
2. Commit and push
3. Cloudflare Pages auto-deploys within minutes

### Full Rollback
Revert to commit before Phase 2:
```bash
git revert <commit-hash>
git push
```

## Testing Checklist

### Before Each Phase
- [ ] All unit tests passing (`npm run test:run`)
- [ ] Application builds successfully (`npm run build`)
- [ ] Characterization tests verify behavior preservation
- [ ] Preview deployment accessible and functional

### After Each Phase
- [ ] Cache metrics logged correctly
- [ ] Response format unchanged
- [ ] Headers preserved (CORS, Cache-Control, etc.)
- [ ] Error handling works as before
- [ ] No new console errors
- [ ] Live functionality works end-to-end

### Specific Test Scenarios

**Bootstrap-static**:
- [ ] Full player list returned
- [ ] Team data complete
- [ ] Response cached for 1 hour
- [ ] Subsequent requests use cache

**Event Live**:
- [ ] Live scores update within 30s
- [ ] Bonus points calculation correct
- [ ] Auto-subs work as expected
- [ ] Cache refreshes every 30s

**Fixtures**:
- [ ] All fixtures returned
- [ ] Query parameters work (`?event=10`)
- [ ] Started/finished flags correct

## Risk Assessment

### Overall Risk: 🟡 LOW-MEDIUM

**Mitigation Factors**:
1. ✅ Feature flag with default OFF
2. ✅ Comprehensive test suite (45 tests)
3. ✅ Gradual rollout per endpoint
4. ✅ Instant rollback capability
5. ✅ Preview environment for validation
6. ✅ No changes to existing behavior when disabled

### Risk by Component

| Component | Risk | Mitigation |
|-----------|------|------------|
| Characterization Tests | 🟢 None | Tests document current behavior |
| Cache Infrastructure | 🟢 Low | Passthrough when disabled |
| Proxy Integration | 🟢 Low | Verified by tests, flag OFF |
| bootstrap-static Cache | 🟡 Low | Static data, long TTL |
| event/live Cache | 🟡 Medium | Requires gameweek validation |
| Other Endpoints | 🟡 Medium | Broader testing needed |

## Success Criteria

### Technical
- [ ] All tests passing (100% pass rate)
- [ ] Zero increase in error rates
- [ ] Response times improved or unchanged
- [ ] Cache hit rate >60% for enabled endpoints
- [ ] 50%+ reduction in upstream API calls

### Business
- [ ] No user-reported issues
- [ ] No observable behavior changes
- [ ] Improved page load times
- [ ] Reduced infrastructure costs
- [ ] Better resilience during peak load

## Timeline

- **Week 1**: Phases 1-3 (Foundation) ✅ COMPLETED
- **Week 2**: Phase 4, Commit 4 (bootstrap-static)
- **Week 3**: Phase 4, Commit 5 (event/live validation)
- **Week 4**: Phase 4, Commits 6-7 (remaining endpoints)
- **Week 5+**: Full production rollout and monitoring

## Questions & Answers

**Q: Does opening this PR deploy to production?**
A: No. Opening the PR creates a preview deployment for testing. Production deployment only happens after merging to main.

**Q: What happens if caching breaks something?**
A: Set `FPL_CACHE_ENABLED=false` for instant rollback to passthrough mode. No code changes needed.

**Q: How do we test caching is working?**
A: Check Cloudflare Pages logs for `[CACHE HIT]`, `[CACHE MISS]` messages. Compare response times between cached and uncached requests.

**Q: Can we cache different endpoints with different TTLs?**
A: Yes. `cachePolicy.ts` defines TTL per endpoint pattern. Easily configurable.

**Q: What if upstream API changes format?**
A: Cache respects upstream responses. Format changes pass through. May need to update tests.

**Q: How long does cache take to clear?**
A: Cache entries expire based on TTL. For manual clear, set `FPL_CACHE_ENABLED=false` temporarily.

**Q: Is this safe during live gameweeks?**
A: Yes with 30s TTL for live data. Validate in preview first. Can disable specific endpoints via allowlist.

## References

- Characterization Testing: `TESTING_CHARACTERIZATION.md`
- Cloudflare Workers Cache API: https://developers.cloudflare.com/workers/runtime-apis/cache/
- Astro Cloudflare Adapter: https://docs.astro.build/en/guides/integrations-guide/cloudflare/

## Change Log

- 2026-02-05: Initial plan created
- 2026-02-05: Phases 1-3 completed, all tests passing
- TBD: Phase 4 rollout begins
