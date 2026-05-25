import { UnrecoverableError } from 'bullmq'

/**
 * Soft, retryable queue processor error.
 *
 * BullMQ will retry per the worker backoff config. Throw from `process()` when
 * a transient condition (network blip, lock contention) caused the failure.
 *
 * For non-retryable failures, throw {@link FatalQueueException} — that class
 * extends BullMQ's `UnrecoverableError` and short-circuits retries.
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
 * Extends BullMQ's `UnrecoverableError`: throwing this from `process()` makes
 * BullMQ skip remaining retry attempts and move the job to `failed` immediately.
 */
export class FatalQueueException extends UnrecoverableError {
  readonly isFatal = true as const

  constructor(message: string) {
    super(message)
    this.name = 'FatalQueueException'
  }
}
