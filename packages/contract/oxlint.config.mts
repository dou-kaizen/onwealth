import { base, depend, node, unicorn } from '@infra-x/code-quality/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [base(), unicorn(), depend(), node()],
  ignorePatterns: ['node_modules', 'dist', '.turbo', 'coverage', '*.tsbuildinfo'],
  rules: {
    'unicorn/no-empty-file': 'off',
    'unicorn/require-module-specifiers': 'off',
  },
})
