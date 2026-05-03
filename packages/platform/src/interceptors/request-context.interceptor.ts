import { Injectable } from '@nestjs/common'
import { ClsService } from 'nestjs-cls'
import { tap } from 'rxjs/operators'

import type { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import type { Response } from 'express'
import type { Observable } from 'rxjs'

/**
 * Stamps `X-Request-Id` response header from CLS-stored requestId.
 *
 * Inbound side: `nestjs-cls` middleware `idGenerator` populates the
 * id from `x-request-id` header (echo) or generates a UUID (origin).
 * This interceptor mirrors that id back on the response so clients
 * can correlate their request with server logs.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>()
    const requestId = this.cls.getId()

    if (requestId) {
      response.setHeader('X-Request-Id', requestId)
    }

    return next.handle().pipe(tap(() => {}))
  }
}
