# Foundation Gap-Fill: ErrorCode Migration + Lint Consolidation

**Date**: 2026-05-03 13:37
**Severity**: Medium
**Component**: `@onwealth/platform`, `@onwealth/contract`, monorepo lint config
**Status**: Resolved

## What Happened

Three cleanup passes ran in tight sequence after the scaffold landed:

1. **oxlint adoption** (`8886dab`): per-package `oxlint.config.mts` + `oxfmt.config.mts` extending `@infra-x/code-quality` presets. 10 new config files across 6 packages/apps.
2. **depcruise** (`05d08db`): single `.dependency-cruiser.cjs` at repo root; 5 architectural boundary rules at `error` severity.
3. **ErrorCode migration + oxlint consolidation** (`9f28d72`, `782c526`): ErrorCode moved from `@onwealth/contract` → `@onwealth/platform/error-codes`; per-package oxlint configs deleted and replaced with single root config; pagination DTOs killed before they were ever used.

The plan was actually a v2 revision — v1 had placed ErrorCode in `@onwealth/contract` which turned out to be wrong because the FE will codegen from OpenAPI and never imports backend error catalogs directly. Caught during re-evaluation before v1 cook shipped in the wrong place.

## The Brutal Truth

We created 10 oxlint config files in `8886dab` and deleted 5 of them one commit later in `782c526`. That is a real waste. The consolidation to a single root config was the right call — but it should have been the first call. Having per-package configs that then collapse into one root config is exactly the kind of intermediate state that turns up at 2am as "why does this package have a config that does nothing?". The commit message even admits it: "refactor: consolidate oxlint to single root config."

The pagination DTO removal was the most honest YAGNI call in this plan. Six files, zero consumers. Killed. Future feature module will define its own pagination shape when it has an actual requirement.

## Technical Details

- `packages/platform/src/error-codes/error-code.ts`: 49-line `as const` object with 35 codes across 7 categories (Validation, Resource, Conflict, Auth, Authorization, General). Type is `(typeof ErrorCode)[keyof typeof ErrorCode]`.
- Two filter fixes caught by reviewer and incorporated: `fallbackCodeMap` updated — HTTP 408 → `REQUEST_TIMEOUT` (was missing), pg error 23502 (NOT NULL) → `REQUIRED_FIELD` (was wrongly mapped).
- `REQUEST_TIMEOUT_MS` added to `env.schema.ts` with `parseInt` + `.refine(v => v >= 1000)` guard — this is the pre-hardening config; the hardening pass later tightened to `Number.isFinite`.
- oxlint consolidation diff: 110 deletions, 16 insertions — net -94 lines of config noise.
- `pnpm depcruise:check` reported 55 modules, 62 deps, 0 violations after cleanup.

## Root Cause Analysis

The v1 → v2 plan revision happened because the original placement of ErrorCode in `@onwealth/contract` was based on an incorrect assumption: that the FE would import shared types directly. Re-evaluating the actual consumer graph (FE = codegen, no direct backend type imports) exposed the mistake before code shipped. Caught by plan re-evaluation, not by a failing test.

## Lessons Learned

- **Decide lint config topology before scaffolding packages.** Root-level single config vs per-package config is a topology decision. Making it per-package first and consolidating later is waste.
- **Map actual consumers before placing a type.** `@onwealth/contract` was created as the obvious home for shared types, but "shared" turned out to mean "shared between platform filters" — i.e., not shared at all. BE-only catalog belongs in platform.
- **YAGNI on DTOs is non-negotiable at scaffold stage.** Six pagination files with zero consumers added zero value and would have become sticky debt the moment any feature module glanced at them.

## Next Steps

- DDD layer depcruise rules remain deferred; must be added before first feature module merges.
- `@onwealth/contract` at this point holds only `ProblemDetailsDto` + `ValidationErrorItem` — already identified as candidates for further consolidation (addressed in next plan).

---

*Backfilled on 2026-05-04. Plan: `plans/260503-1404-foundation-gap-fill-port/`.*
