# Environment Variables Documentation

This documentation explains the environment variable validation system for
**boilerplate-monorepo**. All variables are validated at application startup via
a [Zod][ref-zod] schema defined in
`packages/shared-kernel/src/config/env.schema.ts`. A single invalid or missing
required variable causes a fail-fast boot error listing every offending field.

## Related Documents

- [Configuration][ref-doc-configuration]
- [Installation][ref-doc-installation]

## Table of Contents

- [Overview](#overview)
- [Required Variables](#required-variables)
- [Optional Variables](#optional-variables)
- [Production Hardening Rules](#production-hardening-rules)
- [Variable Groups](#variable-groups)
  - [Application](#application)
  - [Database](#database)
  - [Cache (Redis)](#cache-redis)
  - [Queue](#queue)
  - [Security](#security)
  - [Rate Limiting](#rate-limiting)
  - [OAuth](#oauth)
- [Validation Behavior](#validation-behavior)
- [Maintainer Note](#maintainer-note)

## Overview

Environment variables are the single configuration surface for runtime behavior.
The schema in `packages/shared-kernel/src/config/env.schema.ts` defines two exports:

- `envObjectSchema` — per-field rules; sub-schemas for individual namespaces (`databaseConfig`,
  `redisConfig`, etc.) derive from this via `.pick()` so field rules have one source of truth.
- `envSchema` — wraps `envObjectSchema` with cross-field production refines (TLS enforcement,
  pool bounds, JWT entropy checks, etc.).
- `validateEnv` — function wired as `ConfigModule.forRoot({ validate: validateEnv })`;
  called once on HTTP app bootstrap.

Source: `packages/shared-kernel/src/config/env.schema.ts:L31` (`envObjectSchema`),
`packages/shared-kernel/src/config/env.schema.ts:L148` (`envSchema`).

## Required Variables

These variables have no default. The application refuses to start if any are absent
or fail their validation rule.

| Variable | File | Rule | Description |
|---|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | Valid URL, `postgresql://` scheme | PostgreSQL connection string |
| `REDIS_URL` | `apps/api/.env` | Matches `redis://` or `rediss://` | Redis connection string |
| `JWT_SECRET` | `apps/api/.env` | Min 32 characters | JWT signing secret |
| `API_BASE_URL` | `apps/api/.env` | Valid URL | Type URI prefix for RFC 9457 error responses |

`packages/database/.env` also requires `DATABASE_URL` (same format) for `db:*` scripts.

## Optional Variables

Variables with defaults are listed with their default value. Setting them is required
in production to override the development defaults.

| Variable | Default | Rule | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` | Runtime environment |
| `PORT` | `3000` | 1024–65535 | HTTP listen port |
| `ALLOWED_ORIGINS` | _(unset)_ | No `*` or `null` entries | CORS origin allowlist, comma-separated |
| `DB_POOL_MAX` | `20` | 1–100 | Max connections in pg pool |
| `DB_POOL_MIN` | `5` | 0–50 | Min idle connections in pg pool |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | ≥ 1000 ms | Idle connection eviction threshold |
| `DB_POOL_CONNECTION_TIMEOUT` | `10000` | ≥ 1000 ms | Max wait for a pool slot |
| `REDIS_TTL` | `3600` | > 0 (seconds) | Default cache TTL |
| `QUEUE_REDIS_URL` | _(falls back to `REDIS_URL`)_ | Matches `redis://` or `rediss://` | Dedicated Redis URL for BullMQ queues |
| `THROTTLE_TTL` | `60000` | ≥ 1000 ms | Rate-limit rolling window |
| `THROTTLE_LIMIT` | `100` | > 0 | Max requests per window |
| `GOOGLE_CLIENT_ID` | _(unset)_ | — | OAuth — Google login disabled when absent |
| `GOOGLE_CLIENT_SECRET` | _(unset)_ | — | OAuth — Google login disabled when absent |
| `GITHUB_CLIENT_ID` | _(unset)_ | — | OAuth — GitHub login disabled when absent |
| `GITHUB_CLIENT_SECRET` | _(unset)_ | — | OAuth — GitHub login disabled when absent |
| `OAUTH_CALLBACK_BASE_URL` | _(unset)_ | — | Base URL for OAuth callback routes |
| `FRONTEND_URL` | _(unset)_ | — | Post-OAuth redirect target |

Source for field rules: `packages/shared-kernel/src/config/env.schema.ts:L31–L125`.

## Production Hardening Rules

When `NODE_ENV=production` the schema applies additional cross-field refines.
Any failure causes a fail-fast boot error identical to missing required variables.

| Variable | Production Rule |
|---|---|
| `REDIS_URL` | Must use `rediss://` (TLS) |
| `QUEUE_REDIS_URL` | Must use `rediss://` (TLS) when set |
| `DATABASE_URL` | Must include `sslmode=require`, `ssl=true`, or use `postgresql+ssl://` scheme |
| `THROTTLE_LIMIT` | Must be ≤ 10 000 (higher values effectively disable rate limiting) |
| `JWT_SECRET` | Must not contain `change-me`, `example`, `placeholder`, or `your-secret` |
| `JWT_SECRET` | Must contain uppercase, lowercase, and digit characters |
| `JWT_SECRET` | Must have ≥ 16 distinct characters |
| `API_BASE_URL` | Must not contain `api.example.com` |
| `DB_POOL_MIN` | Must be ≤ `DB_POOL_MAX` (enforced in all environments) |

Source: `packages/shared-kernel/src/config/env.schema.ts:L148–L238`.

## Variable Groups

### Application

```
NODE_ENV=development     # development | production | test
PORT=3000                # 1024–65535
API_BASE_URL=http://localhost:3000
```

`API_BASE_URL` is the type URI prefix for RFC 9457 Problem Details responses — it appears
as the leading segment of every error `type` field. A wrong value emits URIs pointing at
an external domain.

### Database

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/boilerplate
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_CONNECTION_TIMEOUT=10000
```

Pool bounds are validated both in `envSchema` (cross-field) and independently inside
`databaseConfig` so non-HTTP workers that skip the full schema still get the guard.
Source: `packages/shared-kernel/src/config/database.config.ts:L17–L33`.

### Cache (Redis)

```
REDIS_URL=redis://localhost:6379   # rediss:// required in production
REDIS_TTL=3600                     # seconds; consumers multiply × 1000 at the boundary
```

### Queue

```
QUEUE_REDIS_URL=redis://localhost:6379   # optional; falls back to REDIS_URL
```

Queue config resolves the effective URL as `QUEUE_REDIS_URL ?? REDIS_URL`.
Source: `packages/shared-kernel/src/queue/queue.config.ts:L38–L43`.

### Security

```
JWT_SECRET=<min-32-chars-mixed-case-with-digits>
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

`ALLOWED_ORIGINS` accepts a comma-separated list. When absent, the CORS config
defaults to `{ origin: false }` — no CORS headers emitted. Wildcards (`*`) and the
literal string `null` are rejected at validation time.

### Rate Limiting

```
THROTTLE_TTL=60000    # milliseconds; minimum 1000
THROTTLE_LIMIT=100    # requests per window
```

Note: `THROTTLE_TTL` is in **milliseconds**. The schema enforces a minimum of 1000 ms
to guard against accidentally treating it as seconds.
Source: `packages/shared-kernel/src/config/env.schema.ts:L112–L124`.

### OAuth

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
OAUTH_CALLBACK_BASE_URL=http://localhost:3000/api/auth/oauth
FRONTEND_URL=http://localhost:8080
```

OAuth providers are disabled when their client ID / secret pair is absent. No validation
error is raised for missing OAuth vars.

## Validation Behavior

`validateEnv` is wired to `ConfigModule.forRoot({ validate: validateEnv })` in the HTTP
app bootstrap. It is called once on startup with `process.env` as input.

On failure the function throws an `Error` whose message lists every offending field as
`path: reason`, one per line, then terminates the process. The `cause` property holds
the original `ZodError` for programmatic inspection.

Example failure output:

```
Environment variable validation failed:
JWT_SECRET: JWT_SECRET must be at least 32 characters
REDIS_URL: REDIS_URL must start with redis:// or rediss://

Please check your .env file or environment variable configuration
```

Source: `packages/shared-kernel/src/config/env.schema.ts:L260–L276`.

## Maintainer Note

`env.schema.ts` is the single source of truth for all field rules. When a new environment
variable is added to the codebase, update `envObjectSchema` first, then update the table
in this document. Per-namespace schemas (database, redis, queue, throttle, http) derive
their field rules from `envObjectSchema` via `.pick()` — do not duplicate rules in those
files.



<!-- REFERENCES -->

[ref-doc-configuration]: ./configuration.md
[ref-doc-installation]: ./installation.md
[ref-zod]: https://zod.dev
