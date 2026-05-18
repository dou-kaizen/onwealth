# Code Standards

Conventions and rationale for non-obvious decisions in the onwealth codebase.

## TypeScript Compiler Settings

### `strictPropertyInitialization: false` (apps/api)

`apps/api/tsconfig.json` disables `strictPropertyInitialization` while keeping `strict: true` for everything else.

**Why:** NestJS dependency injection assigns class fields **after** the constructor runs (via the DI container's instantiation pipeline + decorators like `@Inject`). With `strictPropertyInitialization` enabled, every injected field needs either:
- a redundant `!` non-null assertion (`private readonly foo!: Foo`), or
- an inline `// biome-ignore` / explicit initializer that the DI container then overwrites.

Both options add noise without catching a real class of bug — Nest guarantees the field is populated before any provider method runs. The `strict` family's other checks (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `noImplicitThis`, etc.) remain active and provide the actual safety net.

**Trade-off:** in this single codebase, classes that are *not* DI-managed must still ensure their fields are initialized before first read — there's no compiler warning if you forget. Keep DI-managed providers separate from plain value objects, and prefer constructor-assigned `readonly` fields for the latter.

### Other strictness flags (apps/api)

Both packages keep:
- `strict: true`
- `noUncheckedIndexedAccess` (in api) — array/record access returns `T | undefined`
- `exactOptionalPropertyTypes` — distinguishes "missing" from "explicit undefined"

## File Naming

- kebab-case for `.ts`/`.js`/`.py`/`.sh`
- Long, descriptive names — file names should be self-documenting when found via Grep/Glob (e.g. `redis.health.ts`, `problem-details.filter.ts`, not `health.ts`/`filter.ts`)
- Test files mirror their target: `foo.spec.ts` next to `foo.ts`
- E2E tests live under `apps/api/src/__tests__/` and use the `.e2e-spec.ts` suffix

## Comments

- Explain **why**, not what.
- Reference stable external IDs (RFC numbers, PostgreSQL `SQLSTATE`, CVE IDs) — never plan artifacts (phase numbers, finding codes, audit labels).
- Migration filenames carry domain slugs only — no `phase_*` prefixes.

## Modules & File Size

- Keep files ≤ 200 lines where practical.
- Split by logical concern (one responsibility per module).
- Domain code under `apps/api/src/modules/<domain>/<layer>/` — `application`, `domain`, `infrastructure`, `presentation`.

## Validation

- DTOs at module boundaries use class-validator decorators.
- `validation.config.ts` produces the global pipe with `disableErrorMessages: false`, `whitelist: true`, `forbidNonWhitelisted: true`, `enableImplicitConversion: false` — implicit string-to-number coercion is **off** to prevent silently widening Zod-style numeric checks.

## Error Responses

- All `HttpException` instances funnel through `ProblemDetailsFilter` → RFC 9457 `application/problem+json`.
- `type` is a URI under `${API_BASE_URL}/errors/<slug>` for mapped statuses; unmapped statuses fall back to `about:blank` (RFC 9457 §4.1).
- Validation errors are flattened (nested DTOs produce dotted `address.street.zip` paths) and emitted in the `errors[]` array.

## Logging

- `pino` via `nestjs-pino`. Production runs with the default formatter; dev uses `pino-pretty`.
- Sensitive paths configured in `redaction.config.ts` (passwords, tokens, auth headers).
- High-frequency probe routes (`health`, `health/live`, `health/ready`, `livez`, `readyz`) are excluded from access logs — see `EXCLUDED_PATHS` in `logger.config.ts`.

## Database

- Drizzle ORM with `node-postgres` Pool. `postgres-js` is NOT a dependency — pick one driver, stick with it.
- `DrizzleService` owns the pool lifecycle (`OnModuleDestroy` drains on SIGTERM).
- Migration role has explicit `lock_timeout` set in `packages/database/sql/00-init-role-timeouts.sql`.

## Health Probes

- `/livez` — process responsiveness only (no I/O dependencies).
- `/readyz` — DB + Redis with a 3 s `Promise.race` deadline; degraded state returns 503.
- `/health` — detailed multi-component breakdown (verbose, not for orchestrator probes).

---

## Workspace Package Conventions

Applies to `packages/shared-kernel` and `packages/nest-http`.

### ESM Import Extensions

All relative imports and barrel imports inside workspace packages **must** include the `.js` extension (TypeScript `nodenext` + `verbatimModuleSyntax`):

```ts
// correct
import { DB_TOKEN } from './database/db.port.js'
export { DrizzleModule } from './database/db.module.js'

// type-only imports use `import type`
import type { DrizzleDb } from './database/db.port.js'
```

### Peer Dependencies — Never Bundle

All NestJS and infra deps (`@nestjs/*`, `drizzle-orm`, `nestjs-pino`, `nestjs-cls`, etc.) are declared as `peerDependencies`, not `dependencies`. Each package's `tsdown.config.ts` lists them all in `deps.neverBundle`. Bundling a NestJS package creates dual-module singletons and breaks DI token identity at runtime.

### DI Token Identity

`DB_TOKEN` and `CACHE_PORT` are defined in exactly one file each inside `@onwealth/shared-kernel`. Every consumer (including `@onwealth/nest-http` and `apps/api`) imports the tokens **only** from `@onwealth/shared-kernel` — never redeclaring them locally.

### tsconfig — Auto-Generated, Never Hand-Edit

Per-package `tsconfig.json` files are generated by `@infra-x/tsconfig`. Do not edit them manually; changes will be overwritten on the next generate run.

### Build Output

Packages build via `tsdown` to:
- `dist/index.mjs` — ESM bundle
- `dist/index.d.mts` — TypeScript declarations

### Turbo Typecheck Dependency

`turbo.json` sets `typecheck.dependsOn: ["^build"]`. This ensures `apps/api` type-checks against each package's built `dist/*.d.mts`, not raw source. Run `pnpm build` once before `pnpm typecheck` in a clean workspace.
