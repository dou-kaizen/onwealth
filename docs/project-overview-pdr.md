# Project Overview & PDR

## Product Context

This is a **production-grade NestJS monorepo boilerplate** — no business domain locked in.
It establishes the DDD-lite foundation, security posture, observability, and CI pipeline
on which any backend API project can build. Domain modules are intentionally absent; the
repo ships infrastructure-only so teams can layer their own domain on top without fighting
pre-baked business logic.

---

## Current State: `init-infrastructure` branch

This branch delivers a hardened API skeleton. No domain endpoints. No auth flows wired. No
business schemas. Infrastructure phases and subsequent codebase-review bug-fix effort are all complete.

| Phase | Name | Summary |
|-------|------|---------|
| 01 | Security Criticals | Helmet, CORS, body-size limit, trust-proxy, throttler guard |
| 02 | Env & Secrets | Zod env schema with prod superRefine (rejects placeholder secrets, forces rediss://, enforces THROTTLE_LIMIT ≤ 10 000) |
| 03 | Runtime | DrizzleModule/DrizzleService with pool lifecycle, CacheModule (Port/Adapter), DomainEventsModule, health probes (livez/readyz/health) |
| 04 | Cross-Cutting Correctness | RFC 9457 ProblemDetailsFilter, W3C traceparent in CLS, CorrelationId/TraceContext interceptors, ETag middleware |
| 05 | Tooling & CI | Biome v2, Turborepo pipeline, dependency-cruiser arch guard (shared base + per-package extends), lefthook git hooks (pre-commit/commit-msg/pre-push), vitest + e2e harness, CI workflow (lint+typecheck+test+build+migration smoke) |
| 06 | Minor Cleanups | Drop postgres.js dep (complete), Swagger annotations, log exclusions, CORS `X-Request-Id` |
| CR | Codebase Review Fix | 24 correctness bugs fixed (1 Critical, 4 High, 13 Medium, 6 Low); 51 test cases added; CI/tooling hardening (pnpm 10.32.1 both jobs) |
| Q1 | BullMQ Queue Scaffold | `QueueModule`, `QueueProcessorBase`, `FatalQueueException`, `QueueDlqHelper`, `queueConfig` in `@boilerplate/shared-kernel`; no concrete queues wired to `apps/api` yet |
| Q2 | Queue Production Hardening Phase A | `defaultJobOptions`, graceful drain (`worker.close(false)` + 5 s timeout), DLQ helper, `queue/README.md`, integration tests via `@testcontainers/redis` |
| GS | Graceful Shutdown (M12/M16) | `main.ts` SIGTERM/SIGINT → `app.close()` + 5 s hard-stop; BullMQ worker drain on shutdown |
| JD | JSDoc Audit | Public APIs on all `@boilerplate/*` production source files annotated; internal helpers tagged `@internal` |
| RC | ms()/bytes() Refactor | All timeout/size literals replaced with named `UPPER_SNAKE_CASE` constants using `ms()` / `bytes()` helpers |
| N11 | Nest 11 Wildcard Fix | `logger.config.ts` overrides `forRoutes` to `{*path}` syntax (path-to-regexp v8 / Express 5 compatibility) |

---

## Functional Requirements (Infrastructure Layer)

### FR-01 — Env Validation
- All env vars parsed and validated at startup via Zod schema.
- Production mode: rejects placeholder `JWT_SECRET`, `api.example.com` base URL, `redis://` scheme, `THROTTLE_LIMIT > 10000`.
- App refuses to start if validation fails.

### FR-02 — Security Headers
- Helmet applied globally (CSP + COEP disabled — JSON API only).
- CORS: env-driven `ALLOWED_ORIGINS`, exposes `X-Request-Id`.
- Rate limiting: configurable TTL + limit via env; ThrottlerGuard as `APP_GUARD`.

### FR-03 — Observability
- Structured JSON logging via pino. Dev: pino-pretty. Prod: JSON.
- Sensitive fields redacted (`password`, tokens, auth headers).
- High-frequency probe paths excluded from access logs.
- W3C `traceparent` propagated via CLS; `X-Request-Id` correlation.

### FR-04 — Error Responses
- All errors: RFC 9457 `application/problem+json`.
- Throttle violations: 429 with standard problem body.
- Validation errors: flattened dotted-path `errors[]` array.

### FR-05 — Health Probes
- `/livez` — process-only, no I/O.
- `/readyz` — DB + Redis with 3 s race deadline; 503 on degraded.
- `/health` — full component breakdown + heap/RSS/disk metrics.

### FR-06 — Database & Graceful Shutdown
- Drizzle ORM + `node-postgres` Pool.
- Pool drains on `SIGTERM` via `DrizzleService.onModuleDestroy`.
- BullMQ workers drain on shutdown via `QueueProcessorBase.onModuleDestroy` (`worker.close(false)` + 5 s timeout race before hard exit).
- Migration role has `lock_timeout` / `statement_timeout` set before migrations run.
- Idempotent migrations verified in CI smoke test.

### FR-07 — Domain Events (Infrastructure)
- `DomainEventPublisher`: clears aggregate's event queue, emits each event via `EventEmitter2`.
- At-most-once delivery (no outbox, no persistence).
- `BaseAggregateRoot` accumulates events in private `#domainEvents[]`.

### FR-08 — Cache
- Port/Adapter: `CachePort` interface injected via `CACHE_PORT` symbol.
- Adapter: `cache-manager` + `@keyv/redis`.
- Consumers depend on interface, not implementation.

---

## Non-Functional Requirements

| NFR | Target | Status |
|-----|--------|--------|
| Request timeout | 30 s global | Implemented (`TimeoutInterceptor`) |
| Payload limit | 100 KB JSON body | Implemented |
| Rate limiting | Configurable (default 100/min) | Implemented |
| Test coverage | 80 % statements / 70 % branches / 80 % functions / 80 % lines | 51 test cases exist; thresholds remain 0 (gate pending) |
| Migration idempotency | Second run must be no-op | Verified in CI |

---

## Architectural Constraints

- NestJS 11, ESM (`"type": "module"`), `nodenext` module resolution.
- No CQRS module, no repository abstraction yet (DB_TOKEN injected directly).
- Every `@Global()` module must have `@global-approved` comment + appear in architecture guard whitelist.
- Drizzle is the only ORM. postgres.js has been removed; Drizzle + `pg` only.

---

## Out of Scope (This Branch)

- Auth/users module (no auth deps wired; passport/JWT/OAuth not in `apps/api` dependencies).
- Business domain schemas (packages/database exports empty placeholder).
- Outbox pattern for domain events (at-most-once is current behavior).
- Frontend / mobile clients.

---

## Unresolved Questions

1. Final product domain — "meme token trading" or broader wealth/fintech? Affects schema design.
2. Multi-tenancy requirements, if any?
3. Target deployment platform (Docker/k8s, Railway, Fly.io, etc.)?
4. Auth strategy choice — JWT-only, OAuth-only, or combined?
5. Coverage gate enforcement timeline — 51 test cases exist; when to raise thresholds from 0 to 80/70/80/80?
