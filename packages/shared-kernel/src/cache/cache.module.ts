import KeyvRedis from '@keyv/redis'
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { redisConfig } from '../config/redis.config.js'
import { CACHE_PORT } from './cache.port.js'
import { CacheService } from './cache.service.js'

/**
 * Cache module
 *
 * Provides a caching service backed by Redis (via the Keyv adapter)
 * This is an example of the "thin application layer" pattern:
 * - primarily integrates third-party libraries (cache-manager + @keyv/redis)
 * - the service layer acts only as a coordinator with no complex business logic
 * - uses port/adapter pattern for easy replacement of the cache implementation
 */
@Global() // @global-approved: Redis 缓存，所有需要缓存的 context 都依赖
@Module({
  imports: [
    // Configure cache-manager to use Redis (via the Keyv adapter).
    // imports: [ConfigModule] ensures redisConfig.KEY resolves when CacheModule
    // is bootstrapped standalone. NestJS dedupes if ConfigModule is already global.
    NestCacheModule.registerAsync({
      // `ConfigModule.forFeature(redisConfig)` registers the typed factory locally
      // so `redisConfig.KEY` always resolves regardless of host-app wiring —
      // matches the QueueModule pattern. NestJS dedupes if the host already
      // registered the same factory globally.
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

    // Provide CachePort interface (DIP)
    {
      provide: CACHE_PORT,
      useExisting: CacheService,
    },
  ],
  exports: [CacheService, CACHE_PORT],
})
export class CacheModule {}
