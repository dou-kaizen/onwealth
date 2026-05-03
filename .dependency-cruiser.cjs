/**
 * Architectural boundary rules for the @onwealth monorepo.
 *
 * Single root config — `monorepo: true` mode is intentionally NOT used so
 * one rule set covers `packages/*` + `apps/*`. Subpath exports on
 * `@onwealth/platform` are resolved via depcruise 16's
 * `enhancedResolveOptions.exportsFields`.
 *
 * Severity policy: every rule below is `error`. No warn/info rules in v1.
 * DDD layer rules (presentation-no-database, etc.) are deferred until the
 * first feature module lands in `apps/api/src/modules/{ctx}/`.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies anywhere in the monorepo',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-nestjs',
      severity: 'error',
      comment: '@onwealth/core MUST be framework-agnostic (no @nestjs/*)',
      from: { path: '^packages/core/' },
      to: { path: '(^|/)@nestjs/', dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'unknown'] },
    },
    {
      name: 'core-no-runtime-libs',
      severity: 'error',
      comment: '@onwealth/core MUST NOT depend on runtime infrastructure libs',
      from: { path: '^packages/core/' },
      to: {
        path: '(^|/)(ioredis|pino|bcrypt|date-fns|drizzle-orm|pg|postgres)(/|$)',
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'unknown'],
      },
    },
    {
      name: 'database-no-nestjs',
      severity: 'error',
      comment: '@onwealth/database schemas/migrations MUST stay framework-agnostic',
      from: { path: '^packages/database/' },
      to: { path: '(^|/)@nestjs/', dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'unknown'] },
    },
    {
      name: 'platform-no-feature',
      severity: 'error',
      comment: '@onwealth/platform MUST stay foundation-only — no feature symbols',
      from: { path: '^packages/platform/' },
      to: { path: '(auth|audit|user-feature|telegram|bot)\\.' },
    },
    {
      name: 'api-no-platform-internal',
      severity: 'error',
      comment: 'apps/api MUST consume @onwealth/platform via package + subpath, never relative',
      from: { path: '^apps/api/' },
      to: { path: '^packages/platform/src/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['main', 'types'],
    },
    exclude: { path: 'node_modules|dist|\\.tsbuildinfo|\\.turbo|coverage|\\.spec\\.' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
