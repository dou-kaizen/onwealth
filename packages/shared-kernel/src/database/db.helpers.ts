import { sql } from 'drizzle-orm'

import type { DrizzleDb } from './db.port.js'

/**
 * Drizzle transaction object type, derived from the {@link DrizzleDb.transaction}
 * callback signature.
 *
 * Avoids importing `NodePgTransaction` directly: internal drizzle-orm types
 * are not guaranteed stable across minor versions, but the callback shape is.
 *
 * @internal
 */
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]

/**
 * Execute a DB operation inside a transaction with a custom `statement_timeout`.
 *
 * Uses `set_config(name, value, true)` — the `true` flag scopes the setting to
 * the current transaction, matching `SET LOCAL` semantics but expressed as a
 * SQL function call that accepts bound parameters. `SET LOCAL` cannot bind
 * parameters; expressing it via interpolation would create an injection
 * surface if `ms` ever originated from user input.
 *
 * Use sparingly: only when the role-level default (30 s) is wrong for the
 * query (e.g. slow analytics exports). Normal OLTP queries should rely on
 * the default configured via
 * `packages/database/sql/00-init-role-timeouts.sql`.
 *
 * Postgres raises `SQLSTATE 57014` when `statement_timeout` fires; callers
 * should map it to a domain-level "query timeout" error.
 *
 * @param db Drizzle database instance.
 * @param ms Timeout in milliseconds; must be `> 0` (e.g. `60_000` for 60 s).
 * @param fn Callback receiving the transaction object.
 *
 * @throws {Error} if `ms <= 0`.
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
    await tx.execute(sql`SELECT set_config('statement_timeout', ${String(ms)}, true)`)
    return fn(tx)
  })
}
