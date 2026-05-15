import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ClsModule } from 'nestjs-cls'
import { createClsConfig } from '@/app/config/cls.config'
import type { Env } from '@/app/config/env.schema'
import { validateEnv } from '@/app/config/env.schema'
import { DrizzleModule } from '@/app/database/db.module'
import { DomainEventsModule } from '@/app/events/domain-events.module'
import { AllExceptionsFilter } from '@/app/filters/all-exceptions.filter'
import { ProblemDetailsFilter } from '@/app/filters/problem-details.filter'
import { ThrottlerExceptionFilter } from '@/app/filters/throttler-exception.filter'
import { CorrelationIdInterceptor } from '@/app/interceptors/correlation-id.interceptor'
import { RequestContextInterceptor } from '@/app/interceptors/request-context.interceptor'
import { TraceContextInterceptor } from '@/app/interceptors/trace-context.interceptor'
import { LoggerModule } from '@/app/logger/logger.module'
import { ETagMiddleware } from '@/app/middleware/etag.middleware'
import { CacheModule } from '@/modules/cache/cache.module'
import { HealthModule } from '@/modules/health/health.module'

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
      validate: validateEnv,
      cache: true,
    }),
    // CLS module: request context management (Request ID, tracing, etc.)
    ClsModule.forRoot(createClsConfig()),
    // Logger module: high-performance structured logging (Pino)
    LoggerModule,
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
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<Env, true>) => [
        {
          ttl: configService.get('THROTTLE_TTL', { infer: true }),
          limit: configService.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
      inject: [ConfigService],
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ETagMiddleware).forRoutes('{*path}')
  }
}
