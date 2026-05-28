import { Processor } from '@nestjs/bullmq'
import type { WorkerOptions } from 'bullmq'
import { QueueConfigKey } from './queue.constant.js'

/**
 * Subset of BullMQ's {@link WorkerOptions} accepted by {@link QueueProcessor}.
 *
 * `connection` is omitted on purpose — {@link QueueModule} owns the named
 * root connection and `@nestjs/bullmq` resolves it via `configKey`. Allowing
 * a per-processor `connection` override would silently bypass the shared
 * connection pool and break the production-hardened settings
 * (e.g. `maxRetriesPerRequest: null`).
 */
export type QueueProcessorOptions = Omit<WorkerOptions, 'connection'>

/**
 * Class decorator for BullMQ job processors.
 *
 * Wraps `@nestjs/bullmq`'s `@Processor` so every processor binds to the
 * shared root connection ({@link QueueConfigKey}). Consumers must NOT
 * read process.env or override `connection` here — that belongs to
 * {@link QueueModule}.
 *
 * **Long-running jobs:** the default BullMQ `lockDuration` is 30 000 ms.
 * Raise it via `@QueueProcessor(name, { lockDuration: 60_000 })` for jobs
 * that legitimately take longer than 30 s. For per-call timeouts inside
 * the handler body, prefer `AbortSignal.timeout(N)` on outbound IO — that
 * bounds the work to the lock window without changing the worker contract.
 *
 * **Rate-limited downstreams:** use `limiter: { max, duration }` to cap
 * pickup throughput when calling rate-limited external APIs (e.g. SendGrid,
 * Stripe). BullMQ throttles across all workers sharing the queue name; no
 * extra coordination needed.
 *
 * @param name    Kebab-case queue name (e.g. `'email-notification'`).
 * @param options {@link QueueProcessorOptions} — `lockDuration`, `concurrency`,
 *                `limiter`, `skipLockRenewal`, etc.
 *
 * @example
 *   // Basic processor — defaults to concurrency=1, lockDuration=30s.
 *   @QueueProcessor('email-notification', { concurrency: 5, lockDuration: 60_000 })
 *   export class EmailNotificationProcessor extends QueueProcessorBase { ... }
 *
 * @example
 *   // Rate-limited processor — max 100 jobs/sec across all workers on this queue.
 *   @QueueProcessor('email-notification', {
 *     concurrency: 5,
 *     limiter: { max: 100, duration: 1000 },
 *   })
 *   export class EmailNotificationProcessor extends QueueProcessorBase { ... }
 */
export function QueueProcessor(name: string, options?: QueueProcessorOptions): ClassDecorator {
  const processorOptions = { name, configKey: QueueConfigKey }
  return options
    ? Processor(processorOptions, options as WorkerOptions)
    : Processor(processorOptions)
}
