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
      name: 'shared-kernel-no-upstream',
      severity: 'error',
      comment:
        'shared-kernel is the lowest NestJS layer in the dep DAG — it must not import from apps/api or @onwealth/nest-http. Both depend on shared-kernel, not the reverse.',
      from: { path: '^src/' },
      to: { path: '(apps/api|packages/nest-http|@onwealth/nest-http)' },
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
