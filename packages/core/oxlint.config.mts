import { base, depend, unicorn } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base(), unicorn(), depend()],
  ignorePatterns: ['node_modules', 'dist', '.turbo', 'coverage', '*.tsbuildinfo'],
  rules: {
    'unicorn/no-empty-file': 'off',
    'unicorn/require-module-specifiers': 'off',
  },
})
