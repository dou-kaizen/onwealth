import {
  CACHE_PORT,
  CacheModule,
  DB_TOKEN,
  DrizzleModule,
  databaseConfig,
  redisConfig,
  withTimeout,
} from '@boilerplate/shared-kernel'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * [H6] DI token identity smoke test.
 *
 * DrizzleModule / CacheModule register their providers under the DB_TOKEN /
 * CACHE_PORT symbols imported from @boilerplate/shared-kernel. A consumer that
 * resolves those same barrel-exported tokens must receive the registered
 * provider — if either symbol were ever defined twice (dual-`Symbol` across
 * the package boundary), DI resolution would fail silently. Typecheck cannot
 * catch this; only a runtime resolve can.
 *
 * The `registerAs` config factories parse `process.env` directly, so the
 * values below are stubbed in. Neither backend is actually contacted:
 * `@keyv/redis` v5 lazy-connects — `new KeyvRedis(url)` opens no socket until
 * the first cache operation — and `pg.Pool` defers its first connection until a
 * query is issued. Both URLs only need to be syntactically valid; this test
 * requires no live Redis or Postgres.
 */
describe('[H6] shared-kernel DI token identity', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/onwealth_test')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves DB_TOKEN and CACHE_PORT from the booted modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [databaseConfig, redisConfig],
        }),
        DrizzleModule.forRoot(),
        CacheModule,
      ],
    }).compile()

    expect(moduleRef.get(DB_TOKEN, { strict: false })).toBeDefined()
    expect(moduleRef.get(CACHE_PORT, { strict: false })).toBeDefined()

    await moduleRef.close()
  })

  it('withTimeout rejects ms <= 0 before issuing any SQL', async () => {
    // A db object with a transaction spy — verifies we throw before calling db.transaction
    const transactionSpy = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only stub for DrizzleDb interface
    const fakeDb: any = { transaction: transactionSpy }

    await expect(withTimeout(fakeDb, 0, async () => 'result')).rejects.toThrow(
      'withTimeout: ms must be > 0, got 0',
    )
    await expect(withTimeout(fakeDb, -1, async () => 'result')).rejects.toThrow(
      'withTimeout: ms must be > 0, got -1',
    )

    // transaction must never be called when ms <= 0
    expect(transactionSpy).not.toHaveBeenCalled()
  })
})
