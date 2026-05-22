import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { DrizzleHealthIndicator } from './drizzle.health.js'
import { HealthController } from './health.controller.js'
import { RedisHealthIndicator } from './redis.health.js'

/**
 * Health check module
 *
 * Provides application health check functionality including database, Redis, memory, and disk checks.
 * Note: DB and Cache are provided by global modules (DrizzleModule, CacheModule).
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    DrizzleHealthIndicator, // database health indicator
    RedisHealthIndicator, // Redis health indicator
  ],
})
export class HealthModule {}
