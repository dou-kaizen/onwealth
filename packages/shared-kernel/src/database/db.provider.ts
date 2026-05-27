import * as schema from '@onwealth/database'
import { drizzle } from 'drizzle-orm/node-postgres'
import ms from 'ms'
import { Pool } from 'pg'

import type { DrizzleDb, DrizzleModuleOptions } from './db.port.js'

/** Default idle-connection eviction window (ms). */
const DEFAULT_IDLE_TIMEOUT_MS = ms('30s')
/** Default connect-attempt deadline (ms). */
const DEFAULT_CONNECTION_TIMEOUT_MS = ms('5s')

/**
 * Build a Drizzle database instance alongside its underlying pg `Pool`.
 *
 * Returns both so {@link DrizzleService} can own pool lifecycle (drain on
 * SIGTERM via `OnModuleDestroy`).
 *
 * **Why no `pool.on('connect')` for `statement_timeout`:** that pattern
 * silently breaks under PgBouncer transaction mode — settings issued on
 * connect run against a shared backend and may not apply to the pooled
 * session. Role-level timeouts are enforced once per environment via
 * `packages/database/sql/00-init-role-timeouts.sql` before the first
 * migration. Per-query overrides go through {@link withTimeout}.
 *
 * **Pool error handler:** attached to prevent process crash from an
 * unhandled EventEmitter error on idle client drop. Writes directly to
 * `process.stderr` rather than `console.error` because (a) the handler
 * runs outside DI scope so no injected logger is available, and (b)
 * structured-log pipelines (pino) may intercept `console.*` and drop it;
 * raw stderr is always visible in crash logs.
 *
 * @param options {@link DrizzleModuleOptions} — connection string + pool tunables.
 * @returns `{ db, pool }` — db for query use, pool for lifecycle management.
 *
 * @see DrizzleService for the lifecycle wrapper consumed by `DrizzleModule`.
 */
export function createDrizzleInstance(options: DrizzleModuleOptions): {
  db: DrizzleDb
  pool: Pool
} {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.pool?.max ?? 10,
    min: options.pool?.min ?? 2,
    idleTimeoutMillis: options.pool?.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: options.pool?.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  })

  pool.on('error', (err: Error) => {
    process.stderr.write(`[pg-pool] Unexpected idle client error: ${err.message}\n`)
  })

  const db = drizzle({ client: pool, schema })
  return { db, pool }
}
