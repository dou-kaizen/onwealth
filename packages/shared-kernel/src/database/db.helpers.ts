import { sql } from 'drizzle-orm'

import type { DrizzleDb } from './db.port.js'

/**
 * Derive the transaction object type from the DrizzleDb.transaction callback.
 * This avoids importing internal drizzle-orm types (NodePgTransaction) that may
 * not be stable across minor versions.
 */
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]

/**
 * Execute a DB operation inside a transaction with a custom statement_timeout.
 *
 * Uses set_config(..., true) — transaction-local, same PgBouncer safety as
 * SET LOCAL but expressed as a regular SQL function call that accepts bound
 * parameters. SET LOCAL cannot bind parameters and would require interpolation,
 * creating a potential injection surface if ms ever originated from user input.
 *
 * Use sparingly: only when the role-level default (30 s) is incorrect for the
 * query (e.g. slow analytics exports). For normal OLTP queries, rely on the
 * role-level default configured via packages/database/sql/00-init-role-timeouts.sql.
 *
 * @param db  - Drizzle database instance
 * @param ms  - Timeout in milliseconds (must be > 0; e.g. 60_000 for 60 s)
 * @param fn  - Callback receiving the transaction object
 *
 * @example
 *   const rows = await withTimeout(this.db, 60_000, (tx) =>
 *     tx.select().from(analyticsTable)
 *   )
 */
export async function withTimeout<T>(
  db: DrizzleDb,
  ms: number,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  if (ms <= 0) {
    throw new Error(`withTimeout: ms must be > 0, got ${ms}`)
  }
  return db.transaction(async (tx) => {
    // set_config(name, value, is_local) — third arg true = transaction-local.
    // Postgres SQLSTATE 57014 is raised when statement_timeout fires.
    await tx.execute(sql`SELECT set_config('statement_timeout', ${String(ms)}, true)`)
    return fn(tx)
  })
}
