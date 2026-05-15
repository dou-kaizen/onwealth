import * as schema from '@onwealth/database'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { DrizzleDb, DrizzleModuleOptions } from './db.port.js'

/**
 * Creates a Drizzle database instance alongside the underlying pg Pool.
 *
 * Returns both db and pool so DrizzleService can manage pool lifecycle
 * (drain on SIGTERM via OnModuleDestroy).
 *
 * Statement-level timeouts are NOT set here via pool.on('connect') — that
 * pattern silently breaks under PgBouncer transaction mode. Role-level
 * timeouts are enforced via packages/database/sql/00-init-role-timeouts.sql
 * (run once per environment before first migration).
 */
export function createDrizzleInstance(options: DrizzleModuleOptions): {
  db: DrizzleDb
  pool: Pool
} {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.pool?.max ?? 10,
    min: options.pool?.min ?? 2,
    idleTimeoutMillis: options.pool?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.pool?.connectionTimeoutMillis ?? 5000,
  })

  // Prevent process crash from unhandled EventEmitter error on idle client drop.
  pool.on('error', (err: Error) => {
    console.error('[pg-pool] Unexpected idle client error:', err.message)
  })

  const db = drizzle({ client: pool, schema })
  return { db, pool }
}
