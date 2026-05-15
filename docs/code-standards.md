# Code Standards

_Last updated: 2026-05-15 | Branch: init-infrastructure (Foundation Hardening)_

## General Principles

- YAGNI / KISS / DRY — no speculative abstractions
- Files under 200 LOC; split by concern when approaching limit
- Kebab-case filenames: `pino.config.ts`, `drizzle.factory.ts`, `trace-context.util.ts`
- Comments explain *why*, not *what*

## TypeScript

- `strict: true` + `noUncheckedIndexedAccess: true` + `noImplicitOverride: true`
- `isolatedModules: true` — no const enum, no namespace merging
- `useDefineForClassFields: false` — required for NestJS decorators
- `target: ES2023`, `lib: ["ES2023"]`
- `skipLibCheck: true` — type errors in dependencies are ignored
- Prefer `interface` over `type` for object shapes; `type` for unions/aliases
- No `any` — use `unknown` with narrowing

### Module Systems

| Location | `module` | `moduleResolution` | Emit |
|---|---|---|---|
| `packages/*` | `CommonJS` | `Node` | `tsc -b` |
| `apps/api` typecheck | `ESNext` | `Bundler` | noEmit |
| `apps/api` runtime | CommonJS | — | SWC via `.swcrc` |

### Imports

- Use subpath exports for `@onwealth/platform`: `@onwealth/platform/filters`, not `../../packages/platform/src/...`
- `reflect-metadata` imported once at `apps/api/src/main.ts` top
- Type-only imports: `import type { Foo } from '...'`
- Group order: Node built-ins → external libs → workspace packages → local

## NestJS Conventions

### Module structure

```
feature/
├── feature.module.ts
├── feature.controller.ts
├── feature.controller.spec.ts
├── feature.service.ts
└── dto/
    ├── create-feature.dto.ts
    └── update-feature.dto.ts
```

### Foundation modules (already wired in `ApiModule`)

Do not re-import in feature modules: `ConfigModule`, `ClsModule`, `LoggerModule`, `DatabaseModule`, `ThrottlerModule`, `FiltersModule`, `InterceptorsModule`. They are global or exported globally.

### DTOs

- `class-validator` decorators for validation
- `class-transformer` `@Transform` / `@Type` for coercion
- Use `@ApiProperty` on all DTOs that appear in the OpenAPI spec (registered via `extraModels` or decorated handlers)
- Platform DTOs (`ProblemDetailsDto`, `FieldError`) are classes (not interfaces) so `@nestjs/swagger` can emit schema metadata at runtime
- Validation errors produce 422 (not 400) via `createValidationPipe()`

### Error handling

- Throw `HttpException` subclasses (`NotFoundException`, `BadRequestException`, etc.) from services/controllers
- Include `{ code: 'UPPER_SNAKE_CASE', message: '...' }` as response body for machine-readable codes
- `ProblemDetailsFilter` extracts `code` automatically from the response body
- Never throw raw `Error` from controllers — `AllExceptionsFilter` handles it but loses HTTP semantics

### Response envelope

- Use `@UseEnvelope()` on handlers that return a single resource and need tracing meta
- Collection handlers: return `{ object: 'list', data: T[] }` — `TransformInterceptor` passes through unchanged
- Do not use `@UseEnvelope()` on collection handlers

### Rate limiting

- `ThrottlerGuard` is bound globally; all routes are rate-limited by default
- Use `@SkipThrottle()` to opt out — **mandatory on `HealthController`** to prevent K8s liveness probes from consuming throttle quota and triggering pod restart cascades (`apps/api/src/health/health.controller.ts:18`)
- Default `THROTTLE_LIMIT` is 300 requests/window (raised from 100 in Foundation Hardening)

## Environment Variables

Defined and validated in `packages/platform/src/config/env.schema.ts` via Zod. See `apps/api/.env.example` for the full list with comments.

**Required at boot (no schema default):** `DATABASE_URL`, `JWT_SECRET`, `API_BASE_URL`. Supply via `.env.example` for local dev; production must override.

**Production placeholder guard:** Zod v4 `.check()` rejects literal placeholder values for `JWT_SECRET`, `DATABASE_URL`, and `API_BASE_URL` when `NODE_ENV=production` — boot fails loudly rather than silently serving with default credentials (`env.schema.ts:158–171`).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development \| production \| test` |
| `PORT` | `3000` | 1–65535 |
| `DATABASE_URL` | **required** | PostgreSQL connection string; no schema default |
| `DB_POOL_MAX` | `20` | 1–100 |
| `DB_POOL_MIN` | `5` | 0–50 |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | ms, min 1000 |
| `DB_POOL_CONNECTION_TIMEOUT` | `10000` | ms, min 1000 |
| `JWT_SECRET` | **required** | min 32 chars; no schema default |
| `JWT_EXPIRES_IN` | `15m` | format: `\d+[smhd]` (schema only — auth phase pending) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | format: `\d+[smhd]` (schema only — auth phase pending) |
| `ALLOWED_ORIGINS` | — | comma-separated; empty → CORS disabled + WARN logged in non-test |
| `REDIS_URL` | `redis://localhost:6379` | `redis://` or `rediss://`; **required at boot** — throttler storage factory fails fast if Redis unreachable |
| `REDIS_TTL` | `3600` | seconds; throttler-scoped TTL (cache feature pending) |
| `API_BASE_URL` | **required** | problem+json `type` URIs + OpenAPI server URL; no schema default |
| `THROTTLE_TTL` | `60000` | ms window |
| `THROTTLE_LIMIT` | `300` | requests per window |
| `REQUEST_TIMEOUT_MS` | `30000` | ms, min 1000 |
| `ENABLE_SWAGGER` | _(unset)_ | Strict enum: `'true'` or `'false'` only. Unset → `NODE_ENV !== 'production'`. Controls `/docs`, `/swagger`, `/swagger-json`, `/openapi.yaml` routes and helmet CSP mode. |

Add new feature-tier env keys in the feature module's own Zod schema extension — do not add to `env.schema.ts` in `@onwealth/platform`.

## DB Error Mapping Rules

When throwing from services that touch the database, use the correct `ErrorCode`:

| Scenario | Code | HTTP |
|---|---|---|
| FK violation (referenced row missing) | `RESOURCE_NOT_FOUND` | 422 |
| Check constraint failure | `CONSTRAINT_VIOLATION` | 422 |
| Unique constraint failure | `RESOURCE_CONFLICT` | 409 |
| Not-null violation | `REQUIRED_FIELD` | 422 |

**`RESOURCE_NOT_FOUND` + HTTP 422 pairing is intentional.** Client SDKs must branch on `status` first, `code` second. Do not assume `RESOURCE_NOT_FOUND` implies 404. If a feature module needs an unambiguous FK-missing symbol, introduce a domain-specific code (e.g. `REFERENCE_NOT_FOUND`).

## Trust Proxy

`app.getHttpAdapter().getInstance().set('trust proxy', 1)` — configured for a single LB hop (public → LB → API). If topology is CDN → LB → API, bump to `2`. Never use `true` (trusts all forwarded IPs — enables throttler bypass via `X-Forwarded-For` spoofing).

Throttler storage is Redis-backed (`@nest-lab/throttler-storage-redis`). `REDIS_URL` is required at boot — the storage factory rejects if Redis is unreachable, aborting NestJS init before any traffic is served. Rate-limit counters are cluster-safe across replicas.

## Logging

- Use `PinoLogger` (from `nestjs-pino`) injected via `@InjectPinoLogger(ContextName)` or constructor injection
- Call `this.logger.setContext(ClassName.name)` in constructor
- Log levels: `error` for 5xx, `warn` for 4xx, `debug` for dev-only traces
- Never log raw request bodies or auth tokens — `redaction.config.ts` covers known paths
- `requestId`, `traceId`, and `correlationId` appear on every log line automatically via `mixin` (runs inside CLS scope, not `customProps` which runs in Express middleware scope outside CLS)

## DomainEvent Subclasses

Every `DomainEvent` or `IntegrationEvent` subclass **must** declare `eventName` as an explicit string literal (`packages/core/src/base/domain-event.ts:40`):

```ts
// CORRECT
export class AccountCreatedEvent extends DomainEvent {
  override readonly eventName = 'account.created'
}

// WRONG — unsafe under SWC/Terser class-name mangling
export class AccountCreatedEvent extends DomainEvent {
  override readonly eventName = this.constructor.name  // may become 'e' after minification
}
```

`IntegrationEvent` re-declares `abstract override readonly eventName` so the `noImplicitOverride` compiler flag forces concrete subclasses to declare it explicitly — it is not inherited from `DomainEvent` transitively.

## Architectural Lint

Run `pnpm depcruise:check` before pushing. It is also part of `pnpm lint`.

Adding new packages: update `.dependency-cruiser.cjs` rules if the package has layer restrictions.

`core-no-runtime-libs` banlist includes: `ioredis | pino | bcrypt | drizzle-orm | pg | zod | class-validator | class-transformer`. Core must stay validation/serialization-agnostic.

## Testing

- Framework: Vitest
- Unit tests colocated: `*.spec.ts` next to the file under test
- `@nestjs/testing` `Test.createTestingModule()` for controller/service tests
- Mock `ClsService`, `ConfigService`, `PinoLogger` in unit tests — do not spin up full NestJS app
- Coverage: `@vitest/coverage-v8`
- Run: `pnpm test` (Turborepo pipeline, depends on `^build`)
- Coverage run: `pnpm test:coverage` (runs `vitest --coverage` via Turborepo `test:coverage` task; artifact uploaded in CI — no numeric threshold gate yet)
- Nested workspace `coverage/` dirs are gitignored (`.gitignore` fix landed `d1dda08`)

## Linting & Formatting

| Command | What it does |
|---|---|
| `pnpm lint` | oxlint + depcruise:check across all packages |
| `pnpm lint:fix` | oxlint auto-fix |
| `pnpm format` | oxfmt write |
| `pnpm format:check` | oxfmt check (CI) |
| `pnpm typecheck` | tsc project references across all packages |

Config: single root `oxlint.config.ts` (extends `@infra-x/code-quality` presets) — per-package overrides expressed via `overrides[].files` globs. Per-package `lint` script is `oxlint .`; root config is discovered via upward walk so IDE (oxc-vscode) and CLI stay in lockstep. Format scripts are scoped to `src/` (`oxfmt --check src` / `--write src`) to avoid scanning compiled `dist/` output.

## Auth transport

All access and refresh tokens MUST be sent as `Authorization: Bearer <jwt>`
headers. Cookie-based session/refresh is FORBIDDEN until a CSRF guard ships
(see `apps/api/src/main.ts` CORS block). Rationale: CORS allowlist with
cookie auth + no CSRF protection allows any XSS-compromised allowed origin
to forge state-changing requests against an authenticated session.

Re-enabling `credentials: true` requires landing in the same PR:
- CSRF token middleware (e.g. `csurf`) OR double-submit cookie scheme
- `SameSite=Strict` on session/refresh cookies
- Updated CORS preflight test coverage

Enforcement: comment-and-doc only today. Mechanical lint/depcruise rule
banning cookie APIs is deferred until the auth module lands (tracked in
the foundation-hardening plan's red-team F14 row).

## Supply chain

- All catalog deps use caret ranges resolved by `pnpm-lock.yaml`. CI uses
  `--frozen-lockfile`.
- Public-scope private packages MUST be pinned to exact versions + listed
  in `pnpm.overrides` to defend against dependency confusion via npm
  scope hijacking. Current: `@infra-x/code-quality` (exact-version pinned, `d848254`).
- CI runs two separate audit jobs: `pnpm audit --audit-level=high --prod` (production deps)
  and `pnpm audit --audit-level=critical --dev` (dev deps). Failures block merge.
- Postinstall scripts: only the allowlist in `pnpm.onlyBuiltDependencies`
  may run install-time scripts. Adding an entry requires PR review.
- Telemetry: Scarf disabled via `SCARF_ANALYTICS=false` + `DO_NOT_TRACK=1` env + `.npmrc`
  `scarf-js = false`. Turbo telemetry disabled in CI workflow env.
- GitHub Actions pinned to `@v4` tags (not SHAs). SHA pinning is deferred hardening — track
  in future supply-chain pass.

## Git & Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:` (not `docs:` for `.claude/` changes)
- No AI references in commit messages
- Do not commit `.env` files or secrets
- Run `pnpm lint` before committing; run `pnpm test` before pushing
