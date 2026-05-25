import type { Job } from 'bullmq'
import { FatalQueueException } from './queue.exception.js'

/**
 * @internal
 *
 * Structured failure-log decision produced by {@link _evaluateJobFailure}.
 * Underscore + `.internal.ts` location signals NOT public API; tests import
 * from this path. Deep-importers via the package barrel will not see it.
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
 * branching is unit-testable without constructing a `WorkerHost` (which may
 * require a NestJS DI context). `onFailed` is a thin wrapper that forwards the
 * result to a `Logger`.
 *
 * Semantics:
 * - `attempts` clamped to ≥1 — defends against a misconfigured producer that
 *   sets `attempts: 0`, which would otherwise compute `attemptsRemaining: -1`.
 * - `errorName` reads `error.name` first (set by our exception constructors)
 *   then falls back to `error.constructor.name`. Minifiers may rename the
 *   class but JS preserves the assigned `name` string.
 * - Permanent-failure context excludes `error.message` to avoid leaking PII
 *   from job payloads into log aggregators; `errorName` + jobId is enough
 *   for incident triage.
 */
export function _evaluateJobFailure(job: Job, error: Error): JobFailureLog {
  const attempts = Math.max(job.opts.attempts ?? 1, 1)
  const isFatal = error instanceof FatalQueueException
  // A FatalQueueException short-circuits BullMQ's retry loop (it extends
  // UnrecoverableError), so the current attempt IS the last one regardless of
  // `attempts`. Without this OR, a fatal failure on attempt 1 of 5 would emit
  // the retry-level WARN and incident triage would miss the terminal signal.
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
