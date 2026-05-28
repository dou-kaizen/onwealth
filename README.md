# boilerplate-monorepo

Production-grade NestJS monorepo boilerplate for building backend APIs with Postgres + Redis.
Current state: infrastructure-only (no business domain yet). Provides the DDD-lite foundation,
security hardening, observability, and CI pipeline that all future domain modules build on.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22.x (LTS "Jod") — see `.nvmrc` |
| pnpm | 10.x (`packageManager` field) |
| PostgreSQL | 16+ |
| Redis | 7+ |

## Quick Start

```bash
# 1. Install deps (also copies .env.example → .env for each package)
pnpm install

# 2. Fill in required env vars
#    apps/api/.env and packages/database/.env
#    See "Environment Variables" section below

# 3. Init DB roles + run migrations
pnpm db:dev

# 4. Start API in watch mode
pnpm dev
```

API is available at `http://localhost:3000`.
Swagger UI (non-prod only): `http://localhost:3000/docs`

## Environment Variables

### apps/api/.env (required)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | `postgresql://` connection string |
| `REDIS_URL` | yes | `redis://` (dev) or `rediss://` (prod) |
| `JWT_SECRET` | yes | Min 32 chars, not the placeholder value |
| `API_BASE_URL` | yes | Base URL for RFC 9457 error type URIs |
| `PORT` | no | Default `3000` |
| `ALLOWED_ORIGINS` | no | Comma-separated; required in production |
| `THROTTLE_TTL` | no | Default `60000` ms |
| `THROTTLE_LIMIT` | no | Default `100`; max `10000` in production |
| `GOOGLE_CLIENT_ID/SECRET` | no | OAuth — disabled if not set |
| `GITHUB_CLIENT_ID/SECRET` | no | OAuth — disabled if not set |

Full list in `apps/api/.env.example`.

### packages/database/.env (required for db:* scripts)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Same format as API |

## Scripts

### Root (Turborepo — runs across all workspaces)

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start all apps in watch mode |
| `pnpm build` | Build all packages + apps |
| `pnpm typecheck` | TypeScript type-check across workspaces |
| `pnpm lint` | Biome lint across workspaces |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Biome format (write) |
| `pnpm format:check` | Biome format check (no write) |
| `pnpm test` | Run all package test suites via Turborepo |
| `pnpm db:dev` | Init DB roles then run pending migrations |

### Git Hooks (lefthook)

Installed automatically on `pnpm install` via the `prepare` script.

| Hook | Trigger | Action |
|------|---------|--------|
| `pre-commit` | `git commit` | `biome check --write` on staged JS/TS/JSON files; auto-restages fixes |
| `commit-msg` | `git commit` | Validates Conventional Commits format on subject line |
| `pre-push` | `git push` | `turbo run typecheck test` |

Bypass (emergency only): `git commit --no-verify`. CI remains the hard gate.

### apps/api (run with `pnpm --filter api <script>`)

| Script | Description |
|--------|-------------|
| `dev` | Build then start in watch mode |
| `build` | NestJS CLI build |
| `start:prod` | `node dist/main` |
| `test` | Vitest (unit) |
| `test:cov` | Vitest with v8 coverage |
| `test:e2e` | Vitest with `vitest.e2e.config.mts` |
| `typecheck` | `tsc -b --noEmit` |
| `deps` | dependency-cruiser architecture check |

### packages/database (run with `pnpm --filter @boilerplate/database <script>`)

| Script | Description |
|--------|-------------|
| `db:init-roles` | Apply `sql/00-init-role-timeouts.sql` via psql |
| `db:generate` | drizzle-kit generate (new migration) |
| `db:migrate` | drizzle-kit migrate (apply pending) |
| `db:push` | drizzle-kit push (dev prototype, no migration file) |
| `db:studio` | Drizzle Studio UI |
| `build` | tsdown ESM build |
| `typecheck` | `tsc --noEmit` |

## Workspace Layout

```
boilerplate-monorepo/
├── apps/
│   └── api/                   # NestJS 11 application — composition root
│       └── src/
│           ├── modules/       # Business feature modules (reserved, none yet)
│           ├── __tests__/     # unit + integration specs + test helpers
│           ├── app.module.ts  # Root module — imports workspace packages
│           └── main.ts        # Thin entrypoint: createHttpApp + listen
├── packages/
│   ├── database/              # @boilerplate/database — Drizzle ORM schema + migrations
│   │   ├── src/schemas/       # Schema definitions (placeholder — TODO)
│   │   ├── drizzle/           # Generated migration files
│   │   └── sql/               # Raw SQL (role timeout init)
│   ├── shared-kernel/         # @boilerplate/shared-kernel — transport-agnostic NestJS modules
│   │   └── src/
│   │       ├── cache/         # CachePort interface + CACHE_PORT token + CacheService
│   │       ├── config/        # appConfig, databaseConfig, redisConfig; Zod env schema
│   │       ├── database/      # DB_TOKEN, DrizzleModule, DrizzleService
│   │       ├── domain/        # BaseAggregateRoot, DomainEvent, IntegrationEvent
│   │       ├── errors/        # ErrorCode enum, ValidationError
│   │       ├── events/        # DomainEventsModule, DomainEventPublisher
│   │       └── logger/        # LoggerModule (nestjs-pino) + redaction config
│   └── nest-http/             # @boilerplate/nest-http — HTTP cross-cutting layer
│       └── src/
│           ├── bootstrap/     # configureHttpApp / createHttpApp + HttpAppOptions
│           ├── config/        # httpConfig, throttleConfig, CLS, CORS, Swagger, ValidationPipe
│           ├── filters/       # AllExceptions, ProblemDetails, ThrottlerException
│           ├── interceptors/  # 7 global interceptors
│           ├── middleware/    # ETagMiddleware
│           ├── health/        # HealthModule (/livez, /readyz, /health)
│           ├── decorators/    # @Public, @UseEnvelope, @ApiProblemResponses, validators
│           └── dtos/          # Pagination DTOs, ProblemDetailsDto, ListResponseDto
├── docs/                      # Project documentation
├── .github/workflows/ci.yml   # CI: lint + typecheck + test + build + migration smoke
├── biome.json                 # Lint + format config (Biome v2)
├── lefthook.yml               # Git hooks: pre-commit, commit-msg, pre-push
├── turbo.json                 # Turborepo task pipeline
├── .dependency-cruiser.base.mjs  # Shared dependency-cruiser base (no-circular + cruise options)
└── pnpm-workspace.yaml
```

### Package Dependency DAG

```
apps/api → @boilerplate/nest-http → @boilerplate/shared-kernel → @boilerplate/database
future-worker → @boilerplate/shared-kernel
```

## Health Endpoints

| Endpoint | Purpose | I/O Dependencies |
|----------|---------|-----------------|
| `GET /livez` | Process liveness | None |
| `GET /readyz` | Readiness (orchestrator probe) | DB + Redis |
| `GET /health` | Full component detail | DB + Redis + heap + disk |

All return `503` with sanitized body on degraded state.

## Documentation

Full documentation lives in [`docs/`](./docs/README.md).

| Document | Description |
|----------|-------------|
| [Project Overview (PDR)](./docs/project-overview-pdr.md) | Product context + requirements |
| [System Architecture](./docs/system-architecture.md) | Architecture, layers, request lifecycle |
| [Codebase Summary](./docs/codebase-summary.md) | Workspace map, key modules, injection tokens |
| [Code Standards](./docs/code-standards.md) | Conventions, error model, TypeScript config |
| [Deployment Guide](./docs/deployment-guide.md) | Migration runner patterns, production checklist |
| [Project Roadmap](./docs/project-roadmap.md) | Phase status + upcoming work |
| [Infrastructure Deep-Dive Docs](./docs/infrastructure/README.md) | Per-topic docs: installation, environment, configuration, project structure, database, cache, queue, logger, response, request validation, error handling, security and middleware |
| [Features Documentation](./docs/features/README.md) | Per-feature docs — populated as features land (M2+) |
| [Journals](./docs/journals/) | Milestone and decision journals |

## Known Issues

- Coverage thresholds set to 0 — target 80/70/80/80 once domain modules land.
- No domain business modules yet (auth, users, etc.) — infrastructure skeleton only.
