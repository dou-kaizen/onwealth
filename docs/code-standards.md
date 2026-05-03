# Code Standards

_Last updated: 2026-05-03 | Branch: init-infrastructure_

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
- Use `@ApiProperty` only when Swagger is added
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
- Use `@SkipThrottle()` to opt out (e.g. health check, internal routes)

## Environment Variables

Defined and validated in `packages/platform/src/config/env.schema.ts` via Zod.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development \| production \| test` |
| `PORT` | `3000` | 1–65535 |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/onwealth` | PostgreSQL connection string |
| `DB_POOL_MAX` | `20` | 1–100 |
| `DB_POOL_MIN` | `5` | 0–50 |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | ms, min 1000 |
| `DB_POOL_CONNECTION_TIMEOUT` | `10000` | ms, min 1000 |
| `JWT_SECRET` | — | min 32 chars; change in production (schema only — auth phase pending) |
| `JWT_EXPIRES_IN` | `15m` | format: `\d+[smhd]` (schema only — auth phase pending) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | format: `\d+[smhd]` (schema only — auth phase pending) |
| `ALLOWED_ORIGINS` | — | comma-separated; empty → CORS disabled |
| `REDIS_URL` | `redis://localhost:6379` | `redis://` or `rediss://` (schema only — cache phase pending) |
| `REDIS_TTL` | `3600` | seconds (schema only — cache phase pending) |
| `API_BASE_URL` | `https://api.example.com` | used in problem+json `type` URIs |
| `THROTTLE_TTL` | `60000` | ms window |
| `THROTTLE_LIMIT` | `100000` | requests per window |

Add new feature-tier env keys in the feature module's own Zod schema extension — do not add to `env.schema.ts` in `@onwealth/platform`.

## Logging

- Use `PinoLogger` (from `nestjs-pino`) injected via `@InjectPinoLogger(ContextName)` or constructor injection
- Call `this.logger.setContext(ClassName.name)` in constructor
- Log levels: `error` for 5xx, `warn` for 4xx, `debug` for dev-only traces
- Never log raw request bodies or auth tokens — `redaction.config.ts` covers known paths
- `traceId` and `correlationId` appear on every log line automatically via `customProps`

## Architectural Lint

Run `pnpm depcruise:check` before pushing. It is also part of `pnpm lint`.

Adding new packages: update `.dependency-cruiser.cjs` rules if the package has layer restrictions.

## Testing

- Framework: Vitest
- Unit tests colocated: `*.spec.ts` next to the file under test
- `@nestjs/testing` `Test.createTestingModule()` for controller/service tests
- Mock `ClsService`, `ConfigService`, `PinoLogger` in unit tests — do not spin up full NestJS app
- Coverage: `@vitest/coverage-v8`
- Run: `pnpm test` (Turborepo pipeline, depends on `^build`)

## Linting & Formatting

| Command | What it does |
|---|---|
| `pnpm lint` | oxlint + depcruise:check across all packages |
| `pnpm lint:fix` | oxlint auto-fix |
| `pnpm format` | oxfmt write |
| `pnpm format:check` | oxfmt check (CI) |
| `pnpm typecheck` | tsc project references across all packages |

Config: single root `oxlint.config.ts` (extends `@infra-x/code-quality` presets) — per-package overrides expressed via `overrides[].files` globs. Per-package `lint` script is `oxlint .`; root config is discovered via upward walk so IDE (oxc-vscode) and CLI stay in lockstep. Format scripts are scoped to `src/` (`oxfmt --check src` / `--write src`) to avoid scanning compiled `dist/` output.

## Git & Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:` (not `docs:` for `.claude/` changes)
- No AI references in commit messages
- Do not commit `.env` files or secrets
- Run `pnpm lint` before committing; run `pnpm test` before pushing
