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
  /**
   * Process-wide pool reference, populated by the (sync or async) factory.
   *
   * TEST CAVEAT: multiple `forRoot()` / `forRootAsync()` calls in the same
   * process orphan prior pools. e2e harnesses MUST call `app.close()`
   * between app instantiations so `onModuleDestroy` drains the previous
   * pool before the next factory overwrites this field. If parallel app
   * instances become a test requirement, replace this static with a
   * WeakMap keyed on module token (or move the pool onto the module
   * instance via a custom provider).
   */
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
    /**
     * Direct `pg.Pool` access provider. NO consumers today —
     * `grep -rn "@Inject(POOL_TOKEN)"` returns zero hits across the workspace.
     * Kept as a cheap stub for future raw-pool use cases (out-of-band
     * migrations, advisory locks, listen/notify) that bypass Drizzle.
     *
     * If you add an `@Inject(POOL_TOKEN)` consumer, refactor so the pool is
     * returned from `createDrizzleInstance` and resolved through DI ordering
     * rather than read from the `DatabaseModule.activePool` static side-effect
     * (see §4.6 caveat). The static read works today only because no consumer
     * resolves the token during the bootstrap graph.
     */
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
    /**
     * Direct `pg.Pool` access provider. NO consumers today —
     * `grep -rn "@Inject(POOL_TOKEN)"` returns zero hits across the workspace.
     * Kept as a cheap stub for future raw-pool use cases (out-of-band
     * migrations, advisory locks, listen/notify) that bypass Drizzle.
     *
     * If you add an `@Inject(POOL_TOKEN)` consumer, refactor so the pool is
     * returned from `createDrizzleInstance` and resolved through DI ordering
     * rather than read from the `DatabaseModule.activePool` static side-effect
     * (see §4.6 caveat). The static read works today only because no consumer
     * resolves the token during the bootstrap graph.
     */
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
