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
 * Uses SET LOCAL — the override is scoped to the current transaction and is
 * compatible with any PgBouncer mode (session / transaction / statement).
 *
 * Use sparingly: only when the role-level default (30 s) is incorrect for the
 * query (e.g. slow analytics exports). For normal OLTP queries, rely on the
 * role-level default configured via packages/database/sql/00-init-role-timeouts.sql.
 *
 * @param db  - Drizzle database instance
 * @param ms  - Timeout in milliseconds (e.g. 60_000 for 60 s)
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
  return db.transaction(async (tx) => {
    // SET LOCAL is transaction-scoped — safe under PgBouncer transaction mode.
    await tx.execute(sql`SET LOCAL statement_timeout = ${String(ms)}`)
    return fn(tx)
  })
}
