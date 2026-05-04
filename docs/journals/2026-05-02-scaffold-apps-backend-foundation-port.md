# Scaffold apps/api + Foundation Infra Port

**Date**: 2026-05-02 18:14
**Severity**: High
**Component**: `apps/api`, `packages/platform`, monorepo root
**Status**: Resolved

## What Happened

Bootstrapped the entire onwealth backend monorepo from nothing: `apps/api` (single NestJS 11 app, CommonJS, SWC builder), five workspace packages (`@onwealth/{tsconfig,contract,core,database,platform}`), pnpm catalog for version pinning, and a narrow port of 9 foundation concerns from `nestjs-boilerplate` into `@onwealth/platform`. End state: `GET /health` returns 200 with AIP-193 envelope, Pino logs include requestId/correlationId/traceparent, depcruise passes architectural lint.

Shipped in 4 commits across the plan's phases, though the commit boundaries don't cleanly map to plan phases — platform port (`33d0e25`) and API wiring (`d74d240`) landed as separate commits while oxlint adoption (`8886dab`) preceded depcruise (`05d08db`).

## The Brutal Truth

The `monorepo:true` decision was made *before* we started because SWC + monorepo mode has known path-resolution issues in the reference. The right call — but we had to trust that constraint from day one without re-validating it in this codebase. If SWC path resolution bites us later, we made the tradeoff blind.

The `set-cookie` redaction in Pino was added structurally (redactPaths in `redaction.config.ts`) but never smoke-verified at runtime — a smoke test endpoint was deferred indefinitely. That means the protection is untested. Future-you: do not assume redaction works until you curl a response with `set-cookie` and confirm it disappears in logs.

## Technical Details

- **436 insertions** in `bde38b7`: scaffold skeleton (SWC `.swcrc` CJS, 10 subpath exports in `platform/package.json`, composite `tsconfig.json` project refs, pnpm catalog in `pnpm-workspace.yaml`)
- **1,311 insertions** in `33d0e25`: 30 files ported to `@onwealth/platform/src/` (cls, config, database, decorators, filters, interceptors, logger, pipes, throttler)
- CLS setup callback in `cls.config.ts`: idGenerator reads `x-request-id` header OR `randomUUID()` — but at this stage only outbound header stamping was NOT yet wired (added in `260503-1635`)
- `pnpm depcruise:check` wired as root-level script; `.dependency-cruiser.cjs` enforces `core-no-nestjs`, `core-no-runtime-libs`, `contract-no-nestjs`, `database-no-nestjs` at severity `error`
- `packages/core/**` zero `@nestjs/*` imports: enforced by depcruise, not just convention

## Root Cause Analysis

This is day-zero work — there was no prior state to break, only design choices to get right. The main architectural bets: single app (not `monorepo:true`), CommonJS (not ESM), `tsc -b` for packages (not SWC), subpath exports on platform (not a single barrel). All of these were deliberate tradeoffs copied from a reference that had already paid the pain on those questions.

## Lessons Learned

- **Subpath exports require `exportsFields` in depcruise config.** `enhancedResolveOptions.exportsFields` must list `'exports'` explicitly or depcruise can't resolve `@onwealth/platform/cls` and reports phantom violations.
- **`tsc -b` for packages, SWC for the app** is not just preference — it's the only pairing where decorator metadata is guaranteed correct without manual SWC transform config duplication per package.
- **Smoke-test what you claim is protected.** The `set-cookie` redaction gap is the canonical example of structural-but-unverified safety.

## Next Steps

- Verify `set-cookie` header redaction at runtime before any auth module ships — create a temp endpoint or integration test that sets the header and asserts it's absent from Pino output.
- DDD layer rules in depcruise (presentation-no-database, etc.) deliberately deferred until first feature module — must be added before first feature PR merges.

---

*Backfilled on 2026-05-04. Plan: `plans/260502-0358-scaffold-apps-backend-foundation-port/`.*
