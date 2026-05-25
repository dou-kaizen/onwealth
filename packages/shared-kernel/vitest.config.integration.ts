import { defineConfig } from 'vitest/config'

// Integration suite — testcontainers spins a real Redis per describe block.
// Larger timeouts cover container pull + worker handshake. Excluded from
// default `pnpm test` to keep the unit suite Docker-free.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
