import type { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { QueueException } from './queue.exception.js'
import type { QueueJobBaseData } from './queue-job-data.types.js'

/**
 * Operator-facing summary of a permanently failed job. Strips BullMQ ceremony
 * (private fields, method references) so it serialises cleanly over an admin
 * API or a CLI listing.
 *
 * `failedAt` is the BullMQ `finishedOn` ms timestamp — set on the final failed
 * attempt. Absent only if the job is mid-flight, which can't happen for jobs
 * pulled from the `failed` set.
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
 * set is bounded by the producer's `removeOnFail` (see QueueModule defaults:
 * 5000). Tune per queue if operators need a longer retry window.
 *
 * @param queue   BullMQ Queue obtained via `@InjectQueue(name)`
 * @param start   inclusive 0-based offset (default 0)
 * @param end     inclusive upper bound (default 50 — match operator UI page size)
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
 * Delegates to {@link Job.retry}, which resets `attemptsMade` and moves the
 * job back to `wait`. Defensive: rejects missing or non-`failed` jobs so a
 * caller bug (stale ID list, racing operator) becomes a typed exception
 * instead of a silent BullMQ no-op.
 *
 * NOTE: `Job.retry()` bypasses the configured backoff — manual retry is
 * immediate. Document this in any admin UI exposing the helper.
 *
 * @throws {@link QueueException} if the job is missing or not in `failed`
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
