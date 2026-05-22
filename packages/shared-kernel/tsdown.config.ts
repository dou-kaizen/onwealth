import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  tsconfig: './tsconfig.json',
  deps: {
    // Keep every peer dependency external — bundling a NestJS package would
    // create dual-module singletons and break DI token identity at runtime.
    neverBundle: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/config',
      '@nestjs/event-emitter',
      '@nestjs/cache-manager',
      'drizzle-orm',
      'drizzle-orm/pg-core',
      'drizzle-orm/node-postgres',
      'pg',
      'nestjs-pino',
      'cache-manager',
      '@keyv/redis',
      'keyv',
      'zod',
      '@onwealth/database',
    ],
  },
})
