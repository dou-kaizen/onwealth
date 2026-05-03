import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'

import { createLoggerConfig } from './pino.config'

import type { Env } from '../config/env.schema'

/**
 * High-performance structured logging via nestjs-pino.
 *
 * Foundation layer logger — feature modules inject `PinoLogger` from
 * `nestjs-pino` (NOT `@nestjs/common` Logger) so log records stay
 * structured and request-correlated.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createLoggerConfig(config),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
