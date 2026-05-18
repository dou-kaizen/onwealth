import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import type { CachePort } from './cache.port.js'

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
    const cached = await this.get<T>(key)
    if (cached !== undefined) {
      return cached
    }

    const result = await function_()

    // Best-effort cache write; if it fails, still return the computed result
    await this.set(key, result, ttl)

    return result
  }
}
