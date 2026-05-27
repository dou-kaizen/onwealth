/**
 * @boilerplate/shared-kernel dependency rules — extends the root base config.
 * Base supplies `no-circular` + cruise options; rule below guards this
 * package's position as the lowest NestJS layer in the DAG.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  extends: '../../.dependency-cruiser.base.mjs',
  forbidden: [
    {
      name: 'shared-kernel-no-upstream',
      severity: 'error',
      comment:
        'shared-kernel is the lowest NestJS layer in the dep DAG — it must not import from apps/api or @boilerplate/nest-http. Both depend on shared-kernel, not the reverse.',
      from: { path: '^src/' },
      to: { path: '(apps/api|packages/nest-http|@boilerplate/nest-http)' },
    },
  ],
}
