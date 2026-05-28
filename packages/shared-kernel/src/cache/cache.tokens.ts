/**
 * Injection token for the shared {@link import('@keyv/redis').default} instance.
 *
 * Extracted to a leaf module to break a circular import:
 * `cache.module.ts` imports `CacheService` and `cache.service.ts` imports
 * this token. Placing the symbol in either parent triggers a TDZ on the
 * bundled CJS/ESM output — the `@Inject(KEYV_REDIS_TOKEN)` decorator
 * metadata evaluates at class-definition time, BEFORE the module file's
 * own initialisation has run, so the token reference resolves to
 * `undefined` (or throws `Cannot access ... before initialization` in
 * strict mode bundles).
 *
 * One KeyvRedis instance is constructed in `CacheModule` and shared between
 * two consumers:
 *   1. `@nestjs/cache-manager`'s `stores` array (read/write path), and
 *   2. `CacheService.onModuleDestroy` (graceful shutdown path).
 *
 * Both consumers MUST receive the SAME instance so the disconnect hook
 * actually closes the ioredis connection used by `cache-manager`.
 */
export const KEYV_REDIS_TOKEN = Symbol('KEYV_REDIS_TOKEN')
