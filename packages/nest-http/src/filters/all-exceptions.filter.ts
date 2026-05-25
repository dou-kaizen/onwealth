import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus, Inject, Logger, Optional } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { appConfig } from '@onwealth/shared-kernel'
import { DrizzleQueryError } from 'drizzle-orm'
import type { Request, Response } from 'express'
import { ClsService } from 'nestjs-cls'
import { DatabaseError } from 'pg'
import type { ProblemDetailsDto } from '../dtos/problem-details.dto.js'
import { mapDatabaseError } from './database-error-mapper.js'
import { ProblemDetailsFilter } from './problem-details.filter.js'

/**
 * Global catch-all exception filter — last line of defence for anything
 * that escapes the typed filters.
 *
 * **Dispatch order:**
 * 1. `HttpException` → delegated to {@link ProblemDetailsFilter}.
 * 2. `DrizzleQueryError` wrapping a `pg.DatabaseError` → mapped via
 *    {@link mapDatabaseError} to an appropriate `HttpException`, then
 *    re-delegated.
 * 3. Anything else → rendered as a 500 Problem Details body. The original
 *    error message is swapped for a static string in production so
 *    internal details (file paths, SQL fragments) cannot leak.
 *
 * `ClsService` and `appConfig` are `@Optional()` so non-CLS / non-Nest
 * test harnesses can still construct the filter; missing config falls
 * back to the prod-safe path (no message leakage).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  constructor(
    /**
     * Required: misconfigured DI must fail loudly at startup, not silently
     * produce wrong status codes by skipping the RFC 9457 path.
     */
    @Inject(ProblemDetailsFilter)
    private readonly problemDetailsFilter: ProblemDetailsFilter,
    @Optional() private readonly cls?: ClsService,
    @Optional()
    @Inject(appConfig.KEY)
    private readonly appCfg?: ConfigType<typeof appConfig>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()

    if (exception instanceof HttpException) {
      return this.problemDetailsFilter.catch(exception, host)
    }

    if (exception instanceof DrizzleQueryError) {
      const cause = exception.cause
      if (cause instanceof DatabaseError) {
        const httpException = mapDatabaseError(cause)
        this.logger.warn(
          `[DB] code=${cause.code} table=${cause.table ?? 'unknown'} constraint=${cause.constraint ?? 'none'}`,
        )
        return this.problemDetailsFilter.catch(httpException, host)
      }
      // Cause is NOT a pg.DatabaseError (rare — driver-level wrap or network error).
      // Log a breadcrumb before falling through to the generic 500 path so operators
      // can trace it instead of seeing a silent black hole.
      this.logger.warn('DrizzleQueryError with non-pg cause', {
        causeName: (cause as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown',
      })
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR
    // Default to true (prod-safe) when appConfig is absent — never leak error.message
    // in test harnesses or misconfigured environments.
    const isProduction = this.appCfg ? this.appCfg.nodeEnv === 'production' : true
    let message = 'Internal server error'
    if (exception instanceof Error) {
      message = isProduction ? 'The server encountered an unexpected error' : exception.message
    }

    const requestId = this.cls?.getId()
    const correlationId = this.cls?.get<string>('correlationId')
    const traceId = this.cls?.get<string>('traceId')

    // RFC 9457 §3: `about:blank` is the canonical default when no documented
    // problem type URI exists. Non-HTTP system errors are unclassified by
    // definition, so we never invent a fake `/errors/unknown` doc URI.
    const problemDetails: ProblemDetailsDto = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status,
      instance: request.url,
      request_id: requestId,
      correlation_id: correlationId,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      code: 'INTERNAL_SERVER_ERROR',
      detail: message,
    }

    const tracePrefix = this.buildTracePrefix(requestId, correlationId, traceId)
    const logMessage = `${tracePrefix}${request.method} ${request.url} ${status}`
    if (exception instanceof Error) {
      this.logger.error(logMessage, exception.stack)
    } else {
      this.logger.error(logMessage, JSON.stringify(exception))
    }

    response.setHeader('Content-Type', 'application/problem+json')
    response.setHeader('Cache-Control', 'no-store')
    response.status(status).json(problemDetails)
  }

  /**
   * Compose a `[req:…|corr:…|trace:…]` log prefix from the optional
   * tracing IDs. Empty when none are present, so log lines stay clean
   * outside request scope.
   */
  private buildTracePrefix(requestId?: string, correlationId?: string, traceId?: string): string {
    const parts: string[] = []
    if (requestId) parts.push(`req:${requestId}`)
    if (correlationId) parts.push(`corr:${correlationId}`)
    if (traceId) parts.push(`trace:${traceId}`)
    return parts.length > 0 ? `[${parts.join('|')}] ` : ''
  }
}
