import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueJobResult } from '../queue-job-result.type.js'
import { QueueProcessorBase } from '../queue-processor.base.js'

class TestProcessor extends QueueProcessorBase {
  override async handleJob(_job: Job): Promise<QueueJobResult> {
    return { message: 'ok' }
  }
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    queueName: 'test-queue',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {},
    ...overrides,
  } as unknown as Job
}

describe('QueueProcessorBase events', () => {
  let processor: TestProcessor
  let debugSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    processor = new TestProcessor()
    // The base-class `logger` is `protected`; reach in via cast for test
    // observation. Vitest needs a real reference to spy on, not a copy.
    const loggerRef = (processor as unknown as { logger: Logger }).logger
    debugSpy = vi.spyOn(loggerRef, 'debug').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(loggerRef, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(loggerRef, 'error').mockImplementation(() => undefined)
  })

  it('onCompleted logs duration when both timestamps are present', () => {
    const job = makeJob({ processedOn: 1000, finishedOn: 1500 })
    processor.onCompleted(job)
    expect(debugSpy).toHaveBeenCalledWith(
      'Queue job completed',
      expect.objectContaining({ jobId: 'job-1', queue: 'test-queue', durationMs: 500 }),
    )
  })

  it('onCompleted logs undefined duration when timestamps are missing', () => {
    processor.onCompleted(makeJob())
    expect(debugSpy).toHaveBeenCalledWith(
      'Queue job completed',
      expect.objectContaining({ durationMs: undefined }),
    )
  })

  it('onStalled emits warn with jobId', () => {
    processor.onStalled('stalled-1')
    expect(warnSpy).toHaveBeenCalledWith('Queue job stalled', { jobId: 'stalled-1' })
  })

  it('onError logs the error name and message', () => {
    processor.onError(new Error('redis disconnected'))
    expect(errorSpy).toHaveBeenCalledWith(
      'Queue worker error',
      expect.objectContaining({ errorName: 'Error', error: 'redis disconnected' }),
    )
  })

  it('propagates correlationId from job.data into onFailed log context', () => {
    const job = makeJob({
      attemptsMade: 2,
      opts: { attempts: 3 },
      data: { correlationId: 'corr-xyz' },
    })
    processor.onFailed(job, new Error('boom'))
    expect(errorSpy).toHaveBeenCalledWith(
      'Queue job failed permanently',
      expect.objectContaining({ correlationId: 'corr-xyz' }),
    )
  })

  it('propagates correlationId into onCompleted log context', () => {
    const job = makeJob({
      processedOn: 0,
      finishedOn: 10,
      data: { correlationId: 'corr-abc' },
    })
    processor.onCompleted(job)
    expect(debugSpy).toHaveBeenCalledWith(
      'Queue job completed',
      expect.objectContaining({ correlationId: 'corr-abc' }),
    )
  })

  it('omits correlationId from context when absent (no noise)', () => {
    const job = makeJob({ attemptsMade: 0, opts: { attempts: 3 } })
    processor.onFailed(job, new Error('mid-retry'))
    const calledWith = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>
    expect(calledWith).not.toHaveProperty('correlationId')
  })
})
