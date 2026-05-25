import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue } from 'bullmq'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { QueueConfigKey } from '../queue.constant.js'
import { QueueModule } from '../queue.module.js'
import {
  ECHO_QUEUE_NAME,
  ECHO_STALLED_QUEUE_NAME,
  type EchoJobData,
  EchoProcessor,
  EchoStalledProcessor,
} from './fixtures/echo-processor.js'

/**
 * End-to-end lifecycle validation of {@link QueueProcessorBase} against a real
 * containerized Redis. Unit tests cover pure-function classification; only this
 * suite exercises BullMQ Worker hooks (onCompleted / onFailed / onStalled /
 * onModuleDestroy).
 *
 * Container lifetime: one Redis per `describe` block (cheap reuse across `it`).
 * Queue name: shared per describe; jobs disambiguated by `name` + payload.
 */

let container: StartedRedisContainer
let connectionUrl: string

beforeAll(async () => {
  container = await new RedisContainer('redis:7.4-alpine').start()
  connectionUrl = container.getConnectionUrl()
  // queue.config.ts reads QUEUE_REDIS_URL with REDIS_URL fallback — set both so
  // the test does not depend on .env settings on the developer host.
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

@Injectable()
class EchoStalledEnqueuer {
  constructor(@InjectQueue(ECHO_STALLED_QUEUE_NAME) public readonly queue: Queue<EchoJobData>) {}
}

async function buildModule(options: { attempts?: number }) {
  const attempts = options.attempts ?? 1

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      QueueModule,
      BullModule.registerQueue({
        configKey: QueueConfigKey,
        name: ECHO_QUEUE_NAME,
        defaultJobOptions: { attempts, removeOnComplete: true, removeOnFail: true },
      }),
    ],
    providers: [EchoProcessor, EchoEnqueuer],
  }).compile()

  const app = moduleRef.createNestApplication({ logger: false })
  await app.init()
  const processor = app.get(EchoProcessor)
  const enqueuer = app.get(EchoEnqueuer)
  return { app, processor, enqueuer }
}

/**
 * Separate fixture for scenario 4 only. Uses {@link EchoStalledProcessor}
 * whose decorator sets `skipLockRenewal`/`lockDuration`/`stalledInterval`
 * — `autorun: true` starts the LockManager + stalledChecker from the Worker
 * constructor so runtime mutation of opts is too late.
 */
async function buildStalledModule() {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      QueueModule,
      BullModule.registerQueue({
        configKey: QueueConfigKey,
        name: ECHO_STALLED_QUEUE_NAME,
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
      }),
    ],
    providers: [EchoStalledProcessor, EchoStalledEnqueuer],
  }).compile()

  const app = moduleRef.createNestApplication({ logger: false })
  await app.init()
  const processor = app.get(EchoStalledProcessor)
  const enqueuer = app.get(EchoStalledEnqueuer)
  return { app, processor, enqueuer }
}

describe('QueueProcessorBase integration (testcontainers + real Redis)', () => {
  let teardown: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (teardown) {
      await teardown()
      teardown = undefined
    }
  })

  it('scenario 1: success path fires onCompleted with durationMs', async () => {
    const { app, processor, enqueuer } = await buildModule({})
    teardown = () => app.close()
    const completedSpy = vi.spyOn(processor.logger, 'debug')

    await enqueuer.queue.add('echo', { behaviour: 'success', input: 'ping' })

    await vi.waitFor(
      () => {
        expect(completedSpy).toHaveBeenCalledWith(
          'Queue job completed',
          expect.objectContaining({ queue: ECHO_QUEUE_NAME, durationMs: expect.any(Number) }),
        )
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('scenario 2: retry-exhausted path fires permanent onFailed', async () => {
    const { app, processor, enqueuer } = await buildModule({ attempts: 2 })
    teardown = () => app.close()
    const errorSpy = vi.spyOn(processor.logger, 'error')

    await enqueuer.queue.add(
      'echo',
      { behaviour: 'throw', input: 'will-fail' },
      // Tight backoff so the test does not wait minutes for retries.
      { backoff: { type: 'fixed', delay: 100 } },
    )

    await vi.waitFor(
      () => {
        expect(errorSpy).toHaveBeenCalledWith(
          'Queue job failed permanently',
          expect.objectContaining({ isFatal: false }),
        )
      },
      { timeout: 15_000, interval: 200 },
    )
  })

  it('scenario 3: FatalQueueException short-circuits retries (isFatal=true after 1 attempt)', async () => {
    const { app, processor, enqueuer } = await buildModule({ attempts: 5 })
    teardown = () => app.close()
    const errorSpy = vi.spyOn(processor.logger, 'error')

    await enqueuer.queue.add('echo', { behaviour: 'fatal', input: 'no-retry' })

    await vi.waitFor(
      () => {
        expect(errorSpy).toHaveBeenCalledWith(
          'Queue job failed permanently',
          expect.objectContaining({ isFatal: true, attemptsMade: 1 }),
        )
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('scenario 4: handler exceeds lockDuration → onStalled fires', async () => {
    // Uses dedicated EchoStalledProcessor whose decorator sets skipLockRenewal +
    // short lockDuration + tight stalledInterval. Worker constructor (autorun=true)
    // wires the LockManager / stalledChecker from those opts, so mutating after
    // construction is too late. See buildStalledModule() docstring.
    const { app, processor, enqueuer } = await buildStalledModule()
    teardown = () => app.close()
    const warnSpy = vi.spyOn(processor.logger, 'warn')

    await enqueuer.queue.add('echo-stalled', { behaviour: 'sleep', sleepMs: 3000 })

    await vi.waitFor(
      () => {
        expect(warnSpy).toHaveBeenCalledWith(
          'Queue job stalled',
          expect.objectContaining({ jobId: expect.any(String) }),
        )
      },
      { timeout: 30_000, interval: 500 },
    )
  })

  it('scenario 5: graceful drain — onModuleDestroy waits for active job', async () => {
    const { app, processor, enqueuer } = await buildModule({})
    // Manage teardown manually; the test triggers it.
    teardown = undefined
    const drainStart = vi.spyOn(processor.logger, 'log')
    const completedSpy = vi.spyOn(processor.logger, 'debug')

    await enqueuer.queue.add('echo', { behaviour: 'sleep', sleepMs: 1500 })

    // Race-free wait: poll Redis until the job has entered `active` state.
    // A fixed delay races worker pickup latency and made the test flaky on
    // slower hosts (CI). Once active, close(true) MUST wait for the handler.
    await vi.waitFor(
      async () => {
        const counts = await enqueuer.queue.getJobCounts('active')
        expect(counts.active).toBe(1)
      },
      { timeout: 5000, interval: 50 },
    )

    const closedAt = Date.now()
    await app.close()
    const closeDurationMs = Date.now() - closedAt

    // app.close → onModuleDestroy → worker.close(true) waits for the active job,
    // so the close call should not return before the remaining sleep elapses.
    // Lower bound 800 ms (sleepMs=1500, allow ~700 ms already elapsed since add).
    expect(closeDurationMs).toBeGreaterThanOrEqual(800)
    expect(drainStart).toHaveBeenCalledWith(
      'queue draining',
      expect.objectContaining({ worker: ECHO_QUEUE_NAME }),
    )
    expect(drainStart).toHaveBeenCalledWith(
      'queue drained',
      expect.objectContaining({ worker: ECHO_QUEUE_NAME, durationMs: expect.any(Number) }),
    )
    expect(completedSpy).toHaveBeenCalledWith(
      'Queue job completed',
      expect.objectContaining({ queue: ECHO_QUEUE_NAME }),
    )
  })
})
