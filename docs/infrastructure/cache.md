# Cache Documentation

This documentation explains the cache layer of **boilerplate-monorepo**: a `CachePort`
abstraction backed by `@nestjs/cache-manager` and `@keyv/redis`, with a single shared
`KeyvRedis` instance for connection efficiency and graceful disconnect on SIGTERM.

Source location: `packages/shared-kernel/src/cache/`

## Related Documents

- [Environment Variables](./environment.md) — `REDIS_URL` and `REDIS_TTL` reference
- [Configuration](./configuration.md) — `redisConfig` namespace factory
- [Queue](./queue.md) — separate `QUEUE_REDIS_URL` for BullMQ (different Redis index)
- [Project Structure](./project-structure.md) — package boundaries and dependency DAG

## Table of Contents

- [Configuration](#configuration)
- [Structure](#structure)
- [Usage](#usage)
- [Creating a New Cache Namespace](#creating-a-new-cache-namespace)
- [Behavior](#behavior)
- [References](#references)

## Configuration

### Environment Variables

Validated by `redisEnvSchema` (picked from `envObjectSchema`). See
[Environment Variables](./environment.md) for full rules.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | Yes | — | `redis://` or `rediss://`; must use `rediss://` (TLS) in production |
| `REDIS_TTL` | No | `3600` | Default TTL in seconds; must be > 0 |

`redisConfig` is a `registerAs('redis', ...)` factory that returns `{ url, ttl }`.
`ttl` is in seconds — `CacheService` multiplies by 1000 at the `cache-manager` boundary
because `cache-manager` v5+ accepts milliseconds.

`CacheModule` self-loads `ConfigModule.forFeature(redisConfig)` so the host app needs no
extra wiring for cache configuration.

## Structure

| File | Purpose |
|---|---|
| `cache.port.ts` | `CachePort` interface + `CACHE_PORT` Symbol |
| `cache.tokens.ts` | `KEYV_REDIS_TOKEN` Symbol (leaf module to avoid circular TDZ) |
| `cache.module.ts` | `CacheModule` global module + internal `KeyvRedisModule` |
| `cache.service.ts` | `CacheService` — default `CachePort` implementation |

### DI Tokens

```typescript
// cache.port.ts
export const CACHE_PORT = Symbol('CACHE_PORT')

// cache.tokens.ts
export const KEYV_REDIS_TOKEN = Symbol('KEYV_REDIS_TOKEN')
```

`KEYV_REDIS_TOKEN` is defined in a separate leaf file (`cache.tokens.ts`) rather than in
`cache.module.ts` or `cache.service.ts`. The `@Inject(KEYV_REDIS_TOKEN)` decorator metadata
evaluates at class-definition time, before the module file's own initialisation has run;
placing the symbol in either parent would resolve to `undefined` under bundled CJS/ESM
output (TDZ). The leaf file has no imports from either parent, breaking the cycle.

### Shared `KeyvRedis` Instance

`CacheModule` uses an internal `KeyvRedisModule` to provide a single `KeyvRedis` instance
under `KEYV_REDIS_TOKEN`. That single instance is consumed by two places:

1. `NestCacheModule.registerAsync` — the `stores` array (read/write path via `cache-manager`)
2. `CacheService.onModuleDestroy` — the graceful shutdown path

Both must reference the same ioredis client. If each received a separate `new KeyvRedis(url)`
instance, `onModuleDestroy` would disconnect a client that `cache-manager` is not using,
leaving the store connection open until the process is killed.

`KeyvRedisModule` is imported into BOTH the outer `CacheModule` providers scope AND the
`NestCacheModule.registerAsync` imports array so the token resolves in both DI scopes.

## Usage

### Injecting the Cache Port

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { CACHE_PORT, type CachePort } from '@boilerplate/shared-kernel'

@Injectable()
export class UserService {
  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  async getProfile(userId: string) {
    return this.cache.wrap(
      `user:${userId}`,
      () => this.userRepository.findById(userId),
      300, // TTL seconds — overrides module default
    )
  }
}
```

### `CachePort` API

All methods accept TTL in **seconds**. Conversion to milliseconds happens inside
`CacheService` at the `cache-manager` boundary.

| Method | Signature | Notes |
|---|---|---|
| `get` | `get<T>(key): Promise<T \| undefined>` | Returns `undefined` on miss or backend error |
| `set` | `set<T>(key, value, ttl?): Promise<void>` | Silently swallows backend errors |
| `del` | `del(key): Promise<void>` | Silently swallows backend errors |
| `reset` | `reset(): Promise<void>` | Clears all keys via `cache-manager.clear()` |
| `wrap` | `wrap<T>(key, fn, ttl?): Promise<T>` | Read-through; see thundering-herd note |

### Registering in `AppModule`

`CacheModule` is `@Global()`. Import it once at the app root:

```typescript
import { CacheModule } from '@boilerplate/shared-kernel'

@Module({ imports: [CacheModule, ...] })
export class AppModule {}
```

## Creating a New Cache Namespace

The module uses a flat Redis keyspace. To avoid collisions between services, adopt a
naming convention for keys: `{domain}:{entity}:{id}` (e.g. `user:profile:abc123`).

For a service that needs a distinct TTL strategy:

1. Inject `CACHE_PORT` as shown above.
2. Pass an explicit `ttl` argument to `set` / `wrap` on every call — this overrides the
   module-level default (`REDIS_TTL` seconds).
3. Document the TTL rationale in the service (e.g. `300` = 5-minute session cache).

There is no per-service prefix mechanism built into `CacheModule`. If hard namespace
isolation is needed (separate keyspace per tenant or environment), pass a prefix in the
key string or provision a separate Redis logical database.

## Behavior

### Graceful Disconnect on SIGTERM

`CacheService` implements `OnModuleDestroy`. When NestJS triggers shutdown hooks:

```typescript
async onModuleDestroy(): Promise<void> {
  await this.keyvRedis.disconnect(false)
}
```

The `false` argument drains in-flight commands via `QUIT` before closing the socket.
Errors are caught and logged at `warn` level — cache shutdown must never block the process
exit chain. If disconnect hangs, the `main.ts` hard-stop timer takes over.

### Degradation on Backend Error

Every `CacheService` method wraps its `cache-manager` call in `try/catch` and logs a
`warn` on failure. Cache is treated as a non-critical accelerator — an outage degrades
gracefully:

- `get` → returns `undefined` (cache miss semantics)
- `set` / `del` / `reset` → silently completes (write is best-effort)
- `wrap` read error → falls through to `fn()` directly (no store attempt on success)
- `wrap` write error → returns the freshly computed value; subsequent calls will miss again

### Thundering-Herd Note

`wrap()` does not implement a per-key mutex or Redis `SET NX` lock. Concurrent cache
misses on the same key each invoke `fn()` independently. For low-cardinality hot keys
under high concurrency, add a per-key in-process mutex or a Redis `SET NX` guard at the
call site.

### Undefined-Value Caching

`cache-manager.get` returns `undefined` for both a genuine miss and a stored `undefined`
value. `CacheService.wrap` stores a sentinel object `{ __sk: 'undefined-sentinel-v1' }`
when `fn()` returns `undefined`, making the next `wrap` call a cache hit. The sentinel is
discriminated via `Object.hasOwn` (not prototype chain lookup) to prevent prototype
pollution masquerading as a sentinel hit.

## References

[ref-cache-manager]: https://www.npmjs.com/package/cache-manager
[ref-keyv-redis]: https://www.npmjs.com/package/@keyv/redis
[ref-nestjs-cache]: https://docs.nestjs.com/techniques/caching
[ref-ioredis]: https://github.com/redis/ioredis
[ref-redis]: https://redis.io
