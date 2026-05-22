/**
 * Shared dependency-cruiser base config for all workspace packages.
 *
 * Each package's `.dependency-cruiser.mjs` extends this file and appends its
 * own layer-specific forbidden rules. Only rules + options that are identical
 * across every package live here (no-circular + cruise options).
 *
 * NOTE: when this file changes, turbo must re-run the `deps` task — it is
 * registered in `turbo.json` `globalDependencies` for that reason.
 */
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
