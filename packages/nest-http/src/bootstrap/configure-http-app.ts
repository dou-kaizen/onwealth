import { RequestMethod } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { appConfig } from '@onwealth/shared-kernel'
import express from 'express'
import helmet from 'helmet'
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
const REQUEST_TIMEOUT_MS = 30_000
/** Explicit JSON body limit — guards against payload amplification attacks. */
const BODY_LIMIT = '100kb'

/**
 * Apply the shared HTTP bootstrap configuration to an already-created Nest app.
 *
 * This is the single source of truth for HTTP-layer setup, reused by both the
 * production entrypoint (`apps/api/src/main.ts`) and the test app helper
 * (`apps/api/src/__tests__/helpers/create-app.ts`) — they previously drifted
 * apart maintaining the same filter/interceptor/pipe registration by hand.
 *
 * It takes an already-created app rather than a module so each caller controls
 * app creation: production via `NestFactory.create(AppModule)`, tests via
 * `TestingModule.createNestApplication()`.
 *
 * The caller is responsible for `app.listen()` (production) or `app.init()`
 * (tests), and for choosing a logger backend via `app.useLogger()`.
 */
export async function configureHttpApp(
  app: NestExpressApplication,
  options: HttpAppOptions = {},
): Promise<NestExpressApplication> {
  const { testMode = false } = options

  // Security hardening: Helmet (adds HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
  // CSP + COEP disabled — JSON API, no HTML served; COEP not needed for APIs.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))

  // Trust the first proxy hop so ThrottlerGuard rates by real client IP, not LB IP.
  app.set('trust proxy', 1)

  // Explicit body limit — prevents payload amplification attacks.
  app.use(express.json({ limit: BODY_LIMIT }))

  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY)

  // CORS — fixed origin under test mode, otherwise resolved from typed http config.
  const corsOrigins = testMode
    ? TEST_CORS_ORIGINS
    : app.get<ConfigType<typeof httpConfig>>(httpConfig.KEY).allowedOrigins
  app.enableCors(createCorsConfig(corsOrigins))

  // Global route prefix
  app.setGlobalPrefix('api', {
    exclude: [
      // Exclude Swagger well-known endpoints
      { path: '.well-known', method: RequestMethod.ALL },
      { path: '.well-known/{*path}', method: RequestMethod.ALL },
      // Exclude health / liveness / readiness probe endpoints (no /api prefix)
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/{*path}', method: RequestMethod.ALL },
      { path: 'livez', method: RequestMethod.ALL },
      { path: 'readyz', method: RequestMethod.ALL },
    ],
  })

  // Global exception filters — NestJS RouterExceptionFilters.create() calls
  // filters.reverse() internally, then ExceptionsHandler.invokeCustomFilters
  // does first-match .find(). Registration order (All, Problem, Throttler)
  // → internal reversed array [Throttler, Problem, All] → ThrottlerException
  // matches ThrottlerExceptionFilter (@Catch(ThrottlerException)) first, so
  // Retry-After / X-RateLimit-* headers are always applied. AllExceptionsFilter
  // remains the catch-all fallback for anything not matched upstream.
  app.useGlobalFilters(
    app.get(AllExceptionsFilter),
    app.get(ProblemDetailsFilter),
    app.get(ThrottlerExceptionFilter),
  )

  // Global interceptors (in execution order)
  app.useGlobalInterceptors(
    // 1. Request context (add tracing headers to response)
    app.get(RequestContextInterceptor),
    app.get(CorrelationIdInterceptor),
    app.get(TraceContextInterceptor),

    // 2. Timeout control (30 seconds)
    new TimeoutInterceptor(REQUEST_TIMEOUT_MS),

    // 3. Location header (201 Created)
    new LocationHeaderInterceptor(),

    // 4. Link header (pagination links)
    new LinkHeaderInterceptor(),

    // 5. Response formatting (executed last)
    new TransformInterceptor(app.get(Reflector)),
  )

  // Global validation pipe
  app.useGlobalPipes(createValidationPipe())

  // Swagger documentation — skipped in test mode and in production
  // (prevents API schema exposure in prod).
  if (!testMode && appCfg.nodeEnv !== 'production') {
    setupSwagger(app)
  }

  // Enable graceful SIGTERM/SIGINT lifecycle (calls onModuleDestroy on providers)
  app.enableShutdownHooks()

  return app
}
