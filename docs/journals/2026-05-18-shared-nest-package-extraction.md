# Shared NestJS Package Extraction

**Date**: 2026-05-18 16:35
**Severity**: Medium
**Component**: Monorepo package architecture — `packages/shared-kernel`, `packages/nest-http`
**Status**: Resolved

## What Happened

All cross-cutting NestJS infrastructure lived in `apps/api`. A planned worker service would have duplicated it verbatim. Extracted into two pnpm workspace packages via a 6-phase `/cook --auto` plan (`plans/260518-1127-shared-nest-package-extraction/`).

- `@onwealth/shared-kernel` — transport-agnostic: config namespaces (`registerAs` for app/db/cache), `DB_TOKEN`/`CACHE_PORT` symbols, database module, domain events, nestjs-pino logger, cache port, `Env`/zod schema, decorators. Zero HTTP deps — worker-safe.
- `@onwealth/nest-http` — HTTP layer: exception filters, interceptors (correlation-id, trace-context, request-context, timeout, location/link headers, transform), ETag middleware, Terminus health, http/throttle/cls/swagger/validation/security configs, HTTP bootstrap.

Enforced dep DAG: `apps/api → @onwealth/nest-http → @onwealth/shared-kernel → @onwealth/database`. Per-package dependency-cruiser configs validate at every CI run.

## The Brutal Truth

The bootstrap design took the most thinking. The naive approach — `createHttpApp(module)` calling `NestFactory.create` inside — fails in tests because `TestingModule` is already compiled and `NestFactory.create` rejects it. This is the kind of thing you don't discover until you actually wire up a test, and it forces a real architectural decision: the shared unit must accept an *app*, not a *module*. Prior test helpers and `main.ts` had quietly drifted from each other. The refactor fixed that drift as a side-effect, which is the only satisfying part.

The tsdown `neverBundle` lesson cost time. Bundling NestJS packages creates dual-module singleton instances, silently breaking DI token identity — `DB_TOKEN` in the bundle is a *different* `Symbol` than `DB_TOKEN` in the consumer. Zero runtime error, just injection failures that look like misconfiguration. A dedicated integration test (`di-token-identity.spec.ts`) was added specifically to catch this regression.

## Technical Details

**Bootstrap API (final):**
```ts
// packages/nest-http/src/bootstrap/configure-http-app.ts
export async function configureHttpApp(app: INestApplication, options?: HttpAppOptions): Promise<void>

// packages/nest-http/src/bootstrap/create-http-app.ts
export async function createHttpApp(module: Type): Promise<INestApplication>
// thin wrapper: NestFactory.create → configureHttpApp → return app
```

`apps/api/src/main.ts` is now ~15 lines: call `createHttpApp`, attach logger, listen, print banner.

**tsdown config (critical section):**
```ts
// packages/nest-http/tsdown.config.ts
external: ['@nestjs/*', '@onwealth/shared-kernel', 'reflect-metadata', ...]
// Every peer must be in neverBundle — one omission = silent DI breakage
```

**turbo.json change:**
```jsonc
// Before: typecheck depended on sibling typechecks
"dependsOn": ["^typecheck"]
// After: apps/api typecheck needs dist/*.d.mts from packages
"dependsOn": ["^build"]
```

**CI fix:** `ci` job ran `di-token-identity.spec.ts` (instantiates real `pg.Pool` + `KeyvRedis`) with no service containers. Added `services: postgres + redis` blocks. Also changed CI test step from `--filter api` to `pnpm turbo test` so new package specs run.

## What We Tried

- `createHttpApp(module)` accepting a module directly — rejected; tests pass `TestingModule`, `NestFactory.create` refuses it.
- Bundling peer deps in tsdown — silently broke DI token identity; `CACHE_PORT` injections returned `undefined`.
- `turbo typecheck` depending on `^typecheck` — apps/api failed to resolve `@onwealth/*` types because `dist/` hadn't been emitted; changed to `^build`.

## Root Cause Analysis

No single failure — three independent design oversights caught during implementation:

1. **Bootstrap**: assuming `NestFactory.create` could wrap any module including `TestingModule`. It can't. The app must be injected.
2. **Bundling**: assuming tsdown `external` alone was sufficient. `neverBundle` is the actual guard; `external` only affects import resolution, not symbol identity across module instances.
3. **Turbo task graph**: assuming typecheck could resolve `.d.mts` without a prior build. Types live in `dist/`, which requires build to run first in a fresh CI environment.

## Lessons Learned

- **Shared NestJS packages: always accept `INestApplication`, never instantiate inside.** Makes the unit testable without a real server and eliminates test/prod bootstrap drift.
- **`neverBundle` every peer in tsdown.** Missing one peer creates a second copy of its module in the bundle. DI tokens are compared by reference; two `Symbol('DB_TOKEN')` are not equal. Add a symbol-identity integration test as a regression guard — it's cheap and catches the exact failure mode.
- **Guard token identity explicitly.** `di-token-identity.spec.ts` verifies `DB_TOKEN` and `CACHE_PORT` are the same object reference across package boundaries. Without it, the bug surfaces as a mysterious `undefined` injection at runtime.
- **Turbo `typecheck` for apps should depend on `^build`, not `^typecheck`.** Packages emit `.d.mts` only after build; type resolution fails in CI without it.
- **Barrels with semantic comment groups conflict with biome `organizeImports`.** Disable that assist rule for barrels or accept the warning; `biome lint` (the CI gate) is not affected.

## Next Steps

- [ ] Push branch `init-infrastructure` and open PR — 6 commits ready, not yet pushed. Owner: dev.
- [ ] Resolve non-fatal `MISSING_EXPORT` dts-rollup warnings from tsdown when `@types/express@5` namespace types roll up — cosmetic now, but will confuse the next person touching the build. Likely requires explicit re-export of the Express namespace in nest-http's index. Owner: TBD.
- [ ] Worker package (`packages/worker` or similar) — the reason this extraction happened. When scaffolded, it should depend on `@onwealth/shared-kernel` only; verify dep-cruiser rule enforces this from day one.

---

## Unresolved Questions

- Is the `MISSING_EXPORT` tsdown warning for `@types/express@5` namespace types a tsdown bug or a missing explicit re-export in `packages/nest-http/src/index.ts`? Need to check tsdown issue tracker.
- Should `di-token-identity.spec.ts` be promoted to a required gate in the turbo `test` pipeline, or is it sufficient as an opt-in spec in the `nest-http` package? Currently runs with `pnpm turbo test` but not isolated.
