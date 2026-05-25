import { BullModule, getSharedConfigToken } from '@nestjs/bullmq'
import type { OnModuleInit } from '@nestjs/common'
import { Global, Inject, Logger, Module, Optional } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { sanitizeRedisUrl } from '../utils/sanitize-redis-url.js'
import { queueConfig } from './queue.config.js'
import { QueueConfigKey, QueueProcessorConfigKey } from './queue.constant.js'

const PRODUCER_CONFIG_TOKEN = getSharedConfigToken(QueueConfigKey)
const PROCESSOR_CONFIG_TOKEN = getSharedConfigToken(QueueProcessorConfigKey)

/**
 * Queue infrastructure module.
 *
 * Registers two named BullMQ root connections:
 *   - QueueConfigKey ('queue')           — producer side (enqueue)
 *   - QueueProcessorConfigKey ('queue-processor') — worker side (consume)
 *
 * Concrete queue registration is intentionally absent here.
 * Feature modules register their own queues via BullModule.registerQueue(),
 * importing this module to inherit the root connection:
 *
 * @example
 *   BullModule.registerQueue({ name: 'email-notification' })
 *
 * apps/api does NOT import QueueModule until a concrete queue is introduced.
 */
@Global() // @global-approved: BullMQ root connections, consumed by all feature queue modules
@Module({
  imports: [
    // Producer connection
    BullModule.forRootAsync(QueueConfigKey, {
      imports: [ConfigModule.forFeature(queueConfig)],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          url: cfg.url,
          // ioredis default (20 retries) — producer must fail fast on Redis outage to avoid HTTP handler hang.
          // DO NOT add maxRetriesPerRequest: null here; that is worker-only.
        },
      }),
      inject: [queueConfig.KEY],
    }),
    // Worker / processor connection (kept separate to isolate blocking commands)
    BullModule.forRootAsync(QueueProcessorConfigKey, {
      imports: [ConfigModule.forFeature(queueConfig)],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          url: cfg.url,
          // null required for worker BRPOP: ioredis must not fail-fast on blocking commands.
          // DO NOT remove during "cleanup" — see plans/reports/code-review-260524-1703-codebase-scan.md C3.
          maxRetriesPerRequest: null,
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
    // The shared-config tokens are produced by `getSharedConfigToken(configKey)`
    // (see `@nestjs/bullmq` 11.0.4 — `BULLMQ_CONFIG(${configKey})`). We inject
    // them only to fail fast at startup if BullModule.forRootAsync did NOT
    // register them under the named key (e.g. wrong configKey, missing import).
    // `@Optional()` so a missing token produces `undefined` we can throw on,
    // instead of Nest's opaque dependency-resolution error.
    @Optional() @Inject(PRODUCER_CONFIG_TOKEN) private readonly producerConfig?: unknown,
    @Optional() @Inject(PROCESSOR_CONFIG_TOKEN) private readonly processorConfig?: unknown,
  ) {}

  /**
   * Startup assertion: verify both named BullMQ root connections registered
   * under their named tokens — NOT the default token. A misconfigured
   * `forRootAsync` call (or a missing `configKey`) would silently fall back to
   * the default connection and break the producer/worker isolation.
   *
   * Also logs the sanitized Redis URL once at boot so deployment misconfig
   * (wrong host, missing credentials) is visible without leaking the password.
   */
  onModuleInit(): void {
    const missing: string[] = []
    if (this.producerConfig === undefined) missing.push(QueueConfigKey)
    if (this.processorConfig === undefined) missing.push(QueueProcessorConfigKey)
    if (missing.length > 0) {
      throw new Error(
        `QueueModule: BullMQ shared config not registered for [${missing.join(', ')}]. ` +
          `Expected tokens "${PRODUCER_CONFIG_TOKEN}" and "${PROCESSOR_CONFIG_TOKEN}". ` +
          `Check that BullModule.forRootAsync was called with the matching configKey.`,
      )
    }

    this.logger.log(`Queue Redis: ${sanitizeRedisUrl(this.cfg.url)}`)
  }
}
