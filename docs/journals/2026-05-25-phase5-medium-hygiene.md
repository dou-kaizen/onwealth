# Phase 5 Medium Hygiene — 15 Correctness Fixes, Two Hard Architecture Calls

**Date**: 2026-05-25 12:58
**Severity**: Medium
**Component**: `packages/shared-kernel`, `packages/nest-http`, `apps/api`, CI
**Status**: Resolved

## What Happened

Swept the remaining 15 Medium findings (M1, M3, M5–M16, M24, M25) from the `plans/260524-1613-codebase-review-findings-fix/` review. Seven commits landed on `init-infrastructure`. All gates green at close: typecheck 7/7, vitest 54 passed / 1 skipped across 9 files, biome 0 violations, tsdown+nest build OK, dep-cruiser 0 violations.

The findings ranged from two-line guards (`Object.hasOwn` prototype-pollution defense, `.min(1000)` Zod throttle-TTL constraint) to structural surgery (queue processor split, graceful-shutdown wiring, two 200-line file extractions). No finding was individually alarming; the collective volume is what hurts.

## The Brutal Truth

Fifteen medium findings after a prior three-phase review pass means the first review didn't go deep enough, or the bar for "medium" was set too low to act on urgently. Either way, a second sweep of this size on a branch that hasn't shipped yet is a sign the initial standards pass was incomplete. The right time to catch `unhandledRejection` missing from `main.ts` is before the first deploy, not in a dedicated hygiene phase that adds overhead.

The most irritating find was M6 (domain event publisher). At-most-once looks clean until the first consumer is real and idempotency becomes somebody else's problem to enforce. The decision to defer outbox pattern is correct given current scale, but it is exactly the kind of decision that becomes a 3am incident when the first event consumer ships without idempotency enforcement and an event gets dropped mid-flight on a transient Redis hiccup.

M8 (CSP) was a practical capitulation: `'unsafe-inline'` stays on `script-src` because Swagger/Scalar injects inline scripts we don't control. The frame-ancestors / object-src / base-uri / form-action directives are locked. The nonce migration that would actually remove `'unsafe-inline'` requires a browser-run Scalar audit we cannot execute from CLI. So we shipped a better-than-nothing CSP and flagged the remainder.

## Technical Details

**M5 — queue processor split (`queue-processor.base.internal.ts`):**
Extracted `_evaluateJobFailure` pure helper into a separate internal file so it remains unit-testable. `FatalQueueException` subclass replaces a `boolean` flag that was a foot-gun: callers had to remember to check the flag, whereas the exception type is enforced by the type system.

**M12 — graceful shutdown:**
`app` ref hoisted out of `bootstrap()` closure so `unhandledRejection` / `uncaughtException` handlers can call `app.close()` for HTTP/pool/BullMQ drain. `setTimeout(...).unref()` hard-stop fallback bounds a hung close — without it, a stuck DB pool keeps the process alive forever. This is the kind of thing that looks optional until your deployment pipeline hangs on `SIGTERM` and you spend an hour figuring out why ECS is force-killing the container.

**M16 — integration gate:**
Added a real `app.get(Class)` invariant test per provider plus an actual `application/problem+json` 404 response check. Grep-only invariants can't catch "configureHttpApp was bypassed" because grep runs before the app boots. The test boots the app.

**M6 — domain event publisher semantics:**
At-most-once + drop-failing-event + restore-rest: if one publisher call throws, the remaining events in the batch are still dispatched, and the failed event is dropped (not retried). The alternative — at-least-once — requires an outbox table, a polling worker, and idempotency keys on every consumer. We don't have any of that infrastructure yet. The decision is documented; the outbox pattern is on the roadmap.

**M24/M25 — file splits:**
`all-exceptions.filter.ts` (204 LOC) → extracted `database-error-mapper.ts`. `link-header.interceptor.ts` (222 LOC) → extracted `link-header-builder.ts`. Both were over the 200-line guideline. The `link-header-builder.ts` helper was also missing from the commit and had to be added in `48f687b` — the preceding commit extracted the interceptor but forgot to include the file it now imports. That's a build-breaking omission caught only because typecheck ran.

## What We Tried

No reversals on implementation approach. One hot-fix commit (`48f687b`) was needed because `link-header-builder.ts` was referenced but not committed — the interceptor refactor and the helper extraction were staged separately, and the helper fell through. Typecheck caught it. Painful, but better than discovering it in CI.

CSP nonce migration was attempted conceptually; ruled out when it became clear Scalar/Swagger's asset pipeline doesn't expose a nonce hook we can inject from NestJS middleware without forking their UI layer.

## Root Cause Analysis

The volume of medium findings traces back to a single root cause: the packages were built feature-first with correctness patches applied reactively via review. `main.ts` missing shutdown handlers, CLS storing raw userAgent, cache sentinel lacking `Object.hasOwn` — none of these require exotic knowledge. They're the result of moving fast and relying on review to catch what implementation missed.

The 200-line file violations are the same story: files grow organically, nobody hits the brake when the counter crosses 200, and eventually a hygiene pass is needed to extract what should have been a separate module from day one.

## Lessons Learned

- **`unhandledRejection` / `uncaughtException` handlers belong in the initial `main.ts` template, not a hygiene pass.** If your bootstrap file doesn't have them from commit 1, add them now. Missing these means a crashed async initializer exits with no structured log and no graceful drain.
- **At-most-once semantics on event publishers must be documented at the call site, not just in a phase file.** The next person who adds a listener won't read the phase file. They'll read the code. Put the idempotency contract in a JSDoc comment on the publisher method.
- **`setTimeout(...).unref()` for shutdown hard-stop is not optional.** Without `unref()`, Node's event loop will not exit while the timeout is pending — which defeats the point of a fallback. With `unref()`, the hard-stop fires only if something else is keeping the loop alive (i.e., the stuck resource). This distinction is not in the NestJS docs.
- **Grep-based invariant tests are theater.** They pass when the pattern exists in a file, not when the behavior is correct at runtime. Boot the app in the test if you want to verify wiring.
- **Stage helper files in the same commit as the code that imports them.** A refactor that extracts a module and a helper should be a single atomic commit. Splitting them across commits creates a transient broken state that typecheck will catch — but only if typecheck runs between commits, which in a squash workflow it often doesn't.
- **CSP `'unsafe-inline'` on script-src is not "good enough" if the app eventually handles authenticated sessions.** The current stance is acceptable for a Swagger-only surface. The moment any authenticated route is added to the Swagger UI scope, nonce migration becomes urgent.

## Next Steps

- **M8 nonce migration**: schedule a browser-scout session when Scalar/Swagger version is pinned and a dev has a browser environment available. Until then, the locked directives (frame-ancestors, object-src, base-uri, form-action) remain the guard. Owner: security-adjacent sprint, timeline TBD.
- **M6 outbox pattern**: before the first production event consumer ships, decide whether at-most-once is acceptable for that consumer's contract. If not, implement outbox table + polling worker. Do not ship an at-most-once publisher to a consumer that assumes at-least-once delivery without documenting the gap explicitly. Owner: engineer implementing first background event feature.

## Unresolved Questions

1. When to schedule the browser-scout session for M8 nonce migration? No CLI path exists — needs a real browser run against Scalar's asset pipeline to enumerate inline script hashes.
2. Does M6 at-most-once need upgrading to outbox-backed at-least-once before the first production event consumer ships, or is the current semantics acceptable for the initial consumers?
