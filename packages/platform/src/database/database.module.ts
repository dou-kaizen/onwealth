import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { DRIZZLE_TOKEN } from './database.tokens'
import { createDrizzleInstance } from './drizzle.factory'

import type { Env } from '../config/env.schema'
import type { DrizzleAsyncOptions } from './database.tokens'
import type { DynamicModule } from '@nestjs/common'

/**
 * Global Drizzle module.
 *
 * Mirrors the @nestjs/typeorm DynamicModule shape:
 * - `forRoot()` reads `DATABASE_URL` and `DB_POOL_*` from ConfigService
 * - `forRootAsync()` accepts a custom factory for non-standard wiring
 *
 * Repositories inject `@Inject(DRIZZLE_TOKEN)` to receive the typed client.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DRIZZLE_TOKEN,
          inject: [ConfigService],
          useFactory: (configService: ConfigService<Env, true>) => {
            return createDrizzleInstance({
              connectionString: configService.get('DATABASE_URL', { infer: true }),
              pool: {
                max: configService.get('DB_POOL_MAX', { infer: true }),
                min: configService.get('DB_POOL_MIN', { infer: true }),
                idleTimeoutMillis: configService.get('DB_POOL_IDLE_TIMEOUT', { infer: true }),
                connectionTimeoutMillis: configService.get('DB_POOL_CONNECTION_TIMEOUT', {
                  infer: true,
                }),
              },
            })
          },
        },
      ],
      exports: [DRIZZLE_TOKEN],
    }
  }

  static forRootAsync(options: DrizzleAsyncOptions): DynamicModule {
    return {
      module: DatabaseModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: DRIZZLE_TOKEN,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) => {
            const moduleOptions = await options.useFactory(...args)
            return createDrizzleInstance(moduleOptions)
          },
        },
      ],
      exports: [DRIZZLE_TOKEN],
    }
  }
}
