# Codebase Summary

_Last updated: 2026-05-04 | Branch: init-infrastructure (Foundation Hardening)_

## Repository Layout

```
onwealth/                          # pnpm + Turborepo monorepo
├── apps/
│   └── api/                       # @onwealth/api — NestJS HTTP entrypoint
├── packages/
│   ├── core/                      # @onwealth/core — framework-agnostic DDD primitives
│   ├── database/                  # @onwealth/database — Drizzle schemas only
│   ├── platform/                  # @onwealth/platform — NestJS foundation layer
│   └── tsconfig/                  # shared TypeScript presets
├── .dependency-cruiser.cjs        # 6 error-severity architectural boundary rules
├── pnpm-workspace.yaml            # catalog pins all dependency versions
└── turbo.json                     # task pipeline (build → lint → test → dev)
```

## Packages

| Package | Purpose | Key constraint |
|---|---|---|
| `@onwealth/core` | DDD primitives: `BaseAggregateRoot`, `DomainEvent`, `IntegrationEvent` | No `@nestjs/*`, no ioredis/pino/drizzle/pg |
| `@onwealth/database` | Drizzle schema barrel (`packages/database/src/schemas/index.ts`) | No `@nestjs/*`; empty in foundation phase |
| `@onwealth/platform` | NestJS modules + `ErrorCode` + `ProblemDetailsDto` — 12 subpath exports | No feature symbols (auth/user/bot) |
| `@onwealth/api` | Boots NestJS app, wires middleware chain | Consumes `@onwealth/platform/*` via subpath only — never relative |

## `@onwealth/platform` Subpath Exports

| Subpath | Contents |
|---|---|
| `.` | Root barrel re-export |
| `/config` | `ConfigModule` (Zod `envSchema`, `validateEnv`, `Env` type) |
| `/cls` | `ClsModule` — W3C traceparent + request/correlation IDs |
| `/logger` | `LoggerModule` — nestjs-pino, pino-pretty in dev, JSON in prod |
| `/filters` | `FiltersModule` — `AllExceptionsFilter`, `ProblemDetailsFilter`, `ThrottlerExceptionFilter` |
| `/interceptors` | `InterceptorsModule` — `TimeoutInterceptor`, `RequestContextInterceptor`, `CorrelationIdInterceptor`, `TraceContextInterceptor`, `TransformInterceptor` |
| `/decorators` | `@UseEnvelope()` decorator |
| `/pipes` | `createValidationPipe()` — whitelist, 422, transform |
| `/throttler` | `ThrottlerModule` — env-driven TTL/limit |
| `/database` | `DatabaseModule` (`forRoot()` / `forRootAsync(options)`), `DRIZZLE_TOKEN` + `POOL_TOKEN` injection tokens, `DrizzleDb` + `DrizzleInstance` types |
| `/error-codes` | `ErrorCode` const object + union type (opaque string literals, not enum) |
| `/problem-details` | `ProblemDetailsDto` (RFC 9457), `FieldError`, `ValidationErrorItem` |

## `apps/api` Bootstrap Order

1. `NestFactory.create(ApiModule, { bufferLogs: true })`
2. Swap logger → `nestjs-pino`
3. Body parsers — 10kb limit (JSON + urlencoded) before any route registration
4. Resolve `swaggerEnabled = ENABLE_SWAGGER ?? (NODE_ENV !== 'production')`
5. `helmet()` — strict CSP global; loose CSP path-mounted on `/swagger` + `/docs` only when swagger enabled
6. `trust proxy = 1` (single LB hop)
7. Cluster-safety check: logs WARN if `WORKERS > 1` (in-memory throttler not safe for multi-process)
8. `createValidationPipe()` (whitelist + 422 + transform + `enableImplicitConversion: false`)
9. 5 global interceptors (bind order): `TimeoutInterceptor` → `RequestContextInterceptor` → `CorrelationIdInterceptor` → `TraceContextInterceptor` → `TransformInterceptor`; first 4 via `app.get(...)` DI, `TransformInterceptor` via `new` (needs `reflector` + `cls`)
10. Global filters (registered LIFO — last registered runs first on exception):
    - registered 1st: `AllExceptionsFilter` → runs last (catch-all)
    - registered 2nd: `ProblemDetailsFilter` → runs middle
    - registered 3rd: `ThrottlerExceptionFilter` → runs first (catches 429)
11. `app.enableShutdownHooks()` — **must precede `app.listen()`** (SIGTERM → http drain → OnModuleDestroy)
12. CORS from `ALLOWED_ORIGINS` env; logs WARN if empty in non-test
13. `setupSwagger(app, configService)` — mounts `/docs`, `/swagger`, `/swagger-json`, `/openapi.yaml` (only when `swaggerEnabled`)
14. `app.listen(PORT)`

## API Modules (foundation)

| Module | Route | Notes |
|---|---|---|
| `HealthModule` | `GET /health` | `@SkipThrottle()` class-level; returns `{ status, uptime, timestamp }` in `{ data, meta }` via `@UseEnvelope()` |

## API Documentation Routes (env-gated)

Mounted only when `swaggerEnabled` is true:

| Route | Description |
|---|---|
| `GET /docs` | Scalar API Reference (interactive UI) |
| `GET /swagger` | Swagger UI |
| `GET /swagger-json` | OpenAPI JSON spec |
| `GET /openapi.yaml` | OpenAPI YAML spec |

Source: `apps/api/src/config/swagger.config.ts`

## Runtime Dependencies (catalog-pinned)

| Lib | Version | Role |
|---|---|---|
| NestJS | ^11.1.0 | HTTP framework |
| nestjs-pino | ^4.4.0 | Structured logging |
| nestjs-cls | ^5.0.0 | Request-scoped storage |
| drizzle-orm | ^0.44.7 | ORM |
| pg | ^8.16.3 | PostgreSQL driver (node-postgres pool) |
| postgres | ^3.4.8 | Catalog-pinned; not currently imported in source |
| zod | ^4.0.0 | Env validation |
| helmet | ^8.0.0 | Security headers |
| @nestjs/throttler | ^6.4.0 | Rate limiting |
| @nestjs/swagger | catalog | OpenAPI spec generation + Swagger UI |
| @scalar/nestjs-api-reference | catalog | Scalar API Reference UI (`/docs`) |

## Toolchain

| Tool | Purpose |
|---|---|
| pnpm 10.32.1 | Package manager |
| Turborepo ^2.9.7 | Task orchestration |
| TypeScript ^6.0.3 | Language |
| SWC | Compilation emit for `apps/api` (`.swcrc` `module.type=commonjs`) |
| oxlint ^1.59.0 | Linting (root devDep — not in catalog) |
| oxfmt ^0.44.0 | Formatting (root devDep — not in catalog) |
| dependency-cruiser ^16 | Architectural boundary enforcement (root devDep — not in catalog) |
| vitest ^2.1.0 | Testing |
