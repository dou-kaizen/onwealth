# Installation Documentation

This documentation explains how to set up and run **boilerplate-monorepo** locally for
development. The monorepo uses [Turborepo][ref-turborepo] for task orchestration and
[pnpm][ref-pnpm] workspaces for package management.

## Related Documents

- [Environment Variables][ref-doc-environment]
- [Configuration][ref-doc-configuration]

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Steps](#installation-steps)
- [Environment Setup](#environment-setup)
- [Database Initialization](#database-initialization)
- [Starting the API](#starting-the-api)
- [Verification](#verification)
- [Git Hooks](#git-hooks)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x (LTS "Jod") | Version pinned in `.nvmrc`; use `nvm use` to switch |
| pnpm | 10.x | Declared in `packageManager` field in root `package.json` |
| PostgreSQL | 16+ | Local install or Docker; connection string set via `DATABASE_URL` |
| Redis | 7+ | Local install or Docker; connection string set via `REDIS_URL` |

Install the correct Node.js version with [nvm][ref-nvm]:

```bash
nvm install
nvm use
```

Install pnpm if not already present:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## Installation Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd boilerplate-monorepo

# 2. Install all workspace dependencies
#    Also copies .env.example → .env for apps/api and packages/database
pnpm install
```

The `pnpm install` step runs the `prepare` script which installs [lefthook][ref-lefthook]
git hooks automatically.

## Environment Setup

After `pnpm install`, two `.env` files are present (copied from their `.env.example`
templates). Fill in all **REQUIRED** values before proceeding.

**`apps/api/.env`** — required values:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boilerplate"
REDIS_URL="redis://localhost:6379"
JWT_SECRET=<min-32-chars-mixed-case-with-digits>
API_BASE_URL="http://localhost:3000"
```

**`packages/database/.env`** — required value:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/boilerplate"
```

Full variable reference: [Environment Variables][ref-doc-environment].

## Database Initialization

```bash
# Init DB roles then apply all pending Drizzle migrations
pnpm db:dev
```

`pnpm db:dev` runs two steps in sequence:

1. `db:init-roles` — applies `packages/database/sql/00-init-role-timeouts.sql` via a
   Node.js-based script (no `psql` binary required on the developer machine).
2. `db:migrate` — runs `drizzle-kit migrate` to apply pending migration files from
   `packages/database/drizzle/`.

To generate a new migration after modifying schemas:

```bash
pnpm --filter @boilerplate/database db:generate
```

## Starting the API

```bash
# Start all apps in watch mode (Turborepo fan-out)
pnpm dev
```

For the API package only:

```bash
pnpm --filter api dev
```

## Verification

Once the API is running, confirm it is healthy:

| Check | URL | Expected |
|---|---|---|
| Process liveness | `http://localhost:3000/livez` | `200 OK` |
| Readiness (DB + Redis) | `http://localhost:3000/readyz` | `200 OK` |
| API reference (non-prod) | `http://localhost:3000/docs` | Scalar UI |
| Swagger UI (non-prod) | `http://localhost:3000/swagger` | Swagger UI |

The `/docs` and `/swagger` routes are only mounted when `NODE_ENV !== 'production'`.

## Git Hooks

Lefthook installs three hooks automatically during `pnpm install`:

| Hook | Trigger | Action |
|---|---|---|
| `pre-commit` | `git commit` | `biome check --write` on staged JS/TS/JSON; auto-restages fixes |
| `commit-msg` | `git commit` | Validates Conventional Commits format on subject line |
| `pre-push` | `git push` | `turbo run typecheck test` across all workspaces |

Emergency bypass (CI remains the hard gate): `git commit --no-verify`

## Troubleshooting

**`ECONNREFUSED` on startup**

PostgreSQL or Redis is not reachable. Confirm both services are running and that
`DATABASE_URL` / `REDIS_URL` in `apps/api/.env` match the actual host/port.

**`Environment variable validation failed`**

A required env var is missing or fails its Zod rule. The error message lists every
offending field with its rule. Check `apps/api/.env` against the full variable reference
in [Environment Variables][ref-doc-environment].

**`db:init-roles` fails with permission error**

The database user in `DATABASE_URL` needs `CREATEROLE` or superuser privilege to apply
`00-init-role-timeouts.sql`. Use the `postgres` superuser for local dev.

**Port already in use**

Set `PORT=<other-port>` in `apps/api/.env`. Valid range: 1024–65535.

**Drizzle Studio**

```bash
pnpm --filter @boilerplate/database db:studio
```

Opens a browser-based schema and data viewer at `https://local.drizzle.studio`.



<!-- REFERENCES -->

[ref-doc-environment]: ./environment.md
[ref-doc-configuration]: ./configuration.md
[ref-turborepo]: https://turbo.build/repo
[ref-pnpm]: https://pnpm.io
[ref-nvm]: https://github.com/nvm-sh/nvm
[ref-lefthook]: https://github.com/evilmartians/lefthook
