import type { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { QueueException } from './queue.exception.js'
import type { QueueJobBaseData } from './queue-job-data.types.js'

/**
 * Operator-facing summary of a permanently failed job.
 *
 * Strips BullMQ ceremony (private fields, method references) so it
 * serialises cleanly over an admin API or a CLI listing.
 *
 * `failedAt` is the BullMQ `finishedOn` ms timestamp, set on the final
 * failed attempt. Absent only if the job is mid-flight — which cannot
 * happen for jobs pulled from the `failed` set, so `0` is a safe fallback.
 */
export interface FailedJobSummary {
  id: string
  name: string
  queue: string
  attemptsMade: number
  failedReason: string
  failedAt: number
  correlationId?: string
  data: unknown
}

/**
 * List permanently failed jobs from a BullMQ queue's `failed` set.
 *
 * Pure delegation to {@link Queue.getFailed} + summary mapping. The `failed`
 * set is bounded by the producer's `removeOnFail` (QueueModule default:
 * `5000`). Tune per queue if operators need a longer retry window.
 *
 * @param queue BullMQ `Queue` obtained via `@InjectQueue(name)`.
 * @param start Inclusive 0-based offset. Defaults to `0`.
 * @param end   Inclusive upper bound. Defaults to `50` (matches typical
 *              operator UI page size).
 * @returns Newest-first array of {@link FailedJobSummary}.
 */
export async function getFailedJobs(
  queue: Queue,
  start = 0,
  end = 50,
): Promise<FailedJobSummary[]> {
  const jobs = await queue.getFailed(start, end)
  return jobs.map((job) => toSummary(job, queue.name))
}

/**
 * Manually requeue a failed job by ID.
 *
 * Delegates to {@link Job.retry}, which resets `attemptsMade` and moves
 * the job back to `wait`. Defensive on missing or non-`failed` jobs so a
 * caller bug (stale ID list, racing operator) becomes a typed exception
 * instead of a silent BullMQ no-op.
 *
 * **Caveat:** `Job.retry()` bypasses the configured backoff — the manual
 * retry runs immediately. Surface this in any admin UI exposing the helper
 * so operators do not accidentally re-trigger a flapping downstream.
 *
 * @param queue  BullMQ `Queue` obtained via `@InjectQueue(name)`.
 * @param jobId  The job ID from {@link FailedJobSummary.id}.
 * @param logger Optional logger; when provided, emits a `'manual retry'`
 *               record at `log` level with `correlationId` propagated.
 *
 * @throws {@link QueueException} if the job is missing or not in the
 *         `failed` state.
 */
export async function retryFailedJob(queue: Queue, jobId: string, logger?: Logger): Promise<void> {
  const job = await queue.getJob(jobId)
  if (!job) {
    throw new QueueException(`job ${jobId} not found in queue ${queue.name}`)
  }
  const state = await job.getState()
  if (state !== 'failed') {
    throw new QueueException(`job ${jobId} state=${state}, expected failed (queue=${queue.name})`)
  }
  const data = job.data as QueueJobBaseData | null | undefined
  logger?.log('manual retry', {
    jobId,
    queue: queue.name,
    correlationId: data?.correlationId,
  })
  await job.retry()
}

/**
 * Convert a BullMQ `Job` to the operator-facing {@link FailedJobSummary}
 * shape. Coerces nullable BullMQ fields to safe defaults so consumers do
 * not need defensive checks.
 */
function toSummary(job: Job, queueName: string): FailedJobSummary {
  const data = job.data as QueueJobBaseData | null | undefined
  return {
    id: String(job.id ?? ''),
    name: job.name,
    queue: queueName,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? '',
    failedAt: job.finishedOn ?? 0,
    correlationId: data?.correlationId,
    data: job.data,
  }
}
