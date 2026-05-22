import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { queueConfig } from './queue.config.js'
import { QueueConfigKey, QueueProcessorConfigKey } from './queue.constant.js'

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
      imports: [ConfigModule.forFeature(queueConfig)], // [Red Team C3] scopes queueConfig load to this module
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          url: cfg.url,
          maxRetriesPerRequest: null, // Required for BullMQ blocking commands
        },
      }),
      inject: [queueConfig.KEY],
    }),
    // Worker / processor connection (kept separate to isolate blocking commands)
    BullModule.forRootAsync(QueueProcessorConfigKey, {
      imports: [ConfigModule.forFeature(queueConfig)], // [Red Team C3] scopes queueConfig load to this module
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          url: cfg.url,
          maxRetriesPerRequest: null,
        },
      }),
      inject: [queueConfig.KEY],
    }),
  ],
})
export class QueueModule {}
