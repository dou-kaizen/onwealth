import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis'
import { Logger } from '@nestjs/common'
import Redis from 'ioredis'

import type { Env } from '../config/env.schema'
import type { ConfigService } from '@nestjs/config'

/**
 * Hard cap on the boot-time Redis connect race. Longer than the typical
 * TCP+TLS handshake but short enough that K8s readiness probes don't
 * mark the pod healthy before the throttler is actually usable.
 */
const REDIS_CONNECT_TIMEOUT_MS = 5000

/**
 * Bound on `client.quit()` during shutdown. Mirrors `DatabaseModule`
 * `POOL_DRAIN_TIMEOUT_MS` shape so a dead Redis cannot hold the process
 * past the K8s `terminationGracePeriodSeconds` budget.
 */
const REDIS_CLOSE_TIMEOUT_MS = 4000

export interface ThrottlerStorageBundle {
  storage: ThrottlerStorageRedisService
  client: Redis
}

/**
 * Build the cluster-safe Redis throttler storage.
 *
 * Boot posture (fail-fast): awaits the `ready` event (or rejects on
 * `error` / timeout). If Redis is unreachable when this factory runs,
 * NestJS init throws and the process exits — matching the documented
 * invariant that the API never serves traffic with a broken limiter.
 *
 * Runtime posture (queue on blip): `enableOfflineQueue` is left at the
 * ioredis default (`true`) so transient disconnects buffer commands
 * rather than throwing synchronously from every throttler check (which
 * would turn a Redis blip into a full 500 outage). `maxRetriesPerRequest:
 * 3` caps recovery latency.
 */
export async function createRedisThrottlerStorage(
  config: ConfigService<Env, true>,
): Promise<ThrottlerStorageBundle> {
  const url = config.get('REDIS_URL', { infer: true })
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  })

  client.on('error', (err) => {
    // NestJS root Logger — runs before nestjs-pino is fully wired.
    Logger.error(`[redis-throttler] ${err.message}`, undefined, 'ThrottlerModule')
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Redis connect timeout (${REDIS_CONNECT_TIMEOUT_MS}ms) — REDIS_URL=${url}`))
    }, REDIS_CONNECT_TIMEOUT_MS)

    client.once('ready', () => {
      clearTimeout(timer)
      resolve()
    })
    client.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  return { storage: new ThrottlerStorageRedisService(client), client }
}

/**
 * Close a Redis client with a hard timeout so a dead/unreachable Redis
 * cannot hang `OnModuleDestroy` past the shutdown budget.
 *
 * Falls back to `disconnect()` (force) if `quit()` rejects, then races
 * the whole sequence against `REDIS_CLOSE_TIMEOUT_MS`.
 */
export async function closeRedisClient(client: Redis): Promise<void> {
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, REDIS_CLOSE_TIMEOUT_MS)
  })
  const quit = (async () => {
    try {
      await client.quit()
    } catch {
      client.disconnect()
    }
  })()
  await Promise.race([quit, timeout])
}
