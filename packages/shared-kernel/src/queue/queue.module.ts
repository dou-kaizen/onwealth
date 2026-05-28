import { BullModule, getSharedConfigToken } from '@nestjs/bullmq'
import type { OnModuleInit } from '@nestjs/common'
import { Global, Inject, Logger, Module, Optional } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import type { RedisOptions } from 'bullmq'
import { sanitizeRedisUrl } from '../utils/sanitize-redis-url.js'
import { queueConfig } from './queue.config.js'
import { QueueConfigKey } from './queue.constant.js'

const SHARED_CONFIG_TOKEN = getSharedConfigToken(QueueConfigKey)

/**
 * Parse a Redis URL into the explicit field shape ioredis expects.
 *
 * BullMQ's `connection` accepts a `RedisOptions` object or a raw URL string —
 * NOT `{ url }` as a property. Passing `{ url }` silently falls back to
 * ioredis defaults (`localhost:6379`, no auth), masking misconfiguration.
 * Extracting host/port/auth/tls lets additional ioredis flags
 * (e.g. `maxRetriesPerRequest`) sit alongside the parsed connection.
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

/**
 * Build the BullMQ root connection options consumed by `BullModule.forRootAsync`.
 *
 * Two non-obvious settings:
 *
 * 1. **`maxRetriesPerRequest: null`** — required for the worker's blocking
 *    `BRPOP`. ioredis defaults retry-then-fail on blocking commands, which
 *    breaks long-poll workers. Producer-side cost: enqueues will not fail
 *    fast during a Redis outage. DO NOT remove during cleanup; see
 *    `plans/reports/code-review-260524-1703-codebase-scan.md` (C3).
 *
 * 2. **`defaultJobOptions.removeOnComplete / removeOnFail`** — bounded
 *    retention so the `completed` / `failed` Redis lists cannot grow without
 *    limit. Per-queue overrides via `BullModule.registerQueue({ defaultJobOptions })`
 *    or per-call `queue.add(name, data, opts)`.
 *
 * 3. **`defaultJobOptions.attempts / backoff`** — system-wide retry baseline.
 *    BullMQ defaults to `attempts: 1` (zero retries); a single transient Redis
 *    blip permanently fails an otherwise recoverable job. Exponential backoff:
 *    attempt 1 @ 1s, attempt 2 @ 2s, attempt 3 @ 4s. Per-queue producers may
 *    override via `BullModule.registerQueue({ defaultJobOptions })` or by
 *    passing `opts` to `queue.add()`. Non-retryable failures must throw
 *    {@link FatalQueueException} (extends `UnrecoverableError`) — BullMQ
 *    short-circuits remaining attempts.
 */
function buildBullRootOptions(cfg: ConfigType<typeof queueConfig>) {
  return {
    connection: {
      ...parseRedisUrl(cfg.url),
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  }
}

/**
 * Queue infrastructure module.
 *
 * Registers a single named BullMQ root connection under {@link QueueConfigKey}
 * (`'queue'`). Producers and workers share it.
 *
 * **Why a single shared connection (not split producer/worker):**
 * `@nestjs/bullmq`'s `BullExplorer.getQueueOptions` prefers a registered
 * Queue's `opts.connection` over the worker's `configKey` shared config. Any
 * split is silently defeated for queues registered via
 * `BullModule.registerQueue` — both sides end up on the producer's connection.
 * The unified key uses worker-safe ioredis settings (`maxRetriesPerRequest: null`)
 * so blocking `BRPOP` works; the trade-off is that enqueues will not fail
 * fast during a Redis outage.
 *
 * **Why concrete queue registration is absent here:** feature modules register
 * their own queues via `BullModule.registerQueue()`, importing this module to
 * inherit the root connection. `apps/api` does NOT import `QueueModule` until
 * a concrete queue is introduced.
 *
 * @example
 *   BullModule.registerQueue({
 *     configKey: QueueConfigKey,
 *     name: 'email-notification',
 *   })
 *
 * @see ./README.md — Quick Start, Gotchas, Production Checklist, DLQ migration.
 */
@Global() // @global-approved: BullMQ root connection, consumed by all feature queue modules
@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    BullModule.forRootAsync(QueueConfigKey, {
      imports: [ConfigModule.forFeature(queueConfig)],
      useFactory: buildBullRootOptions,
      inject: [queueConfig.KEY],
    }),
  ],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger(QueueModule.name)

  /**
   * @param cfg          Validated queue config (Redis URL).
   * @param sharedConfig Shared BullMQ root config injected via the named
   *                     token. Optional + `unknown` so a missing registration
   *                     surfaces as `undefined` for a typed assertion in
   *                     {@link onModuleInit}, instead of Nest's opaque
   *                     dependency-resolution error.
   */
  constructor(
    @Inject(queueConfig.KEY) private readonly cfg: ConfigType<typeof queueConfig>,
    @Optional() @Inject(SHARED_CONFIG_TOKEN) private readonly sharedConfig?: unknown,
  ) {}

  /**
   * Boot-time guard rails:
   *
   * 1. Asserts the shared BullMQ root connection was registered under
   *    {@link QueueConfigKey}. A misconfigured `forRootAsync` (wrong
   *    `configKey`, missing import) would silently fall back to ioredis
   *    defaults (`localhost:6379`); fail loud at boot instead.
   * 2. Logs the sanitized Redis URL once so deployment misconfig (wrong
   *    host, missing credentials) is visible without leaking the password.
   *
   * @throws Error if the shared config token resolves to `undefined`.
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
