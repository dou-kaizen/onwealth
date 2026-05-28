import type KeyvRedis from '@keyv/redis'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { OnModuleDestroy } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import type { CachePort } from './cache.port.js'
import { KEYV_REDIS_TOKEN } from './cache.tokens.js'

/**
 * Sentinel that represents a cached `undefined` result.
 *
 * `cacheManager.get` returns `undefined` for both a genuine miss (key absent)
 * AND a cached value of `undefined`. Without disambiguation, a wrapped
 * function returning `undefined` would re-execute on every `wrap()` call.
 *
 * Storing this sentinel makes `raw === UNDEFINED_RESULT` distinguishable
 * from `raw === undefined`, so the next `wrap()` sees a HIT.
 *
 * Implementation notes:
 * - Frozen plain object (not a bare `Symbol`) because some cache-manager
 *   stores serialise through JSON; symbols would round-trip to `undefined`.
 * - `__sk` (shared-kernel) prefix + version suffix avoids collisions with
 *   user payloads and allows future bumps without breaking old caches.
 */
const UNDEFINED_RESULT = Object.freeze({ __sk: 'undefined-sentinel-v1' })

/**
 * Discriminator for {@link UNDEFINED_RESULT}.
 *
 * Uses {@link Object.hasOwn} so a poisoned `Object.prototype.__sk` cannot
 * masquerade as a sentinel hit — prototype-chain lookups are excluded.
 */
function isUndefinedSentinel(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    Object.hasOwn(raw, '__sk') &&
    (raw as Record<string, unknown>).__sk === 'undefined-sentinel-v1'
  )
}

/**
 * Default {@link CachePort} implementation backed by `cache-manager` + Keyv.
 *
 * **Failure model:** every backend call is wrapped in try/catch and logs a
 * `warn` on failure. Cache is treated as a non-critical accelerator; an
 * outage degrades gracefully (read miss / silent set failure / direct fn()
 * call from `wrap`) rather than propagating to the caller.
 *
 * **TTL units:** the public API takes seconds; cache-manager v5+ takes
 * milliseconds, so every set multiplies by 1000 at the boundary.
 */
@Injectable()
export class CacheService implements CachePort, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name)

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @Inject(KEYV_REDIS_TOKEN)
    private readonly keyvRedis: KeyvRedis<unknown>,
  ) {}

  /**
   * Graceful disconnect on Nest shutdown (SIGTERM).
   *
   * Calls `KeyvRedis.disconnect(false)` — the `false` flag drains in-flight
   * commands via `QUIT` before closing the socket. Errors are swallowed at
   * `warn` because cache shutdown must never block the process exit chain;
   * a hung disconnect should fall through to the main.ts hard-stop timer.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.keyvRedis.disconnect(false)
      this.logger.log('Cache Redis disconnected')
    } catch (err) {
      this.logger.warn('Cache Redis disconnect failed', {
        error: (err as Error).message,
      })
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      return (await this.cacheManager.get<T>(key)) ?? undefined
    } catch (err) {
      this.logger.warn('Cache get failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
      return undefined
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const ttlMs = ttl ? ttl * 1000 : undefined
      await this.cacheManager.set(key, value, ttlMs)
    } catch (err) {
      this.logger.warn('Cache set failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key)
    } catch (err) {
      this.logger.warn('Cache del failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
    }
  }

  async reset(): Promise<void> {
    try {
      await this.cacheManager.clear()
    } catch (err) {
      this.logger.warn('Cache reset failed, degrading gracefully', {
        error: (err as Error).message,
      })
    }
  }

  /**
   * Read-through cache: return cached value, or compute, store, and return.
   *
   * Distinguishes three states by reading `cacheManager` directly (not via
   * {@link CacheService.get}):
   * - `raw === undefined` → genuine miss → call `fn()`.
   * - {@link isUndefinedSentinel}(raw) → cached `undefined` → return `undefined`.
   * - anything else → cached value → return as-is.
   *
   * **TODO:** thundering-herd — N concurrent misses all call `fn()`. Add a
   * per-key mutex or Redis SET NX flag if a hot key shows contention.
   *
   * **Failure behaviour:**
   * - Read error → degrades to a direct `fn()` call (no store on success
   *   path; we don't know whether the store would have succeeded).
   * - Write error → returns the freshly computed value but logs a warn;
   *   subsequent calls will miss again.
   */
  async wrap<T>(key: string, function_: () => Promise<T>, ttl?: number): Promise<T> {
    let raw: unknown
    try {
      raw = await this.cacheManager.get(key)
    } catch (err) {
      this.logger.warn('Cache wrap-get failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
      return function_()
    }

    if (raw !== undefined) {
      return (isUndefinedSentinel(raw) ? undefined : raw) as T
    }

    const result = await function_()

    const toStore = result === undefined ? UNDEFINED_RESULT : result
    try {
      const ttlMs = ttl ? ttl * 1000 : undefined
      await this.cacheManager.set(key, toStore, ttlMs)
    } catch (err) {
      this.logger.warn('Cache wrap-set failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
    }

    return result
  }
}
