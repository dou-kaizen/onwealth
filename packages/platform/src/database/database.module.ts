import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { DRIZZLE_TOKEN, POOL_TOKEN } from './database.tokens'
import { createDrizzleInstance } from './drizzle.factory'

import type { Env } from '../config/env.schema'
import type { DrizzleAsyncOptions } from './database.tokens'
import type { DynamicModule, OnModuleDestroy, Provider } from '@nestjs/common'
import type { Pool } from 'pg'

/**
 * Maximum time `pool.end()` may run during shutdown.
 *
 * K8s `terminationGracePeriodSeconds` defaults to 30s. NestJS first calls
 * `httpServer.close()` which waits for in-flight requests, then fires
 * `onModuleDestroy`. Capping `pool.end()` at 8s leaves >=22s for HTTP
 * drain + buffer, preventing a hung idle client from blocking SIGTERM
 * past the K8s deadline.
 */
const POOL_DRAIN_TIMEOUT_MS = 8000

/**
 * Global Drizzle module.
 *
 * Mirrors the @nestjs/typeorm DynamicModule shape:
 * - `forRoot()` reads `DATABASE_URL` and `DB_POOL_*` from ConfigService
 * - `forRootAsync()` accepts a custom factory for non-standard wiring
 *
 * Repositories inject `@Inject(DRIZZLE_TOKEN)` to receive the typed client.
 * The pool is held on the module class itself (singleton) so
 * `OnModuleDestroy` can drain it on SIGTERM without an extra wrapper class.
 */
@Global()
@Module({})
export class DatabaseModule implements OnModuleDestroy {
  /** Process-wide pool reference, populated by the (sync or async) factory. */
  private static activePool: Pool | null = null

  static forRoot(): DynamicModule {
    const drizzleProvider: Provider = {
      provide: DRIZZLE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const instance = createDrizzleInstance({
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
        DatabaseModule.activePool = instance.pool
        return instance.db
      },
    }
    const poolProvider: Provider = {
      provide: POOL_TOKEN,
      useFactory: () => DatabaseModule.activePool,
    }
    return {
      module: DatabaseModule,
      providers: [drizzleProvider, poolProvider],
      exports: [DRIZZLE_TOKEN, POOL_TOKEN],
    }
  }

  static forRootAsync(options: DrizzleAsyncOptions): DynamicModule {
    const drizzleProvider: Provider = {
      provide: DRIZZLE_TOKEN,
      inject: options.inject ?? [],
      useFactory: async (...args: unknown[]) => {
        const moduleOptions = await options.useFactory(...args)
        const instance = createDrizzleInstance(moduleOptions)
        DatabaseModule.activePool = instance.pool
        return instance.db
      },
    }
    const poolProvider: Provider = {
      provide: POOL_TOKEN,
      useFactory: () => DatabaseModule.activePool,
    }
    return {
      module: DatabaseModule,
      imports: options.imports ?? [],
      providers: [drizzleProvider, poolProvider],
      exports: [DRIZZLE_TOKEN, POOL_TOKEN],
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = DatabaseModule.activePool
    if (!pool) return
    DatabaseModule.activePool = null
    await Promise.race([
      pool.end(),
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error(`pool.end() timeout after ${POOL_DRAIN_TIMEOUT_MS}ms`)),
          POOL_DRAIN_TIMEOUT_MS,
        )
      }),
    ]).catch((error: Error) => {
      process.stderr.write(`[db-shutdown] ${error.message}\n`)
    })
  }
}
