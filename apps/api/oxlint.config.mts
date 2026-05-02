import { base, depend, node, promise, unicorn, vitest } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [
    base(),
    unicorn(),
    depend(),
    node(),
    promise(),
    vitest({ files: ['**/*.{test,spec}.ts', '**/__tests__/**/*.ts'] }),
  ],
  ignorePatterns: ['node_modules', 'dist', '.turbo', 'coverage', '*.tsbuildinfo'],
  rules: {
    'promise/valid-params': 'off',
    'typescript/consistent-type-imports': 'off',
    'typescript/no-extraneous-class': ['error', { allowWithDecorator: true }],
    'unicorn/prefer-top-level-await': 'off',
  },
  overrides: [
    {
      files: ['**/dtos/**/*.ts', '**/__tests__/**/*.ts'],
      rules: {
        'max-classes-per-file': 'off',
      },
    },
  ],
})
