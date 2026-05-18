# Codebase Summary

Monorepo: pnpm workspaces + Turborepo. Two workspaces: `apps/api` (NestJS) and `packages/database` (Drizzle schema).

---

## Workspace Map

```
onwealth/
├── apps/api/                          NestJS 11 application
├── packages/database/                 Drizzle ORM schema package
├── biome.json                         Root lint + format config (Biome v2)
├── turbo.json                         Task pipeline (build, test, typecheck, lint, dev)
├── pnpm-workspace.yaml                Workspace globs: apps/*, packages/*
├── package.json                       Root scripts + pnpm config
└── .github/workflows/ci.yml           CI: two jobs (ci, migration-smoke)
```

---

## apps/api

**Stack:** NestJS 11, Express, ESM, TypeScript 5 strict, Vitest + SWC

### Entry Points

| File | Purpose |
|------|---------|
| `src/main.ts` | Bootstrap: logger → security → prefix → filters → interceptors → pipes → swagger → listen |
| `src/app.module.ts` | Root module: imports all infrastructure modules, registers APP_GUARD, applies ETag middleware |

### app/ — Cross-Cutting Infrastructure

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `config/` | `env.schema.ts` | Zod env schema; prod superRefine validates secrets/URLs |
| `config/` | `cls.config.ts` | W3C traceparent parse, tracestate 1024-char cap, X-Request-Id sanitize |
| `config/` | `security.config.ts` | CORS config factory |
| `config/` | `swagger.config.ts` | Swagger + Scalar setup (non-prod only) |
| `config/` | `validation.config.ts` | Global ValidationPipe factory |
| `database/` | `db.module.ts` | `DrizzleModule.forRoot()` — Global Dynamic Module |
| `database/` | `db.provider.ts` | Pool factory (node-postgres), injects `DB_TOKEN` |
| `database/` | `drizzle.service.ts` | Holds `db` + `pool`; `onModuleDestroy` drains pool |
| `events/` | `domain-events.module.ts` | Global `DomainEventsModule` |
| `events/` | `domain-event-publisher.ts` | Clear-then-emit via EventEmitter2 (at-most-once) |
| `filters/` | `all-exceptions.filter.ts` | Ultimate catch-all fallback |
| `filters/` | `problem-details.filter.ts` | RFC 9457 shaping for HttpException |
| `filters/` | `throttler-exception.filter.ts` | 429 with problem body |
| `interceptors/` | `request-context.interceptor.ts` | Writes tracing headers to response |
| `interceptors/` | `correlation-id.interceptor.ts` | X-Request-Id propagation |
| `interceptors/` | `trace-context.interceptor.ts` | W3C traceparent propagation |
| `interceptors/` | `timeout.interceptor.ts` | 30 s global timeout |
| `interceptors/` | `location-header.interceptor.ts` | Adds `Location` on 201 Created |
| `interceptors/` | `link-header.interceptor.ts` | Adds `Link` for pagination |
| `interceptors/` | `transform.interceptor.ts` | Response envelope (`{ data, meta }`) |
| `logger/` | `logger.module.ts` | nestjs-pino LoggerModule setup |
| `logger/` | `redaction.config.ts` | Sensitive field redaction paths |
| `middleware/` | `etag.middleware.ts` | ETag on all routes |

### modules/ — Feature Modules

| Module | Key Files | Purpose |
|--------|-----------|---------|
| `cache/` | `cache.module.ts`, `cache.service.ts` | Provides `CACHE_PORT` adapter (cache-manager + @keyv/redis) |
| `health/` | `health.module.ts`, `health.controller.ts` | `/livez`, `/readyz`, `/health` endpoints |
| `health/` | `drizzle.health.ts` | Custom Terminus indicator — executes `SELECT 1` |
| `health/` | `redis.health.ts` | Custom Terminus indicator — SET/GET readback probe |

### shared-kernel/ — DDD Primitives

| Path | Purpose |
|------|---------|
| `application/ports/cache.port.ts` | `CachePort` interface + `CACHE_PORT` injection token |
| `domain/base-aggregate-root.ts` | Abstract class with private `#domainEvents[]` |
| `domain/events/domain-event.base.ts` | Base class: UUID `eventId`, `occurredOn` timestamp |
| `domain/events/integration-event.base.ts` | Base class for cross-service events |
| `infrastructure/decorators/` | `@Public`, `@UseEnvelope`, `@ApiProblemResponses`, typed validators |
| `infrastructure/dtos/` | `CursorPaginationDto`, `OffsetPaginationDto`, `ListResponseDto`, `ProblemDetailsDto` |
| `infrastructure/enums/error-code.ts` | `ErrorCode` enum for problem type URIs |

### __tests__/ — Test Infrastructure

| File | Purpose |
|------|---------|
| `helpers/create-app.ts` | Mirrors `main.ts` bootstrap with `moduleOverrides` support |
| `unit/global-modules.spec.ts` | Architecture guard: every `@Global()` must be in approved whitelist |

### Config Files (apps/api root)

| File | Purpose |
|------|---------|
| `vitest.config.mts` | SWC + vite-tsconfig-paths, v8 coverage, thresholds at 0 |
| `vitest.e2e.config.mts` | E2E vitest config |
| `.dependency-cruiser.mjs` | Architecture rules enforced via `pnpm deps` |
| `nest-cli.json` | NestJS CLI build config |
| `tsconfig.json` | `strict: true`, `noUncheckedIndexedAccess`, `emitDecoratorMetadata`, `nodenext` |

---

## packages/database

**Stack:** Drizzle ORM 0.44.7, pg 8.16.3 (peer), drizzle-kit 0.31.6, tsdown ESM build

| File/Dir | Purpose |
|----------|---------|
| `src/schemas/index.ts` | Re-exports all schemas (currently `export {}` placeholder) |
| `src/index.ts` | Package entrypoint — re-exports `src/schemas/index.ts` |
| `drizzle/` | Generated migration files (drizzle-kit output) |
| `sql/00-init-role-timeouts.sql` | Sets `lock_timeout` + `statement_timeout` for migration role |
| `drizzle.config.ts` | drizzle-kit config: schema `./src/schemas`, dialect postgresql, strict mode |

Pool creation is **not** in this package — done by `DrizzleService` in `apps/api`.
This package exports schema types only.

---

## CI Pipeline

Two GitHub Actions jobs on push to `main`/`init-infrastructure` and PR to `main`:

**`ci` job** (Node 22, pnpm 9):
`typecheck` → `lint` → `test` (api unit only) → `deps` (arch check) → `build`

**`migration-smoke` job** (postgres:16-alpine service):
`build database package` → `db:init-roles` → `db:migrate` × 2 (second asserts idempotency)

---

## Key Injection Tokens

| Token | Symbol | Provided By |
|-------|--------|-------------|
| `DB_TOKEN` | string constant | `DrizzleModule` → `db.provider.ts` |
| `CACHE_PORT` | Symbol | `CacheModule` → `CacheService` |

---

## Global Modules (Architecture Guard Whitelist)

These are the only modules permitted to be `@Global()` — enforced by `unit/global-modules.spec.ts`:

- `DrizzleModule`
- `DomainEventsModule`
- `ClsModule` (via `nestjs-cls`)
- `ConfigModule` (via `@nestjs/config`)
- `LoggerModule` (via `nestjs-pino`)
