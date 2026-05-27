import { appConfig } from '@boilerplate/shared-kernel'
import { RequestMethod } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import express from 'express'
import helmet from 'helmet'
import ms from 'ms'
import { httpConfig } from '../config/http.config.js'
import { createCorsConfig } from '../config/security.config.js'
import { setupSwagger } from '../config/swagger.config.js'
import { createValidationPipe } from '../config/validation.config.js'
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js'
import { ProblemDetailsFilter } from '../filters/problem-details.filter.js'
import { ThrottlerExceptionFilter } from '../filters/throttler-exception.filter.js'
import { CorrelationIdInterceptor } from '../interceptors/correlation-id.interceptor.js'
import { LinkHeaderInterceptor } from '../interceptors/link-header.interceptor.js'
import { LocationHeaderInterceptor } from '../interceptors/location-header.interceptor.js'
import { RequestContextInterceptor } from '../interceptors/request-context.interceptor.js'
import { TimeoutInterceptor } from '../interceptors/timeout.interceptor.js'
import { TraceContextInterceptor } from '../interceptors/trace-context.interceptor.js'
import { TransformInterceptor } from '../interceptors/transform.interceptor.js'
import type { HttpAppOptions } from './http-app-options.js'

/** Fixed CORS origin used in test mode for deterministic, isolated requests. */
const TEST_CORS_ORIGINS = ['http://localhost:3000']
/** Global request timeout (ms). */
const REQUEST_TIMEOUT_MS = ms('30s')
/** Explicit JSON body limit — guards against payload amplification attacks. */
const BODY_LIMIT = '100kb'

/**
 * Apply the shared HTTP bootstrap configuration to an already-created Nest app.
 *
 * Single source of truth for HTTP-layer setup, reused by both the production
 * entrypoint (`apps/api/src/main.ts`) and the test app helper
 * (`apps/api/src/__tests__/helpers/create-app.ts`) — they previously drifted
 * apart maintaining the same filter/interceptor/pipe registration by hand.
 *
 * Takes an already-created app rather than a module so each caller owns app
 * creation: production via `NestFactory.create(AppModule)`, tests via
 * `TestingModule.createNestApplication()`.
 *
 * The caller is responsible for `app.listen()` (production) or `app.init()`
 * (tests), and for choosing a logger backend via `app.useLogger()`.
 *
 * **Sequence (do not reorder without re-validating the test gate):**
 * 1. Global Helmet — security headers minus CSP/COEP (JSON API serves no HTML).
 * 2. Scoped CSP for `/swagger` + `/docs` routes (see CSP block JSDoc below).
 * 3. `trust proxy = 1` so `ThrottlerGuard` rates by real client IP.
 * 4. Explicit `express.json({ limit })` — single body parser (NestJS default
 *    disabled via `createHttpApp`).
 * 5. CORS — fixed in test mode, env-driven in prod.
 * 6. Global `/api` prefix with explicit health/well-known exclusions.
 * 7. Filter registration order (see filter block JSDoc).
 * 8. Interceptor registration order (see interceptor block JSDoc).
 * 9. Global validation pipe.
 * 10. Swagger setup unless in test mode OR production.
 * 11. `enableShutdownHooks()` for SIGTERM/SIGINT → `onModuleDestroy` chain.
 *
 * @param app     a created (but not listening / not initialised) Nest app.
 * @param options test-mode toggle; see {@link HttpAppOptions}.
 * @returns the same `app` for chaining.
 */
export async function configureHttpApp(
  app: NestExpressApplication,
  options: HttpAppOptions = {},
): Promise<NestExpressApplication> {
  const { testMode = false } = options

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))

  /**
   * [M8] Scoped CSP for HTML doc routes only. SwaggerUI and Scalar both
   * render HTML with inline scripts/styles for their UI shell; locking
   * these down requires forking the bundles to add nonces (not on roadmap).
   *
   * Defense-in-depth is layered via the conservative directives below —
   * they shut down clickjacking, plugin injection, and form-action redirects
   * without breaking the doc UIs.
   *
   * `'unsafe-inline'` on script-src is an accepted residual risk documented
   * in `plans/260524-1613-codebase-review-findings-fix/` (M8); the Swagger
   * `persistAuthorization: true` token stays in localStorage, so a future
   * Scalar XSS could still exfiltrate it. Re-evaluate when either UI adds
   * first-class nonce support.
   */
  app.use(
    ['/swagger', '/swagger/{*path}', '/docs', '/docs/{*path}'],
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  )

  app.set('trust proxy', 1)

  app.use(express.json({ limit: BODY_LIMIT }))

  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY)

  const corsOrigins = testMode
    ? TEST_CORS_ORIGINS
    : app.get<ConfigType<typeof httpConfig>>(httpConfig.KEY).allowedOrigins
  app.enableCors(createCorsConfig(corsOrigins))

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '.well-known', method: RequestMethod.ALL },
      { path: '.well-known/{*path}', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/{*path}', method: RequestMethod.ALL },
      { path: 'livez', method: RequestMethod.ALL },
      { path: 'readyz', method: RequestMethod.ALL },
    ],
  })

  /**
   * Global exception filters — registration order matters.
   *
   * NestJS `RouterExceptionFilters.create()` calls `filters.reverse()`
   * internally, then `ExceptionsHandler.invokeCustomFilters` does
   * first-match `.find()`. Registration order (All, Problem, Throttler) →
   * internal reversed array [Throttler, Problem, All] → `ThrottlerException`
   * matches `ThrottlerExceptionFilter` first, so `Retry-After` /
   * `X-RateLimit-*` headers are always applied. `AllExceptionsFilter` is the
   * catch-all fallback for anything not matched upstream.
   */
  app.useGlobalFilters(
    app.get(AllExceptionsFilter),
    app.get(ProblemDetailsFilter),
    app.get(ThrottlerExceptionFilter),
  )

  /**
   * Global interceptors in execution order.
   *
   * 1. Request context (tracing headers on response).
   * 2. Timeout control (30 s).
   * 3. `Location` header for 201 Created.
   * 4. `Link` header for pagination.
   * 5. Response envelope formatting (runs last so it sees the final body).
   *
   * `LocationHeaderInterceptor` and `LinkHeaderInterceptor` are pulled from
   * the container so their `@Inject(httpConfig.KEY)` resolves — `new`-ing
   * them would skip DI.
   */
  app.useGlobalInterceptors(
    app.get(RequestContextInterceptor),
    app.get(CorrelationIdInterceptor),
    app.get(TraceContextInterceptor),
    new TimeoutInterceptor(REQUEST_TIMEOUT_MS),
    app.get(LocationHeaderInterceptor),
    app.get(LinkHeaderInterceptor),
    new TransformInterceptor(app.get(Reflector)),
  )

  app.useGlobalPipes(createValidationPipe())

  if (!testMode && appCfg.nodeEnv !== 'production') {
    setupSwagger(app)
  }

  app.enableShutdownHooks()

  return app
}
