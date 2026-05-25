import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * [M16] Global filter / interceptor wiring regression test.
 *
 * `app.module.ts` registers filters and interceptors as plain providers — they
 * only become globally active because `configureHttpApp()` calls
 * `app.useGlobalFilters` / `app.useGlobalInterceptors` against each retrieved
 * provider. A future refactor that bypasses `configureHttpApp` would silently
 * disable global activation; only an integration test catches it.
 *
 * Env vars must be in place BEFORE `AppModule` is imported because
 * `ConfigModule.forRoot({ validate })` evaluates the validator at module-load
 * time (inside the `@Module` decorator). `vi.hoisted` runs before the static
 * `import` lines below.
 *
 * Assertions chosen to catch the actual regression scenarios:
 *   1. Each filter/interceptor that `configureHttpApp` looks up via `app.get(...)`
 *      resolves to a real instance — proves DI-level registration in
 *      `AppModule.providers[]` is intact (catches "removed from providers" diff).
 *   2. A request to an unknown route renders `application/problem+json` with the
 *      RFC 9457 body shape — proves the global filter chain is wired up by
 *      `configureHttpApp` (catches "configureHttpApp was skipped" diff).
 */
vi.hoisted(() => {
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/onwealth_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.JWT_SECRET = 'test-secret-min-32-chars-XXXXXXXXXXXXXXXXX'
  process.env.API_BASE_URL = 'http://localhost:3000'
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
  process.env.PORT = '3334'
  process.env.THROTTLE_TTL = '60000'
  process.env.THROTTLE_LIMIT = '100'
})

const { createTestApp } = await import('../helpers/create-app.js')
const {
  AllExceptionsFilter,
  CorrelationIdInterceptor,
  LinkHeaderInterceptor,
  LocationHeaderInterceptor,
  ProblemDetailsFilter,
  RequestContextInterceptor,
  ThrottlerExceptionFilter,
  TraceContextInterceptor,
} = await import('@onwealth/nest-http')

describe('[M16] global filters/interceptors wiring after configureHttpApp', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('every filter/interceptor used by configureHttpApp resolves from the container', () => {
    // configureHttpApp does `app.useGlobalFilters(app.get(...), ...)` etc. — if any
    // of these provider lookups returns undefined at runtime, the corresponding
    // global activation silently no-ops. A grep-only invariant cannot catch this;
    // an actual `app.get()` call is the only gate.
    expect(app.get(AllExceptionsFilter)).toBeDefined()
    expect(app.get(ProblemDetailsFilter)).toBeDefined()
    expect(app.get(ThrottlerExceptionFilter)).toBeDefined()
    expect(app.get(RequestContextInterceptor)).toBeDefined()
    expect(app.get(CorrelationIdInterceptor)).toBeDefined()
    expect(app.get(TraceContextInterceptor)).toBeDefined()
    expect(app.get(LinkHeaderInterceptor)).toBeDefined()
    expect(app.get(LocationHeaderInterceptor)).toBeDefined()
  })

  it('ProblemDetailsFilter is global: 404 unknown route returns RFC 9457 body', async () => {
    const response = await request(app.getHttpServer() as never)
      .get('/api/this-route-does-not-exist')
      .expect(404)

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
    expect(response.body).toMatchObject({
      status: 404,
      type: expect.any(String),
      title: expect.any(String),
    })
  })
})
