# Codebase Summary

_Last updated: 2026-05-03 | Branch: init-infrastructure_

## Repository Layout

```
onwealth/                          # pnpm + Turborepo monorepo
├── apps/
│   └── api/                       # @onwealth/api — NestJS HTTP entrypoint
├── packages/
│   ├── contract/                  # @onwealth/contract — wire-level types only
│   ├── core/                      # @onwealth/core — framework-agnostic DDD primitives
│   ├── database/                  # @onwealth/database — Drizzle schemas only
│   ├── platform/                  # @onwealth/platform — NestJS foundation layer
│   └── tsconfig/                  # shared TypeScript presets
├── .dependency-cruiser.cjs        # 7 architectural boundary rules
├── pnpm-workspace.yaml            # catalog pins all dependency versions
└── turbo.json                     # task pipeline (build → lint → test → dev)
```

## Packages

| Package | Purpose | Key constraint |
|---|---|---|
| `@onwealth/contract` | RFC 9457 `ProblemDetailsDto`, `FieldError`, `ValidationErrorItem` types | No `@nestjs/*`, no runtime libs |
| `@onwealth/core` | `BaseAggregateRoot`, `DomainEvent`, `IntegrationEvent` | No `@nestjs/*`, no ioredis/pino/drizzle/pg |
| `@onwealth/database` | Drizzle schema barrel (`packages/database/src/schemas/index.ts`) | No `@nestjs/*`; empty in foundation phase |
| `@onwealth/platform` | NestJS modules exported via 9 subpath exports | No feature symbols (auth/user/bot) |
| `@onwealth/api` | Boots NestJS app, wires middleware chain | Consumes `@onwealth/platform/*` via subpath only — never relative |

## `@onwealth/platform` Subpath Exports

| Subpath | Contents |
|---|---|
| `/config` | `ConfigModule` (Zod `envSchema`, `validateEnv`, `Env` type) |
| `/cls` | `ClsModule` — W3C traceparent + request/correlation IDs |
| `/logger` | `LoggerModule` — nestjs-pino, pino-pretty in dev, JSON in prod |
| `/filters` | `FiltersModule` — `AllExceptionsFilter`, `ProblemDetailsFilter`, `ThrottlerExceptionFilter` |
| `/interceptors` | `InterceptorsModule` — `TransformInterceptor` (Google AIP-193 envelope) |
| `/decorators` | `@UseEnvelope()` decorator |
| `/pipes` | `createValidationPipe()` — whitelist, 422, transform |
| `/throttler` | `ThrottlerModule` — env-driven TTL/limit |
| `/database` | `DatabaseModule`, `DrizzleFactory`, injection tokens |

## `apps/api` Bootstrap Order

1. `NestFactory.create(ApiModule, { bufferLogs: true })`
2. Swap logger → `nestjs-pino`
3. `helmet()` (security headers)
4. `createValidationPipe()` (whitelist + 422 + transform)
5. `TransformInterceptor` (AIP-193 envelope when `@UseEnvelope()`)
6. Global filters LIFO: `AllExceptionsFilter` first, then `ProblemDetailsFilter`, then `ThrottlerExceptionFilter`
7. CORS from `ALLOWED_ORIGINS` env
8. `app.listen(PORT)`

## API Modules (foundation)

| Module | Route | Notes |
|---|---|---|
| `HealthModule` | `GET /health` | Returns `{ status, uptime, timestamp }` wrapped in `{ data, meta }` via `@UseEnvelope()` |

## Runtime Dependencies (catalog-pinned)

| Lib | Version | Role |
|---|---|---|
| NestJS | ^11.1.0 | HTTP framework |
| nestjs-pino | ^4.4.0 | Structured logging |
| nestjs-cls | ^5.0.0 | Request-scoped storage |
| drizzle-orm | ^0.44.7 | ORM |
| pg | ^8.16.3 | PostgreSQL driver (node-postgres pool) |
| zod | ^4.0.0 | Env validation |
| helmet | ^8.0.0 | Security headers |
| @nestjs/throttler | ^6.4.0 | Rate limiting |

## Toolchain

| Tool | Purpose |
|---|---|
| pnpm 10.32.1 | Package manager |
| Turborepo ^2.9.7 | Task orchestration |
| TypeScript ^6.0.3 | Language |
| SWC | Compilation emit for `apps/api` (`.swcrc` `module.type=commonjs`) |
| oxlint ^1.59.0 | Linting |
| oxfmt ^0.44.0 | Formatting |
| dependency-cruiser ^16 | Architectural boundary enforcement |
| vitest ^2.1.0 | Testing |
