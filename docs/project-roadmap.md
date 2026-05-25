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
| 4 | `@onwealth/nest-http` package | Done |
| 5 | Bootstrap slim + API composition root | Done |
| 6 | Tooling & docs sync | Done |

**Result:** `apps/api/src/` now contains only `app.module.ts`, `main.ts`, `modules/`, `__tests__/`.
`main.ts` is a thin entrypoint — all HTTP setup lives in `@onwealth/nest-http` `configureHttpApp`.

**Unlocked capability:** a future NestJS worker app can depend on `@onwealth/shared-kernel` directly
without pulling in any HTTP dependencies (`@onwealth/nest-http`).

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
