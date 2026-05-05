import type { InjectionToken, ModuleMetadata } from '@nestjs/common'
import type * as schema from '@onwealth/database'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'

/** DI token for the configured Drizzle instance. */
export const DRIZZLE_TOKEN = Symbol('DRIZZLE_TOKEN')

/** DI token for the underlying pg.Pool — internal; used by lifecycle teardown. */
export const POOL_TOKEN = Symbol('POOL_TOKEN')

/** Strongly-typed Drizzle instance bound to the @onwealth/database schema namespace. */
export type DrizzleDb = NodePgDatabase<typeof schema>

export type Schema = typeof schema

export interface DrizzlePoolOptions {
  max: number
  min: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
}

export interface DrizzleModuleOptions {
  connectionString: string
  pool: DrizzlePoolOptions
}

export interface DrizzleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: InjectionToken[]
  useFactory: (...args: unknown[]) => DrizzleModuleOptions | Promise<DrizzleModuleOptions>
}

export interface DrizzleInstance {
  db: DrizzleDb
  pool: Pool
}
