import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { QueueException } from '../queue.exception.js'
import { evaluateJobFailure } from '../queue-processor.base.js'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    queueName: 'test-queue',
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job
}

describe('evaluateJobFailure', () => {
  it('returns warn level on a non-last attempt', () => {
    const result = evaluateJobFailure(
      makeJob({ attemptsMade: 0, opts: { attempts: 3 } }),
      new Error('transient'),
    )
    expect(result.level).toBe('warn')
    expect(result.context.attemptsRemaining).toBe(2)
  })

  it('returns error level on the last attempt', () => {
    const result = evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new Error('final'),
    )
    expect(result.level).toBe('error')
    expect(result.message).toBe('Queue job failed permanently')
  })

  it('sets isFatal=true for QueueException(isFatal=true) on the last attempt', () => {
    const result = evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new QueueException('fatal', true),
    )
    expect(result.context.isFatal).toBe(true)
  })

  it('sets isFatal=false for a plain Error on the last attempt', () => {
    const result = evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new Error('plain'),
    )
    expect(result.context.isFatal).toBe(false)
  })

  it('includes errorName from the error constructor', () => {
    const result = evaluateJobFailure(
      makeJob({ attemptsMade: 2, opts: { attempts: 3 } }),
      new QueueException('x', true),
    )
    expect(result.context.errorName).toBe('QueueException')
  })

  it('defaults attempts to 1 when job.opts.attempts is undefined', () => {
    // attemptsMade=0, attempts defaults to 1 → last attempt → error level
    const result = evaluateJobFailure(makeJob({ attemptsMade: 0, opts: {} }), new Error('e'))
    expect(result.level).toBe('error')
  })
})
