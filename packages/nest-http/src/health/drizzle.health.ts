import type { DrizzleDb } from '@boilerplate/shared-kernel'
import { DB_TOKEN } from '@boilerplate/shared-kernel'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthIndicatorResult } from '@nestjs/terminus'
import { sql } from 'drizzle-orm'
import ms from 'ms'

/**
 * Health-check query deadline.
 *
 * Hard cap (rather than relying on the pool's `statement_timeout`) catches
 * half-open TCP connections that the pool considers alive but that never
 * deliver a response — otherwise the probe would hang until the LB itself
 * times out.
 */
const HEALTH_TIMEOUT_MS = ms('3s')

/**
 * Terminus health indicator for the primary database connection.
 *
 * Performs a `SELECT 1` round-trip under a 3-second deadline. Raw error
 * messages are never returned to callers — they are logged server-side
 * only so hostname / port / user details can never leak to unauthenticated
 * probe traffic.
 */
@Injectable()
export class DrizzleHealthIndicator {
  private readonly logger = new Logger(DrizzleHealthIndicator.name)

  constructor(@Inject(DB_TOKEN) private readonly db: DrizzleDb) {}

  /**
   * Run the probe.
   *
   * @param key — Terminus result key (becomes the property name in
   *              `HealthIndicatorResult`). Allows the same indicator to
   *              report under different names per probe endpoint.
   * @returns `{ [key]: { status: 'up' | 'down', message } }`. Never throws
   *          — failures are logged and reported as `down`.
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.checkDb()
      return { [key]: { status: 'up' as const, message: 'Database is available' } }
    } catch (error) {
      this.logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { [key]: { status: 'down' as const, message: 'Connection failed' } }
    }
  }

  /**
   * Execute `SELECT 1` against the pool under the {@link HEALTH_TIMEOUT_MS}
   * deadline. The timer is always cleared in `finally` so the Node event
   * loop is not held open when the query wins the race.
   */
  private async checkDb(): Promise<void> {
    let timerId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('DB health check timed out')), HEALTH_TIMEOUT_MS)
    })
    try {
      await Promise.race([this.db.execute(sql`SELECT 1`), timeout])
    } finally {
      clearTimeout(timerId)
    }
  }
}
