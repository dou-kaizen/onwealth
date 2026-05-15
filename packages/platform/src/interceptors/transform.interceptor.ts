import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClsService } from 'nestjs-cls'
import { map } from 'rxjs/operators'

import { USE_ENVELOPE_KEY } from '../decorators/use-envelope.decorator'

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'

/**
 * Conditional response envelope (Google AIP-193).
 *
 * Behavior:
 *   - handler decorated with `@UseEnvelope()` → wrap `{ data, meta }` where
 *     meta carries tracing IDs from CLS
 *   - response shaped like `{ object: 'list', data: [...] }` → already
 *     conforms to AIP-193 collection shape, returned as-is
 *   - everything else → returned naked (single resources stay flat per AIP-193)
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (data === null || data === undefined) return data

        const useEnvelope = this.reflector.getAllAndOverride<boolean>(USE_ENVELOPE_KEY, [
          context.getHandler(),
          context.getClass(),
        ])

        return useEnvelope ? { data, meta: this.buildMeta() } : data
      }),
    )
  }

  private buildMeta(): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
    }
    const requestId = this.cls.getId()
    if (requestId) meta['request_id'] = requestId
    const correlationId = this.cls.get<string>('correlationId')
    if (correlationId) meta['correlation_id'] = correlationId
    const traceId = this.cls.get<string>('traceId')
    if (traceId) meta['trace_id'] = traceId
    return meta
  }
}
