# Queue Module — Production Usage Guide

BullMQ + NestJS scaffold living in `@onwealth/shared-kernel`. Boilerplate
only — `QueueModule` is **not** imported by `apps/api` until the first
feature wires a queue. This guide is the cloner's 5-minute start.

> Audience: NestJS-familiar developer, no BullMQ experience.

---

## 1. Quick Start

End-to-end: register a queue, write a processor, enqueue a job. ~30 LOC.

### 1a. Import `QueueModule` once at the app root

```ts
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common'
import { QueueModule } from '@onwealth/shared-kernel'
import { EmailModule } from './email/email.module.js'

@Module({ imports: [QueueModule, EmailModule] })
export class AppModule {}
```

`QueueModule` is `@Global()` — registers a single shared BullMQ connection
under the named key `QueueConfigKey`. All feature queues inherit it.

### 1b. Register a named queue inside the feature module

```ts
// apps/api/src/email/email.module.ts
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { QueueConfigKey } from '@onwealth/shared-kernel'
import { EmailProcessor } from './email.processor.js'
import { EmailService } from './email.service.js'

@Module({
  imports: [
    BullModule.registerQueue({
      configKey: QueueConfigKey, // REQUIRED — see Gotcha #1
      name: 'email-notification',
    }),
  ],
  providers: [EmailProcessor, EmailService],
})
export class EmailModule {}
```

### 1c. Write the processor

Extend `QueueProcessorBase` and implement `handleJob` (not `process` — that
is owned by the base for prototype-pollution stripping).

```ts
// apps/api/src/email/email.processor.ts
import type { Job } from 'bullmq'
import {
  QueueException,
  QueueProcessor,
  QueueProcessorBase,
  type QueueJobBaseData,
  type QueueJobResult,
} from '@onwealth/shared-kernel'

interface SendEmailJobData extends QueueJobBaseData {
  toEmail: string
  subject: string
  body: string
}

@QueueProcessor('email-notification', {
  concurrency: 5,
  limiter: { max: 100, duration: 1000 }, // 100 sends/sec across all workers
})
export class EmailProcessor extends QueueProcessorBase {
  protected async handleJob(job: Job<SendEmailJobData>): Promise<QueueJobResult> {
    // Zod-validate job.data here in real code — see Gotcha #4.
    const { toEmail, subject, body } = job.data
    if (!toEmail) throw new QueueException('toEmail missing')
    // AbortSignal bounds the outbound call to the lock window. See Gotcha #2.
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      body: JSON.stringify({ toEmail, subject, body }),
      signal: AbortSignal.timeout(20_000),
    })
    return { message: 'sent', toEmail }
  }
}
```

### 1d. Enqueue a job

```ts
// apps/api/src/email/email.service.ts
import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { assertPayloadSize } from '@onwealth/shared-kernel'
import type { Queue } from 'bullmq'

@Injectable()
export class EmailService {
  constructor(@InjectQueue('email-notification') private readonly queue: Queue) {}

  async send(input: { toEmail: string; subject: string; body: string }) {
    assertPayloadSize(input) // Gotcha #4
    await this.queue.add('send', {
      correlationId: this.cls?.get('correlationId'), // propagate tracing
      ...input,
    })
  }
}
```

That's it. SIGTERM-safe drain, failure logging, stalled-job detection, and
correlation-ID propagation are inherited from `QueueProcessorBase`.

---

## 2. Gotchas (the 4 things that bite in production)

### #1 — Always pass `configKey: QueueConfigKey` to `registerQueue`

`@nestjs/bullmq`'s `BullExplorer.getQueueOptions` prefers a registered
Queue's `opts.connection` over the worker's `configKey` shared config. If
you omit `configKey` on `BullModule.registerQueue`, the Queue silently
falls back to ioredis defaults (`localhost:6379`, no auth) — and the
worker is then forced onto that same wrong connection. Production
deployments will appear to "work" against a non-existent local Redis.

**Always pass `configKey: QueueConfigKey`.** No exceptions.

### #2 — `lockDuration` is a deadline, not a hint

BullMQ holds a Redis lock per job (default `lockDuration: 30_000`). If
your handler outlives the lock, the watcher marks the job **stalled** and
re-runs it on another worker — possibly causing double-side-effects.

Two strategies:

- **Bound the work**: pass `AbortSignal.timeout(N)` (N < lockDuration) to
  every outbound `fetch`/`axios`/`pg` call so a hung downstream cannot
  outrun the lock.
- **Raise the lock**: `@QueueProcessor('q', { lockDuration: 120_000 })`
  for jobs that legitimately take >30 s.

Never mutate `lockDuration` at runtime — BullMQ's autorun starts the
LockManager from the Worker constructor (see
`__tests__/fixtures/echo-processor.ts` for the test-only escape hatch).

### #3 — `removeOnComplete` / `removeOnFail` defaults are bounded, not unbounded

`QueueModule` defaults to `removeOnComplete: { count: 1000 }` and
`removeOnFail: { count: 5000 }`. These are **Redis retention windows**, not
business-level history. If your operator needs a 30-day failed-job audit,
override per queue:

```ts
BullModule.registerQueue({
  configKey: QueueConfigKey,
  name: 'invoice-charge',
  defaultJobOptions: {
    removeOnFail: { age: 30 * 24 * 3600, count: 50_000 },
  },
})
```

The `removeOnFail` count is also your effective DLQ retry window (see
section 4). If you need more, raise it — or migrate to a dedicated DLQ.

### #4 — `assertPayloadSize` before `queue.add`, Zod-validate inside the handler

`assertPayloadSize(payload, maxBytes = 64 KB)` guards Redis memory. Large
payloads (file blobs, megabyte JSON) bloat the BullMQ job hash and slow
worker checkpoints. Call it AFTER your producer-side Zod parse:

```ts
const payload = sendEmailSchema.parse(input)
assertPayloadSize(payload)
await this.queue.add('send', payload)
```

Inside the handler, re-validate with Zod — `QueueProcessorBase.process`
strips `__proto__` / `constructor` / `prototype` keys as defense-in-depth,
but a schema check is still your shape guarantee.

---

## 3. Production Checklist

Per-queue checklist before exposing a new processor to traffic:

- [ ] **Rate limit** set if calling external APIs:
      `{ limiter: { max, duration } }` on `@QueueProcessor`.
- [ ] **`lockDuration`** ≥ p99 handler duration + 50% buffer.
- [ ] **AbortSignal.timeout** on every outbound HTTP/DB call inside
      `handleJob`. Default lock is 30 s — don't let downstream hangs
      kill the lock.
- [ ] **`removeOnFail`** retention tuned for your audit window
      (override default 5 000 if operators need longer DLQ retry).
- [ ] **Zod-validate** `job.data` at the top of `handleJob`.
- [ ] **`assertPayloadSize`** at every producer call site.
- [ ] **`correlationId`** populated from CLS at enqueue time so worker
      logs join request traces.
- [ ] **Redis URL** uses `rediss://` in production (TLS). The
      `parseRedisUrl` helper in `queue.module.ts` handles the scheme;
      the env validation enforces format.
- [ ] **DLQ monitoring**: scheduled job polls `getFailedJobs(queue, 0, 50)`
      and pages the on-call if non-empty for >5 min.
- [ ] **Throw `FatalQueueException`** (extends `UnrecoverableError`) for
      non-retryable errors (validation failures, missing rows). Plain
      `Error` or `QueueException` retries per `attempts`.

---

## 4. DLQ Helper + Migration to a Dedicated DLQ

### Built-in helper: BullMQ-native `failed` set

Jobs that exhaust retries (or throw `FatalQueueException`) land in
BullMQ's `failed` set, retained per `removeOnFail`. Two helpers expose
that set:

```ts
import { getFailedJobs, retryFailedJob } from '@onwealth/shared-kernel'

// List the most recent 50 failures from a queue
const failed = await getFailedJobs(emailQueue, 0, 50)
// → FailedJobSummary[] { id, name, queue, attemptsMade, failedReason,
//                        failedAt, correlationId, data }

// Manually requeue one (resets attemptsMade, bypasses backoff)
await retryFailedJob(emailQueue, failed[0].id, this.logger)
```

`retryFailedJob` throws `QueueException` on missing ID or non-`failed`
state — wrap in your admin route's error mapper.

### When to migrate to a dedicated DLQ

The native helper is enough until you need any of:

- **Long-term retention** beyond `removeOnFail` cap (e.g. compliance
  audit of every failure forever).
- **Separate operator UI** with its own access control.
- **Re-processing strategy** that differs from the original handler
  (e.g. enrich data, then re-enqueue).

### 5-LOC migration sketch

Add a sibling DLQ queue + processor that consumes from it:

```ts
// 1. Register the DLQ queue
BullModule.registerQueue({
  configKey: QueueConfigKey,
  name: 'email-notification-dlq',
  defaultJobOptions: { removeOnFail: { age: 90 * 24 * 3600 } },
})

// 2. In EmailProcessor, override onFailed to forward to DLQ on permanent failure
@OnWorkerEvent('failed')
override onFailed(job: Job, error: Error): void {
  super.onFailed(job, error)
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    this.dlqQueue.add('dead', { ...job.data, originalId: job.id, failedReason: error.message })
  }
}

// 3. EmailDlqProcessor extends QueueProcessorBase — re-process or persist as needed.
```

Keep the BullMQ-native `failed` set ALSO active — the DLQ is additive,
not replacement. That way you keep the operator helpers from this module.

---

## See Also

- `queue-processor.base.ts` — base class JSDoc covers
  `onModuleDestroy` drain semantics and `Worker.close(force)` inverted
  flag.
- `queue.decorator.ts` — `@QueueProcessor` options reference.
- `__tests__/queue-processor-base.integration.spec.ts` — 5 scenarios
  (success, retry-exhausted, fatal short-circuit, stalled, graceful
  drain) that double as worked examples.
- `__tests__/queue-dlq-helper.integration.spec.ts` — DLQ helper
  behaviours.
