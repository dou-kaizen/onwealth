---
phase: 1
title: "Critical & High Fixes"
status: completed
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Critical & High Fixes

## Overview

Fix the 1 Critical + 4 High behavioral/contract bugs (#1-#5). Each behavioral
fix ships with a regression test. These are the bugs that break production HTTP
responses or break the moment a 2nd app consumes the shared packages.

## Requirements

- Functional: `withTimeout` works against real Postgres; rate-limited responses
  carry RFC 6585 headers; shared modules resolve DI standalone; `cache.wrap`
  caches `undefined`-returning fns; pool errors flow through structured logging.
- Non-functional: no API contract regressions; all existing tests stay green.

## Architecture

Each fix is local to one file plus its test. No cross-cutting redesign. The
throttler fix is a registration-order change in the shared bootstrap unit
(`configure-http-app.ts`) — verified by an e2e test through `apps/api`.

## Related Code Files

- Modify: `packages/shared-kernel/src/database/db.helpers.ts` (#1)
- Modify: `packages/nest-http/src/bootstrap/configure-http-app.ts` (#2)
- Modify: `packages/shared-kernel/src/events/domain-events.module.ts` (#3)
- Modify: `packages/shared-kernel/src/database/db.module.ts` (#3)
- Modify: `packages/shared-kernel/src/cache/cache.module.ts` (#3)
- Modify: `packages/shared-kernel/src/cache/cache.service.ts` (#4)
- Modify: `packages/shared-kernel/src/database/db.provider.ts` (#5)
- Create: `apps/api/src/__tests__/integration/throttler-headers.spec.ts` (#2)
- Create: `packages/shared-kernel/src/cache/__tests__/cache.service.spec.ts` (#4)
- Modify: `apps/api/src/__tests__/integration/di-token-identity.spec.ts` (#1, add `withTimeout` case)

## Implementation Steps

1. **#1 `withTimeout` SQL** — replace
   `sql\`SET LOCAL statement_timeout = ${String(ms)}\`` with
   `sql\`SELECT set_config('statement_timeout', ${String(ms)}, true)\``.
   `set_config(..., true)` is a regular function (accepts bound params) and is
   transaction-local — same PgBouncer safety as `SET LOCAL`. Guard the input:
   reject `ms <= 0` (throw, before issuing SQL) — a non-positive timeout would
   disable the timeout or error. Update the JSDoc. Add an integration test: run
   a query under `withTimeout` against the CI Postgres container, assert no
   syntax error; add a `pg_sleep`-longer-than-`ms` case asserting the query
   aborts with `57014` (statement_timeout).

2. **#2 Throttler filter order** — in `configure-http-app.ts:89-93` flip the
   `useGlobalFilters` order to
   `(AllExceptionsFilter, ProblemDetailsFilter, ThrottlerExceptionFilter)`.
   NestJS reverses the global filter array internally (`RouterExceptionFilters`
   `filters.reverse()`), so the most-specific filter must be registered LAST to
   run first. Fix the misleading comment above it (#25 folds in here). Add e2e
   test: hammer a throttled route, assert 429 carries `Retry-After`,
   `X-RateLimit-Limit/Remaining/Reset`.

3. **#3 Modules self-contained** — make each module resolve standalone:
   - `domain-events.module.ts`: `imports: [EventEmitterModule]` (or document the
     `EventEmitterModule.forRoot()` prerequisite if forRoot must stay app-owned).
   - `db.module.ts`: add `imports: [ConfigModule]` to the `forRoot` provider block.
   - `cache.module.ts`: add `imports: [ConfigModule]` to the `registerAsync` block.
   Verify the existing `global-modules.spec.ts` still passes.

4. **#4 `cache.wrap` sentinel** — note `cache.service.ts:17` coerces `null →
   undefined` (`?? undefined`), so a sentinel at the service return boundary
   cannot tell a miss from a cached `undefined`. Apply the
   `const MISS = Symbol('cache-miss')` sentinel at the `cacheManager.get`/`set`
   layer instead: `set` stores sentinel-or-value, `get` treats the raw `MISS`
   symbol (not `undefined`) as the miss signal. Wrapped fns returning `undefined`
   must cache correctly. Add unit test covering the `T = undefined` case (call
   twice, assert fn invoked once).

5. **#5 `console.error` in pool** — in `db.provider.ts:32` replace
   `console.error(...)` in the `pool.on('error')` handler with
   `process.stderr.write(...)` (structured-log-safe minimal) or accept an
   injected logger. Keep it dependency-free — the handler lives outside DI scope.

6. Run all gates (see below). Fix any fallout.

## Success Criteria

- [x] #1: `withTimeout` integration test passes against CI Postgres; no `$1` syntax error; `ms <= 0` rejected; `pg_sleep` kill case aborts with `57014`.
- [x] #2: throttler e2e test asserts `Retry-After` + `X-RateLimit-*` on 429.
- [x] #3: `domain-events`, `db`, `cache` modules compile + resolve with no implicit global dependency; `global-modules.spec.ts` green.
- [x] #4: `cache.service.spec.ts` proves `undefined`-returning fn cached once.
- [x] #5: no `console.*` in `packages/shared-kernel/src` (grep clean).
- [x] Gates: `pnpm build` · `pnpm typecheck` · `pnpm turbo test` (≥25 tests) · `pnpm deps` all green.

## Risk Assessment

- **`set_config` semantics** — `set_config('statement_timeout', '60000', true)`
  takes a text value; Postgres coerces. Verify the timeout actually applies
  (test with a `pg_sleep` longer than the timeout → expect `57014`).
- **Filter reorder side effects** — flipping order could change which filter
  shapes non-throttler errors. Mitigate: existing exception tests + new e2e
  must all stay green; `AllExceptionsFilter` remains the catch-all fallback.
- **`imports: [ConfigModule]`** — if `ConfigModule` is already global, an extra
  local import is harmless (NestJS dedupes). Low risk.

## Security Considerations

- `set_config` value is internal (`String(ms)`), not user input — no injection
  surface. Still parameter-bound, not interpolated.
- Throttler fix restores RFC 6585 `Retry-After` — improves rate-limit UX, no
  new exposure.
