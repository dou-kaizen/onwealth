import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import { tap } from 'rxjs/operators'

import type { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import type { Response } from 'express'
import type { Observable } from 'rxjs'

/**
 * Stamps `X-Correlation-Id` response header from CLS.
 *
 * Correlation ID tracks a business transaction across multiple services
 * (vs requestId which is per-service-per-request). Setup callback parses
 * inbound `x-correlation-id` header (or generates UUID); this interceptor
 * echoes it on response so client can verify the chain end-to-end.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>()
    const correlationId = this.cls.get<string>('correlationId')

    if (correlationId) {
      response.setHeader('X-Correlation-Id', correlationId)
    }

    return next.handle().pipe(tap(() => {}))
  }
}
