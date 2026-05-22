import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { QueueException } from './queue.exception.js'
import type { QueueJobResult } from './queue-job-result.type.js'

/**
 * Structured failure-log decision produced by {@link evaluateJobFailure}.
 */
export interface JobFailureLog {
  level: 'error' | 'warn'
  message: string
  context: Record<string, unknown>
}

/**
 * Pure decision function for job-failure logging.
 *
 * Extracted from {@link QueueProcessorBase.onFailed} [Validation Q1] so the
 * last-attempt / retry branching is unit-testable without constructing a
 * `WorkerHost` (which may require a NestJS DI context). `onFailed` is a thin
 * wrapper that forwards the result to a `Logger`.
 */
export function evaluateJobFailure(job: Job, error: Error): JobFailureLog {
  const attempts = job.opts.attempts ?? 1
  const isLastAttempt = job.attemptsMade >= attempts - 1
  const isFatal = error instanceof QueueException ? error.isFatal : false

  if (isLastAttempt) {
    return {
      level: 'error',
      message: 'Queue job failed permanently',
      context: {
        jobId: job.id,
        queue: job.queueName,
        attemptsMade: job.attemptsMade,
        isFatal,
        errorName: error.constructor.name,
        // NOTE: error.message may carry PII (job payload values). Keep the
        // logger redaction config (logger/redaction) in sync if payloads grow.
        error: error.message,
      },
    }
  }

  return {
    level: 'warn',
    message: 'Queue job attempt failed, will retry',
    context: {
      jobId: job.id,
      queue: job.queueName,
      attemptsMade: job.attemptsMade,
      attemptsRemaining: attempts - 1 - job.attemptsMade,
    },
  }
}

/**
 * Abstract base class for all BullMQ job processors.
 *
 * Extend this class and decorate with {@link QueueProcessor} to create a
 * concrete processor. Implement {@link process} to define job handling logic.
 * Throw {@link QueueException} with `isFatal=true` for non-retryable failures.
 */
export abstract class QueueProcessorBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name)

  /**
   * Called by BullMQ on job failure (after each attempt).
   *
   * Thin wrapper: delegates the log decision to {@link evaluateJobFailure},
   * then emits at the chosen level. On the last attempt the decision upgrades
   * to error level with an `isFatal` flag so observability tooling can route
   * dead-letter alerts without a hard Sentry dependency.
   *
   * The `@OnWorkerEvent('failed')` decorator is REQUIRED — see note below.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    const { level, message, context } = evaluateJobFailure(job, error)
    if (level === 'error') {
      this.logger.error(message, context)
    } else {
      this.logger.warn(message, context)
    }
  }

  /**
   * Process a single job. Must be implemented by concrete processors.
   *
   * Re-declared with `override` because `WorkerHost` already declares an
   * abstract `process`; this narrows the return type to {@link QueueJobResult}.
   *
   * @returns {@link QueueJobResult} describing the outcome
   * @throws {@link QueueException} for structured, observable failures
   */
  abstract override process(job: Job): Promise<QueueJobResult>
}
