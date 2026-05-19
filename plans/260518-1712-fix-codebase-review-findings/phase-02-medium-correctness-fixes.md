---
phase: 2
title: "Medium Correctness Fixes"
status: completed
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 2: Medium Correctness Fixes

## Overview

Fix 7 Medium correctness/spec findings (#6-#12): body-parser redundancy, W3C
trace-context violations, error-code semantics, env validation, health-check
timer leaks, and a misleading test comment. Regression tests for the validation
and parsing fixes.

## Requirements

- Functional: body limit configurable + effective; trace-context rejects
  invalid W3C input; env rejects inconsistent pool config; health checks leave
  no orphan timers; DB constraint errors map to honest codes.
- Non-functional: no behavior change for valid inputs; tests stay green.

## Architecture

All fixes local. #6 touches the two bootstrap files (disable NestJS built-in
body parser, keep the explicit one). #7/#8 are pure parser-logic guards. #10 is
a Zod `superRefine`. #11 wraps `Promise.race` with `clearTimeout`.

## Related Code Files

- Modify: `packages/nest-http/src/bootstrap/create-http-app.ts` (#6)
- Modify: `packages/nest-http/src/bootstrap/configure-http-app.ts` (#6)
- Modify: `packages/nest-http/src/interceptors/trace-context.util.ts` (#7)
- Modify: `packages/shared-kernel/src/logger/logger.config.ts` (#7 — `extractTraceId` zero/`ff` reject)
- Modify: `packages/nest-http/src/config/cls.config.ts` (#8)
- Modify: `packages/nest-http/src/filters/all-exceptions.filter.ts` (#9)
- Modify: `packages/shared-kernel/src/errors/error-code.ts` (#9 — add `CONSTRAINT_VIOLATION`)
- Modify: `packages/nest-http/src/decorators/api-problem-responses.decorator.ts` (#9 — 422 example)
- Modify: `packages/shared-kernel/src/config/env.schema.ts` (#10)
- Modify: `packages/shared-kernel/src/config/database.config.ts` (#10 — `databaseEnvSchema` pool refine)
- Modify: `packages/nest-http/src/health/drizzle.health.ts` (#11)
- Modify: `packages/nest-http/src/health/redis.health.ts` (#11)
- Modify: `apps/api/src/__tests__/integration/di-token-identity.spec.ts` (#12)
- Create/Modify: `packages/nest-http/src/interceptors/__tests__/trace-context.util.spec.ts` (#7)

## Implementation Steps

1. **#6 Body parser** — pass `{ bodyParser: false }` to `NestFactory.create` in
   `create-http-app.ts`, making the explicit `express.json({ limit: BODY_LIMIT })`
   in `configure-http-app.ts:60` authoritative. Verify a payload >`BODY_LIMIT`
   returns 413; verify a normal request still parses.

2. **#7 Trace-context W3C** — in `trace-context.util.ts` parser, after hex
   validation reject: `version === 'ff'`, all-zero traceId (`'0'.repeat(32)`),
   all-zero parentId (`'0'.repeat(16)`) — return `null`. Apply the same reject
   logic to `logger.config.ts:138-145` `extractTraceId` — it independently
   re-derives the traceId from the raw `traceparent` header, so patching the
   parser alone leaves this path accepting malformed input. Add unit tests for
   each invalid case + a valid-traceparent passthrough case.

3. **#8 tracestate cap** — in `cls.config.ts:72` change `.slice(0, 1024)` to
   `.slice(0, 512)` (W3C Trace Context §3.3.2 mandates 512 bytes). Update the
   comment to match.

4. **#9 Error-code semantics** — in `all-exceptions.filter.ts` `mapDatabaseError`,
   change `code: 'RESOURCE_CONFLICT'` to `'CONSTRAINT_VIOLATION'` for `23503`
   (FK), `23502` (not-null), `23514` (check). Keep `RESOURCE_CONFLICT` for
   `23505` (unique) — that one is a genuine conflict. Add `CONSTRAINT_VIOLATION`
   to the `error-code.ts` enum/union. Update the 422 example in
   `api-problem-responses.decorator.ts` to emit `CONSTRAINT_VIOLATION` so the
   OpenAPI doc matches the runtime response.

5. **#10 Pool min/max validation** — add a `superRefine` to `envSchema` in
   `env.schema.ts`: if `DB_POOL_MIN > DB_POOL_MAX`, `ctx.addIssue` on
   `DB_POOL_MIN`. Apply the same `superRefine` to `databaseEnvSchema` in
   `database.config.ts` — it declares its own pool min/max, so the `envSchema`
   patch alone leaves the DB config's validation gap open. Add test:
   `{ DB_POOL_MIN: 50, DB_POOL_MAX: 10 }` fails parse for both schemas.

6. **#11 Health-check timers** — in `drizzle.health.ts` and `redis.health.ts`,
   capture the `setTimeout` id and `clearTimeout` it in a `finally` block so the
   timer is cleared when the query wins the `Promise.race`.

7. **#12 Test comment** — in `di-token-identity.spec.ts`, correct the comment
   claiming `@keyv/redis` connects lazily — it opens a TCP socket eagerly on
   `new KeyvRedis()`. State plainly that the test requires the Redis container.

8. Run all gates.

## Success Criteria

- [x] #6: oversized payload → 413; `bodyParser: false` set; normal request parses.
- [x] #7: `trace-context.util.spec.ts` covers `ff` version + all-zero ids + valid passthrough; `logger.config.ts` `extractTraceId` applies the same reject.
- [x] #8: tracestate capped at 512; comment matches.
- [x] #9: FK/not-null/check → `CONSTRAINT_VIOLATION`; unique → `RESOURCE_CONFLICT`; `error-code.ts` + `api-problem-responses.decorator.ts` 422 example updated.
- [x] #10: both `envSchema` and `databaseEnvSchema` reject `DB_POOL_MIN > DB_POOL_MAX` with a clear message; test passes.
- [x] #11: health checks `clearTimeout` on success path (no orphan timers).
- [x] #12: comment accurate.
- [x] Gates: `pnpm build` · `pnpm typecheck` · `pnpm turbo test` · `pnpm deps` all green.

## Risk Assessment

- **`bodyParser: false`** — disables NestJS's built-in parser entirely; any
  route relying on `urlencoded` bodies would break. Mitigate: add
  `express.urlencoded` alongside `express.json` if any form route exists
  (none today — JSON API). Verify via existing e2e tests.
- **Error-code rename** — `CONSTRAINT_VIOLATION` is a new code string; any
  client/test asserting `RESOURCE_CONFLICT` on a 422 must update. Grep for
  consumers first.
- **tracestate 512** — strictly tighter; only affects oversized inbound headers
  (already non-conformant). Negligible risk.

## Security Considerations

- #6 makes the payload-amplification guard genuinely effective (was redundant).
- #7 rejecting malformed traceparent prevents downstream trace-id confusion /
  log poisoning.
