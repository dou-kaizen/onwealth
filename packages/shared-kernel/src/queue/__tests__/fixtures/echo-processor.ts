import { setTimeout as delay } from 'node:timers/promises'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { QueueProcessor } from '../../queue.decorator.js'
import { FatalQueueException, QueueException } from '../../queue.exception.js'
import type { QueueJobBaseData } from '../../queue-job-data.types.js'
import type { QueueJobResult } from '../../queue-job-result.type.js'
import { QueueProcessorBase } from '../../queue-processor.base.js'

/** Queue name used by the toy processor — keep in sync with integration spec setup. */
export const ECHO_QUEUE_NAME = 'echo-queue'

/**
 * Job behaviour selector used by the integration spec to drive specific
 * lifecycle paths (success / retry / fatal short-circuit / stalled).
 *
 * - `success`: return immediately with the echoed input
 * - `throw`: throw a plain Error (retryable; BullMQ will retry per attempts)
 * - `soft-throw`: throw a {@link QueueException} (retryable; same path as `throw`)
 * - `fatal`: throw a {@link FatalQueueException} → BullMQ short-circuits retries
 * - `sleep`: await `sleepMs` then return — used to force lockDuration overrun (stalled)
 */
export interface EchoJobData extends QueueJobBaseData {
  behaviour: 'success' | 'throw' | 'soft-throw' | 'fatal' | 'sleep'
  input?: string
  sleepMs?: number
}

@QueueProcessor(ECHO_QUEUE_NAME)
export class EchoProcessor extends QueueProcessorBase {
  // Widen access from `protected` → `public` so the integration spec can attach
  // vi.spyOn() spies to the lifecycle log methods.
  public override readonly logger = new Logger(EchoProcessor.name)

  protected async handleJob(job: Job<EchoJobData>): Promise<QueueJobResult> {
    const { behaviour, input, sleepMs } = job.data
    switch (behaviour) {
      case 'success':
        return { message: 'echoed', input: input ?? null }
      case 'throw':
        throw new Error(`echo-throw: ${input ?? 'no-input'}`)
      case 'soft-throw':
        throw new QueueException(`echo-soft-throw: ${input ?? 'no-input'}`)
      case 'fatal':
        throw new FatalQueueException(`echo-fatal: ${input ?? 'no-input'}`)
      case 'sleep':
        await delay(sleepMs ?? 1000)
        return { message: 'slept', input: input ?? null }
    }
  }
}

/** Queue name for the stalled-scenario fixture. Separate from {@link ECHO_QUEUE_NAME}
 * so the stalled-detection knobs don't bleed into the other scenarios. */
export const ECHO_STALLED_QUEUE_NAME = 'echo-stalled-queue'

/**
 * Stalled-scenario fixture. `skipLockRenewal: true` disables the internal
 * LockManager (no lock extension), so a sleep handler outliving `lockDuration`
 * leaves an expired lock that the stalledChecker picks up. `stalledInterval`
 * is short so the watcher fires within the test timeout (BullMQ default 30 s).
 *
 * These options MUST be on the decorator — `autorun: true` (BullMQ default)
 * starts the LockManager and stalledChecker from the Worker constructor, so
 * mutating `worker.opts` post-construction is too late.
 */
@QueueProcessor(ECHO_STALLED_QUEUE_NAME, {
  skipLockRenewal: true,
  lockDuration: 1000,
  stalledInterval: 500,
})
export class EchoStalledProcessor extends QueueProcessorBase {
  public override readonly logger = new Logger(EchoStalledProcessor.name)

  protected async handleJob(job: Job<EchoJobData>): Promise<QueueJobResult> {
    const { sleepMs } = job.data
    await delay(sleepMs ?? 3000)
    return { message: 'slept-stalled' }
  }
}
