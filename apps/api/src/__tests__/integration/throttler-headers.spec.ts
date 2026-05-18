import { Controller, Get, Module } from '@nestjs/common'
import { ConfigModule, type ConfigType } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import {
  AllExceptionsFilter,
  ProblemDetailsFilter,
  ThrottlerExceptionFilter,
  createClsConfig,
  httpConfig,
  throttleConfig,
} from '@onwealth/nest-http'
import { appConfig } from '@onwealth/shared-kernel'
import { ClsModule } from 'nestjs-cls'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Integration test: ThrottlerExceptionFilter registration order.
 *
 * Verifies that a 429 response carries the RFC 6585 Retry-After header and
 * the IETF Rate Limit draft headers (X-RateLimit-Limit/Remaining/Reset).
 *
 * NestJS RouterExceptionFilters.create() reverses the global filter array
 * internally, so registration order (All → Problem → Throttler) → runtime
 * order [Throttler, Problem, All] → ThrottlerExceptionFilter matches first on
 * ThrottlerException and applies Retry-After / X-RateLimit-* headers.
 */

@Controller('test-throttle')
class ThrottledController {
  @Get()
  ping() {
    return { ok: true }
  }
}

@Module({ controllers: [ThrottledController] })
class ThrottleTestModule {}

describe('[#2] ThrottlerExceptionFilter — 429 carries RFC headers', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    // Low limit so the test triggers 429 after only 2 requests.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('THROTTLE_TTL', '60000')
    vi.stubEnv('THROTTLE_LIMIT', '2')
    vi.stubEnv('API_BASE_URL', 'http://localhost:3000')
    vi.stubEnv('ALLOWED_ORIGINS', 'http://localhost:3000')
    vi.stubEnv('PORT', '3333')

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // appConfig: AllExceptionsFilter injects appConfig.KEY (@Optional)
          // httpConfig: ProblemDetailsFilter + ThrottlerExceptionFilter inject httpConfig.KEY
          // throttleConfig: ThrottlerExceptionFilter injects throttleConfig.KEY
          load: [appConfig, httpConfig, throttleConfig],
        }),
        // ClsModule: ProblemDetailsFilter, AllExceptionsFilter, ThrottlerExceptionFilter
        // all inject ClsService — it must be provided.
        ClsModule.forRoot(createClsConfig()),
        ThrottlerModule.forRootAsync({
          useFactory: (cfg: ConfigType<typeof throttleConfig>) => [
            { ttl: cfg.ttl, limit: cfg.limit },
          ],
          inject: [throttleConfig.KEY],
        }),
        ThrottleTestModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // ProblemDetailsFilter must be a standalone provider because AllExceptionsFilter
        // injects it via @Inject(ProblemDetailsFilter) as a constructor parameter.
        ProblemDetailsFilter,
        // Global filter registration (All, Problem, Throttler) → NestJS reverses
        // internally → runtime order: Throttler (most specific) first.
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_FILTER, useClass: ThrottlerExceptionFilter },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestExpressApplication>()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
    vi.unstubAllEnvs()
  })

  it('returns 429 with Retry-After and X-RateLimit-* headers after limit exceeded', async () => {
    const agent = request(app.getHttpServer() as never)
    const route = '/test-throttle'

    // Exhaust the 2-request limit
    await agent.get(route).expect(200)
    await agent.get(route).expect(200)

    // Third request must be rate-limited
    const response = await agent.get(route).expect(429)

    // RFC 6585 §4: Retry-After is REQUIRED on 429
    expect(response.headers['retry-after']).toBeDefined()
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)

    // IETF Rate Limit Headers draft
    expect(response.headers['x-ratelimit-limit']).toBe('2')
    expect(response.headers['x-ratelimit-remaining']).toBe('0')
    expect(response.headers['x-ratelimit-reset']).toBeDefined()
    expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(0)

    // RFC 9457 media type
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)

    // Problem Details body
    expect(response.body).toMatchObject({
      status: 429,
      title: 'Too Many Requests',
    })
  })
})
