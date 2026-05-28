# Database Documentation

This documentation explains the database layer of **boilerplate-monorepo**: Drizzle ORM wired
to Postgres 16 via the `pg` driver, with role-level timeout enforcement, schema migration
tooling, and a NestJS DI module that exposes a typed `DrizzleDb` handle to every repository.

Source locations:

- Schema package: `packages/database/`
- NestJS wiring: `packages/shared-kernel/src/database/`
- Config factory: `packages/shared-kernel/src/config/database.config.ts`
- SQLSTATE mapper: `packages/nest-http/src/filters/database-error-mapper.ts`

## Related Documents

- [Environment Variables](./environment.md) — `DATABASE_URL` and pool tunables reference
- [Configuration](./configuration.md) — NestJS `ConfigModule`, namespace factories
- [Handling Error](./handling-error.md) — `AllExceptions` filter that calls `mapDatabaseError`
- [Project Structure](./project-structure.md) — package boundaries and dependency DAG

## Table of Contents

- [Configuration](#configuration)
- [Structure](#structure)
- [Usage](#usage)
- [Creating a New Schema](#creating-a-new-schema)
- [Behavior](#behavior)
- [References](#references)

## Configuration

### Environment Variables

All database env vars are defined in `packages/shared-kernel/src/config/database.config.ts`
and validated against `envObjectSchema` (see [Environment Variables](./environment.md) for the
full catalog). The subset picked by `databaseEnvSchema`:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Full connection string; must include `sslmode=require` or `ssl=true` in production |
| `DB_POOL_MAX` | No | `20` | Maximum pool size; must be 1–100 |
| `DB_POOL_MIN` | No | `5` | Minimum pool size; must be ≤ `DB_POOL_MAX` |
| `DB_POOL_IDLE_TIMEOUT` | No | `30000` | Milliseconds before idle connections are evicted (min 1000) |
| `DB_POOL_CONNECTION_TIMEOUT` | No | `10000` | Milliseconds to wait for a new connection (min 1000) |

`databaseConfig` is a `registerAs('database', ...)` factory. Inject it with
`ConfigService.get('database')` or via `@Inject(databaseConfig.KEY)`.

### Drizzle Kit (`packages/database/drizzle.config.ts`)

Drizzle Kit reads `DATABASE_URL` from `packages/database/.env` (resolved relative to the
config file, not CWD). Copy `packages/database/.env.example` and set `DATABASE_URL` before
running any `pnpm db:*` script. The config targets `./src/schemas`, outputs migrations to
`./drizzle`, and enforces `strict: true` to prevent accidental `DROP TABLE` migrations when a
schema file exports an empty object.

## Structure

### `packages/database/` — Schema Package

```
packages/database/
├── src/
│   ├── schemas/
│   │   └── index.ts        # Re-exports every domain schema module
│   └── index.ts            # Package entry point
├── sql/
│   └── 00-init-role-timeouts.sql  # Role-level timeout DDL (run once per env)
├── scripts/
│   └── init-roles.ts       # Node.js runner for the SQL above (tsx, no psql required)
└── drizzle.config.ts       # Drizzle Kit configuration
```

Domain tables are added under `src/schemas/` and re-exported from `src/schemas/index.ts`.
The package has no compile-time schema today (`export {}`) — schemas accumulate here as
domain modules are introduced.

### `packages/shared-kernel/src/database/` — NestJS Wiring

| File | Purpose |
|---|---|
| `db.port.ts` | `DB_TOKEN` symbol + `DrizzleDb` / `DrizzleModuleOptions` / `DrizzleAsyncOptions` types |
| `db.module.ts` | `DrizzleModule.forRoot()` and `forRootAsync()` — global dynamic module |
| `db.provider.ts` | `createDrizzleInstance(options)` — builds `pg.Pool` + Drizzle `db` |
| `drizzle.service.ts` | `DrizzleService` — owns pool lifecycle (`onModuleDestroy`) |
| `db.helpers.ts` | `withTimeout(db, ms, fn)` — per-transaction `statement_timeout` override |

### DI Token

```typescript
// packages/shared-kernel/src/database/db.port.ts
export const DB_TOKEN = Symbol('DB_TOKEN')
export type DrizzleDb = NodePgDatabase<typeof schema>
```

`DrizzleModule` exports both `DB_TOKEN` (resolves to `DrizzleService.db`) and
`DrizzleService` directly. Repositories should inject `DB_TOKEN` — the service instance
is only needed when the pool lifecycle must be observed.

## Usage

### Registering the Module

Call `DrizzleModule.forRoot()` once in `AppModule`. It self-loads `ConfigModule.forFeature(databaseConfig)` so `DATABASE_URL` resolves without any additional wiring in the host app.

```typescript
// apps/api/src/app.module.ts
import { DrizzleModule } from '@boilerplate/shared-kernel'

@Module({ imports: [DrizzleModule.forRoot(), ...] })
export class AppModule {}
```

For advanced scenarios (vault-sourced secrets, multi-tenant pools), use
`DrizzleModule.forRootAsync(options: DrizzleAsyncOptions)` and supply a `useFactory`.
See `packages/shared-kernel/src/database/db.module.ts:L82` for the full signature.

### Injecting the Database Handle

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { DB_TOKEN, type DrizzleDb } from '@boilerplate/shared-kernel'

@Injectable()
export class UserRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: DrizzleDb) {}

  async findById(id: string) {
    return this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) })
  }
}
```

### Per-Transaction Timeout Override

The `withTimeout` helper wraps a callback in a transaction and applies a scoped
`statement_timeout` via `SET LOCAL` semantics (SQL function `set_config(name, value, true)`):

```typescript
import { withTimeout } from '@boilerplate/shared-kernel'

// Override for a slow analytics query; role default is 30 s
const rows = await withTimeout(this.db, 60_000, (tx) =>
  tx.select().from(analyticsTable)
)
```

Use sparingly — only when the role-level default (30 s) is wrong for the query. Normal
OLTP operations rely on the role default set by `00-init-role-timeouts.sql`.

### Pool Error Handling

`createDrizzleInstance` attaches an `error` listener to `pg.Pool` that writes to
`process.stderr` (not `console.error`) so the message is always visible in crash logs
even when pino intercepts `console.*`. Repositories do not need to handle pool-level errors.

## Creating a New Schema

1. Add a schema file under `packages/database/src/schemas/` (e.g. `users.schema.ts`).
2. Re-export it from `packages/database/src/schemas/index.ts`:

   ```typescript
   export * from './users.schema.js'
   ```

3. Generate the migration:

   ```bash
   pnpm --filter @boilerplate/database db:generate
   ```

4. Review the generated SQL in `packages/database/drizzle/`.
5. Apply to the target database:

   ```bash
   pnpm --filter @boilerplate/database db:migrate
   ```

Drizzle Kit's `strict: true` causes `db:generate` to fail if it would emit a `DROP TABLE`
statement for an empty schema. This guards against accidentally deleting tables when a
schema module temporarily exports nothing.

## Behavior

### Role-Level Timeout Initialization

Before the first migration, run:

```bash
pnpm --filter @boilerplate/database db:init-roles
```

This executes `scripts/init-roles.ts` via `tsx` (no system `psql` binary required). The
script applies `sql/00-init-role-timeouts.sql` which sets the following on `current_user`:

| Setting | Value | USERSET |
|---|---|---|
| `statement_timeout` | 30 s | Yes — no superuser needed |
| `lock_timeout` | 10 s | Yes |
| `idle_in_transaction_session_timeout` | 60 s | Yes |

These are role-level `ALTER ROLE … SET` defaults, not session-level `SET` commands. They
are inherited by every connection regardless of PgBouncer mode (session / transaction /
statement). This avoids the `pool.on('connect')` pattern, which silently breaks under
PgBouncer transaction mode — settings issued on connect run against a shared backend and
may not apply to the pooled session.

### Graceful Pool Shutdown

`DrizzleService` implements `OnModuleDestroy`. When NestJS receives `SIGTERM` or `SIGINT`
(enabled via `app.enableShutdownHooks()` in `main.ts`), `pool.end()` is called. This
drains active queries before the process exits — no connections are dropped mid-flight.

### SQLSTATE Error Mapping

`packages/nest-http/src/filters/database-error-mapper.ts` (`mapDatabaseError`) translates
`pg.DatabaseError` SQLSTATE codes to NestJS `HttpException` before the RFC 9457 filter
renders the Problem Details response:

| SQLSTATE | Postgres Name | HTTP Status | Error Code |
|---|---|---|---|
| `23505` | unique_violation | 409 Conflict | `RESOURCE_CONFLICT` |
| `40001` | serialization_failure | 409 Conflict | `TRANSACTION_CONFLICT` |
| `40P01` | deadlock_detected | 409 Conflict | `TRANSACTION_CONFLICT` |
| `23503` | foreign_key_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `23502` | not_null_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `23514` | check_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `08000/08001/08003/08004/08006` | connection exception | 503 Service Unavailable | `INTERNAL_SERVER_ERROR` |
| `57014` | query_canceled (statement_timeout) | 503 Service Unavailable | `INTERNAL_SERVER_ERROR` |

Transaction conflict codes `40001` / `40P01` map to `409 Conflict` — callers are expected
to retry idempotent operations. See [RFC 7231][ref-rfc-7231] §6.5.8 for the 409 semantics.

### Production SSL Enforcement

`envSchema` rejects `DATABASE_URL` at boot if `NODE_ENV=production` and the URL does not
contain `sslmode=require`, `ssl=true`, or the `postgresql+ssl://` scheme. This guarantees
the pg driver negotiates TLS before the first query.

## References

[ref-drizzle]: https://orm.drizzle.team
[ref-pg]: https://node-postgres.com
[ref-rfc-7231]: https://datatracker.ietf.org/doc/html/rfc7231
[ref-pg-errcodes]: https://www.postgresql.org/docs/current/errcodes-appendix.html
[ref-pg-alter-role]: https://www.postgresql.org/docs/current/sql-alterrole.html
