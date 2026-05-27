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
} from '@boilerplate/nest-http'
import {
  appConfig,
  CacheModule,
  DomainEventsModule,
  DrizzleModule,
  databaseConfig,
  LoggerModule,
  redisConfig,
  validateEnv,
} from '@boilerplate/shared-kernel'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module, RequestMethod } from '@nestjs/common'
import { ConfigModule, type ConfigType } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ClsModule } from 'nestjs-cls'

/**
 * High-frequency probe routes excluded from pino access logs.
 *
 * Kept in sync with the `main.ts` global-prefix exclusions and the
 * `health.controller` routes — if you add/rename a probe path, update all
 * three sites or the new path will spam every request log.
 */
const LOG_EXCLUDED_ROUTES = [
  { method: RequestMethod.GET, path: 'health' },
  { method: RequestMethod.GET, path: 'health/live' },
  { method: RequestMethod.GET, path: 'health/ready' },
  { method: RequestMethod.GET, path: 'livez' },
  { method: RequestMethod.GET, path: 'readyz' },
] as const

/**
 * Root module — infrastructure-only boilerplate.
 *
 * **Architecture:**
 * - Modular layered architecture as the baseline.
 * - Dependency Inversion (DIP) via DI tokens in `@boilerplate/shared-kernel`.
 * - DDD primitives ({@link BaseAggregateRoot}, {@link DomainEventPublisher})
 *   adopted on demand by feature modules.
 *
 * **Provider wiring note:** filters/interceptors are registered as plain
 * providers here so their constructor `@Inject(...)` dependencies
 * (`httpConfig`, `ConfigService`, …) resolve via the Nest container. Global
 * activation is wired inside `configureHttpApp()` via `app.useGlobalFilters`
 * / `app.useGlobalInterceptors`, each pulled via `app.get(Class)`. Skipping
 * `configureHttpApp` — e.g. a test that bypasses it — silently disables
 * global activation. The regression gate is
 * `apps/api/src/__tests__/integration/global-pipeline.spec.ts`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
      load: [appConfig, databaseConfig, redisConfig, httpConfig, throttleConfig],
      cache: true,
    }),
    ClsModule.forRoot(createClsConfig()),
    LoggerModule.forRoot({ excludePaths: [...LOG_EXCLUDED_ROUTES], autoLoggingUrlPrefix: '/api/' }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    DrizzleModule.forRoot(),
    DomainEventsModule,
    ThrottlerModule.forRootAsync({
      useFactory: (cfg: ConfigType<typeof throttleConfig>) => [{ ttl: cfg.ttl, limit: cfg.limit }],
      inject: [throttleConfig.KEY],
    }),
    HealthModule,
    CacheModule,
  ],
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
  /**
   * Attach the ETag middleware to every route.
   *
   * `{*path}` is the v11 catch-all glob — `*` alone is the route literal `*`,
   * not a wildcard.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ETagMiddleware).forRoutes('{*path}')
  }
}
