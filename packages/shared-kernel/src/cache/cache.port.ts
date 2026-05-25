/**
 * DI token for {@link CachePort}.
 *
 * Use `@Inject(CACHE_PORT)` in consumers so they bind against the abstraction,
 * not the concrete {@link CacheService}. Lets tests swap an in-memory adapter
 * and lets infra swap the cache backend without touching call sites.
 */
export const CACHE_PORT = Symbol('CACHE_PORT')

/**
 * Cache abstraction consumed via {@link CACHE_PORT}.
 *
 * Implementations MUST degrade gracefully on backend errors — cache is a
 * non-critical accelerator, not a source of truth. See {@link CacheService}
 * for the production implementation.
 *
 * `ttl` is expressed in **seconds** (not milliseconds) to match common Redis
 * conventions. Implementations convert internally.
 */
export interface CachePort {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  del(key: string): Promise<void>
  reset(): Promise<void>
  wrap<T>(key: string, function_: () => Promise<T>, ttl?: number): Promise<T>
}
