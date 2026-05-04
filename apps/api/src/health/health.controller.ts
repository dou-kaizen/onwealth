import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { UseEnvelope } from '@onwealth/platform/decorators'

/**
 * Health check controller.
 *
 * Trivial liveness signal — `@nestjs/terminus` integration deferred to a
 * future feature phase. The `@UseEnvelope()` decorator opts the response
 * into `{ data, meta }` so the foundation interceptor chain is exercised
 * by the smoke test.
 *
 * `@SkipThrottle()` is mandatory at the class level — K8s liveness probes
 * from N nodes accumulate against a single per-IP window once trust proxy
 * is fixed; without skipping, probes start receiving 429 and trigger a
 * pod restart cascade.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  @UseEnvelope()
  check(): { status: 'ok'; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  }
}
