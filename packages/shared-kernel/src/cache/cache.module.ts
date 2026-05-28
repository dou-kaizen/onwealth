import KeyvRedis from '@keyv/redis'
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { redisConfig } from '../config/redis.config.js'
import { CACHE_PORT } from './cache.port.js'
import { CacheService } from './cache.service.js'
import { KEYV_REDIS_TOKEN } from './cache.tokens.js'

export { KEYV_REDIS_TOKEN } from './cache.tokens.js'

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
/**
 * Dedicated provider module for the shared `KeyvRedis` instance.
 *
 * Extracted as a Nest sub-module so the same token is visible in BOTH
 * dynamic-module scopes that need it:
 *   1. `NestCacheModule.registerAsync({ inject: [..., KEYV_REDIS_TOKEN] })`
 *      — the factory runs in its own DI scope and cannot see providers
 *      declared in the OUTER `CacheModule`; the only way to expose the
 *      token is via an explicit `imports: [KeyvRedisModule]` on the
 *      `registerAsync` call.
 *   2. `CacheService` constructor `@Inject(KEYV_REDIS_TOKEN)` — resolved
 *      through the outer `CacheModule` which imports this same module.
 *
 * Both consumers therefore reference the same provider instance — exactly
 * one `KeyvRedis` client is created, used by `cache-manager`'s store, and
 * disconnected on `CacheService.onModuleDestroy`.
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: KEYV_REDIS_TOKEN,
      useFactory: (cfg: ConfigType<typeof redisConfig>) => new KeyvRedis(cfg.url),
      inject: [redisConfig.KEY],
    },
  ],
  exports: [KEYV_REDIS_TOKEN],
})
class KeyvRedisModule {}

@Global() // @global-approved: Redis cache shared by all contexts.
@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    KeyvRedisModule,
    NestCacheModule.registerAsync({
      imports: [ConfigModule.forFeature(redisConfig), KeyvRedisModule],
      useFactory: (cfg: ConfigType<typeof redisConfig>, keyv: KeyvRedis<unknown>) => ({
        stores: [keyv],
        ttl: cfg.ttl * 1000,
      }),
      inject: [redisConfig.KEY, KEYV_REDIS_TOKEN],
    }),
  ],
  providers: [
    CacheService,
    {
      provide: CACHE_PORT,
      useExisting: CacheService,
    },
  ],
  exports: [CacheService, CACHE_PORT],
})
export class CacheModule {}
