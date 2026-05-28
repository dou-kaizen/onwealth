# Project Structure Documentation

## Overview

This document is a per-folder, per-layer navigation map for the `boilerplate-monorepo` pnpm
workspace. The monorepo uses Turborepo for task orchestration and follows a DDD-lite
ports-and-adapters pattern. For high-level workspace roles, test counts, and build metrics
see [../codebase-summary.md](../codebase-summary.md). Per-topic docs (cache, queue, database,
etc.) own the deep technical content; this document points to them.

## Related Documents

- [../codebase-summary.md](../codebase-summary.md) — high-level workspace overview, file/test counts, key scripts
- [./configuration.md](./configuration.md) — NestJS ConfigModule, namespaced config factories
- [./environment.md](./environment.md) — Zod env schema, all env vars, production rules
- [./installation.md](./installation.md) — prerequisites, quick start, verification
- [./database.md](./database.md) — Drizzle ORM, pg pool, migration workflow (Phase 3)
- [./cache.md](./cache.md) — Redis integration, CachePort abstraction, TTL policy (Phase 3)
- [./queue.md](./queue.md) — BullMQ, queue config, processor pattern (Phase 3)
- [./logger.md](./logger.md) — nestjs-pino, redaction, log levels, CLS correlation (Phase 3)
- [./response.md](./response.md) — envelope interceptor, pagination, ListResponseDto (Phase 4)
- [./handling-error.md](./handling-error.md) — AllExceptions filter, RFC 9457 Problem Details (Phase 4)
- [./security-and-middleware.md](./security-and-middleware.md) — Helmet, CORS, throttler, ETag, CLS (Phase 4)
- [./request-validation.md](./request-validation.md) — ValidationPipe, class-validator, 422 semantics (Phase 4)

## Table of Contents

- [Workspace Layout](#workspace-layout)
- [apps/api](#appsapi)
- [packages/shared-kernel](#packagesshared-kernel)
- [packages/nest-http](#packagesnest-http)
- [packages/database](#packagesdatabase)
- [Root Files](#root-files)
- [References](#references)

---

## Workspace Layout

```
boilerplate-monorepo/
├── apps/
│   └── api/                           NestJS 11 application — composition root
├── packages/
│   ├── database/                      @boilerplate/database — Drizzle ORM + migrations
│   ├── shared-kernel/                 @boilerplate/shared-kernel — transport-agnostic modules
│   └── nest-http/                     @boilerplate/nest-http — HTTP cross-cutting layer
├── .github/
│   └── workflows/
│       └── ci.yml                     CI pipeline (two jobs: ci, migration-smoke)
├── .dependency-cruiser.base.mjs       Shared dependency-cruiser base config
├── biome.json                         Root lint + format config (Biome v2)
├── lefthook.yml                       Git hooks: pre-commit, commit-msg, pre-push
├── package.json                       Root scripts + pnpm config
├── pnpm-workspace.yaml                Workspace globs: apps/*, packages/*
└── turbo.json                         Task pipeline: build, test, typecheck, lint, dev
```

The workspace follows a strict dependency direction: `apps/api` → `packages/nest-http` →
`packages/shared-kernel` → `packages/database`. Circular dependencies are enforced by
`.dependency-cruiser.base.mjs` (extended per package).

---

## apps/api

```
apps/api/
├── src/
│   ├── __tests__/                     Integration + unit test suite (51 cases / 10 spec files)
│   ├── modules/                       Reserved for business domain modules (empty until M2+)
│   ├── app.module.ts                  Root module — imports infra modules, registers guards/interceptors
│   └── main.ts                        Entrypoint — createHttpApp(AppModule) + app.listen() + signal handlers
├── nest-cli.json                      NestJS CLI build config
├── tsconfig.json                      strict, noUncheckedIndexedAccess, emitDecoratorMetadata, nodenext
├── vitest.config.mts                  SWC + vite-tsconfig-paths, v8 coverage
├── vitest.e2e.config.mts              E2E vitest config
└── .dependency-cruiser.mjs            Per-package forbidden rules; extends root base config
```

### src/app.module.ts and src/main.ts

`main.ts` is a thin entrypoint: calls `createHttpApp(AppModule)`, attaches a pino logger,
and starts the server with `unhandledRejection`/`uncaughtException` handlers that invoke
`app.close()` followed by a hard-stop fallback. `app.module.ts` is the composition root:
it imports all infrastructure modules from workspace packages, registers `APP_GUARD`,
applies `ETag` middleware, and registers `LocationHeaderInterceptor`/`LinkHeaderInterceptor`
as DI providers.

### src/modules/ — Feature Modules

Currently empty; reserved path for business domain modules landing in M2+.
Pattern: `src/modules/<domain>/<layer>/`.

### src/__tests__/ — Test Infrastructure

51 test cases across 10 spec files (50 run locally; 1 CI-guarded skip). Includes global
setup, Supertest helpers, architecture guards, DI token identity checks, throttler header
assertions, and a DB transaction timeout integration test (`describe.skipIf(!DATABASE_URL)`).

---

## packages/shared-kernel

```
packages/shared-kernel/
└── src/
    ├── __tests__/                     Package-level architecture guard specs
    ├── cache/                         CachePort abstraction + Redis adapter
    ├── config/                        Config namespaces + Zod env schema
    ├── database/                      DB_TOKEN + DrizzleModule + pool factory
    ├── domain/                        BaseAggregateRoot + domain/integration events
    ├── errors/                        ErrorCode enum + ValidationError
    ├── events/                        DomainEventsModule + publisher
    ├── logger/                        nestjs-pino LoggerModule + redaction
    ├── queue/                         BullMQ abstraction scaffold + README
    ├── utils/                         Header sanitization + prototype-pollution guard
    └── index.ts                       Public barrel export
```

`@boilerplate/shared-kernel` is transport-agnostic (zero HTTP dependencies). Every module
is safe to run in a worker/queue process. Builds to `dist/index.mjs` via `tsdown`.
All NestJS and infra dependencies are declared as `peerDependencies`.

### cache/

Houses `CachePort` (interface), `CACHE_PORT` Symbol, `CacheModule`, and the cache-manager
+ `@keyv/redis` adapter. Self-loads `redisConfig` via `ConfigModule.forFeature`. See
[./cache.md](./cache.md) for TTL policy, eviction strategy, and graceful shutdown.

### config/

Four config factories: `appConfig`, `databaseConfig`, `redisConfig` (all in namespaced
`registerAs` form), plus `env.schema.ts` which holds the root Zod env schema and the
`validateEnv` export. See [./configuration.md](./configuration.md) for module wiring and
[./environment.md](./environment.md) for every env var and production hardening rules.

### database/

Contains `DB_TOKEN` Symbol, `DrizzleModule.forRoot()`, the pg `Pool` factory
(`db.provider.ts`), `DrizzleService`, and `db.helpers.ts` (`withTimeout` helper).
Self-loads `databaseConfig` via `ConfigModule.forFeature`. See [./database.md](./database.md)
for pool settings, migration workflow, and timeout constants.

### domain/

`base-aggregate-root.ts` — `BaseAggregateRoot` with a private `#domainEvents[]` array.
`events/` — `DomainEvent` and `IntegrationEvent` base classes. No per-topic doc (in-progress
domain model, to be expanded in M2+). Source: `packages/shared-kernel/src/domain/`.

### errors/

`error-code.ts` — `ErrorCode` enum providing problem-type URIs for RFC 9457 responses.
`validation-error.ts` — `ValidationError` extending the base error contract.
These are consumed by `packages/nest-http/src/filters/`.

### events/

`DomainEventsModule` (global) and `DomainEventPublisher`. The publisher implements a
clear-then-emit pattern via EventEmitter2 (at-most-once delivery). Source:
`packages/shared-kernel/src/events/`.

### logger/

`LoggerModule` wrapping nestjs-pino, a `logger.config.ts` that overrides `forRoutes` to
`{*path}` (suppresses Nest 11 LegacyRouteConverter warning), and `redaction.config.ts`
for sensitive-field path rules. See [./logger.md](./logger.md) for log levels, CLS
correlation, and redaction configuration.

### queue/

Full BullMQ abstraction scaffold: `QueueModule`, `QueueProcessorBase` (abstract
`WorkerHost`), `QueueProcessor` decorator, `FatalQueueException`, `QueueDlqHelper`,
`QueueJobResult`, `EnumQueuePriority`, and a developer-facing `README.md`.
No concrete queues are registered here; `apps/api` imports `QueueModule` only when a
concrete queue is introduced. See [./queue.md](./queue.md) for retry policy, DLQ pattern,
and graceful drain behaviour.

### utils/

`sanitize-header-value.ts`, `sanitize-redis-url.ts`, and
`strip-prototype-pollution-keys.ts`. Utility functions shared across packages to prevent
header injection and prototype-pollution attacks. Source:
`packages/shared-kernel/src/utils/`.

---

## packages/nest-http

```
packages/nest-http/
└── src/
    ├── bootstrap/                     configureHttpApp() + createHttpApp() factory
    ├── config/                        HTTP, throttle, security, Swagger, CLS, validation configs
    ├── decorators/                    @Public, @UseEnvelope, @ApiProblemResponses, validators/
    ├── dtos/                          Shared HTTP DTOs (pagination, list response, problem details)
    ├── filters/                       Exception filters (AllExceptions, ProblemDetails, throttler)
    ├── health/                        HealthModule + /livez /readyz /health endpoints
    ├── interceptors/                  7 interceptors + trace util + link builder
    ├── middleware/                    ETag middleware
    └── index.ts                       Public barrel export
```

`@boilerplate/nest-http` is the HTTP cross-cutting layer and depends on
`@boilerplate/shared-kernel`. Contains no business logic. Builds to `dist/index.mjs`
via `tsdown`. Consumed by `apps/api` as the sole HTTP configuration authority.

### bootstrap/

`configureHttpApp(app, options?)` — shared setup function for both production and test
mode: applies global filters, interceptors, pipes, versioning, Swagger, CLS, and security
headers. `createHttpApp(module, options?)` — production entrypoint wrapper. `http-app-options.ts`
defines the options type. `REQUEST_TIMEOUT_MS = ms('30s')` named constant lives here.
See [./security-and-middleware.md](./security-and-middleware.md) for the full setup sequence.

### config/

Six config modules: `http.config.ts` (`httpConfig` namespace), `throttle.config.ts`
(`throttleConfig`, `THROTTLE_TTL` ≥ 1000 ms), `security.config.ts` (CORS factory, Helmet
options), `swagger.config.ts` (Swagger + Scalar), `cls.config.ts` (CLS store config),
`validation.config.ts` (`ValidationPipe` factory). See
[./security-and-middleware.md](./security-and-middleware.md) for wiring and
[./configuration.md](./configuration.md) for the ConfigModule pattern.

### decorators/

`@Public` — marks a route as exempt from the global auth guard.
`@UseEnvelope` — opts a controller into the `TransformInterceptor` response envelope.
`@ApiProblemResponses` — Swagger decorator for standard error response shapes.
`validators/` — typed validators (barrel at `validators/index.ts`). Source:
`packages/nest-http/src/decorators/`.

### dtos/

Shared HTTP Data Transfer Objects: `cursor-pagination.dto.ts`,
`offset-pagination.dto.ts`, `list-response.dto.ts`, `problem-details.dto.ts`.
See [./response.md](./response.md) for pagination response shape and envelope contract.

### filters/

`all-exceptions.filter.ts` — catch-all filter; delegates DB error mapping to
`database-error-mapper.ts`.
`problem-details.filter.ts` — serialises errors to RFC 9457 `application/problem+json`.
`throttler-exception.filter.ts` — translates 429 throttler exceptions to Problem Details.
See [./handling-error.md](./handling-error.md) for the full filter chain and error type
taxonomy.

### interceptors/

Seven interceptors plus two utilities:

| File | Purpose |
|---|---|
| `request-context.interceptor.ts` | Stores request metadata in CLS context |
| `correlation-id.interceptor.ts` | Propagates / generates `X-Correlation-Id` header |
| `trace-context.interceptor.ts` | Propagates W3C Trace Context headers |
| `trace-context.util.ts` | Pure helper for trace parent/state parsing |
| `timeout.interceptor.ts` | Applies `REQUEST_TIMEOUT_MS` deadline to every request |
| `location-header.interceptor.ts` | Appends `Location` header on 201 responses |
| `link-header.interceptor.ts` | Appends RFC 8288 `Link` pagination headers |
| `link-header-builder.ts` | Pure link-set builder (extracted for testability) |
| `transform.interceptor.ts` | Wraps response in `{ data, meta }` envelope when `@UseEnvelope` present |

`LocationHeaderInterceptor` and `LinkHeaderInterceptor` are registered as DI providers
(not `useGlobalInterceptors`) so they can receive injected config. See
[./response.md](./response.md) for envelope and pagination details.

### middleware/

`etag.middleware.ts` — applies ETag weak-comparison (`W/"..."`) on cacheable responses;
strips the `W/` prefix before comparison to normalise client `If-None-Match` headers.
Applied globally in `apps/api/src/app.module.ts`. See
[./security-and-middleware.md](./security-and-middleware.md) for the full middleware stack.

Note: `csp-scoped` middleware referenced in earlier design notes is not present in the
current source tree. CSP is applied via Helmet in `security.config.ts`.

### health/

`HealthModule` exposes `/livez`, `/readyz`, and `/health` endpoints via
`@nestjs/terminus`. `drizzle.health.ts` and `redis.health.ts` are custom Terminus
indicators with a `HEALTH_TIMEOUT_MS = ms('3s')` deadline. Errors are converted to a
static `ServiceUnavailableException` — the original error message is never surfaced to
prevent topology leaks. Heap and RSS limits are named constants in `health.controller.ts`.
Source: `packages/nest-http/src/health/`.

---

## packages/database

```
packages/database/
├── scripts/
│   └── init-roles.ts                  TypeScript init-roles runner (ts-node)
├── sql/
│   └── 00-init-role-timeouts.sql      Sets statement_timeout and idle_in_transaction_session_timeout per role
├── src/
│   ├── schemas/                       Drizzle schema definitions (placeholder until M2)
│   └── index.ts                       Public barrel export (currently stub)
├── .env.example                       Required env vars for database package
├── drizzle.config.ts                  Drizzle Kit config (migration output path, schema glob)
├── tsconfig.json                      TypeScript config for this package
└── tsdown.config.ts                   Build config
```

`@boilerplate/database` owns the Drizzle ORM schema definitions, migration output, and
role-initialisation SQL. It has no NestJS dependency; the NestJS integration layer lives in
`packages/shared-kernel/src/database/`. See [./database.md](./database.md) for pool
settings, migration workflow, and connection timeout constants.

### sql/

`00-init-role-timeouts.sql` — idempotent SQL script that sets
`statement_timeout` and `idle_in_transaction_session_timeout` per database role. Executed
by the `migration-smoke` CI job to enforce role-level query timeout policy.

### scripts/

`init-roles.ts` — TypeScript runner that connects and applies `sql/` scripts. Invoked by
`scripts/init-roles.ts` in CI before running migrations.

### src/schemas/

Placeholder directory for Drizzle schema definitions. Schema files land here in M2+.
Currently exports an empty barrel (`src/index.ts`).

### drizzle.config.ts

Drizzle Kit configuration: sets the migration output path and the schema glob targeting
`src/schemas/**`. See [./database.md](./database.md) for migration commands and workflow.

---

## Root Files

### Build and Tooling

| File | Purpose |
|---|---|
| `biome.json` | Root lint + format config for Biome v2; applies to all packages |
| `lefthook.yml` | Git hooks: `pre-commit` runs Biome lint, `commit-msg` enforces Conventional Commits, `pre-push` runs typecheck + tests |
| `turbo.json` | Turborepo task pipeline: `build`, `test`, `typecheck`, `lint`, `dev`; `globalDependencies` includes `.dependency-cruiser.base.mjs` |
| `.dependency-cruiser.base.mjs` | Shared base config: no-circular rule + cruise options; each package extends this with layer-specific forbidden rules |

### Workspace Config

| File | Purpose |
|---|---|
| `pnpm-workspace.yaml` | Workspace glob patterns: `apps/*`, `packages/*`; also declares `onlyBuiltDependencies` |
| `package.json` | Root scripts (including `"test": turbo run test`) + pnpm engine config; `lefthook` in `devDependencies` |

### CI

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Two jobs — `ci` (Lint / Typecheck / Test / Build on Node 22.x; needs Postgres 16 + Redis service containers) and `migration-smoke` (build database package → init roles → run migrations → assert idempotent second run); triggers on push to `main`/`init-infrastructure` and pull_request to `main` |

---

## References

- [../codebase-summary.md](../codebase-summary.md) — workspace overview, file/test counts, build metrics
- [./configuration.md](./configuration.md) — NestJS ConfigModule, namespaced config factories
- [./environment.md](./environment.md) — Zod env schema, all env vars, production hardening
- [./installation.md](./installation.md) — prerequisites and quick-start guide
- [./database.md](./database.md) — Drizzle ORM, pg pool, migrations (Phase 3)
- [./cache.md](./cache.md) — Redis, CachePort, TTL policy (Phase 3)
- [./queue.md](./queue.md) — BullMQ, retry, DLQ (Phase 3)
- [./logger.md](./logger.md) — pino, redaction, CLS (Phase 3)
- [./response.md](./response.md) — envelope, pagination (Phase 4)
- [./handling-error.md](./handling-error.md) — RFC 9457 filter chain (Phase 4)
- [./security-and-middleware.md](./security-and-middleware.md) — Helmet, CORS, throttler, ETag (Phase 4)
- [./request-validation.md](./request-validation.md) — ValidationPipe, 422 semantics (Phase 4)
