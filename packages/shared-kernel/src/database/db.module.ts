import type { DynamicModule } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ConfigModule } from '@nestjs/config'
import { databaseConfig } from '../config/database.config.js'
import type { DrizzleAsyncOptions } from './db.port.js'
import { DB_TOKEN } from './db.port.js'
import { createDrizzleInstance } from './db.provider.js'
import { DrizzleService } from './drizzle.service.js'

/**
 * Global Drizzle database module.
 *
 * Follows the Dynamic Module pattern (parallel to `@nestjs/typeorm`):
 * - {@link DrizzleModule.forRoot} — wire with the default `ConfigService`.
 * - {@link DrizzleModule.forRootAsync} — wire with a custom factory.
 *
 * **Wiring strategy:** a single {@link DrizzleService} factory owns both
 * `db` and the underlying pg `Pool`. {@link DB_TOKEN} aliases to
 * `service.db` so existing `@Inject(DB_TOKEN)` consumers stay unchanged.
 * `DrizzleService.onModuleDestroy()` drains the pool on `SIGTERM`.
 */
@Global() // @global-approved: shared DB connection — every repository depends on it.
@Module({})
export class DrizzleModule {
  /**
   * Wire the global Drizzle instance from the default `ConfigService`.
   *
   * Call once in `AppModule`. Uses `ConfigModule.forFeature(databaseConfig)`
   * so `databaseConfig.KEY` always resolves — mirrors the `QueueModule`
   * pattern. NestJS dedupes if the host already registered the same factory
   * globally, so this remains safe under `AppModule`.
   */
  static forRoot(): DynamicModule {
    return {
      module: DrizzleModule,
      imports: [ConfigModule.forFeature(databaseConfig)],
      providers: [
        {
          provide: DrizzleService,
          inject: [databaseConfig.KEY],
          useFactory: (dbConfig: ConfigType<typeof databaseConfig>): DrizzleService => {
            const { db, pool } = createDrizzleInstance({
              connectionString: dbConfig.url,
              pool: {
                max: dbConfig.pool.max,
                min: dbConfig.pool.min,
                idleTimeoutMillis: dbConfig.pool.idleTimeoutMillis,
                connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMillis,
              },
            })
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

  /**
   * Wire the global Drizzle instance from a custom async factory.
   *
   * Use when the default `databaseConfig` cannot express the desired
   * options (e.g. dynamic per-tenant `connectionString`, secrets pulled
   * from a vault, multi-pool setups).
   *
   * @example
   *   DrizzleModule.forRootAsync({
   *     imports: [ConfigModule],
   *     inject: [ConfigService],
   *     useFactory: (config: ConfigService) => ({
   *       connectionString: config.get('DATABASE_URL'),
   *       pool: { max: 20 },
   *     }),
   *   })
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
