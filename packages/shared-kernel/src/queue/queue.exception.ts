/**
 * Domain exception for queue job failures.
 *
 * `isFatal` distinguishes transient errors (retry eligible) from fatal ones
 * (last-attempt logging / future dead-letter routing). Throw inside a
 * processor's `process()` method to propagate structured failure metadata.
 */
export class QueueException extends Error {
  readonly isFatal: boolean

  constructor(message: string, isFatal = false) {
    super(message)
    this.name = 'QueueException'
    this.isFatal = isFatal
  }
}
