import { Inject, Module, OnModuleDestroy } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler'

import { closeRedisClient, createRedisThrottlerStorage } from './redis-throttler-storage.factory'

import type { Env } from '../config/env.schema'
import type Redis from 'ioredis'

/**
 * DI token for the Redis client that backs the throttler storage.
 *
 * The client is held on a module-instance field (via `@Inject`) rather
 * than a module-scoped `let` so multiple `TestingModule` instantiations
 * in the same process cannot orphan a shared client (parallel to the
 * `DatabaseModule.activePool` test caveat).
 */
const THROTTLER_REDIS_CLIENT = Symbol('THROTTLER_REDIS_CLIENT')

const redisClientProvider = {
  provide: THROTTLER_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: async (config: ConfigService<Env, true>): Promise<Redis> => {
    const { client } = await createRedisThrottlerStorage(config)
    return client
  },
}

/**
 * Foundation throttler.
 *
 * Storage: `@nest-lab/throttler-storage-redis` backed by `ioredis`.
 * Cluster-safe across replicas — counters live in Redis, not per-process
 * memory.
 *
 * Boot posture: the storage factory awaits a Redis `ready` event (or
 * rejects on `error` / 5s timeout). With `REDIS_URL` unreachable, the
 * NestJS factory rejects and the process exits before serving any
 * traffic — preventing silent fallback to a permissive limiter.
 *
 * Runtime posture: ioredis default `enableOfflineQueue: true` means a
 * mid-flight Redis blip buffers throttler ops for `maxRetriesPerRequest:
 * 3` attempts rather than 500-storming the API.
 *
 * Caveat: `createRedisThrottlerStorage` is invoked twice in this graph —
 * once for the `useFactory` (storage handle) and once for the
 * `redisClientProvider` (close handle). NestJS resolves each factory
 * independently, so two distinct Redis clients live for the module's
 * lifetime. Acceptable at low scale; revisit (memoize per `ConfigService`
 * or return `{ storage, client }` as a tuple from a single async
 * provider) if `client_count` on the production Redis approaches its
 * connection-limit budget.
 */
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Returns the module-config OBJECT shape (NOT the array shape).
      // `storage` is only valid on the object overload — the array form
      // silently ignores extra keys, which would defeat the cluster-safe
      // wiring and fall back to in-memory storage. Verified against
      // @nestjs/throttler@6.5.0.
      useFactory: async (config: ConfigService<Env, true>) => {
        const { storage } = await createRedisThrottlerStorage(config)
        return {
          throttlers: [
            {
              ttl: config.get('THROTTLE_TTL', { infer: true }),
              limit: config.get('THROTTLE_LIMIT', { infer: true }),
            },
          ],
          storage,
        }
      },
    }),
  ],
  providers: [redisClientProvider],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule implements OnModuleDestroy {
  constructor(@Inject(THROTTLER_REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client)
  }
}
