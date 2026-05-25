import { UnrecoverableError } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { FatalQueueException, QueueException } from '../queue.exception.js'

describe('QueueException', () => {
  it('isFatal is false', () => {
    const error = new QueueException('job failed')
    expect(error.isFatal).toBe(false)
    expect(error.message).toBe('job failed')
    expect(error.name).toBe('QueueException')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(QueueException)
  })

  it('is NOT instanceof UnrecoverableError (retries allowed)', () => {
    const error = new QueueException('retryable')
    expect(error).not.toBeInstanceOf(UnrecoverableError)
  })

  // Compile-time regression guard: the deprecated 2-arg constructor must NOT come back.
  // If someone restores it, this @ts-expect-error stops compiling and the test fails.
  it('rejects the deprecated 2-arg constructor (compile-time guard)', () => {
    // @ts-expect-error — QueueException constructor takes one argument
    const error = new QueueException('msg', true)
    expect(error).toBeInstanceOf(QueueException)
  })
})

describe('FatalQueueException', () => {
  it('isFatal is true', () => {
    const error = new FatalQueueException('hard-stop')
    expect(error.isFatal).toBe(true)
    expect(error.message).toBe('hard-stop')
    expect(error.name).toBe('FatalQueueException')
  })

  it('is instanceof UnrecoverableError (BullMQ short-circuits retries)', () => {
    const error = new FatalQueueException('x')
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(error).toBeInstanceOf(Error)
  })
})
