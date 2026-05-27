import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/index.ts',
        '**/*.module.ts',
        'src/__tests__/**', // exclude test helpers/setup from denominator
      ],
      thresholds: {
        // Ratcheted baseline. Policy: each phase measures current coverage and
        // sets the floor at `max(previous_floor, current - 5%)`. Decay below the
        // floor fails the build. Target: 80/70/80/80 once domain modules land.
        // Current baseline is 0/0/0/0 — `apps/api` only exercises `main.ts`
        // bootstrap; substantive code lives in `@boilerplate/nest-http` and
        // `@boilerplate/shared-kernel` (their own test suites; coverage scripts
        // to be added per package when their first domain module lands).
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
      },
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
          dynamicImport: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: 'esnext',
        keepClassNames: true,
      },
      module: {
        type: 'es6',
      },
    }),
    tsconfigPaths(),
  ],
})
