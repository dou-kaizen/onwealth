import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { FatalQueueException, QueueException } from '../queue.exception.js'
import { _evaluateJobFailure } from '../queue-processor.base.internal.js'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    queueName: 'test-queue',
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job
}

describe('_evaluateJobFailure', () => {
  it('returns warn level on a non-last attempt', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 0, opts: { attempts: 3 } }),
      new Error('transient'),
    )
    expect(result.level).toBe('warn')
    expect(result.context.attemptsRemaining).toBe(2)
  })

  it('returns error level on the last attempt', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new Error('final'),
    )
    expect(result.level).toBe('error')
    expect(result.message).toBe('Queue job failed permanently')
  })

  it('sets isFatal=true for FatalQueueException on the last attempt', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new FatalQueueException('fatal'),
    )
    expect(result.context.isFatal).toBe(true)
  })

  it('treats FatalQueueException as terminal even on non-last attempt (UnrecoverableError short-circuit)', () => {
    // BullMQ wraps UnrecoverableError → no further retries, so attemptsMade=1 of 5
    // is effectively the last attempt. Without isFatal in isLastAttempt, this would
    // log the WARN retry-level branch and incident triage would miss the terminal.
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 1, opts: { attempts: 5 } }),
      new FatalQueueException('hard-stop'),
    )
    expect(result.level).toBe('error')
    expect(result.message).toBe('Queue job failed permanently')
    expect(result.context.isFatal).toBe(true)
    expect(result.context.attemptsMade).toBe(1)
  })

  it('sets isFatal=false for a soft QueueException on the last attempt', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new QueueException('soft'),
    )
    expect(result.context.isFatal).toBe(false)
  })

  it('sets isFatal=false for a plain Error on the last attempt', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new Error('plain'),
    )
    expect(result.context.isFatal).toBe(false)
  })

  it('reads errorName from error.name (minifier-safe)', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new FatalQueueException('x'),
    )
    expect(result.context.errorName).toBe('FatalQueueException')
  })

  it('falls back to constructor.name when error.name is missing', () => {
    class Anonymous extends Error {}
    const err = new Anonymous('boom')
    // Force-clear .name so the fallback path is exercised.
    Object.defineProperty(err, 'name', { value: undefined })
    const result = _evaluateJobFailure(makeJob({ attemptsMade: 2, opts: { attempts: 3 } }), err)
    expect(result.context.errorName).toBe('Anonymous')
  })

  it('does NOT include error.message in permanent-failure context (M2 PII guard)', () => {
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new Error('secret-payload-value@example.com'),
    )
    expect(result.context).not.toHaveProperty('error')
  })

  it('defaults attempts to 1 when job.opts.attempts is undefined', () => {
    const result = _evaluateJobFailure(makeJob({ attemptsMade: 0, opts: {} }), new Error('e'))
    expect(result.level).toBe('error')
  })

  it('clamps attempts to ≥1 when producer sets attempts: 0 (M4 guard)', () => {
    // Without the Math.max guard, attempts=0 would produce attemptsRemaining=-1
    // on a retry-branch read. With the guard, the math behaves as if attempts=1
    // (single attempt → always last attempt → error level).
    const result = _evaluateJobFailure(
      makeJob({ attemptsMade: 0, opts: { attempts: 0 } }),
      new Error('e'),
    )
    expect(result.level).toBe('error')
  })
})
