import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'

import type { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import type { Response } from 'express'
import type { Observable } from 'rxjs'

/**
 * Stamps `Trace-Id` response header from CLS-stored W3C traceId.
 *
 * Spec: https://www.w3.org/TR/trace-context/
 *
 * Setup callback parses inbound `traceparent` header (extracting traceId,
 * parentId, traceFlags). This interceptor echoes the traceId so clients
 * + APM tools (Jaeger, Zipkin, OpenTelemetry collectors) can stitch the
 * server segment into the distributed trace.
 */
@Injectable()
export class TraceContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>()
    const traceId = this.cls.get<string>('traceId')

    if (traceId) {
      response.setHeader('Trace-Id', traceId)
    }

    return next.handle()
  }
}
