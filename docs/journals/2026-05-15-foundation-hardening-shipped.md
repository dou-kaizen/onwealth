# Foundation Hardening Cook: Shipped and Green

**Date**: 2026-05-15 12:56
**Severity**: Medium
**Component**: `@onwealth/platform`, `@onwealth/core`, `apps/api` bootstrap, CI pipeline
**Status**: Resolved (branch `init-infrastructure`, 4 commits, verification green)

## What Happened

Closed out the foundation-hardening cook across 4 commits: request security tightening, cluster-safe Redis throttler storage, platform dead-code removal, and supply-chain pinning with a coverage gate. Lint, format, typecheck, test, build, and coverage all passed before push.

## The Brutal Truth

Two things hurt more than they should have. First, `pnpm lint` was getting intercepted by RTK's proxy and silently routing to ESLint instead of oxlint — lost time diagnosing spurious `promise/always-return` failures before realising the fix was an async IIFE refactor, not a config change. Second, the `/coverage` gitignore entry only matches the monorepo root; `apps/api/coverage/` slips straight through. We flagged it and left it. That is the kind of small rot that becomes a "how did 50MB of coverage HTML end up in git" incident six months from now.

## Technical Details

Key decisions baked into the four commits:

- **Two ioredis clients**: NestJS DI calls the factory twice (storage client + close handle). Deduplication would require a shared module re-export that adds complexity with no reliability gain. Accepted as caveat; documented in module docstring.
- **`enableOfflineQueue: true` (ioredis default kept)**: Redis blip queues throttler commands instead of throwing 500s. The alternative — `false` + catch-and-pass — is more complex and degrades rate-limiting silently. Queue depth is bounded by Redis reconnect window.
- **CSP/CDN pin (original plan §3.2) dropped**: Scalar CDN override (`cdn: 'https://cdn.scalar.com/scalar-app.js'`) confirmed valid via package types pre-flight. Hash pinning added zero security on top of the HTTPS lock already in place. Dropped without regret.
- **RFC 9457 `type` fallback**: `about:blank` used when `configService` is unavailable at error construction time — matches spec, avoids constructing a synthetic URI that could itself be wrong.
- **Per-phase commits over squash**: Review traceability wins over a clean linear history. CSP split rode with the security commit because both touched `main.ts` in the same pass.

**oxlint gotcha**: `promise/always-return` fires on empty `.then(() => {})` lambdas. Refactored to async IIFE with try/catch. Not obvious, not documented upstream.

## Root Cause Analysis

No production incidents. The friction was toolchain opacity (RTK intercept, oxlint rule behaviour) and the gitignore omission — none of which were caught in planning because they only surface during execution. The two-client Redis caveat was a known NestJS DI constraint, not a mistake.

## Lessons Learned

- **Check RTK intercept before diagnosing lint failures.** If `pnpm lint` behaves unexpectedly, run `rtk proxy pnpm lint` to verify the real output.
- **oxlint `promise/always-return` does not accept empty callbacks.** Use `async () => { try { await x } catch {} }` pattern.
- **`/coverage` in `.gitignore` is root-anchored.** Any workspace package spills through. Pattern must be `**/coverage/`.
- **Verify CDN override types before planning CSP hash strategy.** One pre-flight check eliminated an entire plan phase.

## Next Steps

- Fix `**/coverage/` gitignore pattern — no owner, low urgency, high regret potential. Claim before next coverage-generating task.
- Add `2026-05-15` hardening entry to `docs/project-changelog.md`.
- Manual smokes post-deploy: Redis reconnect behaviour, SIGTERM drain timing, multi-replica 429 counter consistency, browser-side `cdn.scalar.com` network request verification.
