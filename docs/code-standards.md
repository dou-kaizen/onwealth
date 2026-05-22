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

## Testing Conventions

### CI-Guarded Integration Tests

Use `describe.skipIf(!process.env.VAR)` for integration tests that require a real backing service (DB, Redis). The test exists in the suite, runs in CI where the env var is present via service containers, and skips cleanly in offline local runs — no fake passes, no mocks.

```ts
// Example: apps/api/src/__tests__/integration/with-timeout.spec.ts
describe.skipIf(!process.env.DATABASE_URL)('withTimeout integration', () => {
  // real DB transaction tests
})
```

This is the canonical pattern for any spec that requires a live `DATABASE_URL` or `REDIS_URL`.

---

## File Naming

- kebab-case for `.ts`/`.js`/`.py`/`.sh`
- Long, descriptive names — file names should be self-documenting when found via Grep/Glob (e.g. `redis.health.ts`, `problem-details.filter.ts`, not `health.ts`/`filter.ts`)
- Test files mirror their target: `foo.spec.ts` next to `foo.ts`
- E2E tests live under `apps/api/src/__tests__/` and use the `.e2e-spec.ts` suffix

## Comments

- Explain **why**, not what.
- Reference stable external IDs (RFC numbers, PostgreSQL `SQLSTATE`, CVE IDs) — never plan artifacts (phase numbers, finding codes, audit labels).
- Migration filenames carry domain slugs only — no `phase_*` prefixes.

## Commit Messages

Use Conventional Commits format (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`).
Enforced locally by the lefthook `commit-msg` hook; CI is the hard gate.

## Modules & File Size

- Keep files ≤ 200 lines where practical.
- Split by logical concern (one responsibility per module).

## DDD Module Pattern

Business features live under `apps/api/src/modules/<domain>/`, each split into four
layers. Add only the layer folders a module actually needs — not every module uses
every folder.

```
modules/<domain>/
├── <domain>.module.ts          # wires the module: providers, controllers, port bindings
├── domain/                     # pure business — zero framework / IO imports
│   ├── aggregates/             # aggregate roots (extend BaseAggregateRoot)
│   ├── entities/               # entities owned by an aggregate
│   ├── value-objects/          # immutable VOs (Money, Slug, …)
│   ├── enums/                  # domain enums / state types
│   └── events/                 # domain events (extend DomainEvent)
├── application/                # use-case orchestration
│   ├── ports/                  # interfaces + Symbol DI tokens (the module owns these)
│   ├── services/               # application services (use cases)
│   └── listeners/              # @OnEvent domain-event listeners
├── infrastructure/             # adapters — the only layer that touches IO
│   ├── repositories/           # port implementations (Drizzle, via DB_TOKEN)
│   ├── adapters/               # other port implementations (external APIs, …)
│   └── strategies/             # passport strategies, etc.
└── presentation/               # HTTP edge
    ├── controllers/            # route handlers — thin, delegate to services
    ├── dtos/                   # request/response DTOs (class-validator)
    └── guards/                 # module-scoped guards
```

### Dependency Rule

Imports point inward only:

```
presentation ─► application ─► domain
infrastructure ─► application (implements ports) ─► domain
```

`domain/` imports nothing outside itself, except domain primitives from
`@onwealth/shared-kernel` (`BaseAggregateRoot`, `DomainEvent`). Infrastructure
depends on application, never the reverse — that inversion is the whole point of
the `ports/` folder.

### Ports & Tokens (Dependency Inversion)

The application layer **defines** a port; the infrastructure layer **implements** it.
A port file exports an interface plus a `Symbol` token:

```ts
// application/ports/article.repository.port.ts
export interface ArticleRepository {
  findById(id: string): Promise<Article | null>
  save(article: Article): Promise<void>
}
export const ARTICLE_REPOSITORY = Symbol('ARTICLE_REPOSITORY')
```

```ts
// article.module.ts
providers: [
  ArticleService,
  { provide: ARTICLE_REPOSITORY, useClass: ArticleRepositoryImpl },
]
```

Consumers inject by token: `@Inject(ARTICLE_REPOSITORY) private readonly repo: ArticleRepository`.

### Two Complexity Tiers

Not every module needs a full domain layer. Match the structure to the problem:

| Tier | When | Layers used |
|------|------|-------------|
| Simple CRUD | Pass-through resource, no invariants | `application` (service + port), `infrastructure`, `presentation` — skip `domain/` |
| Rich domain | Business invariants, state machine, events | All four — aggregate enforces rules, emits domain events |

A simple-CRUD service may stay a thin pass-through for consistency; non-trivial
logic (e.g. `NotFoundException` mapping) belongs in the service, never the
controller or repository.

### Naming

| Artifact | File | Symbol |
|----------|------|--------|
| Module | `<domain>.module.ts` | `<Domain>Module` |
| Port | `<name>.repository.port.ts` | `interface <Name>Repository` + `<NAME>_REPOSITORY` token |
| Repository impl | `infrastructure/repositories/<name>.repository.ts` | `<Name>RepositoryImpl` |
| Service | `application/services/<name>.service.ts` | `<Name>Service` |
| Aggregate | `domain/aggregates/<name>.aggregate.ts` | `<Name>` |
| Value object | `domain/value-objects/<name>.vo.ts` | `<Name>` |
| Domain event | `domain/events/<name>.event.ts` | `<Name>Event` |

Register each module in `AppModule.imports`. A domain's DB schema goes in
`packages/database/src/schemas/<domain>.schema.ts` with a matching migration.
Domain-specific `ErrorCode` values are added to `@onwealth/shared-kernel` alongside
the module that uses them — not pre-declared.

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
- Access log suppression is controlled by `autoLoggingUrlPrefix` (passed to `createLoggerConfig`). Requests whose URL does not start with the prefix are suppressed — defaults to `'/api/'`. Health probe paths are excluded by passing them as `excludePaths` to the logger options.

## Database

- Drizzle ORM with `node-postgres` Pool. `postgres-js` is NOT a dependency — pick one driver, stick with it.
- `DrizzleService` owns the pool lifecycle (`OnModuleDestroy` drains on SIGTERM).
- Migration role has explicit `lock_timeout` set in `packages/database/sql/00-init-role-timeouts.sql`.
- `withTimeout(db, ms, fn)` in `@onwealth/shared-kernel` wraps a Drizzle transaction with a per-transaction `statement_timeout` via `SELECT set_config('statement_timeout', $1, true)` (PgBouncer-safe bound parameter; `ms` must be `> 0`). Use only for slow analytics queries — OLTP queries rely on the role-level default.
- DB constraint errors map to `ErrorCode` values in `AllExceptionsFilter`: SQLSTATE `23505` (unique violation) → `RESOURCE_CONFLICT`; `23503` (FK), `23502` (not-null), `23514` (check) → `CONSTRAINT_VIOLATION`.

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
