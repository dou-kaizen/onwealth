# Project Changelog

_Significant changes only. Patch-level fixes are in git history._

---

## 2026-05-15 — Foundation Hardening continuation (`init-infrastructure`)

Commits: `c91c8d5`, `d1dda08`, `d848254`, `323c1a3`, `91c1d9b`

### feat(throttler) — cluster-safe Redis-backed storage (`91c1d9b`)

- Added `@nest-lab/throttler-storage-redis` + `ioredis` as runtime deps (`packages/platform/package.json`)
- `redis-throttler-storage.factory.ts`: awaits `ready` event or rejects on `error` / 5 s connect timeout — NestJS init aborts before traffic if Redis unreachable (fail-fast)
- `ThrottlerModule` wired with Redis storage; `enableOfflineQueue` left at default `true` — transient blips buffer up to `maxRetriesPerRequest: 3` rather than 500-storming the API
- `OnModuleDestroy` races `client.quit()` against 4 s timeout so dead Redis cannot block graceful shutdown past K8s budget
- Two-client DI caveat accepted (storage client separate from any future feature Redis client); revisit if DI consolidation becomes worthwhile
- `WORKERS > 1` in-memory-not-cluster-safe warning removed (superseded by Redis storage)
- Files: `packages/platform/src/throttler/redis-throttler-storage.factory.ts`, `throttler.module.ts`, `index.ts`

### ci — supply chain hardening + coverage gate (`d848254`)

- Split audit: `pnpm audit --audit-level=high --prod` + `pnpm audit --audit-level=critical --dev` — separate jobs, both block merge
- `@infra-x/code-quality` pinned to exact version in `pnpm.overrides` (dependency-confusion defense)
- `.npmrc`: `scarf-js=false` added
- CI env: `SCARF_ANALYTICS=false`, `DO_NOT_TRACK=1`
- Turborepo `test:coverage` task added; `pnpm test:coverage` workspace script runs `vitest --coverage`
- Coverage artifact uploaded via `actions/upload-artifact@v4` — no numeric threshold gate yet
- GitHub Actions remain on `@v4` tags (SHA pinning deferred)
- File: `.github/workflows/ci.yml`

### refactor(platform) — drop dead branches and noop taps (`323c1a3`)

- Pruned dead code branches and noop interceptor/filter taps from `packages/platform/src`
- No behavior change; reduces LOC noise

### chore — ignore test artifacts in nested workspaces (`d1dda08`)

- `.gitignore` updated: `coverage/` dirs in nested workspace packages now ignored
- Prevents accidental commit of vitest coverage output from sub-packages

### docs(journal) — record foundation hardening ship (`c91c8d5`)

- Journal entry added documenting the foundation hardening delivery

---

## 2026-05-04 — Foundation Hardening (`init-infrastructure`)

Six-phase hardening pass on top of the initial infrastructure scaffold.

### Phase 01 — Lifecycle (DatabaseModule shutdown)

- `DatabaseModule` now implements `OnModuleDestroy`; `pool.end()` wrapped in `Promise.race()` with 8 s timeout to prevent SIGTERM hangs past K8s `terminationGracePeriodSeconds`
- `app.enableShutdownHooks()` added to `main.ts` bootstrap before `app.listen()`
- New `POOL_TOKEN` (Symbol) exported from `@onwealth/platform/database` alongside `DRIZZLE_TOKEN` for direct pool injection
- New `DrizzleInstance` interface (`{ db, pool }`) returned by `createDrizzleInstance()`; pool error handler wired immediately to prevent uncaught-event process kill on idle-client disconnect
- Files: `packages/platform/src/database/database.module.ts`, `drizzle.factory.ts`, `database.tokens.ts`, `index.ts`; `apps/api/src/main.ts`

### Phase 02 — Security Defaults (env schema)

- `JWT_SECRET`, `DATABASE_URL`, `API_BASE_URL` no longer have schema defaults — required at boot
- Zod v4 `.check()` guard rejects literal placeholder values for these three vars when `NODE_ENV=production` (boot-time footgun protection)
- `ValidationPipe.enableImplicitConversion: false` (prevents type-smuggling via implicit class-transformer coercion; explicit `@Type()` required)
- Swagger `persistAuthorization: false` (no token persistence in browser localStorage)
- 10kb global JSON / urlencoded body limit; financial-webhook routes must opt into `rawBody`
- `apps/api/.env.example` created documenting all required and optional vars
- Files: `packages/platform/src/config/env.schema.ts`, `packages/platform/src/pipes/validation.pipe.ts`, `apps/api/src/config/swagger.config.ts`, `apps/api/src/main.ts`, `apps/api/.env.example`

### Phase 03 — Operational Hardening

- `HealthController` carries `@SkipThrottle()` — K8s liveness probes no longer consume throttle quota and trigger 429 → restart cascades
- `THROTTLE_LIMIT` default raised to 300 (was 100)
- Strict CSP global default via `helmet()`; loose CSP path-mounted on `/swagger` and `/docs` only when `swaggerEnabled`. `/swagger-json` correctly stays under strict CSP (Express path match: `/swagger` does not match `/swagger-json`)
- `trust proxy = 1` (single LB hop); comment documents multi-hop CDN→LB→API bump to 2
- `WORKERS > 1` warning logged — in-memory throttler is not cluster-safe
- Empty `ALLOWED_ORIGINS` warning logged in non-test environments
- Files: `apps/api/src/health/health.controller.ts`, `apps/api/src/main.ts`

### Phase 04 — Error Contract

- New `CONSTRAINT_VIOLATION` error code in `ErrorCode` const object
- `postgres-error-mapper.ts`: SQLSTATE `23503` → `RESOURCE_NOT_FOUND` + 422 (FK violation; referenced row missing, not a conflict); `23514` → `CONSTRAINT_VIOLATION` + 422 (check constraint)
- Intentional `RESOURCE_NOT_FOUND` + HTTP 422 pairing: clients must branch on `status` first, `code` second
- `ProblemDetailsFilter.extractValidationErrors`: now recurses into `item.children` with `parentPath` threading (produces `/address/city` not `/city`), depth cap 5, shared accumulator capped at 100 errors total; constraint codes still resolve via `contexts[name].code`
- Files: `packages/platform/src/error-codes/error-code.ts`, `packages/platform/src/filters/postgres-error-mapper.ts`, `packages/platform/src/filters/problem-details.filter.ts`

### Phase 05 — Trace & Observability

- Trace IDs now CSPRNG (`crypto.randomBytes(16).toString('hex')`) — `Math.random()` was non-uniform and forgeable
- `parseTraceparent()` rejects W3C reserved `version=ff`, all-zero traceId/parentId; normalises hex to lowercase per spec
- Inbound `traceparent.traceId` is **never** trusted — fresh local CSPRNG traceId minted for every request; inbound `parentId`/`traceFlags` preserved for downstream propagation
- `x-request-id` / `x-correlation-id` capped at 128 chars; replaced with `randomUUID()` if missing, array (header-smuggling), empty, or oversized
- `tracestate` capped at 512 chars + CR/LF stripped (prevents response-splitting / header-smuggling when outbound HTTP propagation is wired)
- nestjs-pino: switched from `customProps` (Express scope, outside CLS) to `mixin` (per-log, inside CLS async hook) using `ClsServiceManager.getClsService()`. `requestId`/`correlationId`/`traceId` now stamped on every log line including jobs and shutdown
- Files: `packages/platform/src/cls/trace-context.util.ts`, `packages/platform/src/cls/cls.config.ts`, `packages/platform/src/logger/pino.config.ts`

### Phase 06 — Tooling Correctness

- `DomainEvent.eventName` is now `abstract readonly` — subclasses must declare an explicit literal (e.g. `'article.published'`); `this.constructor.name` is unsafe under SWC/Terser class-name mangling
- `IntegrationEvent` re-declares `abstract override readonly eventName` to satisfy `noImplicitOverride`
- `.dependency-cruiser.cjs` `core-no-runtime-libs` banlist extended: `zod | class-validator | class-transformer` added — core stays validation/serialization-agnostic
- Files: `packages/core/src/base/domain-event.ts`, `packages/core/src/base/integration-event.ts`, `.dependency-cruiser.cjs`

---

## 2026-05-03 — Infrastructure Foundation (`init-infrastructure`)

Initial scaffold: monorepo, NestJS app, platform modules, health endpoint, Swagger/OpenAPI setup, dependency-cruiser rules, oxlint/oxfmt toolchain.
