import { Processor } from '@nestjs/bullmq'
import type { WorkerOptions } from 'bullmq'
import { QueueConfigKey } from './queue.constant.js'

/**
 * Subset of {@link WorkerOptions} that callers may set on `@QueueProcessor`.
 *
 * `connection` is intentionally omitted — `QueueModule` owns the named root
 * connection and BullMQ pulls it via `configKey`. Allowing a per-processor
 * `connection` override would silently bypass the shared connection pool.
 */
export type QueueProcessorOptions = Omit<WorkerOptions, 'connection'>

/**
 * Decorator for BullMQ job processors.
 *
 * Wraps `@nestjs/bullmq`'s `@Processor` with the shared processor connection
 * key. Consumer naming (connectionName, prefix) is owned by {@link QueueModule}
 * — NOT read from process.env here.
 *
 * `lockDuration` (and the rest of {@link QueueProcessorOptions}) flow through
 * verbatim. Default `lockDuration` is BullMQ's 30 000 ms; raise it for jobs
 * that legitimately take longer than 30 s. For per-call timeouts inside the
 * processor body, use `AbortSignal.timeout(N)` on outbound IO — that bounds
 * the work to the lock window without changing the worker contract.
 *
 * Use `limiter: { max, duration }` to cap throughput when calling rate-limited
 * external APIs (e.g. SendGrid, Stripe). BullMQ throttles job pickup across all
 * workers sharing the queue name — no extra coordination needed.
 *
 * @param name - Kebab-case queue name (e.g. 'email-notification')
 * @param options - {@link QueueProcessorOptions}: `lockDuration`, `concurrency`, `limiter`, etc.
 *
 * @example
 *   // Basic processor — defaults to concurrency=1, lockDuration=30s.
 *   @QueueProcessor('email-notification', { concurrency: 5, lockDuration: 60_000 })
 *   export class EmailNotificationProcessor extends QueueProcessorBase { ... }
 *
 * @example
 *   // Rate-limited processor — max 100 jobs per second across all workers on this queue.
 *   @QueueProcessor('email-notification', {
 *     concurrency: 5,
 *     limiter: { max: 100, duration: 1000 },
 *   })
 *   export class EmailNotificationProcessor extends QueueProcessorBase { ... }
 */
export function QueueProcessor(name: string, options?: QueueProcessorOptions): ClassDecorator {
  // Dispatch to the single-arg `@Processor` overload when no options are given:
  // BullMQ's `WorkerOptions` requires `connection`, so a `{}` default would not
  // typecheck. The module owns the connection — the decorator never sets it.
  const processorOptions = { name, configKey: QueueConfigKey }
  return options
    ? Processor(processorOptions, options as WorkerOptions)
    : Processor(processorOptions)
}
