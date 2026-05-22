---
phase: 3
title: "Tooling Deps & Hygiene"
status: completed
priority: P3
effort: "3h"
dependencies: [2]
---

# Phase 3: Tooling Deps & Hygiene

## Overview

Fix the remaining 6 Medium tooling/deps findings (#13-#18) and all 6 Low hygiene
findings (#20-#25): turbo cache correctness, dependency hygiene, container-safe
binding, removing HTTP code from the transport-agnostic package, and stale
comments/rules. Mechanical, low-risk; the only judgement call is #17.

## Requirements

- Functional: no runtime behavior change except `app.listen` host binding.
- Non-functional: honest dependency graph, correct turbo caching, no dead
  config rules, package boundaries respected.

## Architecture

`apps/api` is a composition root — it should declare only what it directly
`import`s; transitive deps come from the workspace packages. `@onwealth/shared-kernel`
is transport-agnostic — HTTP-specific code (#17) does not belong there.

## Related Code Files

- Modify: `turbo.json` (#13)
- Modify: `apps/api/package.json` (#14, #15)
- Modify: `pnpm-workspace.yaml` (#15)
- Modify: `apps/api/src/main.ts` (#16)
- Modify: `packages/shared-kernel/src/errors/validation-error.ts` (#17 — delete `TypedResponse`)
- Modify: `packages/shared-kernel/src/logger/logger.config.ts` (#17 — parameterize path filter)
- Modify: `packages/shared-kernel/src/logger/logger.module.ts` (#17)
- Modify: `packages/shared-kernel/package.json` (#18)
- Modify: `packages/nest-http/src/config/swagger.config.ts` (#20)
- Modify: `packages/nest-http/src/interceptors/location-header.interceptor.ts` (#21)
- Modify: `packages/nest-http/package.json` (#22)
- Modify: `apps/api/.dependency-cruiser.mjs` (#23)
- Modify: `packages/shared-kernel/src/index.ts` (#24)

## Implementation Steps

1. **#13 turbo `env`** — in `turbo.json`, add
   `"env": ["NODE_ENV", "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "API_BASE_URL", "ALLOWED_ORIGINS"]`
   to the `test` task (and `outputs: ["coverage/**"]` if absent). Prevents stale
   cache replay when env changes.

2. **#14 Unused `apps/api` deps** — grep `apps/api/src` for each runtime dep.
   Remove any with zero direct `import`: `passport*`, `@nestjs/passport`,
   `@nestjs/jwt`, `@nestjs/schedule`, `bcrypt`, `multer`, `dayjs`, `pg`,
   `postgres`, `@keyv/redis`, `cache-manager`, `keyv`, `drizzle-orm`. Keep what
   `apps/api/src` actually imports — confirmed direct imports:
   `@nestjs/core|common|config|platform-express`, `@nestjs/event-emitter` and
   `@nestjs/throttler` (both imported in `app.module.ts:5-6` — do NOT remove
   these; they are NOT transitive), `nestjs-pino`, `nestjs-cls`,
   `reflect-metadata`, `rxjs`, `zod`. Verify build + tests after removal —
   transitive deps resolve via the workspace packages.

3. **#15 Catalog gaps** — for any `@nestjs/*` / `pino-http` deps that remain in
   `apps/api/package.json` after step 2, add them to `pnpm-workspace.yaml`
   `catalog:` and switch to `"catalog:"`. (If step 2 removes `@nestjs/jwt`,
   `@nestjs/passport`, `@nestjs/schedule` entirely, this narrows to `pino-http`.)

4. **#16 `app.listen` host** — `apps/api/src/main.ts`: `app.listen(port)` →
   `app.listen(port, '0.0.0.0')` for container-safe binding. Also collapse the
   duplicate `app.get(Logger)` (line 12 result discarded) — reuse one reference.

5. **#17 HTTP code out of shared-kernel:**
   - Delete `TypedResponse` from `validation-error.ts` — unused, HTTP-specific, YAGNI.
   - `logger.config.ts`: parameterize the `autoLogging.ignore` path filter via
     `createLoggerConfig`/`LoggerModule.forRoot` instead of hard-coding `/api/`.
     Name the param for its real role — it is an `autoLogging.ignore` allowlist
     (suppresses request-log noise), NOT a generic `excludePaths`. Keep it a
     distinct, clearly-named option so behavior is unchanged. Keep `node:http`
     types only if `pino-http` genuinely needs them; otherwise loosen to
     `pino-http`'s own types.
   - Update `index.ts` exports accordingly.

6. **#18 `pino-pretty` peer** — add `pino-pretty` to `packages/shared-kernel/package.json`
   `peerDependencies` (optional) + `peerDependenciesMeta`, since `logger.config.ts`
   references it as a transport target.

7. **#20 swagger `for...in`** — `swagger.config.ts:36`:
   `for (const path in document.paths)` → `for (const path of Object.keys(document.paths))`.

8. **#21 location-header numeric id** — `location-header.interceptor.ts:50`:
   accept numeric `id` via `String(data.id)`, or emit a `warn` log when `id` is
   absent/non-stringifiable. Pick coercion (simpler) + a clarifying comment.

9. **#22 peer-pin ranges** — `packages/nest-http/package.json` `peerDependencies`:
   exact pins `class-validator: "0.14.2"`, `class-transformer: "0.5.1"`,
   `pg: "8.16.3"` → ranges (`^0.14.2`, `^0.5.1`, `^8.16.3`). Apply the same to
   `shared-kernel`/`database` peer pins if present — EXCEPT `drizzle-orm`: keep
   that pin exact. drizzle 0.x ships breaking changes within minor bumps, so a
   `^0.x` range is unsafe.

10. **#23 Stale dep-cruiser rule** — `apps/api/.dependency-cruiser.mjs`: the
    `api-uses-packages-not-internal-copies` rule targets `src/app/...` paths
    that no longer exist. Either retarget to a still-meaningful pattern or
    remove it. Decide during implementation; document the choice.

11. **#24 Stale barrel comments** — `shared-kernel/src/index.ts`: remove the
    `// domain (Phase 1)` scaffolding comment; make the section-header comment
    placement consistent (header before its export group).

12. **#25** — already folded into Phase 1 step 2 (filter-order comment fixed
    with the reorder). No action here; listed for traceability.

13. Run all gates.

## Success Criteria

- [x] #13: turbo `test` task declares `env`; cache no longer replays across env changes.
- [x] #14: every runtime dep in `apps/api/package.json` has a direct `import` in `apps/api/src`; build + tests green.
- [x] #15: no un-cataloged shared `@nestjs/*` / `pino-http` left in `apps/api`.
- [x] #16: `app.listen` binds `0.0.0.0`; single `Logger` lookup.
- [x] #17: `TypedResponse` gone; `logger.config` path filter parameterized; `index.ts` consistent.
- [x] #18: `pino-pretty` declared as optional peer of `shared-kernel`.
- [x] #20: swagger uses `Object.keys`.
- [x] #21: numeric `id` produces a `Location` header.
- [x] #22: peer deps use ranges, not exact pins — except `drizzle-orm`, which stays exact.
- [x] #23: stale dep-cruiser rule retargeted or removed (documented).
- [x] #24: no stale `Phase 1` comment; barrel grouping consistent.
- [x] Gates: `pnpm build` · `pnpm typecheck` · `pnpm turbo test` · `pnpm deps` all green.

## Risk Assessment

- **#14 dep removal** — highest-risk item. A dep imported only transitively but
  needed at runtime could still be required by a NestJS dynamic-module string
  ref. Mitigate: remove incrementally, run `pnpm build` + full test suite +
  `pnpm start:prod` smoke after each batch.
- **#17 logger parameterization** — changes `LoggerModule.forRoot` signature;
  `apps/api`'s `app.module.ts` call site must pass the new `autoLogging.ignore`
  param. Verify the call site updates and logging still skips `/api/` health
  spam — the param is the ignore allowlist, not a generic `excludePaths`.
- **#23** — removing a dep-cruiser rule lowers a guardrail; prefer retargeting
  over deleting if a meaningful pattern exists.

## Security Considerations

- #14 shrinks the dependency surface — fewer packages, fewer future CVEs to
  triage. Net positive.
- No auth/data-protection changes in this phase.
