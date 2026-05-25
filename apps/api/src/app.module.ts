import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module, RequestMethod } from '@nestjs/common'
import { ConfigModule, type ConfigType } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import {
  AllExceptionsFilter,
  CorrelationIdInterceptor,
  createClsConfig,
  ETagMiddleware,
  HealthModule,
  httpConfig,
  LinkHeaderInterceptor,
  LocationHeaderInterceptor,
  ProblemDetailsFilter,
  RequestContextInterceptor,
  ThrottlerExceptionFilter,
  TraceContextInterceptor,
  throttleConfig,
} from '@onwealth/nest-http'
import {
  appConfig,
  CacheModule,
  DomainEventsModule,
  DrizzleModule,
  databaseConfig,
  LoggerModule,
  redisConfig,
  validateEnv,
} from '@onwealth/shared-kernel'
import { ClsModule } from 'nestjs-cls'

/**
 * High-frequency probe routes excluded from Pino access logs.
 * Kept in sync with the main.ts global-prefix exclusions and health.controller routes.
 */
const LOG_EXCLUDED_ROUTES = [
  { method: RequestMethod.GET, path: 'health' },
  { method: RequestMethod.GET, path: 'health/live' },
  { method: RequestMethod.GET, path: 'health/ready' },
  { method: RequestMethod.GET, path: 'livez' },
  { method: RequestMethod.GET, path: 'readyz' },
] as const

/**
 * Root module: infrastructure-only boilerplate
 *
 * Architecture notes:
 * - Based on Modular Layered Architecture
 * - Incorporates the Dependency Inversion Principle (DIP)
 * - Uses DDD (Domain-Driven Design) on demand
 */
@Module({
  imports: [
    // Config module: global environment variable management
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      // Full fail-closed Zod gate (HTTP app only)
      validate: validateEnv,
      // Typed per-namespace config factories (each validates its own env subset)
      load: [appConfig, databaseConfig, redisConfig, httpConfig, throttleConfig],
      cache: true,
    }),
    // CLS module: request context management (Request ID, tracing, etc.)
    ClsModule.forRoot(createClsConfig()),
    // Logger module: high-performance structured logging (Pino)
    // autoLoggingUrlPrefix suppresses access logs for non-/api/ paths (container probes, etc.)
    LoggerModule.forRoot({ excludePaths: [...LOG_EXCLUDED_ROUTES], autoLoggingUrlPrefix: '/api/' }),
    // Event module: domain events and integration events
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    // Database module: global Drizzle instance
    DrizzleModule.forRoot(),
    // Domain events module: global domain event publisher
    DomainEventsModule,
    // Rate limiting module: prevent API abuse
    ThrottlerModule.forRootAsync({
      useFactory: (cfg: ConfigType<typeof throttleConfig>) => [{ ttl: cfg.ttl, limit: cfg.limit }],
      inject: [throttleConfig.KEY],
    }),
    HealthModule,
    CacheModule,
  ],
  // NOTE: these filters/interceptors are registered as plain providers here so
  // their constructor `@Inject(...)` dependencies (httpConfig, ConfigService, etc.)
  // resolve via the Nest container. The global activation is wired in
  // `configureHttpApp()` via `app.useGlobalFilters`/`app.useGlobalInterceptors`
  // pulling each provider from `app.get(Class)`. Skipping `configureHttpApp` —
  // e.g. a test that bypasses it — silently disables global activation. The
  // regression gate is `apps/api/src/__tests__/integration/global-pipeline.spec.ts`.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AllExceptionsFilter,
    ProblemDetailsFilter,
    ThrottlerExceptionFilter,
    RequestContextInterceptor,
    CorrelationIdInterceptor,
    TraceContextInterceptor,
    LinkHeaderInterceptor,
    LocationHeaderInterceptor,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ETagMiddleware).forRoutes('{*path}')
  }
}
