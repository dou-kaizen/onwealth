import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Response } from 'express'
import { ClsService } from 'nestjs-cls'
import type { Observable } from 'rxjs'

/**
 * Mirror the W3C Trace Context `trace-id` onto the `Trace-Id` response
 * header so APM tooling (Jaeger, Zipkin, OpenTelemetry collectors) and
 * frontend RUM can stitch the response into the parent distributed trace.
 *
 * The `traceparent` request header is parsed once upstream in
 * `setupClsContext`; this interceptor only echoes the cached `traceId`.
 *
 * **`traceparent` wire format** (W3C Trace Context):
 * ```
 * 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 * └─ version
 *    └─ trace-id (32 hex)
 *                                     └─ parent-id (16 hex)
 *                                                      └─ trace-flags
 * ```
 *
 * @see {@link https://www.w3.org/TR/trace-context/} — W3C Trace Context
 * @see {@link parseTraceparent} — header parser used by CLS setup
 */
@Injectable()
export class TraceContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp()
    const response = httpContext.getResponse<Response>()
    const traceId = this.cls.get<string>('traceId')
    if (traceId) {
      response.setHeader('Trace-Id', traceId)
    }
    return next.handle()
  }
}
