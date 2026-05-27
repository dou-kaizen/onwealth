import KeyvRedis from '@keyv/redis'
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { redisConfig } from '../config/redis.config.js'
import { CACHE_PORT } from './cache.port.js'
import { CacheService } from './cache.service.js'

/**
 * Injection token for the shared {@link KeyvRedis} instance.
 *
 * One Keyv instance is constructed and shared between two consumers:
 *   1. `@nestjs/cache-manager`'s `stores` array (read/write path), and
 *   2. {@link CacheService.onModuleDestroy} (graceful shutdown path).
 *
 * Both consumers MUST receive the SAME instance so the disconnect hook
 * actually closes the ioredis connection used by `cache-manager`.
 */
export const KEYV_REDIS_TOKEN = Symbol('KEYV_REDIS_TOKEN')

/**
 * Global cache module backed by Redis through the Keyv adapter.
 *
 * Demonstrates the "thin application layer" pattern:
 * - Integrates third-party libraries (`@nestjs/cache-manager` + `@keyv/redis`).
 * - {@link CacheService} acts only as a coordinator; no business logic.
 * - Port/adapter via {@link CACHE_PORT} allows swapping the implementation
 *   without touching consumers.
 *
 * **Wiring notes:**
 * - `ConfigModule.forFeature(redisConfig)` registers the typed factory locally
 *   so `redisConfig.KEY` always resolves regardless of host-app wiring —
 *   mirrors the `QueueModule` pattern. NestJS dedupes if the host already
 *   registered the same factory globally.
 * - Global scope is intentional: Redis cache is a cross-cutting resource
 *   that every context may need, and instantiating it per-module would
 *   multiply connections.
 * - A single `KeyvRedis` instance is registered under {@link KEYV_REDIS_TOKEN}
 *   and reused by both `NestCacheModule.registerAsync` and `CacheService` so
 *   the graceful-shutdown `disconnect()` actually closes the same ioredis
 *   client that the cache-manager store uses.
 */
@Global() // @global-approved: Redis cache shared by all contexts.
@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    NestCacheModule.registerAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      useFactory: (cfg: ConfigType<typeof redisConfig>, keyv: KeyvRedis<unknown>) => ({
        stores: [keyv],
        ttl: cfg.ttl * 1000,
      }),
      inject: [redisConfig.KEY, KEYV_REDIS_TOKEN],
    }),
  ],
  providers: [
    {
      provide: KEYV_REDIS_TOKEN,
      useFactory: (cfg: ConfigType<typeof redisConfig>) => new KeyvRedis(cfg.url),
      inject: [redisConfig.KEY],
    },
    CacheService,
    {
      provide: CACHE_PORT,
      useExisting: CacheService,
    },
  ],
  exports: [CacheService, CACHE_PORT],
})
export class CacheModule {}
