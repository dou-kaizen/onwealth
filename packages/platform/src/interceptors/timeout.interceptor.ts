import { Injectable, RequestTimeoutException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { throwError, TimeoutError } from 'rxjs'
import { catchError, timeout } from 'rxjs/operators'

import type { Env } from '../config/env.schema'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'

/**
 * Per-request timeout interceptor.
 *
 * Default 30s; overridable via `REQUEST_TIMEOUT_MS` env. Aborts handler
 * with `RequestTimeoutException` (→ 408 Problem Details + REQUEST_TIMEOUT
 * code) when handler observable doesn't complete in time.
 *
 * Mount as the OUTERMOST global interceptor so the timer wraps the
 * full request pipeline.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  readonly #timeoutMs: number

  constructor(configService: ConfigService<Env, true>) {
    this.#timeoutMs = configService.get('REQUEST_TIMEOUT_MS', { infer: true })
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.#timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException(`Request timeout after ${this.#timeoutMs}ms`),
          )
        }
        return throwError(() => error)
      }),
    )
  }
}
