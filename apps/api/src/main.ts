import 'reflect-metadata'
import { ConfigService } from '@nestjs/config'
import { NestFactory, Reflector } from '@nestjs/core'
import {
  AllExceptionsFilter,
  ProblemDetailsFilter,
  ThrottlerExceptionFilter,
} from '@onwealth/platform/filters'
import {
  CorrelationIdInterceptor,
  RequestContextInterceptor,
  TimeoutInterceptor,
  TraceContextInterceptor,
  TransformInterceptor,
} from '@onwealth/platform/interceptors'
import { createValidationPipe } from '@onwealth/platform/pipes'
import helmet from 'helmet'
import { ClsService } from 'nestjs-cls'
import { Logger } from 'nestjs-pino'

import { ApiModule } from './api.module'
import { setupSwagger } from './config/swagger.config'

import type { Env } from '@onwealth/platform/config'
import type { NestExpressApplication } from '@nestjs/platform-express'

/**
 * Bootstrap order (each step depends on prior):
 *  1. create app with `bufferLogs` so pino captures startup
 *  2. swap default logger → nestjs-pino
 *  3. body parsers (10kb cap) before any route mounts
 *  4. strict global helmet → loose CSP path-mounted on /swagger,/docs only
 *  5. trust proxy=1 (single LB hop) so req.ip resolves to client IP
 *  6. global ValidationPipe (whitelist + 422 + transform)
 *  7. global TransformInterceptor (envelope when @UseEnvelope())
 *  8. global filters in LIFO bind order (generic AllExceptions registered
 *     first, typed ProblemDetails + ThrottlerException after, so typed
 *     filters take precedence)
 *  9. enableShutdownHooks before listen (SIGTERM → drain → close)
 * 10. CORS allowlist from env (WARN when empty in non-test)
 * 11. listen on PORT
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
  })

  const logger = app.get(Logger)
  app.useLogger(logger)

  // Tight global JSON/urlencoded body limit. Foundation has no upload
  // endpoints — financial-webhook routes (Stripe-style HMAC) MUST opt
  // into rawBody via NestFactory.create({ rawBody: true }) and use
  // @RawBody(); file uploads MUST use FileInterceptor (multer) which
  // bypasses these parsers entirely.
  app.useBodyParser('json', { limit: '10kb' })
  app.useBodyParser('urlencoded', { limit: '10kb', extended: true })

  const configService = app.get<ConfigService<Env, true>>(ConfigService)
  const reflector = app.get(Reflector)
  const cls = app.get(ClsService)

  // Resolve Swagger gate once: explicit env wins, else default open in non-prod.
  // Production with no override → swaggerEnabled === false → strict CSP + no /docs|/swagger routes.
  const swaggerExplicit = configService.get('ENABLE_SWAGGER', { infer: true })
  const nodeEnv = configService.get('NODE_ENV', { infer: true })
  const swaggerEnabled = swaggerExplicit ?? nodeEnv !== 'production'

  // Strict CSP is the global default — blocks 'unsafe-inline', 'unsafe-eval',
  // and third-party origins on /api/*, /health, /swagger-json, etc.
  // The loose-CSP exception ONLY mounts on the Swagger UI (/swagger) and
  // Scalar UI (/docs) when swagger is enabled. Express path-mounting:
  //   app.use('/swagger', mw) matches /swagger and /swagger/* but NOT
  //   /swagger-json (next char is '-', not '/'), so the JSON endpoint
  //   correctly stays under strict CSP without explicit exclusion.
  // Header conflict: when both run, the path-mounted (last) writer wins
  // for Content-Security-Policy.
  app.use(helmet())

  if (swaggerEnabled) {
    const looseSwaggerCsp = helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
          workerSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
        },
      },
    })
    app.use('/swagger', looseSwaggerCsp)
    app.use('/docs', looseSwaggerCsp)
  }

  // Single LB hop trust posture (public internet → CDN/LB → API).
  // - 0 (default): req.ip = LB socket — throttler throttles the LB, not clients
  // - true (trust all): client can spoof X-Forwarded-For — bypasses throttling
  // - 1 (correct): trust exactly the rightmost X-Forwarded-For entry from our LB
  // Multi-hop CDN→LB→API topologies should bump to 2; documented in
  // docs/code-standards.md under "Trust proxy".
  app.getHttpAdapter().getInstance().set('trust proxy', 1)

  // In-memory throttler is per-process. With multiple workers/replicas, a
  // client can send N× the configured THROTTLE_LIMIT before any single
  // instance returns 429. WORKERS env is operator-set (K8s does not auto-
  // populate); operators must mirror replica count for the warning to fire.
  // Use parseInt + Number.isFinite so empty-string ('') and non-numeric
  // values (NaN) don't silently suppress the warning.
  const workers = Number.parseInt(process.env['WORKERS'] ?? '1', 10)
  if (Number.isFinite(workers) && workers > 1) {
    logger.warn(
      `Running ${workers} workers with in-memory throttler — rate limiting is NOT cluster-safe. Wire REDIS_URL before public exposure.`,
    )
  }

  app.useGlobalPipes(createValidationPipe())

  app.useGlobalInterceptors(
    app.get(TimeoutInterceptor),
    app.get(RequestContextInterceptor),
    app.get(CorrelationIdInterceptor),
    app.get(TraceContextInterceptor),
    new TransformInterceptor(reflector, cls),
  )

  app.useGlobalFilters(
    app.get(AllExceptionsFilter),
    app.get(ProblemDetailsFilter),
    app.get(ThrottlerExceptionFilter),
  )

  // SIGTERM lifecycle: app.close() runs httpServer.close() (drains in-flight
  // requests) BEFORE firing OnModuleDestroy hooks (DatabaseModule pool drain).
  // Must be enabled before app.listen() — without it, the process exits
  // immediately on signal and pg connections leak server-side.
  app.enableShutdownHooks()

  const allowedOrigins = configService.get('ALLOWED_ORIGINS', { infer: true }) ?? []
  if (allowedOrigins.length === 0 && nodeEnv !== 'test') {
    logger.warn(
      'ALLOWED_ORIGINS is not set — CORS is disabled. Browser clients will fail cross-origin requests.',
    )
  }
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })

  if (swaggerEnabled) {
    setupSwagger(app, configService)
  }

  const port = configService.get('PORT', { infer: true })
  await app.listen(port)
}

void bootstrap()
