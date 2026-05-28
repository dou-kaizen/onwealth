import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Response } from 'express'
import { ClsService } from 'nestjs-cls'
import type { Observable } from 'rxjs'

/**
 * Echo the request's correlation ID back as `X-Correlation-Id` so clients
 * can pin a business transaction (cart, checkout, multi-step flow) to a
 * single tracing token across services.
 *
 * **Scope of tracking IDs in this app:**
 * - **Request ID** — one HTTP request inside one service.
 * - **Correlation ID** — one business transaction spanning multiple services.
 * - **Trace ID** — full distributed call chain (W3C Trace Context).
 *
 * Value is already parsed and stored in CLS by `setupClsContext` — the
 * interceptor only mirrors it onto the response. If CLS has nothing
 * (e.g. infra-level request that bypassed the CLS middleware), the
 * header is simply omitted.
 *
 * @example
 * // Inbound
 * GET /api/orders
 * X-Correlation-Id: shop_session_abc123
 *
 * @example
 * // Outbound
 * 200 OK
 * X-Correlation-Id: shop_session_abc123  // echoed
 * X-Request-Id:     req_xyz789           // per-request
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp()
    const response = httpContext.getResponse<Response>()
    const correlationId = this.cls.get<string>('correlationId')
    if (correlationId) {
      response.setHeader('X-Correlation-Id', correlationId)
    }
    return next.handle()
  }
}
