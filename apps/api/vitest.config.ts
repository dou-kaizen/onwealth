import { defineConfig } from 'vitest/config'

/**
 * Vitest config for apps/api.
 *
 * Decorator metadata is required for Nest controller/provider tests.
 * `@swc/core` consumes the local `.swcrc` automatically when invoked
 * through vite-node, so no explicit transform plugin is wired here.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/*.spec.ts', '**/dist/**'],
    },
  },
})
