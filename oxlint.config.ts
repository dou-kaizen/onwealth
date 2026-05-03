import { base, depend, drizzle, node, promise, unicorn, vitest } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

/**
 * Single root oxlint config for the entire monorepo.
 *
 * Per-package configs are intentionally NOT used — IDE plugin (oxc-vscode)
 * config discovery becomes flaky across nested workspaces. One root file
 * keeps editor + CLI in lockstep. Per-package needs are expressed via the
 * `overrides[].files` glob block below.
 *
 * Plugin set: union of every package's needs. The cost (~5-10% lint time
 * for plugins not relevant to a given file) is acceptable to avoid the
 * IDE-vs-CLI divergence.
 */
export default defineConfig({
  extends: [
    base(),
    unicorn(),
    depend(),
    node(),
    promise(),
    drizzle({
      rules: {
        'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: 'db' }],
        'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: 'db' }],
      },
    }),
    vitest({ files: ['**/*.{test,spec}.ts', '**/__tests__/**/*.ts'] }),
  ],
  ignorePatterns: [
    '**/node_modules',
    '**/dist',
    '**/.turbo',
    '**/coverage',
    '**/*.tsbuildinfo',
  ],
  rules: {
    // NestJS exception filter `.catch()` is not Promise.catch()
    'promise/valid-params': 'off',
    // Empty barrel files are intentional in package skeletons
    'unicorn/no-empty-file': 'off',
    // Pure-types packages re-export module specifiers without renaming
    'unicorn/require-module-specifiers': 'off',
    // Nest bootstrap uses void IIFE, not top-level await
    'unicorn/prefer-top-level-await': 'off',
  },
  overrides: [
    {
      files: ['**/*.{ts,mts,cts,tsx}'],
      rules: {
        // NestJS empty decorated classes are valid (modules, controllers)
        'typescript/no-extraneous-class': ['error', { allowWithDecorator: true }],
        // NestJS DI requires runtime class references — disable without type-aware linting
        'typescript/consistent-type-imports': 'off',
      },
    },
    {
      // DTO files conventionally bundle related request/response classes;
      // test files declare fixtures and helper classes inline.
      files: ['**/dtos/**/*.ts', '**/__tests__/**/*.ts', '**/*.{test,spec}.ts'],
      rules: {
        'max-classes-per-file': 'off',
      },
    },
    {
      // Drizzle schemas are organised by domain table — relative parent
      // imports between sibling schema files are the natural layout.
      // Platform internals cross-reference sibling subpaths (filters →
      // config, interceptors → decorators) which can't import via the
      // package's own subpath exports without circular resolution.
      files: [
        'packages/database/src/schemas/**/*.ts',
        'packages/platform/src/**/*.ts',
      ],
      rules: {
        'import/no-relative-parent-imports': 'off',
      },
    },
    {
      // Test descriptions conventionally use PascalCase class / Method names.
      files: ['**/__tests__/**/*.ts', '**/*.{test,spec}.ts'],
      rules: {
        'jest/prefer-lowercase-title': 'off',
      },
    },
  ],
})
