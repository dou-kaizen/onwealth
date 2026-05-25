import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Response } from 'express'
import { ClsService } from 'nestjs-cls'
import type { Observable } from 'rxjs'

/**
 * Mirror the per-request CLS ID onto the `X-Request-Id` response header
 * so clients can quote it back when reporting incidents and operators can
 * grep structured logs for it directly.
 *
 * Header is omitted when CLS has no ID (e.g. a request that bypassed the
 * CLS middleware) rather than fabricating one downstream — the canonical
 * source is `setupClsContext`.
 *
 * @see {@link CorrelationIdInterceptor} — sibling that handles the
 *      cross-service business-transaction ID.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp()
    const response = httpContext.getResponse<Response>()
    const requestId = this.cls.getId()
    if (requestId) {
      response.setHeader('X-Request-Id', requestId)
    }
    return next.handle()
  }
}
