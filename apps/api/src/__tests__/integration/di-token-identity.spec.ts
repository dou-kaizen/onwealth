import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import {
  CACHE_PORT,
  CacheModule,
  DB_TOKEN,
  DrizzleModule,
  databaseConfig,
  redisConfig,
} from '@onwealth/shared-kernel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * [H6] DI token identity smoke test.
 *
 * DrizzleModule / CacheModule register their providers under the DB_TOKEN /
 * CACHE_PORT symbols imported from @onwealth/shared-kernel. A consumer that
 * resolves those same barrel-exported tokens must receive the registered
 * provider — if either symbol were ever defined twice (dual-`Symbol` across
 * the package boundary), DI resolution would fail silently. Typecheck cannot
 * catch this; only a runtime resolve can.
 *
 * The `registerAs` config factories parse `process.env` directly, so the
 * values below are stubbed in. They are syntactically valid but never used to
 * open a connection — pg.Pool and @keyv/redis both connect lazily, so
 * `.compile()` never touches the network.
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
})
