import type { DynamicModule } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'
import type { Env } from '../config/env.schema.js'
import type { LoggerConfigOptions } from './logger.config.js'
import { createLoggerConfig } from './logger.config.js'

/**
 * Logger module
 *
 * Provides high-performance structured logging based on nestjs-pino.
 *
 * Exposed as a dynamic module (`forRoot`) so the consuming app supplies its own
 * route exclusion list — the module itself stays transport/route-agnostic and
 * is reusable by non-HTTP NestJS apps.
 *
 * Features:
 * - High-performance JSON logging (Pino)
 * - Automatic request context injection
 * - Automatic sensitive field redaction
 * - Environment-aware configuration
 */
@Module({})
export class LoggerModule {
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
