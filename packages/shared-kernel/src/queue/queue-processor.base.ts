import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq'
import type { OnModuleDestroy } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { stripPrototypePollutionKeys } from '../utils/strip-prototype-pollution-keys.js'
import type { QueueJobBaseData } from './queue-job-data.types.js'
import type { QueueJobResult } from './queue-job-result.type.js'
import { _evaluateJobFailure } from './queue-processor.base.internal.js'

/**
 * Bounded drain window for SIGTERM-triggered worker close.
 *
 * Mirrors the `SHUTDOWN_GRACE_MS` constant in `apps/api/src/main.ts` so a
 * hung handler cannot exceed the process-level hard-stop budget. If
 * `main.ts` changes, update this in lockstep (or extract to a shared
 * constant).
 */
const QUEUE_DRAIN_TIMEOUT_MS = 5000

/**
 * Abstract base for all BullMQ job processors.
 *
 * Extend this class and decorate with `@QueueProcessor`. Implement
 * {@link handleJob} — NOT `process`. `process` is the BullMQ entry point and
 * is owned by the base so it can strip prototype-pollution keys from
 * `job.data` before delegating, and so failure / completion / stalled hooks
 * can be wired uniformly across every processor in the system.
 *
 * **Failure semantics:**
 * - Throw {@link FatalQueueException} for non-retryable failures (extends
 *   BullMQ's `UnrecoverableError`; retries are short-circuited).
 * - Throw {@link QueueException} or a plain `Error` for retryable failures
 *   (BullMQ retries per the worker's `attempts` setting).
 *
 * **Long-running jobs:** BullMQ holds a Redis lock per job
 * (`WorkerOptions.lockDuration`, default 30 000 ms). Either bound the work
 * with `AbortSignal.timeout(N)` inside {@link handleJob} (preferred — pass
 * the signal to `fetch` / `axios` / DB clients) or raise `lockDuration`
 * via `@QueueProcessor(name, { lockDuration: 60_000 })`.
 *
 * @see ./README.md — Quick Start, Gotchas, Production Checklist, DLQ migration.
 */
export abstract class QueueProcessorBase extends WorkerHost implements OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name)

  /**
   * Graceful drain on Nest shutdown (SIGTERM).
   *
   * Races `worker.close(false)` against {@link QUEUE_DRAIN_TIMEOUT_MS}. The
   * `false` argument lets BullMQ await the in-flight job via
   * `whenCurrentJobsFinished` before disconnecting Redis. The timeout path
   * logs the loss and lets Nest tear down anyway — a hung handler must not
   * block process exit.
   *
   * **CRITICAL — `Worker.close(force)` semantics are INVERTED from intuition.**
   * `close(false)` (the default) WAITS for in-flight jobs to finish;
   * `close(true)` SKIPS the wait and returns immediately. We pass `false`
   * here so a graceful SIGTERM does not drop the active job mid-handler.
   */
  async onModuleDestroy(): Promise<void> {
    const name = this.worker?.name ?? 'unknown'
    const startedAt = Date.now()
    this.logger.log('queue draining', { worker: name })
    try {
      await Promise.race([
        this.worker.close(false),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('queue drain timeout')), QUEUE_DRAIN_TIMEOUT_MS),
        ),
      ])
      this.logger.log('queue drained', {
        worker: name,
        durationMs: Date.now() - startedAt,
      })
    } catch (err) {
      this.logger.error('queue drain timeout — force closing', {
        worker: name,
        graceMs: QUEUE_DRAIN_TIMEOUT_MS,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * BullMQ-invoked entry point. Sealed to the base — BullMQ's `WorkerHost`
   * calls `process()` directly, and concrete processors implement
   * {@link handleJob} instead.
   *
   * Recursively strips `__proto__` / `constructor` / `prototype` keys from
   * `job.data` (mutating in place) so prototype-pollution payloads cannot
   * chain into downstream object lookups, then delegates to
   * {@link handleJob}.
   *
   * Concrete processors should STILL Zod-validate `job.data` before use —
   * sanitization is defense-in-depth, not a schema check.
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
   * @returns {@link QueueJobResult} describing the outcome.
   * @throws {@link QueueException} for retryable failures.
   * @throws {@link FatalQueueException} for non-retryable failures (BullMQ
   *         short-circuits remaining retries via `UnrecoverableError`).
   */
  protected abstract handleJob(job: Job): Promise<QueueJobResult>

  /**
   * BullMQ `failed` event hook.
   *
   * Delegates the log-level decision to
   * {@link _evaluateJobFailure} (pure function — unit-testable without a
   * worker), enriches with `correlationId` from `job.data`, then emits at
   * the chosen level. `isFatal=true` in the context means the error was a
   * {@link FatalQueueException}.
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
   * BullMQ `completed` event hook.
   *
   * Logs handler duration so observability tooling can chart processing
   * latency without instrumentation at every concrete processor.
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
   * BullMQ `stalled` event hook.
   *
   * Fired when the worker fails to renew the job lock in time (handler ran
   * longer than `lockDuration`, or LockManager was disabled). Leading
   * indicator of oversize work or saturated workers — `warn` level so it
   * surfaces in alerts.
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn('Queue job stalled', { jobId })
  }

  /**
   * BullMQ `error` event hook.
   *
   * Distinct from {@link onFailed}: `error` is infrastructure (Redis
   * connection drops, deserialize failures), `failed` is application logic.
   * Reads `error.name` first so a minified `error.constructor.name` does
   * not obscure the original class.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    const errorName = (error as { name?: string }).name ?? error.constructor.name
    this.logger.error('Queue worker error', { errorName, error: error.message })
  }

  /**
   * Merge `correlationId` from `job.data` into a log context when present.
   *
   * Producers populate `correlationId` from CLS at enqueue time — see
   * {@link QueueJobBaseData}. Absent IDs yield the unmodified context so
   * logs do not carry `correlationId: undefined` noise.
   */
  private withCorrelationId(job: Job, context: Record<string, unknown>): Record<string, unknown> {
    const data = job.data as QueueJobBaseData | null | undefined
    const correlationId = data?.correlationId
    return correlationId ? { ...context, correlationId } : context
  }
}
