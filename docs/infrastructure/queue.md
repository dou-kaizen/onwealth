# Queue Documentation

This documentation explains the queue layer of **boilerplate-monorepo**: a BullMQ-backed
background job scaffold in `@boilerplate/shared-kernel` with production-hardened defaults —
retry policy, lock-token forwarding, graceful drain, DLQ helper, and a fatal-error
short-circuit path.

Source location: `packages/shared-kernel/src/queue/`

For a hands-on quick start, processor examples, and production checklist, read the inline
guide at `packages/shared-kernel/src/queue/README.md` first. This document describes the
module contracts, configuration, and behavioral guarantees.

## Related Documents

- [Environment Variables](./environment.md) — `QUEUE_REDIS_URL` and `REDIS_URL` reference
- [Configuration](./configuration.md) — `queueConfig` namespace factory
- [Cache](./cache.md) — separate `REDIS_URL` for cache (different purpose from queue Redis)
- [Project Structure](./project-structure.md) — package boundaries and dependency DAG

## Table of Contents

- [Configuration](#configuration)
- [Structure](#structure)
- [Usage](#usage)
- [Creating a New Queue](#creating-a-new-queue)
- [Behavior](#behavior)
- [References](#references)

## Configuration

### Environment Variables

Validated by `queueEnvSchema` (picked from `envObjectSchema`). See
[Environment Variables](./environment.md) for full rules.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `QUEUE_REDIS_URL` | No | Falls back to `REDIS_URL` | Dedicated Redis URL for BullMQ; must use `rediss://` in production |
| `REDIS_URL` | Yes | — | Used as queue URL when `QUEUE_REDIS_URL` is absent |

`QUEUE_REDIS_URL` is intentionally separate from the cache `REDIS_URL`. In production,
these may point to different Redis instances or logical databases to isolate BullMQ's
blocking command traffic from cache read/write traffic. `queueConfig.url` resolves to
`QUEUE_REDIS_URL ?? REDIS_URL` at boot.

Production TLS is enforced by `queueEnvSchema.superRefine`: if `NODE_ENV=production` and
the effective URL starts with `redis://`, validation fails at startup.

### Default Job Options

`QueueModule` registers these defaults globally across all queues via `BullModule.forRootAsync`:

| Option | Value | Notes |
|---|---|---|
| `attempts` | `3` | BullMQ default is `1` (zero retries); 3 covers transient Redis blips |
| `backoff.type` | `'exponential'` | Attempt 1 @ 1 s, attempt 2 @ 2 s, attempt 3 @ 4 s |
| `backoff.delay` | `1000` ms | Base delay for exponential calculation |
| `removeOnComplete` | `{ count: 1000 }` | Bounded `completed` set; prevents unbounded Redis growth |
| `removeOnFail` | `{ count: 5000 }` | Bounded `failed` set; effective DLQ retry window |

Per-queue producers may override via `BullModule.registerQueue({ defaultJobOptions })` or
per-call `queue.add(name, data, opts)`.

## Structure

| File | Purpose |
|---|---|
| `queue.module.ts` | `QueueModule` — global BullMQ root connection + boot-time guard |
| `queue.config.ts` | `queueConfig` factory + `queueEnvSchema` |
| `queue.constant.ts` | `QueueConfigKey = 'queue'` — shared connection key |
| `queue.decorator.ts` | `@QueueProcessor(name, options?)` — class decorator |
| `queue-processor.base.ts` | `QueueProcessorBase` — abstract base for all processors |
| `queue-processor.base.internal.ts` | `_evaluateJobFailure` — pure failure-classification function |
| `queue.exception.ts` | `QueueException` (retryable) + `FatalQueueException` (terminal) |
| `queue-dlq.helper.ts` | `getFailedJobs` / `retryFailedJob` + `FailedJobSummary` type |
| `queue-job-data.types.ts` | `QueueJobBaseData` — base payload shape with `correlationId` |
| `queue-job-result.type.ts` | `QueueJobResult` — return type from `handleJob` |
| `queue-payload-size.guard.ts` | `assertPayloadSize` — guards against oversized Redis payloads |

### `QueueConfigKey`

```typescript
// queue.constant.ts
export const QueueConfigKey = 'queue'
```

This string is the named key passed to both `BullModule.forRootAsync(QueueConfigKey, ...)` and
every `BullModule.registerQueue({ configKey: QueueConfigKey, name })`. If `configKey` is
omitted on `registerQueue`, BullMQ silently falls back to ioredis defaults (`localhost:6379`,
no auth). Always pass `configKey: QueueConfigKey`.

## Usage

### Registering the Module

Import `QueueModule` once at the app root. It is `@Global()` — all feature modules that
register queues inherit the shared root connection.

```typescript
// apps/api/src/app.module.ts
import { QueueModule } from '@boilerplate/shared-kernel'

@Module({ imports: [QueueModule, EmailModule, ...] })
export class AppModule {}
```

`QueueModule.onModuleInit` asserts the BullMQ shared config token is present and logs the
sanitized Redis URL. A misconfigured `forRootAsync` (wrong `configKey`) causes a hard throw
at boot rather than a silent fall-through to `localhost:6379`.

### Adding Jobs to a Queue

```typescript
import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { assertPayloadSize, type QueueJobBaseData } from '@boilerplate/shared-kernel'
import type { Queue } from 'bullmq'

interface SendEmailJobData extends QueueJobBaseData {
  toEmail: string
  subject: string
}

@Injectable()
export class EmailService {
  constructor(
    @InjectQueue('email-notification') private readonly queue: Queue
  ) {}

  async send(input: SendEmailJobData): Promise<void> {
    assertPayloadSize(input) // rejects payloads > 64 KB
    await this.queue.add('send', input)
  }
}
```

### Writing a Processor

Extend `QueueProcessorBase` and implement `handleJob`. Do not override `process` — the
base owns that entry point for prototype-pollution stripping and lock-token forwarding.

```typescript
import type { Job } from 'bullmq'
import {
  FatalQueueException,
  QueueException,
  QueueProcessor,
  QueueProcessorBase,
  type QueueJobResult,
} from '@boilerplate/shared-kernel'

@QueueProcessor('email-notification', { concurrency: 5 })
export class EmailProcessor extends QueueProcessorBase {
  protected async handleJob(job: Job, token?: string): Promise<QueueJobResult> {
    const { toEmail } = job.data
    if (!toEmail) {
      throw new FatalQueueException('toEmail missing — non-retryable')
    }
    try {
      await sendEmail(toEmail, { signal: AbortSignal.timeout(20_000) })
    } catch (err) {
      throw new QueueException(`email send failed: ${(err as Error).message}`)
    }
    return { message: 'sent', toEmail }
  }
}
```

The `token` parameter is the BullMQ lock token forwarded from `process(job, token?)`. Use
`await job.extendLock(token, ms)` inside long-running handlers when processing time may
exceed `WorkerOptions.lockDuration` (default 30 000 ms). Prefer `AbortSignal.timeout(N)`
to bound outbound IO instead of extending the lock.

## Creating a New Queue

1. Register the queue in the feature module's `imports`:

   ```typescript
   BullModule.registerQueue({
     configKey: QueueConfigKey, // REQUIRED — omitting this silently uses localhost:6379
     name: 'invoice-charge',
   })
   ```

2. Create a processor class extending `QueueProcessorBase`, decorated with
   `@QueueProcessor('invoice-charge')`.

3. Add the processor class to the feature module's `providers` array.

4. Inject `@InjectQueue('invoice-charge') private readonly queue: Queue` in the
   producer service, call `assertPayloadSize(payload)` before every `queue.add(...)`.

5. Run the production checklist in `packages/shared-kernel/src/queue/README.md §3` before
   exposing the queue to traffic (rate limit, lockDuration, Zod validation, TLS URL, etc.).

## Behavior

### Retry Path

Throwing `QueueException` or any plain `Error` from `handleJob` triggers BullMQ's retry
path. With default options: 3 attempts, exponential backoff starting at 1 s. After
exhausting attempts the job moves to the `failed` set.

### Terminal Failure Path (`FatalQueueException`)

`FatalQueueException` extends BullMQ's `UnrecoverableError`. Throwing it causes BullMQ to
skip all remaining retry attempts and move the job to `failed` immediately. Use for
irrecoverable conditions: schema validation rejections, missing referenced rows, permission
errors — any case where retrying will produce the same outcome.

`_evaluateJobFailure` (internal pure function) keys off `instanceof FatalQueueException`
to set `isFatal: true` in the log context on attempt 1, so incident triage sees the
terminal signal without waiting for retries to exhaust.

### Lock Token Forward

`QueueProcessorBase.process(job, token?)` forwards `token` to `handleJob(job, token?)`.
This gives concrete processors access to the BullMQ lock token for long-running jobs:

```typescript
await job.extendLock(token!, 30_000) // extend by 30 s
```

If `token` is absent (unit test harness bypassing the Worker), `extendLock` should be
guarded with a null check.

### Graceful Drain on SIGTERM

`QueueProcessorBase` implements `OnModuleDestroy`. On shutdown:

1. `worker.close(false)` is called — `false` means "wait for the in-flight job to finish"
   (semantics are inverted from intuition: `close(true)` skips the wait).
2. The close races a 5 s timeout (`QUEUE_DRAIN_TIMEOUT_MS`), mirroring the `SHUTDOWN_GRACE_MS`
   constant in `apps/api/src/main.ts`.
3. If the drain times out, an `error` log is emitted and Nest tears down anyway — a hung
   handler must not block process exit.

### Worker Events

`QueueProcessorBase` wires four `@OnWorkerEvent` hooks automatically:

| Event | Level | Trigger |
|---|---|---|
| `failed` | `error` (fatal) / `warn` (retryable) | Job failure — classifies via `_evaluateJobFailure` |
| `completed` | `debug` | Job success — logs handler duration |
| `stalled` | `warn` | Lock not renewed in time (handler overran `lockDuration`) |
| `error` | `error` | Infrastructure error (Redis connection drop, deserialize failure) |

All failure log entries include `correlationId` from `job.data` when present, joining
worker logs to the originating HTTP request trace.

### DLQ Helper (`FailedJobSummary`)

`getFailedJobs(queue, start, end)` and `retryFailedJob(queue, jobId, logger?)` expose
BullMQ's native `failed` set as an operator-facing API.

`FailedJobSummary` intentionally omits the raw `job.data` field. Job payloads may contain
PII (emails, addresses, financial values). Callers needing the raw payload must fetch the
underlying `Job` via `queue.getJob(id)` and apply their own PII-stripping logic.

`retryFailedJob` throws `QueueException` if the job is missing or not in `failed` state.
Manual retries bypass the configured backoff and run immediately — surface this in any
admin UI to prevent accidental retriggering of a flapping downstream.

### Prototype-Pollution Defense

`QueueProcessorBase.process` calls `stripPrototypePollutionKeys(job.data)` before
delegating to `handleJob`. This recursively removes `__proto__`, `constructor`, and
`prototype` keys from the payload object in place. Concrete processors should still
Zod-validate `job.data` — sanitization is defense-in-depth, not a schema check.

## References

[ref-bullmq]: https://bullmq.io
[ref-nestjs-bullmq]: https://docs.nestjs.com/techniques/queues
[ref-ioredis]: https://github.com/redis/ioredis
[ref-redis]: https://redis.io
