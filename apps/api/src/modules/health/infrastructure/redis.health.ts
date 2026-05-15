import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthIndicatorResult } from '@nestjs/terminus'

import type { CachePort } from '@/shared-kernel/application/ports/cache.port'
import { CACHE_PORT } from '@/shared-kernel/application/ports/cache.port'

/** Temporary key for the health probe; TTL is set to 5 seconds */
const PROBE_KEY = '__health_probe__'

/** Sentinel value written then read back to assert round-trip integrity. */
const PROBE_VALUE = '1'

/** Health check timeout — prevents hanging under half-open TCP connections. */
const HEALTH_TIMEOUT_MS = 3_000

/**
 * Redis health indicator
 *
 * Verifies the Redis connection by writing and reading back a temporary key
 * with a 3 s timeout. Raw error messages are never returned to callers —
 * they are logged server-side only (prevents hostname/port/password leakage).
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name)

  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  /**
   * Check the Redis connection health.
   *
   * @param key - Health check identifier used as the result key
   * @returns HealthIndicatorResult with status 'up' or 'down'
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.checkRedis()
      return {
        [key]: { status: 'up' as const, message: 'Redis is available' },
      }
    } catch (error) {
      // Log full error server-side; return static message to caller to prevent info leak.
      this.logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        [key]: { status: 'down' as const, message: 'Connection failed' },
      }
    }
  }

  /** Performs a set+get round-trip with a hard 3 s deadline. */
  private async checkRedis(): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis health check timed out')), HEALTH_TIMEOUT_MS),
    )
    const probe = async () => {
      await this.cache.set(PROBE_KEY, PROBE_VALUE, 5)
      const readback = await this.cache.get(PROBE_KEY)
      // Read-after-write divergence => stale replica, cache backed by null driver,
      // or serialization mismatch. Treat as DOWN even though connection succeeded.
      if (readback !== PROBE_VALUE) {
        throw new Error('Redis health check readback mismatch')
      }
    }
    await Promise.race([probe(), timeout])
  }
}
