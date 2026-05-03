# onwealth

Backend platform for wealth management. Currently in the infrastructure-foundation phase: NestJS HTTP runtime, structured observability, RFC 9457 error handling, Drizzle + PostgreSQL connectivity, and strict architectural boundary enforcement via dependency-cruiser. No feature domains have shipped yet.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS (`.nvmrc: lts/jod`) |
| Framework | NestJS 11 (Express adapter, SWC emit) |
| Language | TypeScript 6 |
| Database | PostgreSQL via Drizzle ORM + node-postgres pool |
| Logging | Pino / nestjs-pino (JSON in prod, pino-pretty in dev) |
| Validation | class-validator + class-transformer + Zod (env) |
| Rate limiting | @nestjs/throttler |
| Build | Turborepo + pnpm 10 workspaces |
| Linting | oxlint (single root config) + dependency-cruiser |
| Formatting | oxfmt |
| Testing | Vitest |

## Repository Layout

```
onwealth/
├── apps/
│   └── api/          # @onwealth/api — NestJS HTTP entrypoint
├── packages/
│   ├── core/         # @onwealth/core — DDD primitives (DomainEvent, BaseAggregateRoot)
│   ├── database/     # @onwealth/database — Drizzle schema barrel
│   ├── platform/     # @onwealth/platform — NestJS foundation modules (12 subpath exports)
│   └── tsconfig/     # Shared TypeScript presets (base, library, nest)
├── docs/             # Project documentation
├── plans/            # Implementation plans and reports
├── .dependency-cruiser.cjs  # 6 architectural boundary rules
├── oxlint.config.ts         # Single root lint config
├── turbo.json               # Task pipeline
└── pnpm-workspace.yaml      # Workspace + version catalog
```

## Quick Start

### Prerequisites

- Node.js 22 (`nvm use` or `fnm use`)
- pnpm 10.32.1 (`corepack enable && corepack prepare pnpm@10.32.1 --activate`)
- PostgreSQL instance accessible at `DATABASE_URL`

### Install

```bash
pnpm install
```

### Environment

Copy and edit the environment for `apps/api`:

```bash
cp apps/api/.env.example apps/api/.env
# edit DATABASE_URL and other required vars
```

Environment variables are validated at startup via Zod. Required vars and defaults are documented in [docs/code-standards.md](./docs/code-standards.md#environment-variables).

### Dev

```bash
pnpm dev           # start all apps in watch mode (Turborepo TUI)
```

Or scoped:

```bash
pnpm --filter @onwealth/api dev
```

### Build

```bash
pnpm build         # build all packages in dependency order
```

### Test

```bash
pnpm test          # Vitest across all packages (depends on build)
```

### Lint & Format

```bash
pnpm lint          # oxlint + depcruise:check across all packages
pnpm lint:fix      # oxlint auto-fix
pnpm format        # oxfmt write
pnpm format:check  # oxfmt check (used in CI)
pnpm typecheck     # tsc project references across all packages
```

### Architectural Lint

```bash
pnpm depcruise:check   # enforce 6 boundary rules (also runs as part of pnpm lint)
```

Rules enforced: no circular deps; `@onwealth/core` is NestJS-free; `@onwealth/database` is NestJS-free; `@onwealth/platform` contains no feature symbols; `apps/api` accesses platform only via subpath imports. See [docs/system-architecture.md](./docs/system-architecture.md#architectural-boundaries-dependency-cruiser-rules).

## API

`GET /health` — returns `{ data: { status, uptime, timestamp }, meta: { request_id, correlation_id, trace_id, timestamp } }`

All error responses use RFC 9457 `application/problem+json`. See [docs/system-architecture.md](./docs/system-architecture.md#error-response-shape-rfc-9457).

## Documentation

| Doc | Contents |
|---|---|
| [docs/project-overview-pdr.md](./docs/project-overview-pdr.md) | Project overview and Product Development Requirements |
| [docs/system-architecture.md](./docs/system-architecture.md) | Package graph, request lifecycle, error/success shapes, DB layer |
| [docs/code-standards.md](./docs/code-standards.md) | TypeScript rules, NestJS conventions, env vars, logging, testing |
| [docs/codebase-summary.md](./docs/codebase-summary.md) | Package purposes, subpath exports, runtime deps, toolchain |
| [docs/project-roadmap.md](./docs/project-roadmap.md) | Phase status and planned work |

## Branch Convention

| Branch | Purpose |
|---|---|
| `main` | Stable, protected |
| `init-infrastructure` | Active development branch (current) |

Feature branches: `feat/<slug>`, fix branches: `fix/<slug>`. Commit style: conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
