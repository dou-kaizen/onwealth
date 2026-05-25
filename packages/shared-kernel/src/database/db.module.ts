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
      // `ConfigModule.forFeature(databaseConfig)` registers the typed factory
      // locally so `databaseConfig.KEY` always resolves — matches QueueModule
      // pattern. NestJS dedupes if the host already registered the same factory
      // globally, so this is safe to use under AppModule too.
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
