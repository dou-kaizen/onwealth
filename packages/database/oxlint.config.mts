import { base, depend, drizzle, node, unicorn } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [
    base(),
    unicorn(),
    depend(),
    node(),
    drizzle({
      rules: {
        'drizzle/enforce-delete-with-where': ['error', { drizzleObjectName: 'db' }],
        'drizzle/enforce-update-with-where': ['error', { drizzleObjectName: 'db' }],
      },
    }),
  ],
  ignorePatterns: ['node_modules', 'dist', '.turbo', 'coverage', '*.tsbuildinfo'],
  rules: {
    'unicorn/no-empty-file': 'off',
    'unicorn/require-module-specifiers': 'off',
  },
  overrides: [
    {
      files: ['src/schemas/**/*.ts'],
      rules: {
        'import/no-relative-parent-imports': 'off',
      },
    },
  ],
})
