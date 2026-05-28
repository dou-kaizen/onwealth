import type { Job } from 'bullmq'
import { FatalQueueException } from './queue.exception.js'

/**
 * @internal
 *
 * Structured failure-log decision produced by {@link _evaluateJobFailure}.
 *
 * The leading underscore + `.internal.ts` location signal NOT public API.
 * Tests import from this path directly; deep-importers via the package
 * barrel do not see it.
 */
export interface JobFailureLog {
  level: 'error' | 'warn'
  message: string
  context: Record<string, unknown>
}

/**
 * @internal
 *
 * Pure decision function for job-failure logging.
 *
 * Extracted from `QueueProcessorBase.onFailed` so the last-attempt / retry
 * branching is unit-testable without constructing a `WorkerHost` (which
 * requires a NestJS DI context). `onFailed` is a thin wrapper that forwards
 * the result to a `Logger`.
 *
 * **Semantics:**
 * - `attempts` is clamped to `≥1` to defend against a misconfigured producer
 *   that sets `attempts: 0`, which would otherwise compute
 *   `attemptsRemaining: -1` on the retry branch.
 * - `isLastAttempt` is `true` whenever the error is a
 *   {@link FatalQueueException}, regardless of `attempts`. Fatal extends
 *   BullMQ's `UnrecoverableError` and short-circuits retries — the current
 *   attempt IS the last. Without this OR, a fatal failure on attempt 1 of 5
 *   would emit the retry-level `warn` and incident triage would miss the
 *   terminal signal.
 * - `errorName` reads `error.name` first (set by our exception constructors)
 *   then falls back to `error.constructor.name`. Minifiers may rename the
 *   class but JS preserves the assigned `name` string.
 * - Permanent-failure context excludes `error.message` to avoid leaking PII
 *   from job payloads into log aggregators. `errorName` + `jobId` is enough
 *   for incident triage.
 *
 * @returns A {@link JobFailureLog} the caller pipes to `Logger.error` /
 *          `Logger.warn` per `level`.
 */
export function _evaluateJobFailure(job: Job, error: Error): JobFailureLog {
  const attempts = Math.max(job.opts.attempts ?? 1, 1)
  const isFatal = error instanceof FatalQueueException
  const isLastAttempt = isFatal || job.attemptsMade >= attempts - 1
  const errorName = (error as { name?: string }).name ?? error.constructor.name

  if (isLastAttempt) {
    return {
      level: 'error',
      message: 'Queue job failed permanently',
      context: {
        jobId: job.id,
        queue: job.queueName,
        attemptsMade: job.attemptsMade,
        isFatal,
        errorName,
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
