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

import type { INestApplication } from '@nestjs/common'
import type { Env } from '@onwealth/platform/config'

/**
 * Bootstrap order (each step depends on prior):
 *  1. create app with `bufferLogs` so pino captures startup
 *  2. swap default logger → nestjs-pino
 *  3. helmet (security headers) before CORS / routes
 *  4. global ValidationPipe (whitelist + 422 + transform)
 *  5. global TransformInterceptor (envelope when @UseEnvelope())
 *  6. global filters in LIFO bind order (generic AllExceptions registered
 *     first, typed ProblemDetails + ThrottlerException after, so typed
 *     filters take precedence)
 *  7. CORS allowlist from env
 *  8. listen on PORT
 */
async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(ApiModule, {
    bufferLogs: true,
  })

  app.useLogger(app.get(Logger))

  const configService = app.get<ConfigService<Env, true>>(ConfigService)
  const reflector = app.get(Reflector)
  const cls = app.get(ClsService)

  // Resolve Swagger gate once: explicit env wins, else default open in non-prod.
  // Production with no override → swaggerEnabled === false → strict CSP + no /docs|/swagger routes.
  const swaggerExplicit = configService.get('ENABLE_SWAGGER', { infer: true })
  const nodeEnv = configService.get('NODE_ENV', { infer: true })
  const swaggerEnabled = swaggerExplicit ?? nodeEnv !== 'production'

  // helmet must be configured before any route registration (incl. Express middleware
  // mounted by Scalar). When swagger is on we loosen CSP for jsdelivr CDN + inline/eval
  // (Scalar pulls bundle from jsdelivr; Swagger UI uses inline scripts + eval for spec
  // parsing). Production path keeps strict default helmet because swagger never mounts.
  app.use(
    swaggerEnabled
      ? helmet({
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
      : helmet(),
  )

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

  const allowedOrigins = configService.get('ALLOWED_ORIGINS', { infer: true }) ?? []
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
