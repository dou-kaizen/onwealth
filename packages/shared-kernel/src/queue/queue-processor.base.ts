import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { stripPrototypePollutionKeys } from '../utils/strip-prototype-pollution-keys.js'
import type { QueueJobBaseData } from './queue-job-data.types.js'
import type { QueueJobResult } from './queue-job-result.type.js'
import { _evaluateJobFailure } from './queue-processor.base.internal.js'

/**
 * Abstract base class for all BullMQ job processors.
 *
 * Extend this class and decorate with `@QueueProcessor`. Implement
 * {@link handleJob} (NOT `process`) — `process` is the BullMQ entry point and
 * is owned by the base. It strips prototype-pollution keys from `job.data`
 * before delegating, so concrete processors never see `__proto__` / `constructor`
 * / `prototype` keys.
 *
 * Throw {@link FatalQueueException} for non-retryable failures (extends
 * BullMQ's `UnrecoverableError`, retries short-circuited); throw
 * {@link QueueException} for retryable failures.
 *
 * **Long-running jobs:** BullMQ holds a Redis lock per job (`WorkerOptions.lockDuration`,
 * default 30 000 ms). Use `AbortSignal.timeout(N)` inside {@link handleJob} to bound
 * work to the lock window — e.g. pass the signal to `fetch` / `axios`. Or raise
 * `lockDuration` via `@QueueProcessor(name, { lockDuration: 60_000 })`.
 */
export abstract class QueueProcessorBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name)

  /**
   * BullMQ-invoked entry point. Sealed to the base because BullMQ's `WorkerHost`
   * calls `process()` directly; concrete processors implement {@link handleJob}.
   *
   * Behavior:
   * 1. Recursively strips `__proto__` / `constructor` / `prototype` keys from
   *    `job.data` (mutates in place) so prototype-pollution payloads cannot
   *    chain into downstream object lookups.
   * 2. Delegates to {@link handleJob}.
   *
   * Concrete processors should STILL Zod-validate `job.data` before use —
   * sanitization is a defense-in-depth, not a schema check.
   */
  override async process(job: Job): Promise<QueueJobResult> {
    if (job.data && typeof job.data === 'object') {
      stripPrototypePollutionKeys(job.data)
    }
    return this.handleJob(job)
  }

  /**
   * Concrete processor entry point. Implement this — NOT `process`.
   *
   * @returns {@link QueueJobResult} describing the outcome
   * @throws {@link QueueException} for retryable failures
   * @throws {@link FatalQueueException} for non-retryable failures
   */
  protected abstract handleJob(job: Job): Promise<QueueJobResult>

  /**
   * Called by BullMQ after each failed attempt. Delegates the log decision
   * to `_evaluateJobFailure` then emits at the chosen level. `isFatal=true`
   * means the error was a {@link FatalQueueException} (or `QueueException`
   * with legacy fatal flag) — BullMQ treats it as non-retryable.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    const { level, message, context } = _evaluateJobFailure(job, error)
    const enriched = this.withCorrelationId(job, context)
    if (level === 'error') {
      this.logger.error(message, enriched)
    } else {
      this.logger.warn(message, enriched)
    }
  }

  /**
   * Called by BullMQ when a job completes successfully. Logs duration so
   * observability tooling can chart processing latency without instrumentation
   * at every concrete processor.
   */
  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    const duration =
      job.finishedOn !== undefined && job.processedOn !== undefined
        ? job.finishedOn - job.processedOn
        : undefined
    this.logger.debug(
      'Queue job completed',
      this.withCorrelationId(job, {
        jobId: job.id,
        queue: job.queueName,
        durationMs: duration,
      }),
    )
  }

  /**
   * Called by BullMQ when the worker detects a stalled job (lock not renewed
   * in time). Leading indicator of either oversize work or saturated workers
   * — warn level so it surfaces in alerts.
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn('Queue job stalled', { jobId })
  }

  /**
   * Called by BullMQ on worker-level errors (Redis connection drops, deserialize
   * failures). Distinct from `onFailed` — `onError` is infrastructure, `onFailed`
   * is application logic.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    const errorName = (error as { name?: string }).name ?? error.constructor.name
    this.logger.error('Queue worker error', { errorName, error: error.message })
  }

  /**
   * Merges `correlationId` from `job.data` into a log context when present.
   * Producers populate it from CLS — see {@link QueueJobBaseData}. Absent IDs
   * yield the unmodified context (no `correlationId: undefined` noise).
   */
  private withCorrelationId(job: Job, context: Record<string, unknown>): Record<string, unknown> {
    const data = job.data as QueueJobBaseData | null | undefined
    const correlationId = data?.correlationId
    return correlationId ? { ...context, correlationId } : context
  }
}
