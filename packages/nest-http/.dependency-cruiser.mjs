/**
 * @boilerplate/nest-http dependency rules — extends the root base config.
 * Base supplies `no-circular` + cruise options; rules below guard this
 * package's position in the DAG (consumed by apps/api, sits above database).
 */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  extends: '../../.dependency-cruiser.base.mjs',
  forbidden: [
    {
      name: 'nest-http-no-api',
      severity: 'error',
      comment:
        'nest-http is consumed by apps/api — it must never import back from it. Composition belongs in apps/api.',
      from: { path: '^src/' },
      to: { path: '(apps/api)' },
    },
    {
      name: 'nest-http-no-database-direct',
      severity: 'error',
      comment:
        'nest-http must not import @boilerplate/database directly. Database access goes through @boilerplate/shared-kernel (DB_TOKEN).',
      from: { path: '^src/' },
      to: { path: '(packages/database|@boilerplate/database)' },
    },
  ],
}
