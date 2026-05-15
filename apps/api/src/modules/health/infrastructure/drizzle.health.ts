import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthIndicatorResult } from '@nestjs/terminus'
import { sql } from 'drizzle-orm'

import type { DrizzleDb } from '@/app/database/db.port'
import { DB_TOKEN } from '@/app/database/db.port'

/** Health check query timeout — prevents hanging under half-open TCP connections. */
const HEALTH_TIMEOUT_MS = 3_000

/**
 * Drizzle database health indicator
 *
 * Verifies the database connection by executing a simple SELECT 1 query
 * with a 3 s timeout. Raw error messages are never returned to callers —
 * they are logged server-side only (prevents hostname/port/user leakage).
 */
@Injectable()
export class DrizzleHealthIndicator {
  private readonly logger = new Logger(DrizzleHealthIndicator.name)

  constructor(@Inject(DB_TOKEN) private readonly db: DrizzleDb) {}

  /**
   * Check the database connection health.
   *
   * @param key - Health check identifier used as the result key
   * @returns HealthIndicatorResult with status 'up' or 'down'
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.checkDb()
      return {
        [key]: { status: 'up' as const, message: 'Database is available' },
      }
    } catch (error) {
      // Log full error server-side; return static message to caller to prevent info leak.
      this.logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        [key]: { status: 'down' as const, message: 'Connection failed' },
      }
    }
  }

  /** Executes SELECT 1 with a hard 3 s deadline to detect half-open TCP connections. */
  private async checkDb(): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DB health check timed out')), HEALTH_TIMEOUT_MS),
    )
    await Promise.race([this.db.execute(sql`SELECT 1`), timeout])
  }
}
