import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthIndicatorResult } from '@nestjs/terminus'
import type { CachePort } from '@onwealth/shared-kernel'
import { CACHE_PORT } from '@onwealth/shared-kernel'
import ms from 'ms'

/** Probe key — written then read back to assert round-trip integrity. */
const PROBE_KEY = '__health_probe__'

/** Probe value — compared byte-for-byte on read-back. */
const PROBE_VALUE = '1'

/**
 * Probe deadline.
 *
 * Set+get round-trip must complete inside this window or the indicator
 * reports `down`. Catches half-open TCP connections that the client
 * library still considers alive.
 */
const HEALTH_TIMEOUT_MS = ms('3s')

/**
 * Terminus health indicator for the Redis cache backend.
 *
 * Writes a temporary key (5 s TTL) then reads it back under a 3-second
 * deadline. A read-after-write mismatch is treated as `down` even when
 * the underlying connection succeeded — this catches stale replicas, the
 * null-driver fallback, and serialization mismatches that would
 * otherwise appear as "healthy" but silently drop traffic.
 *
 * Raw error messages are never returned to callers — they are logged
 * server-side only so hostname / port / password details cannot leak.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name)

  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  /**
   * Run the probe.
   *
   * @param key — Terminus result key (becomes the property name in
   *              `HealthIndicatorResult`).
   * @returns `{ [key]: { status: 'up' | 'down', message } }`. Never throws
   *          — failures are logged and reported as `down`.
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.checkRedis()
      return { [key]: { status: 'up' as const, message: 'Redis is available' } }
    } catch (error) {
      this.logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { [key]: { status: 'down' as const, message: 'Connection failed' } }
    }
  }

  /**
   * Perform the set+get round-trip under the {@link HEALTH_TIMEOUT_MS}
   * deadline. The timer is always cleared in `finally` so the Node event
   * loop is not held open when the probe wins the race.
   */
  private async checkRedis(): Promise<void> {
    let timerId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error('Redis health check timed out')),
        HEALTH_TIMEOUT_MS,
      )
    })
    const probe = async () => {
      await this.cache.set(PROBE_KEY, PROBE_VALUE, 5)
      const readback = await this.cache.get(PROBE_KEY)
      if (readback !== PROBE_VALUE) {
        throw new Error('Redis health check readback mismatch')
      }
    }
    try {
      await Promise.race([probe(), timeout])
    } finally {
      clearTimeout(timerId)
    }
  }
}
