/**
 * apps/api dependency rules — extends the root base config.
 * Base supplies `no-circular` + cruise options; rules below guard the
 * in-module DDD layering and the post-extraction package boundaries.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  extends: '../../.dependency-cruiser.base.mjs',
  forbidden: [
    {
      name: 'no-cross-module',
      severity: 'error',
      comment:
        'Cross-module imports are forbidden except via contracts (events, ports). Share code via shared-kernel or decouple through events.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/',
          // Cross-context contracts: domain events and application ports.
          // Per api rules, events live in publisher's domain/events/, ports in publisher's application/ports/
          // (until promoted to shared-kernel when consumers ≥ 2).
          '^src/modules/[^/]+/domain/events/',
          '^src/modules/[^/]+/application/ports/',
        ],
      },
    },
    {
      name: 'service-no-database-runtime',
      severity: 'error',
      comment:
        'Services must not runtime-import @boilerplate/database. Go through repository ports instead. Type-only imports are allowed.',
      from: { path: '^src/modules/[^/]+/application/services/' },
      to: {
        path: '^@boilerplate/database',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'domain-no-external-libs',
      severity: 'error',
      comment:
        'Domain layer must stay free of runtime libraries (@nestjs/*, drizzle, bcrypt, pino, ...). Test files (vitest) are exempt.',
      from: {
        path: '^src/modules/[^/]+/domain/',
        pathNot: '\\.spec\\.ts$',
      },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg'] },
    },
    {
      name: 'presentation-no-database',
      severity: 'error',
      comment:
        'Presentation layer must not access the database directly. Go through application services.',
      from: { path: '^src/modules/[^/]+/presentation/' },
      to: { path: '^(@boilerplate/database|drizzle-orm|pg|postgres)($|/)' },
    },
    {
      name: 'api-uses-packages-not-internal-copies',
      severity: 'error',
      comment:
        'apps/api must consume cross-cutting concerns (filters, interceptors, middleware, health checks, logger config) from @boilerplate/nest-http and @boilerplate/shared-kernel — not re-implement local copies. Retargeted from the obsolete src/app/ path to guard the post-extraction layout.',
      from: { path: '^src/' },
      to: { path: '^src/(filters|interceptors|middleware|health|logger)/' },
    },
  ],
}
