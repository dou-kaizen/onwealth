import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable, RequestTimeoutException } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { TimeoutError, throwError } from 'rxjs'
import { catchError, timeout } from 'rxjs/operators'

/**
 * Cap controller execution time so a hung handler can never wedge a
 * request indefinitely.
 *
 * On timeout, the RxJS `TimeoutError` is rewritten as a NestJS
 * `RequestTimeoutException` (HTTP 408) so the Problem Details filter can
 * render a standard error body. Non-timeout errors are forwarded verbatim
 * so other filters can still classify them correctly.
 *
 * @remarks
 * Default budget is 30 seconds — set deliberately above typical p99 to
 * catch true hangs without firing on slow-but-progressing requests.
 * Override per-instance when registering for endpoints with different
 * SLOs.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs: number

  /**
   * @param timeoutMs — hard deadline in milliseconds; defaults to 30 s.
   */
  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException(`Request timeout after ${this.timeoutMs}ms`),
          )
        }
        return throwError(() => error)
      }),
    )
  }
}
