---
title: "Fix Codebase Review Findings"
description: "Fix 24 findings from the codebase review of the post-extraction init-infrastructure branch (@onwealth/shared-kernel, @onwealth/nest-http, apps/api, @onwealth/database)."
status: completed
priority: P1
branch: "init-infrastructure"
tags: [code-review, bugfix, hardening]
blockedBy: []
blocks: []
created: "2026-05-18T10:15:35.937Z"
createdBy: "ck:plan"
source: skill
---

# Fix Codebase Review Findings

## Overview

Codebase review of the post-extraction `init-infrastructure` branch surfaced
**1 Critical, 4 High, 13 Medium, 6 Low** findings — correctness/contract bugs,
no security holes or data loss. Most High findings surface either in production
HTTP behavior or the moment a 2nd app consumes the shared packages (the
extraction's stated goal). This plan fixes all 24, grouped by severity, with
regression tests for every behavioral fix.

Source: `/code-review codebase` scan (3 parallel reviewers + critical-claim
adjudication against source). Two reviewer severities were adjusted: throttler
filter Critical→High (429 still returned, only standard headers missing); body
limit High→Medium (no live bypass, redundant dead code).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Critical & High Fixes](./phase-01-critical-high-fixes.md) | Completed |
| 2 | [Medium Correctness Fixes](./phase-02-medium-correctness-fixes.md) | Completed |
| 3 | [Tooling Deps & Hygiene](./phase-03-tooling-deps-hygiene.md) | Completed |

## Findings Map

- **Phase 1** (P1): #1 `withTimeout` SQL · #2 throttler filter order · #3 modules
  not self-contained · #4 `cache.wrap` sentinel · #5 `console.error` in pool.
- **Phase 2** (P2): #6 body-parser · #7 trace-context W3C · #8 tracestate cap ·
  #9 `RESOURCE_CONFLICT` code · #10 pool min/max validation · #11 health timers ·
  #12 keyv/redis test comment.
- **Phase 3** (P3): #13 turbo `env` · #14 unused `apps/api` deps · #15 catalog
  gaps · #16 `app.listen` host · #17 HTTP code in shared-kernel · #18 `pino-pretty`
  peer · #20 swagger `for...in` · #21 location-header numeric id · #22 peer-pin
  ranges · #23 stale dep-cruiser rule · #24 stale barrel comments · #25 filter
  comment.

## Dependencies

No cross-plan blockers. Builds on `260518-1127-shared-nest-package-extraction`
(completed) and `260515-1810-init-infrastructure-hardening` (effectively done).
Phases are sequential: 2 blockedBy 1, 3 blockedBy 2 — keeps the test suite green
at each step.

## Gates (every phase)

`pnpm install` · `pnpm build` · `pnpm typecheck` · `pnpm turbo test` (≥23 tests) ·
`pnpm deps` (dependency-cruiser, 0 violations).

## Red Team Review

Adversarial review (2 hostile reviewers; 3rd run aborted). 1 finding rejected,
8 accepted and folded into the phase files.

**Rejected — false positive:**

- **Filter-order reversal (Phase 1 #2)** — both reviewers claimed
  `useGlobalFilters(AllExceptionsFilter, ProblemDetailsFilter, ThrottlerExceptionFilter)`
  is the wrong order. Verified against NestJS source: `RouterExceptionFilters`
  applies `filters.reverse()`, then `ExceptionsHandler` does first-match `.find()`.
  Registration `(All, Problem, Throttler)` → internal `[Throttler, Problem, All]`
  → `Throttler` matches first. The plan order is **correct**; reviewers misread
  the reverse direction.

**Accepted — folded in:**

- **RT-2 (P1 #4)** — `cache.service.ts:17` `?? undefined` coerces `null`; sentinel
  must sit at the `cacheManager.get/set` layer, not the service return.
- **RT-3 (P1 #1)** — add `ms <= 0` guard + `pg_sleep`/`57014` kill-test.
- **RT-4 (P2 #7)** — `logger.config.ts` `extractTraceId` re-derives traceId
  independently; needs the same zero/`ff` reject.
- **RT-5 (P2 #9)** — also add `CONSTRAINT_VIOLATION` to `error-code.ts` and the
  422 example in `api-problem-responses.decorator.ts`.
- **RT-6 (P2 #10)** — `database.config.ts` `databaseEnvSchema` has its own pool
  min/max; refine both schemas.
- **RT-7 (P3 #14)** — `@nestjs/event-emitter` + `@nestjs/throttler` are direct
  imports (`app.module.ts:5-6`); keep-list must include them or boot breaks.
- **RT-8 (P3 #17)** — `autoLogging.ignore` allowlist ≠ generic `excludePaths`;
  keep as a distinct, clearly-named param.
- **RT-9 (P3 #22)** — `drizzle-orm` 0.x breaks within minors; keep its peer pin
  exact, not `^`.
