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
      '@nestjs/platform-express',
      '@nestjs/swagger',
      '@nestjs/throttler',
      '@nestjs/terminus',
      '@scalar/nestjs-api-reference',
      'nestjs-cls',
      'class-validator',
      'class-transformer',
      'express',
      'helmet',
      'rxjs',
      'rxjs/operators',
      'drizzle-orm',
      'pg',
      '@onwealth/shared-kernel',
    ],
  },
})
