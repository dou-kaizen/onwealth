import type { DynamicModule } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '@/app/config/env.schema'

import type { DrizzleAsyncOptions } from './db.port.js'
import { DB_TOKEN } from './db.port.js'
import { createDrizzleInstance } from './db.provider.js'
import { DrizzleService } from './drizzle.service.js'

/**
 * Drizzle database module
 *
 * Uses the Dynamic Module pattern, similar to @nestjs/typeorm.
 * - forRoot(): configure with the default ConfigService
 * - forRootAsync(): configure with a custom factory function
 *
 * Wiring strategy: a single DrizzleService factory holds both db and pool.
 * DB_TOKEN is aliased to service.db so existing @Inject(DB_TOKEN) consumers
 * remain unchanged. DrizzleService.onModuleDestroy() drains the pool on SIGTERM.
 */
@Global() // @global-approved: shared DB connection — every context's repositories depend on it.
@Module({})
export class DrizzleModule {
  /**
   * Create the global database connection using the default ConfigService.
   * Should be called once in AppModule.
   */
  static forRoot(): DynamicModule {
    return {
      module: DrizzleModule,
      providers: [
        {
          provide: DrizzleService,
          inject: [ConfigService],
          useFactory: (configService: ConfigService<Env, true>): DrizzleService => {
            const { db, pool } = createDrizzleInstance({
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
            return new DrizzleService(db, pool)
          },
        },
        // DB_TOKEN aliases to DrizzleService.db so all @Inject(DB_TOKEN) consumers work unchanged.
        {
          provide: DB_TOKEN,
          inject: [DrizzleService],
          useFactory: (service: DrizzleService) => service.db,
        },
      ],
      exports: [DB_TOKEN, DrizzleService],
    }
  }

  /**
   * Create the global database connection using a custom factory function.
   * Use this when more flexible configuration is needed.
   *
   * @example
   * DrizzleModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     connectionString: config.get('DATABASE_URL'),
   *     pool: { max: 20 },
   *   }),
   * })
   */
  static forRootAsync(options: DrizzleAsyncOptions): DynamicModule {
    return {
      module: DrizzleModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: DrizzleService,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]): Promise<DrizzleService> => {
            const moduleOptions = await options.useFactory(...args)
            const { db, pool } = createDrizzleInstance(moduleOptions)
            return new DrizzleService(db, pool)
          },
        },
        {
          provide: DB_TOKEN,
          inject: [DrizzleService],
          useFactory: (service: DrizzleService) => service.db,
        },
      ],
      exports: [DB_TOKEN, DrizzleService],
    }
  }
}
