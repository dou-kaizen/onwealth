# Remove @onwealth/contract: Collapse Types into Platform

**Date**: 2026-05-03 15:57
**Severity**: Medium
**Component**: `@onwealth/contract` (deleted), `@onwealth/platform/problem-details`
**Status**: Resolved

## What Happened

After the gap-fill migration, `@onwealth/contract` held exactly two type files — `ProblemDetailsDto` and `ValidationErrorItem` — both consumed exclusively by platform filters. A package with two files and zero external consumers is pure overhead: a build target, a tsconfig project reference, a depcruise rule, a lockfile entry, and a workspace dep that apps had to declare even though they never imported it.

Single commit `ba5624c`: move both types to `packages/platform/src/problem-details/`, add `./problem-details` subpath export, repoint 3 filter imports to relative `../problem-details`, drop stale `@onwealth/contract` deps from `platform/package.json` and `apps/api/package.json`, delete `packages/contract/` entirely, remove the `contract-no-nestjs` depcruise rule, drop the tsconfig project reference.

## The Brutal Truth

`@onwealth/contract` should never have been created. The rationale was "shared wire-level types between FE and BE" — but that assumption was wrong from the start. FE generates types from OpenAPI; it never imports backend packages directly. The contract package existed for a consumer that doesn't exist and never will in this architecture.

Two plan iterations and one package deletion later, we're at the state we should have started with. The cost: time spent scaffolding, populating, linting, and then deleting a package. The only mitigating fact is we caught it at scaffold stage before any feature module took a dependency on it.

## Technical Details

- **12 files changed, 37 insertions (+), 66 deletions (-)** — net negative, which is the correct direction.
- Files deleted: `packages/contract/package.json`, `packages/contract/tsconfig.json`, `packages/contract/oxfmt.config.mts`, `packages/contract/src/index.ts` + error-codes dir (already moved in previous plan).
- New `packages/platform/src/problem-details/` barrel: `problem-details.dto.ts`, `validation-error.ts`, `index.ts`.
- `packages/platform/package.json` gains `./problem-details` export — consistent with the existing 10-subpath pattern (`./cls`, `./config`, `./logger`, etc.).
- Filter imports changed from cross-package `from '@onwealth/contract'` to same-package relative `from '../problem-details'` — eliminates a workspace dep hop in the build graph.
- `apps/api` had `"@onwealth/contract": "workspace:*"` in its deps despite zero source imports. Audit confirmed zero usage; dep removed. This is the kind of stale dep that causes real confusion during upgrades.
- `contract-no-nestjs` depcruise rule deleted — rule referenced a path that no longer exists; leaving it would not cause a violation (depcruise skips missing paths) but would be misleading documentation.

## Root Cause Analysis

Package proliferation at scaffold stage, justified by an assumption about the consumer graph that was never validated. The "contract package for shared FE/BE types" pattern is reasonable in systems where FE imports backend packages. In a codegen-first FE architecture (openapi-typescript / orval) it is actively wrong. We should have asked "who actually imports this?" before creating the package.

## Lessons Learned

- **Before creating a shared package, name one concrete consumer outside the package.** If you can't name one, the types belong in the package that uses them.
- **Codegen-first FE architecture eliminates the contract package pattern.** Once you commit to OpenAPI as the FE/BE boundary, backend type sharing is a red flag, not a feature.
- **Stale workspace deps in `apps/api/package.json` are silent until upgrade time.** The package compiled fine without `@onwealth/contract` imports — the dep was purely declarative dead weight. Audit `package.json` deps against actual `import` statements periodically.

## Next Steps

- `@onwealth/platform/problem-details` is now the sole home for RFC 9457 DTO types. Any future filter or feature module that needs to construct a `ProblemDetailsDto` manually imports from there.
- When `@nestjs/swagger` lands (next plan), `ProblemDetailsDto` will need to be converted from interface to class with `@ApiProperty` decorators — the subpath location is already correct for that change.

---

*Backfilled on 2026-05-04. Plan: `plans/260503-1511-remove-contract-package/`.*
