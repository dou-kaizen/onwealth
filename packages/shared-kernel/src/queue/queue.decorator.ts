import { Processor } from '@nestjs/bullmq'
import type { WorkerOptions } from 'bullmq'
import { QueueProcessorConfigKey } from './queue.constant.js'

/**
 * Decorator for BullMQ job processors.
 *
 * Wraps `@nestjs/bullmq`'s `@Processor` with the shared processor connection
 * key. Consumer naming (connectionName, prefix) is owned by {@link QueueModule}
 * — NOT read from process.env here (fix over source anti-pattern).
 *
 * @param name - Kebab-case queue name string literal (e.g. 'email-notification')
 * @param options - Optional BullMQ WorkerOptions (concurrency, limiter, etc.)
 *
 * @example
 *   @QueueProcessor('email-notification', { concurrency: 5 })
 *   export class EmailNotificationProcessor extends QueueProcessorBase { ... }
 */
export function QueueProcessor(name: string, options?: WorkerOptions): ClassDecorator {
  // Dispatch to the single-arg `@Processor` overload when no options are given:
  // BullMQ's `WorkerOptions` requires `connection`, so a `{}` default would not
  // typecheck. The module owns the connection — the decorator never sets it.
  const processorOptions = { name, configKey: QueueProcessorConfigKey }
  return options ? Processor(processorOptions, options) : Processor(processorOptions)
}
