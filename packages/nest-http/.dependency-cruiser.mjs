/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies break tooling and signal layering issues.',
      from: {},
      to: { circular: true },
    },
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
        'nest-http must not import @onwealth/database directly. Database access goes through @onwealth/shared-kernel (DB_TOKEN).',
      from: { path: '^src/' },
      to: { path: '(packages/database|@onwealth/database)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src/',
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
