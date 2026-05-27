import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CacheService } from '../cache.service.js'

/**
 * Unit tests for CacheService.wrap sentinel correctness.
 *
 * The core invariant: a function that returns undefined must be cached after
 * the first call and NOT be called again on subsequent wrap() invocations for
 * the same key. Without the MISS_WRAPPER sentinel, cacheManager.get returns
 * undefined for both a miss and a cached-undefined, making every call a miss.
 */

// Minimal mock of cache-manager's Cache interface
function makeMockCacheManager() {
  const store = new Map<string, unknown>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(async () => {
      store.clear()
    }),
    // cache-manager v5 has additional methods; these are the ones CacheService uses
    reset: vi.fn(async () => {
      store.clear()
    }),
  }
}

function makeMockKeyvRedis() {
  return {
    disconnect: vi.fn(async (_force?: boolean) => undefined),
  }
}

function makeService(
  cacheManager: ReturnType<typeof makeMockCacheManager>,
  keyvRedis: ReturnType<typeof makeMockKeyvRedis> = makeMockKeyvRedis(),
): CacheService {
  // CacheService only uses the injected cacheManager and keyvRedis — construct directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only direct construction bypassing DI
  return new CacheService(cacheManager as any, keyvRedis as any)
}

describe('CacheService.wrap', () => {
  let cacheManager: ReturnType<typeof makeMockCacheManager>
  let service: CacheService

  beforeEach(() => {
    cacheManager = makeMockCacheManager()
    service = makeService(cacheManager)
    vi.clearAllMocks()
  })

  it('calls fn once and caches the result for a normal (non-undefined) return value', async () => {
    const fn = vi.fn(async () => 'hello')

    const first = await service.wrap('k', fn)
    const second = await service.wrap('k', fn)

    expect(first).toBe('hello')
    expect(second).toBe('hello')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls fn once when fn returns undefined — result is cached, fn not called again', async () => {
    const fn = vi.fn(async (): Promise<undefined> => undefined)

    const first = await service.wrap<undefined>('k', fn)
    const second = await service.wrap<undefined>('k', fn)

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    // Without the sentinel fix, fn would be called twice because both cache-miss
    // and a cached-undefined return undefined from cacheManager.get.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls fn once when fn returns null', async () => {
    // null is a valid cached value — treated as a cache hit on second call.
    const fn = vi.fn(async () => null)

    const first = await service.wrap<null>('k', fn)
    const second = await service.wrap<null>('k', fn)

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls fn again after del clears the key', async () => {
    const fn = vi.fn(async () => 42)

    await service.wrap('k', fn)
    await service.del('k')
    await service.wrap('k', fn)

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('returns computed value even when the cache set throws', async () => {
    cacheManager.set.mockRejectedValueOnce(new Error('redis down'))
    const fn = vi.fn(async () => 'value')

    const result = await service.wrap('k', fn)

    expect(result).toBe('value')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // Sentinel-collision case: a legit value that happens to look like the
  // internal MISS_WRAPPER sentinel (`{ __sk: 'undefined-sentinel-v1' }`).
  // Currently the implementation tells these apart by referential identity on
  // the cached object's __sk property — any caller-supplied object with the
  // same __sk string will be unwrapped to `undefined`. This test documents
  // that known limitation so we catch a regression that broadens or narrows
  // the sentinel-detection rule.
  it('sentinel collision: caller-supplied { __sk: "undefined-sentinel-v1" } is unwrapped to undefined', async () => {
    const fn = vi.fn(async () => ({ __sk: 'undefined-sentinel-v1' }))
    const first = await service.wrap('k', fn)
    const second = await service.wrap('k', fn)

    // First call: fn returns the colliding shape, gets stored verbatim
    // (it is NOT === to the frozen UNDEFINED_RESULT), and returned to caller.
    expect(first).toEqual({ __sk: 'undefined-sentinel-v1' })
    // Second call: cacheManager.get returns the stored object, isUndefinedSentinel
    // matches by __sk equality → unwrapped to undefined. Document this.
    expect(second).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
