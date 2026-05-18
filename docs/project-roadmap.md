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

## Upcoming Milestones

### M1 — Cleanup & Reconciliation

Small housekeeping tasks before domain work begins.

| Task | Notes |
|------|-------|
| Remove `postgres` (postgres.js) dep from `apps/api` | Unused; drizzle uses `pg` only |
| Reconcile pnpm version (CI `@9` vs `packageManager` `@10.32.1`) | Prevents lock file drift |

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

| Metric | Current | Target |
|--------|---------|--------|
| Statements | 0 % | 80 % |
| Branches | 0 % | 70 % |
| Functions | 0 % | 80 % |
| Lines | 0 % | 80 % |

Blocked on M2/M3 — meaningful coverage requires domain code to test.

---

### M5 — Domain Events Reliability

Replace at-most-once in-process events with a durable outbox pattern.

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
- pnpm version reconciliation (M1) should happen before next merge to `main`.
