import KeyvRedis from '@keyv/redis'
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { redisConfig } from '../config/redis.config.js'
import { CACHE_PORT } from './cache.port.js'
import { CacheService } from './cache.service.js'

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
 */
@Global() // @global-approved: Redis cache shared by all contexts.
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      useFactory: (cfg: ConfigType<typeof redisConfig>) => ({
        stores: [new KeyvRedis(cfg.url)],
        ttl: cfg.ttl * 1000,
      }),
      inject: [redisConfig.KEY],
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
