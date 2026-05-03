import { Controller, Get } from '@nestjs/common'
import { UseEnvelope } from '@onwealth/platform/decorators'

/**
 * Health check controller.
 *
 * Trivial liveness signal — `@nestjs/terminus` integration deferred to a
 * future feature phase. The `@UseEnvelope()` decorator opts the response
 * into `{ data, meta }` so the foundation interceptor chain is exercised
 * by the smoke test.
 */
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
