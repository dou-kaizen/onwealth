# BullMQ Queue Scaffold — Abstraction Without Integration

**Date**: 2026-05-22 17:06
**Severity**: Low
**Component**: `packages/shared-kernel/src/queue/`
**Status**: Resolved

## What Happened

Ported a BullMQ queue abstraction into `packages/shared-kernel` as a scaffold-only deliverable. Eight source files, three spec files, 19 new test cases (33 total in package, all green). The abstraction ships; `apps/api` does not import it until a real queue task lands — intentional gate to prevent dead infrastructure from bleeding into the app prematurely.

Plan: `plans/260522-1522-bullmq-queue-scaffold/`. Executed via `/cook --auto`.

## The Brutal Truth

The plan arrived pre-hardened by a 15-finding Red Team review, which is the right investment level for a module that will eventually carry production job processing. Two of those findings would have silently wrecked the DI wiring if skipped: C1 (`@OnWorkerEvent('failed')` must be present or the base class is dead code with no failure visibility) and H1 (Zod's `.superRefine()` TLS guard evaporates silently after `.pick()` — the chain has to be rebuilt on the narrowed schema, not inherited). Neither is the kind of bug that shows up in tests until you push a failing job in prod at 2am.

The conditional dispatch in `queue.decorator.ts` was an unpleasant surprise mid-implementation. BullMQ's `WorkerOptions` type requires `connection` — there is no optional form. This means the `@Processor()` call cannot be written the same way for producer-side and consumer-side registration, so the decorator needs branching logic. The plan didn't anticipate this; the implementer caught it and the reviewer confirmed the fix was sound.

## Technical Details

**Module structure:**
- `QueueModule` — `@Global()`, two named BullMQ root connections: `queue` (producer) and `queue-processor` (worker), self-loads via `ConfigModule.forFeature(queueConfig)`
- `QueueProcessorBase` — abstract `WorkerHost`, registers `@OnWorkerEvent('failed')`, exposes pure `evaluateJobFailure` fn for testability
- `QueueProcessor` — decorator abstraction with conditional `Processor()` dispatch (see below)
- `queueConfig` / `queueEnvSchema` — `QUEUE_REDIS_URL` optional, falls back to `REDIS_URL`; prod enforces `rediss://` TLS via `superRefine`
- `constants` / `enum` / `exception` / `result-type` — supporting types

**Two typecheck errors hit during implementation:**
1. `process()` in `QueueProcessorBase` needed `override` modifier — `WorkerHost` declares it abstract, TypeScript strict mode rejects silent override.
2. `WorkerOptions.connection` is required, not optional — forced the conditional dispatch path in `queue.decorator.ts`.

Both errors surfaced during compilation check, both fixed before commit.

**Test run:** 33 passing, 0 failing. Commits: `97d6e1d` (feat) + `6d28efd` (docs) on `init-infrastructure`.

## What We Tried

No failed approaches. The implementation was straightforward once the typecheck errors were resolved. The deviations were additive:

1. Added `@nestjs/bullmq` + `bullmq` to `tsdown.config.ts` `neverBundle` — prevents dual-module DI singleton bug where two copies of the BullMQ module load into separate module registry slots, breaking `getQueueToken()` lookup at runtime. Not in the original plan; the implementer caught it pre-emptively. Reviewer confirmed it as required.
2. Conditional `Processor()` dispatch in `queue.decorator.ts` — `WorkerOptions` requires `connection`, so worker vs. non-worker paths diverge. Plan had assumed uniform registration.

Code review returned DONE_WITH_CONCERNS. M1 (misplaced barrel comment) was fixed. M2 (`evaluateJobFailure` not re-exported from the barrel) was intentional — it's a pure function for internal use and test injection, not a public API surface. Resolved as working-as-designed.

## Root Cause Analysis

The two runtime landmines (dual-module DI + `connection`-required dispatch) are both BullMQ-specific DI coupling problems that don't appear in NestJS docs examples because those examples always show single-process setups. We're building a multi-process monorepo where producer and worker run in different apps. That mismatch between BullMQ's single-process mental model and our split-process architecture is the underlying source of friction. The Red Team review caught the DI risk; the `connection` type issue only surfaced during actual compilation.

The `superRefine`-after-`.pick()` trap is a Zod footgun. `.pick()` returns a new schema object; refinements on the parent are not inherited. If you add TLS validation to a full schema and then `.pick()` a subset for a narrower config, the refinement is gone. Silent failure in dev, broken in prod. Worth documenting prominently wherever Zod config schemas get narrowed.

## Lessons Learned

- **Red Team the plan before cooking, not after.** The 15-finding review happened before a single line was written. That is the correct order. Discovering C1/H1 during implementation would have cost 2-3x the time.
- **`neverBundle` is not optional for peer-resolved singleton modules** (BullMQ, Prisma, etc.). Any package that relies on a single module registry instance must be excluded from bundling when shipped as a library. Default tsdown behavior will bundle it, creating two instances, and the DI error will look like a registration problem, not a bundling problem.
- **Zod `.pick()` drops parent `.superRefine()`.** Always re-chain refinements after schema narrowing. Add a comment at the refinement site explaining this explicitly.
- **`WorkerOptions` requires `connection` — decorator abstractions over BullMQ must branch.** There is no unified `@Processor()` call that works for both producer and consumer contexts. Design for that split from the start.
- **Scaffold-only gates are worth enforcing.** The abstraction is in `shared-kernel` but `apps/api` does not import it. This keeps dead infrastructure out of the app bundle and forces an explicit integration decision when the first real queue arrives.

## Next Steps

- No action required on this scaffold. The module is parked and ready.
- When the first real queue feature lands: import `QueueModule` into `apps/api`, implement a concrete `QueueProcessorBase` subclass, wire the queue name constant — then delete this note from next steps.
- Consider adding a `QUEUE_REDIS_URL` entry to `.env.example` so the next developer doesn't spend time hunting why the fallback path silently uses `REDIS_URL`.
- Owner: next engineer implementing a background job feature.
