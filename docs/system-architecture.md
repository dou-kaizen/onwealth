# System Architecture

_Last updated: 2026-05-04 | Branch: init-infrastructure_

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
| `core-no-runtime-libs` | `packages/core/` cannot import ioredis, pino, bcrypt, drizzle-orm, pg |
| `database-no-nestjs` | `packages/database/` cannot import `@nestjs/*` |
| `platform-no-feature` | `packages/platform/` cannot import feature symbols (auth/user/telegram/bot) |
| `api-no-platform-internal` | `apps/api/` must use `@onwealth/platform/*` subpath, never `packages/platform/src/` relative path |

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

helmet is configured before any route registration. When swagger is enabled, CSP is relaxed to allow `cdn.jsdelivr.net` (Scalar bundle), `unsafe-inline`, and `unsafe-eval` (Swagger UI spec parsing). Production with `ENABLE_SWAGGER` unset defaults to `false` → strict helmet with no route exposure.

```
swaggerExplicit = ENABLE_SWAGGER env (boolean | undefined after Zod transform)
swaggerEnabled  = swaggerExplicit ?? (NODE_ENV !== 'production')
```

## Request Lifecycle

```
HTTP Request
  │
  ├─ CLS middleware (nestjs-cls)
  │    captures: request_id (x-request-id or UUID)
  │              correlation_id (x-correlation-id or UUID)
  │              W3C traceparent → traceId, parentId, traceFlags
  │              tracestate
  │
  ├─ pino-http (nestjs-pino)
  │    autoLogging: only /api/* paths
  │    excluded: GET /health, /health/live, /health/ready
  │    customProps: correlationId, traceId on every log line
  │
  ├─ helmet (security headers)
  │    strict default OR permissive CSP (jsdelivr + unsafe-inline/eval)
  │    depending on swaggerEnabled — configured before route registration
  │
  ├─ ThrottlerGuard (APP_GUARD — global)
  │    config: THROTTLE_TTL / THROTTLE_LIMIT from env
  │
  ├─ ValidationPipe (whitelist=true, errorHttpStatusCode=422, transform=true)
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

## Database Error Mapping (`mapDatabaseError`)

`AllExceptionsFilter` unwraps `DrizzleQueryError` → `pg.DatabaseError` and calls `mapDatabaseError`. SQLSTATE → HTTP mapping:

| SQLSTATE | Class | HTTP | ErrorCode |
|---|---|---|---|
| `23505` | unique violation | 409 | `RESOURCE_CONFLICT` |
| `23503` | FK violation | 422 | `RESOURCE_CONFLICT` |
| `23502` | not-null violation | 422 | `REQUIRED_FIELD` |
| `23514` | check violation | 422 | `RESOURCE_CONFLICT` |
| `08000`, `08001`, `08003`, `08004`, `08006` | connection errors | 503 | `SERVICE_UNAVAILABLE` |
| `57014` | statement_timeout | 503 | `SERVICE_UNAVAILABLE` |
| (default) | all other codes | 500 | `INTERNAL_SERVER_ERROR` |

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
| Trace propagation | W3C traceparent header → CLS → log `traceId` field + error response `trace_id` |
| Correlation | `x-correlation-id` header → CLS → log `correlationId` + error response `correlation_id` |
| Request ID | `x-request-id` header or UUID → `cls.getId()` → error response `request_id` |
| Secrets redaction | `redaction.config.ts` path list applied by pino-http |

## DDD Primitives (`@onwealth/core`)

Framework-agnostic, no runtime deps. Provides:

- `DomainEvent` — abstract base; `eventId` (UUID v4), `occurredOn` (Date), `eventName` (string)
- `IntegrationEvent extends DomainEvent` — adds `source` (string) and `version` (number)
- `BaseAggregateRoot` — private domain-event queue with `addDomainEvent()`, `getDomainEvents()`, `clearDomainEvents()`

Not yet wired to an event bus — reserved for Phase 3.

## ErrorCode (`@onwealth/platform/error-codes`)

`ErrorCode` is a `const` object (not a TypeScript enum) of opaque string literals grouped by category:

| Category | Examples |
|---|---|
| validation | `VALIDATION_ERROR`, `INVALID_INPUT` |
| resource | `RESOURCE_NOT_FOUND`, `RESOURCE_ALREADY_EXISTS` |
| conflict | `CONFLICT` |
| auth | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `TOKEN_INVALID` |
| authz | `FORBIDDEN`, `INSUFFICIENT_PERMISSIONS` |
| general | `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE` |

The `code` field in `ProblemDetailsDto` is typed `string` so feature modules may register domain-specific codes alongside the platform constants.

## Planned (not yet implemented)

- Feature modules under `apps/api/src/modules/{ctx}/`
- `@nestjs/terminus` health indicators (readiness/liveness probes)
- Redis-backed throttler store
- Authentication (JWT / OAuth)
- DDD layer rules in dependency-cruiser (presentation-no-database, etc.)
- `@ApiResponse` / `@ApiOperation` decorators on individual route handlers (currently only the global default error response is injected)
