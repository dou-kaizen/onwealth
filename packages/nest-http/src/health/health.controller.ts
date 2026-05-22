import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { HealthIndicatorFunction } from '@nestjs/terminus'
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { SkipThrottle } from '@nestjs/throttler'
import type { Env } from '@onwealth/shared-kernel'
import { Public } from '../decorators/public.decorator.js'
import { DrizzleHealthIndicator } from './drizzle.health.js'
import { RedisHealthIndicator } from './redis.health.js'

type HealthEntry = { status: 'up' | 'down'; message: string }

/**
 * Health check controller — three probe endpoints following k8s / Spring Boot Actuator conventions.
 *
 * /livez   — liveness probe:  "is the process alive?" — memory only, NO external deps.
 *             Fail = container restart. Never check DB/Redis here — a DB hiccup would
 *             restart all pods simultaneously.
 *
 * /readyz  — readiness probe: "is the app ready to serve traffic?" — DB + Redis.
 *             Fail = remove from LB pool (no restart). Suitable for drain control.
 *
 * /health  — full detail for ops dashboards & monitoring scrape.
 *             Sanitized responses — never leaks raw infra error messages.
 *
 * All three endpoints are:
 *   - @Public()      — k8s/LB probes cannot send Bearer tokens
 *   - @SkipThrottle() — probe traffic must not consume rate-limit quota
 *   - Cache-Control: no-store — stale health responses must never be served from cache
 */
@Public()
@Controller()
@ApiTags('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly drizzle: DrizzleHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Liveness probe — "is the process alive?"
   *
   * Checks heap memory only (300 MB threshold — generous to avoid spurious restarts
   * during warm cache / GC pressure). NO external deps.
   * Suitable for: k8s livenessProbe, AWS ALB health check, Fly.io health check.
   */
  @Get('livez')
  @HealthCheck()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Liveness probe (memory only, no external deps)' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  @ApiResponse({ status: 503, description: 'Process memory exceeded threshold' })
  async liveness() {
    return this.runChecks([() => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024)])
  }

  /**
   * Readiness probe — "is the app ready to serve traffic?"
   *
   * Checks DB + Redis. Fail = drop from LB pool (no restart).
   * Suitable for: k8s readinessProbe, LB membership, drain control before deploy.
   */
  @Get('readyz')
  @HealthCheck()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Readiness probe (DB + Redis)' })
  @ApiResponse({ status: 200, description: 'All critical dependencies are healthy' })
  @ApiResponse({ status: 503, description: 'One or more critical dependencies are unhealthy' })
  async readiness() {
    return this.runChecks([
      () => this.drizzle.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ])
  }

  /**
   * Full detail — for ops dashboards & monitoring scrape.
   *
   * Checks DB + Redis + heap + RSS + disk. Sanitized: never returns raw
   * infra error messages. Suitable for uptime monitoring, Grafana, Datadog.
   */
  @Get('health')
  @HealthCheck()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Full health check',
    description: 'Checks database, Redis, memory, and disk health for production monitoring',
  })
  @ApiResponse({
    status: 200,
    description: 'All components are healthy',
    schema: {
      example: {
        environment: 'production',
        database: { status: 'up', message: 'Database is available' },
        redis: { status: 'up', message: 'Redis is available' },
        memory_heap: { status: 'up', message: 'Heap memory usage is within threshold' },
        memory_rss: { status: 'up', message: 'RSS memory usage is within threshold' },
        storage: { status: 'up', message: 'Disk usage is within threshold' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'One or more components are unhealthy',
    schema: {
      example: {
        environment: 'production',
        message: 'One or more components unhealthy',
      },
    },
  })
  async detailed() {
    return this.runChecks([
      () => this.drizzle.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.9 }),
    ])
  }

  /**
   * Shared check runner — builds a sanitized response from HealthCheckService.
   *
   * On success: returns per-component entries with environment tag.
   * On failure: throws ServiceUnavailableException with a STATIC aggregate
   *   message ('One or more components unhealthy') — never leaks per-component
   *   raw error messages to unauthenticated callers.
   */
  private async runChecks(checks: HealthIndicatorFunction[]) {
    try {
      const result = await this.health.check(checks)

      const defaultMessages: Record<string, string> = {
        memory_heap: 'Heap memory usage is within threshold',
        memory_rss: 'RSS memory usage is within threshold',
        storage: 'Disk usage is within threshold',
      }

      const details: Record<string, HealthEntry> = {}
      for (const [key, value] of Object.entries(result.details)) {
        const status = value.status as 'up' | 'down'
        const message =
          typeof value.message === 'string' ? value.message : (defaultMessages[key] ?? 'OK')
        details[key] = { status, message }
      }

      const environment: Env['NODE_ENV'] = this.config.get('NODE_ENV')
      return { environment, ...details }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        // Static aggregate message — no per-component concatenation that could
        // surface raw infra error strings to unauthenticated callers.
        throw new ServiceUnavailableException('One or more components unhealthy')
      }
      throw error
    }
  }
}
