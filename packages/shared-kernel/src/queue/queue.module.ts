import { BullModule, getSharedConfigToken } from '@nestjs/bullmq'
import type { OnModuleInit } from '@nestjs/common'
import { Global, Inject, Logger, Module, Optional } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import type { RedisOptions } from 'bullmq'
import { sanitizeRedisUrl } from '../utils/sanitize-redis-url.js'
import { queueConfig } from './queue.config.js'
import { QueueConfigKey } from './queue.constant.js'

/**
 * Parses a Redis URL into the explicit field shape ioredis expects.
 *
 * BullMQ's `connection` accepts either a `RedisOptions` object or a raw URL
 * string — NOT `{ url }` as a property. Passing `{ url }` silently falls back
 * to the ioredis defaults (localhost:6379, no auth), masking misconfigurations.
 * We extract host/port/auth/tls so additional ioredis flags (e.g.
 * `maxRetriesPerRequest`) can sit alongside the parsed connection.
 *
 * Supports `redis://` and `rediss://` (TLS) schemes.
 */
function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  }
}

const SHARED_CONFIG_TOKEN = getSharedConfigToken(QueueConfigKey)

/**
 * Queue infrastructure module.
 *
 * Registers a single named BullMQ root connection under {@link QueueConfigKey}
 * ('queue'). Both producers and workers share it.
 *
 * Why one connection (not split producer/worker): `@nestjs/bullmq`'s
 * `BullExplorer.getQueueOptions` prefers a registered Queue's
 * `opts.connection` over the worker's `configKey` shared config. Any split
 * would be silently defeated for queues registered via
 * `BullModule.registerQueue` — both sides end up on the producer's
 * connection. The unified key uses worker-safe ioredis settings
 * (`maxRetriesPerRequest: null`) so blocking BRPOP works; the producer-side
 * cost is enqueues won't fail fast on a Redis outage.
 *
 * Concrete queue registration is intentionally absent here.
 * Feature modules register their own queues via `BullModule.registerQueue()`,
 * importing this module to inherit the root connection:
 *
 * @example
 *   BullModule.registerQueue({
 *     configKey: QueueConfigKey,
 *     name: 'email-notification',
 *   })
 *
 * apps/api does NOT import QueueModule until a concrete queue is introduced.
 *
 * @see ./README.md — Quick Start, Gotchas, Production Checklist, DLQ migration.
 */
@Global() // @global-approved: BullMQ root connection, consumed by all feature queue modules
@Module({
  imports: [
    // Self-contain queueConfig so QueueModule's own constructor injection of
    // `queueConfig.KEY` resolves without forcing consumers to register it.
    ConfigModule.forFeature(queueConfig),
    BullModule.forRootAsync(QueueConfigKey, {
      imports: [ConfigModule.forFeature(queueConfig)],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          ...parseRedisUrl(cfg.url),
          // null required for worker BRPOP: ioredis must not fail-fast on blocking commands.
          // DO NOT remove during "cleanup" — see plans/reports/code-review-260524-1703-codebase-scan.md C3.
          maxRetriesPerRequest: null,
        },
        // Bounded retention on Redis to prevent unbounded list growth.
        // Per-queue overrides via BullModule.registerQueue({ defaultJobOptions }) or per add() call.
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
      inject: [queueConfig.KEY],
    }),
  ],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger(QueueModule.name)

  constructor(
    @Inject(queueConfig.KEY) private readonly cfg: ConfigType<typeof queueConfig>,
    // Injected only to fail fast at startup if `BullModule.forRootAsync` did
    // NOT register the shared config under `QueueConfigKey`. `@Optional()` so
    // a missing token surfaces as `undefined` we can throw on, instead of
    // Nest's opaque dependency-resolution error.
    @Optional() @Inject(SHARED_CONFIG_TOKEN) private readonly sharedConfig?: unknown,
  ) {}

  /**
   * Startup assertion: the shared BullMQ root connection must be registered
   * under the named token (not the default). A misconfigured `forRootAsync`
   * call (wrong `configKey`, missing import) would silently fall back to
   * default localhost:6379 — fail loud at boot instead.
   *
   * Also logs the sanitized Redis URL once at boot so deployment misconfig
   * (wrong host, missing credentials) is visible without leaking the password.
   */
  onModuleInit(): void {
    if (this.sharedConfig === undefined) {
      throw new Error(
        `QueueModule: BullMQ shared config not registered for "${QueueConfigKey}". ` +
          `Expected token "${SHARED_CONFIG_TOKEN}". ` +
          `Check that BullModule.forRootAsync was called with the matching configKey.`,
      )
    }

    this.logger.log(`Queue Redis: ${sanitizeRedisUrl(this.cfg.url)}`)
  }
}
