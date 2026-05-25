import { UnrecoverableError } from 'bullmq'

/**
 * Soft, retryable queue processor error.
 *
 * Throw from a `QueueProcessorBase.handleJob` implementation when a transient
 * condition (network blip, lock contention, downstream 5xx) caused the
 * failure. BullMQ will retry per the worker's `attempts` + `backoff` config.
 *
 * For non-retryable failures, throw {@link FatalQueueException} — that class
 * extends BullMQ's `UnrecoverableError` and short-circuits remaining retries.
 *
 * The literal `isFatal = false` discriminant lets call sites that intercept
 * errors before they reach `_evaluateJobFailure` (e.g. cross-cutting logging
 * decorators) classify without an `instanceof` chain.
 */
export class QueueException extends Error {
  readonly isFatal = false as const

  constructor(message: string) {
    super(message)
    this.name = 'QueueException'
  }
}

/**
 * Hard, non-retryable queue processor error.
 *
 * Extends BullMQ's `UnrecoverableError`: throwing this from a
 * `QueueProcessorBase.handleJob` implementation makes BullMQ skip remaining
 * retry attempts and move the job straight to `failed`. Use for irrecoverable
 * conditions: validation rejections, missing referenced rows, permission
 * errors — anything where a retry will produce the same failure.
 *
 * `_evaluateJobFailure` keys off `instanceof FatalQueueException` to flag
 * `isFatal: true` in the log context regardless of `attemptsMade`, so
 * incident triage sees the terminal signal on attempt 1.
 */
export class FatalQueueException extends UnrecoverableError {
  readonly isFatal = true as const

  constructor(message: string) {
    super(message)
    this.name = 'FatalQueueException'
  }
}
