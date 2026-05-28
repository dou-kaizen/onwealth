# Project Roadmap

## Infrastructure Hardening — COMPLETE

All six phases merged on `init-infrastructure` branch.

| Phase | Name | Status |
|-------|------|--------|
| 01 | Security Criticals | Done |
| 02 | Env & Secrets Hardening | Done |
| 03 | Runtime Hardening | Done |
| 04 | Cross-Cutting Correctness | Done |
| 05 | Tooling & CI | Done |
| 06 | Minor Cleanups | Done |

---

## Shared NestJS Package Extraction — COMPLETE

Six-phase refactor extracted cross-cutting code from `apps/api/src/` into two new workspace packages.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Shared-Kernel scaffold | Done |
| 2 | Shared-Kernel infra modules | Done |
| 3 | Config namespace migration | Done |
| 4 | `@boilerplate/nest-http` package | Done |
| 5 | Bootstrap slim + API composition root | Done |
| 6 | Tooling & docs sync | Done |

**Result:** `apps/api/src/` now contains only `app.module.ts`, `main.ts`, `modules/`, `__tests__/`.
`main.ts` is a thin entrypoint — all HTTP setup lives in `@boilerplate/nest-http` `configureHttpApp`.

**Unlocked capability:** a future NestJS worker app can depend on `@boilerplate/shared-kernel` directly
without pulling in any HTTP dependencies (`@boilerplate/nest-http`).

---

## Codebase Review Findings Fix — COMPLETE

24 correctness bugs fixed across 3 phases (1 Critical, 4 High, 13 Medium, 6 Low) + Phase 5 Medium Hygiene. 51+ test cases added across 10 spec files (global-pipeline.spec.ts added as regression gate). CI/tooling hardening applied (pnpm 10.32.1 pinned both CI jobs).

**Phase 5 (Medium Hygiene) deliverables:**
- Module bootstrap unified: `CacheModule`, `DrizzleModule`, `QueueModule` all self-load typed config via `ConfigModule.forFeature` — self-contained regardless of host-app wiring
- Scoped CSP on `/swagger` + `/docs` HTML routes via per-route helmet middleware; global JSON routes unaffected
- Health endpoint sanitization: thrown errors → static `ServiceUnavailableException`; logs emit `errorName` only
- Graceful shutdown on `unhandledRejection`/`uncaughtException`: `app.close()` + 5 s hard-stop fallback
- 200-LOC extractions: `database-error-mapper.ts` (from `all-exceptions.filter.ts`), `link-header-builder.ts` (from `link-header.interceptor.ts`)
- DI restructuring: `LocationHeaderInterceptor`/`LinkHeaderInterceptor` are now DI providers; retrieved via `app.get()` in `configureHttpApp`
- `THROTTLE_TTL` Zod validator enforces `.min(1000)` (milliseconds); documented in `.env.example`

Ref: `plans/260518-1712-fix-codebase-review-findings/`, journal `docs/journals/2026-05-19-codebase-review-findings-fix.md`.

**Subsequent hygiene commits (also complete):**
- `ms()`/`bytes()` magic-number refactor (commit 875f309) — all timeout/size literals replaced with `UPPER_SNAKE_CASE` named constants using `ms ^2.1.3` / `bytes ^3.1.2` catalog deps.
- JSDoc audit (commit 36d3bca) — public APIs on all `@boilerplate/*` production source files annotated; internal helpers tagged `@internal`.
- Nest 11 LegacyRouteConverter fix (commit 1b1501a) — `logger.config.ts` overrides `nestjs-pino` default `forRoutes` from legacy `*` to `{*path}` (path-to-regexp v8 / Express 5 named-wildcard syntax).

---

## BullMQ Queue Scaffold — COMPLETE

BullMQ abstraction layer added to `packages/shared-kernel`. Export-only scaffold — no concrete queues, no `apps/api` wiring.

| Deliverable | Status |
|-------------|--------|
| Deps (`@nestjs/bullmq@^11`, `bullmq@^5`) in workspace catalog + shared-kernel | Done |
| `QUEUE_REDIS_URL` + prod-TLS guard in `env.schema.ts` | Done |
| `queueConfig` namespace factory | Done |
| 7 queue source files under `packages/shared-kernel/src/queue/` | Done |
| Barrel exports in `index.ts` (named, no `export *`) | Done |
| `QueueModule` whitelisted in `global-modules.spec.ts` | Done |
| 3 spec files / 19 cases (exception, config, evaluateJobFailure) | Done |
| `docs/codebase-summary.md` updated | Done |

All gates green: typecheck (0 errors), build (33.5 kB), test (6 files / 33 cases), dep-cruiser clean, biome clean, `apps/api/src/app.module.ts` not modified.

Ref: `plans/260522-1522-bullmq-queue-scaffold/`

---

## Queue Production Hardening — Phase A COMPLETE

Production-ready hardening of the BullMQ queue scaffold in `packages/shared-kernel`.

| Deliverable | Status |
|-------------|--------|
| `defaultJobOptions` (removeOnComplete/Fail counts) in `QueueModule` | Done |
| `FatalQueueException` terminal path in `_evaluateJobFailure` (drops legacy `error.isFatal`) | Done |
| `QueueProcessorBase.onModuleDestroy` — graceful drain via `worker.close(false)` + 5 s timeout race | Done |
| `QueueDlqHelper` — `getFailedJobs` + `retryFailedJob` + `FailedJobSummary` DTO | Done |
| `queue/README.md` — Quick Start, Gotchas, Production Checklist, DLQ migration sketch | Done |
| `@QueueProcessor` JSDoc for `limiter` rate-limit option | Done |
| Integration test suite (5 processor + 4 DLQ scenarios) via `@testcontainers/redis` | Done |
| `vitest.config.integration.ts` split for testcontainer-backed specs | Done |

84 unit + 9 integration tests pass. typecheck / lint / build / dep-cruiser green. `apps/api` still does NOT import `QueueModule`.

**Phase B (deferred):** metrics hook in `onFailed`, comment trim pass, alert threshold configuration.

Ref: `plans/260525-1515-queue-production-hardening/`

---

## Production Readiness Audit — COMPLETE

8-phase audit fix on `init-infrastructure`. No new modules — hardening-only pass.

| Deliverable | Status |
|-------------|--------|
| `TRANSACTION_CONFLICT` ErrorCode; SQLSTATE 40001/40P01 → 409 Conflict | Done |
| Env prod superRefine: `ALLOWED_ORIGINS` rejects `*`/`null`; `DATABASE_URL` requires SSL; `JWT_SECRET` charset diversity + ≥16 distinct chars | Done |
| `QueueProcessorBase.process(job, token?)` forwards lock token to `handleJob(job, token?)` | Done |
| `QueueModule.defaultJobOptions`: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }` | Done |
| `FailedJobSummary` drops `data` field (PII risk) | Done |
| `set-cookie` added to pino `redactPaths` | Done |
| `KEYV_REDIS_TOKEN` shared `KeyvRedis` instance; `CacheService.onModuleDestroy` drains via `disconnect(false)` | Done |
| ETag `If-None-Match` strips `W/` prefix (RFC 9110 §8.8.3 weak comparison) | Done |
| `@Public` JSDoc documents NO-OP precondition (no global guard wired) | Done |
| `unplugin-swc` + `vite-tsconfig-paths` in vitest configs (shared-kernel + apps/api) | Done |
| CI `Integration Tests` step: `pnpm --filter @boilerplate/shared-kernel test:integration` | Done |

Ref: `plans/260527-1917-production-readiness-audit/`

---

## Documentation Style Port — COMPLETE

14 new markdown files (12 infra topic docs + top-level navigation index + infrastructure README +
features placeholder) adopting ack-nestjs-boilerplate documentation pattern.
Existing 6 root docs preserved (no rename); slimmed where duplicating per-topic content.
Root README.md + project CLAUDE.md updated to surface new doc structure for AI agents.
Ref: `plans/260528-1016-doc-style-port/`

---

## Upcoming Milestones

### M1 — Cleanup & Reconciliation — Substantially Complete

| Task | Status |
|------|--------|
| Remove `postgres` (postgres.js) dep from `apps/api` | Done |
| Reconcile pnpm version (CI vs `packageManager` field) | Done — CI pins `pnpm@10.32.1` on both jobs |

---

### M2 — Business Domain Schemas

Define initial PostgreSQL schemas in `packages/database`.

| Task | Notes |
|------|-------|
| Decide domain entities (users, accounts, positions, …) | Blocked on product scope confirmation |
| Write Drizzle schema files in `src/schemas/` | Currently `export {}` placeholder |
| Generate + test initial migration | Must pass migration-smoke CI job |

---

### M3 — Auth Module

Wire the existing passport/JWT/OAuth dependencies into a working auth module.

| Task | Notes |
|------|-------|
| `AuthModule` under `src/modules/auth/` | JWT strategy + guards |
| `UsersModule` under `src/modules/users/` | Basic user aggregate + DB queries |
| Google OAuth + GitHub OAuth flows | `passport-google-oauth20` + `passport-github2` already installed |
| `@Public()` decorator already exists | Auth guard reads it to skip protected routes |

---

### M4 — Coverage Gate

Ramp test coverage thresholds from placeholder `0` to production targets.

51 test cases exist across 10 spec files. Vitest thresholds remain at `0` — gate not yet enforced.

| Metric | Threshold | Target |
|--------|-----------|--------|
| Statements | 0 % (unenforced) | 80 % |
| Branches | 0 % (unenforced) | 70 % |
| Functions | 0 % (unenforced) | 80 % |
| Lines | 0 % (unenforced) | 80 % |

Enforcement blocked on M2/M3 — meaningful coverage requires domain code to test.

---

### M5 — Domain Events Reliability

Replace at-most-once in-process events with a durable outbox pattern.

Current state (post Codebase Review Round 2 / phase-02 H3): `DomainEventPublisher`
is at-most-once for fully-published events; the FAILING event is dropped + logged
and NOT restored to the aggregate (multi-listener `emitAsync` would re-fire
succeeded listeners on retry). Listeners must be idempotent. This is acceptable
ONLY while no transactional boundary requires guaranteed delivery — the outbox
work below is the real fix.

| Task | Notes |
|------|-------|
| Outbox table schema | Part of M2 migration batch |
| `DomainEventPublisher` writes to outbox transactionally | Replace current EventEmitter2 emit |
| Background relay worker | Polls outbox, publishes to broker or retries |
| Dead-letter handling | Configurable retry limit + DLQ |

---

### M6 — Integration Events Transport

Wire `IntegrationEvent` base class to an actual message broker.

| Task | Notes |
|------|-------|
| Choose broker (Redis Streams, RabbitMQ, Kafka) | TBD on infra constraints |
| Publisher + subscriber adapters | Port/Adapter pattern (follows CachePort model) |

---

## Open Items

- Product scope confirmation ("meme token trading" vs broader wealth platform) gates M2 schema design.
- Deployment platform decision gates container/infra work.
- Auth strategy (JWT-only vs OAuth-only vs combined) gates M3 design.
- Coverage gate enforcement timeline — when to ramp thresholds from 0 to 80/70/80/80.
