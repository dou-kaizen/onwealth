import * as schema from '@onwealth/database'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { DrizzleModuleOptions } from './database.tokens'

/**
 * Build a Drizzle instance backed by a node-postgres pool.
 *
 * Pool defaults are intentionally conservative; production deployments
 * should set `DB_POOL_*` env vars to tune.
 */
export function createDrizzleInstance(options: DrizzleModuleOptions) {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.pool?.max ?? 10,
    min: options.pool?.min ?? 2,
    idleTimeoutMillis: options.pool?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.pool?.connectionTimeoutMillis ?? 5000,
  })

  return drizzle({ client: pool, schema })
}
