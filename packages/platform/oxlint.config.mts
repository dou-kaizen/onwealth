import { base, depend, node, promise, unicorn } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base(), unicorn(), depend(), node(), promise()],
  ignorePatterns: ['node_modules', 'dist', '.turbo', 'coverage', '*.tsbuildinfo'],
  rules: {
    'promise/valid-params': 'off',
    'typescript/consistent-type-imports': 'off',
    'typescript/no-extraneous-class': ['error', { allowWithDecorator: true }],
    'unicorn/no-empty-file': 'off',
    'unicorn/require-module-specifiers': 'off',
  },
})
