# Codebase Summary

Monorepo: pnpm workspaces + Turborepo. Four workspaces: one app + three packages.

---

## Workspace Map

```
onwealth/
├── apps/api/                          NestJS 11 application (composition root)
├── packages/database/                 @onwealth/database — Drizzle ORM schema + migrations
├── packages/shared-kernel/            @onwealth/shared-kernel — transport-agnostic NestJS modules
├── packages/nest-http/                @onwealth/nest-http — HTTP cross-cutting layer
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
All cross-cutting infrastructure moved to `@onwealth/shared-kernel` and `@onwealth/nest-http`.

### Entry Points

| File | Purpose |
|------|---------|
| `src/main.ts` | Thin entrypoint: `createHttpApp(AppModule)` + `app.useLogger(...)` + `app.listen()` + startup banner |
| `src/app.module.ts` | Root module: imports infrastructure modules from workspace packages, registers APP_GUARD, applies ETag middleware |

### modules/ — Feature Modules

Currently empty (business modules land in future milestones). Reserved path: `src/modules/<domain>/<layer>/`.

### __tests__/ — Test Infrastructure

51 test cases across 10 spec files (50 run locally; 1 CI-guarded skip).

| File | Purpose |
|------|---------|
| `setup.ts` | Global test setup (Vitest) |
| `helpers/create-app.ts` | Creates `TestingModule`, calls `configureHttpApp(app, { testMode: true })` from `@onwealth/nest-http` |
| `helpers/create-request.ts` | Supertest request factory for integration tests |
| `unit/global-modules.spec.ts` | Architecture guard: every `@Global()` must be in approved whitelist (3 cases) |
| `integration/di-token-identity.spec.ts` | Verifies DI token singletons across module boundaries (2 cases) |
| `integration/throttler-headers.spec.ts` | Asserts throttler response headers present (1 case) |
| `integration/with-timeout.spec.ts` | DB transaction timeout via `withTimeout`; `describe.skipIf(!DATABASE_URL)` — skips offline, runs in CI (1 case) |

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

**Package:** `@onwealth/shared-kernel` — transport-agnostic NestJS modules (no HTTP deps)

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `cache/` | `cache.port.ts`, `cache.module.ts`, `cache.service.ts` | `CachePort` interface + `CACHE_PORT` Symbol; cache-manager + @keyv/redis adapter |
| `config/` | `app.config.ts`, `database.config.ts`, `redis.config.ts`, `env.schema.ts` | Config namespaces (`appConfig`, `databaseConfig`, `redisConfig`); Zod env schema + `validateEnv` |
| `database/` | `db.port.ts`, `db.module.ts`, `db.provider.ts`, `drizzle.service.ts`, `db.helpers.ts` | `DB_TOKEN` Symbol; `DrizzleModule.forRoot()`; Pool factory; `DrizzleService` |
| `domain/` | `base-aggregate-root.ts`, `events/` | `BaseAggregateRoot` (private `#domainEvents[]`); `DomainEvent`, `IntegrationEvent` base classes |
| `errors/` | `error-code.ts`, `validation-error.ts` | `ErrorCode` enum for problem type URIs |
| `events/` | `domain-events.module.ts`, `domain-event-publisher.ts` | Global `DomainEventsModule`; clear-then-emit via EventEmitter2 (at-most-once) |
| `logger/` | `logger.module.ts`, `logger.config.ts`, `redaction.config.ts` | nestjs-pino `LoggerModule`; sensitive field redaction |

### __tests__/ — Specs (packages/shared-kernel)

| File | Purpose |
|------|---------|
| `__tests__/unit/global-modules.spec.ts` | Architecture guard for shared-kernel globals (3 cases) |
| `cache/__tests__/cache.service.spec.ts` | CacheService unit tests (5 cases) |
| `config/__tests__/env-pool-validation.spec.ts` | Env schema validation unit tests (6 cases) |

Build: `tsdown` → `dist/index.mjs` + `dist/index.d.mts`. All NestJS + infra deps are `peerDependencies`.

---

## packages/nest-http

**Package:** `@onwealth/nest-http` — HTTP cross-cutting layer

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `bootstrap/` | `configure-http-app.ts`, `create-http-app.ts`, `http-app-options.ts` | `configureHttpApp(app, options?)` — shared setup for prod + tests; `createHttpApp(module, options?)` — prod entrypoint wrapper |
| `config/` | `http.config.ts`, `throttle.config.ts`, `security.config.ts`, `swagger.config.ts`, `cls.config.ts`, `validation.config.ts` | `httpConfig`, `throttleConfig` namespaces; CORS factory; Swagger+Scalar; CLS config; `ValidationPipe` factory |
| `filters/` | `all-exceptions.filter.ts`, `problem-details.filter.ts`, `throttler-exception.filter.ts` | AllExceptions catch-all; RFC 9457 ProblemDetails; 429 throttler |
| `interceptors/` | 7 interceptors + `trace-context.util.ts` | RequestContext, CorrelationId, TraceContext, Timeout, LocationHeader, LinkHeader, Transform |
| `middleware/` | `etag.middleware.ts` | ETag on all routes |
| `health/` | `health.module.ts`, `health.controller.ts`, `drizzle.health.ts`, `redis.health.ts` | `HealthModule`; `/livez`, `/readyz`, `/health`; Terminus indicators |
| `decorators/` | `public.decorator.ts`, `use-envelope.decorator.ts`, `api-problem-responses.decorator.ts`, `validators/` | `@Public`, `@UseEnvelope`, `@ApiProblemResponses`, typed validators |
| `dtos/` | `cursor-pagination.dto.ts`, `offset-pagination.dto.ts`, `list-response.dto.ts`, `problem-details.dto.ts` | Shared HTTP DTOs |

### __tests__/ — Specs (packages/nest-http)

| File | Purpose |
|------|---------|
| `health/__tests__/health.controller.spec.ts` | HealthController unit tests (9 cases) |
| `interceptors/__tests__/trace-context.util.spec.ts` | TraceContext utility unit tests (14 cases) |
| `interceptors/__tests__/transform.interceptor.spec.ts` | TransformInterceptor unit tests (7 cases) |

Build: `tsdown` → `dist/index.mjs` + `dist/index.d.mts`. All NestJS + infra deps are `peerDependencies`.

---

## packages/database

**Package:** `@onwealth/database` — Drizzle ORM 0.44.7, pg 8.16.3 (peer), drizzle-kit 0.31.6, tsdown ESM build

| File/Dir | Purpose |
|----------|---------|
| `src/schemas/index.ts` | Re-exports all schemas (currently `export {}` placeholder) |
| `src/index.ts` | Package entrypoint — re-exports `src/schemas/index.ts` |
| `drizzle/` | Generated migration files (drizzle-kit output) |
| `sql/00-init-role-timeouts.sql` | Sets `lock_timeout` + `statement_timeout` for migration role |
| `drizzle.config.ts` | drizzle-kit config: schema `./src/schemas`, dialect postgresql, strict mode |

Pool creation is **not** in this package — owned by `DrizzleService` in `@onwealth/shared-kernel`.
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
| `DB_TOKEN` | `Symbol` | `@onwealth/shared-kernel` `database/db.port.ts` | `DrizzleModule.forRoot()` |
| `CACHE_PORT` | `Symbol` | `@onwealth/shared-kernel` `cache/cache.port.ts` | `CacheModule` → `CacheService` |

Both symbols are defined in exactly one file and imported only from `@onwealth/shared-kernel`.

---

## Global Modules (Architecture Guard Whitelist)

These are the only modules permitted to be `@Global()` — enforced by `packages/shared-kernel/src/__tests__/unit/global-modules.spec.ts`:

- `DrizzleModule` (from `@onwealth/shared-kernel`)
- `DomainEventsModule` (from `@onwealth/shared-kernel`)
- `ClsModule` (via `nestjs-cls`)
- `ConfigModule` (via `@nestjs/config`)
- `LoggerModule` (from `@onwealth/shared-kernel`, via `nestjs-pino`)
