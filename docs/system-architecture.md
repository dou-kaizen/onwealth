# System Architecture

_Last updated: 2026-05-15 | Branch: init-infrastructure (Foundation Hardening)_

## Overview

onwealth is a NestJS monorepo structured around strict layer separation. The foundation phase ships the HTTP runtime, observability, error handling, and database connectivity. Feature bounded contexts are not yet present.

## Package Dependency Graph

```
apps/api
  └── @onwealth/platform/{config,cls,logger,filters,interceptors,decorators,pipes,
                          throttler,database,error-codes,problem-details,.}
        └── @onwealth/database   (Drizzle schemas barrel)

@onwealth/core                   (no dependencies on other workspace packages)
```

Dependency direction is strictly downward. `@onwealth/core` has zero runtime dependencies on NestJS or infrastructure libs — enforced by `dependency-cruiser` rules `core-no-nestjs` and `core-no-runtime-libs`. `ProblemDetailsDto`, `FieldError`, and `ValidationErrorItem` live in `@onwealth/platform/problem-details` (collapsed from the former `@onwealth/contract` package). `ErrorCode` const object and union type live in `@onwealth/platform/error-codes`.

## Architectural Boundaries (dependency-cruiser rules)

| Rule | Enforcement |
|---|---|
| `no-circular` | No circular deps anywhere |
| `core-no-nestjs` | `packages/core/` cannot import `@nestjs/*` |
| `core-no-runtime-libs` | `packages/core/` cannot import ioredis, pino, bcrypt, drizzle-orm, pg, **zod, class-validator, class-transformer** |
| `database-no-nestjs` | `packages/database/` cannot import `@nestjs/*` |
| `platform-no-feature` | `packages/platform/` cannot import feature symbols (auth/user/telegram/bot) |
| `api-no-platform-internal` | `apps/api/` must use `@onwealth/platform/*` subpath, never `packages/platform/src/` relative path |

`core-no-runtime-libs` banlist extended in Foundation Hardening to include `zod | class-validator | class-transformer` — core stays validation/serialization-agnostic (`.dependency-cruiser.cjs`).

6 error-severity rules total. DDD layer rules (presentation-no-database, etc.) deferred until first feature module exists.

Run: `pnpm depcruise:check` (included in `pnpm lint`).

## API Documentation Surface

Routes are only mounted when `swaggerEnabled` is true (see env `ENABLE_SWAGGER`).

| Route | UI / Format | Notes |
|---|---|---|
| `/docs` | Scalar API Reference | Default interactive UI; pulls bundle from `cdn.jsdelivr.net` |
| `/swagger` | Swagger UI | Fallback UI; `persistAuthorization: true` |
| `/swagger-json` | OpenAPI JSON | Machine-readable spec (auto-mounted by `SwaggerModule.setup`) |
| `/openapi.yaml` | OpenAPI YAML | Codegen-friendly; registered via `yamlDocumentUrl` option |

### Default error response injection

`setupSwagger` calls `addDefaultErrorResponses(document)` post-build: every operation that lacks a `default` response key gets one added, referencing `#/components/schemas/ProblemDetailsDto` with content-type `application/problem+json`. This lets FE codegen (orval, openapi-typescript) emit a single error type per operation instead of N status-keyed branches.

### OpenAPI server URL

`DocumentBuilder.addServer(API_BASE_URL, NODE_ENV)` — `API_BASE_URL` env (default `https://api.example.com`) is used so codegen tools always target the correct base regardless of which host serves the spec.

### CSP trade-off

Strict helmet runs globally first. When swagger is enabled, a second (loose) helmet middleware is path-mounted on `/swagger` and `/docs` only — allowing `cdn.jsdelivr.net`, `unsafe-inline`, and `unsafe-eval` for Swagger UI. Express path matching: `app.use('/swagger', mw)` matches `/swagger` and `/swagger/*` but NOT `/swagger-json` (next character after prefix is `-`, not `/`), so the JSON spec endpoint stays under strict CSP without an explicit exclusion (`apps/api/src/main.ts`).

```
swaggerExplicit = ENABLE_SWAGGER env (boolean | undefined after Zod transform)
swaggerEnabled  = swaggerExplicit ?? (NODE_ENV !== 'production')
```

`persistAuthorization: false` in Swagger UI options prevents JWT token persistence in browser localStorage (`apps/api/src/config/swagger.config.ts`).

## Request Lifecycle

```
HTTP Request
  │
  ├─ CLS middleware (nestjs-cls)
  │    request_id: x-request-id header — capped at 128 chars; replaced with randomUUID() if
  │                missing, array (smuggling), empty, or oversized
  │    correlation_id: x-correlation-id — same sanitization rules
  │    traceId: ALWAYS a fresh CSPRNG value (crypto.randomBytes(16)) — inbound traceparent.traceId
  │             is NEVER trusted (dashboard-poisoning / collision risk)
  │    parentId / traceFlags: preserved from inbound traceparent for downstream propagation
  │    tracestate: capped at 512 chars; CR/LF stripped (prevents header smuggling once outbound
  │                HTTP propagation is wired)
  │    parseTraceparent() rejects: version=ff, all-zero traceId/parentId, non-hex chars;
  │                                normalises hex to lowercase per W3C spec
  │
  ├─ pino-http (nestjs-pino)
  │    autoLogging: only /api/* paths
  │    excluded: GET /health, /health/live, /health/ready
  │    mixin (per-log, inside CLS async hook): requestId, correlationId, traceId on every log line
  │    Note: mixin replaced customProps — runs inside CLS scope so regenerated IDs are visible
  │
  ├─ helmet (security headers)
  │    strict CSP global default (always applied)
  │    loose CSP path-mounted on /swagger and /docs ONLY when swaggerEnabled
  │    /swagger-json stays under strict CSP (Express path match excludes it)
  │    trust proxy = 1 (single LB hop; bump to 2 for CDN→LB→API topologies)
  │
  ├─ ThrottlerGuard (APP_GUARD — global)
  │    config: THROTTLE_TTL / THROTTLE_LIMIT from env (default limit: 300 req/window)
  │    HealthController carries @SkipThrottle() — K8s liveness probes must not consume quota
  │
  ├─ body parser (10kb JSON + urlencoded limit; financial-webhook routes must opt into rawBody)
  │
  ├─ ValidationPipe (whitelist=true, forbidNonWhitelisted=true, errorHttpStatusCode=422,
  │    transform=true, enableImplicitConversion=false — explicit @Type() required per field)
  │
  ├─ Route Handler
  │
  ├─ Interceptor chain (bind order = execution order on the way out):
  │    TimeoutInterceptor       — aborts at TIMEOUT_MS (default 30 s)
  │    RequestContextInterceptor — stamps X-Request-Id response header from CLS requestId
  │    CorrelationIdInterceptor  — stamps X-Correlation-Id from CLS correlationId
  │    TraceContextInterceptor   — stamps Trace-Id from CLS traceId (W3C traceparent)
  │    TransformInterceptor      — Google AIP-193 envelope when @UseEnvelope()
  │         @UseEnvelope() → { data, meta: { request_id, correlation_id, trace_id, timestamp } }
  │         { object: 'list', data: [...] } → returned as-is
  │         everything else → returned naked
  │
  │  Note: interceptors fire only on matched routes. Unmatched-route 404s bypass
  │  the chain; trace/correlation IDs flow via RFC 9457 body only on that path.
  │
  └─ Exception Filters (LIFO: ThrottlerExceptionFilter → ProblemDetailsFilter → AllExceptionsFilter)
       ThrottlerExceptionFilter: 429 + Retry-After / X-RateLimit-* headers
       ProblemDetailsFilter: HttpException → RFC 9457 application/problem+json
         extractValidationErrors recurses into item.children (depth cap 5, total errors cap 100)
         parentPath threaded through nesting so pointers read /address/city not /city
         constraint codes resolve via contexts[name].code for domain code injection
       AllExceptionsFilter: catch-all
         DrizzleQueryError(cause: pg.DatabaseError) → mapDatabaseError → delegate to ProblemDetailsFilter
         everything else → 500 Problem Details (message hidden in production)
```

## Error Response Shape (RFC 9457)

```json
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "instance": "/api/users/123",
  "request_id": "<uuid>",
  "correlation_id": "<uuid>",
  "trace_id": "<w3c-trace-id>",
  "timestamp": "2026-05-03T00:00:00.000Z",
  "code": "RESOURCE_NOT_FOUND",
  "detail": "The requested resource was not found"
}
```

Validation errors (400/422) additionally carry:
```json
{
  "errors": [
    { "field": "email", "pointer": "/email", "code": "VALIDATION_ERROR", "message": "..." }
  ]
}
```

## Success Response Shape (Google AIP-193)

Handlers decorated with `@UseEnvelope()`:
```json
{
  "data": { "status": "ok", "uptime": 42.1, "timestamp": "..." },
  "meta": { "request_id": "...", "correlation_id": "...", "trace_id": "...", "timestamp": "..." }
}
```

Collection handlers should return `{ object: 'list', data: [...] }` — `TransformInterceptor` passes it through unchanged.

## Database Layer

- Driver: `pg` (node-postgres) via `Pool`
- ORM: `drizzle-orm/node-postgres`
- Schema: `@onwealth/database` barrel — empty in foundation phase, typed as `typeof schema`
- Connection config from env: `DATABASE_URL`, `DB_POOL_MAX` (default 20), `DB_POOL_MIN` (default 5), `DB_POOL_IDLE_TIMEOUT` (default 30 000 ms), `DB_POOL_CONNECTION_TIMEOUT` (default 10 000 ms)
- Injected via `DatabaseModule.forRoot()` or `DatabaseModule.forRootAsync(options)` using `DRIZZLE_TOKEN` (Symbol, exported from `@onwealth/platform/database`)
- `POOL_TOKEN` (Symbol) also exported — allows future direct `pg.Pool` injection without going through Drizzle

### Graceful Shutdown

`DatabaseModule implements OnModuleDestroy`. On SIGTERM (`app.enableShutdownHooks()` must be called before `app.listen()`):

1. NestJS calls `httpServer.close()` — drains in-flight HTTP requests
2. NestJS fires `onModuleDestroy` on each module
3. `DatabaseModule.onModuleDestroy()` calls `pool.end()` wrapped in `Promise.race()` with an 8 s timeout
4. Timeout exceeded → logs to stderr and continues, preventing a hung idle client from blocking past the K8s `terminationGracePeriodSeconds` (default 30 s)

`pool.on('error')` is wired in `createDrizzleInstance()` to prevent Node's uncaught-event default from killing the process on idle-client disconnect (`packages/platform/src/database/drizzle.factory.ts:31`).

### Factory Return Shape

`createDrizzleInstance()` returns `DrizzleInstance { db: DrizzleDb, pool: Pool }`. `DatabaseModule` stores `pool` on a static field and exposes `db` via `DRIZZLE_TOKEN`, `pool` via `POOL_TOKEN` (`packages/platform/src/database/database.module.ts`).

## Database Error Mapping (`mapDatabaseError`)

`AllExceptionsFilter` unwraps `DrizzleQueryError` → `pg.DatabaseError` and calls `mapDatabaseError`. SQLSTATE → HTTP mapping (`packages/platform/src/filters/postgres-error-mapper.ts`):

| SQLSTATE | Class | HTTP | ErrorCode | Note |
|---|---|---|---|---|
| `23505` | unique violation | 409 | `RESOURCE_CONFLICT` | |
| `23503` | FK violation | 422 | `RESOURCE_NOT_FOUND` | Referenced row missing; 422 not 404 — clients MUST branch on `status` first, `code` second |
| `23502` | not-null violation | 422 | `REQUIRED_FIELD` | |
| `23514` | check constraint | 422 | `CONSTRAINT_VIOLATION` | Distinct from conflict; use for domain rule failures |
| `08000`, `08001`, `08003`, `08004`, `08006` | connection errors | 503 | `INTERNAL_SERVER_ERROR` | |
| `57014` | statement_timeout | 503 | `INTERNAL_SERVER_ERROR` | |
| (default) | all other codes | 500 | `INTERNAL_SERVER_ERROR` | |

**`RESOURCE_NOT_FOUND` + HTTP 422 pairing** (SQLSTATE `23503`): FK violation means the referenced row is missing — semantically a not-found. Status 422 signals the request body was invalid, not that the target URL was absent. If future feature modules need an unambiguous symbol, introduce a domain-specific code (e.g. `REFERENCE_NOT_FOUND`) rather than overloading this one.

## TypeScript Compile Strategy

| Target | Compiler | Config |
|---|---|---|
| `packages/*` | `tsc -b` (emit) | `packages/tsconfig/library.json` or `nest.json` |
| `apps/api` typecheck | `tsc -b --noEmit` | `module: ESNext`, `moduleResolution: Bundler` |
| `apps/api` emit | SWC (`.swcrc` `module.type=commonjs`) | via `nest build` |

Base `tsconfig` (all packages): `target: ES2023`, `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `isolatedModules: true`.

## Observability

| Signal | Implementation |
|---|---|
| Structured logs | nestjs-pino; JSON in prod, pino-pretty single-line in dev/test |
| Log levels | prod: `info`, dev: `debug`, test: `warn` |
| Trace propagation | W3C traceparent header → CLS → log `traceId` + error response `trace_id`; local traceId always CSPRNG-fresh |
| Correlation | `x-correlation-id` (≤128 chars, else randomUUID()) → CLS → log `correlationId` + error response `correlation_id` |
| Request ID | `x-request-id` (≤128 chars, else randomUUID()) → `cls.getId()` → error response `request_id` |
| Log injection | `mixin` (per-log, CLS async-hook scope) → requestId/correlationId/traceId on every line including jobs and shutdown |
| Secrets redaction | `redaction.config.ts` path list applied by pino-http |

## DDD Primitives (`@onwealth/core`)

Framework-agnostic, no runtime deps. Provides:

- `DomainEvent` — abstract base; `eventId` (UUID v4), `occurredOn` (Date), `abstract readonly eventName: string`
- `IntegrationEvent extends DomainEvent` — adds `source` (string), `version` (number); re-declares `abstract override readonly eventName` to satisfy `noImplicitOverride`
- `BaseAggregateRoot` — private domain-event queue with `addDomainEvent()`, `getDomainEvents()`, `clearDomainEvents()`

**`eventName` must be an explicit literal** (`packages/core/src/base/domain-event.ts:40`). Relying on `this.constructor.name` is unsafe under SWC/Terser class-name mangling. Every subclass must declare:
```ts
override readonly eventName = 'bounded-context.event-happened'
```

Not yet wired to an event bus — reserved for Phase 3.

## ErrorCode (`@onwealth/platform/error-codes`)

`ErrorCode` is a `const` object (not a TypeScript enum) of opaque string literals grouped by category:

| Category | Examples |
|---|---|
| validation | `VALIDATION_ERROR`, `VALIDATION_FAILED`, `REQUIRED_FIELD`, `CONSTRAINT_VIOLATION`, `INVALID_FORMAT`, `OUT_OF_RANGE` |
| resource | `RESOURCE_NOT_FOUND`, `USER_NOT_FOUND` |
| conflict | `RESOURCE_CONFLICT`, `EMAIL_EXISTS`, `IDEMPOTENCY_KEY_REUSE_CONFLICT` |
| auth | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS` |
| authz | `FORBIDDEN`, `INSUFFICIENT_SCOPE`, `ACCOUNT_BANNED` |
| general | `INTERNAL_SERVER_ERROR`, `RATE_LIMIT_EXCEEDED`, `REQUEST_TIMEOUT` |

`CONSTRAINT_VIOLATION` is new in Foundation Hardening — mapped from SQLSTATE `23514` (check constraint). Distinct from `RESOURCE_CONFLICT` (unique violation).

The `code` field in `ProblemDetailsDto` is typed `string` so feature modules may register domain-specific codes alongside the platform constants.

## Planned (not yet implemented)

- Feature modules under `apps/api/src/modules/{ctx}/`
- `@nestjs/terminus` health indicators (readiness/liveness probes)
- Redis-backed throttler store
- Authentication (JWT / OAuth)
- DDD layer rules in dependency-cruiser (presentation-no-database, etc.)
- `@ApiResponse` / `@ApiOperation` decorators on individual route handlers (currently only the global default error response is injected)
