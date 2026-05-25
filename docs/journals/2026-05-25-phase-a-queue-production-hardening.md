# Phase A Queue Production Hardening — BullMQ Scaffold Made Deployable

**Date**: 2026-05-25 17:29
**Severity**: Medium
**Component**: `packages/shared-kernel/src/queue/`
**Status**: Resolved

## What Happened

Seven hardening tasks (A1–A7) layered on top of the May-22 scaffold commit (`97d6e1d`). Deliverable: commit `1052c48` on `init-infrastructure`. The scaffold was correct structure; this phase made it safe to actually run in production. Plan: `plans/260525-1515-queue-production-hardening/`.

Summary of changes:
- **A1**: `defaultJobOptions` with `removeOnComplete: { count: 1000 }` and `removeOnFail: { count: 5000 }` in `queue.module.ts`. Redis retention was previously unbounded.
- **A2**: `onModuleDestroy` in `queue-processor.base.ts` — 5000 ms timeout race against `worker.close(false)` for graceful drain on SIGTERM.
- **A3**: `limiter` option documented with a usage example in `queue.decorator.ts` JSDoc.
- **A4**: Integration spec suite via `@testcontainers/redis@12` (pinned `redis:7.4-alpine`). 5 scenarios across `queue-processor.base.spec.integration.ts`. New `vitest.config.integration.ts` separates unit and integration runs.
- **A5**: Dropped `error instanceof QueueException && error.isFatal` branch in `_evaluateJobFailure`. Fatal handling now uses `instanceof FatalQueueException` exclusively. Bug found and fixed here (see below).
- **A6**: DLQ helper at `queue-dlq.helper.ts` — `getFailedJobs()` and `retryFailedJob()`. Pure delegation over BullMQ's native `failed` set. 4 integration scenarios in `queue-dlq.helper.spec.integration.ts`.
- **A7**: `packages/shared-kernel/src/queue/README.md` — Quick Start, Gotchas, Production Checklist, DLQ migration sketch. Cross-linked via `@see ./README.md` in JSDoc on `queue-processor.base.ts` and `queue.module.ts`.

Final test counts: 84 unit, 9 integration (5 base + 4 DLQ). Apps/api: 8/8. Typecheck, biome lint, tsdown build, dep-cruiser all green.

## The Brutal Truth

Three debugging traps in this phase collectively would have cost a full day if hit cold at 2am with a production incident open. All three came from BullMQ internals that contradict reasonable intuition. The BullMQ docs do not cover any of them. You find them by reading source or by staring at a test that measures 2ms where you expected 800ms.

The graceful drain scenario in particular was just wrong for an embarrassingly simple reason: the boolean argument to `Worker.close()` is backwards from what you'd assume. This is the kind of thing that gets committed, passes a happy-path CI that never actually stalls a job, and only surfaces when you kill a pod mid-job in prod.

The `isLastAttempt` bug in A5 was real and quiet. The old code only triggered fatal escalation on the last retry attempt. If a `FatalQueueException` came in on attempt 1 of 5, the worker logged it, put the job back in the queue, and retried it four more times. Production impact: DLQ flooded with retried-then-failed fatal jobs instead of short-circuiting. This was live in the scaffold from May 22.

## Technical Details

### Bug: `isLastAttempt` gate swallowing `FatalQueueException` on early attempts

Old logic in `_evaluateJobFailure`:

```typescript
const isLastAttempt = job.attemptsMade >= attempts - 1;
if (error instanceof QueueException && error.isFatal) { ... }  // legacy path
```

The `isFatal` branch still checked `isLastAttempt` implicitly through the surrounding condition chain. A `FatalQueueException` on attempt 1 fell through to the retry path.

Fix:

```typescript
const isFatal = error instanceof FatalQueueException;
const isLastAttempt = isFatal || job.attemptsMade >= attempts - 1;
```

New unit test: `should short-circuit to failed on FatalQueueException regardless of attempt count`.

### Trap 1: `Worker.close(force)` semantics are inverted

BullMQ source (`worker.ts`):

```typescript
return force || this.whenCurrentJobsFinished(false);
```

`force=true` short-circuits the drain. `force=false` waits for in-flight jobs. Intuition says "force = drain hard"; reality is "force = skip drain, terminate now". The graceful drain scenario was measuring `closeDurationMs = 2` — terminating instantly — because the initial implementation passed `close(true)`. Fix: `worker.close(false)` for graceful SIGTERM. Documented in JSDoc on `onModuleDestroy`.

### Trap 2: `@nestjs/bullmq` `BullExplorer` prefers `Queue.opts.connection` over worker `configKey`

`BullExplorer.getQueueOptions` reads the queue's own `opts.connection` before consulting the worker's named config. The planned producer/worker connection split (separate `maxRetriesPerRequest` settings) silently fell back to `ioredis` defaults (localhost:6379) in integration tests instead of using the testcontainer host. Symptom: `ECONNREFUSED` against 6379 while the container was running on a random port.

Fix: collapsed the split into a single shared config. `BullModule.registerQueue` must carry `configKey: QueueConfigKey` explicitly, and `maxRetriesPerRequest: null` (required for worker contexts) lives in that shared config. Not ideal — worker-safe options now apply to producers — but BullMQ's internal routing leaves no clean seam for a split without patching `BullExplorer`.

### Trap 3: `autorun: true` starts `LockManager` + `stalledChecker` in the Worker constructor

Mutating `worker.opts.skipLockRenewal`, `lockDuration`, or `stalledInterval` post-construction has no effect. The stalled detection scenario (scenario 4) initially did not trigger because the worker was already running with the default 30 s stall interval. Fix: dedicated `EchoStalledProcessor` fixture with stall-appropriate decorator-time options (`lockDuration: 500`, `stalledInterval: 200`).

## What We Tried

- **Producer/worker connection split** — abandoned after BullMQ's internal routing proved opaque. Single shared config is less precise but testable and correct.
- **Post-construction worker option mutation for stall test** — did not work. Fixture-level decorator options required.
- **`worker.close(true)` for graceful drain** — wrong. Corrected to `false` after reading source.

## Root Cause Analysis

All three traps share the same root: BullMQ's public API surface is thin documentation over non-obvious internal behavior. The library is well-built but it assumes you either read the source or have already been burned. The scaffold phase (May 22) did not include integration tests, which means none of this was catchable until A4 forced real Redis execution. Writing integration tests against a live container exposed all three within a single afternoon — which is the correct investment for infrastructure that will handle real jobs.

The `FatalQueueException` bug was a logic error introduced during the original scaffold. The branching condition looked correct on paper but the outer `isLastAttempt` guard was implicitly applied to all branches. No unit test covered the early-attempt fatal case until this phase added one.

## Lessons Learned

- **Read BullMQ source before trusting boolean semantics on its public API.** `Worker.close(force)` is a footgun. The JSDoc is absent for the `force` param in most versions. Search for `this.whenCurrentJobsFinished` in the source before writing drain logic.
- **Split BullMQ producer/worker connections only if you control `BullExplorer` or bypass `@nestjs/bullmq` registration.** Otherwise the framework silently prefers the queue's own connection config and your carefully crafted split is invisible.
- **`autorun: true` is the default and it bites stall-related tests.** If a scenario depends on specific `lockDuration` or `stalledInterval`, they must be set at decorator time. There is no late-binding hook.
- **Integration tests against a real Redis are not optional for queue infrastructure.** The three traps above are invisible to unit tests with mocked workers. `@testcontainers/redis` setup is 20 lines; the traps it catches are each worth hours of prod debugging.
- **Fatal exception short-circuit must be independent of attempt count.** If you check `isLastAttempt` anywhere in the fatal path, you have a bug. The `isFatal || isLastAttempt` pattern is the correct form and it must be a single unified flag, not two separate branches.

## Next Steps

- **Phase B (separate plan)**: metrics hook via EventEmitter2, comment trim on `queue-processor.base.ts`, alert threshold tuning. No owner assigned yet.
- **First real queue feature**: import `QueueModule` in `apps/api/app.module.ts`, extend `QueueProcessorBase`, wire the queue name constant. The boilerplate intentionally does not import `QueueModule` yet.
- **DLQ operational runbook**: `queue-dlq.helper.ts` exists; nobody has written the ops procedure for monitoring `getFailedJobs()` output or triggering `retryFailedJob()` in prod. That lives outside the codebase. Owner: whoever deploys the first job.
- **`maxRetriesPerRequest: null` in shared config**: document explicitly in `.env.example` and ops notes that this is a worker-required setting that now applies globally. If a producer context ever needs default retry behavior, the shared config must be split — and `BullExplorer` routing must be addressed first.
