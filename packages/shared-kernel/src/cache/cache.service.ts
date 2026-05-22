import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import type { CachePort } from './cache.port.js'

/**
 * Sentinel that represents a cached `undefined` result.
 *
 * Problem: cacheManager.get returns `undefined` for both a genuine cache miss
 * (key absent) and a cached value of `undefined`. Without disambiguation, a
 * function that returns `undefined` would be called on every wrap() invocation.
 *
 * Solution: store UNDEFINED_RESULT in the cache whenever fn() returns `undefined`.
 * On the next call, raw === UNDEFINED_RESULT (not strict-undefined), so we know
 * this is a cache HIT and return `undefined` without calling fn() again.
 *
 * The sentinel is a frozen object (not a bare Symbol) because cache-manager may
 * serialise values through JSON for some stores. The `__sk` property name is
 * deliberately obscure to avoid collisions with user data.
 */
const UNDEFINED_RESULT = Object.freeze({ __sk: 'undefined-sentinel-v1' })

function isUndefinedSentinel(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).__sk === 'undefined-sentinel-v1'
  )
}

@Injectable()
export class CacheService implements CachePort {
  private readonly logger = new Logger(CacheService.name)

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

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
      // cache-manager v5+ uses milliseconds
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

  async wrap<T>(key: string, function_: () => Promise<T>, ttl?: number): Promise<T> {
    // TODO: thundering-herd — N concurrent misses all call fn(). Add mutex/NX-flag if hot-path contention observed.

    // Read directly from cacheManager (not through this.get) so we can see the raw
    // stored value and detect both hit variants:
    //   raw === undefined       → genuine cache miss  → call fn()
    //   isUndefinedSentinel(raw) → cached undefined   → HIT, return undefined
    //   anything else           → cached value        → HIT, return as-is
    let raw: unknown
    try {
      raw = await this.cacheManager.get(key)
    } catch (err) {
      this.logger.warn('Cache wrap-get failed, degrading gracefully', {
        key,
        error: (err as Error).message,
      })
      // On read error degrade to calling fn() directly
      return function_()
    }

    // Cache HIT path
    if (raw !== undefined) {
      // Unwrap the sentinel back to undefined for the caller.
      return (isUndefinedSentinel(raw) ? undefined : raw) as T
    }

    // Cache MISS path — call the wrapped function
    const result = await function_()

    // Persist: store the sentinel when result is undefined so the next call sees
    // a HIT rather than another miss.
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
