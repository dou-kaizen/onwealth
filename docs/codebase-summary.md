# Codebase Summary

Monorepo: pnpm workspaces + Turborepo. Four workspaces: one app + three packages.

---

## Workspace Map

```
boilerplate-monorepo/
├── apps/api/                          NestJS 11 application (composition root)
├── packages/database/                 @boilerplate/database — Drizzle ORM schema + migrations
├── packages/shared-kernel/            @boilerplate/shared-kernel — transport-agnostic NestJS modules
├── packages/nest-http/                @boilerplate/nest-http — HTTP cross-cutting layer
├── biome.json                         Root lint + format config (Biome v2)
├── lefthook.yml                       Git hooks: pre-commit (biome), commit-msg (Conventional Commits), pre-push (typecheck+test)
├── turbo.json                         Task pipeline (build, test, typecheck, lint, dev); globalDependencies includes .dependency-cruiser.base.mjs
├── .dependency-cruiser.base.mjs       Shared dependency-cruiser base: no-circular rule + cruise options; extended by each package
├── pnpm-workspace.yaml                Workspace globs: apps/*, packages/*
├── package.json                       Root scripts (incl. "test": turbo run test) + pnpm config; lefthook in devDependencies + onlyBuiltDependencies
└── .github/workflows/ci.yml           CI: two jobs (ci, migration-smoke)
```

---

## apps/api

**Stack:** NestJS 11, Express, ESM, TypeScript 5 strict, Vitest + SWC

Composition root only. `src/` contains: `app.module.ts`, `main.ts`, `modules/` (business modules), `__tests__/`.
All cross-cutting infrastructure moved to `@boilerplate/shared-kernel` and `@boilerplate/nest-http`.

### Entry Points

| File | Purpose |
|------|---------|
| `src/main.ts` | Thin entrypoint: `createHttpApp(AppModule)` + `app.useLogger(...)` + `app.listen()` + startup banner; hoists `app` reference for `unhandledRejection`/`uncaughtException` handlers that call `app.close()` + hard-stop fallback |
| `src/app.module.ts` | Root module: imports infrastructure modules from workspace packages, registers APP_GUARD, applies ETag middleware; registers `LocationHeaderInterceptor` and `LinkHeaderInterceptor` as DI providers |

### modules/ — Feature Modules

Currently empty (business modules land in future milestones). Reserved path: `src/modules/<domain>/<layer>/`.

### __tests__/ — Test Infrastructure

51 test cases across 10 spec files (50 run locally; 1 CI-guarded skip).

| File | Purpose |
|------|---------|
| `setup.ts` | Global test setup (Vitest) |
| `helpers/create-app.ts` | Creates `TestingModule`, calls `configureHttpApp(app, { testMode: true })` from `@boilerplate/nest-http` |
| `helpers/create-request.ts` | Supertest request factory for integration tests |
| `unit/global-modules.spec.ts` | Architecture guard: every `@Global()` must be in approved whitelist (3 cases) |
| `integration/di-token-identity.spec.ts` | Verifies DI token singletons across module boundaries (2 cases) |
| `integration/throttler-headers.spec.ts` | Asserts throttler response headers present (1 case) |
| `integration/with-timeout.spec.ts` | DB transaction timeout via `withTimeout`; `describe.skipIf(!DATABASE_URL)` — skips offline, runs in CI (1 case) |
| `integration/global-pipeline.spec.ts` | Regression gate: verifies `configureHttpApp()` wires all global filters/interceptors; uses `vi.hoisted()` to set env before AppModule import |

### Config Files (apps/api root)

| File | Purpose |
|------|---------|
| `vitest.config.mts` | SWC + vite-tsconfig-paths, v8 coverage, thresholds at 0 |
| `vitest.e2e.config.mts` | E2E vitest config |
| `.dependency-cruiser.mjs` | Per-package layer-specific forbidden rules; extends root `.dependency-cruiser.base.mjs` |
| `nest-cli.json` | NestJS CLI build config |
| `tsconfig.json` | `strict: true`, `noUncheckedIndexedAccess`, `emitDecoratorMetadata`, `nodenext` |

---

## packages/shared-kernel

**Package:** `@boilerplate/shared-kernel` — transport-agnostic NestJS modules (no HTTP deps)

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `cache/` | `cache.port.ts`, `cache.module.ts`, `cache.service.ts` | `CachePort` interface + `CACHE_PORT` Symbol; cache-manager + @keyv/redis adapter; self-loads `redisConfig` via `ConfigModule.forFeature(redisConfig)` |
| `config/` | `app.config.ts`, `database.config.ts`, `redis.config.ts`, `env.schema.ts` | Config namespaces (`appConfig`, `databaseConfig`, `redisConfig`); Zod env schema + `validateEnv` |
| `database/` | `db.port.ts`, `db.module.ts`, `db.provider.ts`, `drizzle.service.ts`, `db.helpers.ts` | `DB_TOKEN` Symbol; `DrizzleModule.forRoot()`; Pool factory; `DrizzleService`; self-loads `databaseConfig` via `ConfigModule.forFeature(databaseConfig)`; `DEFAULT_IDLE_TIMEOUT_MS = ms('30s')`, `DEFAULT_CONNECTION_TIMEOUT_MS = ms('5s')` in `db.provider.ts` |
| `domain/` | `base-aggregate-root.ts`, `events/` | `BaseAggregateRoot` (private `#domainEvents[]`); `DomainEvent`, `IntegrationEvent` base classes |
| `errors/` | `error-code.ts`, `validation-error.ts` | `ErrorCode` enum for problem type URIs |
| `events/` | `domain-events.module.ts`, `domain-event-publisher.ts` | Global `DomainEventsModule`; clear-then-emit via EventEmitter2 (at-most-once) |
| `logger/` | `logger.module.ts`, `logger.config.ts`, `redaction.config.ts` | nestjs-pino `LoggerModule`; sensitive field redaction; `logger.config.ts` overrides `forRoutes` to `{*path}` (Express 5 / path-to-regexp v8 — suppresses Nest 11 LegacyRouteConverter warning) |
| `queue/` | `queue.module.ts`, `queue-processor.base.ts`, `queue-processor.base.internal.ts`, `queue-payload-size.guard.ts`, `queue-dlq.helper.ts`, `queue.decorator.ts`, `queue.config.ts`, `queue.constant.ts`, `queue.enum.ts`, `queue.exception.ts`, `queue-job-result.type.ts`, `queue-job-data.types.ts`, `queue/README.md` | BullMQ abstraction — production-hardened scaffold (see Queue Scaffold below); `QUEUE_DRAIN_TIMEOUT_MS = ms('5s')` named constant in `queue-processor.base.ts` |

### Queue (`packages/shared-kernel/src/queue/`)

BullMQ abstraction layer — production-hardened scaffold, no concrete queues registered. `apps/api` does NOT import `QueueModule` until a concrete queue is introduced.

- **`QueueModule`** — `@Global()` static module; registers two named BullMQ root connections (`queue` producer key, `queue-processor` worker key), self-loads `queueConfig` via `ConfigModule.forFeature`. `defaultJobOptions`: `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }`.
- **`QueueProcessorBase`** — abstract `WorkerHost` subclass; `onFailed` emits structured NestJS `Logger` output. Failure-log branching in pure `_evaluateJobFailure(job, error)`. `onModuleDestroy` drains via `worker.close(false)` (waits for active jobs) with 5000 ms timeout race. `FatalQueueException` is treated as terminal regardless of attempt count (`instanceof` check — legacy `error.isFatal` dropped).
- **`QueueProcessor`** — decorator wrapping `@Processor` with the shared processor connection key; JSDoc documents `limiter` rate-limit option with example.
- **`FatalQueueException`** — subclass of `QueueException`; signals dead-letter routing without exhausting retries.
- **`QueueDlqHelper`** — `getFailedJobs(queue)` + `retryFailedJob(queue, jobId)` + `FailedJobSummary` DTO. Pure delegation over BullMQ native `failed` set. Exported from barrel.
- **`QueueJobResult`** — return type contract for all processors. **`EnumQueuePriority`** — job priority levels.
- **`queueConfig`** — `registerAs('queue', ...)` namespace; resolves `QUEUE_REDIS_URL ?? REDIS_URL`. Redis connection for queues is kept fully separate from the cache `@keyv/redis` client.
- **`queue/README.md`** — Quick Start, Gotchas (4 production traps), Production Checklist (10 items), DLQ migration sketch.

### __tests__/ — Specs (packages/shared-kernel)

| File | Purpose |
|------|---------|
| `__tests__/unit/global-modules.spec.ts` | Architecture guard for shared-kernel globals (3 cases) |
| `cache/__tests__/cache.service.spec.ts` | CacheService unit tests (5 cases) |
| `config/__tests__/env-pool-validation.spec.ts` | Env schema validation unit tests (6 cases) |
| `queue/__tests__/queue.exception.spec.ts` | QueueException unit tests (3 cases) |
| `queue/__tests__/queue.config.spec.ts` | queueEnvSchema parsing + prod-TLS guard (10 cases) |
| `queue/__tests__/queue-processor-base.spec.ts` | `_evaluateJobFailure` pure-function tests including `FatalQueueException` terminal path (7 cases) |
| `queue/__tests__/queue-processor-base.integration.spec.ts` | 5 integration scenarios via `@testcontainers/redis` (redis:7.4-alpine): success, retry-exhausted, FatalQueueException short-circuit, stalled, graceful drain |
| `queue/__tests__/queue-dlq-helper.integration.spec.ts` | 4 integration scenarios for `QueueDlqHelper` |
| `queue/__tests__/fixtures/echo-processor.ts` | `EchoProcessor` + `EchoStalledProcessor` test fixtures |

Integration test split: `vitest.config.integration.ts` in `packages/shared-kernel` runs testcontainer-backed specs separately from unit tests. New devDep: `@testcontainers/redis@12.x`.

Build: `tsdown` → `dist/index.mjs` + `dist/index.d.mts`. All NestJS + infra deps are `peerDependencies`.

---

## packages/nest-http

**Package:** `@boilerplate/nest-http` — HTTP cross-cutting layer

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `bootstrap/` | `configure-http-app.ts`, `create-http-app.ts`, `http-app-options.ts` | `configureHttpApp(app, options?)` — shared setup for prod + tests; retrieves `LocationHeaderInterceptor`/`LinkHeaderInterceptor` via `app.get()` (DI providers, not `new`); `createHttpApp(module, options?)` — prod entrypoint wrapper; `REQUEST_TIMEOUT_MS = ms('30s')` named constant |
| `config/` | `http.config.ts`, `throttle.config.ts`, `security.config.ts`, `swagger.config.ts`, `cls.config.ts`, `validation.config.ts` | `httpConfig`, `throttleConfig` namespaces; CORS factory; Swagger+Scalar; CLS config; `ValidationPipe` factory; `THROTTLE_TTL` enforced ≥ 1000 ms (milliseconds) |
| `filters/` | `all-exceptions.filter.ts`, `database-error-mapper.ts`, `problem-details.filter.ts`, `throttler-exception.filter.ts` | AllExceptions catch-all (DB error mapping extracted to `database-error-mapper.ts`); RFC 9457 ProblemDetails; 429 throttler |
| `interceptors/` | 7 interceptors + `trace-context.util.ts`, `link-header-builder.ts` | RequestContext, CorrelationId, TraceContext, Timeout, LocationHeader, LinkHeader (link building extracted to `link-header-builder.ts`), Transform; LocationHeader and LinkHeader are DI providers (`@Inject(httpConfig.KEY)`) |
| `middleware/` | `etag.middleware.ts` | ETag on all routes |
| `health/` | `health.module.ts`, `health.controller.ts`, `drizzle.health.ts`, `redis.health.ts` | `HealthModule`; `/livez`, `/readyz`, `/health`; Terminus indicators; thrown errors become static `ServiceUnavailableException` — error.message never surfaced (prevents infra topology leaks); `HEALTH_TIMEOUT_MS = ms('3s')` in `drizzle.health.ts` + `redis.health.ts`; `LIVENESS_HEAP_LIMIT = bytes('300mb')`, `DETAILED_HEAP_LIMIT = bytes('150mb')`, `DETAILED_RSS_LIMIT = bytes('300mb')` in `health.controller.ts` |
| `decorators/` | `public.decorator.ts`, `use-envelope.decorator.ts`, `api-problem-responses.decorator.ts`, `validators/` | `@Public`, `@UseEnvelope`, `@ApiProblemResponses`, typed validators |
| `dtos/` | `cursor-pagination.dto.ts`, `offset-pagination.dto.ts`, `list-response.dto.ts`, `problem-details.dto.ts` | Shared HTTP DTOs |

### __tests__/ — Specs (packages/nest-http)

| File | Purpose |
|------|---------|
| `health/__tests__/health.controller.spec.ts` | HealthController unit tests (9 cases) |
| `interceptors/__tests__/trace-context.util.spec.ts` | TraceContext utility unit tests (14 cases) |
| `interceptors/__tests__/transform.interceptor.spec.ts` | TransformInterceptor unit tests (7 cases) |

**Scoped CSP:** `/swagger` and `/docs` HTML routes get a per-route helmet middleware with conservative CSP directives (`frame-ancestors`, `object-src`, `base-uri`, `form-action` all `'none'`; `script-src`/`style-src` allow `'self' 'unsafe-inline' cdn.jsdelivr.net`). Global API routes have CSP off (JSON responses do not need it).

Build: `tsdown` → `dist/index.mjs` + `dist/index.d.mts`. All NestJS + infra deps are `peerDependencies`.

---

## packages/database

**Package:** `@boilerplate/database` — Drizzle ORM 0.44.7, pg 8.16.3 (peer), drizzle-kit 0.31.6, tsdown ESM build

| File/Dir | Purpose |
|----------|---------|
| `src/schemas/index.ts` | Re-exports all schemas (currently `export {}` placeholder) |
| `src/index.ts` | Package entrypoint — re-exports `src/schemas/index.ts` |
| `drizzle/` | Generated migration files (drizzle-kit output) |
| `sql/00-init-role-timeouts.sql` | Sets `lock_timeout` + `statement_timeout` for migration role |
| `drizzle.config.ts` | drizzle-kit config: schema `./src/schemas`, dialect postgresql, strict mode |

Pool creation is **not** in this package — owned by `DrizzleService` in `@boilerplate/shared-kernel`.
This package exports schema types only.

---

## CI Pipeline

Two GitHub Actions jobs on push to `main`/`init-infrastructure` and PR to `main`:

**`ci` job** (Node 22, pnpm 10.32.1):
`typecheck` → `lint` → `turbo test` (all packages) → `deps` (arch check) → `build`

**`migration-smoke` job** (postgres:16-alpine service):
`build database package` → `db:init-roles` → `db:migrate` × 2 (second asserts idempotency)

---

## Key Injection Tokens

| Token | Type | Defined In | Provided By |
|-------|------|-----------|-------------|
| `DB_TOKEN` | `Symbol` | `@boilerplate/shared-kernel` `database/db.port.ts` | `DrizzleModule.forRoot()` |
| `CACHE_PORT` | `Symbol` | `@boilerplate/shared-kernel` `cache/cache.port.ts` | `CacheModule` → `CacheService` |

Both symbols are defined in exactly one file and imported only from `@boilerplate/shared-kernel`.

---

## Global Modules (Architecture Guard Whitelist)

These are the only modules permitted to be `@Global()` — enforced by `packages/shared-kernel/src/__tests__/unit/global-modules.spec.ts`:

- `DrizzleModule` (from `@boilerplate/shared-kernel`)
- `DomainEventsModule` (from `@boilerplate/shared-kernel`)
- `ClsModule` (via `nestjs-cls`)
- `ConfigModule` (via `@nestjs/config`)
- `LoggerModule` (from `@boilerplate/shared-kernel`, via `nestjs-pino`)
- `QueueModule` (from `@boilerplate/shared-kernel`)
