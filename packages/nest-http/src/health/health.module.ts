import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { DrizzleHealthIndicator } from './drizzle.health.js'
import { HealthController } from './health.controller.js'
import { RedisHealthIndicator } from './redis.health.js'

/**
 * Wires liveness/readiness/full health endpoints.
 *
 * @remarks
 * Only registers Terminus + the two custom indicators. The DB and cache
 * dependencies are injected from the global `DrizzleModule` and
 * `CacheModule` — re-importing them here would double-register their
 * providers and break the shared connection pool / client.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DrizzleHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
