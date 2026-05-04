# Foundation Hardening: 6-Phase Pre-Feature Security Pass

**Date**: 2026-05-04 16:49
**Severity**: High
**Component**: `@onwealth/platform`, `@onwealth/core`, API bootstrap (`main.ts`)
**Status**: Resolved (branch `init-infrastructure`, 7 commits, not pushed)

## What Happened

Shipped a full hardening pass against 6 Critical + 11 Important production blockers flagged by adversarial code review. Six phases: graceful shutdown, secret validation, HTTP security headers, error mapping, trace ID integrity, event bus safety. Landed in 7 conventional commits, code-reviewed, docs synced.

## The Brutal Truth

Three of the most important fixes were not in the original plan — they surfaced during code review of code we'd already written. That's not a process win; that's the reviewer catching gaps we should have designed away. Shipping security-critical middleware without unit tests is a debt we're consciously carrying into the first feature module. It will bite us if we forget.

## Technical Details

**Post-hoc fixes (not in plan, caught by reviewer):**

- `I-1`: No CSPRNG traceId generated for requests arriving *without* `traceparent`. Observability blind spot — every cold request had no traceId at all. Fix: unconditional `crypto.randomBytes(16).toString('hex')` on every request, W3C `ff` version and all-zero checks added.
- `POOL_TOKEN` registered in `DatabaseModule` but never exported — would have thrown "DI context not found" at first injection site. Silent until runtime.
- `WORKERS=''` parsed with `Number('')` which returns `0`, silently suppressing the cluster-safety warning. Fixed with `parseInt` + `Number.isFinite` guard.

**Key constants baked in:**
- `trust proxy = 1` (not `true`) — trust only the first hop (LB boundary)
- `x-request-id` / `x-correlation-id` capped at 128 chars, UUID fallback on violation
- `tracestate` CRLF-stripped, 512-char cap
- Pool drain: `Promise.race([pool.end(), timeout(8000)])` — leaves >=22s of K8s 30s grace for HTTP drain
- ProblemDetailsFilter: `MAX_DEPTH=5`, `MAX_TOTAL_ERRORS=100` shared accumulator against adversarial DTOs

**SWC mangling trap:** `this.constructor.name` is non-deterministic under bundler minification. `DomainEvent.eventName` made `abstract readonly`; `IntegrationEvent` re-declares `abstract override readonly`. Every subclass must now supply an explicit string literal — enforced by TypeScript, not convention.

**Helmet path-match edge case:** `app.use('/swagger', mw)` does NOT match `/swagger-json` because Express path-match requires the next char to be `/` or end-of-string. JSON endpoint stays under strict CSP without explicit exclusion. Documented inline in `main.ts`.

**Pino mixin vs. customProps:** `customProps` runs in Express middleware scope, outside CLS. `mixin` runs per-log inside the async hook — sees the regenerated traceId. Used `ClsServiceManager.getClsService()` static singleton with `isActive()` guard for boot/shutdown logs that run before CLS context exists.

## Root Cause Analysis

Plan was adversarial-reviewed before implementation (15 fixes baked in, 5 rejected with rationale). Despite that, three non-trivial gaps slipped through: one observability hole (traceId generation), one DI wiring bug (missing export), one type-coercion silent failure. All three were caught in post-implementation code review, not during planning. Root cause: security-adjacent behavior is hard to fully enumerate in a plan without seeing the actual code path end-to-end.

## Lessons Learned

- **Plan review does not substitute for code review.** Security-critical interceptors need both.
- **`Number('')` returns 0.** Always use `parseInt` + `Number.isFinite` for env var numerics that gate safety logic.
- **DI module exports are a separate concern from DI module providers.** A provider registered but not exported is invisible to consumers and silent until runtime injection.
- **Unconditional CSPRNG, no exceptions.** "Generate traceId only if no inbound header" sounds reasonable until you realize inbound-headerless requests are the majority in cold paths and monitoring gaps.
- **`RESOURCE_NOT_FOUND` + HTTP 422 for FK violations is intentional but client-confusing.** Decision is documented in `code-standards.md`: clients must branch on HTTP status first, error code second. Flag this in any future API consumer docs.

## Next Steps

- **Unit test backfill for `@onwealth/platform`** before first public exposure: CLS sanitization, postgres error mapper, recursion depth guard, pool drain race. No owner yet — must be claimed before feature work ships.
- **N-2 deferred**: REDIS_URL placeholder guard — add when Redis wiring lands.
- **Outbound HTTP propagation interceptor** (next planned feature) will exercise tracestate forwarding + parentId propagation that is currently latent code.
- Push branch once team confirms no further review items.
