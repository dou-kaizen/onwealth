import * as schema from '@onwealth/database'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { DrizzleInstance, DrizzleModuleOptions } from './database.tokens'

/**
 * Build a Drizzle instance backed by a node-postgres pool.
 *
 * Returns BOTH the Drizzle client AND the underlying pool so the caller
 * (DatabaseModule) can drain the pool on shutdown via OnModuleDestroy.
 *
 * Pool sizing comes exclusively from the env schema — no factory-level
 * fallbacks, so a misconfigured caller fails loudly rather than silently
 * accepting a min/max that diverges from the documented contract.
 *
 * `pool.on('error')` is wired immediately to prevent Node's
 * uncaught-event default from killing the process when an idle client
 * disconnects (TCP RST, pg restart, etc.). The handler writes to stderr
 * because no Logger is available inside a non-NestJS factory function.
 */
export function createDrizzleInstance(options: DrizzleModuleOptions): DrizzleInstance {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.pool.max,
    min: options.pool.min,
    idleTimeoutMillis: options.pool.idleTimeoutMillis,
    connectionTimeoutMillis: options.pool.connectionTimeoutMillis,
  })

  pool.on('error', (err: Error) => {
    process.stderr.write(`[pg-pool] idle client error: ${err.message}\n`)
  })

  return { db: drizzle({ client: pool, schema }), pool }
}
