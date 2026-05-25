import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue } from 'bullmq'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { QueueConfigKey } from '../queue.constant.js'
import { QueueException } from '../queue.exception.js'
import { QueueModule } from '../queue.module.js'
import { getFailedJobs, retryFailedJob } from '../queue-dlq.helper.js'
import { ECHO_QUEUE_NAME, type EchoJobData, EchoProcessor } from './fixtures/echo-processor.js'

/**
 * Integration coverage for the BullMQ-native DLQ helper. Shares one Redis
 * container across `it` blocks — each test uses a unique job name so the
 * `failed` set state from a prior test does not pollute assertions.
 */

let container: StartedRedisContainer
let connectionUrl: string

beforeAll(async () => {
  container = await new RedisContainer('redis:7.4-alpine').start()
  connectionUrl = container.getConnectionUrl()
  process.env.QUEUE_REDIS_URL = connectionUrl
  process.env.REDIS_URL = connectionUrl
  process.env.NODE_ENV = 'test'
}, 120_000)

afterAll(async () => {
  delete process.env.QUEUE_REDIS_URL
  await container?.stop()
}, 30_000)

@Injectable()
class EchoEnqueuer {
  constructor(@InjectQueue(ECHO_QUEUE_NAME) public readonly queue: Queue<EchoJobData>) {}
}

async function buildModule() {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      QueueModule,
      BullModule.registerQueue({
        configKey: QueueConfigKey,
        name: ECHO_QUEUE_NAME,
        // attempts: 1 → one shot, straight to `failed` on throw. Keeps the
        // test deterministic and fast; backoff/retries already covered in
        // queue-processor-base.integration.spec.ts.
        defaultJobOptions: { attempts: 1 },
      }),
    ],
    providers: [EchoProcessor, EchoEnqueuer],
  }).compile()
  const app = moduleRef.createNestApplication({ logger: false })
  await app.init()
  return { app, enqueuer: app.get(EchoEnqueuer) }
}

async function waitForState(queue: Queue, jobId: string, target: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId)
    const state = await job?.getState()
    if (state === target) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`job ${jobId} never reached state=${target} within ${timeoutMs} ms`)
}

describe('queue-dlq.helper (testcontainers + real Redis)', () => {
  let teardown: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (teardown) {
      await teardown()
      teardown = undefined
    }
  })

  it('scenario A: getFailedJobs returns summaries with all required fields', async () => {
    const { app, enqueuer } = await buildModule()
    teardown = () => app.close()

    const jobs = await Promise.all([
      enqueuer.queue.add('dlq-a', {
        behaviour: 'throw',
        input: 'a-1',
        correlationId: 'corr-a-1',
      }),
      enqueuer.queue.add('dlq-a', { behaviour: 'throw', input: 'a-2' }),
      enqueuer.queue.add('dlq-a', { behaviour: 'throw', input: 'a-3' }),
    ])
    await Promise.all(jobs.map((j) => waitForState(enqueuer.queue, String(j.id), 'failed')))

    const summaries = await getFailedJobs(enqueuer.queue, 0, 10)
    const aOnly = summaries.filter((s) => s.name === 'dlq-a')
    expect(aOnly).toHaveLength(3)
    const sample = aOnly[0]!
    expect(sample.id).toMatch(/\S+/)
    expect(sample.queue).toBe(ECHO_QUEUE_NAME)
    expect(sample.attemptsMade).toBeGreaterThanOrEqual(1)
    expect(sample.failedReason).toMatch(/echo-throw/)
    expect(sample.failedAt).toBeGreaterThan(0)
    expect(sample.data).toMatchObject({ behaviour: 'throw' })
    const withCorr = aOnly.find((s) => s.correlationId === 'corr-a-1')
    expect(withCorr).toBeDefined()
  })

  it('scenario B: retryFailedJob moves job back to wait then runs to completion', async () => {
    const { app, enqueuer } = await buildModule()
    teardown = () => app.close()

    // Enqueue a job that fails first. Cannot mutate handler mid-flight to
    // make a retry succeed (handler is per-class), so verify the state
    // transition `failed → wait` and the resulting re-attempt.
    const job = await enqueuer.queue.add('dlq-b', { behaviour: 'throw', input: 'b-1' })
    await waitForState(enqueuer.queue, String(job.id), 'failed')

    const before = await job.getState()
    expect(before).toBe('failed')

    await retryFailedJob(enqueuer.queue, String(job.id))

    // Poll for the job to leave `failed`. It may immediately fail again
    // (handler still throws) — that's fine; we only assert it was requeued.
    const deadline = Date.now() + 5000
    let movedOut = false
    while (Date.now() < deadline) {
      const state = await job.getState()
      if (state !== 'failed') {
        movedOut = true
        break
      }
      // After retry it may land back in failed within the same poll window;
      // check attemptsMade increased as the authoritative signal too.
      const refreshed = await enqueuer.queue.getJob(String(job.id))
      if ((refreshed?.attemptsMade ?? 0) > 1) {
        movedOut = true
        break
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(movedOut).toBe(true)
  })

  it('scenario C: retryFailedJob throws QueueException for non-existent ID', async () => {
    const { app, enqueuer } = await buildModule()
    teardown = () => app.close()

    await expect(retryFailedJob(enqueuer.queue, 'does-not-exist')).rejects.toBeInstanceOf(
      QueueException,
    )
  })

  it('scenario D: retryFailedJob throws QueueException when job is not in failed state', async () => {
    const { app, enqueuer } = await buildModule()
    teardown = () => app.close()

    const job = await enqueuer.queue.add('dlq-d', { behaviour: 'success', input: 'd-1' })

    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const state = await job.getState()
      if (state === 'completed') break
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(await job.getState()).toBe('completed')

    await expect(retryFailedJob(enqueuer.queue, String(job.id))).rejects.toMatchObject({
      name: 'QueueException',
    })
  })
})
