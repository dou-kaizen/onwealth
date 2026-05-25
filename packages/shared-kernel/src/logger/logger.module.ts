import type { DynamicModule } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'
import type { Env } from '../config/env.schema.js'
import type { LoggerConfigOptions } from './logger.config.js'
import { createLoggerConfig } from './logger.config.js'

/**
 * High-performance structured logging module backed by nestjs-pino.
 *
 * Exposed as a dynamic module (`forRoot`) so the consuming app supplies its
 * own route exclusion list — the module stays transport/route-agnostic and
 * remains reusable by non-HTTP NestJS apps.
 *
 * **Provides:**
 * - JSON logging via pino (zero-allocation hot path).
 * - Automatic request-context injection (correlationId, requestId, traceId).
 * - Sensitive field redaction via {@link redactPaths}.
 * - Environment-aware log level via `NODE_ENV`.
 *
 * @see createLoggerConfig for the underlying pino config builder.
 */
@Module({})
export class LoggerModule {
  /**
   * Wire the pino logger into the host app.
   *
   * @param options Route-agnostic overrides (excluded paths, auto-logging
   *                prefix). See {@link LoggerConfigOptions}.
   */
  static forRoot(options: LoggerConfigOptions = {}): DynamicModule {
    return {
      module: LoggerModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>) => createLoggerConfig(config, options),
        }),
      ],
    }
  }
}
