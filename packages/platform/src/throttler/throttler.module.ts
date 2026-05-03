import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler'

import type { Env } from '../config/env.schema'

/**
 * Foundation throttler.
 *
 * TTL/limit driven by env so feature modules can tune without owning
 * rate-limit logic. Pair with `ThrottlerExceptionFilter` for RFC 9457
 * 429 responses + `Retry-After` / `X-RateLimit-*` headers.
 */
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('THROTTLE_TTL', { infer: true }),
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
