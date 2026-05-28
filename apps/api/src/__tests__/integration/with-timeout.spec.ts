import type { DrizzleDb } from '@boilerplate/shared-kernel'
import { createDrizzleInstance, withTimeout } from '@boilerplate/shared-kernel'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * [H7] withTimeout — real Postgres timeout-kill path.
 *
 * Guards with describe.skipIf so the test:
 *   - SKIPS locally  (DATABASE_URL not set)
 *   - RUNS   in CI   (DATABASE_URL is set by the postgres service container)
 *
 * IMPORTANT: the guard is evaluated at COLLECTION time (module scope).
 * Do NOT move `process.env.DATABASE_URL` check inside beforeEach/beforeAll —
 * vi.stubEnv calls from other describe blocks in the same run would shadow
 * the ambient env by then and the guard would be unreliable.
 *
 * CI env var: DATABASE_URL (see .github/workflows/ci.yml → jobs.ci.steps.Test)
 * PostgreSQL SQLSTATE 57014 = query_canceled (fired by statement_timeout).
 *
 * Drizzle wraps pg errors as-is; the underlying pg error exposes `.code`.
 * We walk the cause chain to locate the first object carrying `.code === '57014'`
 * so the assertion is robust whether drizzle changes its error wrapping or not.
 */

// Evaluate the guard at collection time — NOT inside beforeEach.
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL)

/**
 * Walk the error cause chain and return the first error with a `.code` field.
 * Drizzle-orm may wrap pg errors; this lets us find the root SQLSTATE regardless.
 */
function findSqlstateError(err: unknown): { code?: string } | null {
  let current: unknown = err
  while (current != null && typeof current === 'object') {
    if ('code' in current) {
      return current as { code?: string }
    }
    if ('cause' in current) {
      current = (current as { cause?: unknown }).cause
    } else {
      break
    }
  }
  return null
}

describe.skipIf(!hasDatabaseUrl)(
  '[H7] withTimeout — timeout-kill path against real Postgres',
  () => {
    let db: DrizzleDb
    let pool: Pool

    beforeAll(() => {
      // DATABASE_URL is guaranteed non-empty here because describe.skipIf
      // would have skipped the whole suite otherwise.
      const { db: drizzleDb, pool: pgPool } = createDrizzleInstance({
        connectionString: process.env.DATABASE_URL as string,
        pool: {
          // Keep pool tiny: this test only needs a single connection.
          max: 1,
          min: 1,
          idleTimeoutMillis: 10_000,
          connectionTimeoutMillis: 5_000,
        },
      })
      db = drizzleDb
      pool = pgPool
    })

    afterAll(async () => {
      // Drain the pool so the test runner exits cleanly (no open handles).
      await pool.end()
    })

    it('aborts a pg_sleep longer than ms and rejects with SQLSTATE 57014', async () => {
      // 100 ms timeout; pg_sleep(1) would take 1000 ms — always triggers.
      const promise = withTimeout(db, 100, (tx) =>
        // pg_sleep returns void; wrap in an array so the Promise resolves to
        // a value and TypeScript is satisfied with the generic constraint.
        tx.execute(sql`SELECT pg_sleep(1)`).then(() => undefined as unknown as never),
      )

      await expect(promise).rejects.toSatisfy((err: unknown) => {
        const sqlErr = findSqlstateError(err)
        return sqlErr?.code === '57014'
      })
    }, 5_000) // Give the test up to 5 s — far longer than the 100 ms timeout, but generous enough to account for cold-start latency in CI containers.
  },
)
