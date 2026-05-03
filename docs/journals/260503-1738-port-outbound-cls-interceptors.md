# Port outbound CLS interceptors — closes trace-correlation gap on success path

**Date**: 2026-05-03 17:38
**Severity**: Low
**Component**: `packages/platform/src/interceptors/`, `apps/api/src/main.ts`
**Status**: Resolved

## What Happened

Ported 3 read-only CLS interceptors (`RequestContextInterceptor`, `CorrelationIdInterceptor`, `TraceContextInterceptor`) verbatim from a sister boilerplate into `packages/platform/src/interceptors/` and registered them globally in `apps/api/src/main.ts`. Successful responses now stamp `X-Request-Id`, `X-Correlation-Id`, and `Trace-Id` headers sourced from CLS values that `nestjs-cls` middleware had already populated inbound. The outbound trace-correlation gap is closed — for the success path.

## The Brutal Truth

A deliberate non-issue, which is the best kind. The plan was sharp, the code was lifted verbatim, wall time was ~12 min. The only surprise came from a smoke test.

## Technical Details

- `pnpm -r build`: green
- `pnpm depcruise:check`: 0 violations
- `pnpm -r lint`: 0 warnings
- 5 curl smoke tests against `/health`: 4/5 green as expected

Smoke 5 (`GET /nonexistent`) returned a correct RFC 9457 problem+json body with `request_id` populated, but **response headers did NOT carry `X-Request-Id`**. Root cause: Nest's request pipeline runs interceptors only after route resolution succeeds. On 404, the request bypasses controllers and goes straight to the exception filter — interceptors never execute. This is Nest's by-design behavior, not a regression.

Code review verdict: `APPROVE_WITH_MINOR`. Only nit: 3 dead `tap(() => {})` calls in the interceptors (verbatim from boilerplate). Plan explicitly locked verbatim form — lint did not flag it, decision stands.

## What We Tried

Nothing failed. Verbatim port + wiring. No re-derivation required.

## Root Cause Analysis

No failure to analyze. The 404-missing-header behavior is structural: error correlation on unmatched routes flows through the RFC 9457 body (`request_id` extension field), not response headers. Both paths consume the same CLS source — the delivery mechanism differs by design.

## Lessons Learned

1. **Nest interceptors don't fire on 404s.** Any future "why no `X-Request-Id` header on 4xx?" question has a one-line answer: route resolution failed, interceptors never ran. The body still carries `request_id` via the exception filter. This is not a gap — it's a structural reality to document and accept.

2. **Locked plan decisions deserve respect.** The `tap(() => {})` nit was valid technically, but the plan locked verbatim fidelity for upstream diff reasons. Reviewer flagged it, plan won. Pragmatic: locked decisions should hold unless they cause real harm. Dead `tap` doesn't.

3. **Sharp plans make ports mechanical.** Verbatim code blocks in phase docs mean zero re-derivation. This is the right approach for boilerplate ports — spend the tokens in planning, not in re-invention.

## Next Steps

- None required for this change.
- Future: if full trace-correlation on error paths (headers, not just body) becomes a product requirement, the fix lives in the exception filter layer — not the interceptors.
