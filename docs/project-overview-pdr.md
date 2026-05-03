# Project Overview & PDR

_Last updated: 2026-05-03 | Branch: init-infrastructure_

## Project Overview

**onwealth** is a backend platform for wealth management. The current phase establishes the NestJS monorepo foundation: HTTP runtime, observability, structured error handling, database connectivity, and architectural boundary enforcement. No feature domains have shipped yet.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >=22 |
| Framework | NestJS 11 (Express adapter) |
| Language | TypeScript 6 |
| Database | PostgreSQL via Drizzle ORM + node-postgres pool |
| Logging | Pino (nestjs-pino) |
| Validation | class-validator + class-transformer + Zod (env) |
| Rate limiting | @nestjs/throttler |
| Build | Turborepo + pnpm workspaces + SWC |

## Product Development Requirements

### PDR-001 — Monorepo Foundation

**Status:** Shipped (init-infrastructure)

**Requirements:**
- pnpm workspaces with version catalog for all shared dependencies
- Turborepo pipeline: build → typecheck → lint → test → dev
- TypeScript project references across all packages
- Shared tsconfig presets (`base`, `library`, `nest`)
- oxlint + oxfmt linting/formatting via `@infra-x/code-quality` presets

**Acceptance criteria:**
- `pnpm build` succeeds across all packages in dependency order
- `pnpm typecheck` passes with strict mode
- `pnpm lint` includes architectural boundary check

---

### PDR-002 — API Bootstrap & Middleware Chain

**Status:** Shipped (init-infrastructure)

**Requirements:**
- NestJS HTTP application with ordered middleware chain (see `system-architecture.md`)
- Helmet security headers
- Global ValidationPipe (whitelist, 422 status, transform)
- CORS configurable via `ALLOWED_ORIGINS` env
- `GET /health` smoke endpoint returning `{ status, uptime, timestamp }`

**Acceptance criteria:**
- `GET /health` returns 200 with AIP-193 `{ data, meta }` envelope
- `GET /nonexistent` returns 404 `application/problem+json`
- App starts in <5 s in dev mode

---

### PDR-003 — Observability

**Status:** Shipped (init-infrastructure)

**Requirements:**
- Structured JSON logs in production; pino-pretty single-line in dev/test
- Per-request `traceId`, `correlationId` on every log line
- W3C traceparent header parsed and propagated via CLS
- `x-request-id` / `x-correlation-id` headers captured; UUIDs generated if absent
- Health routes excluded from per-request autoLogging
- Secrets redaction on known sensitive paths

**Acceptance criteria:**
- Every log line in production contains `traceId` and `correlationId` fields
- Health endpoint logs suppressed in both dev and prod

---

### PDR-004 — Error Handling

**Status:** Shipped (init-infrastructure)

**Requirements:**
- RFC 9457 `application/problem+json` for all HTTP errors
- `AllExceptionsFilter` catches `DrizzleQueryError` and maps pg error codes to HTTP exceptions
- `ThrottlerExceptionFilter` produces 429 with `Retry-After` + `X-RateLimit-*` headers
- Error responses carry `request_id`, `correlation_id`, `trace_id`
- Production 500s hide raw error message from response body

**Acceptance criteria:**
- All 4xx/5xx responses have `Content-Type: application/problem+json`
- `Cache-Control: no-store` on all error responses
- Validation errors include `errors[]` with field pointers

---

### PDR-005 — Database Foundation

**Status:** Shipped (init-infrastructure)

**Requirements:**
- `DatabaseModule.forRoot()` wires Drizzle + node-postgres pool from env
- Pool configuration via `DB_POOL_*` env vars
- Schema barrel in `@onwealth/database` — typed even when empty
- `@onwealth/database` has no NestJS dependency

**Acceptance criteria:**
- App starts without database connection error when `DATABASE_URL` points to running Postgres
- `pnpm depcruise:check` passes `database-no-nestjs` rule

---

### PDR-006 — Architectural Boundary Enforcement

**Status:** Shipped (init-infrastructure)

**Requirements:**
- `dependency-cruiser` 16 with 6 error-severity rules covering circular deps, framework isolation, feature isolation
- Runs as part of `pnpm lint` pipeline

**Acceptance criteria:**
- `pnpm depcruise:check` exits 0 on clean codebase
- Any violation blocks CI lint step

---

### PDR-007 — Feature Modules (planned)

**Status:** Not started

**Requirements (TBD):**
- Feature modules under `apps/api/src/modules/{context}/`
- DDD layer rules added to `.dependency-cruiser.cjs`
- `@nestjs/terminus` health indicators (readiness/liveness)
- Authentication (JWT + refresh tokens)
- Redis-backed throttler store

## Non-Functional Requirements

| NFR | Target |
|---|---|
| Startup time | <5 s in dev |
| Log latency | Pino async transport (non-blocking) |
| DB pool | max 20 connections per instance |
| Rate limit default | 100 000 req / 60 s (env-tunable) |
| Node.js version | >=22 (enforced via `engines` field) |
