# Codebase Summary

> For per-folder and per-layer layout, see [Project Structure](./infrastructure/project-structure.md).

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

## Package Roles

| Package | Path | Role |
|---------|------|------|
| `apps/api` | `apps/api/` | Composition root — `AppModule`, `main.ts`, business `modules/` (reserved) |
| `@boilerplate/shared-kernel` | `packages/shared-kernel/` | Transport-agnostic NestJS modules: config, DB, cache, domain events, logger, queue scaffold |
| `@boilerplate/nest-http` | `packages/nest-http/` | HTTP cross-cutting: filters, interceptors, middleware, health, bootstrap, DTOs |
| `@boilerplate/database` | `packages/database/` | Drizzle ORM schema types + migrations; no runtime pool code |

### Package Dependency DAG

```
apps/api → @boilerplate/nest-http → @boilerplate/shared-kernel → @boilerplate/database
future-worker → @boilerplate/shared-kernel
```

---

## Test Counts

| Location | Test files | Cases |
|----------|-----------|-------|
| `apps/api/src/__tests__/` | 10 | 51 (50 local; 1 CI-guarded) |
| `packages/shared-kernel/` | 9 unit + integration | 33+ |
| `packages/nest-http/` | 3 | 30 |

Integration tests backed by `@testcontainers/redis` live in `packages/shared-kernel` and run via the separate `vitest.config.integration.ts` config.

---

## Key Injection Tokens

| Token | Type | Defined In | Provided By |
|-------|------|-----------|-------------|
| `DB_TOKEN` | `Symbol` | `@boilerplate/shared-kernel` `database/db.port.ts` | `DrizzleModule.forRoot()` |
| `CACHE_PORT` | `Symbol` | `@boilerplate/shared-kernel` `cache/cache.port.ts` | `CacheModule` → `CacheService` |
| `KEYV_REDIS_TOKEN` | `Symbol` | `@boilerplate/shared-kernel` `cache/cache.module.ts` | `CacheModule` → shared `KeyvRedis` instance |

All symbols defined in exactly one file and imported only from `@boilerplate/shared-kernel`.

---

## Global Modules (Architecture Guard Whitelist)

These are the only modules permitted to be `@Global()` — enforced by `packages/shared-kernel/src/__tests__/unit/global-modules.spec.ts`:

- `DrizzleModule` (from `@boilerplate/shared-kernel`)
- `DomainEventsModule` (from `@boilerplate/shared-kernel`)
- `ClsModule` (via `nestjs-cls`)
- `ConfigModule` (via `@nestjs/config`)
- `LoggerModule` (from `@boilerplate/shared-kernel`, via `nestjs-pino`)
- `QueueModule` (from `@boilerplate/shared-kernel`)

---

## Related Documents

| Topic | Document |
|-------|----------|
| Per-folder/layer layout | [Project Structure](./infrastructure/project-structure.md) |
| Database module | [Database](./infrastructure/database.md) |
| Cache module | [Cache](./infrastructure/cache.md) |
| Queue module | [Queue](./infrastructure/queue.md) |
| Logger module | [Logger](./infrastructure/logger.md) |
| Environment variables | [Environment](./infrastructure/environment.md) |
| Full architecture diagrams | [System Architecture](./system-architecture.md) |
