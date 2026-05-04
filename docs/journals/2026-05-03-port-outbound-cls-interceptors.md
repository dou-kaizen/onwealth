# Port Outbound CLS Interceptors for Response Header Stamping

**Date**: 2026-05-03 18:26
**Severity**: Medium
**Component**: `@onwealth/platform/interceptors`, `apps/api/src/main.ts`
**Status**: Resolved (journal entry was created then deleted in `8fd43a5`; recreated from scratch)

## What Happened

CLS was populating `requestId`, `correlationId`, and `traceId` on every inbound request since the scaffold — but none of those values were making it onto response headers. The success path was observability-dark: clients had no way to extract the requestId from a 200 response short of parsing the error body on a 4xx.

Ported 3 interceptors verbatim from `nestjs-boilerplate` into `packages/platform/src/interceptors/`: `RequestContextInterceptor` (stamps `X-Request-Id`), `CorrelationIdInterceptor` (stamps `X-Correlation-Id`), `TraceContextInterceptor` (stamps `Trace-Id` from W3C traceparent traceId segment). All three registered in `InterceptorsModule` providers + exports, then wired global in `apps/api/src/main.ts` via `app.get()` + `useGlobalInterceptors()` after `TimeoutInterceptor`, before `TransformInterceptor`.

A journal entry was written in `fe0b841` but deleted in `8fd43a5` ("remove stale journal"). This entry is a reconstruction from diffs and plan files.

## The Brutal Truth

This gap existed from day one of the scaffold and nobody noticed for two full days of foundation work. The CLS setup was praised as correct in plan reviews — and it is correct for the inbound side. But "inbound correct" and "outbound complete" are two different things, and the plan review focused entirely on the former.

The boilerplate had these interceptors. We ported the foundation infra selectively and left the output-stamping half out. The plan for this fix correctly diagnosed why: "tao trước đoán nhầm là chúng populate CLS (redundant with setup)" — i.e., the interceptors were skipped because they were misread as redundant with the CLS setup callback. They're not. Setup reads inbound headers into CLS. Interceptors read CLS onto outbound headers. Opposite directions, different lifecycle hooks.

The original journal entry being written and then deleted is also worth noting: whatever was in `fe0b841` was superseded or deemed stale enough to remove. No record of why. Reconstruction is based purely on the code diff and plan documentation.

## Technical Details

- **5 files changed, 116 insertions (+), 3 deletions (-)** in `5999e99`.
- Each interceptor follows the same pattern: inject `ClsService`, read one key, call `response.setHeader(...)` synchronously in `intercept()` body BEFORE `next.handle()`, return `next.handle().pipe(tap(() => {}))`. The `tap` is a no-op — it exists to satisfy the RxJS observable contract while keeping the header-set on the inbound interceptor pass.
- Wire order in `main.ts`: `[TimeoutInterceptor, RequestContextInterceptor, CorrelationIdInterceptor, TraceContextInterceptor, TransformInterceptor]`. Order between the 3 CLS interceptors is arbitrary (different headers, no dependency). Order relative to Timeout and Transform matters: timeout must fire first, envelope wrap must be last.
- `InterceptorsModule` providers and exports both updated — if you add to providers but forget exports, `app.get()` in `main.ts` throws "cannot find module in DI context" at boot. Both lists must stay in sync.
- Smoke verified: `curl -i -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" http://localhost:3000/health` returns `Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736` in response headers.
- `ProblemDetailsFilter` continues to inject `request_id` into the RFC 9457 **body** on error path. Both channels (header for success, body for error) are now populated from the same CLS value — correlatable end-to-end.

## Root Cause Analysis

Selective port without reading all three interceptors in the reference. The CLS setup callback and the output-stamping interceptors are co-located in the boilerplate's interceptors directory. Porting the transform and timeout interceptors while skipping the 3 CLS-reading ones was a reading comprehension error — the files were there, the function was different.

## Lessons Learned

- **When porting from a reference, port the entire directory or explicitly justify each skip.** "Looks redundant" is not a skip justification without reading what the code actually does.
- **Inbound middleware correctness does not imply outbound completeness.** CLS setup and CLS header stamping are two separate concerns in two separate lifecycle positions (middleware vs interceptor). Treat them as a pair in any audit.
- **InterceptorsModule providers and exports must be kept in sync manually.** TypeScript does not catch "provider registered but not exported" — it's a silent runtime DI failure.

## Next Steps

- Outbound HTTP propagation interceptor (propagating `traceparent` on outbound HTTP calls to downstream services) is latent — the traceId is in CLS, nothing forwards it yet. Will be needed when any service-to-service call is introduced.
- Unit tests for the 3 interceptors are still missing — header stamping logic is trivial but the `ClsService` mock setup is worth having before the first integration hits staging.

---

*Backfilled on 2026-05-04. Original journal deleted in commit `8fd43a5`. Plan: `plans/260503-1635-port-outbound-cls-interceptors/`.*
