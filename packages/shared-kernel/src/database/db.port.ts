import type * as schema from '@boilerplate/database'
import type { InjectionToken, ModuleMetadata } from '@nestjs/common'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/**
 * DI token for the global {@link DrizzleDb} instance.
 *
 * Use `@Inject(DB_TOKEN)` in repositories so they bind against the
 * abstraction. The token is wired to `DrizzleService.db` by
 * {@link DrizzleModule}; consumers never touch the underlying pg `Pool`.
 */
export const DB_TOKEN = Symbol('DB_TOKEN')

/**
 * Strongly-typed Drizzle instance, parameterised by the shared schema export.
 *
 * Drizzle's query builder uses this type parameter to infer relation accessors
 * (`db.query.users.findFirst({ with: { profile: true } })`), so swapping it
 * for a bare `NodePgDatabase` would silently lose autocomplete.
 */
export type DrizzleDb = NodePgDatabase<typeof schema>

/**
 * Re-export of the full schema type for consumers that need to reference
 * table types without importing `@boilerplate/database` directly.
 */
export type Schema = typeof schema

/**
 * pg connection pool tunables exposed by {@link DrizzleModuleOptions}.
 *
 * All fields optional; {@link createDrizzleInstance} applies sane defaults
 * (max=10, min=2, idle=30 s, connect=5 s).
 */
export interface DrizzlePoolOptions {
  max?: number
  min?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
}

/**
 * Options consumed by {@link DrizzleModule.forRoot} / `forRootAsync` and
 * forwarded into {@link createDrizzleInstance}.
 */
export interface DrizzleModuleOptions {
  connectionString: string
  pool?: DrizzlePoolOptions
}

/**
 * Async factory shape for {@link DrizzleModule.forRootAsync}.
 *
 * Mirrors the NestJS module-options convention: `imports`, `inject`, and a
 * `useFactory` that may be sync or async.
 */
export interface DrizzleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: InjectionToken[]
  useFactory: (...args: unknown[]) => DrizzleModuleOptions | Promise<DrizzleModuleOptions>
}
